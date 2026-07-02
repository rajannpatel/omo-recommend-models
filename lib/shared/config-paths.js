import fs from "node:fs";
import path from "node:path";

let configPath = null;
let configDir = null;

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

export function getConfigPath() {
  if (!configPath) {
    configPath = resolveConfigPath();
    configDir = path.dirname(configPath);
    try {
      fs.mkdirSync(configDir, { recursive: true });
    } catch {}
  }
  return configPath;
}

export function getConfigDir() {
  getConfigPath();
  return configDir;
}

export function getBackupPath() {
  return `${getConfigPath()}.pre-recommend`;
}
