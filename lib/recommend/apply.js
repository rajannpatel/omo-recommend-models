import fs from "node:fs";
import { execFileSync } from "node:child_process";

function backupConfig(configPath, backupPath) {
  if (!fs.existsSync(configPath)) return false;
  fs.copyFileSync(configPath, backupPath);
  return true;
}

function restoreConfig(configPath, backupPath) {
  if (!fs.existsSync(backupPath)) return false;
  fs.copyFileSync(backupPath, configPath);
  return true;
}

function runValidator(validatorPath, stdio = "inherit") {
  execFileSync(process.execPath, [validatorPath, "--fix"], {
    stdio,
    env: { ...process.env, TERM: "dumb" },
  });
}

function writeConfigWithValidation({
  config,
  configPath,
  backupPath,
  validatorPath,
  validateStdio = "inherit",
}) {
  const backedUp = backupConfig(configPath, backupPath);
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf-8");

  try {
    runValidator(validatorPath, validateStdio);
  } catch (err) {
    if (backedUp) restoreConfig(configPath, backupPath);
    throw err;
  }

  return { backedUp };
}

export { backupConfig, restoreConfig, runValidator, writeConfigWithValidation };
