import { normalizeLocalModelName } from "../../omo-shared.js";
import {
  classifyCandidateSpecialty,
  estimateKvCacheGb,
  fitsGpu,
  parseParameterCountB,
} from "../local-recommendation-engine.js";

const LOCAL_PROVIDER = "local";

function finiteNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

export function normalizeCandidateCard(model, installedNames) {
  const name = normalizeLocalModelName(model?.name);
  if (!name) return null;
  const parametersB = finiteNumber(model?.parametersB) ?? parseParameterCountB(name);
  const contextLength =
    finiteNumber(model?.contextLength) ??
    finiteNumber(model?.context_length) ??
    finiteNumber(model?.context) ??
    32000;
  const explicitWeightGb = finiteNumber(model?.weightGb) ?? finiteNumber(model?.weight);
  const catalogTotalVramGb = finiteNumber(model?.totalVramGb) ?? finiteNumber(model?.vram);
  const weightGb = explicitWeightGb ?? catalogTotalVramGb;
  const kvCacheGb =
    finiteNumber(model?.kvCacheGb) ??
    (weightGb === null || parametersB === null
      ? 0
      : estimateKvCacheGb({ minContext: contextLength, parametersB }));
  const candidate = {
    name,
    normalizedName: name,
    baseModel: model?.baseModel || name.split(":")[0],
    tag: name.includes(":") ? name.slice(name.lastIndexOf(":") + 1) : "latest",
    parametersB,
    contextLength,
    specialty: model?.specialty || null,
    capabilities: Array.isArray(model?.capabilities) ? model.capabilities : [],
    installed: installedNames.has(name),
    weightGb,
    kvCacheGb,
    totalVramGb: finiteNumber(model?.totalVramGb),
    fits: false,
    score: finiteNumber(model?.score) ?? 0,
    confidence: model?.confidence || "catalog",
    provenance: model?.provenance || "local-catalog",
    rejectionReasons: [],
    ref: `${LOCAL_PROVIDER}/${name}`,
  };
  const totalVramGb = candidate.totalVramGb ?? (
    candidate.weightGb === null || candidate.kvCacheGb === null
      ? null
      : candidate.weightGb + candidate.kvCacheGb
  );
  return {
    ...candidate,
    specialty: candidate.specialty || classifyCandidateSpecialty(candidate),
    totalVramGb,
  };
}

export function buildDynamicFittingModelMap(candidateCards, gpu) {
  const byName = new Map();
  for (const candidate of candidateCards) {
    if (candidate.parametersB === null) continue;
    if (!fitsGpu(candidate, gpu)) continue;
    if (!byName.has(candidate.name)) byName.set(candidate.name, candidate);
  }
  return byName;
}
