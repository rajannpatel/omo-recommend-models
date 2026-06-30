/**
 * recommendation-finalizer.js — Finalize AI recommendations with local model
 * backfill, cloud provider fill-in, and normalization.
 *
 * Extracted from bin/omo-recommend-models (L1102-1396). All pure functions
 * that take their dependencies explicitly.
 */

import {
  modelRef,
  normalizeLocalModelName,
} from "../omo-shared.js";
import {
  normalizeAgentRec,
  normalizeLocalRecommendation,
  resolveFittingLocalName,
  buildFittingModelMap,
  buildFittingModels,
} from "../display-utils.js";
import {
  hasEnoughContextForPanel,
  isUsableForConfig,
} from "./panel-candidates.js";
import {
  allConfigEntries,
  uniqueByModelRef,
  finalizeFallbackModels,
} from "../consensus.js";
import {
  installedLocalNameSet,
} from "../apply-local.js";
import {
  scoreModel,
} from "../scoring.js";
import {
  LOCAL_PROVIDER,
} from "../constants.js";

// ---------------------------------------------------------------------------
// Helper: best cloud model for a provider
// ---------------------------------------------------------------------------

export function bestCloudRecommendationForProvider(provider, modelMap, cloudLookup) {
  let best = null;
  for (const [id, meta] of modelMap || []) {
    const ref = modelRef(provider, id);
    if (!hasEnoughContextForPanel(ref, cloudLookup)) continue;
    const score = scoreModel(ref, null, meta);
    if (!best || score > best.score) {
      best = {
        provider,
        model: id,
        reason: `Best available ${provider} fallback`,
        score,
      };
    }
  }
  if (!best) return null;
  const { score, ...rec } = best; void score;
  return rec;
}

// ---------------------------------------------------------------------------
// Helper: best local (Ollama) model fitting VRAM
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Helper: local model for a specific agent entry
// ---------------------------------------------------------------------------

export function localModelForEntry(aiResult, entryName, allLocalModels, gpu, ollama) {
  const fittingByName = buildFittingModelMap(allLocalModels, gpu);
  const placements = aiResult.localModels?.placements || [];
  const placement = placements.find(
    (p) => p.agentName === entryName && p.modelName,
  );
  if (placement) {
    const name = resolveFittingLocalName(placement.modelName, fittingByName);
    if (name) return { name, role: placement.role || "fallback" };
  }

  const usable = (aiResult.localModels?.decisions || [])
    .filter((d) => d.action === "install" || d.action === "keep")
    .map((d) => normalizeLocalModelName(d.name))
    .filter((name) => resolveFittingLocalName(name, fittingByName));
  if (usable.length > 0) return { name: usable[0], role: "fallback" };

  const fallback = bestLocalModel(allLocalModels, gpu, ollama);
  return fallback
    ? { name: normalizeLocalModelName(fallback.name), role: "fallback" }
    : null;
}

// ---------------------------------------------------------------------------
// Helper: ensure a local model has a decision record
// ---------------------------------------------------------------------------

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
    (d) => normalizeLocalModelName(d.name) === name,
  );
  if (existing) {
    existing.name = name;
    if (existing.action !== "keep" && existing.action !== "install")
      existing.action = action;
    if (!existing.rationale)
      existing.rationale = "Required as the local fallback model.";
    return;
  }
  decisions.push({
    name,
    action,
    rationale: "Required as the local fallback model.",
  });
}

// ---------------------------------------------------------------------------
// Complete AI recommendations: normalize, fill in missing cloud providers,
// add local model fallback, deduplicate
// ---------------------------------------------------------------------------

export function completeAiRecommendations(
  aiResult,
  config,
  cloudLookup,
  allLocalModels,
  gpu,
  ollama,
  isProviderAllowed = () => true,
) {
  const completed = aiResult || {};
  const fittingByName = buildFittingModelMap(allLocalModels, gpu);
  completed.localModels = completed.localModels || {
    decisions: [],
    placements: [],
  };
  completed.localModels.decisions = Array.isArray(
    completed.localModels.decisions,
  )
    ? completed.localModels.decisions
        .map((d) => ({
          ...d,
          name: resolveFittingLocalName(d.name, fittingByName),
        }))
        .filter((d) => d.name)
    : [];
  completed.localModels.placements = Array.isArray(
    completed.localModels.placements,
  )
    ? completed.localModels.placements
        .map((p) => ({
          ...p,
          modelName: resolveFittingLocalName(p.modelName, fittingByName),
        }))
        .filter((p) => p.modelName && p.agentName)
    : [];

  // Normalize all cloud recommendations to the new shape
  const entries = allConfigEntries(config);
  const recByName = new Map();
  for (const rec of Array.isArray(completed.cloudRecommendations)
    ? completed.cloudRecommendations
    : []) {
    if (!rec || !rec.name) continue;
    const norm =
      rec.model || rec.recommendations ? normalizeAgentRec({ ...rec }) : rec;
    norm.model = normalizeLocalRecommendation(norm.model, fittingByName, true);
    if (
      norm.model &&
      (!isProviderAllowed(norm.model.provider) ||
        !isUsableForConfig(norm.model, cloudLookup))
    ) {
      norm.model = null;
    }
    norm.routing = (norm.routing || [])
      .map((r) => normalizeLocalRecommendation(r, fittingByName, false))
      .filter(
        (r) =>
          r && isProviderAllowed(r.provider) && isUsableForConfig(r, cloudLookup),
      );
    norm.fallback_models = (norm.fallback_models || [])
      .map((r) => normalizeLocalRecommendation(r, fittingByName, true))
      .filter(
        (r) =>
          r && isProviderAllowed(r.provider) && isUsableForConfig(r, cloudLookup),
      );
    recByName.set(norm.name, norm);
  }

  const cloudProviders = Object.entries(cloudLookup.byId || {}).filter(
    ([provider, modelMap]) =>
      provider !== LOCAL_PROVIDER &&
      isProviderAllowed(provider) &&
      modelMap &&
      modelMap.size > 0 &&
      [...modelMap].some(([id]) =>
        hasEnoughContextForPanel(modelRef(provider, id), cloudLookup),
      ),
  );

  for (const entry of entries) {
    let rec = recByName.get(entry.name);
    if (!rec) {
      rec = {
        name: entry.name,
        type: entry.type,
        profile: entry.section.description || entry.section.model_quality || "",
        model: null,
        routing: [],
        fallback_models: [],
      };
    }
    rec.type = rec.type || entry.type;
    rec.profile =
      rec.profile ||
      entry.section.description ||
      entry.section.model_quality ||
      "";
    rec.model = normalizeLocalRecommendation(rec.model, fittingByName, true);
    if (
      rec.model &&
      (!isProviderAllowed(rec.model.provider) ||
        !isUsableForConfig(rec.model, cloudLookup))
    ) {
      rec.model = null;
    }
    rec.routing = (rec.routing || [])
      .map((r) => normalizeLocalRecommendation(r, fittingByName, false))
      .filter(
        (r) =>
          r && isProviderAllowed(r.provider) && isUsableForConfig(r, cloudLookup),
      );
    rec.fallback_models = (rec.fallback_models || [])
      .map((r) => normalizeLocalRecommendation(r, fittingByName, true))
      .filter(
        (r) =>
          r && isProviderAllowed(r.provider) && isUsableForConfig(r, cloudLookup),
      );

    if (rec.model && rec.model.provider === LOCAL_PROVIDER) {
      ensureLocalDecision(completed, rec.model.model, allLocalModels, gpu, ollama);
    }
    for (const r of rec.routing) {
      if (r && r.provider === LOCAL_PROVIDER) {
        ensureLocalDecision(completed, r.model, allLocalModels, gpu, ollama);
      }
    }
    for (const r of rec.fallback_models) {
      if (r && r.provider === LOCAL_PROVIDER) {
        ensureLocalDecision(completed, r.model, allLocalModels, gpu, ollama);
      }
    }

    // Collect present providers across model + routing + fallback_models
    const presentProviders = new Set();
    if (rec.model && rec.model.provider)
      presentProviders.add(rec.model.provider);
    for (const r of rec.routing) {
      if (r.provider) presentProviders.add(r.provider);
    }
    for (const r of rec.fallback_models) {
      if (r.provider) presentProviders.add(r.provider);
    }

    // Fill in missing cloud providers as fallback_models
    for (const [provider, modelMap] of cloudProviders) {
      if (presentProviders.has(provider)) continue;
      const fallback = bestCloudRecommendationForProvider(
        provider,
        modelMap,
        cloudLookup,
      );
      if (fallback) {
        rec.fallback_models.push(fallback);
        presentProviders.add(provider);
      }
    }

    // Add local model if missing
    const localPick = localModelForEntry(
      completed,
      entry.name,
      allLocalModels,
      gpu,
      ollama,
    );
    if (localPick && !presentProviders.has(LOCAL_PROVIDER)) {
      const localRec = {
        provider: LOCAL_PROVIDER,
        model: localPick.name,
        reason:
          localPick.role === "primary"
            ? "Local primary selected for this role"
            : "Local fallback for offline or quota-limited operation",
      };
      if (localPick.role === "primary") {
        // Move current model to fallback, promote local to model
        if (rec.model) rec.fallback_models.unshift(rec.model);
        rec.model = localRec;
      } else {
        rec.fallback_models.push(localRec);
      }
      presentProviders.add(LOCAL_PROVIDER);
    }

    if (localPick) {
      ensureLocalDecision(
        completed,
        localPick.name,
        allLocalModels,
        gpu,
        ollama,
      );
      if (
        !completed.localModels.placements.some(
          (p) => p.agentName === entry.name,
        )
      ) {
        completed.localModels.placements.push({
          modelName: localPick.name,
          agentName: entry.name,
          role: localPick.role || "fallback",
          justification: "Required as the local fallback model.",
        });
      }
    }

    // Deduplicate and order runtime fallbacks after all sources have contributed.
    rec.fallback_models = finalizeFallbackModels(
      rec.model,
      rec.fallback_models,
    );
    if (!rec.model && rec.fallback_models.length > 0) {
      rec.model = rec.fallback_models.shift();
    }
    rec.routing = uniqueByModelRef(rec.routing);
    recByName.set(entry.name, rec);
  }

  const seenDecisionNames = new Set();
  completed.localModels.decisions = completed.localModels.decisions.filter(
    (d) => {
      const name = resolveFittingLocalName(d.name, fittingByName);
      if (!name || seenDecisionNames.has(name)) return false;
      seenDecisionNames.add(name);
      d.name = name;
      return true;
    },
  );
  completed.cloudRecommendations = entries
    .map((entry) => recByName.get(entry.name))
    .filter(Boolean);
  return completed;
}
