import { modelRef } from "../../omo-shared.js";
import { scoreModel } from "../../scoring.js";
import { hasEnoughContextForPanel } from "../panel-candidates.js";

export function bestCloudRecommendationForProvider(provider, modelMap, cloudLookup) {
  let best = null;
  for (const [id, meta] of modelMap || []) {
    const ref = modelRef(provider, id);
    if (!hasEnoughContextForPanel(ref, cloudLookup)) continue;
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
