import assert from "node:assert/strict";
import { spawn as realSpawn } from "node:child_process";
import { EventEmitter, getEventListeners, once } from "node:events";
import test, { mock } from "node:test";

const childFactories = [];

function fakeChild({
  code = 0,
  stdout = "",
  stderr = "",
  close = true,
  exit = true,
  kill,
  killResult = true,
} = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.killed = false;
  child.killCount = 0;
  child.kill = (signal) => {
    child.killed = true;
    child.killCount += 1;
    if (kill) kill(child, signal);
    return killResult;
  };
  process.nextTick(() => {
    if (stdout) child.stdout.emit("data", Buffer.from(stdout));
    if (stderr) child.stderr.emit("data", Buffer.from(stderr));
    if (!close) return;
    child.exitCode = code;
    if (exit) child.emit("exit", code, null);
    child.emit("close", code, null);
  });
  return child;
}

function successfulChild() {
  return fakeChild({
    stdout: `${JSON.stringify({ type: "text", part: { text: "1" } })}\n`,
    stderr: "provider warning\n",
  });
}

const spawnMock = mock.fn((_command, args) => {
  if (args.some((arg) => typeof arg === "string" && arg.includes("\0"))) {
    const error = new TypeError("spawn arguments must not contain null bytes");
    error.code = "ERR_INVALID_ARG_VALUE";
    throw error;
  }
  return (childFactories.shift() || successfulChild)();
});
const execFileSyncMock = mock.fn(() => "");

mock.module("node:child_process", {
  namedExports: {
    execFileSync: execFileSyncMock,
    spawn: spawnMock,
  },
});

function useChild(factory) {
  childFactories.push(factory);
}

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

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function startSleeper(t) {
  const child = realSpawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"]);
  const exitPromise = once(child, "exit");
  t.after(async () => {
    if (isPidAlive(child.pid)) child.kill("SIGKILL");
    await exitPromise;
  });
  return { child, exitPromise };
}

async function startSleeperTree(t) {
  const leader = realSpawn(
    process.execPath,
    [
      "-e",
      [
        "const { spawn } = require('node:child_process');",
        "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
        "process.stdout.write(String(child.pid) + '\\n');",
        "setInterval(() => {}, 1000);",
      ].join(" "),
    ],
    { detached: true, stdio: ["ignore", "pipe", "ignore"] },
  );
  const exitPromise = once(leader, "exit");
  const [pidChunk] = await once(leader.stdout, "data");
  const descendantPid = Number.parseInt(pidChunk.toString().trim(), 10);
  t.after(async () => {
    try {
      process.kill(-leader.pid, "SIGKILL");
    } catch {}
    if (isPidAlive(leader.pid)) leader.kill("SIGKILL");
    await exitPromise;
  });
  return { descendantPid, exitPromise, leader };
}

function memoryPolicyCache(initialRefs = []) {
  const refs = new Set(initialRefs);
  return {
    add(modelRef) {
      refs.add(modelRef);
      return true;
    },
    has: (modelRef) => refs.has(modelRef),
  };
}

test("probeModel reports CLI invocation in normal mode without child streams", async () => {
  const { RuntimeContext } = await import("../../lib/runtime-context.js");
  const { probeModel } = await import("../../lib/providers/probe.js");
  const ctx = new RuntimeContext();

  const { output, value } = await captureStdout(() =>
    probeModel(ctx, "openai/gpt-5.5"),
  );

  assert.deepEqual(value, { ok: true });
  assert.match(output, /^│  • opencode run --pure --agent summary --format json --model openai\/gpt-5\.5/m);
  assert.doesNotMatch(output, /"type":"text"/);
  assert.doesNotMatch(output, /provider warning/);
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
  assert.match(output, /[┌├]  \[exec\] opencode run/);
  assert.match(output, /│  \[stdout\] .*"type":"text"/);
  assert.match(output, /│  \[stderr\] provider warning/);
  assert.match(output, /└\n┌\n│\n$/);
});

test("probeModel rejects NUL model refs before spawn without cached promise residue", async () => {
  const { RuntimeContext } = await import("../../lib/runtime-context.js");
  const { probeModel } = await import("../../lib/providers/probe.js");
  const ctx = new RuntimeContext();
  const modelRef = "google/bad\0ref";
  const callsBefore = spawnMock.mock.callCount();
  let thrown = null;
  let returned;

  try {
    returned = probeModel(ctx, modelRef);
  } catch (error) {
    thrown = { code: error.code, message: error.message };
  }
  const cached = ctx.providerProbePromises.get(modelRef);
  let cachedSettled = cached ? false : null;
  cached?.then(() => { cachedSettled = true; });
  await Promise.resolve();

  assert.deepEqual({
    thrown,
    result: returned ? await returned : null,
    spawnCount: spawnMock.mock.callCount() - callsBefore,
    cacheHas: ctx.providerProbePromises.has(modelRef),
    cachedSettled,
    activeChildren: ctx.activeChildren.size,
  }, {
    thrown: null,
    result: {
      ok: false,
      reason: "invalid-model-ref",
      scope: "model",
      errorOutput: "Model reference contains a null byte",
    },
    spawnCount: 0,
    cacheHas: false,
    cachedSettled: null,
    activeChildren: 0,
  });
});

test("probeModel stops setup after a synchronous reentrant child error", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { RuntimeContext } = await import("../../lib/runtime-context.js");
  const { probeModel } = await import("../../lib/providers/probe.js");
  const ctx = new RuntimeContext();
  const child = fakeChild({ close: false });
  const originalOn = child.on;
  child.on = function on(eventName, listener) {
    const hadErrorTracker = eventName === "error" && this.listenerCount("error") > 0;
    const result = originalOn.call(this, eventName, listener);
    if (hadErrorTracker) listener(new Error("reentrant spawn error"));
    return result;
  };
  let statusCount = 0;
  let settleCount = 0;
  useChild(() => child);

  const resultPromise = probeModel(ctx, "google/reentrant-error", ctx.signal, () => {
    statusCount += 1;
    return "";
  }, { timeoutMs: 25 });
  resultPromise.then(() => { settleCount += 1; });
  const result = await resultPromise;
  t.mock.timers.tick(25);
  await Promise.resolve();

  assert.deepEqual(result, {
    ok: false,
    reason: "spawn-error: reentrant spawn error",
    scope: "model",
  });
  assert.equal(statusCount, 1);
  assert.equal(settleCount, 1);
  assert.equal(child.killCount, 0);
  assert.equal(child.listenerCount("close"), 0);
  assert.equal(child.listenerCount("error"), 0);
  assert.equal(child.listenerCount("exit"), 0);
  assert.equal(child.stdout.listenerCount("data"), 0);
  assert.equal(child.stderr.listenerCount("data"), 0);
  assert.equal(ctx.activeChildren.size, 0);
});

test("probeModel settles when status formatting throws and reports the presentation failure", async () => {
  const { RuntimeContext } = await import("../../lib/runtime-context.js");
  const { probeModel } = await import("../../lib/providers/probe.js");
  const ctx = new RuntimeContext();
  const child = fakeChild({ close: false });
  let statusCount = 0;
  let settleCount = 0;
  let settledResult;
  const stderrChunks = [];
  const originalWrite = process.stderr.write;
  useChild(() => child);

  const resultPromise = probeModel(ctx, "google/formatter-error", ctx.signal, () => {
    statusCount += 1;
    throw new Error("formatter exploded");
  });
  resultPromise.then((result) => {
    settleCount += 1;
    settledResult = result;
  });
  let thrown = null;
  process.stderr.write = (chunk) => {
    stderrChunks.push(String(chunk));
    return true;
  };
  try {
    child.emit("close", 0, null);
  } catch (error) {
    thrown = error.message;
  } finally {
    process.stderr.write = originalWrite;
  }
  await Promise.resolve();

  assert.deepEqual({
    thrown,
    settledResult,
    settleCount,
    statusCount,
    formatterFailureReported: stderrChunks.join("").includes("formatter exploded"),
    cacheHas: ctx.providerProbePromises.has("google/formatter-error"),
  }, {
    thrown: null,
    settledResult: { ok: true },
    settleCount: 1,
    statusCount: 1,
    formatterFailureReported: true,
    cacheHas: true,
  });
});

test("probeModel classifies mixed forbidden policy text without mutating provider state", async () => {
  const { RuntimeContext } = await import("../../lib/runtime-context.js");
  const { probeModel } = await import("../../lib/providers/probe.js");
  const ctx = new RuntimeContext();
  useChild(() => fakeChild({ code: 1, stderr: "request forbidden by data policy" }));

  const result = await probeModel(ctx, "google/policy-model");

  assert.deepEqual(result, {
    ok: false,
    reason: "guardrail-policy-exclusion",
    scope: "model",
    errorOutput: "request forbidden by data policy",
  });
  assert.deepEqual([...ctx.providerAvailability.entries()], []);
  assert.deepEqual([...ctx.quotaExceededProviders], []);
});

test("probeModel keeps rate-limited and successful siblings independent", async () => {
  const { RuntimeContext } = await import("../../lib/runtime-context.js");
  const { probeModel } = await import("../../lib/providers/probe.js");
  const ctx = new RuntimeContext();
  const callsBefore = spawnMock.mock.callCount();
  useChild(() => fakeChild({
    code: 1,
    stderr: "HTTP 429 retry-after: 5; forbidden by data policy; model unavailable; payment required",
  }));
  useChild(() => fakeChild());

  const limited = await probeModel(ctx, "google/limited");
  const sibling = await probeModel(ctx, "google/healthy");

  assert.equal(limited.reason, "rate-limited");
  assert.deepEqual(sibling, { ok: true });
  assert.equal(spawnMock.mock.callCount() - callsBefore, 2);
  assert.deepEqual([...ctx.providerAvailability.entries()], []);
  assert.deepEqual([...ctx.quotaExceededProviders], []);
  assert.equal(limited.scope, "model");
});

test("probeModel treats process exit code 402 alone as an exact-ref generic failure", async () => {
  const { RuntimeContext } = await import("../../lib/runtime-context.js");
  const { probeModel } = await import("../../lib/providers/probe.js");
  const ctx = new RuntimeContext();
  useChild(() => fakeChild({ code: 402 }));

  const result = await probeModel(ctx, "google/exit-402");

  assert.deepEqual(result, {
    ok: false,
    reason: "exit-code-402",
    scope: "model",
    errorOutput: "",
  });
  assert.deepEqual([...ctx.providerAvailability.entries()], []);
  assert.deepEqual([...ctx.quotaExceededProviders], []);
});

test("probeModel marks only strong textual exhaustion as provider-wide without state mutation", async () => {
  const { RuntimeContext } = await import("../../lib/runtime-context.js");
  const { probeModel } = await import("../../lib/providers/probe.js");
  const ctx = new RuntimeContext();
  useChild(() => fakeChild({ code: 1, stderr: 'upstream statusCode: "402"' }));

  const result = await probeModel(ctx, "google/billing-exhausted");

  assert.deepEqual(result, {
    ok: false,
    reason: "quota-exceeded",
    scope: "provider",
    errorOutput: 'upstream statusCode: "402"',
  });
  assert.deepEqual([...ctx.providerAvailability.entries()], []);
  assert.deepEqual([...ctx.quotaExceededProviders], []);
});

test("probeModel maps ambiguous quota text to exact-ref auth failure", async () => {
  const { RuntimeContext } = await import("../../lib/runtime-context.js");
  const { probeModel } = await import("../../lib/providers/probe.js");
  const ctx = new RuntimeContext();
  useChild(() => fakeChild({ code: 1, stderr: "quota exceeded for this request" }));

  const result = await probeModel(ctx, "google/ambiguous-quota");

  assert.deepEqual(result, {
    ok: false,
    reason: "auth-failed",
    scope: "model",
    errorOutput: "quota exceeded for this request",
  });
  assert.deepEqual([...ctx.providerAvailability.entries()], []);
  assert.deepEqual([...ctx.quotaExceededProviders], []);
});

test("probeModel classifies model-unavailable before ambiguous auth text", async () => {
  const { RuntimeContext } = await import("../../lib/runtime-context.js");
  const { probeModel } = await import("../../lib/providers/probe.js");
  const ctx = new RuntimeContext();
  useChild(() => fakeChild({
    code: 1,
    stderr: "model deployment unavailable; unauthorized",
  }));

  const result = await probeModel(ctx, "google/missing-model");

  assert.deepEqual(result, {
    ok: false,
    reason: "model-unavailable",
    scope: "model",
    errorOutput: "model deployment unavailable; unauthorized",
  });
});

test("probeModel maps null close code to an exact-ref signal failure", async () => {
  const { RuntimeContext } = await import("../../lib/runtime-context.js");
  const { probeModel } = await import("../../lib/providers/probe.js");
  const ctx = new RuntimeContext();
  useChild(() => fakeChild({ code: null }));

  const result = await probeModel(ctx, "google/signaled");

  assert.deepEqual(result, {
    ok: false,
    reason: "terminated-by-signal",
    scope: "model",
    errorOutput: "Process terminated by system signal",
  });
});

test("probeModel timeout settles once when killed child never closes", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { RuntimeContext } = await import("../../lib/runtime-context.js");
  const { probeModel } = await import("../../lib/providers/probe.js");
  const ctx = new RuntimeContext();
  const callsBefore = spawnMock.mock.callCount();
  const child = fakeChild({
    close: false,
    stderr: "HTTP 429; forbidden by data policy; model unavailable; payment required",
  });
  let statusCount = 0;
  let settleCount = 0;
  useChild(() => child);

  const resultPromise = probeModel(
    ctx,
    "google/no-close",
    ctx.signal,
    () => {
      statusCount += 1;
      return "timeout status";
    },
    { timeoutMs: 25 },
  );
  resultPromise.then(() => { settleCount += 1; });
  await new Promise((resolve) => process.nextTick(resolve));
  t.mock.timers.tick(25);
  const result = await resultPromise;
  await Promise.resolve();

  assert.equal(settleCount, 1);
  assert.deepEqual(result, {
    ok: false,
    reason: "timeout",
    scope: "model",
    errorOutput: "Request timed out after 25ms",
  });
  assert.equal(statusCount, 1);
  assert.equal(child.killCount, 1);
  assert.equal(ctx.activeChildren.size, 0);
  assert.equal(getEventListeners(ctx.signal, "abort").length, 0);
  assert.equal(child.listenerCount("close"), 0);
  assert.equal(child.listenerCount("error"), 0);
  assert.equal(child.listenerCount("exit"), 0);
  assert.equal(child.stdout.listenerCount("data"), 0);
  assert.equal(child.stderr.listenerCount("data"), 0);

  useChild(() => fakeChild());
  assert.deepEqual(await probeModel(ctx, "google/after-timeout"), { ok: true });
  assert.equal(spawnMock.mock.callCount() - callsBefore, 2);
  assert.deepEqual([...ctx.providerAvailability.entries()], []);
  assert.deepEqual([...ctx.quotaExceededProviders], []);
});

test("probeModel timeout escalates a false child kill and confirms PID death", { timeout: 2000 }, async (t) => {
  const { RuntimeContext } = await import("../../lib/runtime-context.js");
  const { probeModel } = await import("../../lib/providers/probe.js");
  const { child: sleeper, exitPromise } = startSleeper(t);
  const ctx = new RuntimeContext();
  const child = fakeChild({ close: false, killResult: false });
  child.pid = sleeper.pid;
  let statusCount = 0;
  let settleCount = 0;
  useChild(() => child);

  const resultPromise = probeModel(ctx, "google/false-kill", ctx.signal, () => {
    statusCount += 1;
    return "";
  }, { timeoutMs: 25 });
  resultPromise.then(() => { settleCount += 1; });
  const result = await resultPromise;
  await Promise.resolve();
  const aliveAtSettlement = isPidAlive(sleeper.pid);

  assert.deepEqual(result, {
    ok: false,
    reason: "timeout",
    scope: "model",
    errorOutput: "Request timed out after 25ms",
  });
  assert.equal(aliveAtSettlement, false);
  assert.equal(statusCount, 1);
  assert.equal(settleCount, 1);
  assert.equal(child.killCount, 1);
  assert.equal(ctx.activeChildren.size, 0);
  await exitPromise;
});

test("probeModel timeout confirms PID death after a successful child kill", { timeout: 2000 }, async (t) => {
  const { RuntimeContext } = await import("../../lib/runtime-context.js");
  const { probeModel } = await import("../../lib/providers/probe.js");
  const { child: sleeper, exitPromise } = startSleeper(t);
  const ctx = new RuntimeContext();
  const child = fakeChild({
    close: false,
    kill(_current, signal) {
      sleeper.kill(signal);
    },
  });
  child.pid = sleeper.pid;
  let statusCount = 0;
  let settleCount = 0;
  useChild(() => child);

  const resultPromise = probeModel(ctx, "google/successful-kill", ctx.signal, () => {
    statusCount += 1;
    return "";
  }, { timeoutMs: 25 });
  resultPromise.then(() => { settleCount += 1; });
  const result = await resultPromise;
  await Promise.resolve();
  const aliveAtSettlement = isPidAlive(sleeper.pid);
  await exitPromise;

  assert.deepEqual(result, {
    ok: false,
    reason: "timeout",
    scope: "model",
    errorOutput: "Request timed out after 25ms",
  });
  assert.equal(aliveAtSettlement, false);
  assert.equal(statusCount, 1);
  assert.equal(settleCount, 1);
  assert.equal(child.killCount, 1);
  assert.equal(ctx.activeChildren.size, 0);
});

test("probeModel timeout kills a spawned probe process group before settlement", { timeout: 2000 }, async (t) => {
  const { RuntimeContext } = await import("../../lib/runtime-context.js");
  const { probeModel } = await import("../../lib/providers/probe.js");
  const { descendantPid, exitPromise, leader } = await startSleeperTree(t);
  const ctx = new RuntimeContext();
  const child = fakeChild({
    close: false,
    kill(_current, signal) {
      leader.kill(signal);
    },
  });
  child.pid = leader.pid;
  useChild(() => child);

  const result = await probeModel(
    ctx,
    "google/process-tree-timeout",
    ctx.signal,
    null,
    { timeoutMs: 25 },
  );
  const aliveAtSettlement = {
    descendant: isPidAlive(descendantPid),
    leader: isPidAlive(leader.pid),
  };
  await exitPromise;

  assert.deepEqual(result, {
    ok: false,
    reason: "timeout",
    scope: "model",
    errorOutput: "Request timed out after 25ms",
  });
  assert.deepEqual(aliveAtSettlement, { descendant: false, leader: false });
  assert.equal(ctx.activeChildren.size, 0);
});

test("probeModel abort wins over synchronous child error and close and settles once", async () => {
  const { RuntimeContext } = await import("../../lib/runtime-context.js");
  const { probeModel } = await import("../../lib/providers/probe.js");
  const ctx = new RuntimeContext();
  let statusCount = 0;
  let settleCount = 0;
  const child = fakeChild({
    close: false,
    kill(current) {
      current.emit("error", new Error("kill raced with child error"));
      current.emit("close", null, "SIGKILL");
    },
  });
  useChild(() => child);
  const resultPromise = probeModel(ctx, "google/abort-race", ctx.signal, () => {
    statusCount += 1;
    return "abort status";
  });
  resultPromise.then(() => { settleCount += 1; });

  ctx.abortController.abort();
  const result = await resultPromise;
  await Promise.resolve();

  assert.deepEqual(result, {
    ok: false,
    reason: "aborted",
    scope: "model",
    errorOutput: "Aborted by user",
  });
  assert.equal(settleCount, 1);
  assert.equal(statusCount, 1);
  assert.equal(child.killCount, 1);
  assert.equal(ctx.activeChildren.size, 0);
  assert.equal(getEventListeners(ctx.signal, "abort").length, 0);
  assert.equal(child.listenerCount("close"), 0);
  assert.equal(child.listenerCount("error"), 0);
  assert.equal(child.listenerCount("exit"), 0);
});

test("probeModel spawn error settles once and unregisters the child", async () => {
  const { RuntimeContext } = await import("../../lib/runtime-context.js");
  const { probeModel } = await import("../../lib/providers/probe.js");
  const ctx = new RuntimeContext();
  let statusCount = 0;
  const child = fakeChild({ close: false });
  useChild(() => {
    process.nextTick(() => child.emit("error", new Error("ENOENT opencode")));
    return child;
  });

  const result = await probeModel(ctx, "google/spawn-error", ctx.signal, () => {
    statusCount += 1;
    return "spawn error status";
  });

  assert.deepEqual(result, {
    ok: false,
    reason: "spawn-error: ENOENT opencode",
    scope: "model",
  });
  assert.equal(statusCount, 1);
  assert.equal(ctx.activeChildren.size, 0);
  assert.equal(getEventListeners(ctx.signal, "abort").length, 0);
});

test("runProviderProbes prints every final record template and exact aggregate arithmetic", async () => {
  const { RuntimeContext } = await import("../../lib/runtime-context.js");
  const { runProviderProbes } = await import(
    "../../lib/recommend/providers/probe-orchestration.js"
  );
  const ctx = new RuntimeContext();
  ctx.policyExclusionCache = memoryPolicyCache(["google/cached"]);
  const eligibleRefs = [
    "google/cached",
    "google/available",
    "google/policy",
    "google/limited",
    "google/skipped-after-limit",
  ];
  const results = new Map([
    ["google/policy", {
      ok: false,
      reason: "guardrail-policy-exclusion",
      scope: "model",
    }],
    ["google/limited", { ok: false, reason: "rate-limited", scope: "model", errorOutput: "Retry-After: 30" }],
  ]);

  const { output, value: probes } = await captureStdout(async () => {
    const value = await runProviderProbes({
      ctx,
      eligibleRefs,
      probeConcurrency: { global: 1, perProvider: 1 },
      probeModelFn: async (_ctx, modelRef) => results.get(modelRef) || { ok: true },
    });
    await value.ensureProbesAwaited();
    return value;
  });

  assert.equal(output, [
    "◇  Probing 5 model(s) across AI providers...",
    "✗  model: google/cached on provider: google is guardrail-policy-exclusion (cached)",
    "✓  model: google/available on provider: google is available",
    "✗  model: google/policy on provider: google is guardrail-policy-exclusion",
    "✗  model: google/limited on provider: google is rate limited",
    "✗  model: google/skipped-after-limit on provider: google is rate limited (not probed after provider exhaustion)",
    "◇  Cloud model verification complete: 5 eligible; 3 probed, 1 available, 2 failed, 1 cached, 1 skipped",
    "",
  ].join("\n"));
  assert.equal(
    output.includes("Loaded:") ||
      /verified \d+\/\d+|Cloud provider verification|~30s/.test(output),
    false,
  );
  const records = await probes.probeRecordsPromise;
  const probed = records.filter((record) => record.spawned).length;
  const cached = records.filter((record) => record.outcome === "cached-policy").length;
  const skipped = records.filter((record) => record.outcome.startsWith("skipped-")).length;
  const available = records.filter((record) => record.outcome === "available").length;
  const failed = records.filter((record) => record.outcome === "failed").length;
  assert.equal(eligibleRefs.length, probed + cached + skipped);
  assert.equal(probed, available + failed);
});

test("runProviderProbes reports final eligibility after strong provider exhaustion", async () => {
  const { RuntimeContext } = await import("../../lib/runtime-context.js");
  const { runProviderProbes } = await import(
    "../../lib/recommend/providers/probe-orchestration.js"
  );
  const ctx = new RuntimeContext();

  const { output } = await captureStdout(async () => {
    const probes = await runProviderProbes({
      ctx,
      eligibleRefs: [
        "google/ok-before",
        "google/quota",
        "google/after-quota",
      ],
      probeModelFn: async (_ctx, modelRef) => modelRef === "google/quota"
        ? { ok: false, reason: "quota-exceeded", scope: "provider" }
        : { ok: true },
    });
    await probes.ensureProbesAwaited();
  });

  assert.equal(output, [
    "◇  Probing 3 model(s) across AI providers...",
    "✗  model: google/ok-before on provider: google is provider-quota-exhausted",
    "✗  model: google/quota on provider: google is quota-exceeded",
    "✗  model: google/after-quota on provider: google is quota-exceeded (not probed after provider exhaustion)",
    "◇  Cloud model verification complete: 3 eligible; 2 probed, 0 available, 2 failed, 0 cached, 1 skipped",
    "",
  ].join("\n"));
  assert.doesNotMatch(output, /is available|2 available|3 available/);
});
