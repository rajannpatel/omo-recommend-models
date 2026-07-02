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
  const actual = findActualModel(providerModels, candidate.model);
  if (!actual) return false;
  if (!isModelAllowed({ ...candidate, model: actual })) return false;
  candidate.model = actual;
  return true;
}

/**
 * Builds provider preference order from AGENT_MODEL_REQUIREMENTS and CATEGORY_MODEL_REQUIREMENTS.
 * Providers appearing earlier in fallback chains across more requirements get higher priority.
 * Providers not in the preference list are sorted alphabetically at the end.
 */
export function buildProviderPreferenceOrder() {
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
    .sort((a, b) => b[1] - a[1]) // Higher weight first
    .map(([provider]) => provider);
  
  const remainingProviders = Object.keys(allRequirements)
    .flatMap((key) => {
      const req = allRequirements[key];
      return req.fallbackChain?.flatMap((chain) => chain.providers || []) || [];
    })
    .filter((provider, index, self) => self.indexOf(provider) === index) // Unique
    .filter((provider) => !sortedByWeight.includes(provider)) // Exclude already sorted
    .sort(); // Alphabetical for remaining
  
  return [...sortedByWeight, ...remainingProviders];
}
