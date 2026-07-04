// =========================================================================
// Consensus and recommendation utilities
// Extracted from omo-recommend-models monolith
// =========================================================================

import { modelRef } from "./omo-shared.js";
import { normalizeRecommendation } from "./display-utils.js";

/**
 * Iterates config.agents and config.categories returning an array of
 * { name, type, section } entries.
 */
export function allConfigEntries(config) {
  return [
    ...Object.entries(config.agents || {}).map(([name, section]) => ({
      name,
      type: "agent",
      section,
    })),
    ...Object.entries(config.categories || {}).map(([name, section]) => ({
      name,
      type: "category",
      section,
    })),
  ];
}

/**
 * Deduplicates recommendation objects by their provider/model ref.
 * Uses normalizeRecommendation from display-utils and modelRef from omo-shared.
 */
export function uniqueByModelRef(recommendations) {
  const seen = new Set();
  const out = [];
  for (const rec of recommendations) {
    const normalized = normalizeRecommendation(rec);
    if (!normalized) continue;
    const key = modelRef(normalized.provider, normalized.model);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

/**
 * Removes duplicates from fallbackModels and filters out entries
 * matching the primary model ref.
 */
export function finalizeFallbackModels(primary, fallbackModels) {
  const primaryKey =
    primary && primary.provider && primary.model
      ? modelRef(primary.provider, primary.model)
      : null;
  return uniqueByModelRef(fallbackModels || []).filter(
    (rec) => modelRef(rec.provider, rec.model) !== primaryKey,
  );
}
