// =========================================================================
// Model scoring functions (extracted from omo-recommend-models)
// =========================================================================

import { VARIANT_BONUS } from "./constants.js";

// =========================================================================
// Generic family detection from metadata (replaces hardcoded FAMILY_TIERS)
// =========================================================================

function detectFamilyFromMeta(meta, modelName) {
  // Safely get capabilities as array
  let caps = [];
  if (meta && meta.capabilities) {
    if (Array.isArray(meta.capabilities)) {
      caps = meta.capabilities;
    } else if (typeof meta.capabilities === 'string') {
      caps = [meta.capabilities];
    }
  }
  caps = caps.map(c => String(c).toLowerCase());
  
  const family = (meta?.family || "").toLowerCase();
  const name = (modelName || "").toLowerCase();
  
  // Detect reasoning capability
  const hasReasoning = caps.some(c => c.includes("reasoning"));
  
  // Detect model tier from context length and capabilities
  const ctx = meta?.context_length || meta?.context_window || 0;
  const isLargeContext = ctx > 100000;
  const isMediumContext = ctx > 32000;
  
  // Generic tier scoring based on metadata
  let baseScore = 0;
  if (hasReasoning) baseScore += 20;
  if (isLargeContext) baseScore += 10;
  else if (isMediumContext) baseScore += 5;
  
  // Cost penalty (lower cost = higher score for free models)
  const cost = meta?.cost || meta?.input_price || 0;
  if (typeof cost === "number" && !isNaN(cost)) {
    if (cost === 0) baseScore += 15; // Free models get bonus
    else baseScore -= Math.min(cost * 10, 10);
  }
  
  // Recency bonus
  if (meta?.release_date) {
    const d = new Date(meta.release_date);
    const epochDays = Math.floor(d.getTime() / 86400000);
    if (!isNaN(epochDays)) {
      baseScore += Math.max(0, epochDays - 20000) * 2;
    }
  }
  
  return { family, name, baseScore, hasReasoning, ctx, cost };
}

function scoreModelFromMeta(model, variant, meta) {
  const detected = detectFamilyFromMeta(meta, model);
  let score = detected.baseScore;
  
  // Variant bonus
  if (variant && VARIANT_BONUS[variant] !== undefined) {
    score += VARIANT_BONUS[variant];
  }
  
  // Model name heuristics for tier detection (generic, not vendor-specific)
  const lower = model.toLowerCase();
  if (lower.includes("opus") || lower.includes("pro") || lower.includes("ultra") || lower.includes("max") || lower.includes("large")) {
    score += 14;
  } else if (lower.includes("sonnet") || lower.includes("flash") || lower.includes("plus") || lower.includes("advanced")) {
    score += 8;
  } else if (lower.includes("haiku") || lower.includes("mini") || lower.includes("nano") || lower.includes("small") || lower.includes("lite")) {
    score += 3;
  }
  if (lower.includes("reasoning") || lower.includes("think")) score += 10;
  
  // Size detection from model name (e.g., "70b", "32b", "7b")
  const sizeMatch = lower.match(/(\d+)b/);
  if (sizeMatch) {
    const size = parseInt(sizeMatch[1]);
    if (size >= 70) score += 20;
    else if (size >= 30) score += 15;
    else if (size >= 13) score += 10;
    else if (size >= 7) score += 5;
  }
  
  return isNaN(score) ? 0 : score;
}



// =========================================================================
// Cloud model scoring (metadata-based, no hardcoded families)
// =========================================================================

function scoreFromCache(model, variant, entry) {
  return scoreModelFromMeta(model, variant, entry);
}

function scoreFromHeuristics(model, variant) {
  // Fallback heuristics when no metadata available - use generic tier detection
  const parts = model.split("/");
  const modelPart = parts[parts.length - 1] || "";
  let score = 0;
  const verMatch = modelPart.match(/(\d+)\.(\d+)/);
  if (verMatch) score += parseInt(verMatch[1]) * 3 + parseInt(verMatch[2]);
  const lower = modelPart.toLowerCase();
  if (
    lower.includes("opus") ||
    lower.includes("pro") ||
    lower.includes("ultra") ||
    lower.includes("max") ||
    lower.includes("large")
  )
    score += 14;
  if (
    lower.includes("sonnet") ||
    lower.includes("flash") ||
    lower.includes("plus") ||
    lower.includes("advanced") ||
    lower.includes("codex")
  )
    score += 8;
  if (
    lower.includes("haiku") ||
    lower.includes("mini") ||
    lower.includes("nano") ||
    lower.includes("small") ||
    lower.includes("lite")
  )
    score += 3;
  if (lower.includes("reasoning") || lower.includes("think")) score += 10;
  if (lower.includes("max") || lower.includes("large") || lower.includes("big"))
    score += 5;
  if (variant && VARIANT_BONUS[variant] !== undefined)
    score += VARIANT_BONUS[variant];
  const sizeMatch = modelPart.match(/(\d+)b/i);
  if (sizeMatch) {
    const size = parseInt(sizeMatch[1]);
    if (size >= 70) score += 20;
    else if (size >= 30) score += 15;
    else if (size >= 13) score += 10;
    else if (size >= 7) score += 5;
  }
  // No provider prestige - all providers treated equally
  return score;
}

export function scoreModel(model, variant, cacheEntry) {
  return cacheEntry
    ? scoreFromCache(model, variant, cacheEntry)
    : scoreFromHeuristics(model, variant);
}

function panelModelOrder(config) {
  return String(config?.omo?.panel_model_order || "opencode-first").trim();
}

export function sortPanelModelRefs(refs, config) {
  const order = panelModelOrder(config);
  const scored = refs.map((ref, index) => ({
    ref,
    index,
    provider: ref.split("/")[0],
    score: scoreModel(ref, null, null),
  }));

  if (order === "score") {
    scored.sort((a, b) => (b.score - a.score) || (a.index - b.index));
  } else {
    scored.sort((a, b) => {
      const opencodeDiff = Number(b.provider === "opencode") - Number(a.provider === "opencode");
      if (opencodeDiff !== 0) return opencodeDiff;
      return (b.score - a.score) || (a.index - b.index);
    });
  }

  return scored.map((s) => s.ref);
}
