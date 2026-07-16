import { spawn } from "node:child_process";
import os from "node:os";
import { LOCAL_PROVIDER } from "../constants.js";
import { writeGroupLine, writeTopLevelLine } from "../display/progress.js";
import { createVerboseSubprocessReporter } from "../display/subprocess-output.js";
import { isProviderAvailable } from "./state.js";
import {
  isQuotaError,
  isRateLimitError,
  isGuardrailOrPolicyError,
  isModelUnavailableError,
  isTrueQuotaExhaustion,
} from "./errors.js";

const PROCESS_EXIT_CONFIRMATION_MS = 1000;
const PROCESS_EXIT_POLL_MS = 5;
const detachedProbeChildren = new WeakSet();

function isCliProvider(provider) {
  return provider === "cli/codex" || provider === "cli/agy";
}

function unavailableProviderResult(ctx, provider) {
  const state = ctx.providerAvailability.get(provider);
  const reason = state?.creditExhausted
    ? "quota-exceeded"
    : state?.rateLimitedUntil && state.rateLimitedUntil > Date.now()
      ? "rate-limited"
      : "provider-unavailable";
  return { ok: false, reason };
}

function probeArgs(modelRef, tempDir) {
  return [
    "run",
    "--pure",
    "--agent",
    "summary",
    "--dir",
    tempDir,
    "--format",
    "json",
    "--model",
    modelRef,
    "--dangerously-skip-permissions",
    "say 1",
  ];
}

function spawnProbeChild(ctx, args, tempDir) {
  const detached = process.platform !== "win32";
  const child = spawn(
    "opencode",
    args,
    {
      cwd: tempDir,
      detached,
      env: {
        ...process.env,
        PWD: tempDir,
        INIT_CWD: tempDir,
        TERM: "dumb",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (detached) detachedProbeChildren.add(child);
  return ctx.registerChild(child);
}

function probeChildPid(child) {
  return Number.isInteger(child.pid) && child.pid > 0 && child.pid !== process.pid
    ? child.pid
    : null;
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

function isProbeProcessGroupAlive(child, pid) {
  if (!detachedProbeChildren.has(child)) return false;
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

async function terminateProbeChild(child) {
  let signalSent = false;
  try {
    signalSent = child.kill("SIGKILL") !== false;
  } catch (_error) {}

  const pid = probeChildPid(child);
  if (!pid) return;
  if (detachedProbeChildren.has(child)) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch (_error) {}
  }
  if (!signalSent) {
    try {
      process.kill(pid, "SIGKILL");
    } catch (_error) {}
  }

  const deadline = Date.now() + PROCESS_EXIT_CONFIRMATION_MS;
  while (
    (isProcessAlive(pid) || isProbeProcessGroupAlive(child, pid)) &&
    Date.now() < deadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, PROCESS_EXIT_POLL_MS));
  }
}

function resolveProbeClose({ code, timedOut, rawError, timeoutMs }) {
  if (timedOut) {
    const duration = timeoutMs % 1000 === 0 ? `${timeoutMs / 1000}s` : `${timeoutMs}ms`;
    return {
      ok: false,
      reason: "timeout",
      scope: "model",
      errorOutput: `Request timed out after ${duration}`,
    };
  }
  if (isRateLimitError(rawError)) {
    return { ok: false, reason: "rate-limited", scope: "model", errorOutput: rawError };
  }
  if (isGuardrailOrPolicyError(rawError)) {
    return {
      ok: false,
      reason: "guardrail-policy-exclusion",
      scope: "model",
      errorOutput: rawError,
    };
  }
  if (isModelUnavailableError(rawError)) {
    return { ok: false, reason: "model-unavailable", scope: "model", errorOutput: rawError };
  }
  if (isTrueQuotaExhaustion(null, rawError)) {
    return { ok: false, reason: "quota-exceeded", scope: "provider", errorOutput: rawError };
  }
  if (isQuotaError(null, rawError)) {
    return { ok: false, reason: "auth-failed", scope: "model", errorOutput: rawError };
  }
  if (code !== 0 && code !== null) {
    return { ok: false, reason: `exit-code-${code}`, scope: "model", errorOutput: rawError };
  }
  if (code === null) {
    return {
      ok: false,
      reason: "terminated-by-signal",
      scope: "model",
      errorOutput: "Process terminated by system signal",
    };
  }
  return { ok: true };
}

export function probeModel(
  ctx,
  modelRef,
  signal = ctx.signal,
  statusFormatter = null,
  { timeoutMs = 30000 } = {},
) {
  if (typeof modelRef !== "string") {
    return Promise.resolve({
      ok: false,
      reason: "invalid-model-ref",
      scope: "model",
      errorOutput: "Model reference must be a string",
    });
  }
  if (modelRef.includes("\0")) {
    return Promise.resolve({
      ok: false,
      reason: "invalid-model-ref",
      scope: "model",
      errorOutput: "Model reference contains a null byte",
    });
  }
  const slash = modelRef.indexOf("/");
  const provider = slash === -1 ? "" : modelRef.slice(0, slash);
  if (!provider || provider === LOCAL_PROVIDER || isCliProvider(provider)) {
    return Promise.resolve({ ok: true });
  }
  if (!isProviderAvailable(ctx, provider)) {
    return Promise.resolve(unavailableProviderResult(ctx, provider));
  }
  if (signal?.aborted) {
    return Promise.resolve({
      ok: false,
      reason: "aborted",
      scope: "model",
      errorOutput: "Aborted by user",
    });
  }
  if (ctx.providerProbePromises.has(modelRef)) {
    return ctx.providerProbePromises.get(modelRef);
  }

  // Deferred pattern: cache the promise BEFORE spawning so any concurrent
  // caller finds the entry immediately, eliminating any TOCTOU window.
  let resolveProbe;
  const promise = new Promise((resolve) => { resolveProbe = resolve; });
  ctx.providerProbePromises.set(modelRef, promise);

  const tempDir = os.tmpdir();
  const args = probeArgs(modelRef, tempDir);
  const reporter = createVerboseSubprocessReporter({
    enabled: ctx.verboseMode,
    command: "opencode",
    args,
  });
  const child = spawnProbeChild(ctx, args, tempDir);
  
  if (!ctx.verboseMode) {
    writeGroupLine(`• opencode run --pure --agent summary --format json --model ${modelRef}`);
  }
  
  let stdout = "";
  let stderr = "";
  let timedOut = false;
  let eventCount = 0;
  let settled = false;
  let forcedResult = null;
  let terminationPromise = null;
  let timer;

  const finish = (result) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    signal?.removeEventListener("abort", abortHandler);
    child.removeAllListeners("close");
    child.removeAllListeners("error");
    child.removeAllListeners("exit");
    child.stdout.removeListener("data", stdoutHandler);
    child.stderr.removeListener("data", stderrHandler);
    ctx.activeChildren.delete(child);
    resolveProbe(result);
    try {
      const statusMsg = statusFormatter ? statusFormatter(result) : "";
      if (ctx.verboseMode) {
        reporter.finish(statusMsg);
      } else {
        reporter.finish();
        if (statusMsg) writeTopLevelLine(statusMsg);
      }
      if (ctx.debugMode && !ctx.verboseMode && eventCount > 0) {
        writeGroupLine(`[complete] probe ${modelRef}: ${eventCount} events`);
      }
    } catch (error) {
      try {
        process.stderr.write(
          `[probe] unable to report status for ${modelRef}: ${error?.message || String(error)}\n`,
        );
      } catch (_reportError) {}
    }
  };

  const terminateAndFinish = (result) => {
    if (settled || terminationPromise) return;
    forcedResult = result;
    terminationPromise = terminateProbeChild(child);
    terminationPromise.then(
      () => finish(result),
      () => finish(result),
    );
  };
  const abortHandler = () => {
    terminateAndFinish({
      ok: false,
      reason: "aborted",
      scope: "model",
      errorOutput: "Aborted by user",
    });
  };
  const errorHandler = (err) => {
    if (forcedResult) return;
    reporter.stderr(err.message);
    finish({
      ok: false,
      reason: `spawn-error: ${err.message}`,
      scope: "model",
    });
  };
  const stdoutHandler = (d) => {
    const raw = d.toString();
    stdout += raw;
    reporter.stdout(raw);
    eventCount++;
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        if (ctx.debugMode && !ctx.verboseMode && event.type === "text" && event.part?.text) {
          const preview = event.part.text.slice(0, 100);
          writeGroupLine(`[event:text] ${preview}${preview.length < event.part.text.length ? "..." : ""}`);
        } else if (ctx.debugMode && !ctx.verboseMode && event.type === "error") {
          writeGroupLine(`[event:error] ${JSON.stringify(event).slice(0, 200)}`);
        }
      } catch { /* non-JSON line — ignore */ }
    }
  };
  const stderrHandler = (d) => {
    const raw = d.toString();
    stderr += raw;
    reporter.stderr(raw);
  };
  const closeHandler = (code) => {
    if (forcedResult) return;
    const result = resolveProbeClose({
      code,
      timedOut,
      rawError: `${stderr}\n${stdout}`.trim(),
      timeoutMs,
    });
    finish(result);
  };

  signal?.addEventListener("abort", abortHandler, { once: true });
  if (settled || forcedResult) return promise;
  child.on("error", errorHandler);
  if (settled || forcedResult) return promise;
  child.stdout.on("data", stdoutHandler);
  if (settled || forcedResult) return promise;
  child.stderr.on("data", stderrHandler);
  if (settled || forcedResult) return promise;
  child.on("close", closeHandler);
  if (settled || forcedResult) return promise;
  timer = setTimeout(() => {
    timedOut = true;
    const result = resolveProbeClose({
      code: child.exitCode,
      timedOut,
      rawError: `${stderr}\n${stdout}`.trim(),
      timeoutMs,
    });
    terminateAndFinish(result);
  }, timeoutMs);

  return promise;
}
