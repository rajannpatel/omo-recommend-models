// =========================================================================
// Consensus and recommendation utilities
// Extracted from omo-recommend-models monolith
// =========================================================================

import { modelRef } from "./omo-shared.js";
import { normalizeRecommendation } from "./display-utils.js";

/**
 * Iterates config.agents and config.categories returning an array of
 * { name, type, section } entries.
 */
export function allConfigEntries(config) {
  return [
    ...Object.entries(config.agents || {}).map(([name, section]) => ({
      name,
      type: "agent",
      section,
    })),
    ...Object.entries(config.categories || {}).map(([name, section]) => ({
      name,
      type: "category",
      section,
    })),
  ];
}

/**
 * Deduplicates recommendation objects by their provider/model ref.
 * Uses normalizeRecommendation from display-utils and modelRef from omo-shared.
 */
export function uniqueByModelRef(recommendations) {
  const seen = new Set();
  const out = [];
  for (const rec of recommendations) {
    const normalized = normalizeRecommendation(rec);
    if (!normalized) continue;
    const key = modelRef(normalized.provider, normalized.model);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

/**
 * Removes duplicates from fallbackModels and filters out entries
 * matching the primary model ref.
 */
export function finalizeFallbackModels(primary, fallbackModels) {
  const primaryKey =
    primary && primary.provider && primary.model
      ? modelRef(primary.provider, primary.model)
      : null;
  return uniqueByModelRef(fallbackModels || []).filter(
    (rec) => modelRef(rec.provider, rec.model) !== primaryKey,
  );
}

/**
 * Computes consensus recommendations from panel model votes.
 *
 * @param {Array} state - Array of { name, type, results: [{ model, recommendation }], done, consensus }
 * @param {Array} agents - Array of { name, type, section }
 * @param {Array} models - Array of model ref strings (panel models)
 * @param {Object} ctx - RuntimeContext instance
 * @param {Function} isProviderAvailableFn - Function(ctx, provider) => boolean
 * @returns {Object} { cloudRecommendations, recommender, analysis }
 */
export function computeConsensus(state, agents, models, ctx, isProviderAvailableFn) {
  const cloudRecommendations = [];

  for (let i = 0; i < agents.length; i++) {
    const entry = agents[i];
    const st = state[i];
    if (!st || !st.results) continue;

    // Collect valid results (those with model.provider)
    const validResults = st.results.filter((result) => {
      const rec = result?.recommendation;
      return rec?.model?.provider && rec?.model?.model;
    });

    if (validResults.length === 0) continue;

    const modelVotes = {};
    const modelReasons = {};
    const routingVotes = {};
    const fbVotes = {};

    for (const { recommendation: rec } of validResults) {
      // Primary model votes
      if (
        rec.model &&
        rec.model.provider &&
        rec.model.model &&
        isProviderAvailableFn(ctx, rec.model.provider)
      ) {
        const key = `${rec.model.provider}/${rec.model.model}`;
        modelVotes[key] = (modelVotes[key] || 0) + 1;
        if (rec.model.reason) modelReasons[key] = rec.model.reason;
      }

      // Routing votes
      for (const r of rec.routing || []) {
        if (
          r.provider &&
          r.model &&
          isProviderAvailableFn(ctx, r.provider)
        ) {
          const key = `${r.provider}/${r.model}`;
          routingVotes[key] = (routingVotes[key] || 0) + 1;
        }
      }

      // Fallback votes
      for (const r of rec.fallback_models || []) {
        if (
          r.provider &&
          r.model &&
          isProviderAvailableFn(ctx, r.provider)
        ) {
          const key = `${r.provider}/${r.model}`;
          fbVotes[key] = (fbVotes[key] || 0) + 1;
        }
      }
    }

    const total = validResults.length;
    const majority = total / 2;
    const sortedModels = Object.entries(modelVotes).sort((a, b) => b[1] - a[1]);

    let consensusRec = null;
    if (sortedModels.length > 0) {
      const [winnerKey, winnerCount] = sortedModels[0];
      const [provider, ...modelParts] = winnerKey.split("/");
      consensusRec = {
        name: entry.name,
        type: entry.type,
        profile: entry.section.description || entry.section.model_quality || "",
        model: {
          provider,
          model: modelParts.join("/"),
          reason: `${winnerCount}/${total} models${
            modelReasons[winnerKey] ? " \u2014 " + modelReasons[winnerKey] : ""
          }`,
        },
        routing: [],
        fallback_models: [],
      };

      // Routing: majority support
      for (const [key, count] of Object.entries(routingVotes).sort(
        (a, b) => b[1] - a[1],
      )) {
        if (count > majority) {
          const [rp, ...rm] = key.split("/");
          consensusRec.routing.push({
            provider: rp,
            model: rm.join("/"),
            reason: `${count}/${total} models`,
          });
        }
      }

      // Fallback: majority support
      for (const [key, count] of Object.entries(fbVotes).sort(
        (a, b) => b[1] - a[1],
      )) {
        if (count > majority) {
          const [fp, ...fm] = key.split("/");
          consensusRec.fallback_models.push({
            provider: fp,
            model: fm.join("/"),
            reason: `${count}/${total} models`,
          });
        }
      }

      // Note if no majority
      if (winnerCount <= majority) {
        consensusRec.model.reason = `Plurality (${winnerCount}/${total} models) \u2014 no majority`;
      }
    }

    st.consensus = consensusRec;
    if (consensusRec) cloudRecommendations.push(consensusRec);
  }

  // Build final result
  const recommender = `panel(${models.map((m) => m.split("/").pop()).join("+")})`;
  const analysis = `Per-agent consensus across ${models.length} panel models for ${agents.length} agent(s)`;

  return {
    cloudRecommendations,
    recommender,
    analysis,
  };
}
