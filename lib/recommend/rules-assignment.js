import { allConfigEntries, finalizeFallbackModels } from "../consensus.js";
import {
  AGENT_MODEL_REQUIREMENTS,
  CATEGORY_MODEL_REQUIREMENTS,
  MODEL_REQUIREMENTS_SOURCE,
} from "./model-requirements.js";
import { scoreModel } from "../scoring.js";
import { LOCAL_PROVIDER } from "../constants.js";

function normalizeRef(value) {
  return String(value || "").trim().toLowerCase();
}

function splitRef(value) {
  const [provider, ...modelParts] = normalizeRef(value).split("/");
  return {
    provider,
    model: modelParts.join("/"),
  };
}

function excludedModelSet(values = []) {
  return new Set(
    values
      .flat()
      .filter((value) => typeof value === "string" && value.trim())
      .map(normalizeRef),
  );
}

function isExcluded(candidate, excluded) {
  const provider = normalizeRef(candidate.provider);
  const ref = `${provider}/${normalizeRef(candidate.model)}`;
  return excluded.has(provider) || excluded.has(ref);
}

function modelMapHasModel(modelMap, model) {
  if (!modelMap) return false;
  if (modelMap.has(model)) return true;
  const wanted = normalizeRef(model);
  for (const id of modelMap.keys()) {
    if (normalizeRef(id) === wanted) return true;
  }
  return false;
}

function isAvailable(candidate, cloudLookup, isProviderAllowed) {
  if (!isProviderAllowed(candidate.provider)) return false;
  const providerModels = cloudLookup?.byId?.[candidate.provider];
  return modelMapHasModel(providerModels, candidate.model);
}

function expandChain(requirement) {
  const out = [];
  for (const entry of requirement?.fallbackChain || []) {
    for (const provider of entry.providers || []) {
      out.push({
        provider,
        model: entry.model,
        variant: entry.variant || requirement.variant || undefined,
        reasoningEffort: entry.reasoningEffort,
        temperature: entry.temperature,
        top_p: entry.top_p,
        maxTokens: entry.maxTokens,
        thinking: entry.thinking,
      });
    }
  }
  return out;
}

function withReason(candidate, index) {
  return {
    ...candidate,
    reason: `Rule chain priority ${index + 1}`,
  };
}

function isFreeCloudProvider(provider) {
  return provider === "opencode";
}

function routingPool(primary, candidates) {
  return finalizeFallbackModels(primary, candidates)
    .sort((a, b) => {
      const freeDiff =
        Number(isFreeCloudProvider(a.provider)) -
        Number(isFreeCloudProvider(b.provider));
      if (freeDiff !== 0) return freeDiff;
      return 0;
    });
}

function fallbackProviderPool(primary, candidates) {
  const fallbackCandidates = finalizeFallbackModels(primary, candidates);
  const byProvider = new Map();
  for (const candidate of fallbackCandidates) {
    if (!byProvider.has(candidate.provider)) {
      byProvider.set(candidate.provider, candidate);
    }
  }
  return [...byProvider.values()];
}

function bestModelsFromProviderGroup(cloudLookup, isProviderAllowed, groupName) {
  const picks = [];
  for (const [provider, modelMap] of Object.entries(cloudLookup?.byId || {})) {
    if (
      provider === LOCAL_PROVIDER ||
      provider === "cli" ||
      !isProviderAllowed(provider) ||
      !modelMap ||
      modelMap.size === 0
    ) {
      continue;
    }
    const isFreeProvider = provider === "opencode";
    if ((groupName === "free") !== isFreeProvider) continue;
    let best = null;
    for (const [model, meta] of modelMap.entries()) {
      const score = scoreModel(`${provider}/${model}`, null, meta);
      if (!best || score > best.score) {
        best = {
          provider,
          model,
          reason: `Best available ${groupName} model outside upstream rule chain`,
          score,
        };
      }
    }
    if (best) picks.push(best);
  }
  picks.sort((a, b) => b.score - a.score);
  return picks.map(({ score, ...pick }) => {
    void score;
    return pick;
  });
}

function fallbackOutsideRuleChain(cloudLookup, isProviderAllowed) {
  return [
    ...bestModelsFromProviderGroup(cloudLookup, isProviderAllowed, "paid"),
    ...bestModelsFromProviderGroup(cloudLookup, isProviderAllowed, "free"),
  ];
}

function freeFallbackCandidates(cloudLookup, isProviderAllowed, excluded) {
  const picks = [];
  for (const [provider, modelMap] of Object.entries(cloudLookup?.byId || {})) {
    if (
      !isFreeCloudProvider(provider) ||
      !isProviderAllowed(provider) ||
      !modelMap ||
      modelMap.size === 0
    ) {
      continue;
    }
    for (const [model, meta] of modelMap.entries()) {
      const candidate = {
        provider,
        model,
        reason: "Free cloud fallback",
      };
      if (isExcluded(candidate, excluded)) continue;
      picks.push({
        ...candidate,
        score: scoreModel(`${provider}/${model}`, null, meta),
      });
    }
  }
  picks.sort((a, b) => b.score - a.score);
  return picks.map(({ score, ...pick }) => {
    void score;
    return pick;
  });
}

function withMinimumFreeFallbacks({
  primary,
  fallbacks,
  cloudLookup,
  isProviderAllowed,
  excluded,
  minimumFreeFallbacks = 2,
}) {
  const finalized = finalizeFallbackModels(primary, fallbacks);
  const freeCount = finalized.filter((candidate) =>
    isFreeCloudProvider(candidate.provider),
  ).length;
  if (freeCount >= minimumFreeFallbacks) return finalized;
  return finalizeFallbackModels(primary, [
    ...finalized,
    ...freeFallbackCandidates(cloudLookup, isProviderAllowed, excluded),
  ]);
}

function requirementForEntry(entry) {
  return entry.type === "category"
    ? CATEGORY_MODEL_REQUIREMENTS[entry.name]
    : AGENT_MODEL_REQUIREMENTS[entry.name];
}

export function createRuleBasedRecommendations({
  config,
  cloudLookup,
  excludeModels = [],
  isProviderAllowed = () => true,
}) {
  const excluded = excludedModelSet(excludeModels);
  const cloudRecommendations = [];
  const unresolved = [];

  for (const entry of allConfigEntries(config)) {
    const requirement = requirementForEntry(entry);
    if (!requirement) continue;

    const candidates = expandChain(requirement)
      .filter((candidate) => !isExcluded(candidate, excluded))
      .filter((candidate) => isAvailable(candidate, cloudLookup, isProviderAllowed));

    if (candidates.length === 0) {
      const fallbackCandidates = fallbackOutsideRuleChain(
        cloudLookup,
        isProviderAllowed,
      ).filter((candidate) => !isExcluded(candidate, excluded));
      if (fallbackCandidates.length === 0) {
        unresolved.push(entry.name);
        continue;
      }
      const [primary, ...fallbacks] = fallbackCandidates;
      unresolved.push(`${entry.name} (using best available paid/free outside rule chain)`);
      cloudRecommendations.push({
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
      });
      continue;
    }

    const chain = candidates.map(withReason);
    const [primary, ...fallbacks] = chain;
    cloudRecommendations.push({
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
    });
  }

  const excludedText = excluded.size > 0
    ? ` Excluded by override: ${[...excluded].join(", ")}.`
    : "";
  const unresolvedText = unresolved.length > 0
    ? ` No available rule-chain model for: ${unresolved.join(", ")}.`
    : "";

  return {
    analysis: `Assigned from upstream oh-my-openagent model fallback rules after loading provider availability.${excludedText}${unresolvedText}`,
    cloudRecommendations,
    localModels: { decisions: [], placements: [] },
    recommender: "rules(model-core)",
    source: MODEL_REQUIREMENTS_SOURCE,
  };
}

export function refsFromManualExclusions(values = []) {
  return [...excludedModelSet(values)].map((value) => {
    const { provider, model } = splitRef(value);
    return model ? `${provider}/${model}` : provider;
  });
}
