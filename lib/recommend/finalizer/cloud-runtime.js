import {
  normalizeAgentRec,
  normalizeLocalRecommendation,
} from "../../display-utils.js";
import { LOCAL_PROVIDER } from "../../constants.js";
import { bestCloudRecommendationForProvider } from "./cloud.js";

export function normalizeRuntimeRefs(
  rec,
  fittingByName,
  cloudLookup,
  isProviderAllowed,
  isModelAllowed,
) {
  rec.model = normalizeLocalRecommendation(rec.model, fittingByName, true);
  if (
    rec.model &&
    (
      !isProviderAllowed(rec.model.provider) ||
      !isModelAllowed(rec.model)
    )
  ) {
    rec.model = null;
  }
  rec.routing = (rec.routing || [])
    .map((ref) => normalizeLocalRecommendation(ref, fittingByName, false))
    .filter((ref) =>
      ref &&
      isProviderAllowed(ref.provider) &&
      isModelAllowed(ref),
    );
  rec.fallback_models = (rec.fallback_models || [])
    .map((ref) => normalizeLocalRecommendation(ref, fittingByName, true))
    .filter((ref) =>
      ref &&
      isProviderAllowed(ref.provider) &&
      isModelAllowed(ref),
    );
}

export function normalizedCloudRecommendations(
  completed,
  fittingByName,
  cloudLookup,
  isProviderAllowed,
  isModelAllowed,
) {
  const recByName = new Map();
  for (const rec of Array.isArray(completed.cloudRecommendations) ? completed.cloudRecommendations : []) {
    if (!rec || !rec.name) continue;
    const norm = rec.model || rec.recommendations ? normalizeAgentRec({ ...rec }) : rec;
    normalizeRuntimeRefs(
      norm,
      fittingByName,
      cloudLookup,
      isProviderAllowed,
      isModelAllowed,
    );
    recByName.set(norm.name, norm);
  }
  return recByName;
}

export function cloudProvidersForFallback(cloudLookup, isProviderAllowed, isModelAllowed) {
  return Object.entries(cloudLookup.byId || {}).filter(
    ([provider, modelMap]) =>
      provider !== LOCAL_PROVIDER &&
      isProviderAllowed(provider) &&
      modelMap &&
      modelMap.size > 0 &&
      [...modelMap].some(([id]) =>
        isModelAllowed({ provider, model: id }),
      ),
  );
}

export function addMissingCloudFallbacks(
  rec,
  providerSets,
  cloudProviders,
  cloudLookup,
  isModelAllowed,
) {
  for (const [provider, modelMap] of cloudProviders) {
    if (providerSets.fallbackProviders.has(provider)) continue;
    const fallback = bestCloudRecommendationForProvider(
      provider,
      modelMap,
      cloudLookup,
      isModelAllowed,
    );
    if (!fallback) continue;
    rec.fallback_models.push(fallback);
    providerSets.configuredProviders.add(provider);
    providerSets.fallbackProviders.add(provider);
  }
}
