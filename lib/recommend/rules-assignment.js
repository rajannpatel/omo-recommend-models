import { allConfigEntries, finalizeFallbackModels } from "../consensus.js";
import {
  AGENT_MODEL_REQUIREMENTS,
  CATEGORY_MODEL_REQUIREMENTS,
  MODEL_REQUIREMENTS_SOURCE,
} from "./model-requirements.js";

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

function isAvailable(candidate, cloudLookup) {
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

function requirementForEntry(entry) {
  return entry.type === "category"
    ? CATEGORY_MODEL_REQUIREMENTS[entry.name]
    : AGENT_MODEL_REQUIREMENTS[entry.name];
}

export function createRuleBasedRecommendations({
  config,
  cloudLookup,
  excludeModels = [],
}) {
  const excluded = excludedModelSet(excludeModels);
  const cloudRecommendations = [];
  const unresolved = [];

  for (const entry of allConfigEntries(config)) {
    const requirement = requirementForEntry(entry);
    if (!requirement) continue;

    const candidates = expandChain(requirement)
      .filter((candidate) => !isExcluded(candidate, excluded))
      .filter((candidate) => isAvailable(candidate, cloudLookup));

    if (candidates.length === 0) {
      unresolved.push(entry.name);
      continue;
    }

    const [primary, ...fallbacks] = candidates.map(withReason);
    cloudRecommendations.push({
      name: entry.name,
      type: entry.type,
      profile: entry.section.description || entry.section.model_quality || "",
      model: primary,
      routing: [],
      fallback_models: finalizeFallbackModels(primary, fallbacks),
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
