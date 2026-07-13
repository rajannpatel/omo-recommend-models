import { normalizeLocalModelName } from "../omo-shared.js";
import { execFileSyncWithVerbose } from "../subprocess.js";
import { pullModel } from "./pull.js";
import { confirm, confirmDefaultYes, promptLine } from "./prompts.js";

export function installedLocalNameSet(ollama) {
  return new Set((ollama.models || []).map((model) => normalizeLocalModelName(model.name)));
}

export async function resolveInstallDecisions({
  decisions,
  ollama,
  autoYes,
  noInstall = false,
  dryRun = false,
  configPath,
  ctx = null,
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
      ? await chooseInstallMode(configPath)
      : "per-model";

  for (const decision of toInstall) {
    await handleInstallDecision({
      autoYes,
      confirmed,
      decision,
      dryRun,
      installMode,
      installedNames,
      noInstall,
      ctx,
    });
  }
  return confirmed;
}

export async function uninstallModelsFromDecisions({
  decisions,
  ollama,
  autoYes,
  noUninstall = false,
  ctx = null,
}) {
  if (!decisions) return;
  const installedNames = installedLocalNameSet(ollama);
  const toRemove = normalizeDecisions(decisions).filter((decision) => decision.action === "uninstall");
  for (const decision of toRemove) {
    if (!installedNames.has(decision.name)) continue;
    if (noUninstall) {
      console.log(`│  \u2192 skipped uninstall of ${decision.name} via --no-uninstall`);
      continue;
    }
    if (autoYes || await confirm(`│  Uninstall ${decision.name}? [y/N] `)) {
      await removeModel(decision.name, ctx);
    } else {
      console.log("│  \u2192 Skipped");
    }
  }
}

export async function offerUninstallOrphans(
  decisions,
  ollama,
  autoYes,
  noRemoveOrphans = false,
  ctx = null,
) {
  const considered = new Set((decisions || []).map((decision) => decision.name));
  const orphans = ollama.models.filter((model) => !considered.has(model.name));
  if (orphans.length === 0) return;
  if (noRemoveOrphans) {
    console.log("│  \u2192 skipped orphan removal via --no-remove-orphans");
    return;
  }

  console.log("│");
  console.log(`◇  Unnecessary models (${orphans.length})`);
  console.log("│  Installed but AI never recommended keeping:");
  for (const model of orphans) console.log(`│  \u2022 ${model.name}  (${model.size})`);
  console.log("│");

  if (!autoYes && !await confirmDefaultYes("Remove local models deemed unnecessary? [Y/n] ")) {
    console.log("│  \u2192 Skipped");
    console.log("│");
    return;
  }
  for (const model of orphans) await removeModel(model.name, ctx);
}

function normalizeDecisions(decisions) {
  return decisions
    .map((decision) => ({ ...decision, name: normalizeLocalModelName(decision.name) }))
    .filter((decision) => decision.name);
}

async function chooseInstallMode(configPath) {
  console.log("│");
  console.log(`◇  Install recommended local models before writing ${configPath}?`);
  console.log("│  1) Yes to all");
  console.log("│  2) Y/N per model");
  console.log("│  3) No to all");
  const answer = (await promptLine("│  Choose 1, 2, or 3 [3]: ")).toLowerCase().trim();
  if (["1", "y", "yes", "all"].includes(answer)) return "all";
  if (["2", "p", "per", "choose"].includes(answer)) return "per-model";
  return "none";
}

async function handleInstallDecision({
  autoYes,
  confirmed,
  decision,
  dryRun,
  installMode,
  installedNames,
  noInstall,
  ctx,
}) {
  if (installedNames.has(decision.name)) {
    console.log(`│  \u2713 ${decision.name} already installed`);
    confirmed.add(decision.name);
    return;
  }
  if (noInstall) {
    console.log(`│  \u2192 skipped installation of ${decision.name} via --no-install`);
    return;
  }
  if (autoYes || installMode === "all") {
    if (dryRun) {
      console.log(`│  → would install ${decision.name}`);
      confirmed.add(decision.name);
      return;
    }
    await pullAndConfirm(decision.name, confirmed, ctx);
    return;
  }
  if (installMode === "none") {
    console.log(`│  \u2192 Skipped ${decision.name}`);
    return;
  }
  if (await confirm(`│  Install ${decision.name}? [y/N] `)) {
    if (dryRun) {
      console.log(`│  → would install ${decision.name}`);
      confirmed.add(decision.name);
      return;
    }
    await pullAndConfirm(decision.name, confirmed, ctx);
  } else {
    console.log("│  \u2192 Skipped");
  }
}

async function pullAndConfirm(name, confirmed, ctx) {
  console.log(`│  \u2192 Pulling ${name}...`);
  if (pullModel(name, ctx)) {
    console.log(`│  \u2713 ${name} pulled`);
    confirmed.add(name);
  } else {
    console.log(`│  \u2192 Config will NOT include placement for ${name}`);
    console.log("│");
  }
}

async function removeModel(name, ctx) {
  try {
    execFileSyncWithVerbose(ctx, "ollama", ["rm", name], {
      stdio: "inherit",
      timeout: 60000,
    });
    console.log(`│  \u2713 ${name} removed`);
  } catch (error) {
    console.error(`│  \u2716 Failed to remove ${name}: ${error.message}`);
  }
}
