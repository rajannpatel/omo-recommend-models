import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test, { mock } from "node:test";

let nextRunMode = "success";

function childFor(args) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write: () => {}, end: () => {} };
  process.nextTick(() => {
    if (args.includes("--version")) {
      child.stdout.emit("data", Buffer.from("opencode 1.0.0\n"));
    } else if (nextRunMode === "nonzero") {
      nextRunMode = "success";
      child.stderr.emit("data", Buffer.from("raw opencode failure stderr\n"));
      child.emit("close", 9);
      return;
    } else if (nextRunMode === "no-text") {
      nextRunMode = "success";
      child.stdout.emit("data", Buffer.from(`${JSON.stringify({ type: "done" })}\n`));
      child.stderr.emit("data", Buffer.from("raw opencode no-text stderr\n"));
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

test("callOpencode reports normal status without raw events or stderr", async () => {
  const { callOpencode } = await import(
    "../../lib/recommend/fitness/opencode-runner.js"
  );

  const { output, value } = await captureStdout(() =>
    callOpencode("rank this", "opencode/zero-alpha"),
  );

  assert.equal(value, "ranked");
  assert.equal(output, "│  • opencode --version\n│  • opencode run --format json --model opencode/zero-alpha\n");
  assert.doesNotMatch(output, /ranked|model warning|\[event|\[raw|\[stderr\]|\{"type"/);
});

test("callOpencode exposes the command and complete streams in verbose mode", async () => {
  const { callOpencode } = await import(
    "../../lib/recommend/fitness/opencode-runner.js"
  );

  const { output, value } = await captureStdout(() =>
    callOpencode("rank this", "opencode/zero-alpha", null, { verbose: true }),
  );

  assert.equal(value, "ranked");
  assert.match(output, /[┌├]  \[exec\] opencode run --format json/);
  assert.match(output, /│  \[stdout\] .*"type":"text"/);
  assert.match(output, /│  \[stderr\] model warning/);
  assert.match(output, /└\n$/);
});

test("callOpencode hides child stderr from normal nonzero failures", async () => {
  const { callOpencode } = await import(
    "../../lib/recommend/fitness/opencode-runner.js"
  );
  nextRunMode = "nonzero";

  const { output } = await captureStdout(async () => {
    await assert.rejects(
      callOpencode("rank this", "opencode/zero-alpha"),
      /opencode exited with code 9$/,
    );
  });

  assert.equal(output, "│  • opencode run --format json --model opencode/zero-alpha\n");
  assert.doesNotMatch(output, /raw opencode failure stderr|\[stderr\]/);
});

test("callOpencode hides child stderr from normal no-text failures", async () => {
  const { callOpencode } = await import(
    "../../lib/recommend/fitness/opencode-runner.js"
  );
  nextRunMode = "no-text";

  const { output } = await captureStdout(async () => {
    await assert.rejects(
      callOpencode("rank this", "opencode/zero-alpha"),
      /opencode returned no text response \(exit 0 \(events: done\)\)$/,
    );
  });

  assert.equal(output, "│  • opencode run --format json --model opencode/zero-alpha\n");
  assert.doesNotMatch(output, /raw opencode no-text stderr|\[stderr\]/);
});
