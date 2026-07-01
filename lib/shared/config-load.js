import fs from "node:fs";

import { getConfigPath } from "./config-paths.js";
import { defaultConfig } from "./default-config.js";
import { jsoncParse } from "./jsonc.js";

export function loadConfig() {
  if (!fs.existsSync(getConfigPath())) return defaultConfig();
  return jsoncParse(fs.readFileSync(getConfigPath(), "utf-8"));
}
