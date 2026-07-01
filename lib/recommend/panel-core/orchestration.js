import os from "node:os";
import {
  createProgress,
  printNumberedPanelModelGroups,
} from "../../display-utils.js";
import { isProviderAvailable, probeModel } from "../../probe-providers.js";
import { LOCAL_PROVIDER } from "../../constants.js";
import { allConfigEntries, computeConsensus } from "../../consensus.js";
import { scoreModel } from "../../scoring.js";
import {
  filterPanelModelsForContext,
  hasEnoughContextForPanel,
  isCliProvider,
} from "../panel-candidates.js";
import {
  discoverCliModels as discoverCliModelsFromAgents,
} from "../cli-agents.js";
import {
  buildAgentPrompt,
} from "./prompt.js";
import {
  callModelForAgent,
  findCliAgent,
} from "./calls.js";
import {
  commandExists,
  runPool,
} from "./platform.js";
import {
  createPanelStatus,
  printFinalStatus,
  printInitialStatus,
  updateStatus,
} from "./status.js";

async function verifiedModels(models, cliAgents, ctx, label) {
  const progress = createProgress(label);
  let probeResults = [];
  try {
    probeResults = await Promise.all(models.map(async (model) => {
      const cliAgent = findCliAgent(cliAgents, model);
      return cliAgent ? await cliAgent.probe() : probeModel(ctx, model);
    }));
    progress?.done(`${probeResults.filter((result) => result.ok).length} of ${models.length} model(s) available`);
  } catch (err) {
    progress?.done(`error verifying availability: ${err.message}`);
    probeResults = models.map(() => ({ ok: true }));
  }
  return {
    availableModels: models.filter((_model, index) => probeResults[index].ok),
    probeResults,
  };
}

function printFailedModelDetails(models, probeResults) {
  console.log("\nFailed model details / errors:");
  for (let index = 0; index < models.length; index++) {
    const model = models[index];
    const result = probeResults[index] || {
      ok: false,
      reason: "unknown error",
      errorOutput: "No output",
    };
    const errSnippet = result.errorOutput
      ? result.errorOutput.split("\n")[0]
      : "unknown error";
    console.log(`  • ${model}: ${result.reason} (${errSnippet})`);
  }
}

function availableCloudBackfills(models, availableModels, cloudLookup, ctx) {
  const cloudModels = [];
  for (const [provider, modelMap] of Object.entries(cloudLookup.byId || {})) {
    if (provider === LOCAL_PROVIDER || provider === "opencode") continue;
    if (!isProviderAvailable(ctx, provider)) continue;
    for (const [modelId, meta] of modelMap.entries()) {
      const ref = `${provider}/${modelId}`;
      if (!hasEnoughContextForPanel(ref, cloudLookup)) continue;
      if (!availableModels.includes(ref) && !models.includes(ref)) {
        cloudModels.push({ ref, score: scoreModel(ref, null, meta) });
      }
    }
  }
  return cloudModels.sort((a, b) => b.score - a.score);
}

function backfillFailedCliAgents(models, availableModels, probeResults, cloudLookup, ctx) {
  const failedCliAgents = models
    .map((model, index) => ({ model, result: probeResults[index] }))
    .filter(({ model, result }) => isCliProvider(model.split("/")[0]) && !result.ok)
    .map(({ model }) => model);
  const cloudModels = availableCloudBackfills(models, availableModels, cloudLookup, ctx);
  for (const failedCli of failedCliAgents) {
    if (cloudModels.length === 0) break;
    const backfill = cloudModels.shift();
    availableModels.push(backfill.ref);
    console.log(`  \u2192 Backfilling failed CLI agent ${failedCli} with ${backfill.ref}`);
  }
}

async function resolveAvailablePanelModels({
  models,
  cliAgents,
  cloudLookup,
  config,
  cliOptions,
  ctx,
  defaultPanelModelsFn,
}) {
  let verified = await verifiedModels(models, cliAgents, ctx, "Verifying panel models availability");
  if (verified.availableModels.length === 0) {
    console.log("\n\u26A0 No panel models are available (all are quota-restricted or rate-limited). Limiting analysis and recommendations to opencode AI models exclusively.");
    ctx.opencodeOnlyMode = true;
    printFailedModelDetails(models, verified.probeResults);
    console.log("\nFalling back to free opencode models...");
    const freeModels = defaultPanelModelsFn(config, cloudLookup, cliOptions);
    if (freeModels.length === 0) throw new Error("No free models available");
    verified = await verifiedModels(freeModels, cliAgents, ctx, "Verifying free models availability");
    if (verified.availableModels.length === 0) {
      throw new Error("No available free models found");
    }
    models = freeModels;
  }
  backfillFailedCliAgents(
    models,
    verified.availableModels,
    verified.probeResults,
    cloudLookup,
    ctx,
  );
  return verified.availableModels;
}

function buildPanelTasks({ agents, models, panelStatus, cloudLookup, allLocalModels, gpu, ollama, ctx, subprocess, cliAgents }) {
  const tasks = [];
  for (let agentIndex = 0; agentIndex < agents.length; agentIndex++) {
    const entry = agents[agentIndex];
    const stateEntry = panelStatus.state[agentIndex];
    for (const model of models) {
      tasks.push(async () => {
        const modelLabel = model.startsWith("cli/") ? model : model.split("/").pop();
        panelStatus.currentAgent = `${entry.name} with ${modelLabel}`;
        panelStatus.tasksStarted++;
        if (!process.stdout.isTTY) console.log(`evaluating ${panelStatus.currentAgent}`);
        updateStatus(panelStatus, agents, models);
        const rec = await callModelForAgent(
          model,
          buildAgentPrompt(entry, cloudLookup, allLocalModels, gpu, ollama, ctx),
          ctx.signal,
          {},
          cliAgents,
          entry.name,
          3,
          ctx,
          subprocess,
        );
        if (rec) {
          panelStatus.modelSuccessCounts.set(model, (panelStatus.modelSuccessCounts.get(model) || 0) + 1);
        }
        stateEntry.results.push(rec ? { model, recommendation: rec } : null);
        panelStatus.tasksDone++;
        if (stateEntry.results.length === models.length) panelStatus.agentsDone++;
        updateStatus(panelStatus, agents, models);
      });
    }
  }
  return tasks;
}

export async function runPanelAndSelect(
  config,
  cloudLookup,
  allLocalModels,
  gpu,
  ollama,
  cloudOnlyFlag,
  panelModels,
  cliOptions = {},
  ctx,
  subprocess,
  defaultPanelModelsFn,
) {
  void cloudOnlyFlag;
  const cliAgents = discoverCliModelsFromAgents(config, cliOptions, ctx, commandExists, subprocess);
  let models = panelModels?.length > 0
    ? filterPanelModelsForContext(panelModels, cloudLookup)
    : defaultPanelModelsFn(config, cloudLookup, cliOptions);
  if (models.length === 0) models = defaultPanelModelsFn(config, cloudLookup, cliOptions);
  if (models.length === 0) throw new Error("No free models available");
  models = await resolveAvailablePanelModels({
    models,
    cliAgents,
    cloudLookup,
    config,
    cliOptions,
    ctx,
    defaultPanelModelsFn,
  });

  console.log("\nThis run would query:");
  printNumberedPanelModelGroups(models, "  ");
  console.log();

  const agents = allConfigEntries(config);
  if (agents.length === 0) throw new Error("No agents or categories in config");
  const panelStatus = createPanelStatus(agents, models);
  printInitialStatus(agents, models, panelStatus);
  updateStatus(panelStatus, agents, models);

  await runPool(
    buildPanelTasks({ agents, models, panelStatus, cloudLookup, allLocalModels, gpu, ollama, ctx, subprocess, cliAgents }),
    Math.max(1, os.cpus().length),
  );
  for (const entry of panelStatus.state) entry.done = true;
  panelStatus.currentAgent = "";
  updateStatus(panelStatus, agents, models);
  printFinalStatus(panelStatus, agents, models);
  process.stdout.write("\n");

  const consensusResult = computeConsensus(
    panelStatus.state,
    agents,
    models,
    ctx,
    isProviderAvailable,
  );
  return {
    selected: {
      recommender: consensusResult.recommender,
      analysis: consensusResult.analysis,
      cloudRecommendations: consensusResult.cloudRecommendations,
      localModels: { decisions: [], placements: [] },
    },
    panel: { state: panelStatus.state, models },
  };
}
