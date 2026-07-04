import assert from "node:assert/strict";
import test from "node:test";
import {
  allConfigEntries,
  uniqueByModelRef,
  finalizeFallbackModels,
} from "../../lib/consensus.js";

test("allConfigEntries returns agents and categories", () => {
  const config = {
    agents: {
      sisyphus: { model_quality: "high" },
      builder: { model_quality: "balanced" },
    },
    categories: {
      utility: { model_quality: "fast" },
    },
  };

  const entries = allConfigEntries(config);
  assert.equal(entries.length, 3);
  assert.equal(entries[0].name, "sisyphus");
  assert.equal(entries[0].type, "agent");
  assert.equal(entries[1].name, "builder");
  assert.equal(entries[1].type, "agent");
  assert.equal(entries[2].name, "utility");
  assert.equal(entries[2].type, "category");
});

test("allConfigEntries returns empty for empty config", () => {
  assert.deepEqual(allConfigEntries({}), []);
  assert.deepEqual(allConfigEntries({ agents: {}, categories: {} }), []);
});

test("uniqueByModelRef deduplicates by provider/model", () => {
  const recs = [
    { provider: "opencode", model: "big-pickle", reason: "a" },
    { provider: "opencode", model: "big-pickle", reason: "b" },
    { provider: "anthropic", model: "claude-4", reason: "c" },
  ];
  const result = uniqueByModelRef(recs);
  assert.equal(result.length, 2);
  assert.equal(result[0].provider, "opencode");
  assert.equal(result[0].model, "big-pickle");
  assert.equal(result[1].provider, "anthropic");
  assert.equal(result[1].model, "claude-4");
});

test("uniqueByModelRef filters out invalid recs", () => {
  const recs = [
    null,
    { provider: "", model: "" },
    { provider: "opencode", model: "big-pickle" },
  ];
  const result = uniqueByModelRef(recs);
  assert.equal(result.length, 1);
});

test("finalizeFallbackModels removes duplicates and primary model", () => {
  const primary = { provider: "opencode", model: "big-pickle" };
  const fallbacks = [
    { provider: "opencode", model: "big-pickle" },
    { provider: "anthropic", model: "claude-4" },
    { provider: "anthropic", model: "claude-4" },
    { provider: "opencode", model: "north-mini-code-free" },
  ];
  const result = finalizeFallbackModels(primary, fallbacks);
  assert.equal(result.length, 2);
  assert.equal(result[0].provider, "anthropic");
  assert.equal(result[0].model, "claude-4");
  assert.equal(result[1].provider, "opencode");
  assert.equal(result[1].model, "north-mini-code-free");
});

test("finalizeFallbackModels handles null primary", () => {
  const fallbacks = [
    { provider: "opencode", model: "big-pickle" },
  ];
  const result = finalizeFallbackModels(null, fallbacks);
  assert.equal(result.length, 1);
  assert.equal(result[0].model, "big-pickle");
});

test("finalizeFallbackModels handles null fallbacks", () => {
  const result = finalizeFallbackModels(
    { provider: "opencode", model: "big-pickle" },
    null,
  );
  assert.deepEqual(result, []);
});


