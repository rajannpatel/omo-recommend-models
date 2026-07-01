import { MAX_PANEL_MODELS } from "../constants.js";
import { detectFamilyFromMeta } from "../scoring.js";

export function panelModelFamilyLabel(modelName, meta = null) {
  const model = String(modelName || "").toLowerCase();
  if (meta) {
    const detected = detectFamilyFromMeta(meta, modelName);
    if (detected.family) return detected.family;
  }
  if (model.includes("opus") || model.includes("pro-max") || model.includes("ultra")) return "flagship";
  if (model.includes("sonnet") || model.includes("pro") || model.includes("plus")) return "advanced";
  if (model.includes("haiku") || model.includes("mini") || model.includes("nano") || model.includes("lite") || model.includes("small")) return "compact";
  if (model.includes("flash") || model.includes("speed") || model.includes("fast")) return "speed";
  if (model.includes("reasoning") || model.includes("think") || model.includes("r1")) return "reasoning";
  if (model.includes("codex") || model.includes("coder") || model.includes("code")) return "code";
  if (model.includes("vision") || model.includes("vl") || model.includes("multimodal")) return "vision";
  if (model.includes("embedding") || model.includes("embed")) return "embedding";

  const sizeMatch = model.match(/(\d+)b/);
  if (!sizeMatch) return "unknown";
  const size = Number.parseInt(sizeMatch[1], 10);
  if (size >= 70) return "xxlarge";
  if (size >= 30) return "xlarge";
  if (size >= 13) return "large";
  if (size >= 7) return "medium";
  return "small";
}

export function groupPanelModelRefs(models, cloudLookup = null) {
  const groupOrder = [];
  const byGroup = new Map();
  for (const ref of models || []) {
    const trimmed = String(ref || "").trim();
    if (!trimmed) continue;
    const slash = trimmed.indexOf("/");
    const provider = slash === -1 ? "unknown" : trimmed.slice(0, slash);
    const model = slash === -1 ? trimmed : trimmed.slice(slash + 1);
    const modelMap = cloudLookup?.byId?.[provider];
    const meta = modelMap ? modelMap.get(model) || modelMap.get(ref) || null : null;
    const family = provider === "cli" ? "agents" : panelModelFamilyLabel(model, meta);
    const label = provider === "cli"
      ? "CLI agents"
      : provider === "opencode"
        ? "opencode"
        : family
          ? `${provider}/${family}`
          : provider;
    if (!byGroup.has(label)) {
      byGroup.set(label, []);
      groupOrder.push(label);
    }
    byGroup.get(label).push({ ref: trimmed, model });
  }
  return groupOrder.map((label) => ({ label, models: byGroup.get(label) }));
}

export function printNumberedPanelModelGroups(models, indent = "  ", cloudLookup = null) {
  const groups = groupPanelModelRefs(models, cloudLookup);
  const width = String(groups.length).length;
  groups.forEach((group, index) => {
    const prefix = `${indent}${String(index + 1).padStart(width, " ")}. ${group.label}: `;
    group.models.forEach((entry, modelIdx) => {
      console.log(modelIdx === 0 ? `${prefix}${entry.model}` : `${" ".repeat(prefix.length)}${entry.model}`);
    });
  });
  return groups.length;
}

export function printSelectablePanelModelGroups(models, indent = "  ", cloudLookup = null) {
  const groups = groupPanelModelRefs(models, cloudLookup);
  const width = String(groups.length).length;
  groups.forEach((group, index) => {
    const prefix = `${indent}[${String(index + 1).padStart(width, " ")}] ${group.label}: `;
    group.models.forEach((entry, modelIdx) => {
      console.log(modelIdx === 0 ? `${prefix}${entry.model}` : `${" ".repeat(prefix.length)}${entry.model}`);
    });
  });
  return groups;
}

export function configuredPanelModels(config) {
  const models = config?.omo?.panel_models;
  if (!Array.isArray(models)) return [];
  return models.map((model) => String(model || "").trim()).filter(Boolean);
}

export function panelModelsRequireOpencode(models) {
  if (!Array.isArray(models) || models.length === 0) return true;
  return models.some((model) => !String(model || "").startsWith("cli/"));
}

export function selectedPanelRequiresOpencode(config, explicitModels) {
  if (explicitModels.length > 0) return panelModelsRequireOpencode(explicitModels);
  const configured = configuredPanelModels(config);
  return configured.length > 0 ? panelModelsRequireOpencode(configured) : true;
}

export function opencodePanelModelsFromLookup(cloudLookup) {
  const modelMap = cloudLookup?.byId?.opencode;
  if (!modelMap) return [];
  const ids = modelMap instanceof Map ? [...modelMap.keys()] : Object.keys(modelMap);
  return ids
    .map((id) => String(id || "").trim())
    .filter(Boolean)
    .map((id) => (id.startsWith("opencode/") ? id : `opencode/${id}`));
}

export function defaultPanelModels(config, cloudLookup = null, options = {}) {
  const discoverFn = typeof options._discoverFreeModels === "function" ? options._discoverFreeModels : () => [];
  const preferFn = typeof options._preferDetectedCliPanelModels === "function"
    ? options._preferDetectedCliPanelModels
    : (refs, _cfg, _cl, max) => refs.slice(0, max);
  const discovered = discoverFn(options);
  const refs = discovered.length > 0 ? discovered : opencodePanelModelsFromLookup(cloudLookup);
  return preferFn(refs, config, cloudLookup, MAX_PANEL_MODELS, options);
}

export function plannedPanelModels(config, panelModels, cloudLookup = null, options = {}) {
  if (panelModels && panelModels.length > 0) return panelModels;
  const configured = configuredPanelModels(config);
  return configured.length > 0 ? configured : defaultPanelModels(config, cloudLookup, options);
}
