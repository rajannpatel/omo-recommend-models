// =========================================================================
// Rebalance module — extracted from omo-recommend-models
// Tier chain construction, rebalancing logic, and display functions
// =========================================================================

import { resolveProvider, getConfigPath, buildRichModelLookup } from "./omo-shared.js";
import { scoreModel } from "./scoring.js";
import { LOCAL_PROVIDER, FREE_PROVIDERS, QUALITY_TIERS } from "./constants.js";

// =========================================================================
// Tier chain construction
// =========================================================================

export function buildTierChains(modelCache, providerAliases) {
  const chains = { reasoning: [], balanced: [], fast: [] };
  for (const [provider, modelMap] of Object.entries(modelCache.byId || {})) {
    if (!modelMap || modelMap.size === 0) continue;
    if (provider === "local") continue;
    const scored = [];
    for (const [id, meta] of modelMap) {
      scored.push({
        model: `${provider}/${id}`,
        score: scoreModel(`${provider}/${id}`, null, meta),
        variant: null,
      });
    }
    if (scored.length === 0) continue;
    scored.sort((a, b) => b.score - a.score);
    const n = scored.length;
    chains.reasoning.push(scored[0]);
    chains.balanced.push(scored[n <= 2 ? 0 : Math.floor((n - 1) / 2)]);
    chains.fast.push(scored[n - 1]);
  }
  for (const tier of QUALITY_TIERS)
    chains[tier].sort((a, b) => b.score - a.score);
  return chains;
}

// =========================================================================
// Fallback string conversion
// =========================================================================

export function fbToString(fb) {
  return typeof fb === "string"
    ? fb
    : fb.model + (fb.variant ? ":" + fb.variant : "");
}

// =========================================================================
// Apply tier chain to config entry
// =========================================================================

export function applyTierChain(entry, tierChain) {
  if (!tierChain || tierChain.length === 0) return { changed: false };
  const newModel = tierChain[0].model;
  const newVariant = tierChain[0].variant || null;
  const newFallbacks = tierChain.slice(1).map((c) => {
    const fb = { model: c.model };
    if (c.variant) fb.variant = c.variant;
    return fb;
  });
  const oldModelStr = entry.model + (entry.variant ? ":" + entry.variant : "");
  const newModelStr = newModel + (newVariant ? ":" + newVariant : "");
  const oldFbStr = (entry.fallback_models || []).map(fbToString).join(",");
  const newFbStr = newFallbacks.map(fbToString).join(",");
  if (oldModelStr === newModelStr && oldFbStr === newFbStr)
    return { changed: false };
  entry.model = newModel;
  if (newVariant) entry.variant = newVariant;
  else delete entry.variant;
  if (newFallbacks.length > 0) entry.fallback_models = newFallbacks;
  else delete entry.fallback_models;
  return { changed: true };
}

// =========================================================================
// Find model in cache
// =========================================================================

export function findModelInCache(providerKey, modelID, aliases, lookup) {
  const realProvider = resolveProvider(providerKey, aliases);
  const modelMap = lookup.byId[realProvider];
  if (!modelMap) return null;
  return (
    modelMap.get(modelID) ||
    modelMap.get(`${providerKey}/${modelID}`) ||
    modelMap.get(`${realProvider}/${modelID}`) ||
    null
  );
}

// =========================================================================
// Rebalance a single config entry
// =========================================================================

export function rebalanceEntry(entry, options) {
  if (!entry || typeof entry !== "object") return { changed: false };
  const {
    tierChains,
    withoutFree,
    unavailableModels,
    providerAliases,
    modelCache,
  } = options;
  if (tierChains) {
    const quality = entry.model_quality || "balanced";
    const tier = tierChains[quality];
    if (tier && tier.length > 0) {
      let chain = tier;
      if (withoutFree)
        chain = tier.filter(
          (c) => !FREE_PROVIDERS.includes(c.model.split("/")[0]),
        );
      if (chain.length === 0) return { changed: false };
      const r = applyTierChain(entry, chain);
      if (r.changed) return { changed: true, reason: `tier: ${quality}` };
      return r;
    }
  }
  const refs = [];
  if (entry.model)
    refs.push({ model: entry.model, variant: entry.variant || null });
  if (entry.fallback_models) {
    for (const fb of entry.fallback_models)
      refs.push({ model: fb.model, variant: fb.variant || null });
  }
  if (refs.length === 0) return { changed: false };
  if (unavailableModels && unavailableModels.size > 0) {
    const filtered = refs.filter((r) => !unavailableModels.has(r.model));
    if (filtered.length === 0) {
      delete entry.model;
      delete entry.variant;
      delete entry.fallback_models;
      return { changed: true, reason: "all models unavailable" };
    }
    refs.length = 0;
    refs.push(...filtered);
  }
  const bestPerProvider = {};
  for (const ref of refs) {
    const providerKey = ref.model.split("/")[0];
    const modelPart = ref.model.slice(ref.model.indexOf("/") + 1);
    const realProvider = resolveProvider(providerKey, aliases);
    const cacheEntry = findModelInCache(
      providerKey,
      modelPart,
      aliases,
      modelCache,
    );
    const rank = scoreModel(ref.model, ref.variant, cacheEntry);
    if (
      !bestPerProvider[realProvider] ||
      rank > bestPerProvider[realProvider].rank
    ) {
      bestPerProvider[realProvider] = { ...ref, provider: providerKey, rank };
    }
  }
  let candidates = Object.values(bestPerProvider);
  if (withoutFree)
    candidates = candidates.filter((c) => !FREE_PROVIDERS.includes(c.provider));
  if (candidates.length === 0) return { changed: false };
  candidates.sort((a, b) => b.rank - a.rank);
  const newModel = candidates[0].model;
  const newVariant = candidates[0].variant;
  const newFallbacks = candidates.slice(1).map((c) => {
    const fb = { model: c.model };
    if (c.variant) fb.variant = c.variant;
    return fb;
  });
  const oldModelStr = entry.model + (entry.variant ? ":" + entry.variant : "");
  const newModelStr = newModel + (newVariant ? ":" + newVariant : "");
  const oldFbStr = (entry.fallback_models || []).map(fbToString).join(",");
  const newFbStr = newFallbacks.map(fbToString).join(",");
  if (oldModelStr === newModelStr && oldFbStr === newFbStr)
    return { changed: false };
  entry.model = newModel;
  if (newVariant) entry.variant = newVariant;
  else delete entry.variant;
  if (newFallbacks.length > 0) entry.fallback_models = newFallbacks;
  else delete entry.fallback_models;
  return { changed: true };
}

// =========================================================================
// Rebalance entire config
// =========================================================================

export function rebalanceConfig(config, options) {
  const changes = [];
  for (const [name, agent] of Object.entries(config.agents || {})) {
    if (agent.model || agent.fallback_models) {
      const r = rebalanceEntry(agent, options);
      if (r.changed)
        changes.push(`agents.${name}${r.reason ? ` — ${r.reason}` : ""}`);
    }
  }
  for (const [name, cat] of Object.entries(config.categories || {})) {
    if (cat.model || cat.fallback_models) {
      const r = rebalanceEntry(cat, options);
      if (r.changed)
        changes.push(`categories.${name}${r.reason ? ` — ${r.reason}` : ""}`);
    }
  }
  return changes;
}

// =========================================================================
// Display rebalance preview
// =========================================================================

export function showRebalance(config, richLookup, aliases, localModelNames) {
  const tierChains = buildTierChains(richLookup, aliases);
  console.log(`\n🔎 Algorithmic tier chains for ${getConfigPath()}\n`);
  if (localModelNames.length > 0) {
    console.log(
      `———————— Local ————————————————————————————————————————————————`,
    );
    console.log(`  Ollama models: ${localModelNames.join(", ")}\n`);
  }
  for (const tier of QUALITY_TIERS) {
    const chain = tierChains[tier];
    if (chain && chain.length > 0) {
      console.log(
        `———————— ${tier} chain ————————————————————————————————————————————————`,
      );
      chain.forEach((c, i) => {
        const prefix = i === 0 ? "→ primary" : `  fallback ${i}`;
        console.log(`  ${prefix}: ${c.model} (${Math.round(c.score)})`);
      });
      console.log();
    }
  }
  console.log(
    `———————— Agents / Categories ————————————————————————————————————————————————`,
  );
  const allEntries = [];
  for (const [name, agent] of Object.entries(config.agents || {})) {
    if (agent.model) allEntries.push({ name, type: "agent", entry: agent });
  }
  for (const [name, cat] of Object.entries(config.categories || {})) {
    if (cat.model) allEntries.push({ name, type: "category", entry: cat });
  }
  if (allEntries.length === 0) {
    console.log("  No model references found in config.");
  } else {
    console.log(`  ${allEntries.length} section(s) with model references:\n`);
    for (const { name, type, entry } of allEntries) {
      const quality = entry.model_quality || "balanced";
      const current = entry.model || "(none)";
      const chain = tierChains[quality];
      const recommended = chain && chain.length > 0 ? chain[0].model : "(none)";
      const changed =
        current !== recommended ? " ⚡ would change" : " ✓";
      console.log(`  ${name} (${type})`);
      console.log(`    quality:    ${quality}`);
      console.log(`    current:    ${current}`);
      console.log(`    recommend:  ${recommended}${changed}`);
      if (chain && chain.length > 1) {
        console.log(
          `    fallbacks:  ${chain
            .slice(1)
            .map((c) => c.model)
            .join(", ")}`,
        );
      }
      console.log();
    }
  }
}