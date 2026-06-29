// =========================================================================
// Display and formatting utility functions
// (extracted from omo-recommend-models monolith)
// =========================================================================

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { normalizeLocalModelName } from "./omo-shared.js";
import {
  LOCAL_PROVIDER,
  MAX_PANEL_MODELS,
  MIN_PANEL_CONTEXT_TOKENS,
} from "./constants.js";
import {
  scoreModel,
  panelModelOrder,
  sortPanelModelRefs,
  detectFamilyFromMeta,
} from "./scoring.js";

// =========================================================================
// Panel model family labeling
// =========================================================================

export function panelModelFamilyLabel(modelName, meta = null) {
  const model = String(modelName || "").toLowerCase();
  
  // If metadata available, use it for family detection
  if (meta) {
    const detected = detectFamilyFromMeta(meta, modelName);
    if (detected.family) return detected.family;
  }
  
  // Fallback: generic family detection from model name patterns
  // These are generic tier/category indicators, not vendor-specific
  if (model.includes("opus") || model.includes("pro-max") || model.includes("ultra")) return "flagship";
  if (model.includes("sonnet") || model.includes("pro") || model.includes("plus")) return "advanced";
  if (model.includes("haiku") || model.includes("mini") || model.includes("nano") || model.includes("lite") || model.includes("small")) return "compact";
  if (model.includes("flash") || model.includes("speed") || model.includes("fast")) return "speed";
  if (model.includes("reasoning") || model.includes("think") || model.includes("r1")) return "reasoning";
  if (model.includes("codex") || model.includes("coder") || model.includes("code")) return "code";
  if (model.includes("vision") || model.includes("vl") || model.includes("multimodal")) return "vision";
  if (model.includes("embedding") || model.includes("embed")) return "embedding";
  
  // Size-based tiers
  const sizeMatch = model.match(/(\d+)b/);
  if (sizeMatch) {
    const size = parseInt(sizeMatch[1]);
    if (size >= 70) return "xxlarge";
    if (size >= 30) return "xlarge";
    if (size >= 13) return "large";
    if (size >= 7) return "medium";
    return "small";
  }
  
  return "unknown";
}

// =========================================================================
// Panel model grouping and display
// =========================================================================

export function groupPanelModelRefs(models, cloudLookup = null) {
  const groupOrder = [];
  const byGroup = new Map();
  for (const ref of models || []) {
    const trimmed = String(ref || "").trim();
    if (!trimmed) continue;
    const slash = trimmed.indexOf("/");
    const provider = slash === -1 ? "unknown" : trimmed.slice(0, slash);
    const model = slash === -1 ? trimmed : trimmed.slice(slash + 1);
    
    // Get metadata for this model if cloudLookup available
    let meta = null;
    if (cloudLookup) {
      const modelMap = cloudLookup.byId?.[provider];
      if (modelMap) {
        meta = modelMap.get(model) || modelMap.get(ref) || null;
      }
    }
    
    const family = provider === "cli" ? "agents" : panelModelFamilyLabel(model, meta);
    const label = provider === "cli"
      ? "CLI agents"
      : provider === "opencode"
        ? "opencode"
        : family
          ? `${provider}/${family}`
          : provider;
    if (!byGroup.has(label)) {
      byGroup.set(label, []);
      groupOrder.push(label);
    }
    byGroup.get(label).push({ ref: trimmed, model });
  }
  return groupOrder.map((label) => ({ label, models: byGroup.get(label) }));
}

export function printNumberedPanelModelGroups(models, indent = "  ", cloudLookup = null) {
  const groups = groupPanelModelRefs(models, cloudLookup);
  const width = String(groups.length).length;
  groups.forEach((group, index) => {
    const prefix = `${indent}${String(index + 1).padStart(width, " ")}. ${group.label}: `;
    group.models.forEach((entry, modelIdx) => {
      if (modelIdx === 0) {
        console.log(`${prefix}${entry.model}`);
      } else {
        console.log(`${" ".repeat(prefix.length)}${entry.model}`);
      }
    });
  });
  return groups.length;
}

export function printSelectablePanelModelGroups(models, indent = "  ", cloudLookup = null) {
  const groups = groupPanelModelRefs(models, cloudLookup);
  const width = String(groups.length).length;
  groups.forEach((group, index) => {
    const prefix = `${indent}[${String(index + 1).padStart(width, " ")}] ${group.label}: `;
    group.models.forEach((entry, modelIdx) => {
      if (modelIdx === 0) {
        console.log(`${prefix}${entry.model}`);
      } else {
        console.log(`${" ".repeat(prefix.length)}${entry.model}`);
      }
    });
  });
  return groups;
}

// =========================================================================
// Panel model configuration helpers
// =========================================================================

export function configuredPanelModels(config) {
  const models = config?.omo?.panel_models;
  if (!Array.isArray(models)) return [];
  return models
    .map((model) => String(model || "").trim())
    .filter(Boolean);
}

export function panelModelsRequireOpencode(models) {
  if (!Array.isArray(models) || models.length === 0) return true;
  return models.some((model) => !String(model || "").startsWith("cli/"));
}

export function selectedPanelRequiresOpencode(config, explicitModels) {
  if (explicitModels.length > 0) return panelModelsRequireOpencode(explicitModels);
  const configured = configuredPanelModels(config);
  if (configured.length > 0) return panelModelsRequireOpencode(configured);
  return true;
}

export function opencodePanelModelsFromLookup(cloudLookup) {
  const modelMap = cloudLookup?.byId?.opencode;
  if (!modelMap) return [];
  const ids =
    modelMap instanceof Map
      ? [...modelMap.keys()]
      : Object.keys(modelMap);
  return ids
    .map((id) => String(id || "").trim())
    .filter(Boolean)
    .map((id) => (id.startsWith("opencode/") ? id : `opencode/${id}`));
}

// =========================================================================
// Panel model selection
// =========================================================================

export function defaultPanelModels(config, cloudLookup = null, options = {}) {
  const discoverFn = typeof options._discoverFreeModels === "function" ? options._discoverFreeModels : () => [];
  const preferFn = typeof options._preferDetectedCliPanelModels === "function" ? options._preferDetectedCliPanelModels : (refs, cfg, cl, max) => refs.slice(0, max);
  const discovered = discoverFn(options);
  const refs =
    discovered.length > 0
      ? discovered
      : opencodePanelModelsFromLookup(cloudLookup);
  return preferFn(refs, config, cloudLookup, MAX_PANEL_MODELS, options);
}

export function plannedPanelModels(config, panelModels, cloudLookup = null, options = {}) {
  if (panelModels && panelModels.length > 0) return panelModels;
  const configured = configuredPanelModels(config);
  return configured.length > 0 ? configured : defaultPanelModels(config, cloudLookup, options);
}

// =========================================================================
// Progress display
// =========================================================================

let _progressClackState = { useClackPrompts: false, clack: null };

export function setProgressClackState(useClackPrompts, clack) {
  _progressClackState = { useClackPrompts: Boolean(useClackPrompts), clack };
}

export function createProgress(label) {
  if (_progressClackState.useClackPrompts && _progressClackState.clack?.spinner) {
    const spinner = _progressClackState.clack.spinner();
    spinner.start(label);
    return {
      update(message) {
        spinner.message(`${label}: ${message}`);
      },
      done(message = "done") {
        spinner.stop(`${label}: ${message}`);
      },
      skip(message) {
        spinner.stop(`${label}: ${message}`);
      },
    };
  }
  const start = Date.now();
  process.stdout.write(`  ⏳ ${label}...`);
  return {
    update(message) {
      process.stdout.write(`\r  ⏳ ${label}: ${message}\x1b[K`);
    },
    done(message = "done") {
      const elapsed = Math.max(0, Math.round((Date.now() - start) / 1000));
      process.stdout.write(`\r  ✓ ${label}: ${message} (${elapsed}s)\x1b[K\n`);
    },
    skip(message) {
      process.stdout.write(`\r  • ${label}: ${message}\x1b[K\n`);
    },
  };
}

// =========================================================================
// Local model fitting helpers
// =========================================================================

export function usableLocalVramGb(gpu) {
  const gpuVram = Number(gpu?.vramGb);
  if (!gpu?.hasGpu || !Number.isFinite(gpuVram)) return 0;
  return Math.max(0, gpuVram - 1.5);
}

export function buildFittingModels(allLocalModels, gpu) {
  const usableVramGb = usableLocalVramGb(gpu);
  return (allLocalModels || [])
    .filter((model) => {
      const modelVram = Number(model?.vram);
      return Boolean(
        model &&
        normalizeLocalModelName(model.name) &&
        Number.isFinite(modelVram) &&
        modelVram >= 0 &&
        modelVram <= usableVramGb,
      );
    })
    .map((model) => ({ ...model, name: normalizeLocalModelName(model.name) }));
}

export function buildFittingModelMap(allLocalModels, gpu) {
  const byName = new Map();
  for (const model of buildFittingModels(allLocalModels, gpu)) {
    if (!byName.has(model.name)) byName.set(model.name, model);
  }
  return byName;
}

export function resolveFittingLocalName(modelName, fittingByName) {
  const name = normalizeLocalModelName(modelName);
  return name && fittingByName.has(name) ? name : "";
}

// =========================================================================
// Recommendation normalization
// =========================================================================

export function normalizeLocalRecommendation(rec, fittingByName, allowLocal) {
  const normalized = normalizeRecommendation(rec);
  if (!normalized) {
    const provider = String(rec?.provider || "").trim();
    const localName =
      allowLocal && !provider
        ? resolveFittingLocalName(rec?.model, fittingByName)
        : "";
    return localName
      ? { ...rec, provider: LOCAL_PROVIDER, model: localName }
      : null;
  }
  if (normalized.provider !== LOCAL_PROVIDER) return normalized;
  if (!allowLocal) return null;
  const localName = resolveFittingLocalName(normalized.model, fittingByName);
  return localName
    ? { ...normalized, provider: LOCAL_PROVIDER, model: localName }
    : null;
}

export function resultHasRejectedLocal(aiResult, fittingByName) {
  const hasRejected = (rec, allowLocal) => {
    const normalized = normalizeRecommendation(rec);
    if (!normalized) {
      const provider = String(rec?.provider || "").trim();
      const rawModel = String(rec?.model || "").trim();
      return Boolean(
        rawModel &&
        !provider &&
        (!allowLocal || !resolveFittingLocalName(rawModel, fittingByName)),
      );
    }
    if (normalized.provider !== LOCAL_PROVIDER) return false;
    if (!allowLocal) return true;
    return !resolveFittingLocalName(normalized.model, fittingByName);
  };

  for (const rec of Array.isArray(aiResult?.cloudRecommendations)
    ? aiResult.cloudRecommendations
    : []) {
    const norm = normalizeAgentRec({ ...rec });
    if (hasRejected(norm.model, true)) return true;
    if ((norm.routing || []).some((r) => hasRejected(r, false))) return true;
    if ((norm.fallback_models || []).some((r) => hasRejected(r, true)))
      return true;
  }
  for (const decision of aiResult?.localModels?.decisions || []) {
    if (!resolveFittingLocalName(decision?.name, fittingByName)) return true;
  }
  for (const placement of aiResult?.localModels?.placements || []) {
    if (!resolveFittingLocalName(placement?.modelName, fittingByName))
      return true;
  }
  return false;
}

/**
 * Normalize per-agent recommendation from either the old format (flat `recommendations` array)
 * or the new format (separate `model`, `routing`, `fallback_models` fields).
 * Always produces the new shape with model/routing/fallback_models.
 */
export function normalizeAgentRec(rec) {
  if (!rec || typeof rec !== "object") return rec;
  // Already has new shape — ensure arrays exist
  if (rec.model && !rec.recommendations) return rec;
  // Old shape: flatten recommendations[0] -> model, rest -> fallback_models
  if (rec.recommendations && Array.isArray(rec.recommendations)) {
    const r = rec.recommendations.filter((x) => x && x.provider && x.model);
    if (r.length > 0) {
      rec.model = r[0];
      rec.routing = [];
      rec.fallback_models = r.slice(1);
    }
    delete rec.recommendations;
  }
  // Ensure fields exist
  if (!rec.model) rec.model = null;
  if (!rec.routing) rec.routing = [];
  if (!rec.fallback_models) rec.fallback_models = [];
  return rec;
}

export function normalizeRecommendation(rec) {
  if (!rec || typeof rec !== "object") return null;
  const provider = String(rec.provider || "").trim();
  const rawModel = String(rec.model || "").trim();
  if (!provider && !rawModel) return null;

  const isLocal =
    provider === "ollama" ||
    provider === LOCAL_PROVIDER ||
    rawModel.startsWith("ollama/") ||
    rawModel.startsWith("local/");
  let normalizedProvider = provider;
  let normalizedModel = rawModel;

  if (isLocal) {
    const localName = normalizeLocalModelName(rawModel);
    if (!localName) return null;
    normalizedProvider = LOCAL_PROVIDER;
    normalizedModel = localName;
  } else if (provider && rawModel) {
    const prefix = `${provider}/`;
    normalizedModel = rawModel.startsWith(prefix)
      ? rawModel.slice(prefix.length)
      : rawModel;
  }

  if (!isLocal) {
    if (!normalizedProvider) return null;
    if (!normalizedModel) return null;
  }

  return { ...rec, provider: normalizedProvider, model: normalizedModel };
}
