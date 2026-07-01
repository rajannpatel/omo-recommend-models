import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { CACHE_PATH } from "./config-paths.js";

export function discoverFreeModels() {
  try {
    const raw = execFileSync("opencode", ["models"], {
      encoding: "utf-8",
      timeout: 15000,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, TERM: "dumb" },
    });
    return raw.trim().split("\n").map((model) => model.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

export function getAccessibleModels() {
  try {
    const output = execFileSync("opencode", ["models", "--pure"], {
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

export function loadProviderModels(options = {}) {
  const refresh = options.refresh !== false;
  const quiet = options.quiet === true;
  let cache = readProviderCache(quiet);

  if (!cache) {
    cache = refreshProviderCache({ refresh, quiet });
  }
  if (cache?.models) {
    const accessible = getAccessibleModels();
    if (accessible) cache.models = filterAccessibleModels(cache.models, accessible);
  }
  return cache;
}

function readProviderCache(quiet) {
  if (!fs.existsSync(CACHE_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, "utf-8"));
  } catch (error) {
    if (!quiet) console.error(`  ✗ Failed to read provider-models cache: ${error.message}`);
    return null;
  }
}

function refreshProviderCache({ refresh, quiet }) {
  const opencodeModelsPath = path.join(
    process.env.HOME || "/home/workshop",
    ".cache",
    "opencode",
    "models.json",
  );
  if (!fs.existsSync(opencodeModelsPath)) {
    if (!refresh) return null;
    if (!quiet) console.log("⚠ Provider-models cache not found. Refreshing...");
    try {
      execFileSync("opencode", ["models", "--refresh", "--pure"], {
        stdio: ["ignore", "pipe", "inherit"],
        timeout: 60000,
        env: { ...process.env, TERM: "dumb" },
      });
      if (!quiet) console.log("  ✓ Cache populated.");
    } catch {
      if (!quiet) console.error("  ✗ Failed to refresh models cache. Run OpenCode once to populate it.");
      return null;
    }
  }
  return fs.existsSync(opencodeModelsPath) ? convertOpencodeModels(opencodeModelsPath, quiet) : null;
}

function convertOpencodeModels(opencodeModelsPath, quiet) {
  try {
    const rawModels = JSON.parse(fs.readFileSync(opencodeModelsPath, "utf-8"));
    const convertedModels = {};
    for (const [providerId, providerObj] of Object.entries(rawModels)) {
      if (providerObj?.models) convertedModels[providerId] = Object.values(providerObj.models);
    }
    return { models: convertedModels };
  } catch (error) {
    if (!quiet) console.error(`  ✗ Failed to process models.json: ${error.message}`);
    return null;
  }
}

function filterAccessibleModels(models, accessible) {
  const convertedModels = {};
  for (const [providerId, modelsArray] of Object.entries(models)) {
    const filtered = modelsArray.filter((model) => {
      const id = typeof model === "string" ? model : model.id;
      return accessible.has(`${providerId}/${id}`) || accessible.has(id);
    });
    if (filtered.length > 0) convertedModels[providerId] = filtered;
  }
  return convertedModels;
}
