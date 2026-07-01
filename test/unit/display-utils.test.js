import assert from "node:assert/strict";
import test from "node:test";

import {
  formatAiAnalysis,
  resultHasRejectedLocal,
} from "../../lib/display-utils.js";

test("formatAiAnalysis preserves provider groups inside unresolved rule chains", () => {
  const analysis = [
    "Assigned from upstream oh-my-openagent model fallback rules after loading provider availability.",
    "No available rule-chain model for:",
    "visual-engineering (tried: (google, github-copilot, opencode, vercel)/gemini-3.1-pro > (opencode-go, vercel)/glm-5.1),",
    "writing (tried: (google, github-copilot, opencode, vercel)/gemini-3-flash > (opencode-go, vercel)/kimi-k2.6).",
  ].join(" ");

  const formatted = formatAiAnalysis(analysis);

  assert.match(
    formatted,
    /◦ visual-engineering:\s*\n\s*sorted in \(AI Provider\)\/Model preference:\s*\n\s*1\.\s*\(google, github-copilot, opencode, vercel\)\/gemini-3\.1-pro\s*\n\s*2\.\s*\(opencode-go, vercel\)\/glm-5\.1\)/,
  );
  assert.match(
    formatted,
    /◦ writing:\s*\n\s*sorted in \(AI Provider\)\/Model preference:\s*\n\s*1\.\s*\(google, github-copilot, opencode, vercel\)\/gemini-3-flash\s*\n\s*2\.\s*\(opencode-go, vercel\)\/kimi-k2\.6\)/,
  );
  assert.doesNotMatch(formatted, /\n  • github-copilot/);
  assert.doesNotMatch(formatted, /\n  • opencode/);
  assert.doesNotMatch(formatted, /\n  • vercel\)/);
});

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
