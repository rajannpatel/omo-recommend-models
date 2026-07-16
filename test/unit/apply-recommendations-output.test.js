import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omo-apply-recommend-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeValidator(dir) {
  const validatorPath = path.join(dir, "validator.js");
  fs.writeFileSync(
    validatorPath,
    `#!/usr/bin/env node\nprocess.stderr.write("raw validator stderr\\n");\nprocess.exit(8);\n`,
    { mode: 0o755 },
  );
  return validatorPath;
}

async function captureConsole(fn) {
  const originalLog = console.log;
  const originalError = console.error;
  const logs = [];
  const errors = [];
  console.log = (...args) => logs.push(args.map(String).join(" "));
  console.error = (...args) => errors.push(args.map(String).join(" "));
  try {
    await fn();
    return { logs, errors };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

test("applyRecommendations hides validator stderr in normal mode", async (t) => {
  const dir = tempDir(t);
  const originalCwd = process.cwd();
  t.after(() => process.chdir(originalCwd));
  fs.writeFileSync(path.join(dir, "workshop.yaml"), "name: test\n");
  fs.mkdirSync(path.join(dir, ".opencode"));
  fs.writeFileSync(path.join(dir, ".opencode", "oh-my-openagent.jsonc"), "{}\n");
  process.chdir(dir);

  const { applyRecommendations } = await import("../../lib/recommend/apply-recommendations.js");
  const { RuntimeContext } = await import("../../lib/runtime-context.js");

  const ctx = new RuntimeContext();
  const { logs, errors } = await captureConsole(async () => {
    await assert.rejects(
      applyRecommendations({
        aiResult: { cloudRecommendations: [], localModels: {} },
        config: { agents: {}, categories: {} },
        ollama: { installedModels: [] },
        allLocalModels: [],
        autoYes: true,
        install: false,
        uninstall: false,
        removeOrphans: false,
        excludeFreeFromConfig: false,
        global: false,
        validatorPath: writeValidator(dir),
        isProviderAllowed: () => true,
        isFreeRef: () => false,
        confirmedModels: new Set(),
        ctx,
      }),
      /Validation failed after applying recommendations/,
    );
  });

  assert.match(logs.join("\n"), /│  → Validating changes/);
  assert.match(errors.join("\n"), /Validation FAILED/);
  assert.doesNotMatch(logs.join("\n"), /raw validator stderr/);
  assert.doesNotMatch(errors.join("\n"), /raw validator stderr/);
});
