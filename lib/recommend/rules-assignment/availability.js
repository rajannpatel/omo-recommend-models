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
