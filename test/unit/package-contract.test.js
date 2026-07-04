import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  CLI_VERSION,
  DEFAULT_SCHEMA,
  parseCliOptions,
  runValidateConfigCli,
  validateConfigUsage,
} from "../../lib/index.js";
import { defaultConfig } from "../../lib/shared/default-config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const packageJson = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"),
);

test("package exposes both npx command entrypoints", () => {
  assert.deepEqual(Object.keys(packageJson.bin).sort(), [
    "omo-recommend-models",
    "omo-validate-config",
  ]);

  for (const relativePath of Object.values(packageJson.bin)) {
    const absolutePath = path.join(repoRoot, relativePath);
    assert.equal(fs.existsSync(absolutePath), true);
    assert.equal(fs.readFileSync(absolutePath, "utf8").startsWith("#!/usr/bin/env node"), true);
  }
});

test("public package entry exports stable CLI helpers", () => {
  assert.equal(CLI_VERSION, packageJson.version);
  assert.equal(
    DEFAULT_SCHEMA,
    "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/oh-my-opencode.schema.json",
  );
  assert.equal(typeof parseCliOptions, "function");
  assert.equal(typeof runValidateConfigCli, "function");
  assert.match(validateConfigUsage(), /^Usage: omo-validate-config \[--config <path>\]/);
});

test("generated default config uses the stable upstream schema branch", () => {
  assert.equal(defaultConfig().$schema, DEFAULT_SCHEMA);
});

test("package export map resolves from package self-reference", () => {
  const importOutput = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      "import('omo-recommend-models').then((m) => console.log(m.CLI_VERSION))",
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );
  assert.equal(importOutput.trim(), packageJson.version);
});

test("bin shims execute the extracted CLI modules", () => {
  const recommendOutput = execFileSync(
    process.execPath,
    [path.join(repoRoot, packageJson.bin["omo-recommend-models"]), "--version"],
    { encoding: "utf8" },
  );
  assert.equal(recommendOutput.trim(), CLI_VERSION);

  const validateOutput = execFileSync(
    process.execPath,
    [path.join(repoRoot, packageJson.bin["omo-validate-config"]), "--help"],
    { encoding: "utf8" },
  );
  assert.match(validateOutput, /^Usage: omo-validate-config \[--config <path>\]/);
});
