#!/usr/bin/env node
/**
 * omo-shared — Shared helpers for omo-* tooling.
 *
 * AI helpers, config path resolution, config loading, provider
 * infrastructure, and model application utilities used by:
 *   - omo-validate-config
 *   - omo-recommend-cloud
 *   - omo-recommend-local
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

// =========================================================================
// Config paths
// =========================================================================

function resolveConfigPath() {
  let dir = process.cwd();
  while (true) {
    const jsoncFile = path.join(dir, ".opencode", "oh-my-openagent.jsonc");
    const jsonFile = path.join(dir, ".opencode", "oh-my-openagent.json");
    if (fs.existsSync(jsoncFile)) {
      return jsoncFile;
    }
    if (fs.existsSync(jsonFile)) {
      return jsonFile;
    }
    const workshopYaml = path.join(dir, "workshop.yaml");
    const gitignore = path.join(dir, ".gitignore");
    if (fs.existsSync(workshopYaml) || fs.existsSync(gitignore)) {
      return jsoncFile;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return path.join(process.cwd(), ".opencode", "oh-my-openagent.jsonc");
}

// Lazily resolved config path — avoids filesystem side effects at module load.
// Initialized on first access via getConfigPath().
let _configPath = null;
let _configDir = null;

function getConfigPath() {
  if (!_configPath) {
    _configPath = resolveConfigPath();
    _configDir = path.dirname(_configPath);
    try { fs.mkdirSync(_configDir, { recursive: true }); } catch (_e) {}
  }
  return _configPath;
}

function getConfigDir() {
  getConfigPath();
  return _configDir;
}

function getBackupPath() {
  return getConfigPath() + ".pre-rebalance";
}

const CACHE_DIR = path.join(
  process.env.HOME || "/home/workshop",
  ".cache",
  "oh-my-opencode",
);

const CACHE_PATH = path.join(CACHE_DIR, "provider-models.json");

// =========================================================================
// Interactive prompt helper
// =========================================================================

let stdinBuffer = [];
let stdinWaiters = [];
let stdinInitialized = false;

function initStdin() {
  if (stdinInitialized) return;
  stdinInitialized = true;
  process.stdin.setEncoding("utf-8");
  process.stdin.resume();

  let currentLine = "";
  process.stdin.on("data", (chunk) => {
    currentLine += chunk;
    let idx;
    while ((idx = currentLine.indexOf("\n")) !== -1) {
      const line = currentLine.slice(0, idx);
      currentLine = currentLine.slice(idx + 1);
      if (stdinWaiters.length > 0) {
        const resolve = stdinWaiters.shift();
        resolve(line);
      } else {
        stdinBuffer.push(line);
      }
    }
  });

  process.stdin.on("end", () => {
    if (currentLine) {
      if (stdinWaiters.length > 0) {
        const resolve = stdinWaiters.shift();
        resolve(currentLine);
      } else {
        stdinBuffer.push(currentLine);
      }
      currentLine = "";
    }
    while (stdinWaiters.length > 0) {
      const resolve = stdinWaiters.shift();
      resolve("");
    }
  });
}

function isStdinEnded() {
  return (
    process.stdin.readableEnded ||
    !process.stdin.readable ||
    Boolean(process.stdin._readableState && process.stdin._readableState.ended)
  );
}

function readLineFromStdin() {
  initStdin();
  if (stdinBuffer.length > 0) {
    return Promise.resolve(stdinBuffer.shift());
  }
  if (isStdinEnded()) {
    return Promise.resolve("");
  }
  return new Promise((resolve) => {
    stdinWaiters.push(resolve);
  });
}

async function confirm(question) {
  if (isStdinEnded()) {
    return false;
  }
  process.stdout.write(question);
  const answer = await readLineFromStdin();
  return answer.toLowerCase().trim() === "y";
}

async function promptUser(question) {
  if (isStdinEnded()) {
    return "";
  }
  process.stdout.write(question);
  const answer = await readLineFromStdin();
  return answer.trim();
}

function discoverFreeModels() {
  try {
    const raw = execFileSync("opencode", ["models"], {
      encoding: "utf-8",
      timeout: 15000,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, TERM: "dumb" },
    });
    const lines = raw.trim().split("\n").filter(Boolean);
    return lines.map((m) => m.trim()).filter(Boolean);
  } catch (_) {
    return [];
  }
}

function parseAiJson(raw) {
  if (!raw) throw new Error("AI returned no output. Is OpenCode running?");
  const clean = raw
    .replace(/^\s*```(?:json)?\s*\n?/gm, "")
    .replace(/\s*```\s*$/gm, "")
    .trim();
  return JSON.parse(clean);
}

// =========================================================================
// Config loading
// =========================================================================

function stripJsoncComments(text) {
  let out = "";
  let inString = false;
  let escaped = false;
  let quote = "";

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inString) {
      out += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === quote) {
        inString = false;
        quote = "";
      }
      continue;
    }

    if (ch === "\"" || ch === "'") {
      inString = true;
      quote = ch;
      out += ch;
      continue;
    }

    if (ch === "/" && next === "/") {
      i += 2;
      while (i < text.length && text[i] !== "\n" && text[i] !== "\r") i++;
      if (i < text.length) out += text[i];
      continue;
    }

    if (ch === "/" && next === "*") {
      i += 2;
      while (i < text.length) {
        if (text[i] === "\n" || text[i] === "\r") out += text[i];
        if (text[i] === "*" && text[i + 1] === "/") {
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    out += ch;
  }

  return out;
}

function stripTrailingCommas(text) {
  let out = "";
  let inString = false;
  let escaped = false;
  let quote = "";

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      out += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === quote) {
        inString = false;
        quote = "";
      }
      continue;
    }

    if (ch === "\"" || ch === "'") {
      inString = true;
      quote = ch;
      out += ch;
      continue;
    }

    if (ch === ",") {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j++;
      if (text[j] === "}" || text[j] === "]") continue;
    }

    out += ch;
  }

  return out;
}

function jsoncParse(text) {
  return JSON.parse(stripTrailingCommas(stripJsoncComments(text)));
}

function loadConfig() {
  if (!fs.existsSync(getConfigPath())) {
    return {
      $schema: "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/oh-my-opencode.schema.json",
      runtime_fallback: true,
      git_master: {
        commit_footer: true,
        include_co_authored_by: true,
        git_env_prefix: "GIT_MASTER=1",
      },
      agents: {
        sisyphus: { description: "Primary orchestrator and architectural planner" },
        hephaestus: { description: "Autonomous deep worker for writing large code files and refactoring" },
        oracle: { description: "High-IQ consultation agent for complex architecture and debugging" },
        librarian: { description: "Reads local documentation, markdown files, and generates summaries" },
        explore: { description: "Fast codebase exploration and pattern matching" },
        "multimodal-looker": { description: "Analyzes images, PDFs, and other media files" },
        prometheus: { description: "Generates, runs, and evaluates comprehensive unit tests" },
        metis: { description: "Pre-planning consultant for ambiguous requirements" },
        momus: { description: "Expert reviewer for work plans and quality assurance" },
        atlas: { description: "Codebase exploration and structural analysis" },
        "sisyphus-junior": { description: "Focused task executor under orchestration" },
        scout: { description: "Fast context gathering and file search" },
        sysadmin: { description: "Scripting, automation, and system configuration" },
      },
      categories: {
        "visual-engineering": { description: "Frontend, UI/UX, design, styling, animation" },
        ultrabrain: { description: "Hard logic, architecture decisions, algorithms" },
        deep: { description: "Goal-oriented autonomous problem-solving" },
        artistry: { description: "Complex problem-solving with creative approaches" },
        quick: { description: "Single file changes, typo fixes, simple modifications" },
        "unspecified-low": { description: "Low-effort tasks that don't fit other categories" },
        "unspecified-high": { description: "High-effort tasks that don't fit other categories" },
        writing: { description: "Documentation, prose, technical writing" },
      },
    };
  }
  return jsoncParse(fs.readFileSync(getConfigPath(), "utf-8"));
}

function getAccessibleModels() {
  try {
    const output = execFileSync("opencode", ["models", "--pure"], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10000,
      env: { ...process.env, TERM: "dumb" },
      encoding: "utf8",
    });
    const set = new Set();
    for (const line of output.split("\n")) {
      const trimmed = line.trim();
      if (trimmed) set.add(trimmed);
    }
    return set;
  } catch (err) {
    if (err && err.code === "ENOENT") {
      return null;
    }
    console.error("getAccessibleModels failed:", err.message, err.stderr);
    return null;
  }
}

function loadProviderModels(options = {}) {
  const refresh = options.refresh !== false;
  const quiet = options.quiet === true;

  let cache = null;

  if (fs.existsSync(CACHE_PATH)) {
    try {
      cache = JSON.parse(fs.readFileSync(CACHE_PATH, "utf-8"));
    } catch (e) {
      if (!quiet) console.error("  ✗ Failed to read provider-models cache: " + e.message);
    }
  }

  if (!cache) {
    const opencodeModelsPath = path.join(
      process.env.HOME || "/home/workshop",
      ".cache",
      "opencode",
      "models.json"
    );

    if (!fs.existsSync(opencodeModelsPath)) {
      if (!refresh) return null;
      if (!quiet) {
        console.log("⚠ Provider-models cache not found. Refreshing...");
      }
      try {
        execFileSync("opencode", ["models", "--refresh", "--pure"], {
          stdio: ["ignore", "pipe", "inherit"],
          timeout: 60000,
          env: { ...process.env, TERM: "dumb" },
        });
        if (!quiet) console.log("  ✓ Cache populated.");
      } catch (_e) {
        if (!quiet) console.error("  ✗ Failed to refresh models cache. Run OpenCode once to populate it.");
        return null;
      }
    }

    if (fs.existsSync(opencodeModelsPath)) {
      try {
        const rawModels = JSON.parse(fs.readFileSync(opencodeModelsPath, "utf-8"));
        const convertedModels = {};
        for (const [providerId, providerObj] of Object.entries(rawModels)) {
          if (providerObj && providerObj.models) {
            const modelsArray = Object.values(providerObj.models);
            convertedModels[providerId] = modelsArray;
          }
        }
        cache = { models: convertedModels };
      } catch (e) {
        if (!quiet) console.error("  ✗ Failed to process models.json: " + e.message);
        return null;
      }
    }
  }

  if (cache && cache.models) {
    const accessible = getAccessibleModels();
    if (accessible) {
      const convertedModels = {};
      for (const [providerId, modelsArray] of Object.entries(cache.models)) {
        const filtered = modelsArray.filter((m) => {
          const id = typeof m === "string" ? m : m.id;
          return accessible.has(`${providerId}/${id}`) || accessible.has(id);
        });
        if (filtered.length > 0) {
          convertedModels[providerId] = filtered;
        }
      }
      cache.models = convertedModels;
    }
  }

  return cache;
}

// =========================================================================
// Provider alias resolution
// =========================================================================

const CANONICAL_PROVIDERS = new Set(["local", "openai", "opencode"]);

function buildProviderAliases(config) {
  const aliases = {};
  for (const [key, entry] of Object.entries(config.providers || {})) {
    if (entry.type && entry.type !== key && !CANONICAL_PROVIDERS.has(key)) {
      aliases[key] = entry.type;
    }
  }
  return aliases;
}

function resolveProvider(providerKey, aliases) {
  return aliases[providerKey] || providerKey;
}

function normalizeLocalModelName(modelName) {
  const trimmed = String(modelName || "").trim();
  const withoutProvider = trimmed.replace(/^(?:local|ollama)\//, "");
  if (!withoutProvider) return "";
  return withoutProvider.includes(":") ? withoutProvider : `${withoutProvider}:latest`;
}

function formatModelRef(provider, modelName) {
  if (provider === "local") {
    const trimmed = String(modelName || "").trim();
    const withoutProvider = trimmed.replace(/^(?:local|ollama)\//, "");
    if (withoutProvider) {
      return `local/${withoutProvider.includes(":") ? withoutProvider : `${withoutProvider}:latest`}`;
    }
    return `local/${trimmed}`;
  }
  return `${provider}/${String(modelName || "")}`;
}

function modelRef(provider, modelName) {
  return formatModelRef(provider, modelName);
}

function splitModelRef(ref) {
  const trimmed = String(ref || "").trim();
  const slash = trimmed.indexOf("/");
  if (slash === -1) return { provider: "", model: trimmed };
  return {
    provider: trimmed.slice(0, slash),
    model: trimmed.slice(slash + 1),
  };
}

// =========================================================================
// Model lookup
// =========================================================================

function buildRichModelLookup(cache) {
  const byId = {};
  const sets = {};
  if (!cache || !cache.models) return { byId, sets };
  for (const [provider, models] of Object.entries(cache.models)) {
    const modelMap = new Map();
    const modelSet = new Set();
    for (const m of Array.isArray(models) ? models : []) {
      const id = typeof m === "string" ? m : m.id;
      modelSet.add(id);
      if (typeof m === "object" && m !== null) {
        modelMap.set(id, m);
      }
    }
    byId[provider] = modelMap;
    sets[provider] = modelSet;
  }
  return { byId, sets };
}

function discoverLocalModels() {
  try {
    const raw = execFileSync("omo-recommend-local", ["--json"], {
      encoding: "utf-8",
      timeout: 10000,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, TERM: "dumb" },
    });
    const data = JSON.parse(raw);
    // Only return models that are actually installed on disk
    return (data.ollama.models || [])
      .filter((m) => m.name)
      .map((m) => m.name);
  } catch {
    return [];
  }
}

// =========================================================================
// Exports
// =========================================================================

export {
  confirm,
  promptUser,
  discoverFreeModels,
  parseAiJson,
  getConfigDir,
  getConfigPath,
  getBackupPath,
  CACHE_DIR,
  CACHE_PATH,
  jsoncParse,
  loadConfig,
  loadProviderModels,
  buildProviderAliases,
  resolveProvider,
  normalizeLocalModelName,
  formatModelRef,
  modelRef,
  splitModelRef,
  buildRichModelLookup,
  discoverLocalModels,
};
