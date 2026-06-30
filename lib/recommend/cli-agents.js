/**
 * cli-agents.js — AI CLI agent discovery for panel model participation.
 *
 * Extracted from bin/omo-recommend-models (L382-427, L760-984). Discovers
 * AI CLI agents (codex, agy, configured panel_cli_agents) available on
 * PATH that can participate alongside provider-backed panel models.
 */

import { execFileSync } from "node:child_process";
import { splitModelRef } from "../omo-shared.js";
import { normalizeAgentRec } from "../display-utils.js";
import { compactErrorText } from "../probe-providers.js";
import {
  MAX_PANEL_MODELS,
} from "../constants.js";
import {
  uniqueModelRefs,
  hasPanelCandidateShapeAndContext,
  selectDiversePanelModels,
} from "./panel-candidates.js";

// ---------------------------------------------------------------------------
// CLI model line helpers
// ---------------------------------------------------------------------------

export function normalizeCliModelLine(line) {
  return String(line || "")
    .replace(/\x1b\[[0-9;]*m/g, "")
    .trim();
}

export function rankAgyModel(line) {
  const lower = normalizeCliModelLine(line).toLowerCase();
  if (!lower) return Number.POSITIVE_INFINITY;

  // Generic tier detection from model name/description patterns
  if (lower.includes("(low)") || lower.endsWith(" low") || lower.includes("budget") || lower.includes("cheap")) return 0;
  if (lower.includes("tiny") || lower.includes("mini") || lower.includes("small") || lower.includes("lite") || lower.includes("nano")) return 1;
  if (lower.includes("(medium)") || lower.endsWith(" medium") || lower.includes("standard") || lower.includes("base")) return 2;
  if (lower.includes("(high)") || lower.endsWith(" high") || lower.includes("pro") || lower.includes("plus") || lower.includes("advanced")) return 3;
  if (lower.includes("large") || lower.includes("max") || lower.includes("ultra") || lower.includes("opus") || lower.includes("sonnet")) return 4;
  if (lower.includes("xxl") || lower.includes("70b") || lower.includes("405b") || lower.includes("giant")) return 5;
  return 6;
}

/**
 * Resolve the agy panel model by checking cache, env var, then running
 * `agy models` and picking the lowest-tier model.
 */
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
    return ctx.cachedAgyPanelModel;
  } catch {
    ctx.cachedAgyPanelModel = "";
    return ctx.cachedAgyPanelModel;
  }
}

export function configuredCliPanelModel(config, id) {
  return String(config?.omo?.panel_cli_agents?.[id]?.model || "").trim();
}

// ---------------------------------------------------------------------------
// CLI agent discovery
// ---------------------------------------------------------------------------

/**
 * Discover AI CLI agents available on PATH that can be queried for
 * recommendations alongside panel models. Returns an array of
 * { ref, call } where ref is like "cli/codex" and call is
 * an async function(prompt) => parsed JSON or null.
 */
export function discoverCliModels(config = {}, options = {}, ctx, commandExistsFn, subprocess) {
  const { excludeCodex, excludeAgy, excludeOpencode } = options;
  const agents = [];

  function isExcludedCliId(id) {
    return (
      (id === "codex" && excludeCodex) ||
      (id === "agy" && excludeAgy) ||
      (id === "opencode" && excludeOpencode)
    );
  }

  function parseCliJson(raw) {
    const jsonMatch = String(raw || "").match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    return JSON.parse(jsonMatch[0]);
  }

  function parseAndValidateCliResponse(raw, fallbackName = "") {
    let parsed = null;
    try {
      parsed = parseCliJson(raw);
    } catch {
      return null;
    }
    if (parsed && !parsed.name && fallbackName) {
      parsed.name = fallbackName;
    }
    const rec = normalizeAgentRec(parsed);
    if (!rec || !rec.name) return null;
    if (rec.model !== null && (!rec.model.provider || !rec.model.model)) {
      return null;
    }
    return rec;
  }

  function renderCliCommand(command, prompt) {
    if (Array.isArray(command)) {
      const rendered = command.map((part) =>
        String(part).replaceAll("{prompt}", prompt),
      );
      if (!rendered.some((part) => part.includes(prompt))) rendered.push(prompt);
      return rendered;
    }
    const raw = String(command || "").trim();
    if (!raw) return [];
    // Convert string command to args array (never use shell exec)
    const args = raw.split(/\s+/);
    const promptIdx = args.findIndex((a) => a.includes("{prompt}"));
    if (promptIdx !== -1) {
      args[promptIdx] = args[promptIdx].replace("{prompt}", prompt);
    } else {
      args.push(prompt);
    }
    return args;
  }

  function inferCliBinary(entry, id) {
    if (entry?.binary) return String(entry.binary).trim();
    const command = entry?.command;
    if (Array.isArray(command)) return String(command[0] || id).trim();
    return String(command || id).trim().split(/\s+/)[0];
  }

  function compactCliFailure(error) {
    const stdout = error?.stdout ? String(error.stdout) : "";
    const stderr = error?.stderr ? String(error.stderr) : "";
    return compactErrorText(`${stderr}\n${stdout}`) || error?.message || "";
  }

  function classifyCliFailure(output) {
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

  function buildCliInvoker(adapter) {
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
          (statusRef.exitCode !== undefined &&
            statusRef.exitCode !== null &&
            statusRef.exitCode !== 0)
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
        const errorOutput = compactCliFailure(error);
        return {
          ok: false,
          reason: classifyCliFailure(errorOutput),
          errorOutput,
        };
      }
    };
  }

  const cliAdapters = [];
  if (!excludeCodex) {
    const codexPanelModel = configuredCliPanelModel(config, "codex");
    cliAdapters.push({
      binary: "codex",
      ref: "cli/codex",
      panelModel: codexPanelModel,
      command: (prompt) =>
        [
          "codex",
          "exec",
          ...(codexPanelModel ? ["--model", codexPanelModel] : []),
          "--skip-git-repo-check",
          "--dangerously-bypass-approvals-and-sandbox",
          "--color",
          "never",
          prompt,
        ],
    });
  }
  if (!excludeAgy) {
    const agyPanelModel =
      configuredCliPanelModel(config, "agy") || resolveAgyPanelModel(ctx);
    cliAdapters.push({
      binary: "agy",
      ref: "cli/agy",
      panelModel: agyPanelModel,
      command: (prompt) =>
        [
          "agy",
          "--dangerously-skip-permissions",
          ...(agyPanelModel
            ? ["--model", agyPanelModel]
            : []),
          "--print",
          prompt,
        ],
    });
  }
  if (!excludeOpencode) {
    const opencodePanelModel =
      configuredCliPanelModel(config, "opencode") || "opencode/nemotron-3-ultra-free";
    cliAdapters.push({
      binary: "opencode",
      ref: "cli/opencode",
      panelModel: opencodePanelModel,
      command: (prompt) =>
        [
          "opencode",
          "run",
          "--dangerously-skip-permissions",
          ...(opencodePanelModel
            ? ["--model", opencodePanelModel]
            : []),
          prompt,
        ],
    });
  }

  const configuredAgents = config?.omo?.panel_cli_agents;
  if (configuredAgents && typeof configuredAgents === "object") {
    for (const [name, entry] of Object.entries(configuredAgents)) {
      const id = String(entry?.id || name || "").trim();
      const command = entry?.command;
      if (!id || !command) continue;
      if (isExcludedCliId(id.replace(/^cli\//, ""))) continue;
      cliAdapters.push({
        binary: inferCliBinary(entry, id),
        ref: `cli/${id.replace(/^cli\//, "")}`,
        panelModel: String(entry?.model || "").trim(),
        command: (prompt) => renderCliCommand(command, prompt),
      });
    }
  }

  // CLI agents on PATH can participate alongside provider-backed models.
  for (const adapter of cliAdapters) {
    try {
      const which = commandExistsFn(adapter.binary);
      if (which) {
        const invoke = buildCliInvoker(adapter);
        agents.push({
          ref: adapter.ref,
          panelModel: adapter.panelModel || "",
          probe: async () => {
            const result = await invoke(
              [
                "Return only this JSON object and nothing else:",
                '{"name":"probe","type":"agent","profile":"probe","model":null,"routing":[],"fallback_models":[]}',
              ].join("\n"),
            );
            if (!result.ok) return result;
            return parseAndValidateCliResponse(result.output, "probe")
              ? { ok: true, output: result.output }
              : {
                  ok: false,
                  reason: "invalid-response",
                  errorOutput: "CLI probe returned invalid recommendation JSON",
                };
          },
          call: async (prompt) => {
            const result = await invoke(prompt);
            if (!result.ok) return null;
            return parseAndValidateCliResponse(result.output);
          },
        });
      }
    } catch {
      /* not found */
    }
  }

  // Try workshop discovery script if available
  try {
    const workshop = commandExistsFn("tools/workshop-shell");
    if (workshop) {
      // Discovery would parse the script output and add more agents
    }
  } catch {
    /* not available */
  }

  return agents;
}

// ---------------------------------------------------------------------------
// Wrappers that integrate CLI-agent discovery with panel model selection
// ---------------------------------------------------------------------------

export function includeDetectedCliPanelModels(models, config, options = {}, discoverCliModelsFn) {
  const selected = uniqueModelRefs(models);
  if (!selected.some((ref) => splitModelRef(ref).provider === "cli")) {
    return selected;
  }
  const detectedRefs = discoverCliModelsFn(config, options).map((agent) => agent.ref);
  return uniqueModelRefs([...selected, ...detectedRefs]);
}

export function preferDetectedCliPanelModels(models, config, cloudLookup, max = MAX_PANEL_MODELS, options = {}, discoverCliModelsFn, ctx) {
  const cliRefs = discoverCliModelsFn(config, options)
    .map((agent) => agent.ref)
    .filter((ref) => hasPanelCandidateShapeAndContext(ref, cloudLookup));
  const nonCliRefs = uniqueModelRefs(models).filter(
    (ref) => splitModelRef(ref).provider !== "cli",
  );
  const remaining = Math.max(0, max - cliRefs.length);
  const selectedNonCli =
    remaining > 0
      ? selectDiversePanelModels(nonCliRefs, config, cloudLookup, remaining, ctx)
      : [];
  const result = uniqueModelRefs([...cliRefs, ...selectedNonCli]).slice(0, max);
  return result;
}

export function selectPreferredPanelModels(models, config, cloudLookup, max = MAX_PANEL_MODELS, options = {}, discoverCliModelsFn, ctx) {
  return preferDetectedCliPanelModels(models, config, cloudLookup, max, options, discoverCliModelsFn, ctx);
}
