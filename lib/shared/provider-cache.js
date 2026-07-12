import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import https from "node:https";

import { splitModelRef } from "./model-refs.js";
import { createVerboseSubprocessReporter } from "../display/subprocess-output.js";


let _cachedFreeModels = null;
let _cachedProviderModels = null;

export function loadCatalogFromFiles() {
  const catalog = {};

  const opencodeModelsPath = path.join(
    process.env.HOME || "/home/workshop",
    ".cache",
    "opencode",
    "models.json"
  );
  if (fs.existsSync(opencodeModelsPath)) {
    try {
      const rawModels = JSON.parse(fs.readFileSync(opencodeModelsPath, "utf-8"));
      for (const [providerId, providerObj] of Object.entries(rawModels)) {
        if (!catalog[providerId]) catalog[providerId] = { models: {} };
        if (providerObj?.models) {
          for (const [modelId, modelData] of Object.entries(providerObj.models)) {
            catalog[providerId].models[modelId] = modelData;
          }
        }
      }
    } catch {}
  }

  let projectModelsPath = path.join(process.cwd(), "models.json");
  if (!fs.existsSync(projectModelsPath)) {
    let dir = process.cwd();
    while (true) {
      const p = path.join(dir, "models.json");
      if (fs.existsSync(p)) {
        projectModelsPath = p;
        break;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }

  if (fs.existsSync(projectModelsPath)) {
    try {
      const content = fs.readFileSync(projectModelsPath, "utf-8");
      const lines = content.split("\n");
      let currentRef = null;
      let jsonBuffer = [];
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        
        if (trimmed.startsWith("{") || jsonBuffer.length > 0) {
          if (jsonBuffer.length > 0 && !line.startsWith(" ") && !line.startsWith("\t") && trimmed.includes("/") && !trimmed.startsWith("{") && !trimmed.startsWith("}") && !trimmed.startsWith("\"")) {
            try {
              const data = JSON.parse(jsonBuffer.join("\n"));
              if (currentRef) {
                const slash = currentRef.indexOf("/");
                if (slash !== -1) {
                  const providerId = currentRef.slice(0, slash);
                  const modelId = currentRef.slice(slash + 1);
                  if (!catalog[providerId]) catalog[providerId] = { models: {} };
                  catalog[providerId].models[modelId] = data;
                }
              }
            } catch (e) {
              // failed parsing block
            }
            jsonBuffer = [];
            currentRef = trimmed;
          } else {
            jsonBuffer.push(line);
          }
        } else {
          currentRef = trimmed;
        }
      }
      
      if (jsonBuffer.length > 0 && currentRef) {
        try {
          const data = JSON.parse(jsonBuffer.join("\n"));
          const slash = currentRef.indexOf("/");
          if (slash !== -1) {
            const providerId = currentRef.slice(0, slash);
            const modelId = currentRef.slice(slash + 1);
            if (!catalog[providerId]) catalog[providerId] = { models: {} };
            catalog[providerId].models[modelId] = data;
          }
        } catch (e) {
          // failed parsing
        }
      }
    } catch {}
  }

  return catalog;
}

export function isFreeModelRef(provider, model) {
  if (provider === "opencode") return true;
  const freeModels = discoverFreeModels();
  return freeModels.includes(`${provider}/${model}`);
}

export function discoverFreeModels(options = {}) {
  if (_cachedFreeModels) return _cachedFreeModels;
  const freeModels = [];
  try {
    const catalog = loadCatalogFromFiles();
    for (const [providerId, providerObj] of Object.entries(catalog)) {
      if (!providerObj?.models) continue;
      for (const [modelId, modelData] of Object.entries(providerObj.models)) {
        const cost = modelData.cost || {};
        const caps = modelData.capabilities || {};
        if (
          cost.input === 0 &&
          cost.output === 0 &&
          caps.toolcall === true
        ) {
          freeModels.push(`${providerId}/${modelId}`);
        }
      }
    }
  } catch (e) {}

  if (freeModels.length === 0) {
    const reporter = createVerboseSubprocessReporter({
      enabled: options.ctx?.verboseMode,
      command: "opencode",
      args: ["models", "opencode"],
      inGroup: true,
    });
    try {
      const raw = execFileSync("opencode", ["models", "opencode"], {
        encoding: "utf-8",
        timeout: 30000,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, TERM: "dumb" },
      });
      reporter.stdout(raw);
      _cachedFreeModels = filterFreeModelRefs(raw.trim().split("\n"));
    } catch (error) {
      if (error.stdout) reporter.stdout(error.stdout);
      if (error.stderr) reporter.stderr(error.stderr);
      reporter.stderr(error.message);
      _cachedFreeModels = ["opencode/mimo-v2.5-free"];
    } finally {
      reporter.finish();
    }
    return _cachedFreeModels;
  }

  _cachedFreeModels = [...new Set(freeModels)];
  return _cachedFreeModels;
}

export function filterFreeModelRefs(models) {
  let catalog = null;
  try {
    catalog = loadCatalogFromFiles();
  } catch {}

  return [...new Set(
    (models || [])
      .map((model) => String(model || "").trim())
      .filter((model) => {
        const { provider, model: id } = splitModelRef(model);
        if (!provider || !id) return false;
        if (provider === "opencode") return true;

        if (catalog && catalog[provider]?.models?.[id]) {
          const modelData = catalog[provider].models[id];
          const cost = modelData.cost || {};
          const caps = modelData.capabilities || {};
          return cost.input === 0 && cost.output === 0 && caps.toolcall === true;
        }
        return false;
      }),
  )];
}


export function getAccessibleModels(options = {}) {
  const reporter = createVerboseSubprocessReporter({
    enabled: options.ctx?.verboseMode,
    command: "opencode",
    args: ["models"],
    inGroup: true,
  });
  try {
    const output = execFileSync("opencode", ["models"], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30000,
      env: { ...process.env, TERM: "dumb" },
      encoding: "utf8",
    });
    reporter.stdout(output);
    return new Set(output.split("\n").map((line) => line.trim()).filter(Boolean));
  } catch (error) {
    if (error.stdout) reporter.stdout(error.stdout);
    if (error.stderr) reporter.stderr(error.stderr);
    reporter.stderr(error.message);
    if (error?.code === "ENOENT") return null;
    console.error("getAccessibleModels failed:", error.message, error.stderr);
    return null;
  } finally {
    reporter.finish();
  }
}

/**
 * Normalize a model object from OpenCode's catalog into the shape consumers expect.
 * The catalog uses its own field names and formats; this maps them to the
 * flattened conventions used by recommend scoring/matching code.
 * @param {string} modelId
 * @param {Object} raw - Raw model object from OpenCode models.json
 * @returns {Object} Normalized model object
 */
function normalizeCatalogModel(modelId, raw) {
  const normalized = { id: modelId };

  // family, description, knowledge, etc. — pass through as-is
  for (const k of ["family", "description", "knowledge", "reasoning", "tool_call", "temperature", "open_weights", "attachment", "name", "capabilities"]) {
    if (k in raw) normalized[k] = raw[k];
  }

  // context_length (from flat field or limit.context)
  if (raw.context_length != null) {
    normalized.context_length = raw.context_length;
  } else if (raw.limit?.context != null) {
    normalized.context_length = raw.limit.context;
  }

  // cost → pricing
  if (raw.cost != null) {
    normalized.pricing = { ...raw.cost };
  }

  // release_date → created (timestamp)
  if (raw.release_date) {
    const ts = Date.parse(raw.release_date);
    if (!Number.isNaN(ts)) normalized.created = ts;
  }

  // modalities {input: [...], output: [...], ...} → flat unique array
  if (raw.modalities && typeof raw.modalities === "object") {
    const seen = new Set();
    const flat = [];
    for (const entry of Object.values(raw.modalities)) {
      if (Array.isArray(entry)) {
        for (const m of entry) {
          if (typeof m === "string" && !seen.has(m)) {
            seen.add(m);
            flat.push(m);
          }
        }
      }
    }
    normalized.modalities = flat;
  }

  // variants (some catalog entries may have them)
  if (raw.variants) {
    normalized.variants = raw.variants;
  }

  return normalized;
}

function parseVerboseModels(output) {
  const result = {};
  const lines = output.split("\n");
  let currentRef = null;
  let jsonStr = "";
  let inJson = false;

  for (const line of lines) {
    if (!inJson) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith("{")) {
        inJson = true;
        jsonStr = line + "\n";
      } else {
        currentRef = trimmed;
        inJson = true;
        jsonStr = "";
      }
    } else {
      if (currentRef && line.trim() === "}") {
        jsonStr += line;
        try {
          const parsed = JSON.parse(jsonStr);
          const slash = currentRef.indexOf("/");
          if (slash !== -1) {
            const provider = currentRef.slice(0, slash);
            const modelId = currentRef.slice(slash + 1);
            if (!result[provider]) result[provider] = {};
            result[provider][modelId] = parsed;
          }
        } catch {
          // skip malformed entries
        }
        currentRef = null;
        jsonStr = "";
        inJson = false;
      } else if (currentRef) {
        jsonStr += line + "\n";
      }
    }
  }
  return result;
}

function fetchOpenRouterModerationMap() {
  return new Promise((resolve) => {
    const req = https.get("https://openrouter.ai/api/v1/models", {
      timeout: 5000,
      headers: { "User-Agent": "omo-recommend-models" },
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          const moderationMap = {};
          if (parsed?.data) {
            for (const model of parsed.data) {
              if (model?.id && model?.top_provider?.is_moderated !== undefined) {
                moderationMap[model.id] = model.top_provider.is_moderated;
              }
            }
          }
          resolve(moderationMap);
        } catch {
          resolve({});
        }
      });
    });
    req.on("error", () => resolve({}));
    req.on("timeout", () => { req.destroy(); resolve({}); });
  });
}

function enrichModelsFromVerbose(liveModels, verboseProviderModels, openrouterModerationMap = {}) {
  if (!verboseProviderModels) return liveModels;

  const enriched = [];
  const verboseKeys = new Set(Object.keys(verboseProviderModels));

  for (const modelId of liveModels) {
    if (verboseKeys.has(modelId)) {
      const modelData = verboseProviderModels[modelId];
      if (modelData?.capabilities?.toolcall !== true) continue;
      // Exclude OpenRouter models with is_moderated: true
      if (modelData?.providerID === "openrouter" && openrouterModerationMap[modelId] === true) {
        continue;
      }
      enriched.push(normalizeCatalogModel(modelId, modelData));
    } else {
      enriched.push(modelId);
    }
  }
  return enriched;
}

function enrichModelsFromCatalog(liveModels, catalogProviderObj) {
  if (!catalogProviderObj?.models) return liveModels;

  const liveSet = new Set(liveModels);
  const enriched = [];

  for (const [modelId, modelData] of Object.entries(catalogProviderObj.models)) {
    if (liveSet.has(modelId)) {
      const toolcallSupported = modelData?.capabilities
        ? modelData.capabilities.toolcall === true
        : true;
      if (toolcallSupported) {
        enriched.push(normalizeCatalogModel(modelId, modelData));
      }
    }
  }

  for (const modelId of liveModels) {
    if (!catalogProviderObj.models[modelId]) {
      enriched.push(modelId);
    }
  }
  return enriched;
}

export async function loadProviderModels(options = {}) {
  if (_cachedProviderModels) return _cachedProviderModels;
  const quiet = options.quiet === true;

  const accessible = getAccessibleModels(options);
  if (!accessible) {
    if (!quiet) {
      console.error("  ✗ opencode not available — cannot determine live provider models.");
      process.exit(1);
    }
    return null;
  }

  const models = {};
  for (const ref of accessible) {
    const slash = ref.indexOf("/");
    if (slash === -1) continue;
    const provider = ref.slice(0, slash);
    const modelId = ref.slice(slash + 1);
    if (!provider || !modelId) continue;
    if (!models[provider]) models[provider] = [];
    models[provider].push(modelId);
  }

  const openrouterModerationMap = models.openrouter ? await fetchOpenRouterModerationMap() : {};

  const verboseReporter = createVerboseSubprocessReporter({
    enabled: options.ctx?.verboseMode,
    command: "opencode",
    args: ["models", "--verbose"],
    inGroup: true,
  });
  let verboseOutput;
  try {
    verboseOutput = execFileSync("opencode", ["models", "--verbose"], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30000,
      env: { ...process.env, TERM: "dumb" },
      encoding: "utf8",
    });
    verboseReporter.stdout(verboseOutput);
    const verboseMap = parseVerboseModels(verboseOutput);
    if (Object.keys(verboseMap).length === 0) throw new Error("verbose output empty");

    for (const [providerId, liveModels] of Object.entries(models)) {
      const verboseProviderModels = verboseMap[providerId];
      const enriched = enrichModelsFromVerbose(liveModels, verboseProviderModels, openrouterModerationMap);
      if (enriched.length > 0) models[providerId] = enriched;
    }
  } catch (error) {
    if (verboseOutput === undefined) {
      if (error.stdout) verboseReporter.stdout(error.stdout);
      if (error.stderr) verboseReporter.stderr(error.stderr);
      verboseReporter.stderr(error.message);
    }
    try {
      const rawModels = loadCatalogFromFiles();
      for (const [providerId, providerObj] of Object.entries(rawModels)) {
        const liveModels = models[providerId];
        if (!liveModels) continue;

        const enriched = enrichModelsFromCatalog(liveModels, providerObj);
        if (enriched.length > 0) models[providerId] = enriched;
      }
    } catch {
      // both verbose and catalog enrichment failed — models remain as strings
    }
  } finally {
    verboseReporter.finish();
  }

  _cachedProviderModels = { models };
  return _cachedProviderModels;
}
