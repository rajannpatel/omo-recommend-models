import { allConfigEntries } from "../consensus.js";
import {
  computeFreeModelCandidates,
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
import { runPipelineStages, buildPipelineRecommendation } from "./rules-assignment/pipeline.js";

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
      precomputedFreeCandidates: options.precomputedFreeCandidates,
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
  expandedChain,
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
  unresolved.push(`${entry.name} (tried: ${triedListForRequirement(requirement, expandedChain)})`);
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

  // Pre-compute free model candidates once to avoid recomputing for each entry.
  const precomputedFreeCandidates = computeFreeModelCandidates(cloudLookup, isProviderAllowed, excluded);

  for (const entry of allConfigEntries(config)) {
    const requirement = requirementForEntry(entry);
    if (!requirement) continue;
    const expandedChain = expandChain(requirement, cloudLookup);
    const candidates = expandedChain
      .filter((candidate) => !isExcluded(candidate, excluded))
      .filter((candidate) =>
        isAvailable(candidate, cloudLookup, isProviderAllowed, isModelAllowed),
      );
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
        expandedChain,
        precomputedFreeCandidates,
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
      { ruleChainMatched: true, precomputedFreeCandidates },
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
  expandedChain,
  precomputedFreeCandidates,
}) {
  // Three-stage matching pipeline when no rule-chain candidates exist
  const fallbackChain = requirement?.fallbackChain || [];
  
  const matches = runPipelineStages(fallbackChain, cloudLookup, requirement, isProviderAllowed, excluded, aiMatcher)
    .filter((m) => isModelAllowed({ provider: m.provider, model: m.model }));
  
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
      expandedChain,
    });
  }
  
  // Use the first match as primary, rest as fallbacks
  const [primary, ...fallbacks] = buildPipelineRecommendation(sortedMatches, requirement);
  
  unresolved.push(`${entry.name} (tried: ${triedListForRequirement(requirement, expandedChain)})`);
  return recommendationFor(
    entry,
    primary,
    fallbacks,
    cloudLookup,
    isProviderAllowed,
    excluded,
    { precomputedFreeCandidates },
  );
}
