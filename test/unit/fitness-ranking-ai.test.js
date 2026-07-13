import test, { mock } from "node:test";
import assert from "node:assert/strict";

// Mock child_process to prevent actual opencode execution during unit tests.
import { EventEmitter } from "node:events";

const opencodePrompts = [];
const spawnCalls = [];

const evaluatorLookup = {
  byId: {
    opencode: new Map([
      ["zero-alpha", { pricing: { input: 0, output: 0 }, capabilities: { toolcall: true } }],
    ]),
  },
};

function mockSpawnResponse(stdoutText, onPrompt = null) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write: () => {}, end: () => {} };
  child.stdin.write = (chunk) => {
    if (onPrompt) onPrompt(String(chunk));
  };
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
      spawnCalls.push({ bin: _bin, args: _args });
      const raw = JSON.stringify({
        type: "text",
        part: {
          text: JSON.stringify({
            oracle: [
              "anthropic/claude-opus-5",
              "opencode/model-alpha",
              "google/gemini-2.5-pro",
            ],
            atlas: [
              "openai/gpt-5.5",
              "anthropic/claude-opus-5",
              "google/gemini-2.5-pro",
            ],
            smith: [
              "google/gemini-2.5-pro",
              "openai/gpt-5.5",
              "anthropic/claude-opus-5",
            ],
          }),
        },
      });
      const isRun = Array.isArray(_args) && _args.includes("run");
      return mockSpawnResponse(raw + "\n", isRun ? (prompt) => opencodePrompts.push(prompt) : null);
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
      { provider: "opencode", model: "model-alpha" },
    ],
  };

  const nonRuleChainEntry = {
    name: "oracle",
    type: "agent",
    model: { provider: "openai", model: "gpt-5.5" },
    ruleChainMatched: false,
    fallback_models: [
      { provider: "anthropic", model: "claude-opus-5" },
      { provider: "opencode", model: "model-alpha" },
      { provider: "google", model: "gemini-2.5-pro" },
    ],
  };

  const ruleChainEntryOriginal = { ...ruleChainEntry };

  const result = await rankFallbacksByFitness([
    ruleChainEntry,
    nonRuleChainEntry,
  ], evaluatorLookup);

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
  assert.ok(
    ruleChainEntry.aiUsedModel,
    "ruleChainMatched entry should have aiUsedModel set for output display",
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
    "model-alpha",
    "first fallback model should be model-alpha (second in mock ranking)",
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

test("rankFallbacksByFitness sends one AI prompt per non-rule-chain entry", async () => {
  const { rankFallbacksByFitness } = await import(
    "../../lib/recommend/fitness-ranking.js"
  );

  opencodePrompts.length = 0;
  spawnCalls.length = 0;

  const atlas = {
    name: "atlas",
    type: "agent",
    model: { provider: "openai", model: "gpt-5.5" },
    ruleChainMatched: false,
    fallback_models: [
      { provider: "anthropic", model: "claude-opus-5" },
      { provider: "google", model: "gemini-2.5-pro" },
    ],
  };
  const smith = {
    name: "smith",
    type: "agent",
    model: { provider: "openai", model: "gpt-5.5" },
    ruleChainMatched: false,
    fallback_models: [
      { provider: "anthropic", model: "claude-opus-5" },
      { provider: "google", model: "gemini-2.5-pro" },
    ],
  };

  const result = await rankFallbacksByFitness([atlas, smith], evaluatorLookup);

  assert.equal(result, true);
  assert.equal(opencodePrompts.length, 2, "each entry should get its own AI query");
  assert.match(opencodePrompts[0], /## atlas \(agent\)/);
  assert.doesNotMatch(opencodePrompts[0], /## smith \(agent\)/);
  assert.match(opencodePrompts[1], /## smith \(agent\)/);
  assert.doesNotMatch(opencodePrompts[1], /## atlas \(agent\)/);

  const runCalls = spawnCalls.filter((call) => call.args?.includes("run"));
  assert.equal(runCalls.length, 2, "opencode should be invoked once per entry");
});
