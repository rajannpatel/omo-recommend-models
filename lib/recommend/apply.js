import fs from "node:fs";
import { execFileSync } from "node:child_process";

const DEFAULT_SCHEMA =
  "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/master/assets/oh-my-opencode.schema.json";
const GIT_MASTER_DEFAULT = {
  commit_footer: true,
  include_co_authored_by: true,
  git_env_prefix: "GIT_MASTER=1",
};

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

function runValidator(validatorPath, stdio = "inherit", configPath = null) {
  const args = configPath ? [validatorPath, "--config", configPath] : [validatorPath];
  execFileSync(process.execPath, args, {
    stdio,
    env: { ...process.env, TERM: "dumb" },
  });
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function canonicalizeGeneratedModelRef(value) {
  if (typeof value !== "string") return value;
  return value.startsWith("ollama/")
    ? `local/${value.slice("ollama/".length)}`
    : value;
}

function canonicalizeGeneratedPlacement(value) {
  if (typeof value === "string") return canonicalizeGeneratedModelRef(value);
  if (isPlainObject(value) && typeof value.model === "string") {
    value.model = canonicalizeGeneratedModelRef(value.model);
  }
  return value;
}

function cleanGeneratedSection(section) {
  if (!isPlainObject(section)) return;
  delete section.routing;
  delete section.model_quality;

  if (typeof section.model === "string") {
    section.model = canonicalizeGeneratedModelRef(section.model);
  }
  if (Array.isArray(section.fallback_models)) {
    section.fallback_models = section.fallback_models.map(
      canonicalizeGeneratedPlacement,
    );
  } else if (typeof section.fallback_models === "string") {
    section.fallback_models = canonicalizeGeneratedModelRef(
      section.fallback_models,
    );
  }
}

function prepareGeneratedConfig(config) {
  if (!isPlainObject(config)) return config;

  if (typeof config.$schema !== "string" || config.$schema.trim() === "") {
    config.$schema = DEFAULT_SCHEMA;
  }
  if (!isPlainObject(config.git_master)) {
    config.git_master = { ...GIT_MASTER_DEFAULT };
  } else {
    for (const [key, value] of Object.entries(GIT_MASTER_DEFAULT)) {
      if (!(key in config.git_master)) config.git_master[key] = value;
    }
  }

  for (const sectionGroup of [config.agents, config.categories]) {
    if (!isPlainObject(sectionGroup)) continue;
    for (const section of Object.values(sectionGroup)) {
      cleanGeneratedSection(section);
    }
  }
  return config;
}

function writeConfigWithValidation({
  config,
  configPath,
  backupPath,
  validatorPath,
  validateStdio = "inherit",
}) {
  const backedUp = backupConfig(configPath, backupPath);
  const generatedConfig = prepareGeneratedConfig(config);
  fs.writeFileSync(configPath, `${JSON.stringify(generatedConfig, null, 2)}\n`, "utf-8");

  try {
    runValidator(validatorPath, validateStdio, configPath);
  } catch (err) {
    if (backedUp) restoreConfig(configPath, backupPath);
    throw err;
  }

  return { backedUp };
}

export {
  backupConfig,
  prepareGeneratedConfig,
  restoreConfig,
  runValidator,
  writeConfigWithValidation,
};
