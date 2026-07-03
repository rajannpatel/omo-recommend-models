import {
  buildRichModelLookup,
  loadConfig,
  loadProviderModels,
} from "../omo-shared.js";
import { LOCAL_PROVIDER } from "../constants.js";
import { createProgress } from "../display-utils.js";
import { preparePaidProviderModels } from "../recommend/paid-provider-prep.js";
import { discoverLocalEnvironment } from "../recommend/local-environment.js";
import { buildLocalRecommendationContext } from "../recommend/local-recommendation-context.js";
import { discoverModels as discoverModelsFromRegistry } from "../recommend/ollama-registry.js";
import { detectGPU, detectOllama } from "../recommend/hardware-detection.js";

export function buildRunOptions(parsedArgs) {
  const realTty =
    Boolean(process.stdout.isTTY) &&
    process.env.TERM !== "dumb" &&
    process.env.CI !== "true";
  const dryRunFallback = !parsedArgs.interactive && !realTty && !parsedArgs._explicitYes;
  const dryRun = parsedArgs["dry-run"] || dryRunFallback;

  return {
    autoYes: !dryRun && parsedArgs._explicitYes,
    globalFlag: Boolean(parsedArgs.global),
    cloudOnlyFlag: parsedArgs["exclude-local"],
    dryRun,
    dryRunFallback,
    localOnlyFlag: parsedArgs["exclude-cloud"],
    realTty,
  };
}

export function resolveExcludeFreeFromConfig(parsedArgs) {
  if (parsedArgs._excludeFreeExplicit || parsedArgs._noFreeConfigExplicit) {
    return true;
  }
  if (parsedArgs._noExcludeFreeExplicit || parsedArgs._freeConfigExplicit) {
    return false;
  }
  return false;
}

function attachLocalModels(cloudLookup, localModelNames) {
  if (localModelNames.length === 0) return;
  if (!cloudLookup.sets.local) cloudLookup.sets.local = new Set();
  if (!cloudLookup.byId.local) cloudLookup.byId.local = new Map();
  for (const model of localModelNames) {
    cloudLookup.sets.local.add(model);
    if (!cloudLookup.byId.local.has(model)) cloudLookup.byId.local.set(model, null);
  }
}

function countCloudProviders(cloudLookup) {
  return Object.entries(cloudLookup.byId || {}).filter(
    ([provider, modelMap]) =>
      provider !== LOCAL_PROVIDER && modelMap && modelMap.size > 0,
  ).length;
}

export async function buildRecommendationInputs({
  commandExists,
  ctx,
  parsedArgs,
  runOptions,
  subprocess,
}) {
  const config = loadConfig({ global: runOptions.globalFlag });
  const paidProviderPrep = preparePaidProviderModels({
    config,
    ctx,
    localOnlyFlag: runOptions.localOnlyFlag,
  });
  const localEnvironment = await discoverLocalEnvironment({
    cloudOnlyFlag: runOptions.cloudOnlyFlag,
    detectGPU,
    detectOllama: () => detectOllama(commandExists),
    discoverModels: (forceRefresh, progress) =>
      discoverModelsFromRegistry(
        forceRefresh,
        progress,
        subprocess.fetchUrlAsync.bind(subprocess),
      ),
  });
  const cloudLookup = buildCloudLookup({
    localOnlyFlag: runOptions.localOnlyFlag,
    paidProviderPrep,
  });
  if (!runOptions.cloudOnlyFlag) {
    attachLocalModels(cloudLookup, localEnvironment.localModelNames);
  }

  const excludeFreeFromConfig = resolveExcludeFreeFromConfig(parsedArgs);
  const localRecommendationContext = buildLocalRecommendationContext({
    config,
    gpu: localEnvironment.gpu,
    ollama: localEnvironment.ollama,
    allLocalModels: localEnvironment.allLocalModels,
    cloudLookup,
    cloudOnlyFlag: runOptions.cloudOnlyFlag,
    localOnlyFlag: runOptions.localOnlyFlag,
  });
  ctx.localRecommendationContext = localRecommendationContext;

  return {
    ...localEnvironment,
    cloudLookup,
    cloudProviderCount: countCloudProviders(cloudLookup),
    config,
    excludeFreeFromConfig,
    localRecommendationContext,
    paidProviderPrep,
  };
}

function buildCloudLookup({ localOnlyFlag, paidProviderPrep }) {
  if (localOnlyFlag) {
    createProgress("Loaded").skip("skipped by --local-only");
    return { byId: {}, sets: {} };
  }

  const cloudProgress = createProgress("Loaded", { doneSymbol: "◇" });
  process.stdout.write("◇  Checking live provider models...\r");
  const cache = loadProviderModels();
  const count = cache?.models ? Object.keys(cache.models).length : 0;
  cloudProgress.done(`${count} providers (live from \`opencode models --pure\`)`);

  return buildRichModelLookup(cache);
}
