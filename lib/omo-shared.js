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

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { execSync, spawn } = require("child_process");

// =========================================================================
// Config paths
// =========================================================================

const CONFIG_DIR =
  process.env.XDG_CONFIG_HOME
    ? path.join(process.env.XDG_CONFIG_HOME, "opencode")
    : path.join(process.env.HOME || "/home/workshop", ".config", "opencode");

const CACHE_DIR = path.join(
  process.env.HOME || "/home/workshop",
  ".cache",
  "oh-my-opencode",
);

const CONFIG_PATH_JSONC = path.join(CONFIG_DIR, "oh-my-openagent.jsonc");
const CONFIG_PATH_JSON = path.join(CONFIG_DIR, "oh-my-openagent.json");
const CONFIG_PATH = fs.existsSync(CONFIG_PATH_JSONC)
  ? CONFIG_PATH_JSONC
  : (fs.existsSync(CONFIG_PATH_JSON) ? CONFIG_PATH_JSON : CONFIG_PATH_JSONC);

const CACHE_PATH = path.join(CACHE_DIR, "provider-models.json");
const BACKUP_PATH = CONFIG_PATH + ".pre-rebalance";

// =========================================================================
// Interactive prompt helper
// =========================================================================

async function confirm(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase().trim() === "y");
    });
  });
}

async function promptUser(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// =========================================================================
// AI helpers — OpenCode free provider chat
// =========================================================================

function pickFreeModel() {
  const models = discoverFreeModels();
  if (models.length === 0) throw new Error("No free model found in `opencode models`");
  const preferred = [
    "north-mini-code-free",
    "deepseek-v4-flash-free",
    "nemotron-3-ultra-free",
    "mimo-v2.5-free",
  ];
  for (const p of preferred) {
    const found = models.find((m) => m.includes(p));
    if (found) return found;
  }
  return models[0];
}

function discoverFreeModels() {
  try {
    const raw = execSync("opencode models", {
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

function callOpencodeChat(model, prompt) {
  process.stderr.write(`→ AI analysis: ${model}...`);
  try {
    const cmd =
      `opencode run --pure --format json --model ${model} --dangerously-skip-permissions 2>/dev/null ` +
      JSON.stringify(prompt);
    const raw = execSync(cmd, {
      encoding: "utf-8",
      timeout: 60000,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, TERM: "dumb" },
    });
    process.stderr.write("\x1b[2K\r→ AI analysis: done\n");
    const lines = raw.trim().split("\n");
    const texts = [];
    for (const line of lines) {
      try {
        const evt = JSON.parse(line);
        if (evt.type === "text" && evt.part && evt.part.text) {
          texts.push(evt.part.text);
        }
      } catch (_) {}
    }
    return texts.join("") || null;
  } catch (_) {
    process.stderr.write("\x1b[2K\r→ AI analysis: failed\n");
    return null;
  }
}

function callOpencodeChatAsync(model, prompt, signal, statusRef) {
  return new Promise((resolve) => {
    const child = spawn("opencode", [
      "run", "--pure", "--format", "json",
      "--model", model,
      "--dangerously-skip-permissions",
      prompt,
    ], {
      env: { ...process.env, TERM: "dumb" },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let timersCleaned = false;
    let timeoutReason = null;
    function cleanupTimers() {
      if (timersCleaned) return;
      timersCleaned = true;
      clearTimeout(firstByteTimer);
      clearTimeout(totalTimer);
    }

    // First-byte timeout: if no stdout data after 45s the model is hung.
    // The real prompt (agents + models + instructions) is 4-6KB so models
    // need time to ingest before producing a byte.
    const firstByteTimer = setTimeout(() => {
      timeoutReason = "first-byte-timeout";
      if (statusRef) statusRef.failReason = timeoutReason;
      if (!child.killed) child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, 5000);
    }, 45000);

    // Total timeout: kill after 120s regardless of output
    const totalTimer = setTimeout(() => {
      timeoutReason = "total-timeout";
      if (statusRef) statusRef.failReason = timeoutReason;
      if (!child.killed) child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, 5000);
    }, 120000);

    let firstByteReceived = false;
    child.stdout.on("data", (data) => {
      if (!firstByteReceived) {
        firstByteReceived = true;
        clearTimeout(firstByteTimer);
      }
      stdout += data.toString();
      if (statusRef) {
        statusRef.phase = "receiving";
        statusRef.bytes = stdout.length;
      }
    });

    child.on("error", () => {
      cleanupTimers();
      resolve(null);
    });

    child.on("close", () => {
      cleanupTimers();
      if (signal && signal.aborted) {
        if (statusRef) statusRef.failReason = "aborted";
        return resolve(null);
      }
      if (!stdout) return resolve(null);
      const lines = stdout.trim().split("\n");
      const texts = [];
      for (const line of lines) {
        try {
          const evt = JSON.parse(line);
          if (evt.type === "text" && evt.part && evt.part.text) {
            texts.push(evt.part.text);
          }
        } catch (_) {}
      }
      resolve(texts.join("") || null);
    });

    // Hook external abort signal
    if (signal) {
      signal.addEventListener("abort", () => {
        cleanupTimers();
        if (statusRef) statusRef.failReason = "aborted";
        if (!child.killed) child.kill("SIGTERM");
      }, { once: true });
    }
  });
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
  if (!fs.existsSync(CONFIG_PATH)) {
    return {
      $schema: "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/oh-my-opencode.schema.json",
      agents: {
        sisyphus: { model_quality: "high", description: "Primary orchestrator and architectural planner" },
        hephaestus: { model_quality: "balanced", description: "Autonomous deep worker for writing large code files and refactoring" },
        oracle: { model_quality: "high", description: "High-IQ consultation agent for complex architecture and debugging" },
        librarian: { model_quality: "balanced", description: "Reads local documentation, markdown files, and generates summaries" },
        explore: { model_quality: "balanced", description: "Fast codebase exploration and pattern matching" },
        "multimodal-looker": { model_quality: "balanced", description: "Analyzes images, PDFs, and other media files" },
        prometheus: { model_quality: "high", description: "Generates, runs, and evaluates comprehensive unit tests" },
        metis: { model_quality: "high", description: "Pre-planning consultant for ambiguous requirements" },
        momus: { model_quality: "xhigh", description: "Expert reviewer for work plans and quality assurance" },
        atlas: { model_quality: "balanced", description: "Codebase exploration and structural analysis" },
        "sisyphus-junior": { model_quality: "balanced", description: "Focused task executor under orchestration" },
        scout: { model_quality: "balanced", description: "Fast context gathering and file search" },
        sysadmin: { model_quality: "balanced", description: "Scripting, automation, and system configuration" },
      },
      categories: {
        "visual-engineering": { model_quality: "balanced", description: "Frontend, UI/UX, design, styling, animation" },
        ultrabrain: { model_quality: "xhigh", description: "Hard logic, architecture decisions, algorithms" },
        deep: { model_quality: "balanced", description: "Goal-oriented autonomous problem-solving" },
        artistry: { model_quality: "balanced", description: "Complex problem-solving with creative approaches" },
        quick: { model_quality: "balanced", description: "Single file changes, typo fixes, simple modifications" },
        "unspecified-low": { model_quality: "balanced", description: "Low-effort tasks that don't fit other categories" },
        "unspecified-high": { model_quality: "balanced", description: "High-effort tasks that don't fit other categories" },
        writing: { model_quality: "balanced", description: "Documentation, prose, technical writing" },
      },
    };
  }
  return jsoncParse(fs.readFileSync(CONFIG_PATH, "utf-8"));
}

function getAccessibleModels() {
  try {
    const output = execSync("opencode models --pure", {
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
        execSync("opencode models --refresh --pure", {
          stdio: ["ignore", "pipe", "inherit"],
          timeout: 60000,
          env: { ...process.env, TERM: "dumb" },
        });
        if (!quiet) console.log("  ✓ Cache populated.");
      } catch (e) {
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
  return `${provider}/${provider === "local" ? normalizeLocalModelName(modelName) : String(modelName || "")}`;
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

function collectModelRefs(config, pathPrefix) {
  const refs = [];

  function walk(obj, context) {
    if (!obj || typeof obj !== "object") return;

    if (Array.isArray(obj)) {
      obj.forEach((item, i) => walk(item, { ...context, index: i }));
      return;
    }

    if (obj.model && typeof obj.model === "string") {
      const slash = obj.model.indexOf("/");
      if (slash !== -1) {
        const providerID = obj.model.slice(0, slash).trim();
        const modelID = obj.model.slice(slash + 1).trim();
        refs.push({
          location: context.path || pathPrefix,
          providerID,
          modelID,
          variant: obj.variant,
          raw: obj.model,
        });
      }
    }

    for (const [key, val] of Object.entries(obj)) {
      walk(val, {
        ...context,
        path: context.path ? `${context.path}.${key}` : key,
      });
    }
  }

  walk(config, { path: "" });
  return refs;
}

// =========================================================================
// Local model discovery
// =========================================================================

function discoverLocalModels() {
  try {
    const raw = execSync("omo-recommend-local --json", {
      encoding: "utf-8",
      timeout: 10_000,
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
// Config application
// =========================================================================

function applyAiRecommendations(section, recommendations) {
  const models = [];
  for (const rec of recommendations) {
    if (rec.model && rec.provider) {
      models.push(formatModelRef(rec.provider, rec.model));
    }
  }
  if (models.length > 0) {
    section.model = models[0];
    const fallbacks = models.slice(1);
    if (fallbacks.length > 0) {
      section.fallback_models = fallbacks;
    } else if (section.fallback_models) {
      delete section.fallback_models;
    }
  }
}

// =========================================================================
// Exports
// =========================================================================

module.exports = {
  // AI helpers
  confirm,
  promptUser,
  pickFreeModel,
  discoverFreeModels,
  callOpencodeChat,
  callOpencodeChatAsync,
  parseAiJson,

  // Config paths
  CONFIG_DIR,
  CONFIG_PATH,
  CACHE_DIR,
  CACHE_PATH,
  BACKUP_PATH,

  // Config loading
  jsoncParse,
  loadConfig,
  loadProviderModels,

  // Provider resolution
  buildProviderAliases,
  resolveProvider,
  normalizeLocalModelName,
  formatModelRef,

  // Model lookup
  buildRichModelLookup,
  collectModelRefs,

  // Discovery
  discoverLocalModels,

  // Application
  applyAiRecommendations,
};
