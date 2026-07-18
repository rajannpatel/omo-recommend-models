import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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

function fetchWithTimeout(url, options, timeoutMs, parentSignal) {
  const controller = new AbortController();
  const { signal } = controller;

  const onParentAbort = () => {
    controller.abort();
  };

  if (parentSignal) {
    if (parentSignal.aborted) {
      return Promise.reject(new Error("Aborted by user"));
    }
    parentSignal.addEventListener("abort", onParentAbort);
  }

  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  return fetch(url, { ...options, signal })
    .finally(() => {
      clearTimeout(timer);
      if (parentSignal) {
        parentSignal.removeEventListener("abort", onParentAbort);
      }
    });
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function opencodeAuthFilePath(env) {
  const dataHome = nonEmptyString(env.XDG_DATA_HOME) || path.join(os.homedir(), ".local", "share");
  return path.join(dataHome, "opencode", "auth.json");
}

export function getApiKeyForProvider(provider, env = process.env) {
  try {
    const authPath = opencodeAuthFilePath(env);
    if (fs.existsSync(authPath)) {
      const authData = JSON.parse(fs.readFileSync(authPath, "utf8"));
      if (provider === "openrouter") {
        const credential = authData?.openrouter;
        if (credential?.type === "api") return nonEmptyString(credential.key);
        if (credential?.type === "oauth") return nonEmptyString(credential.access);
        const key = authData?.openrouter?.key || authData?.openrouter?.apiKey || authData?.providers?.openrouter?.apiKey;
        if (key) return nonEmptyString(key);
      } else if (provider === "openai") {
        const credential = authData?.openai;
        if (credential) {
          if (typeof credential === "string") return nonEmptyString(credential);
          if (credential.key) return nonEmptyString(credential.key);
          if (credential.apiKey) return nonEmptyString(credential.apiKey);
          if (credential.type === "api") return nonEmptyString(credential.key);
          if (credential.type === "oauth") return nonEmptyString(credential.access);
        }
        const key = authData?.providers?.openai?.apiKey || authData?.providers?.openai?.key;
        if (key) return nonEmptyString(key);
        
        const fallbackKey = Object.values(authData).find(v => typeof v === "string" && v.startsWith("sk-"));
        if (fallbackKey) return nonEmptyString(fallbackKey);
      } else if (provider === "google") {
        const credential = authData?.google;
        if (credential) {
          if (typeof credential === "string") return nonEmptyString(credential);
          if (credential.key) return nonEmptyString(credential.key);
          if (credential.apiKey) return nonEmptyString(credential.apiKey);
          if (credential.type === "api") return nonEmptyString(credential.key);
          if (credential.type === "oauth") return nonEmptyString(credential.access);
        }
        const key = authData?.providers?.google?.apiKey || authData?.providers?.google?.key;
        if (key) return nonEmptyString(key);
      }
    }
  } catch (error) {
    // ignore parsing/reading errors
  }

  if (provider === "openai") {
    const key = nonEmptyString(env.OPENAI_API_KEY);
    if (key) return key;
  } else if (provider === "google") {
    const key = nonEmptyString(env.GEMINI_API_KEY) || nonEmptyString(env.GOOGLE_API_KEY);
    if (key) return key;
  } else if (provider === "openrouter") {
    const key = nonEmptyString(env.OPENROUTER_API_KEY) || nonEmptyString(env.OPENROUTER_BEARER);
    if (key) return key;
  }

  return null;
}

export function classifyDirectError(provider, status, statusText, data) {
  const dataStr = JSON.stringify(data);
  const lowerStr = dataStr.toLowerCase();
  const rawError = `HTTP ${status} ${statusText}\n${dataStr}`;

  // 1. Quota Exhaustion checks
  if (provider === "openai") {
    if (status === 429 && data?.error?.code === "insufficient_quota") {
      return { ok: false, reason: "quota-exceeded", scope: "provider", errorOutput: rawError };
    }
  } else if (provider === "google") {
    if ((status === 429 || status === 400) && (lowerStr.includes("resource_exhausted") || lowerStr.includes("resource has been exhausted") || lowerStr.includes("quota exceeded") || lowerStr.includes("quota_exceeded"))) {
      return { ok: false, reason: "quota-exceeded", scope: "provider", errorOutput: rawError };
    }
  } else if (provider === "openrouter") {
    if (status === 402 || lowerStr.includes("payment required") || lowerStr.includes("payment_required") || lowerStr.includes("credit exhaustion") || lowerStr.includes("credit exhausted") || (status === 429 && (lowerStr.includes("budget") || lowerStr.includes("limit exceeded")))) {
      return { ok: false, reason: "quota-exceeded", scope: "provider", errorOutput: rawError };
    }
  }

  // 2. Authentication/Forbidden checks
  if (status === 401 || status === 403 || lowerStr.includes("invalid_api_key") || lowerStr.includes("invalid api key") || lowerStr.includes("incorrect api key")) {
    return { ok: false, reason: "auth-failed", scope: "model", errorOutput: rawError };
  }

  // 3. Model Unavailable checks
  if (status === 404 || lowerStr.includes("model_not_found") || lowerStr.includes("not found") || lowerStr.includes("does not exist") || lowerStr.includes("not available")) {
    return { ok: false, reason: "model-unavailable", scope: "model", errorOutput: rawError };
  }

  // 4. Rate Limit checks
  if (status === 429 || lowerStr.includes("rate_limit") || lowerStr.includes("rate limit") || lowerStr.includes("too many requests")) {
    return { ok: false, reason: "rate-limited", scope: "model", errorOutput: rawError };
  }

  // 5. Fallback generic exit code
  return { ok: false, reason: `exit-code-${status}`, scope: "model", errorOutput: rawError };
}

export async function runDirectProbe(ctx, provider, modelRef, apiKey, signal, timeoutMs) {
  const slash = modelRef.indexOf("/");
  const modelId = slash === -1 ? modelRef : modelRef.slice(slash + 1);

  let url = "";
  let headers = {};
  let body = {};

  if (provider === "openai") {
    url = "https://api.openai.com/v1/chat/completions";
    headers = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    };
    body = {
      model: modelId || "gpt-4o-mini",
      messages: [{ role: "user", content: "1" }],
      max_tokens: 1,
    };
  } else if (provider === "google") {
    url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId || "gemini-1.5-flash"}:generateContent?key=${apiKey}`;
    headers = {
      "Content-Type": "application/json",
    };
    body = {
      contents: [{ parts: [{ text: "1" }] }],
    };
  } else if (provider === "openrouter") {
    url = "https://openrouter.ai/api/v1/chat/completions";
    headers = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    };
    body = {
      model: modelId || "google/gemini-2.5-flash",
      messages: [{ role: "user", content: "1" }],
      max_tokens: 1,
    };
  } else {
    throw new Error(`Unsupported provider for direct probe: ${provider}`);
  }

  try {
    const response = await fetchWithTimeout(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }, timeoutMs, signal);

    let data;
    try {
      data = await response.json();
    } catch {
      data = {};
    }

    if (response.ok) {
      return { ok: true };
    }

    return classifyDirectError(provider, response.status, response.statusText, data);
  } catch (err) {
    if (err.name === "AbortError" || err.message === "Aborted by user") {
      return {
        ok: false,
        reason: "aborted",
        scope: "model",
        errorOutput: "Aborted by user",
      };
    }
    throw err;
  }
}

function runTraditionalProbe(
  ctx,
  modelRef,
  signal,
  statusFormatter,
  timeoutMs,
  resolveProbe,
) {
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
  if (settled || forcedResult) return;
  child.on("error", errorHandler);
  if (settled || forcedResult) return;
  child.stdout.on("data", stdoutHandler);
  if (settled || forcedResult) return;
  child.stderr.on("data", stderrHandler);
  if (settled || forcedResult) return;
  child.on("close", closeHandler);
  if (settled || forcedResult) return;
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

  const providerApiKey = getApiKeyForProvider(provider);
  const isTesting = process.execArgv.some(arg => arg.startsWith("--test")) || process.env.NODE_ENV === "test";
  const forceDirect = process.env.OMO_RECOMMEND_TEST_FORCE_DIRECT === "true";

  if (providerApiKey && (!isTesting || forceDirect)) {
    if (!ctx.verboseMode) {
      writeGroupLine(`• direct probe model: ${modelRef}`);
    }
    runDirectProbe(ctx, provider, modelRef, providerApiKey, signal, timeoutMs)
      .then((res) => {
        resolveProbe(res);
      })
      .catch(() => {
        runTraditionalProbe(ctx, modelRef, signal, statusFormatter, timeoutMs, resolveProbe);
      });
  } else {
    runTraditionalProbe(ctx, modelRef, signal, statusFormatter, timeoutMs, resolveProbe);
  }

  return promise;
}

