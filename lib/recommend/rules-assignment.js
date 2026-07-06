import { allConfigEntries } from "../consensus.js";
import {
  excludedModelSet,
  expandChain,
  fallbackOutsideRuleChain,
  fallbackProviderPool,
  isAvailable,
  isExcluded,
  requirementForEntry,
  routingPool,
  triedListForRequirement,
  withMinimumFreeFallbacks,
  withReason,
} from "./rules-assignment/helpers.js";
import { matchModel, mergeAndDedupe, sortByPreference, MATCH_STRATEGIES } from "./model-matching.js";
import { createAiMatcher } from "../ai-matcher.js";

function recommendationFor(
  entry,
  primary,
  fallbacks,
  cloudLookup,
  isProviderAllowed,
  excluded,
  options = {},
) {
  return {
    name: entry.name,
    type: entry.type,
    profile: entry.section.description || entry.section.model_quality || "",
    model: primary,
    routing: routingPool(primary, fallbacks),
    ruleChainMatched: options.ruleChainMatched === true,
    fallback_models: withMinimumFreeFallbacks({
      primary,
      fallbacks: fallbackProviderPool(primary, fallbacks),
      cloudLookup,
      isProviderAllowed,
      excluded,
    }),
  };
}

function unresolvedFallbackRecommendation({
  cloudLookup,
  entry,
  excluded,
  isProviderAllowed,
  isModelAllowed,
  requirement,
  unresolved,
}) {
  const fallbackCandidates = fallbackOutsideRuleChain(
    cloudLookup,
    isProviderAllowed,
    isModelAllowed,
  )
    .filter((candidate) => !isExcluded(candidate, excluded));
  if (fallbackCandidates.length === 0) {
    unresolved.push(entry.name);
    return null;
  }
  const [primary, ...fallbacks] = fallbackCandidates;
  unresolved.push(`${entry.name} (tried: ${triedListForRequirement(requirement)})`);
  return recommendationFor(
    entry,
    primary,
    fallbacks,
    cloudLookup,
    isProviderAllowed,
    excluded,
  );
}

export function createRuleBasedRecommendations({
  config,
  cloudLookup,
  excludeModels = [],
  isProviderAllowed = () => true,
  isModelAllowed = () => true,
  aiMatcher = null,
}) {
  const excluded = excludedModelSet(excludeModels);
  const cloudRecommendations = [];
  const unresolved = [];

  // Create AI matcher lazily if not provided
  const effectiveAiMatcher = aiMatcher || createAiMatcher([], {});

  for (const entry of allConfigEntries(config)) {
    const requirement = requirementForEntry(entry);
    if (!requirement) continue;
    const candidates = expandChain(requirement, cloudLookup)
      .filter((candidate) => !isExcluded(candidate, excluded))
      .filter((candidate) =>
        isAvailable(candidate, cloudLookup, isProviderAllowed, isModelAllowed),
      )
      .filter((candidate) => !isExcluded(candidate, excluded));
    if (candidates.length === 0) {
      // Use new three-stage matching pipeline when no rule-chain candidates
      const recommendation = createRuleBasedRecommendationWithPipeline({
        cloudLookup,
        entry,
        excluded,
        isProviderAllowed,
        isModelAllowed,
        requirement,
        unresolved,
        effectiveAiMatcher,
      });
      if (recommendation) cloudRecommendations.push(recommendation);
      continue;
    }
    const [primary, ...fallbacks] = candidates.map(withReason);
    cloudRecommendations.push(recommendationFor(
      entry,
      primary,
      fallbacks,
      cloudLookup,
      isProviderAllowed,
      excluded,
      { ruleChainMatched: true },
    ));
  }

  const excludedText = excluded.size > 0
    ? ` Excluded by override: ${[...excluded].join(", ")}.`
    : "";
  const unresolvedText = unresolved.length > 0
    ? ` No available rule-chain models for: ${unresolved.join(", ")}.`
    : "";

  const filesText = [
    "- https://github.com/code-yeongyu/oh-my-openagent/blob/dev/packages/model-core/src/agent-model-requirements.ts",
    "- https://github.com/code-yeongyu/oh-my-openagent/blob/dev/packages/model-core/src/category-model-requirements.ts"
  ].join("\n");

  return {
    analysis: `Assigned from upstream oh-my-openagent model fallback rules after loading provider availability.\n${filesText}${excludedText}${unresolvedText ? `\n${unresolvedText}` : ""}`,
    cloudRecommendations,
    localModels: { decisions: [], placements: [] },
    recommender: "rules(model-core)",
  };
}

function createRuleBasedRecommendationWithPipeline({
  cloudLookup,
  entry,
  excluded,
  isProviderAllowed,
  isModelAllowed,
  requirement,
  unresolved,
  aiMatcher,
}) {
  // Three-stage matching pipeline when no rule-chain candidates exist
  const matches = [];
  
  // FallbackChain entries — iterated by Stages 1 and 2 so that
  // `requirement.model` is properly set (the requirement object
  // has `fallbackChain`, not a direct `model`, but matchModel
  // needs an explicit model ref to score against).
  const fallbackChain = requirement?.fallbackChain || [];
  
  // Stage 1: Deterministic matching — iterate over fallbackChain entries
  // so matchModel receives a proper model name for exact/alias matching.
  // Only providers listed in the chain entry's providers list are considered
  // (to avoid matching identical model names from arbitrary unknown providers).
  if (cloudLookup?.byId) {
    for (const chainEntry of fallbackChain) {
      if (!chainEntry.model) continue;
      const chainReq = { ...requirement, model: chainEntry.model };
      for (const [provider, modelMap] of Object.entries(cloudLookup.byId)) {
        if (!isProviderAllowed(provider) || !modelMap || modelMap.size === 0) continue;
        if (!chainEntry.providers?.includes(provider)) continue;
        
        const deterministicMatches = matchModel(chainReq, modelMap, MATCH_STRATEGIES.DETERMINISTIC);
        // Fix provider: metadata from cloudLookup doesn't carry the provider field,
        // so matchModel falls back to "unknown". Override with the correct provider.
        const filtered = deterministicMatches
          .map((m) => ({ ...m, provider }))
          .filter((m) => !isExcluded({ provider: m.provider, model: m.model }, excluded));
        matches.push(...filtered);
      }
    }
  }
  
  // Stage 2: Machine-readable matching (if deterministic found nothing)
  if (matches.length === 0 && cloudLookup?.byId) {
    for (const chainEntry of fallbackChain) {
      if (!chainEntry.model) continue;
      const chainReq = { ...requirement, model: chainEntry.model };
      for (const [provider, modelMap] of Object.entries(cloudLookup.byId)) {
        if (!isProviderAllowed(provider) || !modelMap || modelMap.size === 0) continue;
        if (!chainEntry.providers?.includes(provider)) continue;
        
        const machineReadableMatches = matchModel(chainReq, modelMap, MATCH_STRATEGIES.MACHINE_READABLE);
        const filtered = machineReadableMatches
          .map((m) => ({ ...m, provider }))
          .filter((m) => !isExcluded({ provider: m.provider, model: m.model }, excluded));
        matches.push(...filtered);
      }
    }
  }
  
  // Stage 3: AI matching (if both previous stages found nothing)
  if (matches.length === 0 && cloudLookup?.byId && aiMatcher) {
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
  }
  
  // Merge and deduplicate matches (preserving all distinct provider/model pairs)
  const mergedMatches = mergeAndDedupe(matches);
  
  // Sort by preference using requirement order
  const providerPreferenceOrder = requirement?.fallbackChain?.flatMap(entry => entry.providers || []) || [];
  const sortedMatches = sortByPreference(mergedMatches, providerPreferenceOrder);
  
  // If no matches at all, fall back to unresolvedFallbackRecommendation
  if (sortedMatches.length === 0) {
    return unresolvedFallbackRecommendation({
      cloudLookup,
      entry,
      excluded,
      isProviderAllowed,
      isModelAllowed,
      requirement,
      unresolved,
    });
  }
  
  // Use the first match as primary, rest as fallbacks
  const [primary, ...fallbacks] = sortedMatches.map((match, index) => ({
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
  
  unresolved.push(`${entry.name} (tried: ${triedListForRequirement(requirement)})`);
  return recommendationFor(
    entry,
    primary,
    fallbacks,
    cloudLookup,
    isProviderAllowed,
    excluded,
  );
}
