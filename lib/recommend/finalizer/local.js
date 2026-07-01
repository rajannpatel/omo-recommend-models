import { normalizeLocalModelName } from "../../omo-shared.js";
import {
  buildFittingModelMap,
  buildFittingModels,
  normalizeLocalRecommendation,
  resolveFittingLocalName,
} from "../../display-utils.js";
import { installedLocalNameSet } from "../../apply-local.js";
import { LOCAL_PROVIDER } from "../../constants.js";

export function bestLocalModel(allLocalModels, gpu, ollama) {
  const installed = installedLocalNameSet(ollama);
  const candidates = buildFittingModels(allLocalModels, gpu);
  candidates.sort((a, b) => {
    const scoreDiff = (b.score || 0) - (a.score || 0);
    if (scoreDiff !== 0) return scoreDiff;
    return (
      Number(installed.has(normalizeLocalModelName(b.name))) -
      Number(installed.has(normalizeLocalModelName(a.name)))
    );
  });
  return candidates[0] || null;
}

export function localModelForEntry(aiResult, entryName, allLocalModels, gpu, ollama) {
  const fittingByName = buildFittingModelMap(allLocalModels, gpu);
  const placements = aiResult.localModels?.placements || [];
  const placement = placements.find(
    (item) => item.agentName === entryName && item.modelName,
  );
  if (placement) {
    const name = resolveFittingLocalName(placement.modelName, fittingByName);
    if (name) return { name, role: placement.role || "fallback" };
  }

  const usable = (aiResult.localModels?.decisions || [])
    .filter((decision) => decision.action === "install" || decision.action === "keep")
    .map((decision) => normalizeLocalModelName(decision.name))
    .filter((name) => resolveFittingLocalName(name, fittingByName));
  if (usable.length > 0) return { name: usable[0], role: "fallback" };

  const fallback = bestLocalModel(allLocalModels, gpu, ollama);
  return fallback
    ? { name: normalizeLocalModelName(fallback.name), role: "fallback" }
    : null;
}

export function contextBestLocalForEntry(entryName, localRecommendationContext, fittingByName) {
  const bestLocalByEntry = localRecommendationContext?.bestLocalByEntry;
  const contextPick = bestLocalByEntry instanceof Map
    ? bestLocalByEntry.get(entryName)
    : bestLocalByEntry?.[entryName];
  const rankedCandidates = localRecommendationContext?.rankedCandidatesByEntry instanceof Map
    ? localRecommendationContext.rankedCandidatesByEntry.get(entryName) || []
    : [];
  const rawName = normalizeLocalModelName(contextPick?.model);
  const candidate = [...rankedCandidates, ...(localRecommendationContext?.candidateCards || [])].find(
    (card) => normalizeLocalModelName(card?.name) === rawName,
  );
  const normalized = normalizeLocalRecommendation(
    contextPick,
    rawName && (candidate || fittingByName.has(rawName))
      ? new Map([[rawName, candidate || fittingByName.get(rawName)]])
      : fittingByName,
    true,
  );
  if (!normalized || normalized.provider !== LOCAL_PROVIDER) return null;
  const installedCandidate = candidate || (localRecommendationContext?.candidateCards || []).find(
    (card) => normalizeLocalModelName(card?.name) === normalized.model,
  );
  return {
    name: normalized.model,
    role: "fallback",
    reason: normalized.reason,
    installed: typeof contextPick?.installed === "boolean"
      ? contextPick.installed
      : installedCandidate?.installed,
  };
}

export function ensureLocalDecision(aiResult, modelName, allLocalModels, gpu, ollama) {
  const name = resolveFittingLocalName(
    modelName,
    buildFittingModelMap(allLocalModels, gpu),
  );
  if (!name) return;
  const installed = installedLocalNameSet(ollama);
  const action = installed.has(name) ? "keep" : "install";
  const decisions = aiResult.localModels.decisions;
  const existing = decisions.find(
    (decision) => normalizeLocalModelName(decision.name) === name,
  );
  if (existing) {
    existing.name = name;
    if (existing.action !== "keep" && existing.action !== "install") {
      existing.action = action;
    }
    if (!existing.rationale) {
      existing.rationale = "Used after cloud models are unavailable.";
    }
    return;
  }
  decisions.push({
    name,
    action,
    rationale: "Used after cloud models are unavailable.",
  });
}

export function ensureSelectedLocalDecision(aiResult, localPick, allLocalModels, gpu, ollama) {
  const name = normalizeLocalModelName(localPick?.name);
  if (!name) return;
  const existing = aiResult.localModels.decisions.find(
    (decision) => normalizeLocalModelName(decision.name) === name,
  );
  if (typeof localPick.installed !== "boolean") {
    ensureLocalDecision(aiResult, name, allLocalModels, gpu, ollama);
    return;
  }
  const action = localPick.installed ? "keep" : "install";
  if (existing) {
    existing.name = name;
    existing.action = action;
    if (!existing.rationale) {
      existing.rationale = localPick.reason || "Used after cloud models are unavailable.";
    }
    return;
  }
  aiResult.localModels.decisions.push({
    name,
    action,
    rationale: localPick.reason || "Used after cloud models are unavailable.",
  });
}

export function dedupeLocalDecisions(completed, fittingByName) {
  const seenDecisionNames = new Set();
  completed.localModels.decisions = completed.localModels.decisions.filter((decision) => {
    const name = resolveFittingLocalName(decision.name, fittingByName);
    if (!name || seenDecisionNames.has(name)) return false;
    seenDecisionNames.add(name);
    decision.name = name;
    return true;
  });
}
