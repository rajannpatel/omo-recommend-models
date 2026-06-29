// =========================================================================
// Model scoring constants (from omo-recommend-cloud)
// =========================================================================

// FAMILY_TIERS removed - scoring now uses generic metadata signals:
// - capabilities (reasoning, code, vision)
// - context length
// - cost (input/output price)
// - release date (recency)
// - variant tier (xhigh, max, high, medium, low)
// Provider prestige removed - all providers treated equally

export const VARIANT_BONUS = { xhigh: 10, max: 8, high: 5, medium: 0, low: -5 };
export const LOCAL_PROVIDER = "local";
export const FREE_PROVIDERS = ["opencode", LOCAL_PROVIDER];
export const QUALITY_TIERS = ["reasoning", "balanced", "fast"];
export const MAX_PANEL_MODELS = 5;
export const MIN_PANEL_CONTEXT_TOKENS = Math.max(
  32000,
  Number.parseInt(process.env.OMO_PANEL_MIN_CONTEXT_TOKENS || "32000", 10) ||
  32000,
);

// =========================================================================
// Local model constants (from omo-recommend-local)
// =========================================================================

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const MODEL_CACHE_FILE = path.join(
  os.homedir(),
  ".cache",
  "oh-my-opencode",
  "ollama-models.json",
);

export const PANEL_CACHE_FILE = path.join(
  os.homedir(),
  ".cache",
  "oh-my-opencode",
  "panel-cache.json",
);

export function loadPanelCache() {
  try {
    if (!fs.existsSync(PANEL_CACHE_FILE)) return null;
    const raw = fs.readFileSync(PANEL_CACHE_FILE, "utf-8");
    const data = JSON.parse(raw);
    if (!data || !data.timestamp || !data.result) return null;
    return data;
  } catch {
    return null;
  }
}

export function savePanelCache(result, panelModels, gpuInfo) {
  try {
    const dir = path.dirname(PANEL_CACHE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const gpu = gpuInfo
      ? {
          hasGpu: !!gpuInfo.hasGpu,
          name: gpuInfo.name || "",
          label: gpuInfo.label || "",
          vramGb: gpuInfo.vramGb || 0,
        }
      : null;
    fs.writeFileSync(
      PANEL_CACHE_FILE,
      JSON.stringify(
        {
          timestamp: Date.now(),
          models: panelModels || null,
          gpu,
          result,
        },
        null,
        2,
      ),
      "utf-8",
    );
  } catch {
    /* cache write failure is non-fatal */
  }
}

export function modelListEquals(a, b) {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

export function isSubsetList(superset, subset) {
  if (!superset || !subset) return false;
  const ss = new Set(superset);
  return subset.every((m) => ss.has(m));
}

export const KNOWN_MODELS = [
  { name: "llama3.2", tags: ["1b", "3b"] },
  { name: "llama3.1", tags: ["8b", "70b", "405b"] },
  { name: "llama3", tags: ["8b", "70b", "405b"] },
  { name: "qwen2.5-coder", tags: ["1.5b", "7b", "14b", "32b"] },
  { name: "qwen2.5", tags: ["7b", "14b", "32b", "72b"] },
  { name: "deepseek-coder-v2", tags: ["16b"] },
  { name: "codegemma", tags: ["2b", "7b"] },
  { name: "codellama", tags: ["7b", "13b", "34b", "70b"] },
  { name: "mistral", tags: ["7b"] },
  { name: "mixtral", tags: ["8x7b", "8x22b"] },
  { name: "phi3", tags: ["3.8b", "7b", "14b"] },
  { name: "gemma2", tags: ["2b", "9b", "27b"] },
  { name: "nomic-embed-text", tags: ["v1.5"] },
  { name: "mxbai-embed-large", tags: ["v1"] },
  { name: "llama3.2-vision", tags: ["11b", "90b"] },
  { name: "llava", tags: ["7b", "13b", "34b"] },
  { name: "bakllava", tags: ["7b"] },
  { name: "starcoder2", tags: ["3b", "7b", "15b"] },
  { name: "dolphin-mixtral", tags: ["8x7b"] },
  { name: "neural-chat", tags: ["7b"] },
  { name: "orca-mini", tags: ["3b", "7b"] },
  { name: "tinyllama", tags: ["1.1b"] },
  { name: "falcon3", tags: ["1b", "3b", "7b", "10b"] },
  {
    name: "command-r",
    tags: ["7b", "7b-08-2024", "v01", "35b-08-2024", "104b"],
  },
  { name: "llama-guard3", tags: ["1b", "8b"] },
  { name: "nemotron", tags: ["mini-4b-instruct"] },
  {
    name: "deepseek-r1",
    tags: ["1.5b", "7b", "8b", "14b", "32b", "70b", "671b"],
  },
  { name: "qwq", tags: ["32b"] },
];

export const MODEL_SCORES = {
  "deepseek-coder-v2": 95,
  "qwen2.5-coder": 92,
  "llama3.1": 88,
  llama3: 86,
  codellama: 82,
  codegemma: 78,
  mixtral: 76,
  "deepseek-r1": 74,
  qwq: 72,
  "qwen2.5": 70,
  mistral: 68,
  starcoder2: 66,
  falcon3: 64,
  "llama3.2": 62,
  gemma2: 60,
  "command-r": 58,
  phi3: 55,
  "dolphin-mixtral": 52,
  "neural-chat": 48,
  "orca-mini": 42,
  nemotron: 40,
  "llama-guard3": 35,
  tinyllama: 30,
  "mxbai-embed-large": 20,
  "nomic-embed-text": 18,
  "llama3.2-vision": 70,
  llava: 62,
  bakllava: 55,
};

export const BASE_VRAM = {
  "deepseek-coder-v2": 16,
  "qwen2.5-coder": 7,
  "llama3.1": 8,
  llama3: 8,
  codellama: 7,
  codegemma: 7,
  mixtral: 47,
  "deepseek-r1": 7,
  qwq: 32,
  "qwen2.5": 7,
  mistral: 7,
  starcoder2: 7,
  falcon3: 7,
  "llama3.2": 3,
  gemma2: 9,
  "command-r": 7,
  phi3: 4,
  "dolphin-mixtral": 47,
  "neural-chat": 7,
  "orca-mini": 3,
  nemotron: 4,
  "llama-guard3": 8,
  tinyllama: 1,
  "mxbai-embed-large": 1,
  "nomic-embed-text": 1,
  "llama3.2-vision": 11,
  llava: 7,
  bakllava: 7,
};
