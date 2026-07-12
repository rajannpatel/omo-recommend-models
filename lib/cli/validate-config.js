import { parseArgs, parseConfigFile, usage } from "./validate-args.js";
import { DEFAULT_SCHEMA } from "./validate-constants.js";
import { validateConfig } from "./validate-config-core.js";
import { applyFixes, writeFixedConfig } from "./validate-fixes.js";

export {
  DEFAULT_SCHEMA,
  applyFixes,
  parseArgs,
  usage,
  validateConfig,
};

export async function runValidateConfigCli(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(error.message);
    console.error(usage());
    return 2;
  }

  if (options.help) {
    console.log(usage());
    return 0;
  }

  let config;
  try {
    ({ config } = parseConfigFile(options.configPath));
  } catch (error) {
    console.error(error.message);
    return 1;
  }

  const fixed = options.fix ? applyFixes(config) : false;
  const errors = await validateConfig(config);
  if (errors.length > 0) {
    for (const error of errors) console.error(error);
    return 1;
  }

  if (options.fix && fixed) {
    const backupPath = writeFixedConfig(options.configPath, config);
    console.log(`│  \u2022 Config valid after fixes: ${options.configPath}`);
    console.log(`Backup: ${backupPath}`);
    return 0;
  }

  console.log(`│  \u2022 Config valid: ${options.configPath}`);
  return 0;
}
