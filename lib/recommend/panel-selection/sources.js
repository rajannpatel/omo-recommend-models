import { MAX_PANEL_MODELS } from "../../constants.js";
import {
  configuredPanelModels,
  createProgress,
  printNumberedPanelModelGroups,
} from "../../display-utils.js";

async function workingCliAgents(env) {
  const cliAgents = env.discoverCliModels(env.config, env.cliOptions);
  if (cliAgents.length === 0) return [];
  const progress = createProgress("Verifying CLI agents availability");
  const results = await Promise.all(
    cliAgents.map(async (agent) => ({ agent, ok: (await agent.probe()).ok })),
  );
  const working = [];
  for (const { agent, ok } of results) {
    if (ok) working.push(agent);
    else console.log(`  \u2192 CLI agent ${agent.ref} failed probe, excluding from AI Panel`);
  }
  progress.done(`${working.length} of ${cliAgents.length} CLI agent(s) available`);
  return working;
}

function printInteractiveSources(workingCli, availablePaid, freeModels) {
  console.log("\nYou will have a chance to influence which AI providers will be involved in performing your AI Model analysis.");
  console.log("You will be able to choose from:");
  console.log("  1.) Local AI CLI agents (installed on your system)");
  console.log("  2.) AI providers connected to opencode via 'opencode auth login'");
  console.log("  3.) Free AI models available through opencode\n");
  if (workingCli.length > 0) {
    console.log("  Local AI CLI agents available:");
    for (const agent of workingCli) {
      console.log(`    \u2022 ${agent.ref}${agent.panelModel ? ` (model: ${agent.panelModel})` : ""}`);
    }
    console.log("");
  }
  if (availablePaid.length > 0) {
    console.log("  AI providers connected to opencode:");
    printNumberedPanelModelGroups(availablePaid, "    ");
    console.log("");
  }
  if (freeModels.length > 0) {
    console.log("  Free opencode models:");
    printNumberedPanelModelGroups(freeModels, "    ");
    console.log("");
  }
}

function selectedSourceModels(choices, workingCli, availablePaid, freeModels) {
  const selected = [];
  const all = choices.includes("a") || choices.length === 0 ||
    (choices.includes("1") && choices.includes("2") && choices.includes("3"));
  if (all || choices.includes("1")) selected.push(...workingCli.map((agent) => agent.ref));
  if (all || choices.includes("2")) selected.push(...availablePaid);
  if (all || choices.includes("3")) selected.push(...freeModels);
  return selected;
}

function choicesSelectedFree(choices) {
  return choices.includes("3") ||
    choices.includes("a") ||
    choices.length === 0 ||
    (choices.includes("1") && choices.includes("2") && choices.includes("3"));
}

async function applyFreeModelChoice(env, state, choices, freeModels, panelModels) {
  if (!choicesSelectedFree(choices) || freeModels.length === 0) return panelModels;
  console.log("\n\uD83D\uDD0D Free models detected: " + freeModels.join(", "));
  let includeInPanel = true;
  if (env.parsedArgs._noFreePanelExplicit) includeInPanel = false;
  else if (env.parsedArgs._freePanelExplicit) includeInPanel = true;
  else includeInPanel = await env.confirm("Include free models in the AI Panel analysis? (Y/n) ");
  let includeInConfig = !state.excludeFreeFromConfig;
  if (!state.excludeFreeExplicit && !state.freeConfigExplicit &&
      !state.noFreeConfigExplicit && !state.noExcludeFreeExplicit) {
    includeInConfig = await env.confirm("Include free models in the JSONC configuration file? (Y/n) ");
  }
  const freeRefs = freeModels.filter((ref) => panelModels?.includes(ref));
  if (!includeInPanel) {
    panelModels = panelModels?.filter((ref) => !freeRefs.includes(ref)) || null;
    console.log(`  \u2192 Free models excluded from AI Panel analysis`);
  }
  state.excludeFreeFromConfig = !includeInConfig;
  console.log(includeInConfig
    ? `  \u2192 Free models will be included in JSONC configuration`
    : `  \u2192 Free models will be excluded from JSONC configuration`);
  return panelModels;
}

async function chooseInteractiveModels(env, state) {
  await env.ensureProbesAwaited();
  const availablePaid = await env.getAvailablePaid();
  const freeModels = env.discoverFreeModels(env.cliOptions);
  const cliAgents = await workingCliAgents(env);
  printInteractiveSources(cliAgents, availablePaid, freeModels);
  const options = [];
  if (cliAgents.length > 0) options.push({ label: "1", description: "Local AI CLI agents only" });
  if (availablePaid.length > 0) options.push({ label: "2", description: "Connected opencode providers (paid/cloud)" });
  if (freeModels.length > 0) options.push({ label: "3", description: "Free opencode models" });
  options.push({ label: "a", description: "All of the above (default)" });
  console.log("Options:");
  for (const opt of options) console.log(`  [${opt.label}] ${opt.description}`);
  const answer = await env.promptUser("\nChoose source(s) for AI Panel (e.g. 1,2 or 'a' for all): ");
  const choices = answer.trim().toLowerCase().split(",").map((part) => part.trim()).filter(Boolean);
  const selected = selectedSourceModels(choices, cliAgents, availablePaid, freeModels);
  let panelModels = selected.length > 0
    ? env.includeDetectedCliPanelModels(
        env.filterPanelModelsForContext(selected, env.cloudLookup),
        env.config,
        env.cliOptions,
      )
    : null;
  if (panelModels) {
    console.log(`  \u2713 Using ${panelModels.length} selected model(s)\n`);
    env.printCliPanelDisclosure(panelModels, "Selected");
  }
  return applyFreeModelChoice(env, state, choices, freeModels, panelModels);
}

export async function resolvePanelModels(env, state) {
  if (env.explicitModels.length > 0) {
    const panelModels = env.includeDetectedCliPanelModels(
      env.filterPanelModelsForContext(env.explicitModels, env.cloudLookup),
      env.config,
      env.cliOptions,
    );
    console.log(`  \u2713 Using ${panelModels.length} explicitly selected model(s): ${panelModels.join(", ")}\n`);
    env.printCliPanelDisclosure(panelModels, "Explicit");
    return panelModels;
  }
  if (!env.autoYes && !env.dryRun && !env.localOnlyFlag) {
    const selected = await chooseInteractiveModels(env, state);
    if (selected) return selected;
  }
  const configured = configuredPanelModels(env.config);
  if (configured.length > 0) {
    const panelModels = env.includeDetectedCliPanelModels(
      env.filterPanelModelsForContext(configured, env.cloudLookup),
      env.config,
      env.cliOptions,
    );
    console.log(`  \u2713 Using ${panelModels.length} configured panel model(s): ${panelModels.join(", ")}\n`);
    env.printCliPanelDisclosure(panelModels, "Configured");
    return panelModels;
  }
  await env.ensureProbesAwaited();
  const availablePaid = await env.getAvailablePaid();
  if (availablePaid.length > 0 && !env.localOnlyFlag) {
    return env.selectPreferredPanelModels(
      availablePaid,
      env.config,
      env.cloudLookup,
      MAX_PANEL_MODELS,
      env.cliOptions,
    );
  }
  env.ctx.opencodeOnlyMode = true;
  return env.defaultPanelModels(env.config, env.cloudLookup, env.cliOptions);
}
