import { LOCAL_PROVIDER } from "../constants.js";
import { formatAiAnalysis } from "../display-utils.js";
import { normalizeLocalModelName } from "../omo-shared.js";

function isConfirmedRecommendationRef(ref, confirmedModels) {
  if (!confirmedModels || !ref) return true;
  if (ref.provider !== LOCAL_PROVIDER && ref.provider !== "ollama") return true;
  return confirmedModels.has(normalizeLocalModelName(ref.model));
}

export function showCloudRecommendations({
  aiResult,
  config,
  confirmedModels = null,
  isProviderAllowed,
}) {
  if (!aiResult.cloudRecommendations || aiResult.cloudRecommendations.length === 0) {
    return [];
  }

  const changes = [];
  for (const rec of aiResult.cloudRecommendations) {
    const section = config.agents?.[rec.name] || config.categories?.[rec.name];
    if (!section) continue;

    const pathPrefix = rec.type === "category" ? "categories" : "agents";
    const prevModel = section.model;
    const prevProvider = prevModel?.split("/")[0];
    const prevModelAvailable = prevProvider ? isProviderAllowed(prevProvider) : false;
    const recommendedModelAllowed = isConfirmedRecommendationRef(
      rec.model,
      confirmedModels,
    );
    const newModel =
      recommendedModelAllowed && rec.model?.provider && rec.model?.model
        ? `${rec.model.provider}/${rec.model.model}`
        : (prevModelAvailable ? prevModel : null);
    const newFallbacks = (rec.fallback_models || [])
      .filter((ref) => ref.provider && ref.model)
      .filter((ref) => isConfirmedRecommendationRef(ref, confirmedModels))
      .map((ref) => `${ref.provider}/${ref.model}`);
    const hasPrevConfig = prevModel || section.fallback_models?.length > 0;
    const anyChanged = (prevModel || null) !== newModel || newFallbacks.length > 0;

    if (!anyChanged && !hasPrevConfig) continue;
    if (anyChanged) changes.push({ section, name: rec.name });

    console.log(`│  \u2022 ${pathPrefix}.${rec.name}`);
    console.log(`│    model: ${newModel || ""}`);
    if (newFallbacks.length > 0) {
      console.log("│    fallback_models:");
      newFallbacks.forEach((fb, idx) => {
        console.log(`│      ${idx + 1}. ${fb}`);
      });
    }
    console.log("│");
  }
  return changes;
}

function localDecisionDetails(name, allLocalModels, localRecommendationContext) {
  const normalizedName = normalizeLocalModelName(name);
  const contextCard = (localRecommendationContext?.candidateCards || []).find(
    (card) => normalizeLocalModelName(card?.name) === normalizedName,
  );
  if (contextCard) {
    const parts = [
      `Total ${contextCard.totalVramGb ?? "?"} GB VRAM`,
      `weight ${contextCard.weightGb ?? "?"} GB`,
      `KV ${contextCard.kvCacheGb ?? "?"} GB`,
    ];
    return parts;
  }
  const catalogModel = allLocalModels.find(
    (model) => normalizeLocalModelName(model.name) === normalizedName,
  );
  if (catalogModel) {
    return [
      `Size ${catalogModel.size}`,
      `VRAM ${catalogModel.vram} GB`,
    ];
  }
  return [];
}

export function showLocalWarnings(localRecommendationContext) {
  const warnings = localRecommendationContext?.warnings?.aggregate || [];
  if (warnings.length === 0) return;
  console.log("│");
  console.log(`◇  Local recommendation warnings (${warnings.length})`);
  for (const warning of warnings) {
    console.log(`│  • ${warning}`);
  }
}

export function showLocalPlacements(aiResult, confirmedModels = null) {
  if (!aiResult.localModels) return [];
  const placements = aiResult.localModels.placements || [];
  const visiblePlacements = confirmedModels
    ? placements.filter((p) => confirmedModels.has(normalizeLocalModelName(p.modelName)))
    : placements;
  return visiblePlacements;
}

export function showLocalModelDecisions({
  aiResult,
  allLocalModels,
  ollama,
  localRecommendationContext = null,
}) {
  if (!aiResult.localModels) return;
  const decisions = aiResult.localModels.decisions || [];

  function printDecisionDetails(decision) {
    const extraParts = localDecisionDetails(decision.name, allLocalModels, localRecommendationContext);
    const isInstalled = ollama.models.some((model) => model.name === decision.name);
    let lineText = `${decision.name} - ${decision.rationale}`;
    lineText = lineText.replace(" - Best ", "  is the best ");
    console.log("│");
    console.log(`│  • ${lineText}`);
    for (const part of extraParts) {
      console.log(`│    \u25E6 ${part}`);
    }
    if (decision.action === "uninstall" && !isInstalled) {
      console.log("│      (not installed, nothing to remove)");
    }
  }

  const groups = [
    ["install", null],
    ["uninstall", "AI: Uninstall"],
    ["skip", "AI: Skip"],
  ];

  // Handle keep action split
  const keepItems = decisions.filter((d) => d.action === "keep");
  const installedKeep = keepItems.filter((d) => ollama.models.some((m) => m.name === d.name));
  const missingKeep = keepItems.filter((d) => !ollama.models.some((m) => m.name === d.name));

  if (installedKeep.length > 0) {
    console.log("│");
    console.log(`◇  AI analysis recommends having these ${installedKeep.length} installed local models in the fallback_models rule-chain`);
    for (const decision of installedKeep) {
      printDecisionDetails(decision);
    }
  }

  if (missingKeep.length > 0) {
    console.log("│");
    console.log(`◇  AI analysis recommends having these ${missingKeep.length} missing local models in the fallback_models rule-chain`);
    for (const decision of missingKeep) {
      printDecisionDetails(decision);
    }
  }

  for (const [action, label] of groups) {
    const items = decisions.filter((decision) => decision.action === action);
    if (items.length === 0) continue;
    console.log("│");
    if (action === "install") {
      console.log(`◇  AI analysis recommends these ${items.length} local models`);
    } else {
      console.log(`◇  ${label} (${items.length})`);
    }
    for (const decision of items) {
      printDecisionDetails(decision);
    }
  }
}

export function showAiAnalysis(aiResult) {
  console.log("│");
  if (aiResult.recommender === "rules(model-core)") {
    console.log("◇  AI Analysis of available providers/models against recommended oh-my-openagent model rule-chains in:");
    const lines = formatAiAnalysis(aiResult.analysis).split("\n");
    for (const line of lines.slice(1)) {
      if (line === "") {
        console.log("│");
        continue;
      }
      let formattedLine = line;
      if (line.trim().startsWith("- ")) {
        const trimmed = line.trim();
        formattedLine = `\u2022 ${trimmed.slice(2)}`;
      }
      console.log(`│  ${formattedLine}`);
    }
  } else {
    console.log(`◇  AI Analysis (via ${aiResult.recommender}):`);
    for (const line of formatAiAnalysis(aiResult.analysis).split("\n")) {
      if (line === "") {
        console.log("│");
        continue;
      }
      console.log(`│  ${line}`);
    }
  }
}
