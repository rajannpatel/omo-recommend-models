import process from "node:process";

import { discoverFreeModels } from "../shared/provider-cache.js";
import { deduplicatePerProvider } from "./recommendation-finalizer.js";
import { buildRankingPrompt, upstreamContext } from "./fitness/prompt-builder.js";
import { callOpencode } from "./fitness/opencode-runner.js";
import { parseRanking, matchModelRef } from "./fitness/ref-matching.js";
import { callCliAgent } from "./fitness/cli-runner.js";

let _resolvedFreeModels = null;

function resolveFreeModels() {
  if (_resolvedFreeModels) return _resolvedFreeModels;
  try {
    _resolvedFreeModels = discoverFreeModels();
  } catch {
    _resolvedFreeModels = [];
  }
  return _resolvedFreeModels;
}

export async function rankFallbacksByFitness(
  cloudRecommendations,
  cloudLookup = null,
  parsedArgs = null,
  config = null,
  ctx = null
) {
  const modelMetadata = {};
  if (cloudLookup?.byId) {
    for (const rec of cloudRecommendations) {
      const allRefs = [
        ...(rec.model ? [rec.model] : []),
        ...(rec.fallback_models || []),
      ];
      for (const ref of allRefs) {
        if (!ref?.provider || !ref?.model) continue;
        const key = `${ref.provider}/${ref.model}`;
        if (!modelMetadata[key]) {
          const meta = cloudLookup.byId[ref.provider]?.get(ref.model);
          if (meta) modelMetadata[key] = meta;
        }
      }
    }
  }

  const entries = cloudRecommendations
    .filter((rec) => !rec.ruleChainMatched && rec.fallback_models?.length > 1)
    .map((rec) => ({
      name: rec.name,
      type: rec.type,
      ruleChainMatched: rec.ruleChainMatched,
      profile: rec.profile || '',
      modelMetadata,
      // Rule-chain entries already have a fixed primary model — only rank fallbacks.
      // Unmatched entries get their full model set ranked (primary + fallbacks).
      allModels: rec.ruleChainMatched
        ? [...rec.fallback_models]
        : [rec.model, ...rec.fallback_models],
    }));

  let models;
  if (parsedArgs?.["agy-analysis"]) {
    models = ["cli/agy"];
  } else if (parsedArgs?.["codex-analysis"]) {
    models = ["cli/codex"];
  } else {
    const freeModelsList = resolveFreeModels();
    models = freeModelsList.length > 0 ? freeModelsList : ["opencode/mimo-v2.5-free"];
  }

  // Record which model will be used for AI analysis on rule-chain entries too,
  // even though they skip the round-robin ranking loop. This lets the output
  // show "(ranked by <model>)" consistently across all entries.
  for (const rec of cloudRecommendations) {
    if (rec.ruleChainMatched) rec.aiUsedModel = models[0] || "opencode/mimo-v2.5-free";
  }

  if (entries.length === 0) {
    return false;
  }
  const total = entries.length;
  let completedCount = 0;

  const usedModels = new Set();
  const blacklistedModels = new Set();

  const header = `◇  AI ranking ${total} agent(s)/category(ies) by model fitness — processed 0/${total}`;
  process.stdout.write(header);

  function updateProgress() {
    const newHeader = `◇  AI ranking ${total} agent(s)/category(ies) by model fitness — processed ${completedCount}/${total}`;
    process.stdout.write(`\r${newHeader}`);
  }

  async function tryModel(entriesToQuery, modelRef) {
    if (blacklistedModels.has(modelRef)) return null;

    try {
      const startMsg = `│  → ${entriesToQuery.length} entry(ies) by ${modelRef}...`;
      process.stdout.write(`\n${startMsg}`);
      let text;
      if (modelRef.startsWith("cli/")) {
        const tool = modelRef.replace(/^cli\//, "");
        text = await callCliAgent(buildRankingPrompt(entriesToQuery), tool, config, ctx);
      } else {
        text = await callOpencode(buildRankingPrompt(entriesToQuery), modelRef, ctx);
      }
      const result = parseRanking(text);
      if (result && typeof result === "object") {
        const rankedEntries = entriesToQuery.filter(
          (e) => Array.isArray(result[e.name]) && result[e.name].length > 0
        );
        if (rankedEntries.length > 0) {
          const successMsg = `✓  processed  ${rankedEntries.length}/${entriesToQuery.length} entry(ies) by ${modelRef}`;
          const clearLine = process.stdout.isTTY ? `\r${successMsg}` : `\n${successMsg}`;
          process.stdout.write(`${clearLine}\n`);
          completedCount += rankedEntries.length;
          updateProgress();
          return { modelRef, result };
        }
      }
      process.stdout.write(`\n✗  entries by ${modelRef} — invalid ranking\n`);
    } catch (err) {
      const msg = err.message
        .replace(/^opencode returned /, "")
        .replace(/^agy returned /, "")
        .replace(/^codex returned /, "");
      process.stdout.write(`\n✗  entries by ${modelRef} — ${msg}\n`);
    }
    blacklistedModels.add(modelRef);
    return null;
  }

  function applyRanking(rec, modelRef, ranked, ruleChainMatched) {
    const allModels_ = ruleChainMatched
      ? [...rec.fallback_models]
      : [rec.model, ...rec.fallback_models];
    const refToModel = {};
    const allRefs = allModels_.map((m) => {
      const ref = `${m.provider}/${m.model}`;
      refToModel[ref] = m;
      return ref;
    });
    const rankIndex = {};
    ranked.forEach((ref, i) => {
      const matched = matchModelRef(ref, allRefs);
      if (matched) rankIndex[matched] = i;
    });
    // Sort ranked models first (by AI order), then append any models the AI omitted
    allRefs.sort((a, b) => {
      const iA = rankIndex[a] ?? Infinity;
      const iB = rankIndex[b] ?? Infinity;
      return iA - iB;
    });
    if (ruleChainMatched) {
      // Rule-chain entries: keep the primary model fixed, only reorder fallbacks.
      // All ranked models remain as fallbacks — the primary is not in this set.
      rec.fallback_models = allRefs.map((ref) => refToModel[ref]);
    } else {
      const [bestModel, ...orderedFallbacks] = allRefs.map((ref) => refToModel[ref]);
      rec.model = bestModel;
      rec.fallback_models = orderedFallbacks;
    }
    rec.aiUsedModel = modelRef;
  }

  const success = new Array(entries.length).fill(false);
  let remainingEntries = [...entries];

  for (let m = 0; m < models.length; m++) {
    if (remainingEntries.length === 0) break;
    const modelRef = models[m];
    const r = await tryModel(remainingEntries, modelRef);
    if (r) {
      const nextRemaining = [];
      for (const entry of remainingEntries) {
        const ranked = r.result[entry.name];
        if (Array.isArray(ranked) && ranked.length > 0) {
          const rec = cloudRecommendations.find((rec_) => rec_.name === entry.name);
          if (rec) {
            applyRanking(rec, r.modelRef, ranked, entry.ruleChainMatched);
            // Enforce one model per non-opencode provider across the whole
            // recommendation — ranking can reintroduce duplicates through
            // fuzzy matchModelRef matching a second ref from the same provider.
            deduplicatePerProvider(rec);
            usedModels.add(r.modelRef);
            const origIndex = entries.findIndex((e) => e.name === entry.name);
            if (origIndex !== -1) success[origIndex] = true;
          }
        } else {
          nextRemaining.push(entry);
        }
      }
      remainingEntries = nextRemaining;
    }
  }

  // Filter out any models that failed/timed out during fitness ranking.
  if (blacklistedModels.size > 0) {
    for (const rec of cloudRecommendations) {
      if (rec.model) {
        const key = `${rec.model.provider}/${rec.model.model}`;
        if (blacklistedModels.has(key)) {
          rec.model = null;
        }
      }
      if (Array.isArray(rec.fallback_models)) {
        rec.fallback_models = rec.fallback_models.filter((ref) => {
          if (!ref?.provider || !ref?.model) return true;
          const key = `${ref.provider}/${ref.model}`;
          return !blacklistedModels.has(key);
        });
      }
      if (Array.isArray(rec.routing)) {
        rec.routing = rec.routing.filter((ref) => {
          if (!ref?.provider || !ref?.model) return true;
          const key = `${ref.provider}/${ref.model}`;
          return !blacklistedModels.has(key);
        });
      }
      if (!rec.model && rec.fallback_models && rec.fallback_models.length > 0) {
        rec.model = rec.fallback_models.shift();
      }
    }
  }

  const actualSuccessfulModel = [...usedModels][0];
  if (actualSuccessfulModel) {
    for (const rec of cloudRecommendations) {
      if (rec.ruleChainMatched) {
        rec.aiUsedModel = actualSuccessfulModel;
      }
    }
  }

  const rankedCount = success.filter(Boolean).length;
  process.stdout.write(`\n│\n`);
  if (rankedCount > 0) {
    const modelList = [...usedModels].map((m) => `│  • ${m}`).join("\n");
    process.stdout.write(`✓  Ranking complete: ${rankedCount}/${total} ranked using\n${modelList}\n│\n`);
  } else {
    process.stdout.write(`◇  AI ranking: AI unavailable — using heuristic order\n│\n`);
  }
  return rankedCount > 0;
}
