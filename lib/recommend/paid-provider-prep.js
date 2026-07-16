import {
  buildProviderAliases,
  buildRichModelLookup,
  loadProviderModels,
} from "../omo-shared.js";
import { sortPanelModelRefs } from "../scoring.js";
import { shouldProbeProviderAvailability } from "../probe-providers.js";
import {
  probeModelRefsFromAdvertisement,
  probeModelRefsFromLookup,
} from "./providers/ref-extraction.js";
import { runProviderProbes } from "./providers/probe-orchestration.js";

function isValidProviderSegment(provider) {
  return (
    typeof provider === "string" &&
    provider.length > 0 &&
    !provider.includes("/") &&
    !/\s/.test(provider)
  );
}

function isValidModelId(modelId) {
  return (
    typeof modelId === "string" &&
    modelId.length > 0 &&
    !/\s/.test(modelId)
  );
}

function sanitizeLiveProviderCache(cache) {
  if (!cache || typeof cache !== "object" || Array.isArray(cache)) return null;
  const models = {};
  const providerModels = cache.models &&
    typeof cache.models === "object" &&
    !Array.isArray(cache.models)
    ? cache.models
    : {};
  for (const [provider, entries] of Object.entries(providerModels)) {
    if (!isValidProviderSegment(provider) || !Array.isArray(entries)) continue;
    const validEntries = entries.filter((entry) => {
      if (typeof entry === "string") return isValidModelId(entry);
      return (
        entry !== null &&
        typeof entry === "object" &&
        !Array.isArray(entry) &&
        isValidModelId(entry.id)
      );
    });
    if (validEntries.length > 0) models[provider] = validEntries;
  }
  return {
    ...cache,
    models,
    ...(Array.isArray(cache.advertisedRefs)
      ? { advertisedRefs: [...cache.advertisedRefs] }
      : {}),
  };
}

export async function preparePaidProviderModels({
  config,
  ctx,
  localOnlyFlag,
  initialCache: suppliedInitialCache,
}) {
  if (localOnlyFlag) {
    return {
      initialCache: null,
      initialAliases: {},
      initialCloudLookup: { byId: {}, sets: {} },
      paidProbesPromise: Promise.resolve([]),
      rejectedPaidModelsPromise: Promise.resolve([]),
      rejectedPaidModelDetailsPromise: Promise.resolve(new Map()),
      probeRecordsPromise: Promise.resolve([]),
      ensureProbesAwaited: async () => {},
    };
  }

  const loadedInitialCache = suppliedInitialCache === undefined
    ? await loadProviderModels({ ctx })
    : suppliedInitialCache;
  const initialCache = sanitizeLiveProviderCache(loadedInitialCache);
  const initialAliases = buildProviderAliases(config);
  const initialCloudLookup = buildRichModelLookup(initialCache);
  const eligibleRefs = Array.isArray(initialCache?.advertisedRefs)
    ? probeModelRefsFromAdvertisement(
        initialCache.advertisedRefs,
        initialCloudLookup,
      )
    : probeModelRefsFromLookup(initialCloudLookup);
  const sortedPaid = sortPanelModelRefs(eligibleRefs, config);

  let paidProbesPromise;
  let rejectedPaidModelsPromise = Promise.resolve([]);
  let rejectedPaidModelDetailsPromise = Promise.resolve(new Map());
  let probeRecordsPromise = Promise.resolve([]);
  let ensureProbesAwaited = async () => {};
  if (shouldProbeProviderAvailability(ctx)) {
    const probeResults = await runProviderProbes({
      ctx,
      eligibleRefs,
    });
    paidProbesPromise = probeResults.paidProbesPromise.then((allowedRefs) => {
      const allowed = new Set(allowedRefs);
      return sortedPaid.filter((modelRef) => allowed.has(modelRef));
    });
    rejectedPaidModelsPromise = probeResults.rejectedPaidModelsPromise;
    rejectedPaidModelDetailsPromise = probeResults.rejectedPaidModelDetailsPromise;
    probeRecordsPromise = probeResults.probeRecordsPromise;
    ensureProbesAwaited = probeResults.ensureProbesAwaited;
  } else {
    paidProbesPromise = Promise.resolve(sortedPaid);
  }

  return {
    initialCache,
    initialAliases,
    initialCloudLookup,
    paidProbesPromise,
    rejectedPaidModelsPromise,
    rejectedPaidModelDetailsPromise,
    probeRecordsPromise,
    ensureProbesAwaited,
  };
}
