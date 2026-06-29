import test from "node:test";
import assert from "node:assert/strict";

import {
  createRuleBasedRecommendations,
  refsFromManualExclusions,
} from "../../lib/recommend/rules-assignment.js";

function lookup(models) {
  const byId = {};
  for (const [provider, ids] of Object.entries(models)) {
    byId[provider] = new Map(ids.map((id) => [id, {}]));
  }
  return { byId, sets: {} };
}

test("createRuleBasedRecommendations selects the first available upstream-chain model", () => {
  const config = {
    agents: {
      sisyphus: { description: "orchestrator" },
    },
    categories: {
      deep: { description: "deep work" },
    },
  };

  const result = createRuleBasedRecommendations({
    config,
    cloudLookup: lookup({
      "opencode-go": ["kimi-k2.6"],
      openai: ["gpt-5.5"],
    }),
  });

  assert.equal(result.recommender, "rules(model-core)");
  assert.equal(result.cloudRecommendations.length, 2);

  const sisyphus = result.cloudRecommendations.find((rec) => rec.name === "sisyphus");
  assert.equal(sisyphus.model.provider, "opencode-go");
  assert.equal(sisyphus.model.model, "kimi-k2.6");
  assert.equal(sisyphus.fallback_models[0].provider, "openai");
  assert.equal(sisyphus.fallback_models[0].variant, "medium");

  const deep = result.cloudRecommendations.find((rec) => rec.name === "deep");
  assert.equal(deep.model.provider, "openai");
  assert.equal(deep.model.model, "gpt-5.5");
  assert.equal(deep.model.variant, "medium");
});

test("createRuleBasedRecommendations strips manually excluded providers and models", () => {
  const config = {
    agents: {
      hephaestus: { description: "deep worker" },
      sisyphus: { description: "orchestrator" },
    },
    categories: {},
  };

  const result = createRuleBasedRecommendations({
    config,
    cloudLookup: lookup({
      openai: ["gpt-5.5"],
      opencode: ["big-pickle"],
      "opencode-go": ["kimi-k2.6"],
    }),
    excludeModels: ["openai", "opencode-go/kimi-k2.6"],
  });

  assert.deepEqual(refsFromManualExclusions(["openai", "opencode-go/kimi-k2.6"]), [
    "openai",
    "opencode-go/kimi-k2.6",
  ]);
  assert.equal(result.cloudRecommendations.length, 1);
  assert.equal(result.cloudRecommendations[0].name, "sisyphus");
  assert.equal(result.cloudRecommendations[0].model.provider, "opencode");
  assert.equal(result.cloudRecommendations[0].model.model, "big-pickle");
  assert.match(result.analysis, /No available rule-chain model for: hephaestus/);
});
