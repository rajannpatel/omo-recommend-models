import {
  buildRichModelLookup,
  discoverFreeModels,
  loadConfig,
  loadProviderModels,
  splitModelRef,
} from "../omo-shared.js";
import { LOCAL_PROVIDER } from "../constants.js";
import {
  writeGroupLine,
  writeTopLevelLine,
} from "../display-utils.js";
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
  if (parsedArgs._noFreeConfigExplicit) {
    return true;
  }
  if (parsedArgs._freeConfigExplicit) {
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

function cloneProviderModelsCache(cache) {
  if (!cache || typeof cache !== "object") return cache;
  const models = {};
  const providerModels = cache.models && typeof cache.models === "object" &&
    !Array.isArray(cache.models)
    ? cache.models
    : {};
  for (const [provider, entries] of Object.entries(providerModels)) {
    models[provider] = Array.isArray(entries) ? [...entries] : entries;
  }
  return { ...cache, models };
}

export async function loadLiveProviderModels({
  ctx,
  loadProviderModelsFn = loadProviderModels,
  now = Date.now,
  writeGroupLine: writeProviderLine = writeGroupLine,
  writeTopLevelLine: writeStatusLine = writeTopLevelLine,
} = {}) {
  writeStatusLine("◇  Checking live provider models...");
  const startedAt = now();
  const liveCache = await loadProviderModelsFn({ ctx });
  const finishedAt = now();
  const liveModels = liveCache?.models && typeof liveCache.models === "object" &&
    !Array.isArray(liveCache.models)
    ? liveCache.models
    : {};
  const providerOrder = Object.keys(liveModels);
  const elapsedSeconds = Math.max(0, Math.round((finishedAt - startedAt) / 1000));

  writeStatusLine(
    `◇  ${providerOrder.length} providers identified in \`opencode models\` output (${elapsedSeconds}s)`,
  );
  for (const provider of providerOrder) writeProviderLine(`• ${provider}`);

  return {
    cache: cloneProviderModelsCache(liveCache),
    providerOrder,
  };
}

export async function buildRecommendationInputs({
  commandExists,
  ctx,
  discoverFreeModelsFn = discoverFreeModels,
  loadProviderModelsFn = loadProviderModels,
  now = Date.now,
  parsedArgs,
  runOptions,
  subprocess,
  writeGroupLineFn = writeGroupLine,
  writeTopLevelLineFn = writeTopLevelLine,
}) {
  const config = loadConfig({ global: runOptions.globalFlag });
  const liveProviderModels = runOptions.localOnlyFlag
    ? { cache: null, providerOrder: [] }
    : await loadLiveProviderModels({
      ctx,
      loadProviderModelsFn,
      now,
      writeGroupLine: writeGroupLineFn,
      writeTopLevelLine: writeTopLevelLineFn,
    });
  const paidProviderPrep = await preparePaidProviderModels({
    config,
    ctx,
    initialCache: liveProviderModels.cache,
    localOnlyFlag: runOptions.localOnlyFlag,
    excludeModels: parsedArgs["exclude-model"] || [],
  });
  const localEnvironment = await discoverLocalEnvironment({
    cloudOnlyFlag: runOptions.cloudOnlyFlag,
    detectGPU: () => detectGPU({ verbose: ctx.verboseMode }),
    detectOllama: () => detectOllama(commandExists, { verbose: ctx.verboseMode }),
    discoverModels: (forceRefresh, progress) =>
      discoverModelsFromRegistry(
        forceRefresh,
        progress,
        subprocess.fetchUrlAsync.bind(subprocess),
      ),
  });
  const cloudLookup = await buildCloudLookup({
    ctx,
    discoverFreeModelsFn,
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

async function buildCloudLookup({
  ctx,
  discoverFreeModelsFn,
  localOnlyFlag,
  paidProviderPrep,
}) {
  if (localOnlyFlag) {
    writeTopLevelLine("◇  Checking live provider models: skipped by --local-only");
    return { byId: {}, sets: {} };
  }

  const cache = cloneProviderModelsCache(paidProviderPrep.initialCache);

  // Free models are always available as fallback candidates unless
  // --no-free-config is passed (which is handled at the display/apply level).
  // Inject them into the lookup so the pipeline can use them for fallback_models
  // and AI ranking even when the provider is not explicitly configured.
  if (cache?.models) {
    const freeModels = discoverFreeModelsFn({ ctx });
    for (const ref of freeModels) {
      const { provider, model: id } = splitModelRef(ref);
      if (provider && id) {
        if (!cache.models[provider]) {
          cache.models[provider] = [];
        }
        const exists = cache.models[provider].some((m) =>
          typeof m === "string" ? m === id : m.id === id
        );
        if (!exists) {
          cache.models[provider].push({ id });
        }
      }
    }
  }

  return buildRichModelLookup(cache);
}
