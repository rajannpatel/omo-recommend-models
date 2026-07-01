import test from "node:test";
import assert from "node:assert/strict";

import { applyCloudAssignments } from "../../lib/recommend/apply-recommendations.js";
import { showCloudRecommendations } from "../../lib/cli/recommend-output.js";
import { applicableCloudAssignment } from "../../lib/recommend/finalized-recommendations.js";

function captureStdout(fn) {
  const originalLog = console.log;
  const lines = [];
  console.log = (line = "") => lines.push(String(line));
  try {
    return { result: fn(), output: lines.join("\n") };
  } finally {
    console.log = originalLog;
  }
}

test("applyCloudAssignments filters unconfirmed local and excluded free refs without writing routing", () => {
  const config = {
    agents: {
      sisyphus: {
        model: "old/provider",
        routing: ["old/route"],
        fallback_models: ["old/fallback"],
      },
    },
    categories: {},
  };

  const total = applyCloudAssignments({
    config,
    confirmedModels: new Set(["tinyllama:1.1b"]),
    excludeFreeFromConfig: true,
    recommendations: [
      {
        name: "sisyphus",
        model: { provider: "opencode", model: "free-primary" },
        routing: [
          { provider: "local", model: "tinyllama:1.1b" },
          { provider: "local", model: "missing:1b" },
          { provider: "paid", model: "route" },
        ],
        fallback_models: [
          { provider: "opencode", model: "free-fallback" },
          { provider: "paid", model: "fallback" },
        ],
      },
    ],
  });

  assert.equal(total, 1);
  assert.equal(config.agents.sisyphus.model, "old/provider");
  assert.equal("routing" in config.agents.sisyphus, false);
  assert.deepEqual(config.agents.sisyphus.fallback_models, ["paid/fallback"]);
});

test("applyCloudAssignments clears stale routing and fallbacks", () => {
  const config = {
    agents: {
      sisyphus: {
        model: "old/provider",
        routing: ["old/route"],
        fallback_models: ["old/fallback"],
      },
    },
    categories: {},
  };

  const total = applyCloudAssignments({
    config,
    confirmedModels: new Set(),
    excludeFreeFromConfig: false,
    recommendations: [
      {
        name: "sisyphus",
        model: { provider: "paid", model: "primary" },
        routing: [],
        fallback_models: [],
      },
    ],
  });

  assert.equal(total, 1);
  assert.equal(config.agents.sisyphus.model, "paid/primary");
  assert.equal("routing" in config.agents.sisyphus, false);
  assert.equal("fallback_models" in config.agents.sisyphus, false);
});

test("applyCloudAssignments writes primary variant and structured fallback settings", () => {
  const config = {
    agents: {
      oracle: {},
    },
    categories: {},
  };

  const total = applyCloudAssignments({
    config,
    confirmedModels: new Set(),
    excludeFreeFromConfig: false,
    recommendations: [
      {
        name: "oracle",
        model: { provider: "openai", model: "gpt-5.5", variant: "high" },
        routing: [],
        fallback_models: [
          { provider: "anthropic", model: "claude-opus-4-7", variant: "max" },
          { provider: "opencode-go", model: "glm-5.1" },
        ],
      },
    ],
  });

  assert.equal(total, 1);
  assert.equal(config.agents.oracle.model, "openai/gpt-5.5");
  assert.equal(config.agents.oracle.variant, "high");
  assert.deepEqual(config.agents.oracle.fallback_models, [
    { model: "anthropic/claude-opus-4-7", variant: "max" },
    "opencode-go/glm-5.1",
  ]);
});

test("applyCloudAssignments removes blocked providers before writing", () => {
  const config = {
    agents: {
      sisyphus: {
        model: "old/provider",
        fallback_models: ["blocked/stale"],
      },
    },
    categories: {},
  };

  const total = applyCloudAssignments({
    config,
    confirmedModels: new Set(),
    excludeFreeFromConfig: false,
    isProviderAllowed: (provider) => provider !== "blocked",
    recommendations: [
      {
        name: "sisyphus",
        model: { provider: "blocked", model: "primary" },
        routing: [{ provider: "blocked", model: "route" }],
        fallback_models: [
          { provider: "blocked", model: "fallback" },
          { provider: "paid", model: "fallback" },
        ],
      },
    ],
  });

  assert.equal(total, 1);
  assert.equal(config.agents.sisyphus.model, "old/provider");
  assert.equal("routing" in config.agents.sisyphus, false);
  assert.deepEqual(config.agents.sisyphus.fallback_models, ["paid/fallback"]);
});

test("showCloudRecommendations previews the same cloud assignment apply writes", () => {
  const baseSection = {
    model: "old/provider",
    routing: ["old/route"],
    fallback_models: ["old/fallback"],
  };
  const recommendations = [
    {
      name: "sisyphus",
      type: "agent",
      model: { provider: "opencode", model: "free-primary" },
      routing: [{ provider: "blocked", model: "route" }],
      fallback_models: [
        { provider: "opencode", model: "free-fallback" },
        { provider: "blocked", model: "blocked-fallback" },
        { provider: "paid", model: "fallback", variant: "fast" },
      ],
    },
  ];
  const isProviderAllowed = (provider) => provider !== "blocked";
  const previewConfig = {
    agents: { sisyphus: { ...baseSection } },
    categories: {},
  };
  const applyConfig = {
    agents: { sisyphus: { ...baseSection } },
    categories: {},
  };

  const { result: changes, output } = captureStdout(() =>
    showCloudRecommendations({
      aiResult: { cloudRecommendations: recommendations },
      config: previewConfig,
      confirmedModels: new Set(),
      excludeFreeFromConfig: true,
      isProviderAllowed,
    }),
  );
  const total = applyCloudAssignments({
    recommendations,
    config: applyConfig,
    confirmedModels: new Set(),
    excludeFreeFromConfig: true,
    isProviderAllowed,
  });

  assert.equal(changes.length, total);
  assert.match(output, /model: old\/provider/);
  assert.match(output, /1\. paid\/fallback/);
  assert.doesNotMatch(output, /opencode\/free/);
  assert.doesNotMatch(output, /blocked\/blocked-fallback/);
  assert.deepEqual(applyConfig.agents.sisyphus, {
    model: "old/provider",
    fallback_models: [{ model: "paid/fallback", variant: "fast" }],
  });
});

test("applicableCloudAssignment reports display state separately from applyable changes", () => {
  const assignment = applicableCloudAssignment({
    confirmedModels: new Set(),
    excludeFreeFromConfig: true,
    rec: {
      name: "sisyphus",
      model: { provider: "opencode", model: "free-primary" },
      fallback_models: [{ provider: "opencode", model: "free-fallback" }],
    },
    section: {
      model: "previous/model",
      routing: ["stale/route"],
      fallback_models: ["stale/fallback"],
    },
  });

  assert.deepEqual(assignment, {
    hasChanges: false,
    model: null,
    modelString: "previous/model",
    fallbackModels: [],
    fallbackValues: [],
    fallbackStrings: [],
  });
});

test("applyCloudAssignments leaves stale routing untouched when no finalized change applies", () => {
  const config = {
    agents: {
      sisyphus: {
        model: "previous/model",
        routing: ["stale/route"],
        fallback_models: ["stale/fallback"],
      },
    },
    categories: {},
  };

  const total = applyCloudAssignments({
    config,
    confirmedModels: new Set(),
    excludeFreeFromConfig: true,
    recommendations: [
      {
        name: "sisyphus",
        model: { provider: "opencode", model: "free-primary" },
        routing: [{ provider: "paid", model: "route" }],
        fallback_models: [{ provider: "opencode", model: "free-fallback" }],
      },
    ],
  });

  assert.equal(total, 0);
  assert.deepEqual(config.agents.sisyphus, {
    model: "previous/model",
    routing: ["stale/route"],
    fallback_models: ["stale/fallback"],
  });
});
