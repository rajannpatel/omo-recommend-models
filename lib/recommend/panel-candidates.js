/**
 * panel-candidates.js — Panel model candidate selection and filtering.
 *
 * Extracted from bin/omo-recommend-models (L179-380). Functions for
 * determining which cloud/CLI models are eligible for the AI panel,
 * sorting/ranking them, and selecting a diverse subset.
 *
 * NOTE: includeDetectedCliPanelModels, preferDetectedCliPanelModels, and
 * selectPreferredPanelModels remain in the main file until Step 4 when
 * discoverCliModels is extracted — they need closure access to it.
 */

import {
  splitModelRef,
  modelRef,
} from "../omo-shared.js";
import {
  panelModelFamilyLabel,
} from "../display-utils.js";
import {
  MAX_PANEL_MODELS,
  MIN_PANEL_CONTEXT_TOKENS,
  LOCAL_PROVIDER,
} from "../constants.js";
import { isProviderAvailable } from "../probe-providers.js";
import { scoreModel, panelModelOrder } from "../scoring.js";

// ---------------------------------------------------------------------------
// Provider / meta helpers
// ---------------------------------------------------------------------------

export function isCliProvider(provider) {
  return provider === "cli";
}

export function cloudModelMeta(ref, cloudLookup) {
  const { provider, model } = splitModelRef(ref);
  if (!provider || !model) return null;
  const modelMap = cloudLookup?.byId?.[provider];
  if (!modelMap) return null;
  if (modelMap instanceof Map) {
    return modelMap.get(model) || modelMap.get(ref) || null;
  }
  return modelMap[model] || modelMap[ref] || null;
}

export function contextTokenLimit(meta) {
  const raw =
    meta?.context_length ??
    meta?.context_window ??
    meta?.context ??
    meta?.max_context_tokens ??
    meta?.max_input_tokens ??
    null;
  if (raw === null || raw === undefined || raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

// ---------------------------------------------------------------------------
// Eligibility predicates
// ---------------------------------------------------------------------------

export function hasEnoughContextForPanel(ref, cloudLookup) {
  const { provider } = splitModelRef(ref);
  if (!provider || provider === LOCAL_PROVIDER || isCliProvider(provider))
    return true;
  const meta = cloudModelMeta(ref, cloudLookup);
  const limit = contextTokenLimit(meta);
  return limit === null || limit >= MIN_PANEL_CONTEXT_TOKENS;
}

export function panelCandidateFamily(ref, cloudLookup) {
  const { provider, model } = splitModelRef(ref);
  if (isCliProvider(provider)) return "cli";
  const metaFamily = String(cloudModelMeta(ref, cloudLookup)?.family || "");
  return panelModelFamilyLabel(metaFamily || model) || model.toLowerCase();
}

export function isPanelCandidateUsable(ref, cloudLookup, ctx) {
  const { provider, model } = splitModelRef(ref);
  if (!provider || !model) return false;
  if (!isProviderAvailable(ctx, provider)) return false;
  return hasEnoughContextForPanel(ref, cloudLookup);
}

export function hasPanelCandidateShapeAndContext(ref, cloudLookup) {
  const { provider, model } = splitModelRef(ref);
  if (!provider || !model) return false;
  return hasEnoughContextForPanel(ref, cloudLookup);
}

// ---------------------------------------------------------------------------
// Dedup / sorting / selection
// ---------------------------------------------------------------------------

export function uniqueModelRefs(refs) {
  const seen = new Set();
  const out = [];
  for (const ref of refs || []) {
    const trimmed = String(ref || "").trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

export function sortedPanelCandidates(refs, config, cloudLookup, ctx) {
  const uniqueRefs = uniqueModelRefs(refs);
  const filtered = uniqueRefs.filter((ref) => isPanelCandidateUsable(ref, cloudLookup, ctx));
  try {
    const mapped = filtered.map((ref, index) => {
      const { provider } = splitModelRef(ref);
      const meta = cloudModelMeta(ref, cloudLookup);
      return {
        ref,
        index,
        provider,
        family: panelCandidateFamily(ref, cloudLookup),
        score: scoreModel(ref, null, meta),
      };
    });
    const sorted = mapped.sort((a, b) => {
      const order = panelModelOrder(config);
      if (order !== "score") {
        const opencodeDiff =
          Number(b.provider === "opencode") - Number(a.provider === "opencode");
        if (opencodeDiff !== 0) return opencodeDiff;
      }
      return b.score - a.score || a.index - b.index;
    });
    return sorted;
  } catch (e) {
    console.error(e.stack);
    throw e;
  }
}

export function selectDiversePanelModels(refs, config, cloudLookup, max = MAX_PANEL_MODELS, ctx) {
  const candidates = sortedPanelCandidates(refs, config, cloudLookup, ctx);
  const selected = [];
  const usedRefs = new Set();
  const usedProviders = new Set();
  const usedFamilies = new Set();
  const select = (candidate) => {
    if (usedRefs.has(candidate.ref) || selected.length >= max) return;
    selected.push(candidate.ref);
    usedRefs.add(candidate.ref);
    usedProviders.add(candidate.provider);
    usedFamilies.add(candidate.family);
  };

  const passes = [
    (candidate) =>
      !usedProviders.has(candidate.provider) &&
      !usedFamilies.has(candidate.family),
    (candidate) => !usedProviders.has(candidate.provider),
    (candidate) => !usedFamilies.has(candidate.family),
    () => true,
  ];

  for (const pass of passes) {
    for (const candidate of candidates) {
      if (selected.length >= max) break;
      if (pass(candidate)) select(candidate);
    }
  }
  return selected;
}

// ---------------------------------------------------------------------------
// Filter helpers
// ---------------------------------------------------------------------------

export function filterUsablePanelModels(refs, cloudLookup, ctx) {
  return uniqueModelRefs(refs).filter((ref) =>
    isPanelCandidateUsable(ref, cloudLookup, ctx),
  );
}

export function filterPanelModelsForContext(refs, cloudLookup) {
  return uniqueModelRefs(refs).filter((ref) =>
    hasPanelCandidateShapeAndContext(ref, cloudLookup),
  );
}

// ---------------------------------------------------------------------------
// Recommendation predicates
// ---------------------------------------------------------------------------

export function isUsableRecommendation(rec, cloudLookup, ctx) {
  if (!rec || !rec.provider || !rec.model) return false;
  if (!isProviderAvailable(ctx, rec.provider)) return false;
  if (rec.provider === LOCAL_PROVIDER || isCliProvider(rec.provider)) return true;
  return hasEnoughContextForPanel(modelRef(rec.provider, rec.model), cloudLookup);
}

export function isUsableForConfig(rec, cloudLookup) {
  if (!rec || !rec.provider || !rec.model) return false;
  if (rec.provider === LOCAL_PROVIDER || isCliProvider(rec.provider)) return true;
  return hasEnoughContextForPanel(modelRef(rec.provider, rec.model), cloudLookup);
}

// ---------------------------------------------------------------------------
// CLI panel model display helpers
// ---------------------------------------------------------------------------

export function describeCliPanelModel(ref) {
  const id = splitModelRef(ref).model;
  if (id === "codex") return "cli/codex (Codex CLI)";
  return `cli/${id}`;
}

export function printCliPanelDisclosure(models, source) {
  const cliModels = uniqueModelRefs(models).filter(
    (ref) => splitModelRef(ref).provider === "cli",
  );
  if (cliModels.length === 0) return;
  console.log(
    `  \u2022 ${source} CLI panel agents: ${cliModels.map(describeCliPanelModel).join(", ")}\n`,
  );
}
