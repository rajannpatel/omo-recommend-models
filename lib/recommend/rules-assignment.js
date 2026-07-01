import { allConfigEntries } from "../consensus.js";
import { MODEL_REQUIREMENTS_SOURCE } from "./model-requirements.js";
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

function recommendationFor(
  entry,
  primary,
  fallbacks,
  cloudLookup,
  isProviderAllowed,
  excluded,
) {
  return {
    name: entry.name,
    type: entry.type,
    profile: entry.section.description || entry.section.model_quality || "",
    model: primary,
    routing: routingPool(primary, fallbacks),
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
}) {
  const excluded = excludedModelSet(excludeModels);
  const cloudRecommendations = [];
  const unresolved = [];

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
      const recommendation = unresolvedFallbackRecommendation({
        cloudLookup,
        entry,
        excluded,
        isProviderAllowed,
        isModelAllowed,
        requirement,
        unresolved,
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
    analysis: `Assigned from upstream oh-my-openagent model fallback rules after loading provider availability.\n${filesText}${excludedText}${unresolvedText}`,
    cloudRecommendations,
    localModels: { decisions: [], placements: [] },
    recommender: "rules(model-core)",
    source: MODEL_REQUIREMENTS_SOURCE,
  };
}
