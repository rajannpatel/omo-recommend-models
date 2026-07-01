import assert from "node:assert/strict";
import test from "node:test";

import { completeAiRecommendations } from "../../lib/recommend/recommendation-finalizer.js";

test("completeAiRecommendations appends context-selected local fallbacks local-last with decisions", () => {
  // Given: two entries whose context-selected locals differ from the old global best local model.
  const config = {
    agents: {
      sisyphus: { model_quality: "high" },
      hephaestus: { model_quality: "high" },
    },
    categories: {},
  };
  const cloudLookup = {
    byId: {
      opencode: new Map([
        ["primary-free", { context_length: 128000 }],
        ["fallback-free", { context_length: 128000 }],
      ]),
    },
    sets: {},
  };
  const allLocalModels = [
    { name: "tinyllama:1.1b", vram: 1, score: 999 },
    { name: "deepseek-r1:14b", vram: 10, score: 100 },
    { name: "qwen2.5-coder:14b", vram: 10, score: 90 },
  ];
  const gpu = { hasGpu: true, name: "RTX 4090", vramGb: 24 };
  const ollama = {
    installed: true,
    running: true,
    models: [{ name: "deepseek-r1:14b" }, { name: "tinyllama:1.1b" }],
  };
  const aiResult = {
    recommender: "unit",
    analysis: "context local migration",
    cloudRecommendations: [
      {
        name: "sisyphus",
        type: "agent",
        profile: "reasoning",
        model: { provider: "opencode", model: "primary-free", reason: "primary" },
        routing: [{ provider: "local", model: "tinyllama:1.1b", reason: "bad route" }],
        fallback_models: [{ provider: "opencode", model: "fallback-free", reason: "cloud fallback" }],
      },
      {
        name: "hephaestus",
        type: "agent",
        profile: "coding",
        model: { provider: "opencode", model: "primary-free", reason: "primary" },
        routing: [],
        fallback_models: [{ provider: "opencode", model: "fallback-free", reason: "cloud fallback" }],
      },
    ],
    localModels: { decisions: [], placements: [] },
  };
  const localRecommendationContext = {
    fittingByName: new Map(allLocalModels.map((model) => [model.name, model])),
    bestLocalByEntry: new Map([
      ["sisyphus", { provider: "local", model: "deepseek-r1:14b", reason: "Best fitting local reasoning fallback for sisyphus" }],
      ["hephaestus", { provider: "local", model: "qwen2.5-coder:14b", reason: "Best fitting local coding fallback for hephaestus" }],
    ]),
  };

  // When: finalization completes recommendations with a prepared local recommendation context.
  const completed = completeAiRecommendations(
    aiResult,
    config,
    cloudLookup,
    allLocalModels,
    gpu,
    ollama,
    () => true,
    localRecommendationContext,
  );

  // Then: each entry receives its context-selected local as the local-last fallback, never routing.
  const byName = new Map(completed.cloudRecommendations.map((rec) => [rec.name, rec]));
  assert.deepEqual(byName.get("sisyphus").routing, []);
  assert.deepEqual(
    byName.get("sisyphus").fallback_models.map((rec) => `${rec.provider}/${rec.model}`),
    ["opencode/fallback-free", "local/deepseek-r1:14b"],
  );
  assert.deepEqual(
    byName.get("hephaestus").fallback_models.map((rec) => `${rec.provider}/${rec.model}`),
    ["opencode/fallback-free", "local/qwen2.5-coder:14b"],
  );
  assert.deepEqual(
    completed.localModels.decisions.map((decision) => ({ name: decision.name, action: decision.action })),
    [
      { name: "deepseek-r1:14b", action: "keep" },
      { name: "qwen2.5-coder:14b", action: "install" },
    ],
  );
  assert.deepEqual(
    completed.localModels.placements.map((placement) => ({
      modelName: placement.modelName,
      agentName: placement.agentName,
      role: placement.role,
    })),
    [
      { modelName: "deepseek-r1:14b", agentName: "sisyphus", role: "fallback" },
      { modelName: "qwen2.5-coder:14b", agentName: "hephaestus", role: "fallback" },
    ],
  );
});

test("completeAiRecommendations replaces panel-supplied locals with one context-selected local", () => {
  const config = {
    agents: {
      sisyphus: { model_quality: "high" },
    },
    categories: {},
  };
  const cloudLookup = {
    byId: {
      opencode: new Map([
        ["primary-free", { context_length: 32000 }],
        ["fallback-free", { context_length: 32000 }],
      ]),
    },
    sets: {},
  };
  const allLocalModels = [
    { name: "deepseek-r1:8b", vram: 7, score: 10 },
    { name: "qwen2.5-coder:8b", vram: 7, score: 90 },
  ];
  const aiResult = {
    cloudRecommendations: [
      {
        name: "sisyphus",
        type: "agent",
        model: { provider: "opencode", model: "primary-free", reason: "primary" },
        routing: [],
        fallback_models: [
          { provider: "local", model: "deepseek-r1:8b", reason: "panel local" },
          { provider: "opencode", model: "fallback-free", reason: "cloud fallback" },
          { provider: "local", model: "qwen2.5-coder:8b", reason: "second panel local" },
        ],
      },
    ],
    localModels: { decisions: [], placements: [] },
  };
  const localRecommendationContext = {
    fittingByName: new Map(allLocalModels.map((model) => [model.name, model])),
    bestLocalByEntry: new Map([
      ["sisyphus", { provider: "local", model: "qwen2.5-coder:8b", reason: "Best context local" }],
    ]),
    rankedCandidatesByEntry: new Map([
      ["sisyphus", [{ name: "qwen2.5-coder:8b", installed: false }]],
    ]),
    candidateCards: [{ name: "qwen2.5-coder:8b", installed: false }],
  };

  const completed = completeAiRecommendations(
    aiResult,
    config,
    cloudLookup,
    allLocalModels,
    { hasGpu: true, vramGb: 24 },
    { models: [] },
    () => true,
    localRecommendationContext,
  );

  const [rec] = completed.cloudRecommendations;
  assert.deepEqual(
    rec.fallback_models.map((fallback) => `${fallback.provider}/${fallback.model}`),
    ["opencode/fallback-free", "local/qwen2.5-coder:8b"],
  );
  assert.deepEqual(
    completed.localModels.decisions.map((decision) => ({ name: decision.name, action: decision.action })),
    [{ name: "qwen2.5-coder:8b", action: "install" }],
  );
});

test("completeAiRecommendations filters blocked models per provider", () => {
  const config = {
    agents: {
      sisyphus: { description: "reasoning lead" },
    },
    categories: {},
  };
  const cloudLookup = {
    byId: {
      opencode: new Map([
        ["gpt-5.5", { context_length: 200000 }],
        ["fallback-free", { context_length: 200000 }],
      ]),
      "github-copilot": new Map([
        ["gpt-5.5", { context_length: 200000 }],
      ]),
    },
    sets: {},
  };
  const aiResult = {
    cloudRecommendations: [
      {
        name: "sisyphus",
        type: "agent",
        model: { provider: "opencode", model: "gpt-5.5", reason: "blocked primary" },
        routing: [],
        fallback_models: [
          { provider: "github-copilot", model: "gpt-5.5", reason: "same model via another provider" },
        ],
      },
    ],
    localModels: { decisions: [], placements: [] },
  };
  const rejected = new Set(["opencode/gpt-5.5"]);

  const completed = completeAiRecommendations(
    aiResult,
    config,
    cloudLookup,
    [],
    { hasGpu: false, vramGb: 0 },
    { models: [] },
    () => true,
    null,
    ({ provider, model }) => !rejected.has(`${provider}/${model}`),
  );

  const [rec] = completed.cloudRecommendations;
  assert.equal(rec.model.provider, "github-copilot");
  assert.equal(rec.model.model, "gpt-5.5");
  assert.deepEqual(
    rec.fallback_models.map((fallback) => `${fallback.provider}/${fallback.model}`),
    ["opencode/fallback-free"],
  );
});
