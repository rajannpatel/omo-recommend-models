import test from "node:test";
import assert from "node:assert/strict";

import {
  skippedGpu,
  skippedOllama,
} from "../../lib/recommend/local-environment.js";

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
