import {
  configuredCliPanelModel,
  inferCliBinary,
  isExcludedCliId,
  renderCliCommand,
  resolveAgyPanelModel,
} from "./utils.js";

export function builtinCliAdapters(config, options, ctx) {
  const adapters = [];
  if (!options.excludeCodex) {
    const panelModel = configuredCliPanelModel(config, "codex");
    adapters.push({
      binary: "codex",
      ref: "cli/codex",
      panelModel,
      command: (prompt) => [
        "codex",
        "exec",
        ...(panelModel ? ["--model", panelModel] : []),
        "--skip-git-repo-check",
        "--dangerously-bypass-approvals-and-sandbox",
        "--color",
        "never",
        prompt,
      ],
    });
  }
  if (!options.excludeAgy) {
    const panelModel = configuredCliPanelModel(config, "agy") || resolveAgyPanelModel(ctx);
    adapters.push({
      binary: "agy",
      ref: "cli/agy",
      panelModel,
      command: (prompt) => [
        "agy",
        "--dangerously-skip-permissions",
        ...(panelModel ? ["--model", panelModel] : []),
        "--print",
        prompt,
      ],
    });
  }
  if (!options.excludeOpencode) {
    const panelModel = configuredCliPanelModel(config, "opencode") || "opencode/nemotron-3-ultra-free";
    adapters.push({
      binary: "opencode",
      ref: "cli/opencode",
      panelModel,
      command: (prompt) => [
        "opencode",
        "run",
        "--dangerously-skip-permissions",
        ...(panelModel ? ["--model", panelModel] : []),
        prompt,
      ],
    });
  }
  return adapters;
}

export function configuredCliAdapters(config, options) {
  const configuredAgents = config?.omo?.panel_cli_agents;
  if (!configuredAgents || typeof configuredAgents !== "object") return [];
  const adapters = [];
  for (const [name, entry] of Object.entries(configuredAgents)) {
    const id = String(entry?.id || name || "").trim();
    const command = entry?.command;
    if (!id || !command) continue;
    if (isExcludedCliId(id.replace(/^cli\//, ""), options)) continue;
    adapters.push({
      binary: inferCliBinary(entry, id),
      ref: `cli/${id.replace(/^cli\//, "")}`,
      panelModel: String(entry?.model || "").trim(),
      command: (prompt) => renderCliCommand(command, prompt),
    });
  }
  return adapters;
}
