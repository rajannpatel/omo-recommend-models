import assert from "node:assert/strict";
import test, { mock } from "node:test";

mock.module("../../lib/shared/provider-cache.js", {
  namedExports: {
    discoverFreeModels: () => ["opencode/mimo-v2.5-free"],
    isFreeModelRef: (provider) => provider === "opencode",
  },
});

mock.module("../../lib/recommend/fitness/opencode-runner.js", {
  namedExports: {
    callOpencode: async () => JSON.stringify({
      atlas: [
        "opencode/mimo-v2.5-free",
        "openai/gpt-5.5",
        "anthropic/claude-opus-5",
      ],
    }),
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
      { provider: "opencode", model: "mimo-v2.5-free" },
      { provider: "anthropic", model: "claude-opus-5" },
    ],
  };

  const { output, value } = await captureStdout(() =>
    rankFallbacksByFitness([atlas]),
  );

  assert.equal(value, true);
  assert.match(
    output,
    /^◇  AI ranking 1 agent\(s\)\/category\(ies\) by model fitness — processed 0\/1\n│  → atlas by opencode\/mimo-v2\.5-free\.\.\.\n/,
  );
  assert.match(output, /\n│  ✓  processed  atlas by opencode\/mimo-v2\.5-free\n/);
  assert.match(output, /\n│\n◇  AI ranking 1 agent\(s\)\/category\(ies\) by model fitness — processed 1\/1\n/);
  assert.match(output, /\n│\n◇  AI ranking complete: 1\/1 ranked using\n│  • opencode\/mimo-v2\.5-free\n│\n$/);
  assert.doesNotMatch(output, /\r/);
});
