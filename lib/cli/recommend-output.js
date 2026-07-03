import { formatAiAnalysis } from "../display-utils.js";
import { applicableCloudAssignment } from "../recommend/finalized-recommendations.js";
import { normalizeLocalModelName } from "../omo-shared.js";

export function showCloudRecommendations({
  aiResult,
  config,
  confirmedModels = null,
  excludeFreeFromConfig = false,
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
    const assignment = applicableCloudAssignment({
      confirmedModels,
      excludeFreeFromConfig,
      isProviderAllowed,
      rec,
      section,
    });
    if (!assignment?.hasChanges) continue;
    changes.push({ section, name: rec.name });

    const aiTag = rec.aiUsedModel ? ` (ranked by ${rec.aiUsedModel})` : "";
    console.log(`│  \u2022 ${pathPrefix}.${rec.name}${aiTag}`);
    console.log(`│    \u25E6 model: ${assignment?.modelString || ""}`);
    if (assignment?.fallbackStrings.length > 0) {
      console.log("│    \u25E6 fallback_models:");
      assignment.fallbackStrings.forEach((fb, idx) => {
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

function groupWarningsByGpu(warnings) {
  const groups = new Map();
  for (const warning of warnings) {
    const key = `${warning.gpuName}|||${warning.budgetGb}`;
    if (!groups.has(key)) {
      groups.set(key, {
        gpuName: warning.gpuName,
        budgetGb: warning.budgetGb,
        scope: warning.scope || "local",
        items: [],
      });
    }
    groups.get(key).items.push({
      specialty: warning.specialty,
      entryName: warning.entryName,
    });
  }
  return [...groups.values()];
}

export function showLocalWarnings(localRecommendationContext) {
  const warnings = localRecommendationContext?.warnings?.aggregate || [];
  if (warnings.length === 0) return;
  const groups = groupWarningsByGpu(warnings);
  console.log("│");
  for (const group of groups) {
    console.log(`◇  ${group.items.length} warnings for ${group.gpuName} with a ${group.budgetGb}GB budget`);
    for (const item of group.items) {
      console.log(`│  \u2022 No recommended local ${item.specialty} model available for ${item.entryName}`);
    }
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
      console.log(`◇  AI analysis recommends installing these ${items.length} local models`);
    } else {
      console.log(`◇  ${label} (${items.length})`);
    }
    for (const decision of items) {
      printDecisionDetails(decision);
    }
  }
}

export function showAiAnalysis(aiResult) {
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
