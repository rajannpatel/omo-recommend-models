import test from "node:test";
import assert from "node:assert/strict";

import { addLocalModelsToLookup } from "../../lib/recommend/rebalance-flow.js";

test("addLocalModelsToLookup adds local models to lookup sets and ids", () => {
  const lookup = {
    sets: {},
    byId: {},
  };

  const result = addLocalModelsToLookup(lookup, [
    "qwen3:8b",
    "llama3.1:8b",
  ]);

  assert.equal(result, lookup);
  assert.deepEqual([...lookup.sets.local].sort(), [
    "llama3.1:8b",
    "qwen3:8b",
  ]);
  assert.equal(lookup.byId.local.get("qwen3:8b"), null);
  assert.equal(lookup.byId.local.get("llama3.1:8b"), null);
});

test("addLocalModelsToLookup keeps existing local metadata", () => {
  const existingMeta = { id: "qwen3:8b" };
  const lookup = {
    sets: { local: new Set(["qwen3:8b"]) },
    byId: { local: new Map([["qwen3:8b", existingMeta]]) },
  };

  addLocalModelsToLookup(lookup, ["qwen3:8b", "mistral:7b"]);

  assert.equal(lookup.byId.local.get("qwen3:8b"), existingMeta);
  assert.equal(lookup.byId.local.get("mistral:7b"), null);
  assert.deepEqual([...lookup.sets.local].sort(), ["mistral:7b", "qwen3:8b"]);
});
