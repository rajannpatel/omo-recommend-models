import { spawn, execFileSync } from "node:child_process";
import process from "node:process";

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
    const model = models[0] || "";
    if (ctx) ctx.cachedAgyPanelModel = model;
    return model;
  } catch {
    if (ctx) ctx.cachedAgyPanelModel = "";
    return "";
  }
}

export async function callCliAgent(prompt, tool, config, ctx) {
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

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120_000,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => { stdout += data.toString(); });
    child.stderr.on("data", (data) => { stderr += data.toString(); });

    child.on("error", (err) => reject(err));

    child.on("close", (code) => {
      if (code !== 0) {
        const detail = stderr.trim() ? `: ${stderr.trim().slice(0, 200)}` : "";
        reject(new Error(`${bin} exited with code ${code}${detail}`));
        return;
      }
      resolve(stdout);
    });
  });
}
