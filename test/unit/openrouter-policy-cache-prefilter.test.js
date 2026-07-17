import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test, { mock } from "node:test";

const accessibleOutput = ["openrouter/allowed-model", "openrouter/policy-blocked-model", ""].join("\n");
const verboseOutput = [
  "openrouter/allowed-model",
  '{"id":"allowed-model","capabilities":{"toolcall":true}}',
  "openrouter/policy-blocked-model",
  '{"id":"policy-blocked-model","capabilities":{"toolcall":true}}',
  "",
].join("\n");

mock.module("node:child_process", {
  namedExports: {
    execFileSync: mock.fn((_command, args) => {
      if (args.length === 1 && args[0] === "models") return accessibleOutput;
      if (args.length === 2 && args[0] === "models" && args[1] === "--verbose") return verboseOutput;
      throw new Error(`unexpected opencode args: ${args.join(" ")}`);
    }),
    spawn: mock.fn(() => new EventEmitter()),
  },
});

async function captureStdout(fn) {
  const originalWrite = process.stdout.write;
  const chunks = [];
  process.stdout.write = (chunk, encoding, callback) => {
    chunks.push(String(chunk));
    if (typeof encoding === "function") encoding();
    if (typeof callback === "function") callback();
    return true;
  };
  try {
    const value = await fn();
    return { output: chunks.join(""), value };
  } finally {
    process.stdout.write = originalWrite;
  }
}

function attachCachedPolicy(context) {
  const excluded = new Set(["openrouter/policy-blocked-model"]);
  context.policyExclusionCache = {
    has: (modelRef) => excluded.has(modelRef),
    values: () => [...excluded].sort(),
  };
  return context;
}

test("loadProviderModels applies cached OpenRouter policy exclusions before verbose lookup", async () => {
  const { loadProviderModels, resetCache } = await import("../../lib/shared/provider-cache.js");
  const { RuntimeContext } = await import("../../lib/runtime-context.js");
  resetCache();

  const { output, value: cache } = await captureStdout(() => loadProviderModels({
    ctx: attachCachedPolicy(new RuntimeContext()),
    quiet: true,
    env: {},
  }));

  assert.deepEqual(cache.models.openrouter.map((model) => model.id), [
    "allowed-model",
  ]);
  const policyIndex = output.indexOf("OpenRouter cached policy exclusions: excluded 1 model before probes");
  const verboseIndex = output.indexOf("opencode models --verbose");
  assert.notEqual(policyIndex, -1);
  assert.notEqual(verboseIndex, -1);
  assert.ok(policyIndex < verboseIndex);
});

test("preparePaidProviderModels does not spawn probes for cached OpenRouter policy exclusions", async () => {
  const { loadProviderModels, resetCache } = await import("../../lib/shared/provider-cache.js");
  const { preparePaidProviderModels } = await import("../../lib/recommend/paid-provider-prep.js");
  const { RuntimeContext } = await import("../../lib/runtime-context.js");
  resetCache();
  const ctx = attachCachedPolicy(new RuntimeContext());
  const initialCache = await captureStdout(() => loadProviderModels({
    ctx,
    quiet: true,
    env: {},
  })).then((result) => result.value);
  const invocations = [];

  const prepared = await captureStdout(() => preparePaidProviderModels({
    config: {},
    ctx,
    initialCache,
    localOnlyFlag: false,
    probeModelFn: async (_ctx, modelRef) => {
      invocations.push(modelRef);
      return { ok: true };
    },
  })).then((result) => result.value);
  await prepared.ensureProbesAwaited();

  assert.deepEqual(invocations, ["openrouter/allowed-model"]);
});
