import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  VARIANT_BONUS,
  LOCAL_PROVIDER,
  FREE_PROVIDERS,
  QUALITY_TIERS,
  MODEL_CACHE_FILE,
  modelListEquals,
  isSubsetList,
  KNOWN_MODELS,
} from "../../lib/constants.js";

test("VARIANT_BONUS has expected structure", () => {
  assert.equal(typeof VARIANT_BONUS, "object");
  assert.equal(VARIANT_BONUS.xhigh, 10);
  assert.equal(VARIANT_BONUS.max, 8);
  assert.equal(VARIANT_BONUS.high, 5);
  assert.equal(VARIANT_BONUS.medium, 0);
  assert.equal(VARIANT_BONUS.low, -5);
});

test("LOCAL_PROVIDER is 'local'", () => {
  assert.equal(LOCAL_PROVIDER, "local");
});

test("FREE_PROVIDERS includes opencode and local", () => {
  assert.ok(Array.isArray(FREE_PROVIDERS));
  assert.ok(FREE_PROVIDERS.includes("opencode"));
  assert.ok(FREE_PROVIDERS.includes(LOCAL_PROVIDER));
});

test("QUALITY_TIERS has reasoning, balanced, fast", () => {
  assert.deepEqual(QUALITY_TIERS, ["reasoning", "balanced", "fast"]);
});

test("MODEL_CACHE_FILE is an absolute path", () => {
  assert.ok(path.isAbsolute(MODEL_CACHE_FILE));
  assert.ok(MODEL_CACHE_FILE.includes("ollama-models.json"));
});

test("modelListEquals returns true for equal arrays", () => {
  assert.ok(modelListEquals(["a", "b"], ["b", "a"]));
});

test("modelListEquals returns false for different length", () => {
  assert.ok(!modelListEquals(["a"], ["a", "b"]));
});

test("modelListEquals returns false for null/undefined", () => {
  assert.ok(!modelListEquals(null, ["a"]));
  assert.ok(!modelListEquals(["a"], null));
  assert.ok(!modelListEquals(null, null));
});

test("modelListEquals returns false for different content", () => {
  assert.ok(!modelListEquals(["a", "b"], ["a", "c"]));
});

test("isSubsetList returns true when all items present", () => {
  assert.ok(isSubsetList(["a", "b", "c"], ["a", "c"]));
});

test("isSubsetList returns false when item missing", () => {
  assert.ok(!isSubsetList(["a", "b"], ["a", "c"]));
});

test("isSubsetList returns false for null/undefined", () => {
  assert.ok(!isSubsetList(null, ["a"]));
  assert.ok(!isSubsetList(["a"], null));
});

test("KNOWN_MODELS is an array of objects with name and tags", () => {
  assert.ok(Array.isArray(KNOWN_MODELS));
  assert.ok(KNOWN_MODELS.length > 0);
  for (const model of KNOWN_MODELS) {
    assert.ok(typeof model.name === "string");
    assert.ok(Array.isArray(model.tags));
  }
});


