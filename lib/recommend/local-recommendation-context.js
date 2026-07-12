import { normalizeLocalModelName } from "../omo-shared.js";
import { normalizeCandidateCard, buildDynamicFittingModelMap } from "./local/candidate-normalization.js";
import { buildEntryContexts } from "./local/entry-context.js";

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
