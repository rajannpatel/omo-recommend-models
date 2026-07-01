import fs from "node:fs";

import { LOCAL_PROVIDER } from "../constants.js";
import { getConfigPath } from "../omo-shared.js";
import { completeAiRecommendations } from "../recommend/recommendation-finalizer.js";
import { createRuleBasedRecommendations } from "../recommend/rules-assignment.js";
import { selectPanelRecommendation } from "../recommend/panel-selection.js";
import { runPanelAndSelect } from "../recommend/panel-core.js";
import { isProviderAvailable } from "../probe-providers.js";
import {
  filterPanelModelsForContext,
  printCliPanelDisclosure,
} from "../recommend/panel-candidates.js";
import {
  discoverCliModels as discoverCliModelsImpl,
  includeDetectedCliPanelModels as includeDetectedCliPanelModelsImpl,
  selectPreferredPanelModels as selectPreferredPanelModelsImpl,
} from "../recommend/cli-agents.js";

function createModelAllowedPredicate(rejectedPaidModels) {
  return ({ provider, model }) => {
    if (!provider || !model) return false;
    if (
      provider === LOCAL_PROVIDER ||
      provider === "ollama" ||
      provider.startsWith("cli/")
    ) {
      return true;
    }
    return !rejectedPaidModels.has(`${provider}/${model}`);
  };
}

async function rejectedPaidModelSet(paidProviderPrep) {
  return new Set(
    await (paidProviderPrep.rejectedPaidModelsPromise || Promise.resolve([])),
  );
}

function recommendationContexts({
  allLocalModels,
  cloudOnlyFlag,
  gpu,
  ollama,
}) {
  return {
    localCtx: cloudOnlyFlag ? [] : allLocalModels,
    gpuCtx: cloudOnlyFlag
      ? {
          hasGpu: false,
          name: "",
          label: "Not checked (--cloud-only)",
          vramGb: 0,
        }
      : gpu,
    ollamaCtx: cloudOnlyFlag
      ? { installed: false, running: false, version: null, models: [] }
      : ollama,
  };
}

function finalizeRecommendation({
  cloudLookup,
  config,
  contexts,
  ctx,
  isModelAllowed,
  localRecommendationContext,
  result,
}) {
  return completeAiRecommendations(
    result,
    config,
    cloudLookup,
    contexts.localCtx,
    contexts.gpuCtx,
    contexts.ollamaCtx,
    (provider) => isProviderAvailable(ctx, provider),
    localRecommendationContext,
    isModelAllowed,
  );
}

export async function selectRecommendation({
  commandExists,
  defaultPanelModels,
  discoverFreeModels,
  inputs,
  parsedArgs,
  runOptions,
  runtime,
}) {
  const contexts = recommendationContexts(inputs);
  try {
    if (!runOptions.useAiPanel) {
      await inputs.paidProviderPrep.ensureProbesAwaited();
      const rejectedPaidModels = await rejectedPaidModelSet(inputs.paidProviderPrep);
      const isModelAllowed = createModelAllowedPredicate(rejectedPaidModels);
      return {
        aiResult: finalizeRecommendation({
          ...inputs,
          contexts,
          ctx: runtime.ctx,
          isModelAllowed,
          result: createRuleBasedRecommendations({
            config: inputs.config,
            cloudLookup: inputs.cloudLookup,
            excludeModels: parsedArgs["exclude-model"],
            isProviderAllowed: (provider) => isProviderAvailable(runtime.ctx, provider),
            isModelAllowed,
          }),
        }),
        excludeFreeFromConfig: inputs.excludeFreeFromConfig,
      };
    }
    return selectPanel({
      commandExists,
      contexts,
      defaultPanelModels,
      discoverFreeModels,
      inputs,
      parsedArgs,
      runOptions,
      runtime,
    });
  } catch (error) {
    handleRecommendationFailure(error, inputs.config);
    return null;
  }
}

async function selectPanel({
  commandExists,
  contexts,
  defaultPanelModels,
  discoverFreeModels,
  inputs,
  parsedArgs,
  runOptions,
  runtime,
}) {
  const discoverCliModels = (config, options) =>
    discoverCliModelsImpl(config, options, runtime.ctx, commandExists, runtime.subprocess);
  let isModelAllowed = createModelAllowedPredicate(new Set());
  const ensureProbesAwaited = async () => {
    await inputs.paidProviderPrep.ensureProbesAwaited();
    isModelAllowed = createModelAllowedPredicate(
      await rejectedPaidModelSet(inputs.paidProviderPrep),
    );
  };
  const panelSelection = await selectPanelRecommendation({
    autoYes: runOptions.autoYes,
    cloudLookup: inputs.cloudLookup,
    cloudOnlyFlag: runOptions.cloudOnlyFlag,
    completeAiRecommendations: (result) =>
      finalizeRecommendation({
        ...inputs,
        contexts,
        ctx: runtime.ctx,
        isModelAllowed,
        result,
      }),
    config: inputs.config,
    confirm: runtime.confirm,
    ctx: runtime.ctx,
    defaultPanelModels,
    discoverCliModels,
    discoverFreeModels,
    dryRun: runOptions.dryRun,
    ensureProbesAwaited,
    explicitModels: runOptions.explicitModels,
    filterPanelModelsForContext,
    getAvailablePaid: () => inputs.paidProviderPrep.paidProbesPromise,
    gpuCtx: contexts.gpuCtx,
    includeDetectedCliPanelModels: (models, config, options) =>
      includeDetectedCliPanelModelsImpl(models, config, options, discoverCliModels),
    initialExcludeFreeFromConfig: inputs.excludeFreeFromConfig,
    localCtx: contexts.localCtx,
    localRecommendationContext: inputs.localRecommendationContext,
    localOnlyFlag: runOptions.localOnlyFlag,
    parsedArgs,
    printCliPanelDisclosure,
    promptUser: runtime.promptUser,
    runPanelAndSelect: (panelModels) =>
      runPanelAndSelect(
        inputs.config,
        inputs.cloudLookup,
        contexts.localCtx,
        contexts.gpuCtx,
        contexts.ollamaCtx,
        runOptions.cloudOnlyFlag,
        panelModels,
        inputs.cliOptions,
        runtime.ctx,
        runtime.subprocess,
        defaultPanelModels,
      ),
    selectPreferredPanelModels: (models, config, cloudLookup, max, options) =>
      selectPreferredPanelModelsImpl(
        models,
        config,
        cloudLookup,
        max,
        options,
        discoverCliModels,
        runtime.ctx,
      ),
    cliOptions: inputs.cliOptions,
  });

  return {
    aiResult: panelSelection.aiResult,
    excludeFreeFromConfig: panelSelection.excludeFreeFromConfig,
  };
}

function handleRecommendationFailure(error, config) {
  console.error(`\n\u2716 AI recommendation failed: ${error.message}`);
  if (fs.existsSync(getConfigPath())) {
    console.log("  Config unchanged.\n");
    return;
  }
  console.log("\n  Writing a minimal valid config skeleton. Re-run when models are available.\n");
  fs.writeFileSync(getConfigPath(), `${JSON.stringify(config, null, 2)}\n`, "utf-8");
  console.log(`  \u2713 Config written to ${getConfigPath()}`);
  console.log("  No backup (new config — no previous file to preserve)\n");
}
