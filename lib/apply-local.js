import { execFileSync } from "node:child_process";
import { normalizeLocalModelName, formatModelRef as modelRef } from "./omo-shared.js";
import { LOCAL_PROVIDER } from "./constants.js";

/**
 * Pull an Ollama model, with curl-based fallback when the `ollama` CLI fails.
 * 1. Attempts `ollama pull <name>` (shows native progress bars).
 * 2. On failure, retries via POST http://localhost:11434/api/pull (streams JSON progress).
 * Returns true if the model was successfully pulled, false otherwise.
 */
export function pullModel(modelName) {
  // Primary: ollama CLI
  try {
    execFileSync("ollama", ["pull", modelName], {
      stdio: "inherit",
      timeout: 600000,
    });
    return true;
  } catch (e) {
    console.error(`  \u2716 Failed to pull ${modelName}: ${e.message}`);
  }

  // Fallback: curl-based Ollama API pull
  try {
    console.log(
      `  \u2192 Retrying via curl API at http://localhost:11434/api/pull ...`,
    );
    const body = JSON.stringify({ name: modelName });
    execFileSync(
      "curl",
      [
        "-N",
        "-X",
        "POST",
        "http://localhost:11434/api/pull",
        "-d",
        body,
        "--max-time",
        "600",
      ],
      { stdio: "inherit", timeout: 610000 },
    );
    console.log(`  \u2713 ${modelName} pulled via curl`);
    return true;
  } catch (e2) {
    console.error(`  \u2716 Also failed via curl: ${e2.message}`);
    return false;
  }
}

/**
 * Apply cloud model recommendations to the config object.
 * Iterates cloudRecommendations and sets section.model, section.routing, section.fallback_models.
 * Returns count of changes applied.
 */
export async function applyCloudChanges(aiResult, config, autoYes) {
  if (
    !aiResult.cloudRecommendations ||
    aiResult.cloudRecommendations.length === 0
  )
    return 0;
  let count = 0;
  for (const rec of aiResult.cloudRecommendations) {
    const section = config.agents?.[rec.name] || config.categories?.[rec.name];
    if (!section) continue;
    if (rec.model) {
      section.model = `${rec.model.provider}/${rec.model.model}`;
      if (rec.routing && rec.routing.length > 0) {
        section.routing = rec.routing.map((r) => `${r.provider}/${r.model}`);
      } else if (section.routing) {
        delete section.routing;
      }
      if (rec.fallback_models && rec.fallback_models.length > 0) {
        section.fallback_models = rec.fallback_models.map(
          (r) => `${r.provider}/${r.model}`,
        );
      } else if (section.fallback_models) {
        delete section.fallback_models;
      }
      count++;
    }
  }
  return count;
}

/**
 * Apply local model placements to the config object.
 * Groups placements by agent, picks highest-scored local model per agent,
 * sets as primary or fallback based on role.
 * Returns count of changes applied.
 */
export async function applyLocalPlacements(
  placements,
  config,
  autoYes,
  allLocalModels,
) {
  if (!placements || placements.length === 0) return 0;
  const byAgent = {};
  for (const p of placements) {
    const section =
      config.agents?.[p.agentName] || config.categories?.[p.agentName];
    if (!section) {
      console.log(
        `  \u26A0 Agent/category "${p.agentName}" not found in config \u2014 skipping`,
      );
      continue;
    }
    if (!byAgent[p.agentName]) byAgent[p.agentName] = [];
    byAgent[p.agentName].push({
      section,
      modelName: normalizeLocalModelName(p.modelName),
      role: p.role,
    });
  }
  if (Object.keys(byAgent).length === 0) return 0;

  let changed = 0;
  for (const [agentName, entries] of Object.entries(byAgent)) {
    const section = entries[0].section;

    // Only keep the highest-scored local model per agent
    let bestEntry = entries[0];
    let bestScore = -1;
    for (const e of entries) {
      const m = allLocalModels.find((x) => x.name === e.modelName);
      const s = m ? m.score : 0;
      if (s > bestScore) {
        bestScore = s;
        bestEntry = e;
      }
    }

    const localRef = modelRef(LOCAL_PROVIDER, bestEntry.modelName);
    const existingFbs = Array.isArray(section.fallback_models)
      ? section.fallback_models
          .map((fb) => (typeof fb === "string" ? fb : fb.model))
          .filter(Boolean)
      : [];
    const cleaned = existingFbs.filter(
      (fb) => !fb.startsWith("local/") && !fb.startsWith("ollama/"),
    );

    if (bestEntry.role === "primary") {
      const previousPrimary =
        section.model &&
        !section.model.startsWith("local/") &&
        !section.model.startsWith("ollama/")
          ? section.model
          : null;
      section.model = localRef;
      const fallbacks = previousPrimary
        ? [previousPrimary, ...cleaned]
        : cleaned;
      section.fallback_models = [...new Set(fallbacks)];
      if (section.fallback_models.length === 0) delete section.fallback_models;
      changed++;
      console.log(`  \u2713 ${agentName}: local primary set to ${localRef}`);
    } else if (
      section.model &&
      !section.model.startsWith("local/") &&
      !section.model.startsWith("ollama/")
    ) {
      // Has cloud primary — add only the best local model as a fallback
      section.fallback_models = [...new Set([...cleaned, localRef])];
      changed++;
      console.log(`  \u2713 ${agentName}: local fallback set to ${localRef}`);
    } else {
      // No existing cloud model, or already local — set the best model as primary
      section.model = `local/${normalizeLocalModelName(bestEntry.modelName)}`;
      if (section.fallback_models) delete section.fallback_models;
      if (section.routing) delete section.routing;
      changed++;
      console.log(
        `  \u2713 ${agentName}: placed local/${normalizeLocalModelName(bestEntry.modelName)}`,
      );
    }
  }
  return changed;
}

/**
 * Install and uninstall local models based on AI decisions.
 * Normalizes decision names, filters into install/remove/keep sets,
 * prompts for confirmation (unless autoYes), pulls/uninstalls via ollama.
 * Returns a Set of model names confirmed present after install phase.
 */
export async function installAndUninstallModels(
  decisions,
  ollama,
  autoYes,
  noInstall = false,
  noUninstall = false,
) {
  if (!decisions) return new Set();
  const normalizedDecisions = decisions
    .map((d) => ({ ...d, name: normalizeLocalModelName(d.name) }))
    .filter((d) => d.name);
  const installedNames = installedLocalNameSet(ollama);
  const toInstall = normalizedDecisions.filter((d) => d.action === "install");
  const toRemove = normalizedDecisions.filter((d) => d.action === "uninstall");
  const toKeep = normalizedDecisions.filter((d) => d.action === "keep");

  // Return set of model names confirmed present after install phase
  const confirmed = new Set(
    toKeep.filter((d) => installedNames.has(d.name)).map((d) => d.name),
  );

  for (const d of toInstall) {
    const alreadyInstalled = installedNames.has(d.name);
    if (alreadyInstalled) {
      console.log(`  \u2713 ${d.name} already installed`);
      confirmed.add(d.name);
      continue;
    }
    if (noInstall) {
      console.log(`  \u2192 skipped installation of ${d.name} via --no-install`);
      continue;
    }
    if (autoYes) {
      console.log(`  \u2192 Pulling ${d.name}...`);
      if (pullModel(d.name)) {
        console.log(`  \u2713 ${d.name} pulled`);
        confirmed.add(d.name);
      } else {
        console.log(
          `  \u2192 Config will NOT include placement for ${d.name}\n`,
        );
      }
    } else {
      const ok = await confirm(`  Install ${d.name}? [y/N] `);
      if (ok) {
        console.log(`  \u2192 Pulling ${d.name}...`);
        if (pullModel(d.name)) {
          console.log(`  \u2713 ${d.name} pulled`);
          confirmed.add(d.name);
        } else {
          console.log(
            `  \u2192 Config will NOT include placement for ${d.name}\n`,
          );
        }
      } else {
        console.log(`  \u2192 Skipped`);
      }
    }
  }

  for (const d of toRemove) {
    const isInstalled = installedNames.has(d.name);
    if (!isInstalled) {
      continue;
    }
    if (noUninstall) {
      console.log(`  \u2192 skipped uninstall of ${d.name} via --no-uninstall`);
      continue;
    }
    if (autoYes) {
      try {
        execFileSync("ollama", ["rm", d.name], {
          stdio: "inherit",
          timeout: 60000,
        });
        console.log(`  \u2713 ${d.name} removed`);
      } catch (e) {
        console.error(`  \u2716 Failed to remove ${d.name}: ${e.message}`);
      }
    } else {
      const ok = await confirm(`  Uninstall ${d.name}? [y/N] `);
      if (ok) {
        try {
          execFileSync("ollama", ["rm", d.name], {
            stdio: "inherit",
            timeout: 60000,
          });
          console.log(`  \u2713 ${d.name} removed`);
        } catch (e) {
          console.error(`  \u2716 Failed to remove ${d.name}: ${e.message}`);
        }
      } else {
        console.log(`  \u2192 Skipped`);
      }
    }
  }

  return confirmed;
}

/**
 * Offer to uninstall orphan models — models installed locally but never
 * mentioned in AI decisions (never considered for keep/install/uninstall).
 * Lists orphans, prompts for confirmation (unless autoYes), removes via ollama rm.
 */
export async function offerUninstallOrphans(
  decisions,
  ollama,
  autoYes,
  noRemoveOrphans = false,
) {
  // Models the AI evaluated (any decision = considered)
  const considered = new Set((decisions || []).map((d) => d.name));
  // Installed models the AI never mentioned
  const orphans = ollama.models.filter((m) => !considered.has(m.name));

  if (orphans.length === 0) return;
  if (noRemoveOrphans) {
    console.log(`  \u2192 skipped orphan removal via --no-remove-orphans`);
    return;
  }

  console.log(
    `\n\u2500\u2500 Unnecessary models (${orphans.length}) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`,
  );
  console.log(`  Installed but AI never recommended keeping:`);
  for (const m of orphans) {
    console.log(`  \u2022 ${m.name}  (${m.size})`);
  }
  console.log("");

  if (autoYes) {
    for (const m of orphans) {
      try {
        execFileSync("ollama", ["rm", m.name], {
          stdio: "inherit",
          timeout: 60000,
        });
        console.log(`  \u2713 ${m.name} removed`);
      } catch (e) {
        console.error(`  \u2716 Failed to remove ${m.name}: ${e.message}`);
      }
    }
    return;
  }

  const ok = await confirm(
    `Remove these ${orphans.length} model(s) to free disk space? (y/N) `,
  );
  if (!ok) {
    console.log("  \u2192 Skipped\n");
    return;
  }
  for (const m of orphans) {
    try {
      execFileSync("ollama", ["rm", m.name], {
        stdio: "inherit",
        timeout: 60000,
      });
      console.log(`  \u2713 ${m.name} removed`);
    } catch (e) {
      console.error(`  \u2716 Failed to remove ${m.name}: ${e.message}`);
    }
  }
}

/**
 * Returns a Set of normalized installed local model names from ollama.models.
 */
export function installedLocalNameSet(ollama) {
  return new Set(
    (ollama.models || []).map((m) => normalizeLocalModelName(m.name)),
  );
}

/**
 * Plain-text confirm prompt (no TTY/clack wrapper).
 * Used by extracted functions that need interactive confirmation.
 */
export async function confirm(question) {
  if (isStdinEnded()) {
    return false;
  }
  process.stdout.write(question);
  const answer = await readLineFromStdin();
  return answer.toLowerCase().trim() === "y";
}

let stdinBuffer = [];
let stdinWaiters = [];
let stdinInitialized = false;

function initStdin() {
  if (stdinInitialized) return;
  stdinInitialized = true;
  process.stdin.setEncoding("utf-8");
  process.stdin.resume();

  let currentLine = "";
  process.stdin.on("data", (chunk) => {
    currentLine += chunk;
    let idx;
    while ((idx = currentLine.indexOf("\n")) !== -1) {
      const line = currentLine.slice(0, idx);
      currentLine = currentLine.slice(idx + 1);
      if (stdinWaiters.length > 0) {
        const resolve = stdinWaiters.shift();
        resolve(line);
      } else {
        stdinBuffer.push(line);
      }
    }
  });

  process.stdin.on("end", () => {
    if (currentLine) {
      if (stdinWaiters.length > 0) {
        const resolve = stdinWaiters.shift();
        resolve(currentLine);
      } else {
        stdinBuffer.push(currentLine);
      }
      currentLine = "";
    }
    while (stdinWaiters.length > 0) {
      const resolve = stdinWaiters.shift();
      resolve("");
    }
  });
}

function isStdinEnded() {
  return (
    process.stdin.readableEnded ||
    !process.stdin.readable ||
    Boolean(process.stdin._readableState && process.stdin._readableState.ended)
  );
}

function readLineFromStdin() {
  initStdin();
  if (stdinBuffer.length > 0) {
    return Promise.resolve(stdinBuffer.shift());
  }
  if (isStdinEnded()) {
    return Promise.resolve("");
  }
  return new Promise((resolve) => {
    stdinWaiters.push(resolve);
  });
}