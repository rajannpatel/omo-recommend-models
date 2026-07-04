import test from "node:test";
import assert from "node:assert/strict";

test("rankFallbacksByFitness returns false for empty input", async () => {
  const { rankFallbacksByFitness } = await import("../../lib/recommend/fitness-ranking.js");
  assert.equal(rankFallbacksByFitness([]), false);
  assert.equal(rankFallbacksByFitness([{ name: "test", model: {}, fallback_models: [] }]), false);
});

test("rankFallbacksByFitness skips all-ruleChainMatched entries early", async () => {
  const { rankFallbacksByFitness } = await import("../../lib/recommend/fitness-ranking.js");

  const ruleChainEntry = {
    name: "sisyphus",
    type: "agent",
    model: { provider: "opencode-go", model: "kimi-k2.6" },
    ruleChainMatched: true,
    fallback_models: [
      { provider: "openai", model: "gpt-5.5" },
      { provider: "opencode", model: "big-pickle" },
    ],
  };
  // All entries filtered out by the ruleChainMatched guard → entries list is empty
  const result = rankFallbacksByFitness([ruleChainEntry]);
  assert.equal(result, false,
    "should return false when all entries are ruleChainMatched");
});

test("upstreamContext formats known agent entry", async () => {
  const { upstreamContext } = await import("../../lib/recommend/fitness-ranking.js");
  const result = upstreamContext({ name: "sisyphus", type: "agent", allModels: [] });
  assert.match(result, /1st choice:/);
  assert.match(result, /claude-opus-4-7/);
  assert.match(result, /variant: max/);
  assert.match(result, /anthropic/);
});

test("upstreamContext formats known category entry", async () => {
  const { upstreamContext } = await import("../../lib/recommend/fitness-ranking.js");
  const result = upstreamContext({ name: "ultrabrain", type: "category", allModels: [] });
  assert.match(result, /1st choice:/);
  assert.match(result, /gpt-5\.5/);
  assert.match(result, /variant: xhigh/);
  assert.match(result, /opencode/);
});

test("upstreamContext returns empty string for unknown entries", async () => {
  const { upstreamContext } = await import("../../lib/recommend/fitness-ranking.js");
  const result = upstreamContext({ name: "nobody", type: "agent", allModels: [] });
  assert.equal(result, "");
});

test("upstreamContext returns fallback for sysadmin", async () => {
  const { upstreamContext } = await import("../../lib/recommend/fitness-ranking.js");
  const result = upstreamContext({ name: "sysadmin", type: "agent", allModels: [] });
  assert.match(result, /System administration/);
});

test("upstreamContext returns fallback for scout", async () => {
  const { upstreamContext } = await import("../../lib/recommend/fitness-ranking.js");
  const result = upstreamContext({ name: "scout", type: "agent", allModels: [] });
  assert.match(result, /information gathering/);
});

test("upstreamContext includes requiresAnyModel when present", async () => {
  const { upstreamContext } = await import("../../lib/recommend/fitness-ranking.js");
  const result = upstreamContext({ name: "hephaestus", type: "agent", allModels: [] });
  assert.match(result, /requires: any model from chain/);
});

test("upstreamContext includes requiresProvider when present", async () => {
  const { upstreamContext } = await import("../../lib/recommend/fitness-ranking.js");
  const result = upstreamContext({ name: "hephaestus", type: "agent", allModels: [] });
  assert.match(result, /requires: model from/);
});

test("upstreamContext returns empty string for unknown category", async () => {
  const { upstreamContext } = await import("../../lib/recommend/fitness-ranking.js");
  const result = upstreamContext({ name: "imaginary", type: "category", allModels: [] });
  assert.equal(result, "");
});

test("upstreamContext shows multiple chain tiers for sisyphus", async () => {
  const { upstreamContext } = await import("../../lib/recommend/fitness-ranking.js");
  const result = upstreamContext({ name: "sisyphus", type: "agent", allModels: [] });
  assert.match(result, /1st choice:/);
  assert.match(result, /2nd choice:/);
  assert.match(result, /3rd choice:/);
});

test("upstreamContext shows providers list for each tier", async () => {
  const { upstreamContext } = await import("../../lib/recommend/fitness-ranking.js");
  const result = upstreamContext({ name: "librarian", type: "agent", allModels: [] });
  assert.match(result, /from /);
  assert.match(result, /openai/);
});

test("rankFallbacksByFitness gracefully handles mixed rule-chain and non-rule-chain entries", async () => {
  const { rankFallbacksByFitness } = await import("../../lib/recommend/fitness-ranking.js");

  const ruleChainEntry = {
    name: "sisyphus",
    type: "agent",
    model: { provider: "opencode-go", model: "kimi-k2.6" },
    ruleChainMatched: true,
    fallback_models: [
      { provider: "openai", model: "gpt-5.5" },
      { provider: "opencode", model: "big-pickle" },
    ],
  };

  const nonRuleChainEntry = {
    name: "oracle",
    type: "agent",
    model: { provider: "openai", model: "gpt-5.5" },
    ruleChainMatched: false,
    fallback_models: [
      { provider: "anthropic", model: "claude-opus-5" },
      { provider: "opencode", model: "big-pickle" },
      { provider: "google", model: "gemini-2.5-pro" },
    ],
  };

  const ruleChainEntryOriginal = { ...ruleChainEntry };

  // When opencode is available, the AI ranks only the non-rule-chain entry.
  // Rule-chain-matched entries must never be sent to AI or mutated.
  const result = rankFallbacksByFitness([ruleChainEntry, nonRuleChainEntry]);

  assert.deepEqual(ruleChainEntry.model, ruleChainEntryOriginal.model,
    "ruleChainMatched entry model must remain unchanged");
  assert.deepEqual(ruleChainEntry.fallback_models, ruleChainEntryOriginal.fallback_models,
    "ruleChainMatched entry fallback_models must remain unchanged");
  assert.equal(ruleChainEntry.aiUsedModel, undefined,
    "ruleChainMatched entry must not acquire aiUsedModel");
});


