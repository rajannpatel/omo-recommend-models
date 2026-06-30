import assert from "node:assert/strict";
import test from "node:test";

import { buildAgentPrompt } from "../../lib/recommend/panel-core.js";

test("buildAgentPrompt uses dynamic local context budget and trusts empty ranked locals", () => {
  const entry = {
    name: "sisyphus",
    type: "agent",
    section: { model_quality: "high", model: "opencode/big-pickle" },
  };
  const cloudLookup = {
    byId: {
      opencode: new Map([
        ["big-pickle", { context_length: 32000, family: "opencode-big-pickle" }],
      ]),
    },
  };
  const gpu = { label: "Boundary GPU", vramGb: 10 };
  const ollama = { models: [{ name: "deepseek-r1:8b" }] };
  const prompt = buildAgentPrompt(
    entry,
    cloudLookup,
    [{ name: "deepseek-r1:8b", vram: 6.3, score: 100 }],
    gpu,
    ollama,
    {
      providerAvailability: new Map(),
      providerExclusionOptions: { quotaRestricted: true, rateLimited: true },
      quotaExceededProviders: new Set(),
      localRecommendationContext: {
        rankedCandidatesByEntry: new Map([["sisyphus", []]]),
        warnings: { byEntry: new Map() },
      },
    },
  );

  assert.match(prompt, /usable=9GB/);
  assert.match(prompt, /LOCAL \(0 fit VRAM\):\n-/);
  assert.doesNotMatch(prompt, /deepseek-r1:8b/);
  assert.doesNotMatch(prompt, /or local if only fit/);
});
