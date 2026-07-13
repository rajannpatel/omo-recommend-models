import test from "node:test";
import assert from "node:assert/strict";

import {
  createRuleBasedRecommendations,
} from "../../lib/recommend/rules-assignment.js";
import { completeAiRecommendations } from "../../lib/recommend/recommendation-finalizer.js";
import { rankFallbacksByFitness } from "../../lib/recommend/fitness-ranking.js";

function lookup(models) {
  const byId = {};
  for (const [provider, ids] of Object.entries(models)) {
    byId[provider] = new Map(ids.map((id) => [id, modelMeta(provider, id)]));
  }
  return { byId, sets: {} };
}

function modelMeta(provider, id) {
  if (provider === "opencode" || id.includes("free")) {
    return { pricing: { input: 0, output: 0 }, capabilities: { toolcall: true } };
  }
  return { pricing: { input: 0.01, output: 0.02 }, capabilities: { toolcall: true } };
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
      opencode: ["glm-5"],
    }),
  });

  assert.equal(result.recommender, "rules(model-core)");
  assert.equal(result.cloudRecommendations.length, 2);

  const sisyphus = result.cloudRecommendations.find((rec) => rec.name === "sisyphus");
  assert.equal(sisyphus.model.provider, "opencode-go");
  assert.equal(sisyphus.model.model, "kimi-k2.6");
  assert.deepEqual(
    sisyphus.routing.map((ref) => `${ref.provider}/${ref.model}`),
    ["openai/gpt-5.5", "opencode/glm-5"],
  );
  assert.deepEqual(
    sisyphus.fallback_models.map((ref) => `${ref.provider}/${ref.model}`),
    ["openai/gpt-5.5", "opencode/glm-5"],
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
      opencode: ["glm-5", "zero-beta"],
    }),
  });

  const sisyphus = result.cloudRecommendations[0];
  assert.deepEqual(
    sisyphus.fallback_models.map((ref) => `${ref.provider}/${ref.model}`),
    [
      "openai/gpt-5.5",
      "opencode/glm-5",
      "opencode/zero-beta",
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
      opencode: ["gpt-5.5", "glm-5"],
      "opencode-go": ["kimi-k2.6"],
    }),
    excludeModels: ["openai", "opencode-go/kimi-k2.6"],
  });

  assert.equal(result.cloudRecommendations.length, 2);
  const sisyphus = result.cloudRecommendations.find((rec) => rec.name === "sisyphus");
  assert.equal(sisyphus.model.provider, "opencode");
  assert.equal(sisyphus.model.model, "gpt-5.5");
  const hephaestus = result.cloudRecommendations.find((rec) => rec.name === "hephaestus");
  assert.equal(hephaestus.model.provider, "opencode");
  assert.equal(hephaestus.model.model, "gpt-5.5");
  assert.equal(hephaestus.ruleChainMatched, true);
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
      opencode: ["glm-5"],
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
      opencode: ["zero-utility"],
    }),
  });

  const hephaestus = result.cloudRecommendations[0];
  assert.equal(hephaestus.model.provider, "paid");
  assert.equal(hephaestus.model.model, "large-pro");
  assert.equal(hephaestus.fallback_models[0].provider, "opencode");
  assert.equal(hephaestus.fallback_models[0].model, "zero-utility");
  assert.match(result.analysis, /tried: \(openai, github-copilot, opencode, vercel\)\/gpt-5.5/);
});

test("createRuleBasedRecommendations adds the best usable fallback from each outside-chain provider", () => {
  const config = {
    agents: {
      hephaestus: { description: "deep worker" },
    },
    categories: {},
  };

  const result = createRuleBasedRecommendations({
    config,
    cloudLookup: lookup({
      "paid-a": ["tiny-mini", "large-pro"],
      "paid-b": ["reasoning-plus", "small-lite"],
      opencode: ["zero-large", "zero-mini"],
    }),
    isModelAllowed: ({ provider, model }) =>
      `${provider}/${model}` !== "paid-b/reasoning-plus",
  });

  const hephaestus = result.cloudRecommendations[0];
  assert.deepEqual(
    [hephaestus.model, ...hephaestus.fallback_models]
      .map((ref) => `${ref.provider}/${ref.model}`),
    ["paid-a/large-pro", "paid-b/small-lite", "opencode/zero-large", "opencode/zero-mini"],
  );
  assert.equal(
    hephaestus.model.reason,
    "Best available paid model outside upstream rule chain",
  );
});

test("createRuleBasedRecommendations skips disallowed outside-chain paid refs", () => {
  const config = {
    agents: {
      hephaestus: { description: "deep worker" },
    },
    categories: {},
  };

  const result = createRuleBasedRecommendations({
    config,
    cloudLookup: lookup({
      openai: ["gpt-5.5-pro", "gpt-4.1"],
      opencode: ["zero-utility"],
    }),
    isModelAllowed: ({ provider, model }) =>
      `${provider}/${model}` !== "openai/gpt-5.5-pro",
  });

  const hephaestus = result.cloudRecommendations[0];
  assert.equal(hephaestus.model.provider, "openai");
  assert.equal(hephaestus.model.model, "gpt-4.1");
  assert.equal(
    hephaestus.fallback_models.some(
      (ref) => `${ref.provider}/${ref.model}` === "openai/gpt-5.5-pro",
    ),
    false,
  );
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

test("createRuleBasedRecommendations accepts github-copilot gpt-5.5 for multimodal-looker", () => {
  const config = {
    agents: {
      "multimodal-looker": { description: "vision agent" },
    },
    categories: {},
  };

  const result = createRuleBasedRecommendations({
    config,
    cloudLookup: lookup({
      "github-copilot": ["gpt-5.5"],
    }),
  });

  const rec = result.cloudRecommendations[0];
  assert.doesNotMatch(result.analysis, /No available rule-chain models/);
  assert.equal(rec.model.provider, "github-copilot");
  assert.equal(rec.model.model, "gpt-5.5");
  assert.equal(
    rec.model.reason,
    "Rule chain priority 1 (live equivalent inferred from rule corpus)",
  );
});

test("createRuleBasedRecommendations does not infer arbitrary same-name providers", () => {
  const config = {
    agents: {
      "multimodal-looker": { description: "vision agent" },
    },
    categories: {},
  };

  const result = createRuleBasedRecommendations({
    config,
    cloudLookup: lookup({
      "unknown-paid": ["gpt-5.5"],
    }),
  });

  const rec = result.cloudRecommendations[0];
  assert.match(result.analysis, /No available rule-chain models for: multimodal-looker/);
  assert.equal(rec.model.provider, "unknown-paid");
  assert.equal(rec.model.model, "gpt-5.5");
  assert.equal(rec.model.reason, "Best available paid model outside upstream rule chain");
});

test("createRuleBasedRecommendations sets ruleChainMatched:true for rule-chain matched entries", () => {
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
      opencode: ["glm-5"],
    }),
  });

  assert.equal(result.cloudRecommendations.length, 1);
  const sisyphus = result.cloudRecommendations.find((rec) => rec.name === "sisyphus");
  assert.equal(sisyphus.ruleChainMatched, true,
    "sisyphus has upstream rule-chain match → ruleChainMatched should be true");
});

test("createRuleBasedRecommendations sets ruleChainMatched:false for pipeline-matched entries", () => {
  const config = {
    agents: {
      hephaestus: { description: "builder" },
    },
    categories: {},
  };

  // hephaestus has upstream rules but if chain is exhausted (no matching models)
  // it falls through to pipeline matching
  const result = createRuleBasedRecommendations({
    config,
    cloudLookup: lookup({
      opcode: ["tiny-mini"], // not in hephaestus rule chain
    }),
  });

  const hephaestus = result.cloudRecommendations[0];
  assert.equal(hephaestus.ruleChainMatched, false,
    "entry matched via pipeline should have ruleChainMatched:false");
});

test("end-to-end ruleChainMatched pipeline: createRuleBasedRecommendations → completeAiRecommendations → rankFallbacksByFitness preserves rule-chain entries", async () => {
  const config = {
    agents: {
      sisyphus: { description: "orchestrator" },
    },
    categories: {},
  };

  // Create cloudLookup with models that match sisyphus's rule chain
  const cloudLookup = lookup({
    "opencode-go": ["kimi-k2.6"],
    openai: ["gpt-5.5"],
    opencode: ["glm-5", "zero-beta"],
  });

  // Step 1: Create rule-based recommendations (produces ruleChainMatched: true for sisyphus)
  const ruleResult = createRuleBasedRecommendations({
    config,
    cloudLookup,
  });

  assert.equal(ruleResult.cloudRecommendations.length, 1);
  const sisyphus = ruleResult.cloudRecommendations.find((rec) => rec.name === "sisyphus");
  assert.equal(sisyphus.ruleChainMatched, true, "rule-chain matched entry should have ruleChainMatched: true");

  // Capture the original model and fallback_models before finalization/ranking
  const originalModel = { ...sisyphus.model };
  const originalFallbackModels = sisyphus.fallback_models.map(f => ({ ...f }));

  // Step 2: Complete AI recommendations (finalization)
  const completed = completeAiRecommendations(
    ruleResult,
    config,
    cloudLookup,
    [], // allLocalModels
    { hasGpu: false, vramGb: 0 }, // gpu
    { models: [] }, // ollama
    () => true, // isProviderAllowed
    null, // localRecommendationContext
    () => true, // isModelAllowed
  );

  // Verify ruleChainMatched survives finalization
  const completedSisyphus = completed.cloudRecommendations.find((rec) => rec.name === "sisyphus");
  assert.equal(completedSisyphus.ruleChainMatched, true, "ruleChainMatched should survive completeAiRecommendations");

  // Step 3: Rank fallbacks by fitness (AI ranking - should skip rule-chain entries)
  // This may call opencode binary if available, but rule-chain entries are guarded
  await rankFallbacksByFitness(completed.cloudRecommendations, cloudLookup);

  // Verify rule-chain-matched entry: model unchanged, fallbacks reordered by AI, aiUsedModel set
  const finalSisyphus = completed.cloudRecommendations.find((rec) => rec.name === "sisyphus");
  assert.deepEqual(finalSisyphus.model, originalModel, "ruleChainMatched entry model must remain unchanged after ranking");
  assert.equal(finalSisyphus.fallback_models.length, originalFallbackModels.length,
    "ruleChainMatched entry should keep the same number of fallbacks after ranking");
  // Fallbacks may be reordered by AI ranking; verify the same set of refs is present
  const originalRefs = new Set(originalFallbackModels.map(f => `${f.provider}/${f.model}`));
  const finalRefs = new Set(finalSisyphus.fallback_models.map(f => `${f.provider}/${f.model}`));
  assert.deepEqual([...finalRefs].sort(), [...originalRefs].sort(),
    "ruleChainMatched entry must keep the same set of fallback refs after ranking");
  // aiUsedModel records the round-robin model selected for AI analysis even on
  // rule-chain entries so the output can show "(ranked by <model>)" consistently.
  assert.ok(finalSisyphus.aiUsedModel,
    "ruleChainMatched entry must have aiUsedModel set for output display");
});
