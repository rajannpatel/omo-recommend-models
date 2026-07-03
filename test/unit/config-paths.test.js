import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const configPathsUrl = pathToFileURL(path.join(repoRoot, "lib", "shared", "config-paths.js"));

test("getBackupPath uses a generic recommendation backup suffix", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "omo-config-paths-test-"));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(tempDir, ".gitignore"), "node_modules\n");

  const output = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { getBackupPath } from '${configPathsUrl.href}'; console.log(getBackupPath());`,
    ],
    { cwd: tempDir, encoding: "utf8" },
  ).trim();

  assert.equal(output, path.join(tempDir, ".opencode", "oh-my-openagent.jsonc.pre-recommend"));
});

test("getConfigPath with global resolves to ~/.config/opencode/oh-my-openagent.jsonc", (t) => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "omo-home-test-"));
  t.after(() => fs.rmSync(tempHome, { recursive: true, force: true }));

  const output = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { getConfigPath } from '${configPathsUrl.href}'; console.log(getConfigPath({ global: true }));`,
    ],
    { cwd: "/tmp", encoding: "utf8", env: { ...process.env, HOME: tempHome } },
  ).trim();

  assert.equal(output, path.join(tempHome, ".config", "opencode", "oh-my-openagent.jsonc"));
  assert.ok(fs.existsSync(path.join(tempHome, ".config", "opencode")));
});

test("getBackupPath with global uses correct suffix", (t) => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "omo-backup-global-test-"));
  t.after(() => fs.rmSync(tempHome, { recursive: true, force: true }));

  const output = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { getBackupPath } from '${configPathsUrl.href}'; console.log(getBackupPath({ global: true }));`,
    ],
    { cwd: "/tmp", encoding: "utf8", env: { ...process.env, HOME: tempHome } },
  ).trim();

  assert.equal(output, path.join(tempHome, ".config", "opencode", "oh-my-openagent.jsonc.pre-recommend"));
});

test("getConfigDir with global returns the config directory", (t) => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "omo-dir-global-test-"));
  t.after(() => fs.rmSync(tempHome, { recursive: true, force: true }));

  const output = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { getConfigDir } from '${configPathsUrl.href}'; console.log(getConfigDir({ global: true }));`,
    ],
    { cwd: "/tmp", encoding: "utf8", env: { ...process.env, HOME: tempHome } },
  ).trim();

  assert.equal(output, path.join(tempHome, ".config", "opencode"));
});

test("getConfigPath without global still resolves local path", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "omo-default-test-"));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(tempDir, ".gitignore"), "node_modules\n");

  const output = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { getConfigPath } from '${configPathsUrl.href}'; console.log(getConfigPath());`,
    ],
    { cwd: tempDir, encoding: "utf8" },
  ).trim();

  assert.equal(output, path.join(tempDir, ".opencode", "oh-my-openagent.jsonc"));
});
