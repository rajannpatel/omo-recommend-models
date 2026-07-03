import fs from "node:fs";

import { LOCAL_PROVIDER } from "../constants.js";
import { getConfigPath } from "../omo-shared.js";
import { completeAiRecommendations } from "../recommend/recommendation-finalizer.js";
import { createRuleBasedRecommendations } from "../recommend/rules-assignment.js";
import { isProviderAvailable } from "../probe-providers.js";

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
  inputs,
  parsedArgs,
  runOptions,
  runtime,
}) {
  const contexts = recommendationContexts(inputs);
  try {
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
