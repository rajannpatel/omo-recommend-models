import { modelNamesEquivalent } from "../../omo-shared.js";
import {
  AGENT_MODEL_REQUIREMENTS,
  CATEGORY_MODEL_REQUIREMENTS,
} from "../model-requirements.js";

export function normalizeRef(value) {
  return String(value || "").trim().toLowerCase();
}

export function excludedModelSet(values = []) {
  return new Set(
    values
      .flat()
      .filter((value) => typeof value === "string" && value.trim())
      .map(normalizeRef),
  );
}

export function isExcluded(candidate, excluded) {
  const provider = normalizeRef(candidate.provider);
  const ref = `${provider}/${normalizeRef(candidate.model)}`;
  return excluded.has(provider) || excluded.has(ref);
}

export function findActualModel(modelMap, model) {
  if (!modelMap) return null;
  if (modelMap.has(model)) return model;
  for (const id of modelMap.keys()) {
    if (modelNamesEquivalent(id, model)) {
      return id;
    }
  }
  return null;
}

export function isAvailable(
  candidate,
  cloudLookup,
  isProviderAllowed,
  isModelAllowed = () => true,
) {
  if (!isProviderAllowed(candidate.provider)) return false;
  const providerModels = cloudLookup?.byId?.[candidate.provider];
  if (!providerModels) return false;
  const actual = findActualModel(providerModels, candidate.model);
  if (!actual) return false;
  const meta = providerModels.get(actual);
  if (meta && meta.capabilities && meta.capabilities.toolcall !== true) return false;
  if (!isModelAllowed({ ...candidate, model: actual })) return false;
  candidate.model = actual;
  return true;
}

/**
 * Builds provider preference order from AGENT_MODEL_REQUIREMENTS and CATEGORY_MODEL_REQUIREMENTS.
 * Providers appearing earlier in fallback chains across more requirements get higher priority.
 * Providers not in the preference list are sorted alphabetically at the end.
 */
let _cachedPreferenceOrder = null;

export function buildProviderPreferenceOrder() {
  if (_cachedPreferenceOrder) return _cachedPreferenceOrder;

  const providerWeights = new Map();
  const allRequirements = { ...AGENT_MODEL_REQUIREMENTS, ...CATEGORY_MODEL_REQUIREMENTS };
  
  for (const req of Object.values(allRequirements)) {
    if (!req.fallbackChain) continue;
    
    for (let i = 0; i < req.fallbackChain.length; i++) {
      const chainEntry = req.fallbackChain[i];
      if (!chainEntry.providers) continue;
      
      for (const provider of chainEntry.providers) {
        const weight = providerWeights.get(provider) || 0;
        providerWeights.set(provider, weight + (1 / (i + 1)));
      }
    }
  }
  
  const sortedByWeight = Array.from(providerWeights.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([provider]) => provider);
  
  const seen = new Set(sortedByWeight);
  const remainingProviders = [];
  for (const req of Object.values(allRequirements)) {
    if (!req.fallbackChain) continue;
    for (const chainEntry of req.fallbackChain) {
      if (!chainEntry.providers) continue;
      for (const provider of chainEntry.providers) {
        if (!seen.has(provider)) {
          seen.add(provider);
          remainingProviders.push(provider);
        }
      }
    }
  }
  remainingProviders.sort();
  
  _cachedPreferenceOrder = [...sortedByWeight, ...remainingProviders];
  return _cachedPreferenceOrder;
}
