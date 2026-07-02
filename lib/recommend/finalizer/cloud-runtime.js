import { modelRef } from "../../omo-shared.js";
import {
  normalizeAgentRec,
  normalizeLocalRecommendation,
} from "../../display-utils.js";
import { LOCAL_PROVIDER } from "../../constants.js";
import {
  hasEnoughContextForPanel,
  isUsableForConfig,
} from "../panel-candidates.js";
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
      !isModelAllowed(rec.model) ||
      !isUsableForConfig(rec.model, cloudLookup)
    )
  ) {
    rec.model = null;
  }
  rec.routing = (rec.routing || [])
    .map((ref) => normalizeLocalRecommendation(ref, fittingByName, false))
    .filter((ref) =>
      ref &&
      isProviderAllowed(ref.provider) &&
      isModelAllowed(ref) &&
      isUsableForConfig(ref, cloudLookup),
    );
  rec.fallback_models = (rec.fallback_models || [])
    .map((ref) => normalizeLocalRecommendation(ref, fittingByName, true))
    .filter((ref) =>
      ref &&
      isProviderAllowed(ref.provider) &&
      isModelAllowed(ref) &&
      isUsableForConfig(ref, cloudLookup),
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
        isModelAllowed({ provider, model: id }) &&
        hasEnoughContextForPanel(modelRef(provider, id), cloudLookup),
      ),
  );
}

export function addMissingCloudFallbacks(
  rec,
  providerSets,
  cloudProviders,
  cloudLookup,
  isModelAllowed,
  blockedPrimaryProvider = null,
  blockedPrimaryModel = null,
) {
  for (const [provider, modelMap] of cloudProviders) {
    if (provider === rec.model?.provider || providerSets.fallbackProviders.has(provider)) {
      continue;
    }
    const fallback = bestCloudRecommendationForProvider(
      provider,
      modelMap,
      cloudLookup,
      isModelAllowed,
    );
    if (!fallback) continue;
    // If the primary model was blocked and this is the same provider,
    // insert its fallback at the front so it gets promoted to primary.
    // BUT only if the blocked model isn't already covered by a fallback
    // from a different provider (e.g. github-copilot/gpt-5.5 fills in for
    // blocked opencode/gpt-5.5).
    const blockedModelAlreadyCovered =
      blockedPrimaryModel &&
      rec.fallback_models.some((ref) => ref.model === blockedPrimaryModel);
    if (
      blockedPrimaryProvider &&
      provider === blockedPrimaryProvider &&
      !blockedModelAlreadyCovered
    ) {
      rec.fallback_models.unshift(fallback);
    } else {
      rec.fallback_models.push(fallback);
    }
    providerSets.configuredProviders.add(provider);
    providerSets.fallbackProviders.add(provider);
  }
}
