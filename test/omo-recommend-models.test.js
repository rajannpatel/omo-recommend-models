import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

function writeFakeOpencode(binPath) {
  fs.writeFileSync(binPath, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.includes("--version")) {
  console.log("opencode 1.0.0");
  process.exit(0);
}
if (args[0] === "models") {
  if (args.includes("--verbose")) {
    console.log("openai/gpt-5.5\\n{\\n  \\\"capabilities\\\": { \\\"toolcall\\\": true }\\n}\\nopencode/mimo-v2.5-free\\n{\\n  \\\"capabilities\\\": { \\\"toolcall\\\": true }\\n}");
    process.exit(0);
  }
  console.log("openai/gpt-5.5");
  console.log("opencode/mimo-v2.5-free");
  process.exit(0);
}
if (args[0] === "run") {
  console.log(JSON.stringify({ type: "text", part: { text: "1" } }));
  process.exit(0);
}
process.exit(1);
`);
  fs.chmodSync(binPath, 0o755);
}

test("dry-run cloud-only CLI keeps operational records inside output groups", (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "omo-recommend-output-"));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const configDir = path.join(workspace, ".opencode");
  const fakeBin = path.join(workspace, "fake-bin");
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(fakeBin, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, "oh-my-openagent.jsonc"),
    JSON.stringify({ agents: { oracle: { description: "architecture" } }, categories: {} }),
  );
  writeFakeOpencode(path.join(fakeBin, "opencode"));

  const result = spawnSync(
    process.execPath,
    [path.join(process.cwd(), "bin/omo-recommend-models"), "--dry-run", "--cloud-only"],
    {
      cwd: workspace,
      encoding: "utf8",
      env: {
        ...process.env,
        CI: "true",
        HOME: workspace,
        PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ""}`,
        TERM: "dumb",
      },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /◇  Verifying availability for 2 cloud provider\(s\)/);
  assert.match(result.stdout, /\n│\n✓  verified  1\/2 opencode by opencode\/mimo-v2\.5-free\n/);
  assert.match(result.stdout, /✓  verified  2\/2 openai by openai\/gpt-5\.5\n/);
  assert.match(result.stdout, /◇  Cloud provider verification complete: 2\/2/);
  assert.match(result.stdout, /✓  Checking GPU: skipped by --cloud-only/);
  assert.match(result.stdout, /◇  Checking live provider models\.\.\./);
  assert.doesNotMatch(result.stdout, /│  ✓  Checking GPU|│  ✓  verified|│  ◇  Checking live provider models/);
  assert.doesNotMatch(result.stdout, /\[event:/);
  assert.doesNotMatch(result.stdout, /\r/);
  assert.doesNotMatch(result.stdout, /(?:^|\n)(?:→|\[exec])/);
});
