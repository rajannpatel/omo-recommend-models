import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { splitModelRef } from "./model-refs.js";


export function discoverFreeModels() {
  try {
    const raw = execFileSync("opencode", ["models", "opencode"], {
      encoding: "utf-8",
      timeout: 15000,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, TERM: "dumb" },
    });
    return filterFreeModelRefs(raw.trim().split("\n"));
  } catch {
    return [];
  }
}

export function filterFreeModelRefs(models) {
  return [...new Set(
    (models || [])
      .map((model) => String(model || "").trim())
      .filter((model) => {
        const { provider, model: id } = splitModelRef(model);
        return provider === "opencode" && id.length > 0;
      }),
  )];
}

export function getAccessibleModels() {
  try {
    const output = execFileSync("opencode", ["models"], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10000,
      env: { ...process.env, TERM: "dumb" },
      encoding: "utf8",
    });
    return new Set(output.split("\n").map((line) => line.trim()).filter(Boolean));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    console.error("getAccessibleModels failed:", error.message, error.stderr);
    return null;
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
  for (const k of ["family", "description", "knowledge", "reasoning", "tool_call", "temperature", "open_weights", "attachment", "name"]) {
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

export function loadProviderModels(options = {}) {
  const quiet = options.quiet === true;

  const accessible = getAccessibleModels();
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

  // Enrich with model metadata from OpenCode's definition catalog (NOT auth state)
  const opencodeModelsPath = path.join(
    process.env.HOME || "/home/workshop",
    ".cache",
    "opencode",
    "models.json",
  );
  if (fs.existsSync(opencodeModelsPath)) {
    try {
      const rawModels = JSON.parse(fs.readFileSync(opencodeModelsPath, "utf-8"));
      for (const [providerId, providerObj] of Object.entries(rawModels)) {
        const liveModels = models[providerId];
        if (!liveModels || !providerObj?.models) continue;

        const liveSet = new Set(liveModels);
        const enriched = [];

        for (const [modelId, modelData] of Object.entries(providerObj.models)) {
          if (liveSet.has(modelId)) {
            enriched.push(normalizeCatalogModel(modelId, modelData));
          }
        }

        for (const modelId of liveModels) {
          if (!providerObj.models[modelId]) {
            enriched.push(modelId);
          }
        }

        if (enriched.length > 0) models[providerId] = enriched;
      }
    } catch {
      // metadata enrichment failure is non-fatal — models remain as strings
    }
  }

  return { models };
}

