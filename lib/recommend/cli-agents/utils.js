import { execFileSync } from "node:child_process";
import { normalizeAgentRec } from "../../display-utils.js";
import { compactErrorText } from "../../probe-providers.js";

export function normalizeCliModelLine(line) {
  return String(line || "")
    .replace(/\x1b\[[0-9;]*m/g, "")
    .trim();
}

export function rankAgyModel(line) {
  const lower = normalizeCliModelLine(line).toLowerCase();
  if (!lower) return Number.POSITIVE_INFINITY;
  if (lower.includes("(low)") || lower.endsWith(" low") || lower.includes("budget") || lower.includes("cheap")) return 0;
  if (lower.includes("tiny") || lower.includes("mini") || lower.includes("small") || lower.includes("lite") || lower.includes("nano")) return 1;
  if (lower.includes("(medium)") || lower.endsWith(" medium") || lower.includes("standard") || lower.includes("base")) return 2;
  if (lower.includes("(high)") || lower.endsWith(" high") || lower.includes("pro") || lower.includes("plus") || lower.includes("advanced")) return 3;
  if (lower.includes("large") || lower.includes("max") || lower.includes("ultra") || lower.includes("opus") || lower.includes("sonnet")) return 4;
  if (lower.includes("xxl") || lower.includes("70b") || lower.includes("405b") || lower.includes("giant")) return 5;
  return 6;
}

export function resolveAgyPanelModel(ctx) {
  if (ctx.cachedAgyPanelModel !== undefined) return ctx.cachedAgyPanelModel;
  if (process.env.OMO_AGY_PANEL_MODEL) return process.env.OMO_AGY_PANEL_MODEL;
  try {
    const raw = execFileSync("agy", ["models"], {
      encoding: "utf-8",
      timeout: 10000,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, TERM: "dumb" },
    });
    const models = raw
      .split("\n")
      .map((line) => normalizeCliModelLine(line))
      .filter(Boolean);
    models.sort((a, b) => rankAgyModel(a) - rankAgyModel(b) || a.localeCompare(b));
    ctx.cachedAgyPanelModel = models[0] || "";
  } catch {
    ctx.cachedAgyPanelModel = "";
  }
  return ctx.cachedAgyPanelModel;
}

export function configuredCliPanelModel(config, id) {
  return String(config?.omo?.panel_cli_agents?.[id]?.model || "").trim();
}

export function parseAndValidateCliResponse(raw, fallbackName = "") {
  let parsed = null;
  try {
    const jsonMatch = String(raw || "").match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
  if (parsed && !parsed.name && fallbackName) parsed.name = fallbackName;
  const rec = normalizeAgentRec(parsed);
  if (!rec || !rec.name) return null;
  if (rec.model !== null && (!rec.model.provider || !rec.model.model)) return null;
  return rec;
}

export function renderCliCommand(command, prompt) {
  if (Array.isArray(command)) {
    const rendered = command.map((part) => String(part).replaceAll("{prompt}", prompt));
    if (!rendered.some((part) => part.includes(prompt))) rendered.push(prompt);
    return rendered;
  }
  const args = String(command || "").trim().split(/\s+/).filter(Boolean);
  if (args.length === 0) return [];
  const promptIdx = args.findIndex((arg) => arg.includes("{prompt}"));
  if (promptIdx === -1) args.push(prompt);
  else args[promptIdx] = args[promptIdx].replace("{prompt}", prompt);
  return args;
}

export function inferCliBinary(entry, id) {
  if (entry?.binary) return String(entry.binary).trim();
  const command = entry?.command;
  if (Array.isArray(command)) return String(command[0] || id).trim();
  return String(command || id).trim().split(/\s+/)[0];
}

export function classifyCliFailure(output) {
  const lower = String(output || "").toLowerCase();
  if (
    lower.includes("429") ||
    lower.includes("rate limit") ||
    lower.includes("rate_limit") ||
    lower.includes("too many requests") ||
    lower.includes("too_many_requests")
  ) {
    return "rate-limited";
  }
  if (
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
    lower.includes("budget exhausted")
  ) {
    return "quota-exceeded";
  }
  return "process-error";
}

async function invokeCliCommand(cmd, options, subprocessRunner, statusRef) {
  if (subprocessRunner?.execAsync) {
    const output = await subprocessRunner.execAsync(cmd[0], cmd.slice(1), {
      ...options,
      firstByteTimeoutMs: options.timeout,
      totalTimeoutMs: options.timeout,
      statusRef,
    });
    return output === null ? null : output;
  }
  return execFileSync(cmd[0], cmd.slice(1), options);
}

export function buildCliInvoker(adapter, subprocess) {
  return async (prompt, statusRef = {}) => {
    const cmd = adapter.command(prompt);
    if (!cmd) return { ok: false, reason: "missing-command", errorOutput: "" };
    const options = {
      encoding: "utf-8",
      timeout: 120000,
      maxBuffer: 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, TERM: "dumb" },
    };
    try {
      const raw = await invokeCliCommand(cmd, options, subprocess, statusRef);
      if (raw === null) {
        return {
          ok: false,
          reason: statusRef.failReason || "process-error",
          errorOutput: statusRef.stderr || "",
        };
      }
      if (
        statusRef.failReason ||
        statusRef.signalCode ||
        (statusRef.exitCode !== undefined && statusRef.exitCode !== null && statusRef.exitCode !== 0)
      ) {
        const errorOutput = compactErrorText(`${statusRef.stderr || ""}\n${raw}`);
        return {
          ok: false,
          reason: statusRef.failReason || classifyCliFailure(errorOutput),
          errorOutput,
        };
      }
      return { ok: true, output: raw };
    } catch (error) {
      const stdout = error?.stdout ? String(error.stdout) : "";
      const stderr = error?.stderr ? String(error.stderr) : "";
      const errorOutput = compactErrorText(`${stderr}\n${stdout}`) || error?.message || "";
      return { ok: false, reason: classifyCliFailure(errorOutput), errorOutput };
    }
  };
}

export function isExcludedCliId(id, options) {
  return (
    (id === "codex" && options.excludeCodex) ||
    (id === "agy" && options.excludeAgy) ||
    (id === "opencode" && options.excludeOpencode)
  );
}
