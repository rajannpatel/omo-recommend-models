import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { mock, after } from "node:test";

// Isolates these tests from the real developer machine's opencode auth.json -
// an env object with no OPENROUTER_API_KEY must mean "no credential found
// anywhere", not "no credential in env, but fall through to the real file".
const noCredentialDataHome = fs.mkdtempSync(path.join(os.tmpdir(), "omo-no-openrouter-auth-"));
function envWithNoOpenRouterCredential() {
  return { XDG_DATA_HOME: noCredentialDataHome };
}
after(() => fs.rmSync(noCredentialDataHome, { recursive: true, force: true }));

let accessibleOutput = "openrouter/allowed-model\nopenrouter/policy-blocked-model\n";
let verboseOutput = `openrouter/allowed-model
{"id":"allowed-model","capabilities":{"toolcall":true}}
openrouter/policy-blocked-model
{"id":"policy-blocked-model","capabilities":{"toolcall":true}}
`;
const httpsRequests = [];
let userModelsStatusCode = 200;
let userModelsResponse = {
  data: [
    { id: "allowed-model" },
  ],
};

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

mock.module("node:https", {
  defaultExport: {
    get: mock.fn((url, options, callback) => {
      httpsRequests.push({ url, options });
      const response = new EventEmitter();
      response.statusCode = userModelsStatusCode;
      const request = new EventEmitter();
      request.destroy = mock.fn();
      request.setTimeout = mock.fn();

      queueMicrotask(() => {
        callback(response);
        response.emit("data", JSON.stringify(userModelsResponse));
        response.emit("end");
      });

      return request;
    }),
  },
});

async function captureStdout(fn) {
  const originalWrite = process.stdout.write;
  process.stdout.write = () => true;
  try {
    return await fn();
  } finally {
    process.stdout.write = originalWrite;
  }
}

async function captureStdoutWithValue(fn) {
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

function resetFixtures() {
  accessibleOutput = "openrouter/allowed-model\nopenrouter/policy-blocked-model\n";
  verboseOutput = `openrouter/allowed-model
{"id":"allowed-model","capabilities":{"toolcall":true}}
openrouter/policy-blocked-model
{"id":"policy-blocked-model","capabilities":{"toolcall":true}}
`;
  httpsRequests.length = 0;
  userModelsStatusCode = 200;
  userModelsResponse = {
    data: [
      { id: "allowed-model" },
    ],
  };
}

test("loadProviderModels uses OpenRouter user policy list before probe selection", async () => {
  const { loadProviderModels, resetCache } = await import("../../lib/shared/provider-cache.js");
  resetCache();
  resetFixtures();

  const cache = await captureStdout(() => loadProviderModels({
    quiet: true,
    env: { OPENROUTER_API_KEY: "policy-key" },
  }));

  assert.deepEqual(cache.models.openrouter, [
    {
      id: "allowed-model",
      capabilities: { toolcall: true },
    },
  ]);
  assert.equal(httpsRequests.length, 1);
  assert.equal(httpsRequests[0].url, "https://openrouter.ai/api/v1/models/user");
  assert.equal(httpsRequests[0].options.headers.Authorization, "Bearer policy-key");
});

test("loadProviderModels reports OpenRouter policy exclusions before verbose model lookup", async () => {
  const { loadProviderModels, resetCache } = await import("../../lib/shared/provider-cache.js");
  resetCache();
  resetFixtures();

  const { output } = await captureStdoutWithValue(() => loadProviderModels({
    quiet: true,
    env: { OPENROUTER_API_KEY: "policy-key" },
  }));

  const policyIndex = output.indexOf("OpenRouter policy configuration: excluded 1 model before probes");
  const verboseIndex = output.indexOf("opencode models --verbose");
  assert.notEqual(policyIndex, -1);
  assert.notEqual(verboseIndex, -1);
  assert.ok(policyIndex < verboseIndex);
});

test("loadProviderModels reports unavailable OpenRouter policy before verbose model lookup", async () => {
  const { loadProviderModels, resetCache } = await import("../../lib/shared/provider-cache.js");
  resetCache();
  resetFixtures();

  const { output } = await captureStdoutWithValue(() => loadProviderModels({
    quiet: true,
    env: envWithNoOpenRouterCredential(),
  }));

  const policyIndex = output.indexOf("OpenRouter policy configuration: unavailable; checking cached exclusions before probes");
  const verboseIndex = output.indexOf("opencode models --verbose");
  assert.notEqual(policyIndex, -1);
  assert.notEqual(verboseIndex, -1);
  assert.ok(policyIndex < verboseIndex);
  assert.doesNotMatch(output, /OpenRouter policy configuration: excluded \d+ models? before probes/);
});

test("preparePaidProviderModels probes allowed OpenRouter refs without spawning policy-blocked refs", async () => {
  const { loadProviderModels, resetCache } = await import("../../lib/shared/provider-cache.js");
  const { preparePaidProviderModels } = await import("../../lib/recommend/paid-provider-prep.js");
  const { RuntimeContext } = await import("../../lib/runtime-context.js");
  resetCache();
  resetFixtures();
  const initialCache = await captureStdout(() => loadProviderModels({
    quiet: true,
    env: { OPENROUTER_API_KEY: "policy-key" },
  }));
  const ctx = new RuntimeContext();
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
  }));
  await prepared.ensureProbesAwaited();

  assert.deepEqual(invocations, ["openrouter/allowed-model"]);
  assert.deepEqual(
    (await prepared.probeRecordsPromise).map((record) => ({
      modelRef: record.modelRef,
      spawned: record.spawned,
    })),
    [{ modelRef: "openrouter/allowed-model", spawned: true }],
  );
});

test("loadProviderModels keeps OpenRouter refs when authenticated policy list is unavailable", async () => {
  const { loadProviderModels, resetCache } = await import("../../lib/shared/provider-cache.js");
  resetCache();
  resetFixtures();
  userModelsStatusCode = 401;

  const cache = await captureStdout(() => loadProviderModels({
    quiet: true,
    env: { OPENROUTER_API_KEY: "bad-key" },
  }));

  assert.deepEqual(cache.models.openrouter.map((model) => model.id), [
    "allowed-model",
    "policy-blocked-model",
  ]);
});

test("loadProviderModels keeps OpenRouter refs when authenticated policy response shape is unexpected", async () => {
  const { loadProviderModels, resetCache } = await import("../../lib/shared/provider-cache.js");
  resetCache();
  resetFixtures();
  userModelsResponse = { error: { message: "policy endpoint unavailable" } };

  const cache = await captureStdout(() => loadProviderModels({
    quiet: true,
    env: { OPENROUTER_API_KEY: "policy-key" },
  }));

  assert.deepEqual(cache.models.openrouter.map((model) => model.id), [
    "allowed-model",
    "policy-blocked-model",
  ]);
});

test("loadProviderModels uses valid ids from a partial OpenRouter policy response", async () => {
  const { loadProviderModels, resetCache } = await import("../../lib/shared/provider-cache.js");
  resetCache();
  resetFixtures();
  userModelsResponse = {
    data: [
      { id: "allowed-model" },
      {},
      { id: 123 },
    ],
  };

  const cache = await captureStdout(() => loadProviderModels({
    quiet: true,
    env: { OPENROUTER_API_KEY: "policy-key" },
  }));

  assert.deepEqual(cache.models.openrouter.map((model) => model.id), [
    "allowed-model",
  ]);
});

test("loadProviderModels does not reuse a no-key cache for an authenticated OpenRouter policy run", async () => {
  const { loadProviderModels, resetCache } = await import("../../lib/shared/provider-cache.js");
  resetCache();
  resetFixtures();

  const noKeyCache = await captureStdout(() => loadProviderModels({
    quiet: true,
    env: envWithNoOpenRouterCredential(),
  }));
  assert.deepEqual(noKeyCache.models.openrouter.map((model) => model.id), [
    "allowed-model",
    "policy-blocked-model",
  ]);
  assert.equal(httpsRequests.length, 0);

  const keyedCache = await captureStdout(() => loadProviderModels({
    quiet: true,
    env: { OPENROUTER_API_KEY: "policy-key" },
  }));

  assert.deepEqual(keyedCache.models.openrouter.map((model) => model.id), [
    "allowed-model",
  ]);
  assert.equal(httpsRequests.length, 1);
});
