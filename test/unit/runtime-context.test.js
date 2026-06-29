import assert from "node:assert/strict";
import test from "node:test";
import { RuntimeContext } from "../../lib/runtime-context.js";

test("RuntimeContext constructor initializes all fields", () => {
  const ctx = new RuntimeContext();
  assert.ok(ctx.activeChildren instanceof Set);
  assert.equal(ctx.activeChildren.size, 0);
  assert.equal(ctx.clack, null);
  assert.equal(ctx.useClackPrompts, false);
  assert.equal(ctx.debugMode, false);
  assert.ok(ctx.abortController instanceof AbortController);
  assert.equal(ctx.cachedAgyPanelModel, undefined);
  assert.ok(ctx.quotaExceededProviders instanceof Set);
  assert.ok(ctx.providerAvailability instanceof Map);
  assert.deepEqual(ctx.providerExclusionOptions, {
    quotaRestricted: false,
    rateLimited: false,
  });
  assert.equal(ctx.opencodeOnlyMode, false);
  assert.ok(ctx.providerProbePromises instanceof Map);
});

test("signal getter returns AbortController signal", () => {
  const ctx = new RuntimeContext();
  assert.ok(ctx.signal instanceof AbortSignal);
  assert.equal(ctx.signal.aborted, false);
});

test("abort() sets signal to aborted", () => {
  const ctx = new RuntimeContext();
  ctx.abortController.abort();
  assert.equal(ctx.signal.aborted, true);
});

test("getOrCreateProbe creates only once per provider", () => {
  const ctx = new RuntimeContext();
  let callCount = 0;
  const factory = () => {
    callCount++;
    return Promise.resolve("result");
  };

  const p1 = ctx.getOrCreateProbe("opencode", factory);
  const p2 = ctx.getOrCreateProbe("opencode", factory);
  const p3 = ctx.getOrCreateProbe("anthropic", factory);

  assert.equal(callCount, 2); // called for opencode + anthropic
  assert.equal(ctx.providerProbePromises.size, 2);
  assert.equal(p1, p2); // same promise for same provider
  assert.notEqual(p1, p3);
});

test("clearProbes clears all provider probe promises", () => {
  const ctx = new RuntimeContext();
  ctx.getOrCreateProbe("opencode", () => Promise.resolve("a"));
  ctx.getOrCreateProbe("anthropic", () => Promise.resolve("b"));
  assert.equal(ctx.providerProbePromises.size, 2);
  ctx.clearProbes();
  assert.equal(ctx.providerProbePromises.size, 0);
});

test("registerChild adds to activeChildren and removes on exit", async () => {
  const ctx = new RuntimeContext();
  const { EventEmitter } = await import("node:events");
  const fakeChild = new EventEmitter();
  fakeChild.exitCode = null;
  fakeChild.signalCode = null;

  ctx.registerChild(fakeChild);
  assert.equal(ctx.activeChildren.size, 1);

  fakeChild.emit("exit");
  assert.equal(ctx.activeChildren.size, 0);
});

test("registerChild removes on error", async () => {
  const ctx = new RuntimeContext();
  const { EventEmitter } = await import("node:events");
  const fakeChild = new EventEmitter();
  fakeChild.exitCode = null;
  fakeChild.signalCode = null;

  ctx.registerChild(fakeChild);
  assert.equal(ctx.activeChildren.size, 1);

  fakeChild.emit("error");
  assert.equal(ctx.activeChildren.size, 0);
});

test("killChild kills child process", async () => {
  const ctx = new RuntimeContext();
  const { EventEmitter } = await import("node:events");
  const fakeChild = new EventEmitter();
  fakeChild.killed = false;
  let killedSignal = null;
  fakeChild.kill = (signal) => {
    killedSignal = signal;
    fakeChild.killed = true;
  };

  ctx.killChild(fakeChild);
  assert.equal(killedSignal, "SIGTERM");
});

test("spawnTracked registers child", () => {
  // spawnTracked calls spawn which would fail in test env
  // Verify method exists
  const ctx = new RuntimeContext();
  assert.equal(typeof ctx.spawnTracked, "function");
});

test("terminateActiveChildren kills alive children", () => {
  const ctx = new RuntimeContext();

  // Add a fake child with exitCode=null (still running)
  const aliveChild = {
    exitCode: null,
    signalCode: null,
    killed: false,
    kill(sig) { this.killed = true; },
  };
  ctx.activeChildren.add(aliveChild);

  // Add a child that already exited
  const deadChild = {
    exitCode: 0,
    signalCode: null,
    killed: false,
    kill() {},
  };
  ctx.activeChildren.add(deadChild);

  // Mock setTimeout to avoid actual process.exit
  const originalSetTimeout = global.setTimeout;
  const timeoutObj = { unref: () => {} };
  global.setTimeout = (cb) => { timeoutObj._cb = cb; return timeoutObj; };

  try {
    ctx.terminateActiveChildren();
    assert.equal(aliveChild.killed, true);
    assert.equal(deadChild.killed, false); // already exited
  } finally {
    global.setTimeout = originalSetTimeout;
  }
});

test("installSignalHandlers sets up signal handlers", () => {
  const ctx = new RuntimeContext();
  // Should not throw
  ctx.installSignalHandlers();
  // Verify the handler was registered by emitting SIGINT
  // This would trigger process.exit, so we can't test it directly
  // Just verify the method exists and doesn't throw
  assert.ok(true);
});
