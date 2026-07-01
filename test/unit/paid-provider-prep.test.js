import test from "node:test";
import assert from "node:assert/strict";

import {
  createProbeAwaiter,
  paidModelRefsFromLookup,
  paidModelRejection,
  probeModelRefsFromLookup,
  providerProbeCandidates,
} from "../../lib/recommend/paid-provider-prep.js";

test("paidModelRefsFromLookup excludes local and opencode models", () => {
  const refs = paidModelRefsFromLookup({
    byId: {
      local: new Map([["tiny", {}]]),
      opencode: new Map([["free", {}]]),
      anthropic: new Map([["claude", {}]]),
      google: new Map([["gemini", {}]]),
    },
  });

  assert.deepEqual(refs, ["anthropic/claude", "google/gemini"]);
});

test("probeModelRefsFromLookup includes opencode models for model-level checks", () => {
  const refs = probeModelRefsFromLookup({
    byId: {
      local: new Map([["tiny", {}]]),
      cli: new Map([["codex", {}]]),
      opencode: new Map([["gpt-5.5", {}]]),
      "github-copilot": new Map([["gpt-5.5", {}]]),
    },
  });

  assert.deepEqual(refs, ["opencode/gpt-5.5", "github-copilot/gpt-5.5"]);
});

test("providerProbeCandidates chooses one top sorted ref per provider", () => {
  const candidates = providerProbeCandidates([
    "anthropic/opus",
    "anthropic/sonnet",
    "google/gemini-pro",
    "google/gemini-flash",
    "xai/grok",
  ]);

  assert.deepEqual(candidates, [
    "anthropic/opus",
    "google/gemini-pro",
    "xai/grok",
  ]);
});

test("paidModelRejection records provider-scoped model failure details", () => {
  const rejection = paidModelRejection("opencode/gpt-5.5", {
    ok: false,
    reason: "quota-exceeded",
    errorOutput: "model is not available for this provider",
  });

  assert.deepEqual(rejection, {
    provider: "opencode",
    model: "gpt-5.5",
    modelRef: "opencode/gpt-5.5",
    reason: "quota-exceeded",
    errorOutput: "model is not available for this provider",
  });
});

test("createProbeAwaiter makes concurrent callers await the same probe completion", async () => {
  let resolveProbes;
  let completed = false;
  let doneCalls = 0;
  const paidProbesPromise = new Promise((resolve) => {
    resolveProbes = () => {
      completed = true;
      resolve([]);
    };
  });
  const ensureProbesAwaited = createProbeAwaiter({
    paidProbeProgress: { done: () => { doneCalls++; } },
    paidProbesEnabled: true,
    paidProbesPromise,
  });

  const first = ensureProbesAwaited();
  const second = ensureProbesAwaited();
  let firstResolved = false;
  let secondResolved = false;
  first.then(() => { firstResolved = true; });
  second.then(() => { secondResolved = true; });
  await Promise.resolve();

  assert.equal(completed, false);
  assert.equal(firstResolved, false);
  assert.equal(secondResolved, false);
  resolveProbes();
  await Promise.all([first, second]);

  assert.equal(firstResolved, true);
  assert.equal(secondResolved, true);
  assert.equal(doneCalls, 1);
});
