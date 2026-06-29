import test from "node:test";
import assert from "node:assert/strict";

import { applyCloudAssignments } from "../../lib/recommend/apply-recommendations.js";

test("applyCloudAssignments filters unconfirmed local and excluded free refs", () => {
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
  assert.deepEqual(config.agents.sisyphus.routing, [
    "local/tinyllama:1.1b",
    "paid/route",
  ]);
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
