import assert from "node:assert/strict";
import test from "node:test";

import { RuntimeContext } from "../../lib/runtime-context.js";

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
    "✓  model: google/gemini-string-only on provider: google is available",
    "✓  model: anthropic/claude on provider: anthropic is available",
    "✓  model: google/gemini-free on provider: google is available",
    "✓  model: anthropic/haiku on provider: anthropic is available",
    "◇  Cloud model verification complete: 4 eligible; 4 probed, 4 available, 0 failed, 0 cached, 0 skipped",
    "",
  ].join("\n"));
  assert.doesNotMatch(stdout, /verified \d+\/\d+|~30s|Cloud provider verification/);
});

test("runProviderProbes continues transient siblings and persists only live policy failures", async () => {
  const { runProviderProbes } = await import("../../lib/recommend/providers/probe-orchestration.js");
  const ctx = createProbeContext();
  const cache = memoryPolicyCache();
  ctx.policyExclusionCache = cache;
  const invocations = [];
  const results = new Map([
    ["google/limited", { ok: false, reason: "rate-limited", scope: "model" }],
    ["google/timeout", { ok: false, reason: "timeout", scope: "model" }],
    ["google/policy", {
      ok: false,
      reason: "guardrail-policy-exclusion",
      scope: "model",
      errorOutput: "forbidden by data policy",
    }],
  ]);
  const eligibleRefs = [
    "google/ok-1",
    "google/limited",
    "google/timeout",
    "google/policy",
    "google/ok-2",
  ];

  const probes = await runProviderProbes({
    ctx,
    eligibleRefs,
    probeModelFn: createProbeFn(invocations, (modelRef) => results.get(modelRef) || { ok: true }),
  });
  await probes.ensureProbesAwaited();

  assert.deepEqual(invocations, eligibleRefs);
  assert.deepEqual(cache.added, ["google/policy"]);
  assert.deepEqual(cache.values(), ["google/policy"]);
  assert.deepEqual(await probes.paidProbesPromise, ["google/ok-1", "google/ok-2"]);
  assert.deepEqual(await probes.rejectedPaidModelsPromise, [
    "google/limited",
    "google/timeout",
    "google/policy",
  ]);
  assert.deepEqual(
    [...(await probes.rejectedPaidModelDetailsPromise).keys()],
    ["google/limited", "google/timeout", "google/policy"],
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
