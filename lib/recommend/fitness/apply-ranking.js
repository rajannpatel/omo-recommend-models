import { matchModelRef } from "./ref-matching.js";

export function applyRanking(rec, modelRef, ranked, ruleChainMatched) {
  const allModels = ruleChainMatched
    ? [...rec.fallback_models]
    : [rec.model, ...rec.fallback_models];
  const refToModel = {};
  const allRefs = allModels.map((model) => {
    const ref = `${model.provider}/${model.model}`;
    refToModel[ref] = model;
    return ref;
  });
  const rankIndex = {};
  ranked.forEach((ref, index) => {
    const matched = matchModelRef(ref, allRefs);
    if (matched) rankIndex[matched] = index;
  });
  allRefs.sort((left, right) => {
    const leftIndex = rankIndex[left] ?? Infinity;
    const rightIndex = rankIndex[right] ?? Infinity;
    return leftIndex - rightIndex;
  });
  if (ruleChainMatched) {
    rec.fallback_models = allRefs.map((ref) => refToModel[ref]);
  } else {
    const [bestModel, ...orderedFallbacks] = allRefs.map((ref) => refToModel[ref]);
    rec.model = bestModel;
    rec.fallback_models = orderedFallbacks;
  }
  rec.aiUsedModel = modelRef;
}
