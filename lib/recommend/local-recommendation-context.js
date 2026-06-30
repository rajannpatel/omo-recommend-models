import { allConfigEntries } from "../consensus.js";
import { normalizeLocalModelName } from "../omo-shared.js";
import {
  AGENT_MODEL_REQUIREMENTS,
  CATEGORY_MODEL_REQUIREMENTS,
} from "./model-requirements.js";
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

const LOCAL_PROVIDER = "local";

function finiteNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function requirementSource(entry) {
  return entry.type === "category"
    ? CATEGORY_MODEL_REQUIREMENTS[entry.name]
    : AGENT_MODEL_REQUIREMENTS[entry.name];
}

function chainRefsForEntry(entry) {
  const requirement = requirementSource(entry);
  const refs = [];
  for (const chainEntry of requirement?.fallbackChain || []) {
    for (const provider of chainEntry.providers || []) {
      refs.push(`${provider}/${chainEntry.model}`);
    }
  }
  return refs;
}

function metadataByRefFromCloudLookup(cloudLookup) {
  const metadataByRef = new Map();
  for (const [provider, modelMap] of Object.entries(cloudLookup?.byId || {})) {
    for (const [model, metadata] of modelMap || []) {
      metadataByRef.set(`${provider}/${model}`, metadata);
    }
  }
  return metadataByRef;
}

function normalizeCandidateCard(model, installedNames) {
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

function buildDynamicFittingModelMap(candidateCards, gpu) {
  const byName = new Map();
  for (const candidate of candidateCards) {
    if (candidate.parametersB === null) continue;
    if (!fitsGpu(candidate, gpu)) continue;
    if (!byName.has(candidate.name)) byName.set(candidate.name, candidate);
  }
  return byName;
}

function buildEntryContexts({ config, candidates, cloudLookup, gpu, cloudOnlyFlag }) {
  const metadataByRef = metadataByRefFromCloudLookup(cloudLookup);
  const requirementsByEntry = new Map();
  const bestLocalByEntry = new Map();
  const rankedCandidatesByEntry = new Map();
  const warningsByEntry = new Map();
  const aggregateWarnings = [];

  for (const entry of allConfigEntries(config)) {
    const requirement = inferEntryRequirement({
      entryName: entry.name,
      entryType: entry.type,
      chainRefs: chainRefsForEntry(entry),
      metadataByRef,
    });
    requirementsByEntry.set(entry.name, requirement);

    const ranked = rankLocalCandidates({ candidates, requirement, gpu });
    rankedCandidatesByEntry.set(entry.name, ranked);
    const best = chooseLocalFallbackForEntry({
      recommendation: null,
      requirement,
      candidates,
      gpu,
    });
    if (best) bestLocalByEntry.set(entry.name, best);

    const warning = buildHardwareDeficitWarning({
      requirement,
      candidates,
      gpu,
      cloudOnly: cloudOnlyFlag,
    });
    if (warning) {
      warningsByEntry.set(entry.name, warning);
      aggregateWarnings.push(warning);
    }
  }

  return {
    requirementsByEntry,
    bestLocalByEntry,
    rankedCandidatesByEntry,
    warnings: {
      aggregate: aggregateWarnings,
      byEntry: warningsByEntry,
    },
  };
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
