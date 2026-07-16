import assert from "node:assert/strict";
import test, { mock } from "node:test";

mock.module("node:child_process", {
  namedExports: {
    execFileSync: mock.fn(() => JSON.stringify({ ollama: { models: [{ name: "llama3:latest" }] } })),
  },
});

function captureStdout(fn) {
  const originalWrite = process.stdout.write;
  const chunks = [];
  process.stdout.write = (chunk, encoding, callback) => {
    chunks.push(String(chunk));
    if (typeof encoding === "function") encoding();
    if (typeof callback === "function") callback();
    return true;
  };
  try {
    const value = fn();
    return { output: chunks.join(""), value };
  } finally {
    process.stdout.write = originalWrite;
  }
}

test("local model discovery reports normal status without JSON output", async () => {
  const { discoverLocalModels } = await import("../../lib/shared/local-models.js");

  const { output, value } = captureStdout(() => discoverLocalModels());

  assert.deepEqual(value, ["llama3:latest"]);
  assert.equal(output, "│  • omo-recommend-local --json\n");
  assert.doesNotMatch(output, /llama3|ollama|\[stdout\]|\[stderr\]/);
});
