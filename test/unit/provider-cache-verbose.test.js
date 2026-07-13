import test, { mock } from "node:test";
import assert from "node:assert/strict";

mock.module("node:child_process", {
  namedExports: {
    execFileSync: mock.fn((_command, args) => {
      if (args.length === 1 && args[0] === "models") {
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

test("loadProviderModels parses nested verbose cost metadata", async () => {
  const { loadProviderModels } = await import("../../lib/shared/provider-cache.js");

  const cache = await loadProviderModels({ quiet: true });

  assert.deepEqual(cache.models["github-copilot"], [
    {
      id: "zero-nested",
      capabilities: { toolcall: true },
      pricing: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    },
  ]);
});
