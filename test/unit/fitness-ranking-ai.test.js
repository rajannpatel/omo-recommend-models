import { mock } from "node:test";
import test from "node:test";
import assert from "node:assert/strict";

// Mock child_process to prevent actual opencode execution during unit tests.
import { EventEmitter } from "node:events";

function mockSpawnResponse(stdoutText) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write: () => {}, end: () => {} };
  child.stdin.write = () => {};
  child.stdin.end = () => {};
  process.nextTick(() => {
    child.stdout.emit("data", Buffer.from(stdoutText));
    process.nextTick(() => child.emit("close", 0));
  });
  return child;
}

mock.module("node:child_process", {
  namedExports: {
    execFileSync: mock.fn(() => { /* other modules in import chain may need this */ }),
    spawn: mock.fn((_bin, _args, _options) => {
      const raw = JSON.stringify({
        type: "text",
        part: {
          text: JSON.stringify({
            oracle: [
              "anthropic/claude-opus-5",
              "opencode/big-pickle",
              "google/gemini-2.5-pro",
            ],
          }),
        },
      });
      return mockSpawnResponse(raw + "\n");
    }),
  },
});

test("rankFallbacksByFitness gracefully handles mixed rule-chain and non-rule-chain entries", async () => {
  const { rankFallbacksByFitness } = await import(
    "../../lib/recommend/fitness-ranking.js"
  );

  const ruleChainEntry = {
    name: "sisyphus",
    type: "agent",
    model: { provider: "opencode-go", model: "kimi-k2.6" },
    ruleChainMatched: true,
    fallback_models: [
      { provider: "openai", model: "gpt-5.5" },
      { provider: "opencode", model: "big-pickle" },
    ],
  };

  const nonRuleChainEntry = {
    name: "oracle",
    type: "agent",
    model: { provider: "openai", model: "gpt-5.5" },
    ruleChainMatched: false,
    fallback_models: [
      { provider: "anthropic", model: "claude-opus-5" },
      { provider: "opencode", model: "big-pickle" },
      { provider: "google", model: "gemini-2.5-pro" },
    ],
  };

  const ruleChainEntryOriginal = { ...ruleChainEntry };

  const result = await rankFallbacksByFitness([
    ruleChainEntry,
    nonRuleChainEntry,
  ]);

  // Rule-chain entries must never be sent to AI or mutated
  assert.deepEqual(
    ruleChainEntry.model,
    ruleChainEntryOriginal.model,
    "ruleChainMatched entry model must remain unchanged",
  );
  assert.deepEqual(
    ruleChainEntry.fallback_models,
    ruleChainEntryOriginal.fallback_models,
    "ruleChainMatched entry fallback_models must remain unchanged",
  );
  assert.equal(
    ruleChainEntry.aiUsedModel,
    undefined,
    "ruleChainMatched entry must not acquire aiUsedModel",
  );

  // Non-rule-chain entries must be ranked by AI, with model attribution
  assert.ok(
    result,
    "AI ranking should return true for successfully ranked non-rule-chain entry",
  );
  assert.ok(
    nonRuleChainEntry.aiUsedModel,
    "non-rule-chain entry should have aiUsedModel set after AI ranking",
  );
  assert.match(
    nonRuleChainEntry.aiUsedModel,
    /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9._-]+$/,
    "aiUsedModel should be a valid provider/model ref string",
  );
  assert.equal(
    nonRuleChainEntry.model.provider,
    "anthropic",
    "top-ranked model provider should be anthropic (first in mock ranking)",
  );
  assert.equal(
    nonRuleChainEntry.model.model,
    "claude-opus-5",
    "top-ranked model should be claude-opus-5 (first in mock ranking)",
  );
  assert.equal(
    nonRuleChainEntry.fallback_models.length,
    3,
    "fallback_models should contain remaining models (ranked + original unranked primary)",
  );
  assert.equal(
    nonRuleChainEntry.fallback_models[0].provider,
    "opencode",
    "first fallback provider should be opencode (second in mock ranking)",
  );
  assert.equal(
    nonRuleChainEntry.fallback_models[0].model,
    "big-pickle",
    "first fallback model should be big-pickle (second in mock ranking)",
  );
  // The original primary (openai/gpt-5.5) was not in the ranking output,
  // so it gets sorted to Infinity and becomes the last fallback
  assert.equal(
    nonRuleChainEntry.fallback_models[2].provider,
    "openai",
    "original unranked primary should be last fallback",
  );
  assert.equal(
    nonRuleChainEntry.fallback_models[2].model,
    "gpt-5.5",
    "original unranked primary should be last fallback",
  );
});
