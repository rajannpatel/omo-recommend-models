import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

function mockSpawnResponse(stdoutText) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write: () => {}, end: () => {} };
  process.nextTick(() => {
    child.stdout.emit("data", Buffer.from(stdoutText));
    process.nextTick(() => child.emit("close", 0));
  });
  return child;
}

mock.module("node:child_process", {
  namedExports: {
    execFileSync: mock.fn(() => "opencode/zero-alpha\n"),
    spawn: mock.fn(() => {
      const raw = JSON.stringify({
        type: "text",
        part: {
          text: JSON.stringify({
            atlas: ["openai/gpt-5.5", "anthropic/claude-opus-5"],
          }),
        },
      });
      return mockSpawnResponse(`${raw}\n`);
    }),
  },
});

test("rankFallbacksByFitness uses cloudLookup cost metadata when deduplicating after ranking", async () => {
  const { rankFallbacksByFitness } = await import(
    "../../lib/recommend/fitness-ranking.js"
  );

  const atlas = {
    name: "atlas",
    type: "agent",
    model: { provider: "openai", model: "gpt-5.5" },
    ruleChainMatched: false,
    fallback_models: [
      { provider: "anthropic", model: "claude-opus-5" },
      { provider: "github-copilot", model: "zero-a" },
      { provider: "github-copilot", model: "zero-b" },
    ],
  };
  const cloudLookup = {
    byId: {
      openai: new Map([["gpt-5.5", { pricing: { input: 1, output: 1 } }]]),
      anthropic: new Map([["claude-opus-5", { pricing: { input: 1, output: 1 } }]]),
      "github-copilot": new Map([
        ["zero-a", { pricing: { input: 0, output: 0 }, capabilities: { toolcall: true } }],
        ["zero-b", { pricing: { input: 0, output: 0 }, capabilities: { toolcall: true } }],
      ]),
    },
  };

  assert.equal(await rankFallbacksByFitness([atlas], cloudLookup), true);
  assert.deepEqual(
    atlas.fallback_models
      .filter((ref) => ref.provider === "github-copilot")
      .map((ref) => ref.model),
    ["zero-a", "zero-b"],
  );
});
