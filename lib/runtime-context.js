import { spawn } from "node:child_process";

/**
 * Encapsulates all runtime mutable state for omo-recommend-models.
 * Previously these were module-level singletons that blocked extraction.
 * Instantiated once in main() and threaded via dependency injection.
 */
export class RuntimeContext {
  constructor() {
    this.activeChildren = new Set();
    this.clack = null;
    this.useClackPrompts = false;
    this.debugMode = false;
    this.abortController = new AbortController();
    this.cachedAgyPanelModel = undefined;
    this.quotaExceededProviders = new Set();
    this.providerAvailability = new Map();
    this.providerExclusionOptions = { quotaRestricted: true, rateLimited: true };
    this.opencodeOnlyMode = false;
    this.providerProbePromises = new Map();
  }

  get signal() {
    return this.abortController.signal;
  }

  registerChild(child) {
    this.activeChildren.add(child);
    child.once("exit", () => this.activeChildren.delete(child));
    child.once("error", () => this.activeChildren.delete(child));
    return child;
  }

  spawnTracked(command, args, options) {
    return this.registerChild(spawn(command, args, options));
  }

  terminateActiveChildren() {
    const alive = [...this.activeChildren].filter(
      (child) => child.exitCode === null && child.signalCode === null,
    );
    for (const child of alive) {
      try {
        child.kill("SIGTERM");
      } catch {}
    }
    setTimeout(() => {
      for (const child of alive) {
        if (child.exitCode === null && child.signalCode === null) {
          try {
            child.kill("SIGKILL");
          } catch {}
        }
      }
      process.exit(1);
    }, 2000).unref();
  }

  installSignalHandlers() {
    let handlingSignal = false;
    const handler = (signal) => {
      if (handlingSignal) return;
      handlingSignal = true;
      process.stderr.write(`\n${signal} received; terminating subprocesses...\n`);
      this.abortController.abort();
      this.terminateActiveChildren();
    };
    process.once("SIGINT", handler);
    process.once("SIGTERM", handler);
  }

  killChild(child) {
    try {
      if (!child.killed) child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, 5000).unref();
    } catch (_) {}
  }

  getOrCreateProbe(provider, factory) {
    if (!this.providerProbePromises.has(provider)) {
      this.providerProbePromises.set(provider, factory());
    }
    return this.providerProbePromises.get(provider);
  }

  clearProbes() {
    this.providerProbePromises.clear();
  }
}
