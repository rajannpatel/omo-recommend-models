import assert from "node:assert/strict";
import test from "node:test";

import { resultHasRejectedLocal } from "../../lib/display-utils.js";

test("resultHasRejectedLocal rejects cached locals that do not fit the specific entry", () => {
  const fittingByName = new Map([
    ["deepseek-r1:8b", { name: "deepseek-r1:8b" }],
  ]);
  const localRecommendationContext = {
    rankedCandidatesByEntry: new Map([
      ["sisyphus", []],
      ["hephaestus", [{ name: "deepseek-r1:8b" }]],
    ]),
  };
  const cached = {
    cloudRecommendations: [
      {
        name: "sisyphus",
        model: { provider: "opencode", model: "big-pickle" },
        routing: [],
        fallback_models: [{ provider: "local", model: "deepseek-r1:8b" }],
      },
    ],
  };

  assert.equal(resultHasRejectedLocal(cached, fittingByName, localRecommendationContext), true);
});

test("resultHasRejectedLocal accepts cached locals that fit the cached entry", () => {
  const fittingByName = new Map([
    ["deepseek-r1:8b", { name: "deepseek-r1:8b" }],
  ]);
  const localRecommendationContext = {
    rankedCandidatesByEntry: new Map([
      ["sisyphus", [{ name: "deepseek-r1:8b" }]],
    ]),
  };
  const cached = {
    cloudRecommendations: [
      {
        name: "sisyphus",
        model: { provider: "opencode", model: "big-pickle" },
        routing: [],
        fallback_models: [{ provider: "local", model: "deepseek-r1:8b" }],
      },
    ],
  };

  assert.equal(resultHasRejectedLocal(cached, fittingByName, localRecommendationContext), false);
});
