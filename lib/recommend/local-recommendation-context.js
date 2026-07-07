import { allConfigEntries } from "../consensus.js";
import { normalizeLocalModelName } from "../omo-shared.js";
import {
  buildHardwareDeficitWarning,
  chooseLocalFallbackForEntry,
  classifyCandidateSpecialty,
  estimateKvCacheGb,
  fitsGpu,
  inferEntryRequirement,
  parseParameterCountB,
  rankLocalCandidates,
} from "./local-recommendation-engine.js";
import { normalizeCandidateCard, buildDynamicFittingModelMap } from "./local/candidate-normalization.js";
import { buildEntryContexts } from "./local/entry-context.js";

const LOCAL_PROVIDER = "local";

function finiteNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

export function buildLocalRecommendationContext({
  config,
  gpu,
  ollama,
  allLocalModels,
  cloudLookup,
  cloudOnlyFlag,
  localOnlyFlag,
}) {
  const installedNames = new Set(
    (ollama?.models || [])
      .map((model) => normalizeLocalModelName(model?.name))
      .filter(Boolean),
  );
  const candidateCards = (allLocalModels || [])
    .map((model) => normalizeCandidateCard(model, installedNames))
    .filter(Boolean);
  const fittingByName = buildDynamicFittingModelMap(candidateCards, gpu);
  for (const candidate of candidateCards) {
    candidate.fits = fittingByName.has(candidate.name);
  }
  const entryContexts = buildEntryContexts({
    config,
    candidates: candidateCards,
    cloudLookup,
    gpu,
    cloudOnlyFlag,
  });

  return {
    inputs: {
      config,
      gpu,
      ollama,
      allLocalModels,
      cloudLookup,
      cloudOnlyFlag,
      localOnlyFlag,
    },
    candidateCards,
    fittingByName,
    ...entryContexts,
  };
}
