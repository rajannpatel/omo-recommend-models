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
import readline from "node:readline";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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

const CONFIG_PATH = resolveConfigPath();
const CONFIG_DIR = path.dirname(CONFIG_PATH);

// Ensure the config directory exists
try {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
} catch (e) {}

const CACHE_DIR = path.join(
  process.env.HOME || "/home/workshop",
  ".cache",
  "oh-my-opencode",
);

const CACHE_PATH = path.join(CACHE_DIR, "provider-models.json");
const BACKUP_PATH = CONFIG_PATH + ".pre-rebalance";

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

// =========================================================================
// AI helpers — OpenCode free provider chat
// =========================================================================

function pickFreeModel() {
  const models = discoverFreeModels();
  if (models.length === 0) throw new Error("No free model found in `opencode models`");
  
  // Score models dynamically based on name patterns (generic, not vendor-specific)
  const scored = models.map(model => {
    const lower = model.toLowerCase();
    let score = 0;
    
    // Prefer models with "ultra", "pro", "max", "large" in name (higher tier indicators)
    if (lower.includes("ultra") || lower.includes("pro-max") || lower.includes("max") || lower.includes("large")) score += 10;
    else if (lower.includes("pro") || lower.includes("plus") || lower.includes("advanced")) score += 7;
    else if (lower.includes("sonnet") || lower.includes("flash") || lower.includes("speed")) score += 5;
    else if (lower.includes("haiku") || lower.includes("mini") || lower.includes("nano") || lower.includes("small") || lower.includes("lite")) score += 2;
    
    // Prefer free models explicitly marked as free
    if (lower.includes("-free") || lower.includes(":free") || lower.includes("/free-") || lower.includes("-free-") || lower.endsWith("/free")) score += 8;
    
    // Prefer models with known good free model indicators
    if (lower.includes("nemotron")) score += 5;
    if (lower.includes("mimo")) score += 3;
    if (lower.includes("north")) score += 2;
    if (lower.includes("deepseek")) score += 2;
    
    return { model, score };
  });
  
  // Sort by score descending and pick the best
  scored.sort((a, b) => b.score - a.score);
  return scored[0].model;
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

function callOpencodeChat(model, prompt) {
  process.stderr.write(`→ AI analysis: ${model}...`);
  try {
    const raw = execFileSync("opencode", [
      "run",
      "--pure",
      "--format",
      "json",
      "--model",
      model,
      "--dangerously-skip-permissions",
      prompt,
    ], {
      encoding: "utf-8",
      timeout: 60000,
      maxBuffer: 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
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
      runtime_fallback: true,
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
    const raw = execFileSync("omo-recommend-local", ["--json"], {
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

export {
  confirm,
  promptUser,
  pickFreeModel,
  discoverFreeModels,
  callOpencodeChat,
  callOpencodeChatAsync,
  parseAiJson,
  CONFIG_DIR,
  CONFIG_PATH,
  CACHE_DIR,
  CACHE_PATH,
  BACKUP_PATH,
  jsoncParse,
  loadConfig,
  loadProviderModels,
  buildProviderAliases,
  resolveProvider,
  normalizeLocalModelName,
  formatModelRef,
  buildRichModelLookup,
  collectModelRefs,
  discoverLocalModels,
  applyAiRecommendations
};
