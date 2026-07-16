import test, { mock } from "node:test";
import assert from "node:assert/strict";

let failAccessibleModels = false;

mock.module("node:child_process", {
  namedExports: {
    execFileSync: mock.fn((_command, args) => {
      if (args.length === 1 && args[0] === "models") {
        if (failAccessibleModels) {
          const error = new Error("opencode models failed");
          error.stderr = "raw provider stderr\n";
          throw error;
        }
        return "github-copilot/zero-nested\n";
      }
      if (args.length === 2 && args[0] === "models" && args[1] === "--verbose") {
        return `github-copilot/zero-nested
{
  "id": "zero-nested",
  "cost": {
    "input": 0,
    "output": 0,
    "cache": {
      "read": 0,
      "write": 0
    }
  },
  "capabilities": {
    "toolcall": true
  }
}
`;
      }
      throw new Error(`unexpected opencode args: ${args.join(" ")}`);
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

test("loadProviderModels parses nested verbose cost metadata", async () => {
  const { loadProviderModels, resetCache } = await import("../../lib/shared/provider-cache.js");
  resetCache();
  failAccessibleModels = false;

  const { output, value: cache } = await captureStdout(() => loadProviderModels({ quiet: true }));

  assert.deepEqual(cache.models["github-copilot"], [
    {
      id: "zero-nested",
      capabilities: { toolcall: true },
      pricing: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    },
  ]);
  assert.equal(output, "│  • opencode models\n│  • opencode models --verbose\n");
  assert.doesNotMatch(output, /github-copilot|\[stdout\]|\[stderr\]/);
});

test("loadProviderModels hides opencode models stderr in normal mode", async () => {
  const { loadProviderModels, resetCache } = await import("../../lib/shared/provider-cache.js");
  resetCache();
  failAccessibleModels = true;
  const originalError = console.error;
  const stderrLines = [];
  console.error = (...args) => stderrLines.push(args.map(String).join(" "));

  try {
    const { output, value } = await captureStdout(() => loadProviderModels({ quiet: true }));

    assert.equal(value, null);
    assert.equal(output, "│  • opencode models\n");
    assert.deepEqual(stderrLines, []);
    assert.doesNotMatch(output, /raw provider stderr|opencode models failed|\[stderr\]/);
  } finally {
    failAccessibleModels = false;
    console.error = originalError;
    resetCache();
  }
});
