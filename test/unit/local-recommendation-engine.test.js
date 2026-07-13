import assert from "node:assert/strict";
import test from "node:test";

import {
  buildHardwareDeficitWarning,
  chooseLocalFallbackForEntry,
  classifyCandidateSpecialty,
  estimateKvCacheGb,
  fitsGpu,
  inferEntryRequirement,
  parseParameterCountB,
  rankLocalCandidates,
} from "../../lib/recommend/local-recommendation-engine.js";

test("inferEntryRequirement derives specialty, chain refs, and max context from metadata", () => {
  // Given: a reasoning agent with upstream chain refs and mixed context metadata.
  const metadataByRef = new Map([
    ["openai/gpt-5.5", { context_length: 128000 }],
    ["opencode/big-pickle", { context_length: 64000 }],
  ]);

  // When: the future pure engine infers the local requirement for that entry.
  const requirement = inferEntryRequirement({
    entryName: "sisyphus",
    entryType: "agent",
    chainRefs: ["openai/gpt-5.5", "opencode/big-pickle"],
    metadataByRef,
  });

  // Then: it preserves the entry identity and requires the largest discovered context.
  assert.deepEqual(requirement, {
    entryName: "sisyphus",
    entryType: "agent",
    specialty: "reasoning",
    minContext: 128000,
    chainRefs: ["openai/gpt-5.5", "opencode/big-pickle"],
  });
});

test("inferEntryRequirement defaults context to 32000 when chain metadata is absent", () => {
  // Given: a category whose cloud chain has no metadata available offline.
  const metadataByRef = new Map();

  // When: the future pure engine infers the requirement without live lookups.
  const requirement = inferEntryRequirement({
    entryName: "quick",
    entryType: "category",
    chainRefs: ["opencode/north-mini-code-free"],
    metadataByRef,
  });

  // Then: it uses the Wave 1 default context and the fast specialty mapping.
  assert.equal(requirement.specialty, "fast");
  assert.equal(requirement.minContext, 32000);
  assert.deepEqual(requirement.chainRefs, ["opencode/north-mini-code-free"]);
});

test("inferEntryRequirement maps planned agents and categories to local specialties", () => {
  // Given: representative OMO entries from every planned specialty bucket.
  const entries = [
    ["sisyphus", "agent", "reasoning"],
    ["hephaestus", "agent", "coding"],
    ["multimodal-looker", "agent", "vision"],
    ["explore", "agent", "fast"],
    ["quick", "category", "fast"],
    ["writing", "category", "general"],
  ];

  // When: each entry requirement is inferred through the public engine API.
  const mapped = entries.map(([entryName, entryType]) =>
    inferEntryRequirement({ entryName, entryType }).specialty,
  );

  // Then: the specialty map follows the hyperplan buckets exactly.
  assert.deepEqual(
    mapped,
    entries.map((entry) => entry[2]),
  );
});

test("parseParameterCountB parses common Ollama parameter markers", () => {
  // Given: local model names and tags using decimal, integer, and mixture-of-experts markers.
  const names = [
    "llama3.2:1.5b-instruct-q4_K_M",
    "qwen2.5-coder:7b",
    "qwen2.5:32b-instruct",
    "llama3.3:70b",
    "mixtral:8x7b-instruct",
  ];

  // When: parameter counts are parsed into billions of parameters.
  const parsed = names.map((name) => parseParameterCountB(name));

  // Then: the parser returns numeric parameter counts without fabricating unknown sizes.
  assert.deepEqual(parsed, [1.5, 7, 32, 70, 56]);
  assert.equal(parseParameterCountB("custom-local-model:latest"), null);
});

test("estimateKvCacheGb uses the planned KV cache formula and explicit factors", () => {
  // Given: a 32k context, 8B model, modern GQA, and known KV quantization.
  const input = {
    minContext: 32000,
    parametersB: 8,
    gqaFactor: 0.25,
    quantizationFactor: 0.25,
  };

  // When: KV cache memory is estimated by the pure engine.
  const kvCacheGb = estimateKvCacheGb(input);

  // Then: the formula is 0.08 * (context/1000) * (params/8) * gqa * quantization.
  assert.equal(kvCacheGb, 0.16);
  assert.equal(estimateKvCacheGb({ minContext: 32000, parametersB: 8 }), 2.56);
});

test("localVramBudgetGb and fitsGpu use only ninety percent of GPU VRAM", () => {
  // Given: a 24GB GPU where the allowed local budget is exactly 90 percent.
  const gpu = { name: "RTX 4090", vramGb: 24 };

  // When: the engine calculates budget and fit for nearby candidates.
  const fitting = fitsGpu({ weightGb: 20, kvCacheGb: 1.5 }, gpu);
  const exactlyAtBudget = fitsGpu({ weightGb: 20, kvCacheGb: 1.6 }, gpu);

  // Then: no legacy 1.5GB subtraction is applied and fit remains a strict less-than comparison.
  assert.equal(fitting, true);
  assert.equal(exactlyAtBudget, false);
});

test("classifyCandidateSpecialty recognizes coding, reasoning, vision, and general candidates", () => {
  // Given: normalized candidate cards with names and capability metadata.
  const candidates = [
    { name: "qwen2.5-coder:14b", capabilities: ["tools"] },
    { name: "deepseek-r1:32b", capabilities: ["reasoning"] },
    { name: "llava:13b", capabilities: ["vision"] },
    { name: "llama3.1:8b-instruct", capabilities: ["chat"] },
  ];

  // When: each candidate is classified for role compatibility.
  const specialties = candidates.map((candidate) => classifyCandidateSpecialty(candidate));

  // Then: role-specific models are separated from general chat models.
  assert.deepEqual(specialties, ["coding", "reasoning", "vision", "general"]);
});

test("rankLocalCandidates applies parameter, popularity, and role-match scoring", () => {
  // Given: a coding requirement with candidates that differ by role match and popularity.
  const requirement = { entryName: "hephaestus", entryType: "agent", specialty: "coding", minContext: 64000 };
  const gpu = { name: "RTX 4090", vramGb: 24 };
  const candidates = [
    {
      name: "popular-general:32b",
      ref: "local/popular-general:32b",
      parametersB: 32,
      contextLength: 64000,
      specialty: "general",
      weightGb: 10,
      kvCacheGb: 2,
      openRouterPopularityIndex: 20,
    },
    {
      name: "qwen2.5-coder:32b",
      ref: "local/qwen2.5-coder:32b",
      parametersB: 32,
      contextLength: 64000,
      specialty: "coding",
      weightGb: 10,
      kvCacheGb: 2,
      openRouterPopularityIndex: 7,
    },
  ];

  // When: the public ranker evaluates the candidates for that entry.
  const ranked = rankLocalCandidates({ candidates, requirement, gpu });

  // Then: the coding role-match bonus outranks the higher-popularity general model.
  assert.deepEqual(
    ranked.map((candidate) => candidate.ref),
    ["local/qwen2.5-coder:32b", "local/popular-general:32b"],
  );
  assert.equal(ranked[0].score, 377);
});

test("rankLocalCandidates hard-filters unsuitable models and uses installed state as tie-breaker", () => {
  // Given: same-score coding candidates plus incompatible, undersized-context, and non-fitting options.
  const requirement = { entryName: "hephaestus", entryType: "agent", specialty: "coding", minContext: 64000 };
  const gpu = { name: "RTX 4090", vramGb: 24 };
  const candidates = [
    {
      name: "remote-installable-coder:14b",
      ref: "local/remote-installable-coder:14b",
      parametersB: 14,
      contextLength: 64000,
      specialty: "coding",
      installed: false,
      weightGb: 10,
      kvCacheGb: 2,
      openRouterPopularityIndex: 0,
    },
    {
      name: "installed-coder:14b",
      ref: "local/installed-coder:14b",
      parametersB: 14,
      contextLength: 64000,
      specialty: "coding",
      installed: true,
      weightGb: 10,
      kvCacheGb: 2,
      openRouterPopularityIndex: 0,
    },
    {
      name: "tiny-context-coder:14b",
      ref: "local/tiny-context-coder:14b",
      parametersB: 14,
      contextLength: 8192,
      specialty: "coding",
      installed: true,
      weightGb: 10,
      kvCacheGb: 2,
      openRouterPopularityIndex: 0,
    },
    {
      name: "deepseek-r1:32b",
      ref: "local/deepseek-r1:32b",
      parametersB: 32,
      contextLength: 64000,
      specialty: "reasoning",
      installed: true,
      weightGb: 18,
      kvCacheGb: 2,
      openRouterPopularityIndex: 0,
    },
    {
      name: "oversized-coder:70b",
      ref: "local/oversized-coder:70b",
      parametersB: 70,
      contextLength: 64000,
      specialty: "coding",
      installed: true,
      weightGb: 40,
      kvCacheGb: 4,
      openRouterPopularityIndex: 0,
    },
  ];

  // When: candidates are ranked for the entry and GPU.
  const ranked = rankLocalCandidates({ candidates, requirement, gpu });

  // Then: only fitting compatible candidates remain, with installed used only to break equal scores.
  assert.deepEqual(
    ranked.map((candidate) => candidate.ref),
    ["local/installed-coder:14b", "local/remote-installable-coder:14b"],
  );
  assert.equal(ranked[0].score, ranked[1].score);
});

test("chooseLocalFallbackForEntry returns one canonical local fallback per entry", () => {
  // Given: an existing cloud recommendation and multiple fitting local candidates.
  const recommendation = {
    name: "hephaestus",
    fallback_models: [{ provider: "openai", model: "gpt-5.5" }],
  };
  const requirement = { entryName: "hephaestus", entryType: "agent", specialty: "coding", minContext: 64000 };
  const candidates = [
    {
      name: "qwen2.5-coder:14b",
      ref: "local/qwen2.5-coder:14b",
      parametersB: 14,
      contextLength: 64000,
      specialty: "coding",
      installed: true,
      weightGb: 10,
      kvCacheGb: 2,
      openRouterPopularityIndex: 0,
    },
    {
      name: "qwen2.5-coder:32b",
      ref: "local/qwen2.5-coder:32b",
      parametersB: 32,
      contextLength: 64000,
      specialty: "coding",
      installed: true,
      weightGb: 18,
      kvCacheGb: 3,
      openRouterPopularityIndex: 5,
    },
  ];

  // When: the best local fallback is chosen for the entry.
  const fallback = chooseLocalFallbackForEntry({
    recommendation,
    requirement,
    candidates,
    gpu: { name: "RTX 4090", vramGb: 24 },
  });

  // Then: the result is the single highest-ranked canonical local ref, not a routing entry.
  assert.deepEqual(fallback, {
    provider: "local",
    model: "qwen2.5-coder:32b",
    reason: "Best fitting local coding fallback for hephaestus",
  });
});

test("buildHardwareDeficitWarning reports same-specialty local fit failures and respects cloud-only", () => {
  // Given: local recommendations are enabled but no same-specialty candidate fits the GPU budget.
  const requirement = { entryName: "sisyphus", entryType: "agent", specialty: "reasoning", minContext: 128000 };
  const candidates = [
    {
      name: "deepseek-r1:70b",
      specialty: "reasoning",
      parametersB: 70,
      contextLength: 128000,
      weightGb: 42,
      kvCacheGb: 8,
    },
  ];
  const gpu = { name: "RTX 4090", vramGb: 24 };

  // When: the warning builder evaluates the deficit for local-enabled and cloud-only modes.
  const warning = buildHardwareDeficitWarning({ requirement, candidates, gpu, cloudOnly: false });
  const suppressed = buildHardwareDeficitWarning({ requirement, candidates, gpu, cloudOnly: true });

  // Then: the warning object includes structured fields and an explanatory message, but cloud-only suppresses it.
  assert.equal(warning.specialty, "reasoning");
  assert.equal(warning.entryName, "sisyphus");
  assert.equal(warning.gpuName, "RTX 4090");
  assert.equal(warning.scope, "local");
  assert.match(warning.message, /lower target context/);
  assert.match(warning.message, /install a smaller model/);
  assert.match(warning.message, /--cloud-only/);
  assert.match(warning.message, /upgrade VRAM/);
  assert.equal(suppressed, null);
});
