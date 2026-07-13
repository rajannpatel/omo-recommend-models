import test from "node:test";
import assert from "node:assert/strict";

import { RuntimeContext } from "../../lib/runtime-context.js";
import { selectRecommendation } from "../../lib/cli/recommend-execution.js";

function lookup(models) {
  const byId = {};
  for (const [provider, ids] of Object.entries(models)) {
    byId[provider] = new Map(ids.map((id) => [id, { context_length: 200000 }]));
  }
  return { byId, sets: {} };
}

test("selectRecommendation keeps unprobed paid rule-chain refs eligible when provider verified", async () => {
  // Given: OpenAI verified through one paid ref, while another OpenAI ref satisfies the rule chain.
  const runtime = { ctx: new RuntimeContext() };
  const inputs = {
    allLocalModels: [],
    cloudLookup: lookup({
      openai: ["gpt-5.5", "gpt-4.1"],
      opencode: ["model-alpha"],
    }),
    cloudOnlyFlag: true,
    config: {
      agents: {
        hephaestus: { description: "deep worker" },
      },
      categories: {},
    },
    excludeFreeFromConfig: false,
    gpu: { hasGpu: false, name: "", label: "Not checked", vramGb: 0 },
    localRecommendationContext: null,
    ollama: { installed: false, running: false, version: null, models: [] },
    paidProviderPrep: {
      ensureProbesAwaited: async () => {},
      paidProbesPromise: Promise.resolve(["openai/gpt-4.1"]),
    },
  };

  // When: deterministic rules mode selects recommendations after provider verification.
  const selection = await selectRecommendation({
    commandExists: async () => false,
    defaultPanelModels: [],
    discoverFreeModels: async () => [],
    inputs,
    parsedArgs: { "exclude-model": [] },
    runOptions: { cloudOnlyFlag: true, useAiPanel: false },
    runtime,
  });

  // Then: the rule-chain OpenAI ref is selected even though that exact ref was not the probe winner.
  const hephaestus = selection.aiResult.cloudRecommendations.find(
    (rec) => rec.name === "hephaestus",
  );
  assert.equal(hephaestus.model.provider, "openai");
  assert.equal(hephaestus.model.model, "gpt-5.5");
  assert.doesNotMatch(selection.aiResult.analysis, /No available rule-chain models/);
});
