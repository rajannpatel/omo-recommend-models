import assert from "node:assert/strict";
import test from "node:test";
import {
  allConfigEntries,
  uniqueByModelRef,
  finalizeFallbackModels,
  computeConsensus,
} from "../../lib/consensus.js";

// Mock isProviderAvailable: everything available
const allAvailable = () => true;

// Mock ctx
const mockCtx = {};

test("allConfigEntries returns agents and categories", () => {
  const config = {
    agents: {
      sisyphus: { model_quality: "high" },
      builder: { model_quality: "balanced" },
    },
    categories: {
      utility: { model_quality: "fast" },
    },
  };

  const entries = allConfigEntries(config);
  assert.equal(entries.length, 3);
  assert.equal(entries[0].name, "sisyphus");
  assert.equal(entries[0].type, "agent");
  assert.equal(entries[1].name, "builder");
  assert.equal(entries[1].type, "agent");
  assert.equal(entries[2].name, "utility");
  assert.equal(entries[2].type, "category");
});

test("allConfigEntries returns empty for empty config", () => {
  assert.deepEqual(allConfigEntries({}), []);
  assert.deepEqual(allConfigEntries({ agents: {}, categories: {} }), []);
});

test("uniqueByModelRef deduplicates by provider/model", () => {
  const recs = [
    { provider: "opencode", model: "big-pickle", reason: "a" },
    { provider: "opencode", model: "big-pickle", reason: "b" },
    { provider: "anthropic", model: "claude-4", reason: "c" },
  ];
  const result = uniqueByModelRef(recs);
  assert.equal(result.length, 2);
  assert.equal(result[0].provider, "opencode");
  assert.equal(result[0].model, "big-pickle");
  assert.equal(result[1].provider, "anthropic");
  assert.equal(result[1].model, "claude-4");
});

test("uniqueByModelRef filters out invalid recs", () => {
  const recs = [
    null,
    { provider: "", model: "" },
    { provider: "opencode", model: "big-pickle" },
  ];
  const result = uniqueByModelRef(recs);
  assert.equal(result.length, 1);
});

test("finalizeFallbackModels removes duplicates and primary model", () => {
  const primary = { provider: "opencode", model: "big-pickle" };
  const fallbacks = [
    { provider: "opencode", model: "big-pickle" },
    { provider: "anthropic", model: "claude-4" },
    { provider: "anthropic", model: "claude-4" },
    { provider: "opencode", model: "north-mini-code-free" },
  ];
  const result = finalizeFallbackModels(primary, fallbacks);
  assert.equal(result.length, 2);
  assert.equal(result[0].provider, "anthropic");
  assert.equal(result[0].model, "claude-4");
  assert.equal(result[1].provider, "opencode");
  assert.equal(result[1].model, "north-mini-code-free");
});

test("finalizeFallbackModels handles null primary", () => {
  const fallbacks = [
    { provider: "opencode", model: "big-pickle" },
  ];
  const result = finalizeFallbackModels(null, fallbacks);
  assert.equal(result.length, 1);
  assert.equal(result[0].model, "big-pickle");
});

test("finalizeFallbackModels handles null fallbacks", () => {
  const result = finalizeFallbackModels(
    { provider: "opencode", model: "big-pickle" },
    null,
  );
  assert.deepEqual(result, []);
});

test("computeConsensus returns empty cloudRecommendations for empty state", () => {
  const result = computeConsensus([], [], [], mockCtx, allAvailable);
  assert.deepEqual(result.cloudRecommendations, []);
  assert.equal(result.recommender, "panel()");
  assert.ok(result.analysis);
});

test("computeConsensus with multiple voters picks majority winner", () => {
  const agents = [
    { name: "sisyphus", type: "agent", section: { model_quality: "high" } },
  ];
  const state = [
    {
      results: [
        {
          recommendation: {
            model: { provider: "opencode", model: "big-pickle" },
          },
        },
        {
          recommendation: {
            model: { provider: "opencode", model: "big-pickle" },
          },
        },
        {
          recommendation: {
            model: { provider: "anthropic", model: "claude-4" },
          },
        },
      ],
    },
  ];
  const models = ["opencode/big-pickle", "opencode/north-mini-code-free", "anthropic/claude-4"];

  const result = computeConsensus(state, agents, models, mockCtx, allAvailable);
  assert.equal(result.cloudRecommendations.length, 1);
  assert.equal(result.cloudRecommendations[0].name, "sisyphus");
  assert.equal(result.cloudRecommendations[0].model.provider, "opencode");
  assert.equal(result.cloudRecommendations[0].model.model, "big-pickle");
});

test("computeConsensus with routing majority support", () => {
  const agents = [
    { name: "sisyphus", type: "agent", section: { model_quality: "high" } },
  ];
  const state = [
    {
      results: [
        {
          recommendation: {
            model: { provider: "opencode", model: "big-pickle" },
            routing: [
              { provider: "anthropic", model: "claude-4" },
            ],
          },
        },
        {
          recommendation: {
            model: { provider: "opencode", model: "big-pickle" },
            routing: [
              { provider: "anthropic", model: "claude-4" },
            ],
          },
        },
        {
          recommendation: {
            model: { provider: "opencode", model: "big-pickle" },
            routing: [],
          },
        },
      ],
    },
  ];
  const models = ["opencode/big-pickle", "opencode/north-mini-code-free", "anthropic/claude-4"];

  const result = computeConsensus(state, agents, models, mockCtx, allAvailable);
  assert.equal(result.cloudRecommendations.length, 1);
  // anthropic/claude-4 has 2/3 votes (> 1.5) so it should be in routing
  assert.ok(result.cloudRecommendations[0].routing.length > 0);
  assert.equal(result.cloudRecommendations[0].routing[0].provider, "anthropic");
  assert.equal(result.cloudRecommendations[0].routing[0].model, "claude-4");
});

test("computeConsensus with fallback majority support", () => {
  const agents = [
    { name: "sisyphus", type: "agent", section: { model_quality: "high" } },
  ];
  const state = [
    {
      results: [
        {
          recommendation: {
            model: { provider: "opencode", model: "big-pickle" },
            fallback_models: [
              { provider: "anthropic", model: "claude-4" },
            ],
          },
        },
        {
          recommendation: {
            model: { provider: "opencode", model: "big-pickle" },
            fallback_models: [
              { provider: "anthropic", model: "claude-4" },
            ],
          },
        },
        {
          recommendation: {
            model: { provider: "opencode", model: "big-pickle" },
            fallback_models: [],
          },
        },
      ],
    },
  ];
  const models = ["opencode/big-pickle", "opencode/north-mini-code-free", "anthropic/claude-4"];

  const result = computeConsensus(state, agents, models, mockCtx, allAvailable);
  assert.equal(result.cloudRecommendations.length, 1);
  assert.ok(result.cloudRecommendations[0].fallback_models.length > 0);
  assert.equal(result.cloudRecommendations[0].fallback_models[0].provider, "anthropic");
  assert.equal(result.cloudRecommendations[0].fallback_models[0].model, "claude-4");
});

test("computeConsensus plurality when no majority", () => {
  const agents = [
    { name: "sisyphus", type: "agent", section: { model_quality: "high" } },
  ];
  const state = [
    {
      results: [
        {
          recommendation: {
            model: { provider: "opencode", model: "big-pickle" },
          },
        },
        {
          recommendation: {
            model: { provider: "anthropic", model: "claude-4" },
          },
        },
        {
          recommendation: {
            model: { provider: "opencode", model: "deepseek-v4" },
          },
        },
      ],
    },
  ];
  const models = ["opencode/big-pickle", "anthropic/claude-4", "opencode/deepseek-v4"];

  const result = computeConsensus(state, agents, models, mockCtx, allAvailable);
  assert.equal(result.cloudRecommendations.length, 1);
  // big-pickle has 1 vote, claude-4 has 1, deepseek-v4 has 1 — no majority
  // big-pickle should appear first alphabetically... actually the votes object
  // iteration order matters. With 3 different models and 3 voters, majority = 1.5
  // There's no model with > 1.5 votes. The first one in the sorted array wins.
  // Since all have 1 vote, sort is stable by insertion order.
  const rec = result.cloudRecommendations[0];
  assert.ok(rec.model.reason.includes("Plurality"));
});

test("computeConsensus filters unavailable providers", () => {
  const agents = [
    { name: "sisyphus", type: "agent", section: { model_quality: "high" } },
  ];
  const state = [
    {
      results: [
        {
          recommendation: {
            model: { provider: "rate-limited", model: "bad-model" },
          },
        },
        {
          recommendation: {
            model: { provider: "rate-limited", model: "bad-model" },
          },
        },
      ],
    },
  ];
  const models = ["rate-limited/bad-model", "opencode/big-pickle"];

  // Provider availability checker: rate-limited provider is unavailable
  const isAvailable = (ctx, provider) => provider !== "rate-limited";

  const result = computeConsensus(state, agents, models, mockCtx, isAvailable);
  // Both votes are for a provider that's rate-limited, so they're filtered out
  assert.equal(result.cloudRecommendations.length, 0);
});

test("computeConsensus with multiple agents", () => {
  const agents = [
    { name: "sisyphus", type: "agent", section: { model_quality: "high" } },
    { name: "explorer", type: "agent", section: { description: "Fast search" } },
  ];
  const state = [
    {
      results: [
        {
          recommendation: {
            model: { provider: "opencode", model: "big-pickle" },
          },
        },
        {
          recommendation: {
            model: { provider: "opencode", model: "big-pickle" },
          },
        },
      ],
    },
    {
      results: [
        {
          recommendation: {
            model: { provider: "opencode", model: "north-mini-code-free" },
          },
        },
        {
          recommendation: {
            model: { provider: "opencode", model: "north-mini-code-free" },
          },
        },
      ],
    },
  ];
  const models = ["opencode/big-pickle", "opencode/north-mini-code-free"];

  const result = computeConsensus(state, agents, models, mockCtx, allAvailable);
  assert.equal(result.cloudRecommendations.length, 2);
  assert.equal(result.cloudRecommendations[0].name, "sisyphus");
  assert.equal(result.cloudRecommendations[1].name, "explorer");
  assert.equal(result.recommender, "panel(big-pickle+north-mini-code-free)");
  assert.ok(result.analysis);
});

test("computeConsensus skips agents with no valid results", () => {
  const agents = [
    { name: "valid-agent", type: "agent", section: { model_quality: "high" } },
    { name: "no-results", type: "agent", section: { model_quality: "high" } },
  ];
  const state = [
    {
      results: [
        {
          recommendation: {
            model: { provider: "opencode", model: "big-pickle" },
          },
        },
      ],
    },
    {
      results: [],
    },
  ];
  const models = ["opencode/big-pickle"];

  const result = computeConsensus(state, agents, models, mockCtx, allAvailable);
  assert.equal(result.cloudRecommendations.length, 1);
  assert.equal(result.cloudRecommendations[0].name, "valid-agent");
});

test("computeConsensus uses section.description for profile when available", () => {
  const agents = [
    { name: "explorer", type: "agent", section: { description: "Fast exploration agent" } },
  ];
  const state = [
    {
      results: [
        {
          recommendation: {
            model: { provider: "opencode", model: "north-mini-code-free" },
          },
        },
      ],
    },
  ];
  const models = ["opencode/north-mini-code-free"];

  const result = computeConsensus(state, agents, models, mockCtx, allAvailable);
  assert.equal(result.cloudRecommendations[0].profile, "Fast exploration agent");
});
