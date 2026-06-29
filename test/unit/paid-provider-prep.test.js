import test from "node:test";
import assert from "node:assert/strict";

import {
  paidModelRefsFromLookup,
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
