import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test, { mock } from "node:test";

function childFor() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  process.nextTick(() => {
    child.stdout.emit("data", Buffer.from("ranked response\n"));
    child.stderr.emit("data", Buffer.from("cli warning\n"));
    child.emit("close", 0);
  });
  return child;
}

mock.module("node:child_process", {
  namedExports: {
    spawn: mock.fn(() => childFor()),
    execFileSync: mock.fn(() => ""),
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

test("callCliAgent exposes the command and complete streams in verbose mode", async () => {
  const { callCliAgent } = await import("../../lib/recommend/fitness/cli-runner.js");

  const { output, value } = await captureStdout(() =>
    callCliAgent(
      "rank this",
      "agy",
      { omo: { panel_cli_agents: { agy: { model: "agy/high" } } } },
      null,
      { verbose: true },
    ),
  );

  assert.equal(value, "ranked response\n");
  assert.match(output, /┌  \[exec\] agy/);
  assert.match(output, /<prompt:/);
  assert.match(output, /9 chars>/);
  assert.doesNotMatch(output, /rank this/);
  assert.match(output, /│  \[stdout\] ranked response/);
  assert.match(output, /│  \[stderr\] cli warning/);
  assert.match(output, /└\n┌\n│\n$/);
});
