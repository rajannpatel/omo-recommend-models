import test from "node:test";
import assert from "node:assert/strict";

import {
  skippedGpu,
  skippedOllama,
} from "../../lib/recommend/local-environment.js";
import { discoverModels } from "../../lib/recommend/ollama-registry.js";

test("skippedGpu returns cloud-only GPU placeholder", () => {
  assert.deepEqual(skippedGpu(), {
    hasGpu: false,
    name: "",
    label: "Not checked (--cloud-only)",
    vramGb: 0,
  });
});

test("skippedOllama returns empty cloud-only Ollama state", () => {
  assert.deepEqual(skippedOllama(), {
    installed: false,
    running: false,
    version: null,
    models: [],
  });
});

test("discoverModels reports known registry totals through progress API", async () => {
  const calls = [];
  const progress = {
    setTotal(total) {
      calls.push(["setTotal", total]);
    },
    set(current, message) {
      calls.push(["set", current, message]);
    },
    done(message) {
      calls.push(["done", message]);
    },
  };

  await discoverModels(true, progress, async () => JSON.stringify({ layers: [] }));

  const totalCall = calls.find((call) => call[0] === "setTotal");
  const setCalls = calls.filter((call) => call[0] === "set");
  assert.ok(totalCall[1] > 0);
  assert.equal(setCalls.length, totalCall[1]);
  assert.match(String(calls.at(-1)[1]), /models cataloged/);
});
