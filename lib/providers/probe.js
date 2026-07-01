import { spawn } from "node:child_process";
import os from "node:os";
import { LOCAL_PROVIDER } from "../constants.js";
import {
  isProviderAvailable,
  markProviderCreditExhausted,
  markProviderRateLimited,
} from "./state.js";
import {
  isQuotaError,
  isRateLimitError,
  parseRetryAfterSeconds,
} from "./errors.js";

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

function spawnProbeChild(ctx, modelRef, tempDir) {
  return ctx.registerChild(
    spawn(
      "opencode",
      [
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
      ],
      {
        cwd: tempDir,
        env: {
          ...process.env,
          PWD: tempDir,
          INIT_CWD: tempDir,
          TERM: "dumb",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    ),
  );
}

function resolveProbeClose({ code, timedOut, provider, rawError, ctx }) {
  if (timedOut) {
    markProviderRateLimited(ctx, provider, 30, "rate-limited");
    return { ok: false, reason: "timeout", errorOutput: "Request timed out after 30s" };
  }
  if (isRateLimitError(rawError)) {
    const delay = parseRetryAfterSeconds(rawError) || 15;
    markProviderRateLimited(ctx, provider, delay, "rate-limited");
    return { ok: false, reason: "rate-limited", errorOutput: rawError };
  }
  if (isQuotaError(code, rawError)) {
    markProviderCreditExhausted(ctx, provider, "quota-exceeded");
    return { ok: false, reason: "quota-exceeded", errorOutput: rawError };
  }
  if (code !== 0 && code !== null) {
    return { ok: false, reason: `exit-code-${code}`, errorOutput: rawError };
  }
  if (code === null) {
    return {
      ok: false,
      reason: "terminated-by-signal",
      errorOutput: "Process terminated by system signal",
    };
  }
  return { ok: true };
}

export function probeModel(ctx, modelRef, signal = ctx.signal) {
  const slash = modelRef.indexOf("/");
  const provider = slash === -1 ? "" : modelRef.slice(0, slash);
  if (!provider || provider === LOCAL_PROVIDER || isCliProvider(provider)) {
    return Promise.resolve({ ok: true });
  }
  if (!isProviderAvailable(ctx, provider)) {
    return Promise.resolve(unavailableProviderResult(ctx, provider));
  }
  if (signal?.aborted) {
    return Promise.resolve({ ok: false, reason: "aborted", errorOutput: "Aborted by user" });
  }
  if (ctx.providerProbePromises.has(modelRef)) {
    return ctx.providerProbePromises.get(modelRef);
  }

  const promise = new Promise((resolve) => {
    const tempDir = os.tmpdir();
    const child = spawnProbeChild(ctx, modelRef, tempDir);
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGKILL");
      } catch (_e) {}
    }, 30000);
    const abortHandler = () => {
      clearTimeout(timer);
      try {
        child.kill("SIGKILL");
      } catch (_e) {}
      resolve({ ok: false, reason: "aborted", errorOutput: "Aborted by user" });
    };

    signal?.addEventListener("abort", abortHandler, { once: true });
    child.on("error", (err) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abortHandler);
      resolve({ ok: false, reason: `spawn-error: ${err.message}` });
    });
    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abortHandler);
      resolve(resolveProbeClose({
        code,
        timedOut,
        provider,
        rawError: `${stderr}\n${stdout}`.trim(),
        ctx,
      }));
    });
  });

  ctx.providerProbePromises.set(modelRef, promise);
  return promise;
}
