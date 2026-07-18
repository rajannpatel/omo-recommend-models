import fs from "node:fs";

import { LOCAL_PROVIDER } from "../constants.js";
import { getConfigPath, loadCatalogFromFiles } from "../omo-shared.js";
import { completeAiRecommendations } from "../recommend/recommendation-finalizer.js";
import { rankFallbacksByFitness } from "../recommend/fitness-ranking.js";
import { createRuleBasedRecommendations } from "../recommend/rules-assignment.js";
import { isProviderAvailable } from "../probe-providers.js";

import { isFreeModelRef } from "../shared/provider-cache.js";

function createModelAllowedPredicate(allowedPaidModels, rejectedPaidModels, excludeModels = [], excludeFree = false) {
  const catalog = loadCatalogFromFiles();
  const excluded = new Set((excludeModels || []).map(m => String(m).trim().toLowerCase()));
  return ({ provider, model }) => {
    if (!provider || !model) return false;

    // Check manual exclusions
    if (excluded.has(provider.toLowerCase())) return false;
    if (excluded.has(`${provider.toLowerCase()}/${model.toLowerCase()}`)) return false;

    // Check if the model has toolcall capability in the catalog
    if (catalog && catalog[provider]?.models?.[model]) {
      const modelData = catalog[provider].models[model];
      if (modelData.capabilities && modelData.capabilities.toolcall !== true) {
        return false;
      }
    }

    if (
      provider === LOCAL_PROVIDER ||
      provider === "ollama" ||
      provider.startsWith("cli/")
    ) {
      return true;
    }

    if (isFreeModelRef(provider, model)) {
      return !excludeFree;
    }

    const ref = `${provider}/${model}`;
    return allowedPaidModels.has(ref) && !rejectedPaidModels.has(ref);
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

async function finalizeRecommendation({
  allowedPaidModels,
  cloudLookup,
  config,
  contexts,
  ctx,
  isModelAllowed,
  localRecommendationContext,
  result,
  parsedArgs,
}) {
  const completed = completeAiRecommendations(
    result,
    config,
    cloudLookup,
    contexts.localCtx,
    contexts.gpuCtx,
    contexts.ollamaCtx,
    (provider) => {
      const excluded = new Set((parsedArgs?.["exclude-model"] || []).map(m => String(m).trim().toLowerCase()));
      if (excluded.has(provider.toLowerCase())) return false;
      return isProviderAvailable(ctx, provider);
    },
    localRecommendationContext,
    isModelAllowed,
  );

  if (completed.cloudRecommendations) {
    await rankFallbacksByFitness(
      completed.cloudRecommendations,
      cloudLookup,
      parsedArgs,
      config,
      ctx,
      isModelAllowed,
      allowedPaidModels,
    );
  }

  return completed;
}

export async function selectRecommendation({
  inputs,
  parsedArgs,
  _runOptions,
  runtime,
}) {
  const contexts = recommendationContexts(inputs);
  try {
    await inputs.paidProviderPrep.ensureProbesAwaited();
    const allowedPaidModelOrder = await (
      inputs.paidProviderPrep.paidProbesPromise || Promise.resolve([])
    );
    const allowedPaidModels = new Set(allowedPaidModelOrder);
    const rejectedPaidModels = await rejectedPaidModelSet(inputs.paidProviderPrep);
    const isModelAllowed = createModelAllowedPredicate(
      allowedPaidModels,
      rejectedPaidModels,
      parsedArgs["exclude-model"] || [],
      inputs.excludeFreeFromConfig
    );
    return {
      aiResult: await finalizeRecommendation({
        ...inputs,
        allowedPaidModels: allowedPaidModelOrder,
        contexts,
        ctx: runtime.ctx,
        isModelAllowed,
        result: createRuleBasedRecommendations({
          config: inputs.config,
          cloudLookup: inputs.cloudLookup,
          excludeModels: parsedArgs["exclude-model"],
          isProviderAllowed: (provider) => {
            const excluded = new Set((parsedArgs["exclude-model"] || []).map(m => String(m).trim().toLowerCase()));
            if (excluded.has(provider.toLowerCase())) return false;
            return isProviderAvailable(runtime.ctx, provider);
          },
          isModelAllowed,
        }),
        parsedArgs,
      }),
      excludeFreeFromConfig: inputs.excludeFreeFromConfig,
    };
  } catch (error) {
    handleRecommendationFailure(error, inputs.config);
    return null;
  }
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
