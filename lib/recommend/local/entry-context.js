import { allConfigEntries } from "../../consensus.js";
import {
  AGENT_MODEL_REQUIREMENTS,
  CATEGORY_MODEL_REQUIREMENTS,
} from "../model-requirements.js";
import {
  buildHardwareDeficitWarning,
  chooseLocalFallbackForEntry,
  inferEntryRequirement,
  rankLocalCandidates,
} from "../local-recommendation-engine.js";

export function requirementSource(entry) {
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

export function buildEntryContexts({ config, candidates, cloudLookup, gpu, cloudOnlyFlag }) {
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
