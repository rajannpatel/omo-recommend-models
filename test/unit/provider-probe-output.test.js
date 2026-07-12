import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test, { mock } from "node:test";

function successfulChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {};
  process.nextTick(() => {
    child.stdout.emit("data", Buffer.from(`${JSON.stringify({
      type: "text",
      part: { text: "1" },
    })}\n`));
    child.stderr.emit("data", Buffer.from("provider warning\n"));
    child.emit("close", 0);
  });
  return child;
}

mock.module("node:child_process", {
  namedExports: {
    spawn: mock.fn(() => successfulChild()),
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

test("probeModel keeps normal-mode child events out of the presentation stream", async () => {
  const { RuntimeContext } = await import("../../lib/runtime-context.js");
  const { probeModel } = await import("../../lib/providers/probe.js");
  const ctx = new RuntimeContext();

  const { output, value } = await captureStdout(() =>
    probeModel(ctx, "openai/gpt-5.5"),
  );

  assert.deepEqual(value, { ok: true });
  assert.equal(output, "");
});

test("probeModel exposes its command and complete streams in verbose mode", async () => {
  const { RuntimeContext } = await import("../../lib/runtime-context.js");
  const { probeModel } = await import("../../lib/providers/probe.js");
  const ctx = new RuntimeContext();
  ctx.verboseMode = true;

  const { output, value } = await captureStdout(() =>
    probeModel(ctx, "openai/gpt-5.5"),
  );

  assert.deepEqual(value, { ok: true });
  assert.match(output, /┌  \[exec\] opencode run/);
  assert.match(output, /│  \[stdout\] .*"type":"text"/);
  assert.match(output, /│  \[stderr\] provider warning/);
  assert.match(output, /└\n┌\n│\n$/);
});
