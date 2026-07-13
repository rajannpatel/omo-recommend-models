import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  CLI_VERSION,
  parseCliOptions,
  usage,
} from "../../lib/cli-options.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageJson = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "..", "..", "package.json"), "utf8"),
);
const repoRoot = path.resolve(__dirname, "..", "..");

test("parseCliOptions preserves negated option intent", () => {
  const result = parseCliOptions([
    "--no-install",
    "--no-uninstall",
    "--no-remove-orphans",
    "--no-apply",
    "--no-free-config",
  ]);

  assert.equal(result.install, false);
  assert.equal(result.uninstall, false);
  assert.equal(result["remove-orphans"], false);
  assert.equal(result.apply, false);
  assert.equal(result._noFreeConfigExplicit, true);
});

test("parseCliOptions exposes help and version flags without exiting", () => {
  assert.equal(parseCliOptions(["--help"]).help, true);
  assert.equal(parseCliOptions(["-v"]).version, true);
  assert.equal(CLI_VERSION, packageJson.version);
  assert.match(usage(), /^Usage: omo-recommend-models \[options\]/);
});

test("parseCliOptions keeps verbose independent from debug", () => {
  const result = parseCliOptions([
    "--exclude-model=provider/two",
    "--debug",
    "--verbose",
  ]);

  assert.deepEqual(result["exclude-model"], ["provider/two"]);
  assert.equal(result.debug, true);
  assert.equal(result.verbose, true);
  assert.equal(parseCliOptions([]).verbose, false);
  assert.match(usage(), /--verbose\s+Show executed commands/);
  assert.throws(() => parseCliOptions(["--verbose=true"]), /does not take a value/);
});

test("parseCliOptions parses --global flag", () => {
  const result = parseCliOptions(["--global"]);
  assert.equal(result.global, true);
});

test("parseCliOptions defaults global to false", () => {
  const result = parseCliOptions(["-y"]);
  assert.equal(result.global, false);
});

test("usage output includes --global flag", () => {
  assert.match(usage(), /--global/);
});

test("usage output documents cost-based free config filtering", () => {
  assert.match(usage(), /--free-config\s+Include zero-cost models/);
  assert.match(usage(), /--no-free-config\s+Exclude zero-cost models/);
});

test("parseCliOptions throws for unknown options without exiting", () => {
  assert.throws(
    () => parseCliOptions(["--unknown-option"]),
    /unknown option '--unknown-option'/,
  );
});

test("recommend bin version runs without installed third-party modules", (t) => {
  let output;
  try {
    output = execFileSync(
      process.execPath,
      [path.join(repoRoot, packageJson.bin["omo-recommend-models"]), "--version"],
      { cwd: "/tmp", encoding: "utf8" },
    );
  } catch (error) {
    if (error.code === "EPERM") {
      t.skip("child process execution is blocked in this test sandbox");
      return;
    }
    throw error;
  }

  assert.equal(output.trim(), CLI_VERSION);
});
