import fs from "node:fs";

import { getConfigPath } from "./config-paths.js";
import { defaultConfig } from "./default-config.js";
import { jsoncParse } from "./jsonc.js";

export function loadConfig({ global: isGlobal } = {}) {
  const configPath = getConfigPath({ global: isGlobal });
  if (!fs.existsSync(configPath)) return defaultConfig();
  return jsoncParse(fs.readFileSync(configPath, "utf-8"));
}
