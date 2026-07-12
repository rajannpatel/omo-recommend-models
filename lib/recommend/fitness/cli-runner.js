import { spawn, execFileSync } from "node:child_process";
import process from "node:process";
import { writeGroupLine } from "../../display/progress.js";
import { createVerboseSubprocessReporter } from "../../display/subprocess-output.js";

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
  if (ctx && ctx.cachedAgyPanelModel !== undefined) return ctx.cachedAgyPanelModel;
  if (process.env.OMO_AGY_PANEL_MODEL) return process.env.OMO_AGY_PANEL_MODEL;
  const reporter = createVerboseSubprocessReporter({
    enabled: ctx?.verboseMode,
    command: "agy",
    args: ["models"],
    inGroup: true,
  });
  try {
    const raw = execFileSync("agy", ["models"], {
      encoding: "utf-8",
      timeout: 10000,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, TERM: "dumb" },
    });
    reporter.stdout(raw);
    const models = raw
      .split("\n")
      .map((line) => normalizeCliModelLine(line))
      .filter(Boolean);
    models.sort((a, b) => rankAgyModel(a) - rankAgyModel(b) || a.localeCompare(b));
    const model = models[0] || "";
    if (ctx) ctx.cachedAgyPanelModel = model;
    return model;
  } catch (error) {
    if (error.stdout) reporter.stdout(error.stdout);
    if (error.stderr) reporter.stderr(error.stderr);
    reporter.stderr(error.message);
    if (ctx) ctx.cachedAgyPanelModel = "";
    return "";
  } finally {
    reporter.finish();
  }
}

export async function callCliAgent(prompt, tool, config, ctx, options = {}) {
  const { debug = false, verbose = false } = options;

  let cmd;
  if (tool === "agy") {
    const model = config?.omo?.panel_cli_agents?.agy?.model || resolveAgyPanelModel(ctx);
    cmd = [
      "agy",
      "--dangerously-skip-permissions",
      ...(model ? ["--model", model] : []),
      "--print",
      prompt,
    ];
  } else if (tool === "codex") {
    const model = config?.omo?.panel_cli_agents?.codex?.model || "";
    cmd = [
      "codex",
      "exec",
      ...(model ? ["--model", model] : []),
      "--skip-git-repo-check",
      "--dangerously-bypass-approvals-and-sandbox",
      "--color",
      "never",
      prompt,
    ];
  } else {
    throw new Error(`Unsupported CLI tool: ${tool}`);
  }

  const bin = cmd[0];
  const args = cmd.slice(1);
  const displayArgs = [...args.slice(0, -1), `<prompt: ${prompt.length} chars>`];

  return new Promise((resolve, reject) => {
    const reporter = createVerboseSubprocessReporter({
      enabled: verbose,
      command: bin,
      args,
      displayArgs,
      inGroup: true,
    });
    const spawnOptions = {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30000,
    };
    const child = ctx && typeof ctx.registerChild === "function"
      ? ctx.registerChild(spawn(bin, args, spawnOptions))
      : spawn(bin, args, spawnOptions);

    let stdout = "";
    let stderr = "";
    let eventCount = 0;

    // Stream stdout in real-time
    child.stdout.on("data", (data) => {
      const raw = data.toString();
      stdout += raw;
      reporter.stdout(raw);
      const lines = raw.split("\n");
      for (const line of lines) {
        if (!line.trim()) continue;
        
        eventCount++;
        
        if (debug && !verbose) {
          writeGroupLine(`[output] ${line.slice(0, 200)}${line.length > 200 ? "..." : ""}`);
        }
      }
    });

    child.stderr.on("data", (data) => {
      const line = data.toString();
      stderr += line;
      reporter.stderr(line);
      if (debug && !verbose) {
        process.stderr.write(`│  [stderr] ${line.slice(0, 500)}\n`);
      }
    });

    child.on("error", (err) => {
      reporter.stderr(err.message);
      reporter.finish();
      reject(err);
    });

    child.on("close", (code) => {
      reporter.finish();
      if (code !== 0) {
        const detail = stderr.trim() ? `: ${stderr.trim().slice(0, 200)}` : "";
        reject(new Error(`${bin} exited with code ${code}${detail}`));
        return;
      }

      if (debug && !verbose) {
        writeGroupLine(`[complete] received ${eventCount} output events (${stdout.length} chars)`);
      }
      resolve(stdout);
    });
  });
}
