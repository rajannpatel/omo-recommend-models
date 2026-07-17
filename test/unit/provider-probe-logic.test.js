import assert from "node:assert/strict";
import test from "node:test";

import { RuntimeContext } from "../../lib/runtime-context.js";

test("detectDefaultProbeGlobalConcurrency prefers availableParallelism over cpus().length", async () => {
  const { detectDefaultProbeGlobalConcurrency } = await import(
    "../../lib/recommend/providers/probe-orchestration.js"
  );
  assert.equal(
    detectDefaultProbeGlobalConcurrency({
      availableParallelism: () => 8,
      cpus: () => Array.from({ length: 4 }),
    }),
    8,
  );
});

test("detectDefaultProbeGlobalConcurrency falls back to cpus().length when availableParallelism is absent", async () => {
  const { detectDefaultProbeGlobalConcurrency } = await import(
    "../../lib/recommend/providers/probe-orchestration.js"
  );
  assert.equal(
    detectDefaultProbeGlobalConcurrency({
      cpus: () => Array.from({ length: 5 }),
    }),
    5,
  );
});

test("detectDefaultProbeGlobalConcurrency respects a genuinely detected single-core host", async () => {
  const { detectDefaultProbeGlobalConcurrency } = await import(
    "../../lib/recommend/providers/probe-orchestration.js"
  );
  assert.equal(
    detectDefaultProbeGlobalConcurrency({
      availableParallelism: () => 1,
      cpus: () => Array.from({ length: 1 }),
    }),
    1,
  );
});

test("detectDefaultProbeGlobalConcurrency floors at 2 when both detection sources are unusable", async () => {
  const { detectDefaultProbeGlobalConcurrency } = await import(
    "../../lib/recommend/providers/probe-orchestration.js"
  );
  assert.equal(
    detectDefaultProbeGlobalConcurrency({
      availableParallelism: () => undefined,
      cpus: () => [],
    }),
    2,
  );
});

test("detectDefaultProbeGlobalConcurrency falls back to cpus().length when availableParallelism throws", async () => {
  const { detectDefaultProbeGlobalConcurrency } = await import(
    "../../lib/recommend/providers/probe-orchestration.js"
  );
  assert.equal(
    detectDefaultProbeGlobalConcurrency({
      availableParallelism: () => {
        throw new Error("blocked in this sandbox");
      },
      cpus: () => Array.from({ length: 3 }),
    }),
    3,
  );
});

function createProbeContext() {
  return new RuntimeContext();
}

function mockProbeResult(modelRef) {
  if (modelRef === "anthropic/timeout-release") {
    return {
      ok: false,
      reason: "timeout",
    };
  }
  if (modelRef.endsWith("/bad-release")) {
    return {
      ok: false,
      reason: "model-unavailable",
      errorOutput: "Bad Request: The 'bad-release' model is not supported",
    };
  }
  if (modelRef === "openrouter/policy-blocked") {
    return {
      ok: false,
      reason: "guardrail-policy-exclusion",
      errorOutput: "Request rejected by data policy guardrail",
    };
  }
  if (modelRef === "openai/fail-model" || modelRef === "google/fail-model") {
    return {
      ok: false,
      reason: "exit-code-1",
      errorOutput: "provider failed",
    };
  }
  return { ok: true };
}

function createProbeFn(invocations, resultForRef = mockProbeResult) {
  return async (_ctx, modelRef) => {
    invocations.push(modelRef);
    return resultForRef(modelRef);
  };
}

function createDeferredProbeFn(resultForRef = () => ({ ok: true })) {
  const started = [];
  const pending = new Map();
  const activeByProvider = new Map();
  let activeGlobal = 0;
  let maxGlobal = 0;
  let maxProvider = 0;

  const probeFn = async (_ctx, modelRef) => {
    const provider = modelRef.slice(0, modelRef.indexOf("/"));
    started.push(modelRef);
    activeGlobal += 1;
    activeByProvider.set(provider, (activeByProvider.get(provider) || 0) + 1);
    maxGlobal = Math.max(maxGlobal, activeGlobal);
    maxProvider = Math.max(maxProvider, activeByProvider.get(provider));
    return await new Promise((resolve) => {
      pending.set(modelRef, () => {
        activeGlobal -= 1;
        activeByProvider.set(provider, activeByProvider.get(provider) - 1);
        resolve(resultForRef(modelRef));
      });
    });
  };

  const resolveRef = async (modelRef) => {
    const resolve = pending.get(modelRef);
    assert.ok(resolve, `${modelRef} should be pending`);
    pending.delete(modelRef);
    resolve();
    await Promise.resolve();
  };

  const drain = async () => {
    for (let index = 0; index < started.length; index += 1) {
      const modelRef = started[index];
      if (pending.has(modelRef)) await resolveRef(modelRef);
    }
  };

  return {
    drain,
    maxGlobal: () => maxGlobal,
    maxProvider: () => maxProvider,
    pendingRefs: () => [...pending.keys()],
    probeFn,
    resolveRef,
    started,
  };
}

function cloudLookupWithFreeRefs(refs) {
  const byId = {};
  for (const modelRef of refs) {
    const slash = modelRef.indexOf("/");
    const provider = modelRef.slice(0, slash);
    const model = modelRef.slice(slash + 1);
    byId[provider] ??= new Map();
    byId[provider].set(model, { cost: { input: 0, output: 0 } });
  }
  return { byId };
}

async function waitForSchedulerTurn() {
  await new Promise((resolve) => setImmediate(resolve));
}

function memoryPolicyCache(initialRefs = []) {
  const refs = new Set(initialRefs);
  const added = [];
  return {
    added,
    has: (modelRef) => refs.has(modelRef),
    add(modelRef) {
      added.push(modelRef);
      refs.add(modelRef);
      return true;
    },
    values: () => [...refs].sort(),
  };
}

async function captureStdout(fn) {
  const chunks = [];
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk) => {
    chunks.push(String(chunk));
    return true;
  };
  try {
    return { value: await fn(), stdout: chunks.join("") };
  } finally {
    process.stdout.write = originalWrite;
  }
}

test("runProviderProbes probes every eligible ref and returns ordered records", async () => {
  const { runProviderProbes } = await import("../../lib/recommend/providers/probe-orchestration.js");
  const ctx = createProbeContext();
  const invocations = [];
  const eligibleRefs = [
    "google/gemini-string-only",
    "anthropic/claude",
    "google/gemini-free",
    "anthropic/haiku",
  ];

  const { value: probes, stdout } = await captureStdout(async () => {
    const value = await runProviderProbes({
      ctx,
      eligibleRefs,
      probeConcurrency: { global: 4, perProvider: 2 },
      probeModelFn: createProbeFn(invocations),
    });
    await value.ensureProbesAwaited();
    return value;
  });

  assert.deepEqual(invocations, eligibleRefs);
  assert.deepEqual(await probes.paidProbesPromise, eligibleRefs);
  assert.deepEqual(await probes.rejectedPaidModelsPromise, []);
  assert.deepEqual(await probes.probeRecordsPromise, eligibleRefs.map((modelRef) => {
    const slash = modelRef.indexOf("/");
    return {
      modelRef,
      provider: modelRef.slice(0, slash),
      model: modelRef.slice(slash + 1),
      outcome: "available",
      reason: null,
      source: "probe",
      spawned: true,
    };
  }));
  assert.equal(stdout, [
    "◇  Probing 4 model(s) across AI providers...",
    "✓  model: google/gemini-string-only on provider: google is available",
    "✓  model: anthropic/claude on provider: anthropic is available",
    "✓  model: google/gemini-free on provider: google is available",
    "✓  model: anthropic/haiku on provider: anthropic is available",
    "◇  Cloud model verification complete: 4 eligible; 4 probed, 4 available, 0 failed, 0 cached, 0 skipped",
    "",
  ].join("\n"));
  assert.doesNotMatch(stdout, /verified \d+\/\d+|~30s|Cloud provider verification/);
});

test("runProviderProbes continues transient failures on the same provider but cools it down after a rate-limit, without blocking sibling providers", async () => {
  const { runProviderProbes } = await import("../../lib/recommend/providers/probe-orchestration.js");
  const ctx = createProbeContext();
  const cache = memoryPolicyCache();
  ctx.policyExclusionCache = cache;
  const results = new Map([
    ["google/timeout", { ok: false, reason: "timeout", scope: "model" }],
    ["google/policy", {
      ok: false,
      reason: "guardrail-policy-exclusion",
      scope: "model",
      errorOutput: "forbidden by data policy",
    }],
    ["google/limited", { ok: false, reason: "rate-limited", scope: "model", errorOutput: "Retry-After: 30" }],
  ]);
  const deferred = createDeferredProbeFn((modelRef) => results.get(modelRef) || { ok: true });
  const eligibleRefs = [
    "google/ok-1",
    "google/timeout",
    "google/policy",
    "google/limited",
    "google/ok-2",
    "anthropic/sibling",
  ];

  const probes = await runProviderProbes({
    ctx,
    eligibleRefs,
    probeConcurrency: { global: 2, perProvider: 1 },
    probeModelFn: deferred.probeFn,
  });
  await Promise.resolve();

  assert.deepEqual(deferred.started, ["google/ok-1", "anthropic/sibling"]);
  await deferred.resolveRef("google/ok-1");
  await waitForSchedulerTurn();
  assert.deepEqual(deferred.started, ["google/ok-1", "anthropic/sibling", "google/timeout"]);
  await deferred.resolveRef("google/timeout");
  await waitForSchedulerTurn();
  assert.deepEqual(deferred.started, ["google/ok-1", "anthropic/sibling", "google/timeout", "google/policy"]);
  await deferred.resolveRef("google/policy");
  await waitForSchedulerTurn();
  assert.deepEqual(
    deferred.started,
    ["google/ok-1", "anthropic/sibling", "google/timeout", "google/policy", "google/limited"],
  );
  await deferred.resolveRef("google/limited");
  await deferred.resolveRef("anthropic/sibling");
  await probes.ensureProbesAwaited();

  // google/ok-2 was still queued when the rate-limit closed the provider, so it never dispatched.
  assert.deepEqual(
    deferred.started,
    ["google/ok-1", "anthropic/sibling", "google/timeout", "google/policy", "google/limited"],
  );
  assert.deepEqual(cache.added, ["google/policy"]);
  assert.deepEqual(cache.values(), ["google/policy"]);
  // google/ok-1 succeeded, but google is rate-limited by the time this
  // resolves - paidProbesPromise excludes it so nothing re-dispatches a
  // live opencode run against a provider currently cooling down.
  assert.deepEqual(await probes.paidProbesPromise, ["anthropic/sibling"]);
  assert.deepEqual(await probes.rejectedPaidModelsPromise, [
    "google/timeout",
    "google/policy",
    "google/limited",
    "google/ok-2",
  ]);
  assert.deepEqual(
    [...(await probes.rejectedPaidModelDetailsPromise).keys()],
    ["google/timeout", "google/policy", "google/limited", "google/ok-2"],
  );
});

test("runProviderProbes seeds only advertised cached refs without spawning", async () => {
  const { runProviderProbes } = await import("../../lib/recommend/providers/probe-orchestration.js");
  const ctx = createProbeContext();
  const cache = memoryPolicyCache(["stale/unadvertised", "google/cached"]);
  ctx.policyExclusionCache = cache;
  const invocations = [];

  const { value: probes, stdout } = await captureStdout(async () => {
    const value = await runProviderProbes({
      ctx,
      eligibleRefs: ["google/cached", "google/live"],
      probeModelFn: createProbeFn(invocations),
    });
    await value.ensureProbesAwaited();
    return value;
  });

  assert.deepEqual(invocations, ["google/live"]);
  assert.deepEqual(cache.added, []);
  assert.deepEqual(await probes.paidProbesPromise, ["google/live"]);
  assert.deepEqual(await probes.rejectedPaidModelsPromise, ["google/cached"]);
  assert.deepEqual(await probes.probeRecordsPromise, [
    {
      modelRef: "google/cached",
      provider: "google",
      model: "cached",
      outcome: "cached-policy",
      reason: "guardrail-policy-exclusion",
      source: "cache",
      spawned: false,
    },
    {
      modelRef: "google/live",
      provider: "google",
      model: "live",
      outcome: "available",
      reason: null,
      source: "probe",
      spawned: true,
    },
  ]);
  assert.match(stdout, /google\/cached.*guardrail-policy-exclusion \(cached\)/);
  assert.doesNotMatch(stdout, /stale\/unadvertised/);
  assert.match(stdout, /2 eligible; 1 probed, 1 available, 0 failed, 1 cached, 0 skipped/);
});

test("runProviderProbes bounds async probes globally and per provider", async () => {
  const { runProviderProbes } = await import("../../lib/recommend/providers/probe-orchestration.js");
  const ctx = createProbeContext();
  const deferred = createDeferredProbeFn();
  const eligibleRefs = [
    "google/one",
    "google/two",
    "anthropic/one",
    "xai/one",
    "openai/one",
    "mistral/one",
  ];

  const probes = await runProviderProbes({
    ctx,
    eligibleRefs,
    probeConcurrency: { global: 4, perProvider: 1 },
    probeModelFn: deferred.probeFn,
  });
  await Promise.resolve();

  assert.deepEqual(deferred.started, [
    "google/one",
    "anthropic/one",
    "xai/one",
    "openai/one",
  ]);
  await deferred.drain();
  await probes.ensureProbesAwaited();

  assert.equal(deferred.maxGlobal(), 4);
  assert.equal(deferred.maxProvider(), 1);
  assert.deepEqual((await probes.probeRecordsPromise).map((record) => record.modelRef), eligibleRefs);
});

test("runProviderProbes runs at most one free or local probe at a time", async () => {
  const { runProviderProbes } = await import("../../lib/recommend/providers/probe-orchestration.js");
  const ctx = createProbeContext();
  const deferred = createDeferredProbeFn();

  const probes = await runProviderProbes({
    ctx,
    cloudLookup: cloudLookupWithFreeRefs(["google/free", "openrouter/free"]),
    eligibleRefs: ["google/free", "openrouter/free", "anthropic/paid", "xai/paid"],
    probeConcurrency: { global: 4, perProvider: 1, freeOrLocal: 1 },
    probeModelFn: deferred.probeFn,
  });
  await Promise.resolve();

  assert.deepEqual(deferred.started, ["google/free", "anthropic/paid", "xai/paid"]);
  assert.deepEqual(deferred.pendingRefs(), ["google/free", "anthropic/paid", "xai/paid"]);

  await deferred.resolveRef("google/free");
  await waitForSchedulerTurn();
  assert.equal(deferred.started.includes("openrouter/free"), true);
  await deferred.drain();
  await probes.ensureProbesAwaited();
});

test("runProviderProbes closes exhausted provider queues without blocking other providers", async () => {
  const { runProviderProbes } = await import("../../lib/recommend/providers/probe-orchestration.js");
  const ctx = createProbeContext();
  const deferred = createDeferredProbeFn((modelRef) =>
    modelRef === "google/quota"
      ? { ok: false, reason: "quota-exceeded", scope: "provider" }
      : { ok: true });
  const eligibleRefs = [
    "google/quota",
    "google/skipped-later",
    "anthropic/ok",
    "xai/ok",
  ];

  const probes = await runProviderProbes({
    ctx,
    eligibleRefs,
    probeConcurrency: { global: 3, perProvider: 1 },
    probeModelFn: deferred.probeFn,
  });
  await Promise.resolve();
  await deferred.resolveRef("google/quota");
  await deferred.drain();
  await probes.ensureProbesAwaited();

  assert.deepEqual(deferred.started, ["google/quota", "anthropic/ok", "xai/ok"]);
  assert.deepEqual(
    (await probes.probeRecordsPromise).map(({ modelRef, outcome, reason, spawned }) => ({
      modelRef,
      outcome,
      reason,
      spawned,
    })),
    [
      { modelRef: "google/quota", outcome: "failed", reason: "quota-exceeded", spawned: true },
      { modelRef: "google/skipped-later", outcome: "skipped-provider-exhausted", reason: "quota-exceeded", spawned: false },
      { modelRef: "anthropic/ok", outcome: "available", reason: null, spawned: true },
      { modelRef: "xai/ok", outcome: "available", reason: null, spawned: true },
    ],
  );
});

test("runProviderProbes invalidates late same-provider successes after provider exhaustion", async () => {
  const { runProviderProbes } = await import("../../lib/recommend/providers/probe-orchestration.js");
  const ctx = createProbeContext();
  const deferred = createDeferredProbeFn((modelRef) =>
    modelRef === "google/quota"
      ? { ok: false, reason: "quota-exceeded", scope: "provider" }
      : { ok: true });

  const probes = await runProviderProbes({
    ctx,
    eligibleRefs: ["google/slow-success", "google/quota", "google/skipped-later"],
    probeConcurrency: { global: 2, perProvider: 2 },
    probeModelFn: deferred.probeFn,
  });
  await Promise.resolve();

  assert.deepEqual(deferred.started, ["google/slow-success", "google/quota"]);
  await deferred.resolveRef("google/quota");
  await deferred.resolveRef("google/slow-success");
  await probes.ensureProbesAwaited();

  assert.deepEqual(await probes.paidProbesPromise, []);
  assert.deepEqual(
    (await probes.probeRecordsPromise).map(({ modelRef, outcome, reason, source, spawned }) => ({
      modelRef,
      outcome,
      reason,
      source,
      spawned,
    })),
    [
      {
        modelRef: "google/slow-success",
        outcome: "failed",
        reason: "provider-quota-exhausted",
        source: "orchestrator",
        spawned: true,
      },
      {
        modelRef: "google/quota",
        outcome: "failed",
        reason: "quota-exceeded",
        source: "probe",
        spawned: true,
      },
      {
        modelRef: "google/skipped-later",
        outcome: "skipped-provider-exhausted",
        reason: "quota-exceeded",
        source: "orchestrator",
        spawned: false,
      },
    ],
  );
});

test("runProviderProbes invalidates earlier success only after strong provider exhaustion", async () => {
  const { runProviderProbes } = await import("../../lib/recommend/providers/probe-orchestration.js");
  const ctx = createProbeContext();
  const invocations = [];
  const eligibleRefs = ["google/ok-before", "google/quota", "google/after-quota"];

  const probes = await runProviderProbes({
    ctx,
    eligibleRefs,
    probeModelFn: createProbeFn(invocations, (modelRef) =>
      modelRef === "google/quota"
        ? {
            ok: false,
            reason: "quota-exceeded",
            scope: "provider",
            errorOutput: "HTTP 402 payment required",
          }
        : { ok: true }),
  });
  await probes.ensureProbesAwaited();

  assert.deepEqual(invocations, ["google/ok-before", "google/quota"]);
  assert.deepEqual(await probes.paidProbesPromise, []);
  assert.deepEqual(await probes.rejectedPaidModelsPromise, eligibleRefs);
  assert.deepEqual(
    (await probes.probeRecordsPromise).map(({ modelRef, outcome, reason, source, spawned }) => ({
      modelRef,
      outcome,
      reason,
      source,
      spawned,
    })),
    [
      {
        modelRef: "google/ok-before",
        outcome: "failed",
        reason: "provider-quota-exhausted",
        source: "orchestrator",
        spawned: true,
      },
      {
        modelRef: "google/quota",
        outcome: "failed",
        reason: "quota-exceeded",
        source: "probe",
        spawned: true,
      },
      {
        modelRef: "google/after-quota",
        outcome: "skipped-provider-exhausted",
        reason: "quota-exceeded",
        source: "orchestrator",
        spawned: false,
      },
    ],
  );
  assert.equal(ctx.quotaExceededProviders.has("google"), true);
  assert.equal(ctx.providerAvailability.get("google")?.creditExhausted, true);
});

test("runProviderProbes cools down a rate-limited provider without blocking other providers", async () => {
  const { runProviderProbes } = await import("../../lib/recommend/providers/probe-orchestration.js");
  const ctx = createProbeContext();
  const deferred = createDeferredProbeFn((modelRef) =>
    modelRef === "google/limited"
      ? { ok: false, reason: "rate-limited", scope: "model", errorOutput: "Retry-After: 30" }
      : { ok: true });
  const eligibleRefs = [
    "google/limited",
    "google/skipped-later",
    "anthropic/ok",
    "xai/ok",
  ];

  const probes = await runProviderProbes({
    ctx,
    eligibleRefs,
    probeConcurrency: { global: 3, perProvider: 1 },
    probeModelFn: deferred.probeFn,
  });
  await Promise.resolve();
  await deferred.resolveRef("google/limited");
  await deferred.drain();
  await probes.ensureProbesAwaited();

  assert.deepEqual(deferred.started, ["google/limited", "anthropic/ok", "xai/ok"]);
  assert.deepEqual(
    (await probes.probeRecordsPromise).map(({ modelRef, outcome, reason, spawned }) => ({
      modelRef,
      outcome,
      reason,
      spawned,
    })),
    [
      { modelRef: "google/limited", outcome: "failed", reason: "rate-limited", spawned: true },
      { modelRef: "google/skipped-later", outcome: "skipped-provider-exhausted", reason: "rate-limited", spawned: false },
      { modelRef: "anthropic/ok", outcome: "available", reason: null, spawned: true },
      { modelRef: "xai/ok", outcome: "available", reason: null, spawned: true },
    ],
  );
  const googleState = ctx.providerAvailability.get("google");
  assert.equal(typeof googleState?.rateLimitedUntil, "number");
  assert.ok(googleState.rateLimitedUntil > Date.now());
  assert.equal(googleState.creditExhausted, false);
  assert.equal(ctx.quotaExceededProviders.has("google"), false);
});

test("runProviderProbes keeps a rate-limited provider's earlier probe record available but excludes it from paidProbesPromise", async () => {
  const { runProviderProbes } = await import("../../lib/recommend/providers/probe-orchestration.js");
  const ctx = createProbeContext();
  const deferred = createDeferredProbeFn((modelRef) =>
    modelRef === "google/limited"
      ? { ok: false, reason: "rate-limited", scope: "model", errorOutput: "Retry-After: 30" }
      : { ok: true });

  const probes = await runProviderProbes({
    ctx,
    eligibleRefs: ["google/slow-success", "google/limited", "google/skipped-later"],
    probeConcurrency: { global: 2, perProvider: 2 },
    probeModelFn: deferred.probeFn,
  });
  await Promise.resolve();

  assert.deepEqual(deferred.started, ["google/slow-success", "google/limited"]);
  await deferred.resolveRef("google/limited");
  await deferred.resolveRef("google/slow-success");
  await probes.ensureProbesAwaited();

  // The probe record itself is not invalidated (unlike quota exhaustion) -
  // it genuinely succeeded. But paidProbesPromise feeds callers (e.g. the
  // fitness-ranking paid-evaluator fallback) that will spawn ANOTHER live
  // `opencode run` against this ref, so it must respect the provider's
  // current rate-limit cooldown rather than trusting a stale success.
  assert.deepEqual(await probes.paidProbesPromise, []);
  assert.deepEqual(
    (await probes.probeRecordsPromise).map(({ modelRef, outcome, reason, source, spawned }) => ({
      modelRef,
      outcome,
      reason,
      source,
      spawned,
    })),
    [
      {
        modelRef: "google/slow-success",
        outcome: "available",
        reason: null,
        source: "probe",
        spawned: true,
      },
      {
        modelRef: "google/limited",
        outcome: "failed",
        reason: "rate-limited",
        source: "probe",
        spawned: true,
      },
      {
        modelRef: "google/skipped-later",
        outcome: "skipped-provider-exhausted",
        reason: "rate-limited",
        source: "orchestrator",
        spawned: false,
      },
    ],
  );
});

test("runProviderProbes keeps global order while skipping later refs from an exhausted provider", async () => {
  const { runProviderProbes } = await import("../../lib/recommend/providers/probe-orchestration.js");
  const ctx = createProbeContext();
  const invocations = [];
  const eligibleRefs = [
    "google/ok-before",
    "anthropic/ok-between",
    "google/quota",
    "anthropic/ok-after",
    "google/skipped-later",
  ];

  const probes = await runProviderProbes({
    ctx,
    eligibleRefs,
    probeConcurrency: { global: 4, perProvider: 2 },
    probeModelFn: createProbeFn(invocations, (modelRef) =>
      modelRef === "google/quota"
        ? { ok: false, reason: "quota-exceeded", scope: "provider" }
        : { ok: true }),
  });
  await probes.ensureProbesAwaited();

  assert.deepEqual(invocations, [
    "google/ok-before",
    "anthropic/ok-between",
    "google/quota",
    "anthropic/ok-after",
  ]);
  assert.deepEqual(
    (await probes.probeRecordsPromise).map((record) => record.modelRef),
    eligibleRefs,
  );
  assert.deepEqual(await probes.paidProbesPromise, [
    "anthropic/ok-between",
    "anthropic/ok-after",
  ]);
});

test("runProviderProbes records an in-flight abort and fills every remaining ref", async () => {
  const { runProviderProbes } = await import("../../lib/recommend/providers/probe-orchestration.js");
  const ctx = createProbeContext();
  const invocations = [];
  const eligibleRefs = ["google/in-flight", "google/after", "anthropic/after"];

  const probes = await runProviderProbes({
    ctx,
    eligibleRefs,
    probeModelFn: createProbeFn(invocations, () => {
      ctx.abortController.abort();
      return { ok: false, reason: "aborted", scope: "model", errorOutput: "Aborted by user" };
    }),
  });
  await probes.ensureProbesAwaited();

  assert.deepEqual(invocations, ["google/in-flight"]);
  assert.deepEqual(
    (await probes.probeRecordsPromise).map(({ modelRef, outcome, reason, spawned }) => ({
      modelRef,
      outcome,
      reason,
      spawned,
    })),
    [
      { modelRef: "google/in-flight", outcome: "failed", reason: "aborted", spawned: true },
      { modelRef: "google/after", outcome: "skipped-aborted", reason: "aborted", spawned: false },
      { modelRef: "anthropic/after", outcome: "skipped-aborted", reason: "aborted", spawned: false },
    ],
  );
});

test("runProviderProbes propagates internal probe errors through every public awaiter", async () => {
  const { runProviderProbes } = await import("../../lib/recommend/providers/probe-orchestration.js");
  const ctx = createProbeContext();
  const probes = await runProviderProbes({
    ctx,
    eligibleRefs: ["google/internal-error"],
    probeModelFn: async () => {
      throw new Error("child seam exploded");
    },
  });

  const settled = await Promise.allSettled([
    probes.probeRecordsPromise,
    probes.paidProbesPromise,
    probes.rejectedPaidModelsPromise,
    probes.rejectedPaidModelDetailsPromise,
    probes.ensureProbesAwaited(),
  ]);
  assert.deepEqual(
    settled.map((result) => [result.status, result.reason?.message]),
    Array.from({ length: 5 }, () => ["rejected", "child seam exploded"]),
  );
});
