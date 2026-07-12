import assert from "node:assert/strict";
import test, { mock } from "node:test";

mock.module("node:child_process", {
  namedExports: {
    execFileSync: mock.fn(() => "validator output\n"),
    spawn: mock.fn(),
    spawnSync: mock.fn(() => ({
      status: 0,
      stdout: "validator output\n",
      stderr: "validator warning\n",
    })),
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
    fn();
  } finally {
    process.stdout.write = originalWrite;
  }
  return chunks.join("");
}

test("runValidator frames its command and complete output in verbose mode", async () => {
  const { runValidator } = await import("../../lib/recommend/apply.js");
  const output = captureStdout(() =>
    runValidator("/tmp/omo-validate-config", "pipe", "/tmp/config.jsonc", { verboseMode: true }),
  );

  assert.match(output, /┌  \[exec\] .*omo-validate-config --config/);
  assert.match(output, /│  \[stdout\] validator output/);
  assert.match(output, /│  \[stderr\] validator warning/);
  assert.match(output, /└\n┌\n│\n$/);
});
