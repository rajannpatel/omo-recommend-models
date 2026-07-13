import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mock } from "node:test";
import test from "node:test";

function childWithEvents(events, options = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write: () => {}, end: () => {} };
  child.kill = () => {};
  process.nextTick(() => {
    for (const event of events) child.stdout.emit("data", Buffer.from(`${JSON.stringify(event)}\n`));
    if (options.stderr) child.stderr.emit("data", Buffer.from(options.stderr));
    process.nextTick(() => child.emit("close", options.code ?? 0));
  });
  return child;
}

mock.module("node:child_process", {
  namedExports: {
    execFileSync: mock.fn(() => "opencode/zero-alpha\n"),
    spawn: mock.fn((_bin, args) => {
      if (args?.[0] === "--version") return childWithEvents([]);
      if (args?.some((arg) => String(arg).endsWith("/bad-release"))) {
        return childWithEvents([
          {
            type: "error",
            error: {
              name: "APIError",
              data: { message: "Bad Request: The 'bad-release' model is not supported" },
            },
          },
        ], { code: 1 });
      }
      if (args?.includes("openai/fail-model") || args?.includes("google/fail-model")) {
        return childWithEvents([], { code: 1, stderr: "provider failed" });
      }
      return childWithEvents([
        { type: "step_start", part: { id: "step" } },
        { type: "text", part: { text: JSON.stringify({ oracle: ["opencode/model-alpha"] }) } },
        { type: "step_finish", part: { id: "step", reason: "stop" } },
      ]);
    }),
  },
});

test("runProviderProbes tries the next provider model after an unsupported advertised model", async () => {
  const { runProviderProbes } = await import("../../lib/recommend/providers/probe-orchestration.js");
  const ctx = {
    providerAvailability: new Map(),
    providerProbePromises: new Map(),
    quotaExceededProviders: new Set(),
    providerExclusionOptions: {},
    signal: new AbortController().signal,
    registerChild: (child) => child,
  };

  const probes = await runProviderProbes({
    ctx,
    sortedPaid: ["anthropic/bad-release", "anthropic/stable-release", "google/gemini-test"],
    probeCandidates: ["anthropic/bad-release", "google/gemini-test"],
  });
  await probes.ensureProbesAwaited();
  assert.deepEqual(await probes.rejectedPaidModelsPromise, ["anthropic/bad-release"]);
  assert.deepEqual(await probes.paidProbesPromise, ["anthropic/stable-release", "google/gemini-test"]);
});

test("runProviderProbes excludes a provider after a terminal probe failure", async () => {
  const { runProviderProbes } = await import("../../lib/recommend/providers/probe-orchestration.js");
  const ctx = {
    providerAvailability: new Map(),
    providerProbePromises: new Map(),
    quotaExceededProviders: new Set(),
    providerExclusionOptions: {},
    signal: new AbortController().signal,
    registerChild: (child) => child,
  };

  const probes = await runProviderProbes({
    ctx,
    sortedPaid: ["openai/fail-model", "openai/stable-release", "google/gemini-test"],
    probeCandidates: ["openai/fail-model", "google/gemini-test"],
  });
  await probes.ensureProbesAwaited();

  assert.deepEqual(await probes.rejectedPaidModelsPromise, ["openai/fail-model"]);
  assert.deepEqual(await probes.paidProbesPromise, ["google/gemini-test"]);
});
