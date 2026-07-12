import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test, { mock } from "node:test";

function childFor(args) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write: () => {}, end: () => {} };
  process.nextTick(() => {
    if (args.includes("--version")) {
      child.stdout.emit("data", Buffer.from("opencode 1.0.0\n"));
    } else {
      child.stdout.emit("data", Buffer.from(`${JSON.stringify({
        type: "text",
        part: { text: "ranked" },
      })}\n`));
      child.stderr.emit("data", Buffer.from("model warning\n"));
    }
    child.emit("close", 0);
  });
  return child;
}

mock.module("node:child_process", {
  namedExports: {
    spawn: mock.fn((_bin, args) => childFor(args)),
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

test("callOpencode keeps normal-mode event diagnostics out of the presentation stream", async () => {
  const { callOpencode } = await import(
    "../../lib/recommend/fitness/opencode-runner.js"
  );

  const { output, value } = await captureStdout(() =>
    callOpencode("rank this", "opencode/mimo-v2.5-free"),
  );

  assert.equal(value, "ranked");
  assert.equal(output, "");
});

test("callOpencode exposes the command and complete streams in verbose mode", async () => {
  const { callOpencode } = await import(
    "../../lib/recommend/fitness/opencode-runner.js"
  );

  const { output, value } = await captureStdout(() =>
    callOpencode("rank this", "opencode/mimo-v2.5-free", null, { verbose: true }),
  );

  assert.equal(value, "ranked");
  assert.match(output, /┌  \[exec\] opencode run --format json/);
  assert.match(output, /│  \[stdout\] .*"type":"text"/);
  assert.match(output, /│  \[stderr\] model warning/);
  assert.match(output, /└\n┌\n│\n$/);
});
