import assert from "node:assert/strict";
import test from "node:test";

import { resolveInstallDecisions } from "../../lib/apply-local/decisions.js";

async function captureStdout(fn) {
  const originalWrite = process.stdout.write;
  let stdout = "";
  process.stdout.write = (chunk, ...args) => {
    stdout += String(chunk);
    const callback = args.find((arg) => typeof arg === "function");
    if (callback) callback();
    return true;
  };
  try {
    const value = await fn();
    return { stdout, value };
  } finally {
    process.stdout.write = originalWrite;
  }
}

test("dry-run auto-confirm marks missing locals for preview without pulling", async () => {
  const { stdout, value } = await captureStdout(() =>
    resolveInstallDecisions({
      decisions: [
        { name: "deepseek-r1:8b", action: "install", rationale: "local fallback" },
      ],
      ollama: { models: [] },
      autoYes: true,
      dryRun: true,
    }),
  );

  assert.deepEqual([...value], ["deepseek-r1:8b"]);
  assert.match(stdout, /would install deepseek-r1:8b/);
  assert.doesNotMatch(stdout, /Pulling deepseek-r1:8b/);
});

test("dry-run keeps no-install locals out of preview confirmation set", async () => {
  const { stdout, value } = await captureStdout(() =>
    resolveInstallDecisions({
      decisions: [
        { name: "deepseek-r1:8b", action: "install", rationale: "local fallback" },
      ],
      ollama: { models: [] },
      autoYes: true,
      noInstall: true,
      dryRun: true,
    }),
  );

  assert.deepEqual([...value], []);
  assert.match(stdout, /skipped installation of deepseek-r1:8b via --no-install/);
  assert.doesNotMatch(stdout, /would install deepseek-r1:8b/);
  assert.doesNotMatch(stdout, /Pulling deepseek-r1:8b/);
});
