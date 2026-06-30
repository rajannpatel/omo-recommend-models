import { spawn } from "node:child_process";
import os from "node:os";
import { LOCAL_PROVIDER } from "./constants.js";

/**
 * Returns the provider state object from ctx.providerAvailability,
 * creating a default entry if missing.
 */
export function providerState(ctx, provider) {
  if (!ctx.providerAvailability.has(provider)) {
    ctx.providerAvailability.set(provider, {
      creditExhausted: false,
      rateLimitedUntil: 0,
      reason: null,
    });
  }
  return ctx.providerAvailability.get(provider);
}

/**
 * Checks if a provider is available considering:
 * - LOCAL_PROVIDER/ollama/cli always return true
 * - opencodeOnlyMode
 * - quotaRestricted exclusion
 * - rateLimited exclusion
 */
export function isProviderAvailable(ctx, provider, now = Date.now()) {
  if (!provider || provider === LOCAL_PROVIDER || provider === "ollama" || isCliProvider(provider))
    return true;
  if (ctx.opencodeOnlyMode && provider !== "opencode")
    return false;
  if (
    ctx.providerExclusionOptions.quotaRestricted &&
    ctx.quotaExceededProviders.has(provider)
  )
    return false;
  const state = ctx.providerAvailability.get(provider);
  if (!state) return true;
  if (ctx.providerExclusionOptions.quotaRestricted && state.creditExhausted)
    return false;
  if (
    ctx.providerExclusionOptions.rateLimited &&
    state.rateLimitedUntil &&
    state.rateLimitedUntil > now
  )
    return false;
  return true;
}

/**
 * Returns true if ctx.providerExclusionOptions.quotaRestricted or rateLimited is set.
 */
export function shouldProbeProviderAvailability(ctx) {
  return (
    ctx.providerExclusionOptions.quotaRestricted ||
    ctx.providerExclusionOptions.rateLimited
  );
}

/**
 * Adds provider to ctx.quotaExceededProviders and sets state.creditExhausted = true.
 */
export function markProviderCreditExhausted(ctx, provider, reason) {
  if (!provider) return;
  ctx.quotaExceededProviders.add(provider);
  const state = providerState(ctx, provider);
  state.creditExhausted = true;
  state.reason = reason || "credit-exhausted";
}

/**
 * Sets state.rateLimitedUntil based on retryAfterSeconds.
 */
export function markProviderRateLimited(ctx, provider, retryAfterSeconds, reason) {
  if (!provider) return;
  const state = providerState(ctx, provider);
  const delayMs = Math.max(1, Number(retryAfterSeconds) || 15) * 1000;
  state.rateLimitedUntil = Math.max(
    state.rateLimitedUntil || 0,
    Date.now() + delayMs,
  );
  state.reason = reason || "rate-limited";
}

/**
 * Async function that spawns `opencode run --pure --agent summary` as a subprocess
 * to probe whether a model is available.
 */
export function probeModel(ctx, modelRef, signal = ctx.signal) {
  const slash = modelRef.indexOf("/");
  const provider = slash === -1 ? "" : modelRef.slice(0, slash);
  if (!provider || provider === LOCAL_PROVIDER || provider === "opencode" || isCliProvider(provider)) {
    return Promise.resolve({ ok: true });
  }

  if (!isProviderAvailable(ctx, provider)) {
    const state = ctx.providerAvailability.get(provider);
    const reason = state?.creditExhausted
      ? "quota-exceeded"
      : state?.rateLimitedUntil && state.rateLimitedUntil > Date.now()
        ? "rate-limited"
        : "provider-unavailable";
    return Promise.resolve({ ok: false, reason });
  }

  // Check if already aborted
  if (signal?.aborted) {
    return Promise.resolve({ ok: false, reason: "aborted", errorOutput: "Aborted by user" });
  }

  if (ctx.providerProbePromises.has(modelRef)) {
    return ctx.providerProbePromises.get(modelRef);
  }

  const promise = new Promise((resolve) => {
    const tempDir = os.tmpdir();
    const child = ctx.registerChild(
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
        }
      )
    );

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGKILL");
      } catch (_e) {}
    }, 30000);

    // Handle abort signal
    const abortHandler = () => {
      clearTimeout(timer);
      try {
        child.kill("SIGKILL");
      } catch (_e) {}
      resolve({ ok: false, reason: "aborted", errorOutput: "Aborted by user" });
    };
    if (signal) {
      signal.addEventListener("abort", abortHandler, { once: true });
    }

    child.on("error", (err) => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", abortHandler);
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
      if (signal) signal.removeEventListener("abort", abortHandler);
      if (timedOut) {
        markProviderRateLimited(ctx, provider, 30, "rate-limited");
        resolve({ ok: false, reason: "timeout", errorOutput: "Request timed out after 30s" });
        return;
      }

      const rawError = (stderr + "\n" + stdout).trim();
      const lower = rawError.toLowerCase();

      if (
        lower.includes("429") ||
        lower.includes("rate limit") ||
        lower.includes("rate_limit") ||
        lower.includes("too many requests") ||
        lower.includes("too_many_requests")
      ) {
        const delay = parseRetryAfterSeconds(rawError) || 15;
        markProviderRateLimited(ctx, provider, delay, "rate-limited");
        resolve({ ok: false, reason: "rate-limited", errorOutput: rawError });
        return;
      }

      if (
        code === 402 ||
        lower.includes("402") ||
        lower.includes("payment required") ||
        lower.includes("payment_required") ||
        lower.includes("quota exceeded") ||
        lower.includes("quota_exceeded") ||
        lower.includes("billing limit") ||
        lower.includes("billing_limit") ||
        lower.includes("credit limit") ||
        lower.includes("credit_limit") ||
        lower.includes("insufficient funds") ||
        lower.includes("insufficient_funds") ||
        lower.includes("usage limit") ||
        lower.includes("budget exceeded") ||
        lower.includes("budget exhausted") ||
        lower.includes("quota restricted") ||
        lower.includes("credit expired") ||
        lower.includes("credits expired") ||
        lower.includes("unauthorized") ||
        lower.includes("forbidden") ||
        lower.includes("invalid api key") ||
        lower.includes("invalid_api_key") ||
        lower.includes("key invalid") ||
        lower.includes("access denied") ||
        lower.includes("exhausted") ||
        lower.includes("restricted") ||
        lower.includes("limit exceeded") ||
        lower.includes("limit_exceeded")
      ) {
        markProviderCreditExhausted(ctx, provider, "quota-exceeded");
        resolve({ ok: false, reason: "quota-exceeded", errorOutput: rawError });
        return;
      }

      if (code !== 0 && code !== null) {
        resolve({ ok: false, reason: `exit-code-${code}`, errorOutput: rawError });
        return;
      }

      if (code === null) {
        resolve({ ok: false, reason: "terminated-by-signal", errorOutput: "Process terminated by system signal" });
        return;
      }

      resolve({ ok: true });
    });
  });

  ctx.providerProbePromises.set(modelRef, promise);
  return promise;
}

/**
 * Pure regex-based parser for Retry-After headers.
 * Returns seconds as number or null.
 */
export function parseRetryAfterSeconds(text) {
  const raw = String(text || "");
  const numericPatterns = [
    /retry-after["']?\s*[:=]\s*["']?(\d+)/i,
    /retry_after["']?\s*[:=]\s*["']?(\d+)/i,
    /retryAfter["']?\s*[:=]\s*["']?(\d+)/i,
    /x-ratelimit-reset["']?\s*[:=]\s*["']?(\d+)/i,
    /x-rate-limit-reset["']?\s*[:=]\s*["']?(\d+)/i,
  ];
  for (const pattern of numericPatterns) {
    const match = raw.match(pattern);
    if (!match) continue;
    const value = Number.parseInt(match[1], 10);
    if (!Number.isFinite(value)) continue;
    if (pattern.source.includes("reset") && value > 1000000000) {
      return Math.max(1, value - Math.floor(Date.now() / 1000));
    }
    return Math.max(1, value);
  }

  const dateMatch = raw.match(/retry-after["']?\s*[:=]\s*["']?([^"'\r\n]+)/i);
  if (dateMatch) {
    const ts = Date.parse(dateMatch[1].trim());
    if (Number.isFinite(ts))
      return Math.max(1, Math.ceil((ts - Date.now()) / 1000));
  }
  return null;
}

/**
 * Strips ANSI codes, takes last 3 non-empty lines, joins with space.
 */
export function compactErrorText(text) {
  return (text || "")
    .replace(/\x1b\[[0-9;]*m/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-3)
    .join(" ");
}

/**
 * Helper to check if a provider is a CLI provider.
 * This is used by isProviderAvailable and probeModel.
 */
function isCliProvider(provider) {
  return provider === "cli/codex" || provider === "cli/agy";
}
