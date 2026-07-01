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

    console.log(`  \u2022 ${pathPrefix}.${rec.name}`);
    console.log(`    model: ${newModel || ""}`);
    if (newFallbacks.length > 0) {
      console.log(`    fallback_models: ${newFallbacks.join(", ")}`);
    }
    console.log();
  }
  return changes;
}

function localDecisionDetails(name, allLocalModels, localRecommendationContext) {
  const normalizedName = normalizeLocalModelName(name);
  const contextCard = (localRecommendationContext?.candidateCards || []).find(
    (card) => normalizeLocalModelName(card?.name) === normalizedName,
  );
  if (contextCard) {
    return `  (total ${contextCard.totalVramGb ?? "?"} GB VRAM, weight ${contextCard.weightGb ?? "?"} GB, KV ${contextCard.kvCacheGb ?? "?"} GB, score ${contextCard.score ?? 0}, ${contextCard.installed ? "installed" : "missing"})`;
  }
  const catalogModel = allLocalModels.find(
    (model) => normalizeLocalModelName(model.name) === normalizedName,
  );
  return catalogModel
    ? `  (${catalogModel.size}, ${catalogModel.vram} GB VRAM, score ${catalogModel.score})`
    : "";
}

export function showLocalWarnings(localRecommendationContext) {
  const warnings = localRecommendationContext?.warnings?.aggregate || [];
  if (warnings.length === 0) return;
  console.log(`\n── Local recommendation warnings (${warnings.length}) ───────────`);
  for (const warning of warnings) console.log(`  • ${warning}`);
}

export function showLocalPlacements(aiResult, confirmedModels = null) {
  if (!aiResult.localModels) return [];
  const placements = aiResult.localModels.placements || [];
  const visiblePlacements = confirmedModels
    ? placements.filter((p) => confirmedModels.has(normalizeLocalModelName(p.modelName)))
    : placements;
  if (visiblePlacements.length === 0) return [];

  console.log(
    `\n── Local fallback entries to write (${visiblePlacements.length}) ────────`,
  );
  for (const placement of visiblePlacements) {
    const target = placement.role === "primary" ? "model" : "fallback_models";
    const action = placement.role === "primary" ? "set" : "add";
    console.log(`  • ${placement.agentName}: ${action} ${placement.modelName} to ${target}`);
    if (placement.justification) console.log(`    Why: ${placement.justification}`);
  }
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
  const groups = [
    ["install", "AI: Install"],
    ["keep", "AI: Keep"],
    ["uninstall", "AI: Uninstall"],
    ["skip", "AI: Skip"],
  ];

  for (const [action, label] of groups) {
    const items = decisions.filter((decision) => decision.action === action);
    if (items.length === 0) continue;
    console.log(`\n── ${label} (${items.length}) ────────────────────────`);
    for (const decision of items) {
      const extra = localDecisionDetails(decision.name, allLocalModels, localRecommendationContext);
      const isInstalled = ollama.models.some((model) => model.name === decision.name);
      console.log(`  • ${decision.name}${extra}`);
      console.log(`    ${decision.rationale}`);
      if (action === "uninstall" && !isInstalled) {
        console.log("    (not installed, nothing to remove)");
      }
    }
  }
}

export function showAiAnalysis(aiResult) {
  console.log(`\n\uD83D\uDCCA AI Analysis (via ${aiResult.recommender}):`);
  for (const line of formatAiAnalysis(aiResult.analysis).split("\n")) {
    console.log(`   ${line}`);
  }
  console.log();
}
