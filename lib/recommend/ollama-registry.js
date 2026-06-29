/**
 * ollama-registry.js — Ollama registry model catalog discovery.
 *
 * Extracted from bin/omo-recommend-models (L435-512). Discovers models
 * from the Ollama registry API, caches results, and returns structured
 * model entries with size/VRAM/score metadata.
 */

import fs from "node:fs";
import path from "node:path";
import {
  MODEL_CACHE_FILE,
  KNOWN_MODELS,
  MODEL_SCORES,
  BASE_VRAM,
} from "../constants.js";

// ---------------------------------------------------------------------------
// Registry API helper
// ---------------------------------------------------------------------------

function execCurl(url, accept, _fetchUrl) {
  return _fetchUrl(url, accept);
}

function registryModelSizeGb(name, tag, _fetchUrl) {
  const url = `https://registry.ollama.ai/v2/library/${encodeURIComponent(name)}/manifests/${encodeURIComponent(tag)}`;
  const json = execCurl(
    url,
    "application/vnd.docker.distribution.manifest.v2+json",
    _fetchUrl,
  );
  if (!json) return null;
  try {
    const manifest = JSON.parse(json);
    for (const layer of manifest.layers || []) {
      if (layer.mediaType === "application/vnd.ollama.image.model")
        return layer.size / 1e9;
    }
    return null;
  } catch (_) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Local file cache
// ---------------------------------------------------------------------------

function loadCachedModels() {
  try {
    if (fs.existsSync(MODEL_CACHE_FILE))
      return JSON.parse(fs.readFileSync(MODEL_CACHE_FILE, "utf-8"));
  } catch (_) {}
  return null;
}

function saveCachedModels(models) {
  try {
    const dir = path.dirname(MODEL_CACHE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      MODEL_CACHE_FILE,
      JSON.stringify(models, null, 2),
      "utf-8",
    );
  } catch (_) {}
}

// ---------------------------------------------------------------------------
// Main discovery function
// ---------------------------------------------------------------------------

/**
 * Discover models from the Ollama registry catalog.
 *
 * Accepts _fetchUrl (typically subprocess.fetchUrl) as a dependency so the
 * module does not need a direct reference to the CLI runtime.
 *
 * Returns an array of { name, size, vram, score, baseModel, tag }.
 */
export function discoverModels(forceRefresh = false, progress = null, _fetchUrl = null) {
  const cached = forceRefresh ? null : loadCachedModels();
  if (Array.isArray(cached)) {
    if (progress) progress.done(`${cached.length} cached models`);
    return cached;
  }
  const models = [];
  const total = KNOWN_MODELS.reduce(
    (count, entry) => count + entry.tags.length,
    0,
  );
  for (const entry of KNOWN_MODELS) {
    for (const tag of entry.tags) {
      const name = `${entry.name}:${tag}`;
      if (progress) progress.update(`${models.length + 1}/${total} ${name}`);
      const sizeGb = registryModelSizeGb(entry.name, tag, _fetchUrl);
      const bMatch = tag.match(/(\d+(?:\.\d+)?)b/i);
      const bSize = bMatch ? parseFloat(bMatch[1]) : null;
      const baseVram = BASE_VRAM[entry.name] || 3;
      const vram = bSize ? (baseVram / 7) * bSize : baseVram;
      const score = MODEL_SCORES[entry.name] || 30;
      models.push({
        name,
        size: sizeGb != null ? `${sizeGb.toFixed(1)} GB` : "unknown",
        vram: Math.round(vram * 10) / 10,
        score,
        baseModel: entry.name,
        tag,
      });
    }
  }
  if (!forceRefresh) saveCachedModels(models);
  if (progress) progress.done(`${models.length} models cataloged`);
  return models;
}
