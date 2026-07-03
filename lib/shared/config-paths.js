import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let configPath = null;
let configDir = null;

function resolveGlobalConfigPath() {
  return path.join(os.homedir(), ".config", "opencode", "oh-my-openagent.jsonc");
}

function resolveConfigPath() {
  let dir = process.cwd();
  while (true) {
    const jsoncFile = path.join(dir, ".opencode", "oh-my-openagent.jsonc");
    const jsonFile = path.join(dir, ".opencode", "oh-my-openagent.json");
    if (fs.existsSync(jsoncFile)) return jsoncFile;
    if (fs.existsSync(jsonFile)) return jsonFile;
    if (fs.existsSync(path.join(dir, "workshop.yaml")) || fs.existsSync(path.join(dir, ".gitignore"))) {
      return jsoncFile;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.join(process.cwd(), ".opencode", "oh-my-openagent.jsonc");
}

export function getConfigPath({ global: isGlobal } = {}) {
  if (isGlobal) {
    const p = resolveGlobalConfigPath();
    const d = path.dirname(p);
    try {
      fs.mkdirSync(d, { recursive: true });
    } catch {}
    return p;
  }
  if (!configPath) {
    configPath = resolveConfigPath();
    configDir = path.dirname(configPath);
    try {
      fs.mkdirSync(configDir, { recursive: true });
    } catch {}
  }
  return configPath;
}

export function getConfigDir({ global: isGlobal } = {}) {
  if (isGlobal) {
    return path.dirname(resolveGlobalConfigPath());
  }
  getConfigPath();
  return configDir;
}

export function getBackupPath({ global: isGlobal } = {}) {
  return `${getConfigPath({ global: isGlobal })}.pre-recommend`;
}
