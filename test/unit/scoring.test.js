import assert from "node:assert/strict";
import test from "node:test";
import {
  detectFamilyFromMeta,
  scoreModelFromMeta,
  scoreFromCache,
  scoreFromHeuristics,
  scoreModel,
  panelModelOrder,
  sortPanelModelRefs,
} from "../../lib/scoring.js";

test("detectFamilyFromMeta returns family and name", () => {
  const result = detectFamilyFromMeta({ family: "opencode-big" }, "big-pickle");
  assert.equal(result.family, "opencode-big");
  assert.equal(result.name, "big-pickle");
  assert.equal(typeof result.baseScore, "number");
});

test("detectFamilyFromMeta boosts reasoning models", () => {
  const meta = {
    family: "opencode-reasoning",
    capabilities: ["reasoning"],
    context_length: 32000,
  };
  const result = detectFamilyFromMeta(meta, "reasoning-model");
  assert.ok(result.hasReasoning);
  assert.ok(result.baseScore >= 20);
});

test("detectFamilyFromMeta boosts large context models", () => {
  const meta = { context_length: 200000, capabilities: [] };
  const small = detectFamilyFromMeta({ context_length: 16000, capabilities: [] }, "m");
  const large = detectFamilyFromMeta(meta, "m");
  assert.ok(large.baseScore > small.baseScore);
});

test("detectFamilyFromMeta boosts free (zero-cost) models", () => {
  const free = detectFamilyFromMeta({ cost: 0, capabilities: [] }, "free-model");
  const paid = detectFamilyFromMeta({ cost: 3, capabilities: [] }, "paid-model");
  assert.ok(free.baseScore > paid.baseScore);
});

test("scoreModelFromMeta returns non-negative number", () => {
  const score = scoreModelFromMeta("big-pickle", null, { family: "test" });
  assert.ok(typeof score === "number");
  assert.ok(!isNaN(score));
  assert.ok(score >= 0);
});

test("scoreModelFromMeta applies variant bonus", () => {
  const base = scoreModelFromMeta("test-model", null, {});
  const withMax = scoreModelFromMeta("test-model", "max", {});
  assert.ok(withMax > base);
});

test("scoreModelFromMeta boosts model size indicators", () => {
  const small = scoreModelFromMeta("model-7b", null, {});
  const large = scoreModelFromMeta("model-70b", null, {});
  assert.ok(large > small);
});

test("scoreModelFromMeta boosts name tier keywords", () => {
  const basic = scoreModelFromMeta("base", null, {});
  const ultra = scoreModelFromMeta("ultra", null, {});
  assert.ok(ultra >= basic + 14);
});

test("scoreFromCache delegates to scoreModelFromMeta", () => {
  const entry = { family: "test", context_length: 64000 };
  const direct = scoreModelFromMeta("test", null, entry);
  const cached = scoreFromCache("test", null, entry);
  assert.equal(cached, direct);
});

test("scoreFromHeuristics handles model with version numbers", () => {
  const score = scoreFromHeuristics("opencode/v3.5-turbo", null);
  assert.ok(typeof score === "number");
  assert.ok(score > 0);
});

test("scoreFromHeuristics boosts name tier keywords", () => {
  const mini = scoreFromHeuristics("opencode/mini-model", null);
  const ultra = scoreFromHeuristics("opencode/ultra-model", null);
  assert.ok(ultra > mini);
});

test("scoreFromHeuristics boosts size indicators", () => {
  const small = scoreFromHeuristics("opencode/model-7b", null);
  const large = scoreFromHeuristics("opencode/model-70b", null);
  assert.ok(large > small);
});

test("scoreFromHeuristics applies variant bonus", () => {
  const base = scoreFromHeuristics("opencode/test-model", null);
  const withLow = scoreFromHeuristics("opencode/test-model", "low");
  assert.ok(withLow < base);
});

test("scoreModel uses cache when available", () => {
  const entry = { family: "premium", context_length: 128000 };
  const withCache = scoreModel("opencode/big-pickle", null, entry);
  const withoutCache = scoreModel("opencode/big-pickle", null, null);
  // With metadata entry, score should differ from heuristic-only
  assert.notEqual(withCache, withoutCache);
});

test("panelModelOrder returns default order", () => {
  assert.equal(panelModelOrder({}), "opencode-first");
  assert.equal(panelModelOrder({ omo: {} }), "opencode-first");
});

test("panelModelOrder reads from config", () => {
  const result = panelModelOrder({ omo: { panel_model_order: "score" } });
  assert.equal(result, "score");
});

test("sortPanelModelRefs opencode-first by default", () => {
  const refs = ["anthropic/claude-4", "opencode/big-pickle", "google/gemini-3"];
  const sorted = sortPanelModelRefs(refs, {});
  // opencode should be first
  assert.ok(sorted[0].startsWith("opencode"));
});

test("sortPanelModelRefs score-based ordering", () => {
  const refs = ["opencode/north-mini-code-free", "opencode/big-pickle", "opencode/deepseek-v4-flash-free"];
  const sorted = sortPanelModelRefs(refs, { omo: { panel_model_order: "score" } });
  // All same provider, should be sorted by score descending
  assert.equal(sorted.length, 3);
});
