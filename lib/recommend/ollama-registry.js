/**
 * ollama-registry.js — Ollama registry model catalog discovery.
 *
 * Extracted from bin/omo-recommend-models (L435-512). Discovers models
 * from the Ollama registry API, caches results, and returns structured
 * model entries with size/VRAM/score metadata.
 */

import fs from "node:fs";
import path from "node:path";
import { MODEL_CACHE_FILE, KNOWN_MODELS } from "../constants.js";
import { parseOllamaManifestWeightGb } from "./local-model-metadata.js";

// ---------------------------------------------------------------------------
// Registry API helper
// ---------------------------------------------------------------------------

async function execCurl(url, accept, _fetchUrl) {
  if (typeof _fetchUrl !== "function") return null;
  return await _fetchUrl(url, accept);
}

function parameterCountFromTag(tag) {
  const mixtureMatch = tag.match(/(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)b/i);
  if (mixtureMatch) return Number.parseFloat(mixtureMatch[1]) * Number.parseFloat(mixtureMatch[2]);
  const parameterMatch = tag.match(/(\d+(?:\.\d+)?)b/i);
  return parameterMatch ? Number.parseFloat(parameterMatch[1]) : null;
}

function roundTenth(value) {
  return Math.round(value * 10) / 10;
}

async function registryModelSizeGb(name, tag, _fetchUrl) {
  const url = `https://registry.ollama.ai/v2/library/${encodeURIComponent(name)}/manifests/${encodeURIComponent(tag)}`;
  const json = await execCurl(
    url,
    "application/vnd.docker.distribution.manifest.v2+json",
    _fetchUrl,
  );
  if (!json) return null;
  try {
    const manifest = JSON.parse(json);
    return parseOllamaManifestWeightGb(manifest);
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
export async function discoverModels(forceRefresh = false, progress = null, _fetchUrl = null) {
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
  if (progress?.setTotal) progress.setTotal(total);
  for (const entry of KNOWN_MODELS) {
    for (const tag of entry.tags) {
      const name = `${entry.name}:${tag}`;
      if (progress?.set) progress.set(models.length + 1, name);
      else if (progress) progress.update(`${models.length + 1}/${total} ${name}`);
      const sizeGb = await registryModelSizeGb(entry.name, tag, _fetchUrl);
      const parametersB = parameterCountFromTag(tag);
      const vram = sizeGb ?? parametersB ?? 0;
      const score = Math.round((parametersB ?? sizeGb ?? 0) * 10);
      models.push({
        name,
        size: sizeGb != null ? `${sizeGb.toFixed(1)} GB` : "unknown",
        vram: roundTenth(vram),
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
