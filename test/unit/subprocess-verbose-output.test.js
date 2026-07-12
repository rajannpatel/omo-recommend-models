import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test, { mock } from "node:test";

function asyncChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {};
  process.nextTick(() => {
    child.stdout.emit("data", Buffer.from("response body\n"));
    child.stderr.emit("data", Buffer.from("curl warning\n"));
    child.emit("close", 0, null);
  });
  return child;
}

mock.module("node:child_process", {
  namedExports: {
    execFileSync: mock.fn(() => "sync body\n"),
    spawn: mock.fn(() => asyncChild()),
    spawnSync: mock.fn((_command, args) =>
      args.includes("--fail")
        ? { status: 1, stdout: "failure body\n", stderr: "failure warning\n" }
        : { status: 0, stdout: "sync body\n", stderr: "" },
    ),
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

test("SubprocessRunner reports complete synchronous and asynchronous streams in verbose mode", async () => {
  const { RuntimeContext } = await import("../../lib/runtime-context.js");
  const { SubprocessRunner } = await import("../../lib/subprocess.js");
  const ctx = new RuntimeContext();
  ctx.verboseMode = true;
  const runner = new SubprocessRunner(ctx);

  const sync = await captureStdout(() => runner.execSync("curl", ["-s", "https://example.test"]));
  assert.equal(sync.value, "sync body\n");
  assert.match(sync.output, /┌  \[exec\] curl -s https:\/\/example\.test/);
  assert.match(sync.output, /│  \[stdout\] sync body/);
  assert.match(sync.output, /└\n┌\n│\n$/);

  const asyncResult = await captureStdout(() =>
    runner.execAsync("curl", ["-s", "https://example.test"]),
  );
  assert.equal(asyncResult.value, "response body\n");
  assert.match(asyncResult.output, /│  \[stdout\] response body/);
  assert.match(asyncResult.output, /│  \[stderr\] curl warning/);
  assert.match(asyncResult.output, /└\n┌\n│\n$/);
});

test("execFileSyncWithVerbose reports failed synchronous streams once", async () => {
  const { RuntimeContext } = await import("../../lib/runtime-context.js");
  const { execFileSyncWithVerbose } = await import("../../lib/subprocess.js");
  const ctx = new RuntimeContext();
  ctx.verboseMode = true;

  const { output } = await captureStdout(() => {
    assert.throws(() => execFileSyncWithVerbose(ctx, "tool", ["--fail"]));
  });

  assert.equal((output.match(/\[stdout\] failure body/g) || []).length, 1);
  assert.equal((output.match(/\[stderr\] failure warning/g) || []).length, 1);
});
