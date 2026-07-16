import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test, { mock } from "node:test";

let failNextChild = false;

function childFor() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  process.nextTick(() => {
    if (failNextChild) {
      failNextChild = false;
      child.stderr.emit("data", Buffer.from("raw cli failure stderr\n"));
      child.emit("close", 7);
      return;
    }
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
  assert.match(output, /[┌├]  \[exec\] agy/);
  assert.match(output, /<prompt:/);
  assert.match(output, /9 chars>/);
  assert.doesNotMatch(output, /rank this/);
  assert.match(output, /│  \[stdout\] ranked response/);
  assert.match(output, /│  \[stderr\] cli warning/);
  assert.match(output, /└\n$/);
});

test("callCliAgent reports masked normal status for agy without streams", async () => {
  const { callCliAgent } = await import("../../lib/recommend/fitness/cli-runner.js");

  const { output, value } = await captureStdout(() =>
    callCliAgent(
      "rank this secret prompt",
      "agy",
      { omo: { panel_cli_agents: { agy: {} } } },
      null,
    ),
  );

  assert.equal(value, "ranked response\n");
  assert.match(output, /│  • agy models\n/);
  assert.match(output, /│  • agy --dangerously-skip-permissions --print "<prompt: 23 chars>"\n/);
  assert.doesNotMatch(output, /rank this secret prompt|ranked response|cli warning|\[stdout\]|\[stderr\]/);
});

test("callCliAgent reports masked normal status for codex without streams", async () => {
  const { callCliAgent } = await import("../../lib/recommend/fitness/cli-runner.js");

  const { output, value } = await captureStdout(() =>
    callCliAgent(
      "rank this secret prompt",
      "codex",
      { omo: { panel_cli_agents: { codex: { model: "codex/high" } } } },
      null,
    ),
  );

  assert.equal(value, "ranked response\n");
  assert.match(output, /│  • codex exec --model codex\/high --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox --color never "<prompt: 23 chars>"\n/);
  assert.doesNotMatch(output, /rank this secret prompt|ranked response|cli warning|\[stdout\]|\[stderr\]/);
});

test("callCliAgent hides child stderr from normal failure messages", async () => {
  const { callCliAgent } = await import("../../lib/recommend/fitness/cli-runner.js");
  failNextChild = true;

  const { output } = await captureStdout(async () => {
    await assert.rejects(
      callCliAgent(
        "rank this secret prompt",
        "codex",
        { omo: { panel_cli_agents: { codex: { model: "codex/high" } } } },
        null,
      ),
      /codex exited with code 7$/,
    );
  });

  assert.match(output, /│  • codex exec --model codex\/high/);
  assert.doesNotMatch(output, /raw cli failure stderr|rank this secret prompt|\[stderr\]/);
});
