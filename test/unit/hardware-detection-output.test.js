import assert from "node:assert/strict";
import test, { mock } from "node:test";

mock.module("node:child_process", {
  namedExports: {
    execFileSync: mock.fn((command, args) => {
      if (command === "nvidia-smi") return "NVIDIA Test, 24576\n";
      if (command === "ollama" && args[0] === "--version") return "ollama version 1.0.0\n";
      if (command === "ollama" && args[0] === "list") return "NAME ID SIZE\nllama3:latest abc 4GB\n";
      throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
    }),
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

test("hardware detection reports normal status without command output", async () => {
  const { detectGPU, detectOllama } = await import("../../lib/recommend/hardware-detection.js");

  const gpu = captureStdout(() => detectGPU());
  assert.equal(gpu.value.label, "NVIDIA Test (24 GB VRAM)");
  assert.equal(gpu.output, "│  • nvidia-smi \"--query-gpu=name,memory.total\" \"--format=csv,noheader,nounits\"\n");

  const ollama = captureStdout(() => detectOllama(() => ["/usr/bin/ollama"]));
  assert.equal(ollama.value.version, "ollama version 1.0.0");
  assert.deepEqual(ollama.value.models, [{ name: "llama3:latest", size: "abc" }]);
  assert.equal(ollama.output, "│  • ollama --version\n│  • ollama list\n");
  assert.doesNotMatch(`${gpu.output}${ollama.output}`, /NVIDIA Test|ollama version|llama3|\[stdout\]|\[stderr\]/);
});
