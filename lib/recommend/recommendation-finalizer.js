import {
  buildFittingModelMap,
  resolveFittingLocalName,
} from "../display-utils.js";
import {
  allConfigEntries,
  finalizeFallbackModels,
  uniqueByModelRef,
} from "../consensus.js";
import { LOCAL_PROVIDER } from "../constants.js";
import {
  addMissingCloudFallbacks,
  cloudProvidersForFallback,
  normalizedCloudRecommendations,
  normalizeRuntimeRefs,
} from "./finalizer/cloud-runtime.js";
import {
  contextBestLocalForEntry,
  dedupeLocalDecisions,
  ensureLocalDecision,
  ensureSelectedLocalDecision,
  localModelForEntry,
} from "./finalizer/local.js";
/**
 * Deduplicates fallback_models array to remove identical provider+model entries.
 * Keeps the first occurrence of each unique provider/model pair (preserves order).
 */
function deduplicateFallbackModels(fallbackModels) {
  const seen = new Set();
  return fallbackModels.filter((ref) => {
    if (!ref?.provider || !ref?.model) return true;
    const key = `${ref.provider}/${ref.model}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}


function normalizeLocalCollections(completed, fittingByName) {
  completed.localModels = completed.localModels || {
    decisions: [],
    placements: [],
  };
  completed.localModels.decisions = Array.isArray(completed.localModels.decisions)
    ? completed.localModels.decisions
        .map((decision) => ({
          ...decision,
          name: resolveFittingLocalName(decision.name, fittingByName),
        }))
        .filter((decision) => decision.name)
    : [];
  completed.localModels.placements = Array.isArray(completed.localModels.placements)
    ? completed.localModels.placements
        .map((placement) => ({
          ...placement,
          modelName: resolveFittingLocalName(placement.modelName, fittingByName),
        }))
        .filter((placement) => placement.modelName && placement.agentName)
    : [];
}

function baseRecommendationForEntry(entry, recByName) {
  const rec = recByName.get(entry.name) || {
    name: entry.name,
    type: entry.type,
    profile: entry.section.description || entry.section.model_quality || "",
    model: null,
    routing: [],
    fallback_models: [],
  };
  rec.type = rec.type || entry.type;
  rec.profile = rec.profile || entry.section.description || entry.section.model_quality || "";
  return rec;
}

function ensureLocalDecisionsForRefs(completed, rec, allLocalModels, gpu, ollama) {
  for (const ref of [rec.model, ...rec.routing, ...rec.fallback_models]) {
    if (ref && ref.provider === LOCAL_PROVIDER) {
      ensureLocalDecision(completed, ref.model, allLocalModels, gpu, ollama);
    }
  }
}

function configuredProviderSets(rec) {
  const fallbackProviders = new Set();
  const configuredProviders = new Set();
  if (rec.model?.provider) configuredProviders.add(rec.model.provider);
  for (const ref of rec.routing) {
    if (ref.provider) configuredProviders.add(ref.provider);
  }
  for (const ref of rec.fallback_models) {
    if (ref.provider) {
      configuredProviders.add(ref.provider);
      fallbackProviders.add(ref.provider);
    }
  }
  return { configuredProviders, fallbackProviders };
}

function addLocalFallback({
  allLocalModels,
  completed,
  entry,
  fittingByName,
  gpu,
  localRecommendationContext,
  ollama,
  providerSets,
  rec,
}) {
  const contextLocalPick = contextBestLocalForEntry(
    entry.name,
    localRecommendationContext,
    fittingByName,
  );
  const localPick = localRecommendationContext
    ? contextLocalPick
    : localModelForEntry(completed, entry.name, allLocalModels, gpu, ollama);
  if (localPick && !providerSets.configuredProviders.has(LOCAL_PROVIDER)) {
    const localRec = {
      provider: LOCAL_PROVIDER,
      model: localPick.name,
      reason: localPick.role === "primary"
        ? "Local primary selected for this role"
        : "Local fallback for offline or quota-limited operation",
    };
    if (localPick.role === "primary") {
      if (rec.model) rec.fallback_models.unshift(rec.model);
      rec.model = localRec;
    } else {
      rec.fallback_models.push(localRec);
    }
    providerSets.configuredProviders.add(LOCAL_PROVIDER);
  }
  if (!localPick) return;
  ensureSelectedLocalDecision(completed, localPick, allLocalModels, gpu, ollama);
  if (completed.localModels.placements.some((placement) => placement.agentName === entry.name)) {
    return;
  }
  completed.localModels.placements.push({
    modelName: localPick.name,
    agentName: entry.name,
    role: localPick.role || "fallback",
    justification: localPick.reason || "Used after cloud models are unavailable.",
  });
}

/**
 * Deduplicates fallback models across providers: if the same model name
 * appears from multiple providers, keeps only the highest-scored one.
 * Strips internal score fields after dedup.
 */
function deduplicateAcrossProviders(fallbackModels) {
  const bestPerModel = new Map();
  for (const ref of fallbackModels) {
    if (!ref?.provider || !ref?.model) continue;
    const existing = bestPerModel.get(ref.model);
    if (!existing) {
      bestPerModel.set(ref.model, ref);
    } else {
      const existingScore = existing.score ?? -1;
      const refScore = ref.score ?? -1;
      if (refScore > existingScore) bestPerModel.set(ref.model, ref);
    }
  }
  return Array.from(bestPerModel.values()).map((ref) => {
    if (ref && ref.score !== undefined) {
      const { score, ...rest } = ref;
      void score;
      return rest;
    }
    return ref;
  });
}

/**
 * Ensures at most one non-free model per provider across the entire
 * recommendation (model + fallback_models combined). If the primary model
 * occupies a provider slot and is non-free, all fallbacks from that provider
 * are removed. Free models (determined by `isFreeRef`) are exempt — multiple
 * free models from different slots on the same provider are allowed.
 *
 * @param {Object} rec - Recommendation entry ({ model, fallback_models })
 * @param {Object} [options]
 * @param {function(Object): boolean} [options.isFreeRef] - Returns true if a
 *   model ref is free. Free refs skip the per-provider limit.
 *   Default: only opencode provider models are considered free.
 */
export function deduplicatePerProvider(rec, { isFreeRef = (ref) => ref?.provider === "opencode" } = {}) {
  const usedProviders = new Set();
  if (rec.model?.provider && !isFreeRef(rec.model)) {
    usedProviders.add(rec.model.provider);
  }
  rec.fallback_models = (rec.fallback_models || []).filter((ref) => {
    if (!ref?.provider) return false;
    if (isFreeRef(ref)) return true;
    if (usedProviders.has(ref.provider)) return false;
    usedProviders.add(ref.provider);
    return true;
  });
}

function finalizeEntryRecommendation(rec) {
  rec.fallback_models = finalizeFallbackModels(rec.model, rec.fallback_models);
  rec.fallback_models = deduplicateAcrossProviders(rec.fallback_models);
  rec.fallback_models = deduplicateFallbackModels(rec.fallback_models);
  deduplicatePerProvider(rec);
  if (!rec.model && rec.fallback_models.length > 0) {
    rec.model = rec.fallback_models.shift();
  }
  rec.routing = uniqueByModelRef(rec.routing);
}

export function completeAiRecommendations(
  aiResult,
  config,
  cloudLookup,
  allLocalModels,
  gpu,
  ollama,
  isProviderAllowed = () => true,
  localRecommendationContext = null,
  isModelAllowed = () => true,
) {
  const completed = aiResult || {};
  const fittingByName =
    localRecommendationContext?.fittingByName || buildFittingModelMap(allLocalModels, gpu);
  normalizeLocalCollections(completed, fittingByName);
  const entries = allConfigEntries(config);

  const recByName = normalizedCloudRecommendations(
    completed,
    fittingByName,
    cloudLookup,
    isProviderAllowed,
    isModelAllowed,
  );
  const cloudProviders = cloudProvidersForFallback(
    cloudLookup,
    isProviderAllowed,
    isModelAllowed,
  );

  for (const entry of entries) {
    const rec = baseRecommendationForEntry(entry, recByName);
    normalizeRuntimeRefs(
      rec,
      fittingByName,
      cloudLookup,
      isProviderAllowed,
      isModelAllowed,
    );
    if (localRecommendationContext) {
      if (rec.model?.provider === LOCAL_PROVIDER) rec.model = null;
      rec.fallback_models = rec.fallback_models.filter((ref) => ref.provider !== LOCAL_PROVIDER);
    }
    ensureLocalDecisionsForRefs(completed, rec, allLocalModels, gpu, ollama);
    const providerSets = configuredProviderSets(rec);
    addMissingCloudFallbacks(
      rec,
      providerSets,
      cloudProviders,
      cloudLookup,
      isModelAllowed,
    );

    // Inject free cloud models (opencode) as fallbacks for all entries.
    // Pipeline entries already get these from withMinimumFreeFallbacks, but
    // unmatched entries (scout, sysadmin) need them added here.
    for (const [provider, modelMap] of Object.entries(cloudLookup?.byId || {})) {
      if (provider !== "opencode" || !modelMap || modelMap.size === 0) continue;
      for (const [modelId] of modelMap.entries()) {
        const candidate = { provider, model: modelId, reason: "Free cloud fallback" };
        if (!isModelAllowed(candidate)) continue;
        if (rec.fallback_models.some((ref) => ref.provider === provider && ref.model === modelId)) continue;
        rec.fallback_models.push(candidate);
      }
    }

    addLocalFallback({
      allLocalModels,
      completed,
      entry,
      fittingByName,
      gpu,
      localRecommendationContext,
      ollama,
      providerSets,
      rec,
    });
    finalizeEntryRecommendation(rec);
    recByName.set(entry.name, rec);
  }

  dedupeLocalDecisions(completed, fittingByName);
  completed.cloudRecommendations = entries
    .map((entry) => recByName.get(entry.name))
    .filter(Boolean);
  return completed;
}


