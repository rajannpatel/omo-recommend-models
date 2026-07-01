import { LOCAL_PROVIDER } from "../constants.js";
import {
  formatModelRef as modelRef,
  normalizeLocalModelName,
} from "../omo-shared.js";

export async function applyCloudChanges(aiResult, config, _autoYes) {
  if (!aiResult.cloudRecommendations || aiResult.cloudRecommendations.length === 0) {
    return 0;
  }
  let count = 0;
  for (const rec of aiResult.cloudRecommendations) {
    const section = config.agents?.[rec.name] || config.categories?.[rec.name];
    if (!section || !rec.model) continue;
    section.model = `${rec.model.provider}/${rec.model.model}`;
    delete section.routing;
    if (rec.fallback_models?.length > 0) {
      section.fallback_models = rec.fallback_models.map((ref) => `${ref.provider}/${ref.model}`);
    } else if (section.fallback_models) {
      delete section.fallback_models;
    }
    count++;
  }
  return count;
}

export async function applyLocalPlacements(
  placements,
  config,
  autoYes,
  allLocalModels,
) {
  void autoYes;
  if (!placements || placements.length === 0) return 0;
  const byAgent = groupPlacementsByAgent(placements, config);
  let changed = 0;
  for (const [agentName, entries] of Object.entries(byAgent)) {
    changed += applyBestLocalEntry(agentName, entries, allLocalModels);
  }
  return changed;
}

function groupPlacementsByAgent(placements, config) {
  const byAgent = {};
  for (const placement of placements) {
    const section = config.agents?.[placement.agentName] || config.categories?.[placement.agentName];
    if (!section) {
      console.log(`│  \u26A0 Agent/category "${placement.agentName}" not found in config \u2014 skipping`);
      continue;
    }
    if (!byAgent[placement.agentName]) byAgent[placement.agentName] = [];
    byAgent[placement.agentName].push({
      section,
      modelName: normalizeLocalModelName(placement.modelName),
      role: placement.role,
    });
  }
  return byAgent;
}

function applyBestLocalEntry(agentName, entries, allLocalModels) {
  if (entries.length === 0) return 0;
  const section = entries[0].section;
  const bestEntry = bestScoredEntry(entries, allLocalModels);
  const localRef = modelRef(LOCAL_PROVIDER, bestEntry.modelName);
  const cleanedFallbacks = existingFallbackRefs(section).filter(
    (ref) => !ref.startsWith("local/") && !ref.startsWith("ollama/"),
  );

  if (bestEntry.role === "primary") {
    const previousPrimary =
      section.model &&
      !section.model.startsWith("local/") &&
      !section.model.startsWith("ollama/")
        ? section.model
        : null;
    section.model = localRef;
    section.fallback_models = [...new Set(previousPrimary ? [previousPrimary, ...cleanedFallbacks] : cleanedFallbacks)];
    if (section.fallback_models.length === 0) delete section.fallback_models;
    console.log(`│  \u2713 ${agentName}: local primary set to ${localRef}`);
    return 1;
  }

  if (section.model && !section.model.startsWith("local/") && !section.model.startsWith("ollama/")) {
    section.fallback_models = [...new Set([...cleanedFallbacks, localRef])];
    console.log(`│  \u2713 ${agentName}: local fallback set to ${localRef}`);
    return 1;
  }

  section.model = localRef;
  delete section.fallback_models;
  delete section.routing;
  console.log(`│  \u2713 ${agentName}: placed ${localRef}`);
  return 1;
}

function bestScoredEntry(entries, allLocalModels) {
  let bestEntry = entries[0];
  let bestScore = -1;
  for (const entry of entries) {
    const model = allLocalModels.find((candidate) => candidate.name === entry.modelName);
    const score = model ? model.score : 0;
    if (score > bestScore) {
      bestScore = score;
      bestEntry = entry;
    }
  }
  return bestEntry;
}

function existingFallbackRefs(section) {
  return Array.isArray(section.fallback_models)
    ? section.fallback_models
        .map((fallback) => (typeof fallback === "string" ? fallback : fallback.model))
        .filter(Boolean)
    : [];
}
