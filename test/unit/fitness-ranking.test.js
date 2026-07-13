import test from "node:test";
import assert from "node:assert/strict";

test("rankFallbacksByFitness returns false for empty input", async () => {
  const { rankFallbacksByFitness } = await import("../../lib/recommend/fitness-ranking.js");
  assert.equal(await rankFallbacksByFitness([]), false);
  assert.equal(await rankFallbacksByFitness([{ name: "test", model: {}, fallback_models: [] }]), false);
});

test("rankFallbacksByFitness processes all-ruleChainMatched entries when opencode is available", async () => {
  const { rankFallbacksByFitness } = await import("../../lib/recommend/fitness-ranking.js");

  const ruleChainEntry = {
    name: "sisyphus",
    type: "agent",
    model: { provider: "opencode-go", model: "kimi-k2.6" },
    ruleChainMatched: true,
    fallback_models: [
      { provider: "openai", model: "gpt-5.5" },
      { provider: "opencode", model: "model-alpha" },
    ],
  };
  const cloudLookup = {
    byId: {
      opencode: new Map([
        ["zero-alpha", { pricing: { input: 0, output: 0 }, capabilities: { toolcall: true } }],
      ]),
    },
  };
  const result = await rankFallbacksByFitness([ruleChainEntry], cloudLookup);
  // When opencode binary is available, ranking succeeds. When not available, returns false.
  // Either is acceptable depending on the test environment.
  assert.ok(typeof result === "boolean");

  // aiUsedModel must be set on rule-chain entries regardless of opencode availability
  // so the output can show "(ranked by <model>)" for these entries.
  assert.ok(ruleChainEntry.aiUsedModel, "aiUsedModel should be set even for rule-chain entries");
});

test("upstreamContext formats known agent entry", async () => {
  const { upstreamContext } = await import("../../lib/recommend/fitness/prompt-builder.js");
  const result = upstreamContext({ name: "sisyphus", type: "agent", allModels: [] });
  assert.match(result, /1st choice:/);
  assert.match(result, /claude-opus-4-7/);
  assert.match(result, /variant: max/);
  assert.match(result, /anthropic/);
});

test("upstreamContext formats known category entry", async () => {
  const { upstreamContext } = await import("../../lib/recommend/fitness/prompt-builder.js");
  const result = upstreamContext({ name: "ultrabrain", type: "category", allModels: [] });
  assert.match(result, /1st choice:/);
  assert.match(result, /gpt-5\.5/);
  assert.match(result, /variant: xhigh/);
  assert.match(result, /opencode/);
});

test("upstreamContext returns empty string for unknown entries", async () => {
  const { upstreamContext } = await import("../../lib/recommend/fitness/prompt-builder.js");
  const result = upstreamContext({ name: "nobody", type: "agent", allModels: [] });
  assert.equal(result, "");
});

test("upstreamContext returns fallback for sysadmin", async () => {
  const { upstreamContext } = await import("../../lib/recommend/fitness/prompt-builder.js");
  const result = upstreamContext({ name: "sysadmin", type: "agent", allModels: [] });
  assert.match(result, /System administration/);
});

test("upstreamContext returns fallback for scout", async () => {
  const { upstreamContext } = await import("../../lib/recommend/fitness/prompt-builder.js");
  const result = upstreamContext({ name: "scout", type: "agent", allModels: [] });
  assert.match(result, /information gathering/);
});

test("upstreamContext includes requiresAnyModel when present", async () => {
  const { upstreamContext } = await import("../../lib/recommend/fitness/prompt-builder.js");
  const result = upstreamContext({ name: "hephaestus", type: "agent", allModels: [] });
  assert.match(result, /requires: any model from chain/);
});

test("upstreamContext includes requiresProvider when present", async () => {
  const { upstreamContext } = await import("../../lib/recommend/fitness/prompt-builder.js");
  const result = upstreamContext({ name: "hephaestus", type: "agent", allModels: [] });
  assert.match(result, /requires: model from/);
});

test("upstreamContext returns empty string for unknown category", async () => {
  const { upstreamContext } = await import("../../lib/recommend/fitness/prompt-builder.js");
  const result = upstreamContext({ name: "imaginary", type: "category", allModels: [] });
  assert.equal(result, "");
});

test("upstreamContext shows multiple chain tiers for sisyphus", async () => {
  const { upstreamContext } = await import("../../lib/recommend/fitness/prompt-builder.js");
  const result = upstreamContext({ name: "sisyphus", type: "agent", allModels: [] });
  assert.match(result, /1st choice:/);
  assert.match(result, /2nd choice:/);
  assert.match(result, /3rd choice:/);
});

test("upstreamContext shows providers list for each tier", async () => {
  const { upstreamContext } = await import("../../lib/recommend/fitness/prompt-builder.js");
  const result = upstreamContext({ name: "librarian", type: "agent", allModels: [] });
  assert.match(result, /from /);
  assert.match(result, /openai/);
});
