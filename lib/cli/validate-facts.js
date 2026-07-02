import fs from "node:fs";
import path from "node:path";

import {
  buildProviderAliases,
  buildRichModelLookup,
  discoverLocalModels,
  loadProviderModels,
} from "../omo-shared.js";

function loadCatalogLocalNames(names) {
  const catalogPath = path.join(
    process.env.HOME || "/home/workshop",
    ".cache",
    "oh-my-opencode",
    "ollama-models.json",
  );
  if (!fs.existsSync(catalogPath)) return false;

  try {
    const raw = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
    const models = Array.isArray(raw) ? raw : raw?.ollama?.models;
    for (const item of Array.isArray(models) ? models : []) {
      const name = typeof item === "string" ? item : item?.name;
      if (name) names.add(name);
    }
  } catch {}
  return true;
}

function loadLocalFacts() {
  const names = new Set();
  let available = loadCatalogLocalNames(names);
  const discovered = discoverLocalModels();
  if (discovered.length > 0) available = true;
  for (const name of discovered) names.add(name);
  return { available, names };
}

export function buildFacts(config) {
  const cache = loadProviderModels({ refresh: false, quiet: true });
  return {
    aliases: buildProviderAliases(config),
    modelLookup: buildRichModelLookup(cache),
    hasProviderCache: Boolean(cache && cache.models),
    local: loadLocalFacts(),
  };
}
