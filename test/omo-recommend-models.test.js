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
    console.log("openai/gpt-5.5\\n{\\n  \\\"capabilities\\\": { \\\"toolcall\\\": true }\\n}\\nopencode/zero-alpha\\n{\\n  \\\"capabilities\\\": { \\\"toolcall\\\": true }\\n}");
    process.exit(0);
  }
  console.log("openai/gpt-5.5");
  console.log("opencode/zero-alpha");
  process.exit(0);
}
if (args[0] === "run") {
  console.log(JSON.stringify({ type: "text", part: { text: "1" } }));
  console.error("probe warning: complete stderr is visible in verbose mode");
  process.exit(0);
}
process.exit(1);
`);
  fs.chmodSync(binPath, 0o755);
}

function writeFakeOpencodeWithEvaluatorFallback(binPath) {
  fs.writeFileSync(binPath, `#!/usr/bin/env node
const args = process.argv.slice(2);
const modelIndex = args.indexOf("--model");
const modelRef = modelIndex === -1 ? "" : args[modelIndex + 1];
if (args.includes("--version")) {
  console.log("opencode 1.0.0");
  process.exit(0);
}
if (args[0] === "models") {
  if (args.includes("--verbose")) {
    console.log("free-provider/failing-evaluator");
    console.log(JSON.stringify({ capabilities: { toolcall: true }, cost: { input: 0, output: 0 } }, null, 2));
    console.log("paid-provider/working-evaluator");
    console.log(JSON.stringify({ capabilities: { toolcall: true }, cost: { input: 1, output: 1 } }, null, 2));
    console.log("spare-provider/secondary-candidate");
    console.log(JSON.stringify({ capabilities: { toolcall: true }, cost: { input: 1, output: 1 } }, null, 2));
    process.exit(0);
  }
  console.log("free-provider/failing-evaluator");
  console.log("paid-provider/working-evaluator");
  console.log("spare-provider/secondary-candidate");
  process.exit(0);
}
if (args[0] === "run") {
  if (args.includes("--pure")) {
    console.log(JSON.stringify({ type: "text", part: { text: "1" } }));
    process.exit(0);
  }
  if (modelRef === "free-provider/failing-evaluator") {
    console.error("free evaluator failed");
    process.exit(2);
  }
  if (modelRef === "paid-provider/working-evaluator") {
    console.log(JSON.stringify({
      type: "text",
      part: {
        text: JSON.stringify({
          oracle: [
            "paid-provider/working-evaluator",
            "spare-provider/secondary-candidate",
            "free-provider/failing-evaluator",
          ],
        }),
      },
    }));
    process.exit(0);
  }
  console.log(JSON.stringify({ type: "text", part: { text: "1" } }));
  process.exit(0);
}
process.exit(1);
`);
  fs.chmodSync(binPath, 0o755);
}

function writeFakeOpencodeWithSkippedFreeRanker(binPath) {
  fs.writeFileSync(binPath, '#!/usr/bin/env node\nconst args = process.argv.slice(2);\nconst modelIndex = args.indexOf("--model");\nconst modelRef = modelIndex === -1 ? "" : args[modelIndex + 1];\nconst refs = [["free-provider/failing-probe-model", 0], ["free-provider/failing-rank-model", 0], ["paid-provider/working-model", 1], ["spare-provider/secondary-candidate", 1]];\nconst metadata = (cost) => JSON.stringify({ capabilities: { toolcall: true }, cost: { input: cost, output: cost } }, null, 2);\nif (args.includes("--version")) { console.log("opencode 1.0.0"); process.exit(0); }\nif (args[0] === "models") {\n  if (args.includes("--verbose")) { for (const [ref, cost] of refs) { console.log(ref); console.log(metadata(cost)); } } else { console.log(refs.map(([ref]) => ref).join("\\n")); }\n  process.exit(0);\n}\nif (args[0] === "run") {\n  if (args.includes("--pure")) {\n    if (modelRef === "free-provider/failing-probe-model") { console.error("model not found"); process.exit(2); }\n    console.log(JSON.stringify({ type: "text", part: { text: "1" } }));\n    process.exit(0);\n  }\n  if (modelRef === "free-provider/failing-rank-model") { console.error("free rank failed"); process.exit(2); }\n  if (modelRef === "paid-provider/working-model") { console.log(JSON.stringify({ type: "text", part: { text: JSON.stringify({ oracle: ["paid-provider/working-model", "spare-provider/secondary-candidate", "free-provider/failing-rank-model", "free-provider/failing-probe-model"] }) } })); process.exit(0); }\n  process.exit(3);\n}\nprocess.exit(1);\n');
  fs.chmodSync(binPath, 0o755);
}

function writeFakeOpencodeWithMultipleFreeEvaluators(binPath) {
  fs.writeFileSync(binPath, `#!/usr/bin/env node
const args = process.argv.slice(2);
const modelIndex = args.indexOf("--model");
const modelRef = modelIndex === -1 ? "" : args[modelIndex + 1];
const refs = [
  ["free-provider/working-free-1", 0],
  ["free-provider/working-free-2", 0],
  ["free-provider/failing-probe", 0],
  ["paid-provider/working-paid", 1],
  ["spare-provider/secondary-candidate", 1],
];
const metadata = (cost) => JSON.stringify({ capabilities: { toolcall: true }, cost: { input: cost, output: cost } }, null, 2);
if (args.includes("--version")) {
  console.log("opencode 1.0.0");
  process.exit(0);
}
if (args[0] === "models") {
  if (args.includes("--verbose")) {
    for (const [ref, cost] of refs) {
      console.log(ref);
      console.log(metadata(cost));
    }
  } else {
    console.log(refs.map(([ref]) => ref).join("\\n"));
  }
  process.exit(0);
}
if (args[0] === "run") {
  if (args.includes("--pure")) {
    if (modelRef === "free-provider/failing-probe") {
      console.error("model not found");
      process.exit(2);
    }
    console.log(JSON.stringify({ type: "text", part: { text: "1" } }));
    process.exit(0);
  }
  let stdin = "";
  process.stdin.on("data", (chunk) => { stdin += chunk; });
  process.stdin.on("end", () => {
    const name = stdin.includes("## hephaestus") ? "hephaestus" : "sisyphus";
    const ranking = name === "hephaestus"
      ? ["free-provider/working-free-2", "paid-provider/working-paid", "free-provider/working-free-1", "spare-provider/secondary-candidate"]
      : ["free-provider/working-free-1", "free-provider/working-free-2", "paid-provider/working-paid", "spare-provider/secondary-candidate"];
    if (["free-provider/working-free-1", "free-provider/working-free-2", "paid-provider/working-paid"].includes(modelRef)) {
      console.log(JSON.stringify({ type: "text", part: { text: JSON.stringify({ [name]: ranking }) } }));
      console.error("ranking stderr for " + modelRef);
      process.exit(0);
    }
    process.exit(3);
  });
  process.stdin.resume();
}
`);
  fs.chmodSync(binPath, 0o755);
}

function installForbiddenLocalDiscoveryCommands(fakeBin, commandLog) {
  fs.writeFileSync(commandLog, "");
  for (const command of ["nvidia-smi", "ollama", "curl", "registry"]) {
    const binPath = path.join(fakeBin, command);
    fs.writeFileSync(
      binPath,
      `#!/usr/bin/env node\nconst fs = require("node:fs");\nfs.appendFileSync(${JSON.stringify(commandLog)}, ${JSON.stringify(`${command}\n`)});\nprocess.exit(97);\n`,
    );
    fs.chmodSync(binPath, 0o755);
  }
}

function assertCloudOnlyDiscoverySkipped(result, commandLog) {
  assert.match(result.stdout, /Checking GPU: skipped by --cloud-only/);
  assert.match(result.stdout, /Checking Ollama: skipped by --cloud-only/);
  assert.match(result.stdout, /Discovering local model catalog: skipped by --cloud-only/);
  const externalCommands = fs.readFileSync(commandLog, "utf8");
  assert.equal(externalCommands, "", `unexpected local discovery commands:\n${externalCommands}`);
  assert.doesNotMatch(externalCommands, /^(?:nvidia-smi|ollama|curl|registry)$/m);
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
  assert.match(result.stdout, /◇  2 providers identified in `opencode models` output \(0s\)/);
  assert.match(result.stdout, /✓  model: openai\/gpt-5\.5 on provider: openai is available\n/);
  assert.match(result.stdout, /✓  model: opencode\/zero-alpha on provider: opencode is available\n/);
  assert.match(
    result.stdout,
    /│  • opencode run --pure --agent summary --format json --model openai\/gpt-5\.5\n/,
  );
  assert.match(
    result.stdout,
    /◇  Cloud model verification complete: 2 eligible; 2 probed, 2 available, 0 failed, 0 cached, 0 skipped/,
  );
  assert.match(result.stdout, /✓  Checking GPU: skipped by --cloud-only/);
  assert.match(result.stdout, /◇  Checking live provider models\.\.\./);
  assert.doesNotMatch(result.stdout, /│  ✓  Checking GPU|│  ✓  verified|│  ◇  Checking live provider models/);
  assert.doesNotMatch(result.stdout, /\[event:/);
  assert.doesNotMatch(result.stdout, /probe warning: complete stderr is visible in verbose mode/);
  assert.doesNotMatch(result.stdout, /\r/);
  assert.doesNotMatch(result.stdout, /(?:^|\n)(?:→|\[exec])/);
});

test("--verbose frames every fake OpenCode command and restores the pretty pipe", (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "omo-recommend-verbose-"));
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
    [path.join(process.cwd(), "bin/omo-recommend-models"), "--dry-run", "--cloud-only", "--verbose"],
    {
      cwd: workspace,
      encoding: "utf8",
      env: {
        ...process.env,
        CI: "true",
        COLUMNS: "40",
        HOME: workspace,
        PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ""}`,
        TERM: "dumb",
      },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  const frames = result.stdout.match(/[┌├]  \[exec\][\s\S]*?\n└/g) || [];
  assert.ok(frames.length >= 4, result.stdout);
  for (const frame of frames) {
    const lines = frame.split("\n");
    assert.equal(lines.at(-1), "└");
    for (const line of lines.slice(1, -1)) {
      assert.match(line, /^│/, `wrapped verbose line escaped the border: ${line}`);
    }
  }
  assert.match(result.stdout, /│  \[stdout\] openai\/gpt-5\.5/);
  assert.match(result.stdout, /│  \[stderr\] probe warning:/);
  assert.match(result.stdout, /└\n(?:[├┌]  \[exec\]|✓|◇)/);
  assert.match(
    result.stdout,
    /◇  Cloud model verification complete: 2 eligible; 2 probed, 2 available, 0 failed, 0 cached, 0 skipped/,
  );
});

test("dry-run falls back to a paid evaluator when every free evaluator fails", (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "omo-recommend-fitness-fallback-"));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const configDir = path.join(workspace, ".opencode");
  const fakeBin = path.join(workspace, "fake-bin");
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(fakeBin, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, "oh-my-openagent.jsonc"),
    JSON.stringify({ agents: { oracle: { description: "architecture" } }, categories: {} }),
  );
  writeFakeOpencodeWithEvaluatorFallback(path.join(fakeBin, "opencode"));

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
  assert.match(result.stdout, /→ oracle by free-provider\/failing-evaluator\.\.\./);
  assert.match(result.stdout, /✗  oracle by free-provider\/failing-evaluator — opencode exited with code 2/);
  assert.doesNotMatch(result.stdout, /free evaluator failed/);
  assert.match(result.stdout, /→ oracle by paid-provider\/working-evaluator\.\.\./);
  assert.match(result.stdout, /✓  processed  oracle by paid-provider\/working-evaluator/);
  assert.match(result.stdout, /◇  AI ranking complete: 1\/1 ranked using\n│  • paid-provider\/working-evaluator/);
});

test("dry-run tries every validated free evaluator before paid fallback", (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "omo-recommend-fitness-skip-free-"));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const configDir = path.join(workspace, ".opencode");
  const fakeBin = path.join(workspace, "fake-bin");
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(fakeBin, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, "oh-my-openagent.jsonc"),
    JSON.stringify({ agents: { oracle: { description: "architecture" } }, categories: {} }),
  );
  writeFakeOpencodeWithSkippedFreeRanker(path.join(fakeBin, "opencode"));
  const commandLog = path.join(workspace, "local-discovery-commands.log");
  installForbiddenLocalDiscoveryCommands(fakeBin, commandLog);

  const result = spawnSync(
    process.execPath,
    [path.join(process.cwd(), "bin/omo-recommend-models"), "--dry-run", "--cloud-only", "--verbose"],
    {
      cwd: workspace,
      encoding: "utf8",
      env: {
        ...process.env,
        CI: "true",
        COLUMNS: "200",
        HOME: workspace,
        PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ""}`,
        TERM: "dumb",
      },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /→ \w+ by free-provider\/failing-rank-model\.\.\./);
  assert.match(result.stdout, /✗\s+\w+ by free-provider\/failing-rank-model — opencode exited with code 2: free rank failed/);
  assert.match(result.stdout, /zero-cost evaluators exhausted; trying allowed paid evaluator models/);
  assert.match(result.stdout, /→ \w+ by paid-provider\/working-model\.\.\./);
  assert.match(result.stdout, /✓\s+processed\s+\w+ by paid-provider\/working-model/);
  assert.match(result.stdout, /model: paid-provider\/working-model/);
  assertCloudOnlyDiscoverySkipped(result, commandLog);
});

test("dry-run round-robins through all validated free evaluators", (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "omo-recommend-round-robin-free-"));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const configDir = path.join(workspace, ".opencode");
  const fakeBin = path.join(workspace, "fake-bin");
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(fakeBin, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, "oh-my-openagent.jsonc"),
    JSON.stringify({
      agents: {
        sisyphus: { description: "implementation" },
        hephaestus: { description: "planning" },
      },
      categories: {},
    }),
  );
  writeFakeOpencodeWithMultipleFreeEvaluators(path.join(fakeBin, "opencode"));
  const commandLog = path.join(workspace, "local-discovery-commands.log");
  installForbiddenLocalDiscoveryCommands(fakeBin, commandLog);

  const result = spawnSync(
    process.execPath,
    [path.join(process.cwd(), "bin/omo-recommend-models"), "--dry-run", "--cloud-only", "--verbose"],
    {
      cwd: workspace,
      encoding: "utf8",
      env: {
        ...process.env,
        CI: "true",
        COLUMNS: "200",
        HOME: workspace,
        PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ""}`,
        TERM: "dumb",
      },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /→ sisyphus by free-provider\/working-free-1\.\.\./);
  assert.match(result.stdout, /→ hephaestus by free-provider\/working-free-2\.\.\./);
  assert.match(
    result.stdout,
    /◇  AI ranking complete: 2\/2 ranked using\n│  • free-provider\/working-free-1\n│  • free-provider\/working-free-2\n/,
  );
  assert.match(result.stdout, /\[exec\] opencode run --format json --model free-provider\/working-free-1/);
  assert.match(result.stdout, /\[exec\] opencode run --format json --model free-provider\/working-free-2/);
  assert.match(result.stdout, /\[stdout\][\s\S]*sisyphus[\s\S]*free-provider\/working-free-1[\s\S]*free-provider\/working-free-2[\s\S]*paid-provider\/working-paid/);
  assert.match(result.stdout, /\[stdout\][\s\S]*hephaestus[\s\S]*free-provider\/working-free-2[\s\S]*paid-provider\/working-paid[\s\S]*free-provider\/working-free-1/);
  assert.match(result.stdout, /\[stderr\] ranking stderr for free-provider\/working-free-1/);
  assert.match(result.stdout, /\[stderr\] ranking stderr for free-provider\/working-free-2/);
  assertCloudOnlyDiscoverySkipped(result, commandLog);
});

test("dry-run non-verbose output remains clean", (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "omo-recommend-round-robin-clean-"));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const configDir = path.join(workspace, ".opencode");
  const fakeBin = path.join(workspace, "fake-bin");
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(fakeBin, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, "oh-my-openagent.jsonc"),
    JSON.stringify({
      agents: {
        sisyphus: { description: "implementation" },
        hephaestus: { description: "planning" },
      },
      categories: {},
    }),
  );
  writeFakeOpencodeWithMultipleFreeEvaluators(path.join(fakeBin, "opencode"));
  const commandLog = path.join(workspace, "local-discovery-commands.log");
  installForbiddenLocalDiscoveryCommands(fakeBin, commandLog);

  const result = spawnSync(
    process.execPath,
    [path.join(process.cwd(), "bin/omo-recommend-models"), "--dry-run", "--cloud-only"],
    {
      cwd: workspace,
      encoding: "utf8",
      env: {
        ...process.env,
        CI: "true",
        COLUMNS: "200",
        HOME: workspace,
        PATH: `${fakeBin}${path.delimiter}${process.env.PATH || ""}`,
        TERM: "dumb",
      },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /→ sisyphus by free-provider\/working-free-1\.\.\./);
  assert.match(result.stdout, /→ hephaestus by free-provider\/working-free-2\.\.\./);
  assert.match(
    result.stdout,
    /◇  AI ranking complete: 2\/2 ranked using\n│  • free-provider\/working-free-1\n│  • free-provider\/working-free-2\n/,
  );
  assert.doesNotMatch(result.stdout, /\[exec\]/);
  assert.doesNotMatch(result.stdout, /\[stdout\]/);
  assert.doesNotMatch(result.stdout, /\[stderr\]/);
  assertCloudOnlyDiscoverySkipped(result, commandLog);
});

const providerProbeFixture = path.join(
  process.cwd(),
  "test/fixtures/fake-opencode-provider-probes.mjs",
);
const blockedHostCommands = [
  "agy",
  "codex",
  "curl",
  "git",
  "nvidia-smi",
  "ollama",
  "omo-recommend-local",
  "registry",
  "wget",
];

function providerMetadata(cost = 1) {
  return {
    capabilities: { toolcall: true },
    cost: { input: cost, output: cost },
  };
}

function createProviderProbeHarness(t, { entries, outcomes = {} }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "omo-provider-probe-"));
  const home = path.join(root, "home");
  const fakeBin = path.join(root, "fake-bin");
  const configDir = path.join(root, ".opencode");
  const fixtureFile = path.join(root, "fixture.json");
  const invocationFile = path.join(root, "invocations.jsonl");
  const environmentAuditFile = path.join(root, "environment-audit.jsonl");
  const commandLog = path.join(root, "forbidden-commands.log");
  const isolatedTmp = path.join(root, "tmp");
  const configFile = path.join(configDir, "oh-my-openagent.jsonc");
  const cacheFile = path.join(
    home,
    ".cache/oh-my-opencode/policy-excluded-models.json",
  );
  const configBytes = `${JSON.stringify(
    { agents: { oracle: { description: "architecture" } }, categories: {} },
    null,
    2,
  )}\n`;

  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(fakeBin, { recursive: true });
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(isolatedTmp, { recursive: true });
  fs.copyFileSync(providerProbeFixture, path.join(fakeBin, "opencode"));
  fs.chmodSync(path.join(fakeBin, "opencode"), 0o755);
  fs.symlinkSync(process.execPath, path.join(fakeBin, "node"));
  fs.writeFileSync(configFile, configBytes);
  fs.writeFileSync(invocationFile, "");
  fs.writeFileSync(environmentAuditFile, "");
  fs.writeFileSync(commandLog, "");
  for (const command of blockedHostCommands) {
    const binPath = path.join(fakeBin, command);
    fs.writeFileSync(
      binPath,
      `#!/usr/bin/env node\nconst fs = require("node:fs");\nfs.appendFileSync(${JSON.stringify(commandLog)}, ${JSON.stringify(`${command}\n`)});\nprocess.exit(97);\n`,
    );
    fs.chmodSync(binPath, 0o755);
  }

  const writeFixture = (nextOutcomes) => {
    fs.writeFileSync(
      fixtureFile,
      `${JSON.stringify({ entries, outcomes: nextOutcomes }, null, 2)}\n`,
    );
  };
  writeFixture(outcomes);

  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return {
    cacheFile,
    commandLog,
    configBytes,
    configFile,
    environmentAuditFile,
    fakeBin,
    home,
    invocationFile,
    root,
    clearInvocations() {
      fs.writeFileSync(invocationFile, "");
    },
    invocations() {
      const bytes = fs.readFileSync(invocationFile, "utf8").trim();
      if (!bytes) return [];
      return bytes.split("\n").map((line) => JSON.parse(line).modelRef);
    },
    run(flags = []) {
      const result = spawnSync(
        process.execPath,
        [
          path.join(process.cwd(), "bin/omo-recommend-models"),
          "--dry-run",
          "--cloud-only",
          ...flags,
        ],
        {
          cwd: root,
          encoding: "utf8",
          env: {
            CI: "true",
            COLUMNS: "200",
            HOME: home,
            LANG: "C",
            LC_ALL: "C",
            NO_COLOR: "1",
            OMO_PROBE_ENVIRONMENT_AUDIT_FILE: environmentAuditFile,
            OMO_PROBE_FIXTURE_FILE: fixtureFile,
            OMO_PROBE_INVOCATIONS_FILE: invocationFile,
            PATH: fakeBin,
            TERM: "dumb",
            TMPDIR: isolatedTmp,
            XDG_CACHE_HOME: path.join(home, ".cache"),
          },
          killSignal: "SIGKILL",
          timeout: 5000,
        },
      );
      assert.equal(result.error, undefined, result.error?.message);
      return result;
    },
    seedCache(bytes) {
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      fs.writeFileSync(cacheFile, bytes);
    },
    writeFixture,
  };
}

function assertHermeticProbeHarness(harness) {
  assert.equal(fs.readFileSync(harness.commandLog, "utf8"), "");
  const audits = fs.readFileSync(harness.environmentAuditFile, "utf8").trim();
  assert.ok(audits.length > 0);
  for (const line of audits.split("\n")) {
    assert.deepEqual(JSON.parse(line).credentialKeys, []);
  }
  for (const command of blockedHostCommands) {
    assert.equal(path.dirname(path.join(harness.fakeBin, command)), harness.fakeBin);
  }
}

function probeResultLines(stdout) {
  return stdout
    .split("\n")
    .filter((line) => /^(?:✓|✗)  model: /.test(line));
}

function assertProbeTranscript(result, expectedLines, expectedSummary) {
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(probeResultLines(result.stdout), expectedLines);
  const summaries = result.stdout
    .split("\n")
    .filter((line) => line.startsWith("◇  Cloud model verification complete:"));
  assert.deepEqual(summaries, [expectedSummary]);
  const match = expectedSummary.match(
    /: (\d+) eligible; (\d+) probed, (\d+) available, (\d+) failed, (\d+) cached, (\d+) skipped$/,
  );
  assert.ok(match, expectedSummary);
  const [, eligible, probed, available, failed, cached, skipped] = match.map(Number);
  assert.equal(eligible, probed + cached + skipped);
  assert.equal(probed, available + failed);
  assert.equal(expectedLines.length, eligible);
  assert.doesNotMatch(
    result.stdout,
    /Loaded:|verified\s+\d+\/\d+|Cloud provider verification complete|provider completion\s+\d+\/\d+|~30s/,
  );
}

function recommendationRefs(stdout) {
  const recommendation = stdout.split(
    "◇  Recommended provider/model configurations",
  )[1] ?? "";
  const refs = [];
  for (const line of recommendation.split("\n")) {
    const primary = line.match(/^│    ◦ model: (\S+)$/);
    const fallback = line.match(/^│      \d+\. (\S+)$/);
    if (primary) refs.push(primary[1]);
    if (fallback) refs.push(fallback[1]);
  }
  return refs;
}

function assertRecommendationRefs(stdout, expectedRefs) {
  assert.deepEqual(recommendationRefs(stdout), expectedRefs);
}

function policyCacheBytes(refs) {
  return `${JSON.stringify(
    { schemaVersion: 1, policyExcludedModelRefs: [...refs].sort() },
    null,
    2,
  )}\n`;
}

test("real CLI probes every advertised Google ref, including string-only interleaved entries", (t) => {
  const refs = [
    "google/gemini-3.1-pro",
    "google/string-only-alpha",
    "google/gemini-3-flash",
    "google/string-only/nested",
  ];
  const harness = createProviderProbeHarness(t, {
    entries: [
      { ref: refs[0], metadata: providerMetadata(1) },
      { ref: refs[1], metadata: null },
      { ref: refs[2], metadata: providerMetadata(0) },
      { ref: refs[3], metadata: null },
    ],
  });

  const result = harness.run();

  assert.deepEqual(harness.invocations(), refs);
  assertProbeTranscript(
    result,
    refs.map((ref) => `✓  model: ${ref} on provider: google is available`),
    "◇  Cloud model verification complete: 4 eligible; 4 probed, 4 available, 0 failed, 0 cached, 0 skipped",
  );
  assert.deepEqual(
    result.stdout
      .split("\n")
      .filter((line) => line.includes("providers identified") || line === "│  • google"),
    ["◇  1 providers identified in `opencode models` output (0s)", "│  • google"],
  );
  assertRecommendationRefs(result.stdout, [refs[0], refs[1]]);
  assert.equal(fs.readFileSync(harness.configFile, "utf8"), harness.configBytes);
  assert.equal(fs.existsSync(harness.cacheFile), false);
  assertHermeticProbeHarness(harness);
});

test("real CLI reprobes transient refs while caching only the exact policy failure", (t) => {
  const refs = [
    "google/gemini-3.1-pro",
    "google/limited",
    "google/policy",
    "google/gemini-3-flash",
  ];
  const harness = createProviderProbeHarness(t, {
    entries: refs.map((ref) => ({ ref, metadata: providerMetadata(1) })),
    outcomes: {
      [refs[1]]: { kind: "rate-limited" },
      [refs[2]]: { kind: "policy" },
    },
  });

  const first = harness.run();

  assert.deepEqual(harness.invocations(), refs);
  assertProbeTranscript(
    first,
    [
      `✓  model: ${refs[0]} on provider: google is available`,
      `✗  model: ${refs[1]} on provider: google is rate limited`,
      `✗  model: ${refs[2]} on provider: google is guardrail-policy-exclusion`,
      `✓  model: ${refs[3]} on provider: google is available`,
    ],
    "◇  Cloud model verification complete: 4 eligible; 4 probed, 2 available, 2 failed, 0 cached, 0 skipped",
  );
  assert.equal(fs.readFileSync(harness.cacheFile, "utf8"), policyCacheBytes([refs[2]]));
  assertRecommendationRefs(first.stdout, [refs[0]]);

  harness.clearInvocations();
  const second = harness.run();

  assert.deepEqual(harness.invocations(), [refs[0], refs[1], refs[3]]);
  assertProbeTranscript(
    second,
    [
      `✓  model: ${refs[0]} on provider: google is available`,
      `✗  model: ${refs[1]} on provider: google is rate limited`,
      `✗  model: ${refs[2]} on provider: google is guardrail-policy-exclusion (cached)`,
      `✓  model: ${refs[3]} on provider: google is available`,
    ],
    "◇  Cloud model verification complete: 4 eligible; 3 probed, 2 available, 1 failed, 1 cached, 0 skipped",
  );
  assert.equal(fs.readFileSync(harness.cacheFile, "utf8"), policyCacheBytes([refs[2]]));
  assertRecommendationRefs(second.stdout, [refs[0]]);
  assertHermeticProbeHarness(harness);
});

test("real CLI literal strong exhaustion spawns exactly the first two Google refs", (t) => {
  const refs = [
    "google/ok-before",
    "google/quota",
    "google/after-quota",
  ];
  const harness = createProviderProbeHarness(t, {
    entries: refs.map((ref) => ({ ref, metadata: providerMetadata(1) })),
    outcomes: { [refs[1]]: { kind: "strong-exhaustion" } },
  });

  const result = harness.run();

  assert.deepEqual(harness.invocations(), [refs[0], refs[1]]);
  assertProbeTranscript(
    result,
    [
      `✗  model: ${refs[0]} on provider: google is provider-quota-exhausted`,
      `✗  model: ${refs[1]} on provider: google is quota-exceeded`,
      `✗  model: ${refs[2]} on provider: google is quota-exceeded (not probed after provider exhaustion)`,
    ],
    "◇  Cloud model verification complete: 3 eligible; 2 probed, 0 available, 2 failed, 0 cached, 1 skipped",
  );
  assert.deepEqual(recommendationRefs(result.stdout), []);
  assertHermeticProbeHarness(harness);
});

test("real CLI preserves interleaved advertised order through strong exhaustion", (t) => {
  const refs = [
    "google/gemini-3.1-pro",
    "openai/gpt-5.5",
    "google/quota",
    "google/after-quota",
    "openai/gpt-5.4-mini-fast",
  ];
  const harness = createProviderProbeHarness(t, {
    entries: refs.map((ref) => ({ ref, metadata: providerMetadata(1) })),
    outcomes: { [refs[2]]: { kind: "strong-exhaustion" } },
  });

  const result = harness.run();

  assert.deepEqual(harness.invocations(), [refs[0], refs[1], refs[2], refs[4]]);
  assertProbeTranscript(
    result,
    [
      `✗  model: ${refs[0]} on provider: google is provider-quota-exhausted`,
      `✓  model: ${refs[1]} on provider: openai is available`,
      `✗  model: ${refs[2]} on provider: google is quota-exceeded`,
      `✗  model: ${refs[3]} on provider: google is quota-exceeded (not probed after provider exhaustion)`,
      `✓  model: ${refs[4]} on provider: openai is available`,
    ],
    "◇  Cloud model verification complete: 5 eligible; 4 probed, 2 available, 2 failed, 0 cached, 1 skipped",
  );
  assertRecommendationRefs(result.stdout, [refs[1]]);
  assert.doesNotMatch(result.stdout, /◦ model: google\/|\d+\. google\//);
  assertHermeticProbeHarness(harness);
});

test("real CLI cache skips only advertised exact refs and flushes before same-run reprobe", (t) => {
  const refs = ["google/policy", "google/gemini-3.1-pro"];
  const staleRef = "stale-provider/unadvertised";
  const harness = createProviderProbeHarness(t, {
    entries: refs.map((ref) => ({ ref, metadata: providerMetadata(1) })),
    outcomes: { [refs[0]]: { kind: "policy" } },
  });
  const sentinels = new Map([
    [path.join(harness.home, ".cache/opencode/models.json"), '{"sentinel":"provider-catalog"}\n'],
    [path.join(harness.home, ".cache/oh-my-opencode/ollama-models.json"), '{"sentinel":"ollama"}\n'],
    [path.join(harness.home, ".cache/oh-my-opencode/ai-matcher-cache.json"), '{"sentinel":"ai-cache"}\n'],
    [path.join(harness.home, ".config/oh-my-opencode/ai-panel.json"), '{"sentinel":"ai-config"}\n'],
  ]);
  for (const [sentinelFile, sentinelBytes] of sentinels) {
    fs.mkdirSync(path.dirname(sentinelFile), { recursive: true });
    fs.writeFileSync(sentinelFile, sentinelBytes);
  }
  harness.seedCache(policyCacheBytes([staleRef]));

  const first = harness.run();

  assert.deepEqual(harness.invocations(), refs);
  assertProbeTranscript(
    first,
    [
      `✗  model: ${refs[0]} on provider: google is guardrail-policy-exclusion`,
      `✓  model: ${refs[1]} on provider: google is available`,
    ],
    "◇  Cloud model verification complete: 2 eligible; 2 probed, 1 available, 1 failed, 0 cached, 0 skipped",
  );
  assert.doesNotMatch(first.stdout, /stale-provider\/unadvertised/);
  assert.equal(
    fs.readFileSync(harness.cacheFile, "utf8"),
    policyCacheBytes([refs[0], staleRef]),
  );
  assertRecommendationRefs(first.stdout, [refs[1]]);
  for (const [sentinelFile, sentinelBytes] of sentinels) {
    assert.equal(fs.readFileSync(sentinelFile, "utf8"), sentinelBytes);
  }

  harness.clearInvocations();
  const second = harness.run();

  assert.deepEqual(harness.invocations(), [refs[1]]);
  assertProbeTranscript(
    second,
    [
      `✗  model: ${refs[0]} on provider: google is guardrail-policy-exclusion (cached)`,
      `✓  model: ${refs[1]} on provider: google is available`,
    ],
    "◇  Cloud model verification complete: 2 eligible; 1 probed, 1 available, 0 failed, 1 cached, 0 skipped",
  );
  assert.doesNotMatch(second.stdout, /stale-provider\/unadvertised/);
  assertRecommendationRefs(second.stdout, [refs[1]]);
  for (const [sentinelFile, sentinelBytes] of sentinels) {
    assert.equal(fs.readFileSync(sentinelFile, "utf8"), sentinelBytes);
  }

  harness.writeFixture({});
  harness.clearInvocations();
  const third = harness.run(["--flush-cache"]);

  assert.deepEqual(harness.invocations(), refs);
  assertProbeTranscript(
    third,
    refs.map((ref) => `✓  model: ${ref} on provider: google is available`),
    "◇  Cloud model verification complete: 2 eligible; 2 probed, 2 available, 0 failed, 0 cached, 0 skipped",
  );
  assert.ok(
    third.stdout.indexOf("◇  Model policy-exclusion cache flushed") <
      third.stdout.indexOf("◇  Checking live provider models..."),
    third.stdout,
  );
  assert.equal(fs.existsSync(harness.cacheFile), false);
  assertRecommendationRefs(third.stdout, [refs[1]]);
  for (const [sentinelFile, sentinelBytes] of sentinels) {
    assert.equal(fs.readFileSync(sentinelFile, "utf8"), sentinelBytes);
  }
  assert.equal(fs.readFileSync(harness.configFile, "utf8"), harness.configBytes);
  assertHermeticProbeHarness(harness);
});

test("real CLI fails open for each corrupt cache shape and atomically replaces it", async (t) => {
  const variants = [
    { name: "malformed JSON", bytes: "{broken\n", reason: "invalid JSON" },
    { name: "wrong shape", bytes: "[]\n", reason: "expected a schema object" },
    {
      name: "wrong version",
      bytes: '{"schemaVersion":99,"policyExcludedModelRefs":[]}\n',
      reason: "unsupported schemaVersion 99",
    },
  ];

  for (const variant of variants) {
    await t.test(variant.name, (subT) => {
      for (const debug of [false, true]) {
        const ref = `google/policy-${variant.name.replaceAll(" ", "-")}-${debug ? "debug" : "normal"}`;
        const harness = createProviderProbeHarness(subT, {
          entries: [{ ref, metadata: providerMetadata(1) }],
          outcomes: { [ref]: { kind: "policy" } },
        });
        harness.seedCache(variant.bytes);

        const result = harness.run(debug ? ["--debug"] : []);

        assert.deepEqual(harness.invocations(), [ref]);
        assertProbeTranscript(
          result,
          [`✗  model: ${ref} on provider: google is guardrail-policy-exclusion`],
          "◇  Cloud model verification complete: 1 eligible; 1 probed, 0 available, 1 failed, 0 cached, 0 skipped",
        );
        const diagnostic = `[cache] ignoring invalid policy-exclusion cache at ${harness.cacheFile}: ${variant.reason}`;
        const cacheDiagnostics = result.stderr
          .split("\n")
          .filter((line) => line.startsWith("[cache]"));
        assert.deepEqual(cacheDiagnostics, debug ? [diagnostic] : []);
        assert.equal(fs.readFileSync(harness.cacheFile, "utf8"), policyCacheBytes([ref]));
        assert.deepEqual(
          fs.readdirSync(path.dirname(harness.cacheFile)).filter((name) => name.includes(".tmp-")),
          [],
        );
        assertHermeticProbeHarness(harness);
      }
    });
  }
});
