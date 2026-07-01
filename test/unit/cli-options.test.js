import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
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

test("parseCliOptions maps aliases and repeated panel models", () => {
  const result = parseCliOptions([
    "-y",
    "--cloud-only",
    "--exclude-codex-cli",
    "--model",
    "opencode/one",
    "--model",
    "provider/two",
  ]);

  assert.equal(result._explicitYes, true);
  assert.equal(result["exclude-local"], true);
  assert.equal(result["exclude-codex"], true);
  assert.deepEqual(result.model, ["opencode/one", "provider/two"]);
});

test("parseCliOptions preserves negated option intent", () => {
  const result = parseCliOptions([
    "--no-cache",
    "--no-install",
    "--no-uninstall",
    "--no-remove-orphans",
    "--no-apply",
    "--no-free-panel",
    "--no-free-config",
    "--no-exclude-free",
    "--no-yes",
  ]);

  assert.equal(result.cache, false);
  assert.equal(result.install, false);
  assert.equal(result.uninstall, false);
  assert.equal(result["remove-orphans"], false);
  assert.equal(result.apply, false);
  assert.equal(result._noFreePanelExplicit, true);
  assert.equal(result._noFreeConfigExplicit, true);
  assert.equal(result._noExcludeFreeExplicit, true);
  assert.equal(result._explicitYes, false);
});

test("parseCliOptions exposes help and version flags without exiting", () => {
  assert.equal(parseCliOptions(["--help"]).help, true);
  assert.equal(parseCliOptions(["-v"]).version, true);
  assert.equal(CLI_VERSION, packageJson.version);
  assert.match(usage(), /^Usage: omo-recommend-models \[options\]/);
});

test("parseCliOptions throws for unknown options without exiting", () => {
  assert.throws(
    () => parseCliOptions(["--unknown-option"]),
    /unknown option '--unknown-option'/,
  );
});
