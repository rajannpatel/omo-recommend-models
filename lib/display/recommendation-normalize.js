import { LOCAL_PROVIDER } from "../constants.js";
import { normalizeLocalModelName } from "../omo-shared.js";
import { resolveFittingLocalName } from "./local-fitting.js";

export function normalizeLocalRecommendation(rec, fittingByName, allowLocal) {
  const normalized = normalizeRecommendation(rec);
  if (!normalized) {
    const provider = String(rec?.provider || "").trim();
    const localName =
      allowLocal && !provider
        ? resolveFittingLocalName(rec?.model, fittingByName)
        : "";
    return localName ? { ...rec, provider: LOCAL_PROVIDER, model: localName } : null;
  }
  if (normalized.provider !== LOCAL_PROVIDER) return normalized;
  if (!allowLocal) return null;
  const localName = resolveFittingLocalName(normalized.model, fittingByName);
  return localName ? { ...normalized, provider: LOCAL_PROVIDER, model: localName } : null;
}

function rankedLocalNameSet(localRecommendationContext, entryName) {
  if (!(localRecommendationContext?.rankedCandidatesByEntry instanceof Map)) return null;
  if (!localRecommendationContext.rankedCandidatesByEntry.has(entryName)) return null;
  return new Set(
    (localRecommendationContext.rankedCandidatesByEntry.get(entryName) || [])
      .map((candidate) => normalizeLocalModelName(candidate?.name))
      .filter(Boolean),
  );
}

export function resultHasRejectedLocal(aiResult, fittingByName, localRecommendationContext = null) {
  const hasRejected = (rec, allowLocal, entryName = "") => {
    const normalized = normalizeRecommendation(rec);
    const entryLocalNames = rankedLocalNameSet(localRecommendationContext, entryName);
    const acceptsLocal = (modelName) => {
      const name = normalizeLocalModelName(modelName);
      if (!name) return false;
      return entryLocalNames
        ? entryLocalNames.has(name)
        : Boolean(resolveFittingLocalName(name, fittingByName));
    };
    if (!normalized) {
      const provider = String(rec?.provider || "").trim();
      const rawModel = String(rec?.model || "").trim();
      return Boolean(rawModel && !provider && (!allowLocal || !acceptsLocal(rawModel)));
    }
    if (normalized.provider !== LOCAL_PROVIDER) return false;
    return !allowLocal || !acceptsLocal(normalized.model);
  };

  for (const rec of Array.isArray(aiResult?.cloudRecommendations) ? aiResult.cloudRecommendations : []) {
    const norm = normalizeAgentRec({ ...rec });
    if (hasRejected(norm.model, true, norm.name)) return true;
    if ((norm.routing || []).some((r) => hasRejected(r, false, norm.name))) return true;
    if ((norm.fallback_models || []).some((r) => hasRejected(r, true, norm.name))) return true;
  }
  for (const decision of aiResult?.localModels?.decisions || []) {
    if (!resolveFittingLocalName(decision?.name, fittingByName)) return true;
  }
  for (const placement of aiResult?.localModels?.placements || []) {
    if (hasRejected({ provider: LOCAL_PROVIDER, model: placement?.modelName }, true, placement?.agentName)) return true;
  }
  return false;
}

export function normalizeAgentRec(rec) {
  if (!rec || typeof rec !== "object") return rec;
  if (rec.model && !rec.recommendations) return rec;
  if (rec.recommendations && Array.isArray(rec.recommendations)) {
    const recommendations = rec.recommendations.filter((item) => item?.provider && item?.model);
    if (recommendations.length > 0) {
      rec.model = recommendations[0];
      rec.routing = [];
      rec.fallback_models = recommendations.slice(1);
    }
    delete rec.recommendations;
  }
  if (!rec.model) rec.model = null;
  if (!rec.routing) rec.routing = [];
  if (!rec.fallback_models) rec.fallback_models = [];
  return rec;
}

export function normalizeRecommendation(rec) {
  if (!rec || typeof rec !== "object") return null;
  const provider = String(rec.provider || "").trim();
  const rawModel = String(rec.model || "").trim();
  if (!provider && !rawModel) return null;

  const isLocal =
    provider === "ollama" ||
    provider === LOCAL_PROVIDER ||
    rawModel.startsWith("ollama/") ||
    rawModel.startsWith("local/");
  let normalizedProvider = provider;
  let normalizedModel = rawModel;

  if (isLocal) {
    const localName = normalizeLocalModelName(rawModel);
    if (!localName) return null;
    normalizedProvider = LOCAL_PROVIDER;
    normalizedModel = localName;
  } else if (provider && rawModel) {
    const prefix = `${provider}/`;
    normalizedModel = rawModel.startsWith(prefix) ? rawModel.slice(prefix.length) : rawModel;
  }

  if (!isLocal && (!normalizedProvider || !normalizedModel)) return null;
  return { ...rec, provider: normalizedProvider, model: normalizedModel };
}
