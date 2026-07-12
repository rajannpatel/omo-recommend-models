import { matchModel, MATCH_STRATEGIES } from "../model-matching.js";
import { isExcluded } from "./helpers.js";

function matchChainWithStrategy(fallbackChain, cloudLookup, requirement, strategy, isProviderAllowed, excluded) {
  const matches = [];
  if (!cloudLookup?.byId) return matches;
  
  for (const chainEntry of fallbackChain) {
    if (!chainEntry.model) continue;
    const chainReq = { ...requirement, model: chainEntry.model };
    for (const [provider, modelMap] of Object.entries(cloudLookup.byId)) {
      if (!isProviderAllowed(provider) || !modelMap || modelMap.size === 0) continue;
      if (!chainEntry.providers?.includes(provider)) continue;
      
      const strategyMatches = matchModel(chainReq, modelMap, strategy);
      const filtered = strategyMatches
        .map((m) => ({ ...m, provider }))
        .filter((m) => !isExcluded({ provider: m.provider, model: m.model }, excluded));
      matches.push(...filtered);
    }
  }
  
  return matches;
}

function matchWithAI(cloudLookup, requirement, isProviderAllowed, aiMatcher) {
  const matches = [];
  if (!cloudLookup?.byId || !aiMatcher) return matches;
  
  for (const [provider, modelMap] of Object.entries(cloudLookup.byId)) {
    if (!isProviderAllowed(provider) || !modelMap || modelMap.size === 0) continue;
    
    const modelArray = Array.from(modelMap.entries()).map(([modelId, metadata]) => ({
      modelId,
      metadata,
    }));
    
    try {
      const aiMatches = aiMatcher.findClosestMatch(requirement, modelArray);
      if (aiMatches) {
        matches.push({
          provider: aiMatches.provider,
          model: aiMatches.model,
          score: aiMatches.confidence ? Math.round(aiMatches.confidence * 100) : 0,
          confidence: aiMatches.confidence || 0,
          matchType: aiMatches.matchType || "ai",
          reason: aiMatches.reason || `AI match via ${aiMatches.provider}/${aiMatches.model}`,
          metadata: modelArray.find(m => m.modelId === aiMatches.model)?.metadata,
        });
      }
    } catch (error) {
      // Silently fail and continue
    }
  }
  
  return matches;
}

export function runPipelineStages(fallbackChain, cloudLookup, requirement, isProviderAllowed, excluded, aiMatcher) {
  let matches = [];
  
  // Stage 1: Deterministic matching
  matches = matchChainWithStrategy(fallbackChain, cloudLookup, requirement, MATCH_STRATEGIES.DETERMINISTIC, isProviderAllowed, excluded);
  if (matches.length > 0) return matches;
  
  // Stage 2: Machine-readable matching (if deterministic found nothing)
  matches = matchChainWithStrategy(fallbackChain, cloudLookup, requirement, MATCH_STRATEGIES.MACHINE_READABLE, isProviderAllowed, excluded);
  if (matches.length > 0) return matches;
  
  // Stage 3: AI matching (if both previous stages found nothing)
  matches = matchWithAI(cloudLookup, requirement, isProviderAllowed, aiMatcher);
  return matches;
}

export function buildPipelineRecommendation(sortedMatches, requirement) {
  return sortedMatches.map((match) => ({
    provider: match.provider,
    model: match.model,
    reason: match.reason || `Matched via ${match.matchType} strategy`,
    inferred: false,
    variant: match.variant || requirement.variant || undefined,
    reasoningEffort: undefined,
    temperature: undefined,
    top_p: undefined,
    maxTokens: undefined,
    thinking: undefined,
  }));
}
