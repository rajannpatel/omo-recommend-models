import assert from "node:assert/strict";
import test, { mock } from "node:test";

let prepareArguments = null;

mock.module("../../lib/recommend/paid-provider-prep.js", {
  namedExports: {
    preparePaidProviderModels: async (args) => {
      prepareArguments = args;
      return {
        initialCache: args.initialCache,
        paidProbesPromise: Promise.resolve([]),
        rejectedPaidModelsPromise: Promise.resolve([]),
        rejectedPaidModelDetailsPromise: Promise.resolve(new Map()),
        probeRecordsPromise: Promise.resolve([]),
        ensureProbesAwaited: async () => {},
      };
    },
  },
});

mock.module("../../lib/recommend/local-environment.js", {
  namedExports: {
    discoverLocalEnvironment: async () => ({
      allLocalModels: [],
      gpu: { hasGpu: false, name: "", label: "Not checked", vramGb: 0 },
      localModelNames: [],
      ollama: { installed: false, running: false, version: null, models: [] },
    }),
  },
});

mock.module("../../lib/recommend/local-recommendation-context.js", {
  namedExports: {
    buildLocalRecommendationContext: () => null,
  },
});

const {
  buildRecommendationInputs,
  loadLiveProviderModels,
  resolveExcludeFreeFromConfig,
} = await import("../../lib/cli/recommend-inputs.js");

test("resolveExcludeFreeFromConfig - _noFreeConfigExplicit returns true", () => {
  const result = resolveExcludeFreeFromConfig({ _noFreeConfigExplicit: true });
  assert.equal(result, true);
});

test("resolveExcludeFreeFromConfig - _freeConfigExplicit returns false", () => {
  const result = resolveExcludeFreeFromConfig({ _freeConfigExplicit: true });
  assert.equal(result, false);
});

test("resolveExcludeFreeFromConfig - both explicit: _noFreeConfigExplicit wins", () => {
  const result = resolveExcludeFreeFromConfig({
    _noFreeConfigExplicit: true,
    _freeConfigExplicit: true,
  });
  assert.equal(result, true);
});

test("resolveExcludeFreeFromConfig - no flags returns false (default: free included)", () => {
  const result = resolveExcludeFreeFromConfig({});
  assert.equal(result, false);
});

function captureLines() {
  const lines = [];
  return {
    lines,
    writeGroupLine: (line) => lines.push(`│  ${line}`),
    writeTopLevelLine: (line) => lines.push(line),
  };
}

test("loadLiveProviderModels times the one actual load and reports raw provider provenance", async () => {
  const output = captureLines();
  const calls = [];
  const ticks = [100, 1703];
  const liveCache = {
    models: {
      google: ["gemini-2.5-pro"],
      openai: [{ id: "gpt-5.5", capabilities: { toolcall: true } }],
    },
  };

  const result = await loadLiveProviderModels({
    ctx: { marker: "ctx" },
    loadProviderModelsFn: async (options) => {
      calls.push({ kind: "load", options });
      assert.deepEqual(output.lines, ["◇  Checking live provider models..."]);
      return liveCache;
    },
    now: () => {
      calls.push({ kind: "clock" });
      return ticks.shift();
    },
    ...output,
  });

  assert.deepEqual(calls, [
    { kind: "clock" },
    { kind: "load", options: { ctx: { marker: "ctx" } } },
    { kind: "clock" },
  ]);
  assert.deepEqual(output.lines, [
    "◇  Checking live provider models...",
    "◇  2 providers identified in `opencode models` output (2s)",
    "│  • google",
    "│  • openai",
  ]);
  assert.deepEqual(result.providerOrder, ["google", "openai"]);
  assert.notEqual(result.cache, liveCache);
  assert.notEqual(result.cache.models, liveCache.models);
  assert.notEqual(result.cache.models.google, liveCache.models.google);

  result.cache.models.google.push({ id: "synthetic-free" });
  result.cache.models.opencode = [{ id: "synthetic-free" }];
  assert.deepEqual(result.providerOrder, ["google", "openai"]);
  assert.deepEqual(liveCache, {
    models: {
      google: ["gemini-2.5-pro"],
      openai: [{ id: "gpt-5.5", capabilities: { toolcall: true } }],
    },
  });
});

test("loadLiveProviderModels clamps a backwards clock and handles an empty advertisement", async () => {
  const output = captureLines();
  const ticks = [5000, 1000];
  let loadCount = 0;

  const result = await loadLiveProviderModels({
    loadProviderModelsFn: async () => {
      loadCount += 1;
      return { models: {} };
    },
    now: () => ticks.shift(),
    ...output,
  });

  assert.equal(loadCount, 1);
  assert.deepEqual(result, { cache: { models: {} }, providerOrder: [] });
  assert.deepEqual(output.lines, [
    "◇  Checking live provider models...",
    "◇  0 providers identified in `opencode models` output (0s)",
  ]);
});

test("loadLiveProviderModels fails without printing a misleading completion", async () => {
  const output = captureLines();
  let clockCount = 0;

  await assert.rejects(
    loadLiveProviderModels({
      loadProviderModelsFn: async () => {
        throw new Error("opencode models failed");
      },
      now: () => {
        clockCount += 1;
        return 0;
      },
      ...output,
    }),
    /opencode models failed/,
  );

  assert.equal(clockCount, 1);
  assert.deepEqual(output.lines, ["◇  Checking live provider models..."]);
});

test("loadLiveProviderModels treats malformed model provenance as empty", async () => {
  const output = captureLines();
  const ticks = [0, 1];

  const result = await loadLiveProviderModels({
    loadProviderModelsFn: async () => ({ models: ["not-a-provider-map"] }),
    now: () => ticks.shift(),
    ...output,
  });

  assert.deepEqual(result, { cache: { models: {} }, providerOrder: [] });
  assert.deepEqual(output.lines, [
    "◇  Checking live provider models...",
    "◇  0 providers identified in `opencode models` output (0s)",
  ]);
});

test("buildRecommendationInputs passes the one loaded clone onward before synthetic augmentation", async () => {
  prepareArguments = null;
  let loadCount = 0;
  const ticks = [10, 1613];
  const source = {
    models: {
      google: [{ id: "gemini-live", capabilities: { toolcall: true } }],
    },
  };
  const ctx = {
    localRecommendationContext: undefined,
    verboseMode: false,
  };
  const output = captureLines();

  const inputs = await buildRecommendationInputs({
    commandExists: async () => false,
    ctx,
    discoverFreeModelsFn: () => ["opencode/synthetic-free"],
    loadProviderModelsFn: async () => {
      loadCount += 1;
      return source;
    },
    now: () => ticks.shift(),
    parsedArgs: {},
    runOptions: {
      cloudOnlyFlag: true,
      globalFlag: false,
      localOnlyFlag: false,
    },
    subprocess: { fetchUrlAsync: async () => "" },
    writeGroupLineFn: output.writeGroupLine,
    writeTopLevelLineFn: output.writeTopLevelLine,
  });

  assert.equal(loadCount, 1);
  assert.deepEqual(prepareArguments.initialCache, {
    models: {
      google: [{ id: "gemini-live", capabilities: { toolcall: true } }],
    },
  });
  assert.notEqual(prepareArguments.initialCache, source);
  assert.deepEqual(Object.keys(prepareArguments.initialCache.models), ["google"]);
  assert.deepEqual([...inputs.cloudLookup.byId.opencode.keys()], ["synthetic-free"]);
  assert.equal(inputs.cloudProviderCount, 2);
  assert.deepEqual(output.lines, [
    "◇  Checking live provider models...",
    "◇  1 providers identified in `opencode models` output (2s)",
    "│  • google",
  ]);
  assert.doesNotMatch(output.lines.join("\n"), /opencode.*•|Loaded:/);
});
