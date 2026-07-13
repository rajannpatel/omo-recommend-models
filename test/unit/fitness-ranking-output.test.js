import assert from "node:assert/strict";
import test, { mock } from "node:test";

mock.module("../../lib/shared/provider-cache.js", {
  namedExports: {
    buildFreeModelRefPredicate: () => (ref) => ref.provider === "opencode",
    discoverFreeModels: () => ["opencode/zero-alpha"],
    isFreeModelRef: (provider) => provider === "opencode",
    isZeroCostModelMeta: (meta) => meta?.pricing?.input === 0 && meta?.pricing?.output === 0,
  },
});

function entryNameFromPrompt(prompt) {
  const match = String(prompt).match(/## ([^\s]+) \(/);
  return match?.[1] || "atlas";
}

mock.module("../../lib/recommend/fitness/opencode-runner.js", {
  namedExports: {
    callOpencode: async (prompt, modelRef) => {
      const entryName = entryNameFromPrompt(prompt);
      if (entryName === "librarian" && modelRef === "opencode/zero-beta") {
        throw new Error("opencode timed out - no output for 60s");
      }
      return JSON.stringify({
        [entryName]: [
          "opencode/zero-alpha",
          "openai/gpt-5.5",
          "anthropic/claude-opus-5",
        ],
      });
    },
  },
});

async function captureStdout(fn) {
  const originalWrite = process.stdout.write;
  const chunks = [];
  process.stdout.write = (chunk, encoding, callback) => {
    chunks.push(String(chunk));
    if (typeof encoding === "function") encoding();
    if (typeof callback === "function") callback();
    return true;
  };
  try {
    const value = await fn();
    return { output: chunks.join(""), value };
  } finally {
    process.stdout.write = originalWrite;
  }
}

test("rankFallbacksByFitness emits grouped records instead of non-TTY redraws", async () => {
  const { rankFallbacksByFitness } = await import(
    "../../lib/recommend/fitness-ranking.js"
  );
  const atlas = {
    name: "atlas",
    type: "agent",
    model: { provider: "openai", model: "gpt-5.5" },
    fallback_models: [
      { provider: "opencode", model: "zero-alpha" },
      { provider: "anthropic", model: "claude-opus-5" },
    ],
  };

  const { output, value } = await captureStdout(() =>
    rankFallbacksByFitness([atlas]),
  );

  assert.equal(value, true);
  assert.match(
    output,
    /^◇  AI ranking 1 agent\(s\)\/category\(ies\) by model fitness — processed 0\/1\n│  → atlas by opencode\/zero-alpha\.\.\.\n/,
  );
  assert.match(output, /\n│  ✓  processed  atlas by opencode\/zero-alpha\n/);
  assert.match(output, /\n│\n◇  AI ranking 1 agent\(s\)\/category\(ies\) by model fitness — processed 1\/1\n/);
  assert.match(output, /\n│\n◇  AI ranking complete: 1\/1 ranked using\n│  • opencode\/zero-alpha\n│\n$/);
  assert.doesNotMatch(output, /\r/);
});

test("rankFallbacksByFitness continues with remaining evaluators after one times out", async () => {
  const { rankFallbacksByFitness } = await import(
    "../../lib/recommend/fitness-ranking.js"
  );
  const entries = ["hephaestus", "librarian", "explore"].map((name) => ({
    name,
    type: "agent",
    model: { provider: "openai", model: "gpt-5.5" },
    fallback_models: [
      { provider: "opencode", model: "zero-alpha" },
      { provider: "anthropic", model: "claude-opus-5" },
    ],
  }));
  const cloudLookup = {
    byId: {
      opencode: new Map([
        ["zero-alpha", { pricing: { input: 0, output: 0 }, capabilities: { toolcall: true } }],
        ["zero-beta", { pricing: { input: 0, output: 0 }, capabilities: { toolcall: true } }],
      ]),
    },
  };

  const { output, value } = await captureStdout(() =>
    rankFallbacksByFitness(entries, cloudLookup),
  );

  assert.equal(value, true);
  assert.match(output, /✗  librarian by opencode\/zero-beta — opencode timed out - no output for 60s/);
  assert.match(output, /✓  processed  librarian by opencode\/zero-alpha/);
  assert.match(output, /✓  processed  explore by opencode\/zero-alpha/);
  assert.match(output, /◇  AI ranking complete: 3\/3 ranked using/);
});
