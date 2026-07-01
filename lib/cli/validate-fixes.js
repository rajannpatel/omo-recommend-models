import fs from "node:fs";

import {
  DEFAULT_SCHEMA,
  GIT_MASTER_DEFAULT,
} from "./validate-constants.js";
import {
  canonicalizeModelRef,
  isPlainObject,
  refFromParts,
} from "./validate-utils.js";

function objectToRef(value) {
  if (!isPlainObject(value)) return null;
  const keys = Object.keys(value);
  if (keys.length === 1 && typeof value.model === "string") return value.model;
  if (
    keys.length === 2 &&
    typeof value.provider === "string" &&
    typeof value.model === "string"
  ) {
    return refFromParts(value.provider, value.model);
  }
  return null;
}

function fixPlacementValue(value) {
  if (typeof value === "string") return canonicalizeModelRef(value);
  const asRef = objectToRef(value);
  if (asRef) return canonicalizeModelRef(asRef);
  if (isPlainObject(value) && typeof value.model === "string") {
    value.model = canonicalizeModelRef(value.model);
  }
  return value;
}

function fixSection(section) {
  let changed = false;
  if (!isPlainObject(section)) return changed;

  if (typeof section.model === "string") {
    const next = canonicalizeModelRef(section.model);
    if (next !== section.model) {
      section.model = next;
      changed = true;
    }
  }
  for (const key of ["routing", "model_quality"]) {
    if (key in section) {
      delete section[key];
      changed = true;
    }
  }
  if (Array.isArray(section.fallback_models)) {
    const nextFallbacks = section.fallback_models.map(fixPlacementValue);
    if (JSON.stringify(nextFallbacks) !== JSON.stringify(section.fallback_models)) {
      section.fallback_models = nextFallbacks;
      changed = true;
    }
    if (section.fallback_models.length === 0) {
      delete section.fallback_models;
      changed = true;
    }
  }
  if (typeof section.fallback_models === "string") {
    const next = canonicalizeModelRef(section.fallback_models);
    if (next !== section.fallback_models) {
      section.fallback_models = next;
      changed = true;
    }
  }
  return changed;
}

export function applyFixes(config) {
  let changed = false;
  if (isPlainObject(config) && typeof config.$schema !== "string") {
    config.$schema = DEFAULT_SCHEMA;
    changed = true;
  }
  if (isPlainObject(config) && !isPlainObject(config.git_master)) {
    config.git_master = { ...GIT_MASTER_DEFAULT };
    changed = true;
  } else if (isPlainObject(config?.git_master)) {
    for (const [key, value] of Object.entries(GIT_MASTER_DEFAULT)) {
      if (!(key in config.git_master)) {
        config.git_master[key] = value;
        changed = true;
      }
    }
  }
  for (const sectionGroup of [config.agents, config.categories]) {
    if (!isPlainObject(sectionGroup)) continue;
    for (const section of Object.values(sectionGroup)) {
      if (fixSection(section)) changed = true;
    }
  }
  return changed;
}

export function writeFixedConfig(configPath, config) {
  const backupPath = `${configPath}.bak`;
  fs.copyFileSync(configPath, backupPath);
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return backupPath;
}
