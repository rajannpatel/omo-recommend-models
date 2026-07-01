import os from "node:os";
import {
  discoverFreeModels as discoverFreeModelsFromShared,
  parseAiJson,
} from "../../omo-shared.js";
import { normalizeAgentRec } from "../../display-utils.js";
import {
  compactErrorText,
  isProviderAvailable,
  isQuotaError,
  isRateLimitError,
  markProviderCreditExhausted,
  markProviderRateLimited,
  parseRetryAfterSeconds,
} from "../../probe-providers.js";
import {
  PANEL_FIRST_BYTE_TIMEOUT_SECONDS,
  PANEL_MODEL_TIMEOUT_SECONDS,
} from "./timeouts.js";

export function extractOpencodeText(stdout) {
  const texts = [];
  for (const line of stdout.trim().split("\n")) {
    try {
      const evt = JSON.parse(line);
      if (evt.type === "text" && evt.part && evt.part.text) {
        texts.push(evt.part.text);
      }
    } catch (_) {}
  }
  return texts.join("") || null;
}

export async function callPanelModelAsync(
  model,
  prompt,
  signal,
  statusRef,
  subprocess,
) {
  const tempDir = os.tmpdir();
  const stdout = await subprocess.execAsync("opencode", [
    "run", "--pure", "--agent", "summary",
    "--dir", tempDir, "--format", "json",
    "--model", model,
    "--dangerously-skip-permissions",
    prompt,
  ], {
    cwd: tempDir,
    env: { PWD: tempDir, INIT_CWD: tempDir },
    firstByteTimeoutMs: PANEL_FIRST_BYTE_TIMEOUT_SECONDS * 1000,
    totalTimeoutMs: PANEL_MODEL_TIMEOUT_SECONDS * 1000,
    signal,
    statusRef,
  });

  if (!stdout) return null;
  if (statusRef?.stderr) {
    const rawError = `${statusRef.stderr || ""}\n${stdout}`;
    if (isQuotaError(null, rawError)) {
      statusRef.quotaExceeded = true;
      statusRef.creditExhausted = true;
      if (!statusRef.failReason) statusRef.failReason = "quota-exceeded";
      statusRef.stderr = compactErrorText(statusRef.stderr || stdout);
    }
    if (isRateLimitError(rawError)) {
      statusRef.rateLimited = true;
      statusRef.retryAfter =
        parseRetryAfterSeconds(rawError) || statusRef.retryAfter || 15;
      if (!statusRef.failReason) statusRef.failReason = "rate-limited";
      statusRef.stderr = compactErrorText(statusRef.stderr || stdout);
    }
  }

  const text = extractOpencodeText(stdout);
  if (!text && statusRef) statusRef.failReason = "empty-text";
  return text;
}

export function findCliAgent(cliAgents, ref) {
  return (cliAgents || []).find((agent) => agent.ref === ref) || null;
}

export async function cleanAiResponse(raw, signal, subprocess, statusRef) {
  const models = discoverFreeModelsFromShared();
  if (models.length === 0) return null;
  const prompt = [
    "Extract ONLY the JSON object from the text below.",
    "If there are multiple JSON objects return the LARGEST one.",
    "Return valid JSON and nothing else. No markdown fences. No explanation.",
    "",
    raw,
  ].join("\n");
  try {
    statusRef?.onQueryProgress?.(1, 1, "cleanup");
    const result = await callPanelModelAsync(models[0], prompt, signal, {}, subprocess);
    return result || null;
  } catch (_) {
    return null;
  }
}

function normalizeParsedRecommendation(parsed, agentName) {
  if (parsed && !parsed.name && agentName) parsed.name = agentName;
  const rec = normalizeAgentRec(parsed);
  if (!rec || !rec.name || (rec.model !== null && (!rec.model.provider || !rec.model.model))) {
    return null;
  }
  return rec;
}

async function parsedModelResponse(raw, signal, subprocess, agentName, statusRef) {
  let parsed = null;
  try {
    parsed = parseAiJson(raw);
  } catch (_) {}
  if (
    !parsed ||
    !parsed.name ||
    (parsed.model !== null && parsed.model !== undefined && (!parsed.model.provider || !parsed.model.model))
  ) {
    const cleaned = await cleanAiResponse(raw, signal, subprocess, statusRef);
    if (cleaned) {
      try {
        parsed = parseAiJson(cleaned);
      } catch (_) {}
    }
  }
  return normalizeParsedRecommendation(parsed, agentName);
}

export async function callModelForAgent(
  model,
  prompt,
  signal,
  statusRef,
  cliModels,
  agentName,
  maxRetries = 3,
  ctx,
  subprocess,
) {
  if (model.startsWith("cli/")) {
    const cliAgent = (cliModels || []).find((agent) => agent.ref === model);
    if (!cliAgent) return null;
    statusRef?.onQueryProgress?.(1, 1, "cli call");
    const parsed = await cliAgent.call(prompt);
    return parsed ? normalizeParsedRecommendation(parsed, agentName) : null;
  }

  const provider = model.split("/")[0];
  if (!isProviderAvailable(ctx, provider)) {
    if (statusRef) {
      const state = ctx.providerAvailability.get(provider);
      statusRef.failReason = state?.creditExhausted ? "quota-exceeded" : "rate-limited";
      statusRef.stderr = `Skipped: provider unavailable (${statusRef.failReason})`;
    }
    return null;
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    statusRef?.onQueryProgress?.(attempt, maxRetries, "model call");
    const raw = await callPanelModelAsync(model, prompt, signal, statusRef, subprocess);
    if (raw) return parsedModelResponse(raw, signal, subprocess, agentName, statusRef);
    if (statusRef?.quotaExceeded) {
      markProviderCreditExhausted(ctx, provider, statusRef.failReason);
      return null;
    }
    if (!statusRef?.rateLimited) return null;

    const delay = statusRef.retryAfter || 15;
    markProviderRateLimited(ctx, provider, delay, statusRef.failReason);
    if (statusRef) {
      statusRef.failReason = `rate-limited retry ${attempt}/${maxRetries} (${delay}s)`;
    }
    await new Promise((resolve) => setTimeout(resolve, delay * 1000));
    if (statusRef) {
      statusRef.rateLimited = false;
      statusRef.retryAfter = null;
      statusRef.failReason = null;
    }
  }
  return null;
}
