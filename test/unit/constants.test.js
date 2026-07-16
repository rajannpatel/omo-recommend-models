import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  VARIANT_BONUS,
  LOCAL_PROVIDER,
  MODEL_CACHE_FILE,
  POLICY_EXCLUSION_CACHE_FILE,
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

test("MODEL_CACHE_FILE is an absolute path", () => {
  assert.ok(path.isAbsolute(MODEL_CACHE_FILE));
  assert.ok(MODEL_CACHE_FILE.includes("ollama-models.json"));
});

test("MODEL_CACHE_FILE stays in the established cache namespace", () => {
  assert.equal(
    MODEL_CACHE_FILE,
    path.join(os.homedir(), ".cache", "oh-my-opencode", "ollama-models.json"),
  );
});

test("POLICY_EXCLUSION_CACHE_FILE uses its dedicated cache file", () => {
  assert.equal(
    POLICY_EXCLUSION_CACHE_FILE,
    path.join(
      os.homedir(),
      ".cache",
      "oh-my-opencode",
      "policy-excluded-models.json",
    ),
  );
  assert.notEqual(POLICY_EXCLUSION_CACHE_FILE, MODEL_CACHE_FILE);
});

test("KNOWN_MODELS is an array of objects with name and tags", () => {
  assert.ok(Array.isArray(KNOWN_MODELS));
  assert.ok(KNOWN_MODELS.length > 0);
  for (const model of KNOWN_MODELS) {
    assert.ok(typeof model.name === "string");
    assert.ok(Array.isArray(model.tags));
  }
});


