import { execFileSync } from "node:child_process";

import { normalizeLocalModelName } from "../omo-shared.js";
import { pullModel } from "./pull.js";
import { confirm, promptLine } from "./prompts.js";

export function installedLocalNameSet(ollama) {
  return new Set((ollama.models || []).map((model) => normalizeLocalModelName(model.name)));
}

export async function resolveInstallDecisions({
  decisions,
  ollama,
  autoYes,
  noInstall = false,
}) {
  if (!decisions) return new Set();
  const normalizedDecisions = normalizeDecisions(decisions);
  const installedNames = installedLocalNameSet(ollama);
  const toInstall = normalizedDecisions.filter((decision) => decision.action === "install");
  const confirmed = new Set(
    normalizedDecisions
      .filter((decision) => decision.action === "keep" && installedNames.has(decision.name))
      .map((decision) => decision.name),
  );
  const missingInstalls = toInstall.filter((decision) => !installedNames.has(decision.name));
  const installMode =
    !autoYes && !noInstall && missingInstalls.length > 0
      ? await chooseInstallMode()
      : "per-model";

  for (const decision of toInstall) {
    await handleInstallDecision({
      autoYes,
      confirmed,
      decision,
      installMode,
      installedNames,
      noInstall,
    });
  }
  return confirmed;
}

export async function uninstallModelsFromDecisions({
  decisions,
  ollama,
  autoYes,
  noUninstall = false,
}) {
  if (!decisions) return;
  const installedNames = installedLocalNameSet(ollama);
  const toRemove = normalizeDecisions(decisions).filter((decision) => decision.action === "uninstall");
  for (const decision of toRemove) {
    if (!installedNames.has(decision.name)) continue;
    if (noUninstall) {
      console.log(`  \u2192 skipped uninstall of ${decision.name} via --no-uninstall`);
      continue;
    }
    if (autoYes || await confirm(`  Uninstall ${decision.name}? [y/N] `)) {
      removeModel(decision.name);
    } else {
      console.log("  \u2192 Skipped");
    }
  }
}

export async function installAndUninstallModels(
  decisions,
  ollama,
  autoYes,
  noInstall = false,
  noUninstall = false,
) {
  const confirmed = await resolveInstallDecisions({
    decisions,
    ollama,
    autoYes,
    noInstall,
  });
  await uninstallModelsFromDecisions({
    decisions,
    ollama,
    autoYes,
    noUninstall,
  });
  return confirmed;
}

export async function offerUninstallOrphans(
  decisions,
  ollama,
  autoYes,
  noRemoveOrphans = false,
) {
  const considered = new Set((decisions || []).map((decision) => decision.name));
  const orphans = ollama.models.filter((model) => !considered.has(model.name));
  if (orphans.length === 0) return;
  if (noRemoveOrphans) {
    console.log("  \u2192 skipped orphan removal via --no-remove-orphans");
    return;
  }

  console.log(`\n\u2500\u2500 Unnecessary models (${orphans.length}) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`);
  console.log("  Installed but AI never recommended keeping:");
  for (const model of orphans) console.log(`  \u2022 ${model.name}  (${model.size})`);
  console.log("");

  if (!autoYes && !await confirm(`Remove these ${orphans.length} model(s) to free disk space? (y/N) `)) {
    console.log("  \u2192 Skipped\n");
    return;
  }
  for (const model of orphans) removeModel(model.name);
}

function normalizeDecisions(decisions) {
  return decisions
    .map((decision) => ({ ...decision, name: normalizeLocalModelName(decision.name) }))
    .filter((decision) => decision.name);
}

async function chooseInstallMode() {
  console.log("\nInstall recommended local models before writing JSONC?");
  console.log("  1) Yes to all");
  console.log("  2) Y/N per model");
  console.log("  3) No to all");
  const answer = (await promptLine("Choose 1, 2, or 3 [3]: ")).toLowerCase().trim();
  if (["1", "y", "yes", "all"].includes(answer)) return "all";
  if (["2", "p", "per", "choose"].includes(answer)) return "per-model";
  return "none";
}

async function handleInstallDecision({
  autoYes,
  confirmed,
  decision,
  installMode,
  installedNames,
  noInstall,
}) {
  if (installedNames.has(decision.name)) {
    console.log(`  \u2713 ${decision.name} already installed`);
    confirmed.add(decision.name);
    return;
  }
  if (noInstall) {
    console.log(`  \u2192 skipped installation of ${decision.name} via --no-install`);
    return;
  }
  if (autoYes || installMode === "all") {
    pullAndConfirm(decision.name, confirmed);
    return;
  }
  if (installMode === "none") {
    console.log(`  \u2192 Skipped ${decision.name}`);
    return;
  }
  if (await confirm(`  Install ${decision.name}? [y/N] `)) {
    pullAndConfirm(decision.name, confirmed);
  } else {
    console.log("  \u2192 Skipped");
  }
}

function pullAndConfirm(name, confirmed) {
  console.log(`  \u2192 Pulling ${name}...`);
  if (pullModel(name)) {
    console.log(`  \u2713 ${name} pulled`);
    confirmed.add(name);
  } else {
    console.log(`  \u2192 Config will NOT include placement for ${name}\n`);
  }
}

function removeModel(name) {
  try {
    execFileSync("ollama", ["rm", name], {
      stdio: "inherit",
      timeout: 60000,
    });
    console.log(`  \u2713 ${name} removed`);
  } catch (error) {
    console.error(`  \u2716 Failed to remove ${name}: ${error.message}`);
  }
}
