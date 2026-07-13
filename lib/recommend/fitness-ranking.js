import process from "node:process";

import {
  writeGroupLine,
  writeGroupSeparator,
  writeTopLevelLine,
} from "../display/progress.js";
import { buildFreeModelRefPredicate, discoverFreeModels, isZeroCostModelMeta } from "../shared/provider-cache.js";
import { deduplicatePerProvider } from "./recommendation-finalizer.js";
import { buildRankingPrompt } from "./fitness/prompt-builder.js";
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

function freeModelsFromLookup(cloudLookup) {
  const refs = [];
  for (const [provider, modelMap] of Object.entries(cloudLookup?.byId || {})) {
    if (!modelMap || modelMap.size === 0) continue;
    for (const [model, meta] of modelMap.entries()) {
      if (isZeroCostModelMeta(meta) && meta?.capabilities?.toolcall === true) {
        refs.push(`${provider}/${model}`);
      }
    }
  }
  return refs;
}

function uniqueModelRefs(...groups) {
  return [...new Set(groups.flat())];
}

export async function rankFallbacksByFitness(
  cloudRecommendations,
  cloudLookup = null,
  parsedArgs = null,
  config = null,
  ctx = null
) {
  const modelMetadata = {};
  const isFreeRef = cloudLookup?.byId ? buildFreeModelRefPredicate(cloudLookup) : null;
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
    const freeModelsList = uniqueModelRefs(
      resolveFreeModels(),
      freeModelsFromLookup(cloudLookup),
    );
    models = freeModelsList;
  }

  // Record which model will be used for AI analysis on rule-chain entries too,
  // even though they skip the round-robin ranking loop. This lets the output
  // show "(ranked by <model>)" consistently across all entries.
  for (const rec of cloudRecommendations) {
    if (rec.ruleChainMatched && models[0]) rec.aiUsedModel = models[0];
  }

  if (entries.length === 0) {
    return false;
  }
  if (models.length === 0) {
    writeTopLevelLine("◇  AI ranking unavailable — no zero-cost evaluator models found");
    return false;
  }
  const total = entries.length;
  let completedCount = 0;

  const usedModels = new Set();
  const blacklistedModels = new Set();

  const header = `◇  AI ranking ${total} agent(s)/category(ies) by model fitness — processed 0/${total}`;
  process.stdout.write(`${header}\n`);

  function updateProgress() {
    const newHeader = `◇  AI ranking ${total} agent(s)/category(ies) by model fitness — processed ${completedCount}/${total}`;
    writeGroupSeparator();
    writeTopLevelLine(newHeader);
  }

  async function tryEntry(entry, modelRef) {
    if (blacklistedModels.has(modelRef)) return null;

    try {
      writeGroupLine(`→ ${entry.name} by ${modelRef}...`);
      let text;
      const debug = parsedArgs?.debug || false;
      const verbose = parsedArgs?.verbose || false;
      const prompt = buildRankingPrompt([entry]);
      
      if (modelRef.startsWith("cli/")) {
        const tool = modelRef.replace(/^cli\//, "");
        text = await callCliAgent(
          prompt,
          tool, 
          config, 
          ctx,
          { debug, verbose }
        );
      } else {
        text = await callOpencode(
          prompt,
          modelRef, 
          ctx,
          { debug, verbose }
        );
      }
      const result = parseRanking(text);
      if (result && typeof result === "object") {
        const ranking = result[entry.name];
        if (Array.isArray(ranking) && ranking.length > 0) {
          writeGroupLine(`✓  processed  ${entry.name} by ${modelRef}`);
          completedCount += 1;
          updateProgress();
          return { modelRef, ranking };
        }
      }
      writeGroupLine(`✗  ${entry.name} by ${modelRef} — invalid ranking`);
    } catch (err) {
      const msg = err.message
        .replace(/^opencode returned /, "")
        .replace(/^agy returned /, "")
        .replace(/^codex returned /, "");
      writeGroupLine(`✗  ${entry.name} by ${modelRef} — ${msg}`);
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

  let modelCursor = 0;
  function nextAnalysisModel() {
    for (let i = 0; i < models.length; i++) {
      const modelRef = models[modelCursor % models.length];
      modelCursor += 1;
      if (!blacklistedModels.has(modelRef)) return modelRef;
    }
    return null;
  }

  for (let entryIndex = 0; entryIndex < entries.length; entryIndex++) {
    const entry = entries[entryIndex];
    let ranked = false;
    while (!ranked) {
      const modelRef = nextAnalysisModel();
      if (!modelRef) break;
      const result = await tryEntry(entry, modelRef);
      if (!Array.isArray(result?.ranking) || result.ranking.length === 0) continue;
      const rec = cloudRecommendations.find((r) => r.name === entry.name);
      if (rec) {
        applyRanking(rec, result.modelRef, result.ranking, entry.ruleChainMatched);
        deduplicatePerProvider(rec, isFreeRef ? { isFreeRef } : undefined);
        usedModels.add(result.modelRef);
        success[entryIndex] = true;
        ranked = true;
      }
    }
    if (!ranked && blacklistedModels.size >= models.length) break;
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
  writeGroupSeparator();
  if (rankedCount > 0) {
    process.stdout.write(`◇  AI ranking complete: ${rankedCount}/${total} ranked using\n`);
    for (const modelRef of usedModels) writeGroupLine(`• ${modelRef}`);
    writeGroupSeparator();
  } else {
    process.stdout.write("◇  AI ranking unavailable — using heuristic order\n");
    writeGroupSeparator();
  }
  return rankedCount > 0;
}
