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
    if (meta && meta.capabilities && meta.capabilities.toolcall !== true) continue;
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
