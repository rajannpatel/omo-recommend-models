import test from "node:test";
import assert from "node:assert/strict";

import { createCliRuntime } from "../../lib/cli-runtime.js";
import { RuntimeContext } from "../../lib/runtime-context.js";

test("createCliRuntime owns context and subprocess runner", () => {
  const runtime = createCliRuntime();

  assert.ok(runtime.ctx);
  assert.ok(runtime.subprocess);
  assert.equal(runtime.subprocess.ctx, runtime.ctx);
  assert.equal(runtime.ctx.debugMode, false);
});

test("configureTerminalUi is a no-op plain prompt hook", async () => {
  const runtime = createCliRuntime();

  await runtime.configureTerminalUi(true);

  assert.equal(runtime.ctx.debugMode, false);
});

test("createCliRuntime forwards the signal-handler disposer", (t) => {
  const runtime = createCliRuntime();
  const before = {
    SIGINT: process.listenerCount("SIGINT"),
    SIGTERM: process.listenerCount("SIGTERM"),
  };
  const dispose = runtime.installSignalHandlers();
  t.after(() => runtime.ctx.disposeSignalHandlers?.());

  assert.equal(typeof dispose, "function");
  dispose();
  assert.equal(process.listenerCount("SIGINT"), before.SIGINT);
  assert.equal(process.listenerCount("SIGTERM"), before.SIGTERM);
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
  assert.doesNotMatch(lines.join("\n"), /\n\s+at /);
});

test("handleFatalError hides child stderr unless verbose or debug is enabled", (t) => {
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

  const error = new Error("command failed");
  error.stderr = "raw child stderr\n";
  runtime.handleFatalError(error);

  assert.equal(process.exitCode, 1);
  assert.match(lines.join("\n"), /command failed/);
  assert.doesNotMatch(lines.join("\n"), /raw child stderr/);

  lines.length = 0;
  runtime.ctx.verboseMode = true;
  runtime.handleFatalError(error);

  assert.match(lines.join("\n"), /raw child stderr/);
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

test("runRecommendModelsCli disposes signal handlers after normal completion", async () => {
  const { runRecommendModelsCli } = await import("../../lib/cli/recommend-models.js");
  const ctx = new RuntimeContext();
  const events = [];
  const runtime = {
    ctx,
    subprocess: {},
    installSignalHandlers() {
      events.push("install");
      return () => events.push("dispose");
    },
    async configureTerminalUi() {},
  };

  await runRecommendModelsCli(["--dry-run", "--local-only"], {
    runtime,
    createPolicyExclusionCache: () => ({ has: () => false }),
    buildRecommendationInputs: async () => ({}),
    selectRecommendation: async () => null,
  });

  assert.deepEqual(events, ["install", "dispose"]);
});

test("runRecommendModelsCli disposes signal handlers after failure", async () => {
  const { runRecommendModelsCli } = await import("../../lib/cli/recommend-models.js");
  const ctx = new RuntimeContext();
  const events = [];
  const expected = new Error("discovery failed");
  const runtime = {
    ctx,
    subprocess: {},
    installSignalHandlers() {
      events.push("install");
      return () => events.push("dispose");
    },
    async configureTerminalUi() {},
  };

  await assert.rejects(
    runRecommendModelsCli(["--dry-run", "--local-only"], {
      runtime,
      createPolicyExclusionCache: () => ({ has: () => false }),
      buildRecommendationInputs: async () => {
        throw expected;
      },
    }),
    expected,
  );

  assert.deepEqual(events, ["install", "dispose"]);
});
