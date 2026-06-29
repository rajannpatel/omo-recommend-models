import test from "node:test";
import assert from "node:assert/strict";

import { createCliRuntime } from "../../lib/cli-runtime.js";

test("createCliRuntime owns context and subprocess runner", () => {
  const runtime = createCliRuntime();

  assert.ok(runtime.ctx);
  assert.ok(runtime.subprocess);
  assert.equal(runtime.subprocess.ctx, runtime.ctx);
  assert.equal(runtime.ctx.debugMode, false);
});

test("configureTerminalUi leaves prompts disabled when false", async () => {
  const runtime = createCliRuntime();

  await runtime.configureTerminalUi(false);

  assert.equal(runtime.ctx.useClackPrompts, false);
  assert.equal(runtime.ctx.clack, null);
});

test("handleFatalError sets failure exit code and hides stack unless debug is enabled", (t) => {
  const runtime = createCliRuntime();
  const originalError = console.error;
  const originalExitCode = process.exitCode;
  const lines = [];
  console.error = (line) => lines.push(String(line));
  process.exitCode = 0;
  t.after(() => {
    console.error = originalError;
    process.exitCode = originalExitCode;
  });

  const error = new Error("bad input");
  runtime.handleFatalError(error);

  assert.equal(process.exitCode, 1);
  assert.match(lines.join("\n"), /bad input/);
  assert.doesNotMatch(lines.join("\n"), /Error: bad input/);
});

test("handleFatalError prints stack when debug is enabled", (t) => {
  const runtime = createCliRuntime();
  runtime.ctx.debugMode = true;
  const originalError = console.error;
  const originalExitCode = process.exitCode;
  const lines = [];
  console.error = (line) => lines.push(String(line));
  process.exitCode = 0;
  t.after(() => {
    console.error = originalError;
    process.exitCode = originalExitCode;
  });

  runtime.handleFatalError(new Error("debug failure"));

  assert.match(lines.join("\n"), /Error: debug failure/);
});
