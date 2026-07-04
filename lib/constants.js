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

