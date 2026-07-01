import test from "node:test";
import assert from "node:assert/strict";

import {
  createRuleBasedRecommendations,
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
      opencode: ["big-pickle"],
    }),
  });

  assert.equal(result.recommender, "rules(model-core)");
  assert.equal(result.cloudRecommendations.length, 2);

  const sisyphus = result.cloudRecommendations.find((rec) => rec.name === "sisyphus");
  assert.equal(sisyphus.model.provider, "opencode-go");
  assert.equal(sisyphus.model.model, "kimi-k2.6");
  assert.deepEqual(
    sisyphus.routing.map((ref) => `${ref.provider}/${ref.model}`),
    ["openai/gpt-5.5", "opencode/big-pickle"],
  );
  assert.deepEqual(
    sisyphus.fallback_models.map((ref) => `${ref.provider}/${ref.model}`),
    ["openai/gpt-5.5", "opencode/big-pickle"],
  );
  assert.equal(sisyphus.fallback_models[0].provider, "openai");
  assert.equal(sisyphus.fallback_models[0].variant, "medium");

  const deep = result.cloudRecommendations.find((rec) => rec.name === "deep");
  assert.equal(deep.model.provider, "openai");
  assert.equal(deep.model.model, "gpt-5.5");
  assert.equal(deep.model.variant, "medium");
});

test("createRuleBasedRecommendations keeps multiple free fallbacks from opencode", () => {
  const config = {
    agents: {
      sisyphus: { description: "orchestrator" },
    },
    categories: {},
  };

  const result = createRuleBasedRecommendations({
    config,
    cloudLookup: lookup({
      "opencode-go": ["kimi-k2.6"],
      openai: ["gpt-5.5"],
      opencode: ["big-pickle", "north-mini-code-free"],
    }),
  });

  const sisyphus = result.cloudRecommendations[0];
  assert.deepEqual(
    sisyphus.fallback_models.map((ref) => `${ref.provider}/${ref.model}`),
    [
      "openai/gpt-5.5",
      "opencode/big-pickle",
      "opencode/north-mini-code-free",
    ],
  );
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

  assert.equal(result.cloudRecommendations.length, 2);
  const sisyphus = result.cloudRecommendations.find((rec) => rec.name === "sisyphus");
  assert.equal(sisyphus.model.provider, "opencode");
  assert.equal(sisyphus.model.model, "big-pickle");
  const hephaestus = result.cloudRecommendations.find((rec) => rec.name === "hephaestus");
  assert.equal(hephaestus.model.provider, "opencode");
  assert.equal(hephaestus.model.model, "big-pickle");
  assert.match(result.analysis, /hephaestus \(tried: \(openai, github-copilot, opencode, vercel\)\/gpt-5.5/);
});

test("createRuleBasedRecommendations excludes unavailable providers everywhere", () => {
  const config = {
    agents: {
      sisyphus: { description: "orchestrator" },
    },
    categories: {},
  };

  const result = createRuleBasedRecommendations({
    config,
    cloudLookup: lookup({
      "opencode-go": ["kimi-k2.6"],
      openai: ["gpt-5.5"],
      opencode: ["big-pickle"],
    }),
    isProviderAllowed: (provider) => provider !== "opencode-go",
  });

  const sisyphus = result.cloudRecommendations[0];
  assert.equal(sisyphus.model.provider, "openai");
  assert.equal(sisyphus.model.model, "gpt-5.5");
  assert.deepEqual(
    sisyphus.fallback_models.map((ref) => ref.provider),
    ["opencode"],
  );
});

test("createRuleBasedRecommendations uses paid and free picks after chain exhaustion", () => {
  const config = {
    agents: {
      hephaestus: { description: "deep worker" },
    },
    categories: {},
  };

  const result = createRuleBasedRecommendations({
    config,
    cloudLookup: lookup({
      paid: ["large-pro"],
      opencode: ["utility-free"],
    }),
  });

  const hephaestus = result.cloudRecommendations[0];
  assert.equal(hephaestus.model.provider, "paid");
  assert.equal(hephaestus.model.model, "large-pro");
  assert.equal(hephaestus.fallback_models[0].provider, "opencode");
  assert.equal(hephaestus.fallback_models[0].model, "utility-free");
  assert.match(result.analysis, /tried: \(openai, github-copilot, opencode, vercel\)\/gpt-5.5/);
});

test("createRuleBasedRecommendations resolves provider-local model spelling variants", () => {
  const config = {
    agents: {
      librarian: { description: "research librarian" },
      explore: { description: "code explorer" },
    },
    categories: {},
  };

  const result = createRuleBasedRecommendations({
    config,
    cloudLookup: lookup({
      "github-copilot": ["Claude 4.5 Haiku"],
    }),
  });

  assert.doesNotMatch(result.analysis, /No available rule-chain models/);
  assert.deepEqual(
    result.cloudRecommendations.map((rec) => `${rec.name}:${rec.model.provider}/${rec.model.model}`),
    [
      "librarian:github-copilot/Claude 4.5 Haiku",
      "explore:github-copilot/Claude 4.5 Haiku",
    ],
  );
});
