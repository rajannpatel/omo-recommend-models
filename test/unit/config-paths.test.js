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
