import { modelRef } from "../../omo-shared.js";
import { scoreModel } from "../../scoring.js";

export function bestCloudRecommendationForProvider(
  provider,
  modelMap,
  cloudLookup,
  isModelAllowed = () => true,
) {
  let best = null;
  for (const [id, meta] of modelMap || []) {
    if (!isModelAllowed({ provider, model: id })) continue;
    const ref = modelRef(provider, id);
    const score = scoreModel(ref, null, meta);
    if (!best || score > best.score) {
      best = {
        provider,
        model: id,
        reason: `Best available ${provider} fallback`,
        score,
      };
    }
  }
  if (!best) return null;
  const { score, ...rec } = best;
  void score;
  return rec;
}

/**
 * Returns ALL models from a provider (up to maxModels) scored for deduplication.
 * Internal scores are used by the finalizer for cross-provider model-name dedup.
 */
export function cloudRecommendationsForProvider(
  provider,
  modelMap,
  cloudLookup,
  isModelAllowed = () => true,
  maxModels = 10,
) {
  const results = [];
  for (const [id, meta] of modelMap || []) {
    if (!isModelAllowed({ provider, model: id })) continue;
    const ref = modelRef(provider, id);
    const score = scoreModel(ref, null, meta);
    results.push({
      provider,
      model: id,
      reason: `Available ${provider} fallback`,
      score,
    });
  }
  if (results.length === 0) return [];
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, maxModels);
}
