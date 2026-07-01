import fs from "node:fs";
import path from "node:path";

import { getConfigPath, jsoncParse } from "../omo-shared.js";

export function usage() {
  return [
    "Usage: omo-validate-config [--config <path>] [--fix] [--help]",
    "",
    "Validate the local oh-my-openagent.jsonc subset written by OMO tooling.",
    "",
    "Options:",
    "  --config <path>  Validate a specific JSONC config file",
    "  --fix            Apply safe mechanical fixes after creating <path>.bak",
    "  --help           Show this help",
  ].join("\n");
}

export function parseArgs(argv) {
  const options = { configPath: getConfigPath(), fix: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--fix") {
      options.fix = true;
    } else if (arg === "--config") {
      const value = argv[++i];
      if (!value) throw new Error("--config requires a path");
      options.configPath = path.resolve(value);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

export function parseConfigFile(configPath) {
  let text;
  try {
    text = fs.readFileSync(configPath, "utf8");
  } catch (error) {
    throw new Error(`${configPath}: ${error.message}`);
  }

  try {
    return { config: jsoncParse(text), text };
  } catch (error) {
    throw new Error(`JSONC parse error: ${error.message}`);
  }
}
