import { modelNamesEquivalent, normalizeModelNameForMatching, splitModelRef } from "../omo-shared.js";

export const MATCH_STRATEGIES = {
  DETERMINISTIC: "deterministic",
  MACHINE_READABLE: "machine-readable",
  AI: "ai",
};

/**
 * Main dispatcher for model matching strategies.
 * @param {Object} requirement - The model requirement object
 * @param {Map} providerModelList - Map of modelId to metadata objects
 * @param {string} strategy - Matching strategy to use
 * @returns {Array} Array of match results
 */
export function matchModel(requirement, providerModelList, strategy) {
  if (!requirement || !providerModelList || !strategy) return [];
  
  switch (strategy) {
    case MATCH_STRATEGIES.DETERMINISTIC:
      return matchDeterministic(requirement, providerModelList);
    case MATCH_STRATEGIES.MACHINE_READABLE:
      return matchMachineReadable(requirement, providerModelList);
    case MATCH_STRATEGIES.AI:
      return matchWithAI(requirement, providerModelList);
    default:
      return [];
  }
}

/**
 * Deterministic matching using exact matches, name equivalence, and provider aliases.
 * @param {Object} requirement - The model requirement object
 * @param {Map} providerModelList - Map of modelId to metadata objects
 * @returns {Array} Array of match results
 */
export function matchDeterministic(requirement, providerModelList) {
  if (!requirement || !providerModelList) return [];
  
  const requirementModel = requirement.model;
  const requirementVariant = requirement.variant;
  const matches = [];
  
  for (const [modelId, metadata] of providerModelList.entries()) {
    if (!modelId || !metadata) continue;
    
    // Try exact match first
    if (modelId === requirementModel) {
      matches.push({
        provider: metadata.provider || "unknown",
        model: modelId,
        score: 100,
        confidence: 1.0,
        matchType: "exact",
        variant: requirementVariant,
        metadata,
      });
      continue;
    }
    
    // Try name equivalence
    if (modelNamesEquivalent(modelId, requirementModel)) {
      matches.push({
        provider: metadata.provider || "unknown",
        model: modelId,
        score: 90,
        confidence: 0.9,
        matchType: "name-equivalent",
        variant: requirementVariant,
        metadata,
      });
      continue;
    }
    
    // Try provider aliases (if requirement includes provider prefix)
    const requirementRef = splitModelRef(requirementModel);
    if (requirementRef.provider && metadata.provider === requirementRef.provider) {
      matches.push({
        provider: metadata.provider || "unknown",
        model: modelId,
        score: 80,
        confidence: 0.8,
        matchType: "provider-alias",
        variant: requirementVariant,
        metadata,
      });
      continue;
    }
  }
  
  return matches;
}

/**
 * Machine-readable matching based on capability comparison.
 * @param {Object} requirement - The model requirement object
 * @param {Map} providerModelList - Map of modelId to metadata objects
 * @returns {Array} Array of match results
 */
export function matchMachineReadable(requirement, providerModelList) {
  if (!requirement || !providerModelList) return [];
  
  const requirementModel = requirement.model;
  const requirementVariant = requirement.variant;
  const requirementContextLength = requirement.contextLength || 0;
  const requirementModality = requirement.modality || "text";
  const requirementPricing = requirement.pricing || {};
  const requirementCreated = requirement.created || 0;
  
  const matches = [];
  
  for (const [modelId, metadata] of providerModelList.entries()) {
    if (!modelId || !metadata) continue;
    
    let score = 0;
    let confidence = 0;
    
    // Model name similarity (0-30 points)
    const normalizedModelId = normalizeModelNameForMatching(modelId);
    const normalizedRequirement = normalizeModelNameForMatching(requirementModel);
    if (normalizedModelId === normalizedRequirement) {
      score += 30;
      confidence += 0.3;
    } else if (modelNamesEquivalent(modelId, requirementModel)) {
      score += 20;
      confidence += 0.2;
    }
    
    // Context length compatibility (0-25 points)
    const modelContextLength = metadata.context_length || 0;
    if (modelContextLength >= requirementContextLength) {
      const ratio = Math.min(modelContextLength / requirementContextLength, 1.0);
      score += 25 * ratio;
      confidence += 0.25 * ratio;
    }
    
    // Modality support (0-20 points)
    const modelModalities = Array.isArray(metadata.modalities) ? metadata.modalities : [];
    if (modelModalities.includes(requirementModality) || modelModalities.includes("text")) {
      score += 20;
      confidence += 0.2;
    }
    
    // Pricing compatibility (0-15 points)
    const modelPricing = metadata.pricing || {};
    if (modelPricing.input && requirementPricing.input) {
      const priceRatio = Math.min(modelPricing.input / requirementPricing.input, 1.0);
      score += 15 * priceRatio;
      confidence += 0.15 * priceRatio;
    }
    
    // Release date (0-10 points)
    const modelCreated = metadata.created || 0;
    if (modelCreated >= requirementCreated) {
      const ageRatio = Math.min((modelCreated - requirementCreated) / (requirementCreated || 1), 1.0);
      score += 10 * ageRatio;
      confidence += 0.1 * ageRatio;
    }
    
    // Variant compatibility (0-10 points)
    if (requirementVariant && metadata.variants && metadata.variants.includes(requirementVariant)) {
      score += 10;
      confidence += 0.1;
    }
    
    if (score > 0) {
      matches.push({
        provider: metadata.provider || "unknown",
        model: modelId,
        score: Math.round(score),
        confidence: Math.min(confidence, 1.0),
        matchType: "capability",
        variant: requirementVariant,
        metadata,
      });
    }
  }
  
  return matches;
}

/**
 * AI fallback matching (placeholder for AI matcher integration).
 * @param {Object} requirement - The model requirement object
 * @param {Map} providerModelList - Map of modelId to metadata objects
 * @param {Function} aiMatcher - AI matcher function
 * @returns {Array} Array of match results
 */
export function matchWithAI(requirement, providerModelList, aiMatcher) {
  if (!requirement || !providerModelList || !aiMatcher) return [];
  
  // Convert Map to array for AI matcher
  const modelArray = Array.from(providerModelList.entries()).map(([modelId, metadata]) => ({
    modelId,
    metadata,
  }));
  
  try {
    const aiMatches = aiMatcher(requirement, modelArray);
    return Array.isArray(aiMatches) ? aiMatches : [];
  } catch (error) {
    return [];
  }
}

/**
 * Merge and deduplicate matches, keeping best per provider.
 * @param {Array} matches - Array of match results
 * @returns {Array} Deduplicated matches
 */
export function mergeAndDedupe(matches) {
  if (!Array.isArray(matches)) return [];
  
  const providerMap = new Map();
  
  for (const match of matches) {
    if (!match || !match.provider || !match.model || match.score < 0) continue;
    
    const existing = providerMap.get(match.provider);
    if (!existing || match.score > existing.score || 
        (match.score === existing.score && match.confidence > existing.confidence)) {
      providerMap.set(match.provider, match);
    }
  }
  
  return Array.from(providerMap.values());
}

/**
 * Sort matches by provider preference order.
 * @param {Array} matches - Array of match results
 * @param {Array} providerPreferenceOrder - Array of provider names in preference order
 * @returns {Array} Sorted matches
 */
export function sortByPreference(matches, providerPreferenceOrder) {
  if (!Array.isArray(matches)) return [];
  
  const preferenceMap = new Map();
  providerPreferenceOrder.forEach((provider, index) => {
    preferenceMap.set(provider, index);
  });
  
  return matches.sort((a, b) => {
    const aIndex = preferenceMap.get(a.provider) ?? Number.MAX_SAFE_INTEGER;
    const bIndex = preferenceMap.get(b.provider) ?? Number.MAX_SAFE_INTEGER;
    
    if (aIndex !== bIndex) {
      return aIndex - bIndex;
    }
    
    // For providers not in preference list, sort alphabetically
    if (aIndex === Number.MAX_SAFE_INTEGER && bIndex === Number.MAX_SAFE_INTEGER) {
      return a.provider.localeCompare(b.provider);
    }
    
    return a.provider.localeCompare(b.provider);
  });
}