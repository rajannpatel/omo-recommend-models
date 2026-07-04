import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  runValidator,
  writeConfigWithValidation,
} from "../../lib/recommend/apply.js";

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omo-apply-test-"));
  t.after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

function writeValidator(dir, body) {
  const validatorPath = path.join(dir, "validator.js");
  fs.writeFileSync(
    validatorPath,
    `#!/usr/bin/env node\n${body}\n`,
    { mode: 0o755 },
  );
  return validatorPath;
}

test("runValidator invokes validation without repair flags", (t) => {
  const dir = tempDir(t);
  const argsPath = path.join(dir, "args.json");
  const validatorPath = writeValidator(
    dir,
    `const fs = require("node:fs");
fs.writeFileSync(${JSON.stringify(argsPath)}, JSON.stringify(process.argv.slice(2)));
if (process.argv.includes("--fix")) process.exit(7);`,
  );

  runValidator(validatorPath, "pipe");

  assert.deepEqual(JSON.parse(fs.readFileSync(argsPath, "utf8")), []);
});

test("writeConfigWithValidation writes schema-clean generated config before validating", (t) => {
  const dir = tempDir(t);
  const configPath = path.join(dir, "oh-my-openagent.jsonc");
  const backupPath = path.join(dir, "oh-my-openagent.jsonc.bak");
  fs.writeFileSync(configPath, "{}\n");
  const validatorPath = writeValidator(
    dir,
    `const fs = require("node:fs");
const args = process.argv.slice(2);
if (JSON.stringify(args) !== JSON.stringify(["--config", ${JSON.stringify(configPath)}])) {
  process.stderr.write("validator did not receive generated config path");
  process.exit(9);
}
const config = JSON.parse(fs.readFileSync(${JSON.stringify(configPath)}, "utf8"));
const section = config.agents?.sisyphus || {};
if (section.routing || section.model_quality || !config.git_master) {
  process.stderr.write("generated config is not schema-clean");
  process.exit(8);
}`,
  );

  writeConfigWithValidation({
    config: {
      agents: {
        sisyphus: {
          description: "Primary orchestrator",
          model_quality: "balanced",
          model: "ollama/local-model-a:latest",
          routing: ["opencode/north-mini-code-free"],
          fallback_models: ["ollama/local-model-b:latest"],
        },
      },
      categories: {},
    },
    configPath,
    backupPath,
    validatorPath,
    validateStdio: "pipe",
  });

  const written = JSON.parse(fs.readFileSync(configPath, "utf8"));
  assert.equal(
    written.$schema,
    "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/oh-my-opencode.schema.json",
  );
  assert.equal("routing" in written.agents.sisyphus, false);
  assert.equal("model_quality" in written.agents.sisyphus, false);
  assert.equal(written.agents.sisyphus.model, "local/local-model-a:latest");
  assert.deepEqual(written.agents.sisyphus.fallback_models, [
    "local/local-model-b:latest",
  ]);
  assert.equal("git_master" in written, true);
});
