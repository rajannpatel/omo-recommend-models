import { finalizeFallbackModels } from "../../consensus.js";
import {
  AGENT_MODEL_REQUIREMENTS,
  CATEGORY_MODEL_REQUIREMENTS,
} from "../model-requirements.js";
import { scoreModel } from "../../scoring.js";
import { LOCAL_PROVIDER } from "../../constants.js";
import { modelNamesEquivalent } from "../../omo-shared.js";

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

function requirementsCorpus() {
  return [
    ...Object.values(AGENT_MODEL_REQUIREMENTS),
    ...Object.values(CATEGORY_MODEL_REQUIREMENTS),
  ];
}

function providersKnownForModel(model) {
  const providers = new Set();
  for (const requirement of requirementsCorpus()) {
    for (const entry of requirement?.fallbackChain || []) {
      if (!modelNamesEquivalent(entry.model, model)) continue;
      for (const provider of entry.providers || []) providers.add(provider);
    }
  }
  return providers;
}

function inferredProvidersForEntry(entry, cloudLookup) {
  if (!cloudLookup?.byId) return [];
  const listedProviders = new Set(entry.providers || []);
  const inferred = [];
  for (const provider of providersKnownForModel(entry.model)) {
    if (listedProviders.has(provider)) continue;
    if (provider === LOCAL_PROVIDER || provider === "cli") continue;
    if (findActualModel(cloudLookup.byId[provider], entry.model)) {
      inferred.push(provider);
    }
  }
  return inferred;
}

export function isAvailable(candidate, cloudLookup, isProviderAllowed) {
  if (!isProviderAllowed(candidate.provider)) return false;
  const providerModels = cloudLookup?.byId?.[candidate.provider];
  const actual = findActualModel(providerModels, candidate.model);
  if (actual) {
    candidate.model = actual;
    return true;
  }
  return false;
}

export function expandChain(requirement, cloudLookup = null) {
  const out = [];
  for (const entry of requirement?.fallbackChain || []) {
    const explicitProviders = entry.providers || [];
    const providers = [
      ...explicitProviders.map((provider) => ({ provider, inferred: false })),
      ...inferredProvidersForEntry(entry, cloudLookup).map((provider) => ({
        provider,
        inferred: true,
      })),
    ];
    for (const { provider, inferred } of providers) {
      out.push({
        provider,
        model: entry.model,
        inferred,
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

export function withReason(candidate, index) {
  return {
    ...candidate,
    reason: candidate.inferred
      ? `Rule chain priority ${index + 1} (live equivalent inferred from rule corpus)`
      : `Rule chain priority ${index + 1}`,
  };
}

function isFreeCloudProvider(provider) {
  return provider === "opencode";
}

export function routingPool(primary, candidates) {
  return finalizeFallbackModels(primary, candidates)
    .sort((a, b) => {
      const freeDiff =
        Number(isFreeCloudProvider(a.provider)) -
        Number(isFreeCloudProvider(b.provider));
      if (freeDiff !== 0) return freeDiff;
      return 0;
    });
}

export function fallbackProviderPool(primary, candidates) {
  const fallbackCandidates = finalizeFallbackModels(primary, candidates);
  const byProvider = new Map();
  for (const candidate of fallbackCandidates) {
    if (!byProvider.has(candidate.provider)) byProvider.set(candidate.provider, candidate);
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

export function fallbackOutsideRuleChain(cloudLookup, isProviderAllowed) {
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
      const candidate = { provider, model, reason: "Free cloud fallback" };
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

export function withMinimumFreeFallbacks({
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

export function requirementForEntry(entry) {
  return entry.type === "category"
    ? CATEGORY_MODEL_REQUIREMENTS[entry.name]
    : AGENT_MODEL_REQUIREMENTS[entry.name];
}

export function triedListForRequirement(requirement) {
  const groups = [];
  let currentModel = null;
  let currentProviders = [];
  for (const candidate of expandChain(requirement)) {
    if (candidate.model !== currentModel) {
      if (currentModel !== null) {
        groups.push({ model: currentModel, providers: currentProviders });
      }
      currentModel = candidate.model;
      currentProviders = [candidate.provider];
    } else if (!currentProviders.includes(candidate.provider)) {
      currentProviders.push(candidate.provider);
    }
  }
  if (currentModel !== null) groups.push({ model: currentModel, providers: currentProviders });
  return groups
    .map((group) => {
      if (group.providers.length > 1) return `(${group.providers.join(", ")})/${group.model}`;
      return `${group.providers[0]}/${group.model}`;
    })
    .join(" > ");
}
