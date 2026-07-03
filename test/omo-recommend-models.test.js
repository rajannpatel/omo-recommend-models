import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const repoRoot = path.resolve(__dirname, "..");
const scriptPath = path.join(repoRoot, "bin", "omo-recommend-models");
const validatorPath = path.join(repoRoot, "bin", "omo-validate-config");

const defaultAiResponse = {
  analysis: "fake recommendations",
  cloudRecommendations: [
    {
      name: "sisyphus",
      type: "agent",
      profile: "orchestrator",
      recommendations: [],
    },
  ],
  localModels: { decisions: [], placements: [] },
};

function defaultConfig(overrides = {}) {
  return {
    $schema: "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/master/assets/oh-my-opencode.schema.json",
    runtime_fallback: true,
    git_master: {
      commit_footer: true,
      include_co_authored_by: true,
      git_env_prefix: "GIT_MASTER=1",
    },
    agents: {
      sisyphus: {
        description: "Primary orchestrator and architectural planner",
        ...(overrides.sisyphus || {}),
      },
    },
    categories: {},
    ...(overrides.root || {}),
  };
}

function defaultProviderCache() {
  return {
    models: {
      opencode: [
        { id: "big-pickle", family: "opencode-big-pickle", context_length: 200000 },
        { id: "north-mini-code-free", family: "opencode-north", context_length: 32000 },
        { id: "nemotron-3-ultra-free", family: "opencode-nemotron", context_length: 32000 },
      ],
    },
  };
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function writeConfig(homeDir, config = defaultConfig()) {
  const configPath = path.join(homeDir, ".opencode", "oh-my-openagent.jsonc");
  writeJson(configPath, config);
  return configPath;
}

function writeProviderCache(homeDir, cache = defaultProviderCache()) {
  const cachePath = path.join(homeDir, ".cache", "oh-my-opencode", "provider-models.json");
  writeJson(cachePath, cache);
  return cachePath;
}

/**
 * Write ~/.cache/opencode/models.json — the OpenCode model DEFINITION catalog.
 * loadProviderModels uses this for model metadata (family, context_length),
 * while the live provider list comes from `opencode models --pure`.
 */
function writeOpencodeModelsCatalog(homeDir, providerCache) {
  if (!providerCache?.models) return;
  const opencodeModelsDir = path.join(homeDir, ".cache", "opencode");
  fs.mkdirSync(opencodeModelsDir, { recursive: true });
  const catalog = {};
  for (const [providerId, modelsArray] of Object.entries(providerCache.models)) {
    catalog[providerId] = { models: {} };
    for (const model of modelsArray) {
      if (typeof model === "string") {
        catalog[providerId].models[model] = {};
      } else {
        const { id, ...rest } = model;
        if (id) catalog[providerId].models[id] = rest;
      }
    }
  }
  writeJson(path.join(opencodeModelsDir, "models.json"), catalog);
}

function writeLocalCatalog(homeDir, models = []) {
  const catalogPath = path.join(homeDir, ".cache", "oh-my-opencode", "ollama-models.json");
  writeJson(catalogPath, models);
  return catalogPath;
}

function writeFakeOpencode(binDir, aiResponse = defaultAiResponse, providerCache = defaultProviderCache(), options = {}) {
  const fakePath = path.join(binDir, "opencode");
  const fakeJsPath = path.join(binDir, "opencode.js");
  const responseJson = JSON.stringify(aiResponse);
  const failRunModelsJson = JSON.stringify(options.failRunModels || []);
  const extraModels = [];
  if (providerCache && providerCache.models) {
    for (const [providerId, modelsArray] of Object.entries(providerCache.models)) {
      for (const m of modelsArray) {
        const id = typeof m === "string" ? m : m.id;
        const ref = `${providerId}/${id}`;
        if (ref !== "opencode/big-pickle" && ref !== "opencode/north-mini-code-free") {
          extraModels.push(ref);
        }
      }
    }
  }
  const extraModelsStr = extraModels.map((m) => `  process.stdout.write(${JSON.stringify(m)} + NL);`).join("\n");
  const fake = `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const logPath = process.env.OMO_FAKE_LOG;
const promptPath = process.env.OMO_FAKE_PROMPT_LOG;
const response = ${responseJson};
const failRunModels = new Set(${failRunModelsJson});
const NL = String.fromCharCode(10);
if (logPath) fs.appendFileSync(logPath, JSON.stringify(args) + NL);
if (promptPath && args[0] === "run") fs.appendFileSync(promptPath, args[args.length - 1] + NL + "---PROMPT---" + NL);
if (args[0] === "models") {
  if (${Boolean(options.emptyPlainModelsOnly)} && !args.includes("--pure")) {
    process.exit(0);
  }
  process.stdout.write("opencode/big-pickle" + NL);
  process.stdout.write("opencode/north-mini-code-free" + NL);
${extraModelsStr}
} else if (args[0] === "run") {
  const model = args[args.indexOf("--model") + 1];
  const pure = args.includes("--pure");
  if (failRunModels.has(model)) {
    process.stderr.write("Error: model is not available" + NL);
    process.exit(1);
  }
  if (model && model.includes("quota-exceeded")) {
    process.stderr.write("Error: billing quota exceeded (HTTP 402)" + NL);
    process.exit(1);
  }
  if (model && model.includes("stdout-quota")) {
    process.stdout.write("Payment Required: {\\\"error\\\": \\\"quota exceeded\\\"}" + NL);
    process.exit(1);
  }
  if (model && model.includes("rate-limited")) {
    process.stderr.write("Error: rate limit exceeded (HTTP 429)" + NL);
    process.exit(1);
  }
  function emitText(text) {
    process.stdout.write(JSON.stringify({ type: "text", part: { text } }) + NL);
  }
  if (model === "opencode/big-pickle" && !pure) {
    process.stdout.write(JSON.stringify({
      type: "tool_use",
      part: { type: "tool", tool: "read", state: { status: "completed" } },
    }) + NL);
  } else if (args.join(" ").includes("debate moderator")) {
    emitText("SYNTHESIS: fake debate complete");
  } else {
    const prompt = args[args.length - 1] || "";
    const agentMatch = prompt.match(/AGENT:\\s*([^|\\n]+)/);
    const agentName = agentMatch ? agentMatch[1].trim() : "";
    let payload = response;
    if (response && response.__emitWholeResult) {
      payload = response;
    } else if (response && Array.isArray(response.cloudRecommendations)) {
      payload = response.cloudRecommendations.find((rec) => rec.name === agentName) || response.cloudRecommendations[0] || response;
    }
    emitText(JSON.stringify(payload));
  }
} else {
  process.exitCode = 2;
}
`;
  fs.writeFileSync(fakeJsPath, fake, { mode: 0o644 });
  fs.writeFileSync(
    fakePath,
    `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(fakeJsPath)} "$@"\n`,
    { mode: 0o755 },
  );
}

function writeFakeOllama(binDir, models = []) {
  const fakePath = path.join(binDir, "ollama");
  const rows = models.map((m, index) => `${m.name} fake${index} ${m.size || "0.6GB"} 1 day ago`);
  const fake = `#!/bin/sh
case "$1" in
  --version)
    printf '%s\\n' 'ollama version is 0.0.0-test'
    ;;
  list)
    printf '%s\\n' 'NAME ID SIZE MODIFIED'
${rows.map((row) => `    printf '%s\\n' ${JSON.stringify(row)}`).join("\n")}
    ;;
  pull)
    printf '%s\\n' "pulled $2"
    ;;
  rm)
    printf '%s\\n' "removed $2"
    ;;
  *)
    exit 2
    ;;
esac
`;
  fs.writeFileSync(fakePath, fake, { mode: 0o755 });
}

function writeFakeCodex(binDir, options = {}) {
  const fakePath = path.join(binDir, "codex");
  const output = options.output ?? `JSON.stringify(payload) + "\\n"`;
  const fake = `#!/usr/bin/env node
const fs = require("node:fs");
const logPath = process.env.OMO_FAKE_CLI_LOG;
if (logPath) fs.appendFileSync(logPath, JSON.stringify({ tool: "codex", args: process.argv.slice(2) }) + "\\n");
const payload = {
  name: "sisyphus",
  type: "agent",
  profile: "codex probe",
  model: { provider: "opencode", model: "big-pickle", reason: "fake codex recommendation" },
  routing: [],
  fallback_models: []
};
process.stdout.write(${output});
`;
  fs.writeFileSync(fakePath, fake, { mode: 0o755 });
}

function writeFakeAgy(binDir, options = {}) {
  const fakePath = path.join(binDir, "agy");
  const output = options.output ?? `JSON.stringify(payload) + "\\n"`;
  const probeDelayMs = Number(options.probeDelayMs ?? options.delayMs ?? 0);
  const callDelayMs = Number(options.callDelayMs ?? options.delayMs ?? 0);
  const modelsOutput = JSON.stringify(options.models || [
    "Atlas Standard (Medium)",
    "Atlas Heavy (High)",
    "Atlas Sprint (Low)",
    "Beacon Core (Low)"
  ]);
  const fake = `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const logPath = process.env.OMO_FAKE_CLI_LOG;
if (logPath) fs.appendFileSync(logPath, JSON.stringify({ tool: "agy", args }) + "\\n");
if (args[0] === "models") {
  process.stdout.write(${modelsOutput}.join("\\n") + "\\n");
  process.exit(0);
}
const prompt = args[args.length - 1] || "";
const delayMs = prompt.includes('"name":"probe"') ? ${probeDelayMs} : ${callDelayMs};
if (delayMs > 0) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
}
const payload = {
  name: "sisyphus",
  type: "agent",
  profile: "agy probe",
  model: { provider: "opencode", model: "north-mini-code-free", reason: "fake agy recommendation" },
  routing: [],
  fallback_models: []
};
process.stdout.write(${output});
`;
  fs.writeFileSync(fakePath, fake, { mode: 0o755 });
}

function writeFakeGpu(binDir, options = { name: "Test GPU", vramGb: 8 }) {
  const fakePath = path.join(binDir, "nvidia-smi");
  const memMiB = Math.round(options.vramGb * 1024);
  const fake = `#!/bin/sh
printf '%s\\n' ${JSON.stringify(`${options.name}, ${memMiB}`)}
`;
  fs.writeFileSync(fakePath, fake, { mode: 0o755 });
}

function writePathFakeValidator(binDir, options = { code: 0 }) {
  const fakePath = path.join(binDir, "omo-validate-config");
  const fake = `#!/bin/sh
printf '%s\\n' ${JSON.stringify(options.stdout || "fake validator invoked")}
${options.stderr ? `printf '%s\\n' ${JSON.stringify(options.stderr)} >&2\n` : ""}exit ${options.code}
`;
  fs.writeFileSync(fakePath, fake, { mode: 0o755 });
}

function createHarness(t, options = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "omo-recommend-test-"));
  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const binDir = path.join(tempDir, "bin");
  const homeDir = path.join(tempDir, "home");
  fs.mkdirSync(binDir, { recursive: true });
  fs.mkdirSync(path.join(homeDir, ".opencode"), { recursive: true });
  fs.mkdirSync(path.join(homeDir, ".cache", "oh-my-opencode"), { recursive: true });
  fs.writeFileSync(
    path.join(binDir, "node"),
    `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} "$@"\n`,
    { mode: 0o755 },
  );

  const configPath = writeConfig(homeDir, options.config || defaultConfig());
  writeProviderCache(homeDir, options.providerCache || defaultProviderCache());
  writeOpencodeModelsCatalog(homeDir, options.providerCache || defaultProviderCache());
  if (options.localCatalog) writeLocalCatalog(homeDir, options.localCatalog);
  if (options.opencode !== false) {
    writeFakeOpencode(
      binDir,
      options.aiResponse || defaultAiResponse,
      options.providerCache || defaultProviderCache(),
      options.opencodeOptions || {},
    );
  }
  if (options.ollamaModels) writeFakeOllama(binDir, options.ollamaModels);
  if (options.codex) writeFakeCodex(binDir, options.codexOptions || {});
  if (options.agy) writeFakeAgy(binDir, options.agyOptions || {});
  if (options.gpu) writeFakeGpu(binDir, options.gpu);
  if (options.validator) writePathFakeValidator(binDir, options.validator);

  const env = {
    HOME: homeDir,
    XDG_CONFIG_HOME: path.join(homeDir, ".config"),
    PATH: binDir,
    NODE_PATH: repoRoot,
    OMO_FAKE_LOG: path.join(tempDir, "opencode-args.log"),
    OMO_FAKE_CLI_LOG: path.join(tempDir, "cli-args.log"),
    OMO_FAKE_PROMPT_LOG: path.join(tempDir, "opencode-prompts.log"),
    TERM: "dumb",
  };

  return { tempDir, binDir, homeDir, configPath, env };
}

function runCli(env, input = "", args = ["--dry-run", "--cloud-only"], timeoutMs = 8000) {
  const finalArgs = [...args];
  if (!finalArgs.includes("-y") && !finalArgs.includes("--interactive")) {
    finalArgs.push("--interactive");
  }
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...finalArgs], {
      cwd: env.HOME,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, 500).unref();
    }, timeoutMs);
    child.stdout.on("data", (data) => { stdout += data.toString(); });
    child.stderr.on("data", (data) => { stderr += data.toString(); });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, timedOut });
    });
    if (Array.isArray(input)) {
      input.forEach((chunk, index) => {
        setTimeout(() => child.stdin.write(chunk), index * 100).unref();
      });
      setTimeout(() => child.stdin.end(), input.length * 100 + 100).unref();
    } else {
      child.stdin.end(input);
    }
  });
}

function runDefaultCli(env, input = "", args = ["--dry-run", "--cloud-only"], timeoutMs = 8000) {
  const finalArgs = [...args];
  if (!finalArgs.includes("-y") && !finalArgs.includes("--interactive")) {
    finalArgs.push("--interactive");
  }
  return runCliRaw(env, input, finalArgs, timeoutMs);
}

function runCliRaw(env, input = "", args = ["--dry-run", "--cloud-only"], timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: env.HOME,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, 500).unref();
    }, timeoutMs);
    child.stdout.on("data", (data) => { stdout += data.toString(); });
    child.stderr.on("data", (data) => { stderr += data.toString(); });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, timedOut });
    });
    if (Array.isArray(input)) {
      input.forEach((chunk, index) => {
        setTimeout(() => child.stdin.write(chunk), index * 100).unref();
      });
      setTimeout(() => child.stdin.end(), input.length * 100 + 100).unref();
    } else {
      child.stdin.end(input);
    }
  });
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function runCliTtyUntilPrompt(env, inputChunks, args, promptPattern, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const command = [process.execPath, scriptPath, ...args].map(shellQuote).join(" ");
    const child = spawn("/usr/bin/script", ["-qfec", command, "/dev/null"], {
      cwd: env.HOME,
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let finished = false;
    let sawPrompt = false;
    let promptTimer = null;
    const finish = (result) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (promptTimer) clearTimeout(promptTimer);
      if (child.exitCode === null && !child.killed) child.kill("SIGTERM");
      resolve({ stdout, stderr, ...result });
    };
    const timer = setTimeout(() => {
      finish({ timedOut: true, closedBeforePromptSettled: false });
    }, timeoutMs);
    child.stdout.on("data", (data) => {
      stdout += data.toString();
      if (!sawPrompt && promptPattern.test(stdout)) {
        sawPrompt = true;
        promptTimer = setTimeout(() => {
          finish({ timedOut: false, closedBeforePromptSettled: false });
        }, 300);
      }
    });
    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      finish({
        code,
        signal,
        timedOut: false,
        closedBeforePromptSettled: sawPrompt,
      });
    });
    inputChunks.forEach((chunk, index) => {
      setTimeout(() => child.stdin.write(chunk), index * 100);
    });
  });
}

function runValidator(env, args = [], timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [validatorPath, ...args], {
      cwd: repoRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);
    child.stdout.on("data", (data) => { stdout += data.toString(); });
    child.stderr.on("data", (data) => { stderr += data.toString(); });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, timedOut });
    });
  });
}

function observeCliBeforeExit(env, input = "", args = ["--dry-run", "--cloud-only"], observeAfterMs = 300, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: env.HOME,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let observation = null;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(observeTimer);
      clearTimeout(timeoutTimer);
      resolve(value);
    };
    const observeTimer = setTimeout(() => {
      observation = { stdout, stderr, exited: false };
      child.kill("SIGTERM");
    }, observeAfterMs);
    const timeoutTimer = setTimeout(() => {
      observation = { stdout, stderr, exited: false, timedOut: true };
      child.kill("SIGTERM");
    }, timeoutMs);
    child.stdout.on("data", (data) => { stdout += data.toString(); });
    child.stderr.on("data", (data) => { stderr += data.toString(); });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      finish(observation || { code, signal, stdout, stderr, exited: true });
    });
    child.stdin.end(input);
  });
}

function readConfig(configPath) {
  return JSON.parse(fs.readFileSync(configPath, "utf8"));
}

test("recommendation CLI exposes the current dry-run contract without generated bin fixtures", async (t) => {
  const harness = createHarness(t, {
    config: defaultConfig(),
    providerCache: {
      models: {
        opencode: [{ id: "big-pickle", family: "glm", context_length: 200000 }],
      },
    },
  });

  const result = await runDefaultCli(harness.env, "", ["--dry-run", "--cloud-only"]);

  assert.equal(result.timedOut, false, result.stderr);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Recommended provider\/model configurations for/);
  assert.doesNotMatch(result.stdout + result.stderr, /recommendation-output\.json/);
});

test("--global flag uses HOME config path in dry-run output", async (t) => {
  const harness = createHarness(t, {
    config: defaultConfig(),
    providerCache: {
      models: {
        opencode: [{ id: "big-pickle", family: "glm", context_length: 200000 }],
      },
    },
  });

  const result = await runCli(harness.env, "", ["--dry-run", "--cloud-only", "--global"]);

  assert.equal(result.timedOut, false, result.stderr);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /\/\.config\/opencode\/oh-my-openagent\.jsonc/);
});

test("default recommender uses upstream rule chain without AI Panel", async (t) => {
  const harness = createHarness(t, {
    config: defaultConfig(),
    providerCache: {
      models: {
        "opencode-go": [{ id: "kimi-k2.6", family: "kimi", context_length: 200000 }],
        opencode: [
          { id: "big-pickle", family: "glm", context_length: 200000 },
          { id: "north-mini-code-free", family: "north", context_length: 32000 },
        ],
      },
    },
  });

  const result = await runDefaultCli(harness.env, "", ["--dry-run", "--cloud-only"]);
  assert.equal(result.timedOut, false, result.stderr);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Loaded: 2 providers /);
  assert.match(result.stdout, /AI Analysis of available providers\/models against recommended/);
  assert.match(result.stdout, /│  • https:\/\/github\.com\/code-yeongyu\/oh-my-openagent\/blob\/dev\/packages\/model-core\/src\/agent-model-requirements\.ts/);
  assert.match(result.stdout, /model: opencode-go\/kimi-k2\.6/);
  assert.match(result.stdout, /1\. opencode\/big-pickle/);
  assert.match(result.stdout, /2\. opencode\/north-mini-code-free/);
  assert.doesNotMatch(result.stdout, /This run would query:/);
});

test("default recommender strips manually excluded quota models", async (t) => {
  const harness = createHarness(t, {
    config: defaultConfig(),
    providerCache: {
      models: {
        "opencode-go": [{ id: "kimi-k2.6", family: "kimi", context_length: 200000 }],
        opencode: [{ id: "big-pickle", family: "glm", context_length: 200000 }],
      },
    },
  });

  const result = await runDefaultCli(
    harness.env,
    "",
    ["--dry-run", "--cloud-only", "--exclude-model", "opencode-go/kimi-k2.6"],
  );
  assert.equal(result.timedOut, false, result.stderr);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Excluded by override: opencode-go\/kimi-k2\.6/);
  assert.match(result.stdout, /model: opencode\/big-pickle/);
  assert.doesNotMatch(result.stdout, /model: opencode-go\/kimi-k2\.6/);
});

test("default recommender does not assign paid model refs that fail verification", async (t) => {
  // Given: OpenAI has one unavailable high-scoring variant and one available model.
  const harness = createHarness(t, {
    config: defaultConfig({
      root: {
        agents: {
          hephaestus: { description: "deep worker" },
        },
        categories: {},
      },
    }),
    providerCache: {
      models: {
        openai: [
          { id: "gpt-5.5-pro", family: "gpt", context_length: 200000 },
          { id: "gpt-4.1", family: "gpt", context_length: 200000 },
        ],
        opencode: [{ id: "big-pickle", family: "glm", context_length: 200000 }],
      },
    },
    opencodeOptions: {
      failRunModels: ["openai/gpt-5.5-pro"],
    },
  });

  // When: the deterministic rules recommender verifies paid providers first.
  const result = await runDefaultCli(
    harness.env,
    "",
    ["--dry-run", "--cloud-only"],
  );

  // Then: the failed model ref is never written as primary or fallback output.
  assert.equal(result.timedOut, false, result.stderr);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /model: openai\/gpt-4\.1/);
  assert.doesNotMatch(result.stdout, /model: openai\/gpt-5\.5-pro/);
  assert.doesNotMatch(result.stdout, /fallback_models: .*openai\/gpt-5\.5-pro/);
});

test("default recommender blocks failed opencode model while keeping same model through copilot", async (t) => {
  const harness = createHarness(t, {
    config: defaultConfig({
      root: {
        agents: {
          sisyphus: { description: "lead orchestrator" },
        },
        categories: {},
      },
    }),
    providerCache: {
      models: {
        opencode: [{ id: "gpt-5.5", family: "gpt", context_length: 200000 }],
        "github-copilot": [{ id: "gpt-5.5", family: "gpt", context_length: 200000 }],
      },
    },
    opencodeOptions: {
      failRunModels: ["opencode/gpt-5.5"],
    },
  });

  const result = await runDefaultCli(
    harness.env,
    "",
    ["--dry-run", "--cloud-only"],
  );

  assert.equal(result.timedOut, false, result.stderr);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /model: github-copilot\/gpt-5\.5/);
  assert.doesNotMatch(result.stdout, /model: opencode\/gpt-5\.5/);
  assert.doesNotMatch(result.stdout, /fallback_models: .*opencode\/gpt-5\.5/);
});

test("normalizes Ollama recommendations to local model refs with startup progress", async (t) => {
  const harness = createHarness(t, {
    gpu: { name: "Small Test GPU", vramGb: 8 },
    localCatalog: [
      { name: "tinyllama:1.1b", size: "0.6 GB", vram: 0.2, score: 30, baseModel: "tinyllama", tag: "1.1b" },
    ],
    ollamaModels: [{ name: "tinyllama:1.1b", size: "0.6GB" }],
    aiResponse: {
      __emitWholeResult: true,
      analysis: "fake local recommendations",
      cloudRecommendations: [
        {
          name: "sisyphus",
          type: "agent",
          profile: "orchestrator",
          recommendations: [
            { provider: "ollama", model: "tinyllama:1.1b", reason: "local utility fallback" },
          ],
        },
      ],
      localModels: {
        decisions: [{ name: "ollama/tinyllama:1.1b", action: "keep", rationale: "installed local fallback" }],
        placements: [{ modelName: "ollama/tinyllama:1.1b", agentName: "sisyphus", role: "fallback", justification: "installed local fallback" }],
      },
    },
  });

  const result = await runCli(harness.env, "\n", ["--dry-run", "--local-only"]);

  assert.equal(result.timedOut, false, result.stderr);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Checking GPU/);
  assert.match(result.stdout, /Checking Ollama/);
  assert.match(result.stdout, /Discovering local model catalog/);
  assert.match(result.stdout, /local\/tinyllama:1\.1b/);
  assert.doesNotMatch(result.stdout, /ollama\/tinyllama:1\.1b/);
});


test("default rule matcher appends dynamic installed local fallback last", async (t) => {
  const harness = createHarness(t, {
    config: defaultConfig({ sisyphus: { model: "opencode/big-pickle" } }),
    providerCache: {
      models: {
        opencode: [
          { id: "big-pickle", family: "opencode-big-pickle", context_length: 32000 },
          { id: "north-mini-code-free", family: "opencode-north", context_length: 32000 },
        ],
      },
    },
    gpu: { name: "Rule GPU", vramGb: 24 },
    localCatalog: [
      { name: "deepseek-r1:8b", size: "6.3 GB", vram: 6.3, score: 10, baseModel: "deepseek-r1", tag: "8b" },
    ],
    ollamaModels: [{ name: "deepseek-r1:8b", size: "6.3GB" }],
    validator: { code: 0 },
  });

  const result = await runDefaultCli(harness.env, "", ["-y"]);

  assert.equal(result.timedOut, false, result.stderr);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /AI Analysis of available providers\/models against recommended/);
  assert.match(result.stdout, /AI analysis recommends having these 1 installed local models in the fallback_models rule-chain[\s\S]*deepseek-r1:8b/);
  const written = readConfig(harness.configPath);
  assert.deepEqual(written.agents.sisyphus.routing || [], []);
  assert.equal(written.agents.sisyphus.fallback_models.at(-1), "local/deepseek-r1:8b");
});

test("interactive install choice happens before JSONC confirmation and filters skipped locals", async (t) => {
  const harness = createHarness(t, {
    config: defaultConfig({ sisyphus: { model: "opencode/big-pickle" } }),
    providerCache: {
      models: {
        opencode: [
          { id: "big-pickle", family: "opencode-big-pickle", context_length: 32000 },
          { id: "north-mini-code-free", family: "opencode-north", context_length: 32000 },
        ],
      },
    },
    gpu: { name: "Rule GPU", vramGb: 24 },
    localCatalog: [
      { name: "deepseek-r1:8b", size: "6.3 GB", vram: 6.3, score: 10, baseModel: "deepseek-r1", tag: "8b" },
    ],
    ollamaModels: [],
    validator: { code: 0 },
  });

  const result = await runDefaultCli(harness.env, ["3\n", "n\n"], ["--interactive"], 12000);

  assert.equal(result.timedOut, false, result.stderr);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`Install recommended local models before writing ${escapeRegExp(harness.configPath)}`));
  assert.match(result.stdout, /1\) Yes to all/);
  assert.match(result.stdout, /2\) Y\/N per model/);
  assert.match(result.stdout, /3\) No to all/);
  const installPrompt = result.stdout.indexOf(`Install recommended local models before writing ${harness.configPath}`);
  const preview = result.stdout.indexOf("Recommended provider/model configurations for");
  const applyTarget = result.stdout.indexOf("Choosing to apply will:");
  const applyPrompt = result.stdout.indexOf("◇  Apply these changes? (Y/n)");
  assert.ok(installPrompt >= 0 && preview > installPrompt && applyPrompt > preview);
  assert.ok(applyTarget > preview && applyPrompt > applyTarget);
  const finalPreview = result.stdout.slice(preview, applyPrompt);
  assert.doesNotMatch(finalPreview, /local\/deepseek-r1:8b/);
  assert.match(finalPreview, new RegExp(`Move existing file to: ${escapeRegExp(`${harness.configPath}.pre-recommend`)}`));
  assert.match(finalPreview, new RegExp(`Write new file: ${escapeRegExp(harness.configPath)}`));
  assert.doesNotMatch(result.stdout.slice(applyPrompt), /Install deepseek-r1:8b/);
  assert.match(result.stdout.slice(applyPrompt), /Skipped\./);
  const written = readConfig(harness.configPath);
  assert.equal(written.agents.sisyphus.model, "opencode/big-pickle");
  assert.doesNotMatch(JSON.stringify(written.agents.sisyphus), /local\/deepseek-r1:8b/);
});

test("interactive install choice two waits for each missing local model in a TTY", async (t) => {
  if (!fs.existsSync("/usr/bin/script")) {
    t.skip("script(1) is required for pseudo-TTY coverage");
    return;
  }
  const harness = createHarness(t, {
    config: defaultConfig({ sisyphus: { model: "opencode/big-pickle" } }),
    providerCache: {
      models: {
        opencode: [
          { id: "big-pickle", family: "opencode-big-pickle", context_length: 32000 },
          { id: "north-mini-code-free", family: "opencode-north", context_length: 32000 },
        ],
      },
    },
    gpu: { name: "Rule GPU", vramGb: 24 },
    localCatalog: [
      { name: "deepseek-r1:8b", size: "6.3 GB", vram: 6.3, score: 10, baseModel: "deepseek-r1", tag: "8b" },
    ],
    ollamaModels: [],
    validator: { code: 0 },
  });

  const result = await runCliTtyUntilPrompt(
    harness.env,
    ["2\n"],
    ["--interactive"],
    /Install deepseek-r1:8b\? \[y\/N\]/,
    12000,
  );

  assert.equal(result.timedOut, false, result.stderr);
  assert.match(result.stdout, /Install deepseek-r1:8b\? \[y\/N\]/);
  assert.equal(result.closedBeforePromptSettled, false, result.stdout);
});


test("interactive orphan uninstall apply exits after Done without SIGINT", async (t) => {
  const harness = createHarness(t, {
    config: defaultConfig(),
    providerCache: {
      models: {
        opencode: [{ id: "big-pickle", family: "opencode-north", context_length: 200000 }],
      },
    },
    gpu: { name: "Small Test GPU", vramGb: 8 },
    localCatalog: [
      { name: "qwen2.5-coder:1.5b", size: "1.5 GB", vram: 1.5, score: 92, baseModel: "qwen", tag: "1.5b" },
    ],
    ollamaModels: [
      { name: "qwen2.5-coder:1.5b", size: "1.5GB" },
      { name: "orphan:1b", size: "0.6GB" },
    ],
    validator: { code: 0 },
    aiResponse: {
      analysis: "remove orphan",
      cloudRecommendations: [
        {
          name: "sisyphus",
          type: "agent",
          profile: "orchestrator",
          model: { provider: "opencode", model: "big-pickle", reason: "best cloud" },
          routing: [],
          fallback_models: [],
        },
      ],
      localModels: { decisions: [], placements: [] },
    },
  });

  const result = await runCliRaw(
    harness.env,
    ["y\n", "", "", "", "", "", "\n"],
    ["--interactive"],
    2000,
  );

  assert.equal(result.timedOut, false, result.stderr);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Remove local models deemed unnecessary\? \[Y\/n\]/);
  assert.match(result.stdout, /◇  Apply these changes\? \(Y\/n\)/);
  assert.match(result.stdout, new RegExp(`Choosing to apply will:`));
  assert.match(result.stdout, new RegExp(`Move existing file to: ${escapeRegExp(`${harness.configPath}.pre-recommend`)}`));
  assert.match(result.stdout, new RegExp(`Write new file: ${escapeRegExp(harness.configPath)}`));
  assert.match(result.stdout, /removed orphan:1b/);
  assert.match(result.stdout, /\u2713  Done\./);
});


test("validator direct CLI supports help, config validation, malformed input, and safe fix", async (t) => {
  const harness = createHarness(t);
  const validConfig = path.join(harness.tempDir, "valid.jsonc");
  const invalidConfig = path.join(harness.tempDir, "invalid.jsonc");
  const malformedConfig = path.join(harness.tempDir, "malformed.jsonc");
  const fixableConfig = path.join(harness.tempDir, "fixable.jsonc");

  fs.writeFileSync(validConfig, `{
    // comments are allowed
    "$schema": "https://example.invalid/schema.json",
    "git_master": { "commit_footer": true, "include_co_authored_by": true, "git_env_prefix": "GIT_MASTER=1" },
    "agents": { "sisyphus": { "model": "opencode/big-pickle", } },
    "categories": {}
  }\n`);
  fs.writeFileSync(invalidConfig, JSON.stringify({
    $schema: "https://example.invalid/schema.json",
    agents: { sisyphus: { model: "missing-slash" } },
    categories: {},
  }, null, 2));
  fs.writeFileSync(malformedConfig, "{\n  \"agents\": {\n");
  fs.writeFileSync(fixableConfig, JSON.stringify({
    agents: { sisyphus: { model: "ollama/tinyllama:1.1b", fallback_models: [] } },
    categories: {},
  }, null, 2));

  const help = await runValidator(harness.env, ["--help"]);
  assert.equal(help.timedOut, false, help.stderr);
  assert.equal(help.code, 0, help.stderr);
  assert.match(help.stdout, /Usage:/);

  const valid = await runValidator(harness.env, ["--config", validConfig]);
  assert.equal(valid.code, 0, valid.stderr);

  const invalid = await runValidator(harness.env, ["--config", invalidConfig]);
  assert.notEqual(invalid.code, 0);
  assert.match(invalid.stderr, /agents\.sisyphus\.model/);

  const malformed = await runValidator(harness.env, ["--config", malformedConfig]);
  assert.notEqual(malformed.code, 0);
  assert.match(malformed.stderr, /JSONC|parse|malformed/i);

  const fixable = await runValidator(harness.env, ["--config", fixableConfig, "--fix"]);
  assert.equal(fixable.code, 0, fixable.stderr);
  assert.ok(fs.existsSync(`${fixableConfig}.bak`) || fs.existsSync(`${fixableConfig}.backup`));
  const fixedText = fs.readFileSync(fixableConfig, "utf8");
  assert.match(fixedText, /"local\/tinyllama:1\.1b"/);
});


test("recommendation preview displays prevModel when newModel is null", async (t) => {
  const harness = createHarness(t, {
    config: defaultConfig({ sisyphus: { model: "opencode/big-pickle" } }),
    aiResponse: {
      analysis: "no model change recommendation",
      cloudRecommendations: [
        {
          name: "sisyphus",
          type: "agent",
          profile: "orchestrator",
          model: null,
          routing: [],
          fallback_models: [],
        },
      ],
      localModels: { decisions: [], placements: [] },
    },
  });

  const result = await runCli(harness.env, ["\n", "\n", "n\n"], ["--cloud-only"]);

  assert.equal(result.timedOut, false, result.stderr);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /model: opencode\/big-pickle/);
});

test("no-install flag prints skipped message", async (t) => {
  const harness = createHarness(t, {
    providerCache: {
      models: {
        opencode: [
          { id: "big-pickle", family: "opencode-big-pickle", context_length: 32000 },
          { id: "north-mini-code-free", family: "opencode-north", context_length: 32000 },
        ],
      },
    },
    localCatalog: [
      { name: "deepseek-r1-a:7b", size: "6.4 GB", vram: 6.4, score: 80, baseModel: "deepseek-r1", tag: "7b" },
      { name: "deepseek-r1-b:8b", size: "7.0 GB", vram: 7, score: 90, baseModel: "deepseek-r1", tag: "8b" },
    ],
    ollamaModels: [{ name: "deepseek-r1-a:7b" }],
    gpu: {
      hasGpu: true,
      name: "RTX 4090",
      label: "RTX 4090 (24GB VRAM)",
      vramGb: 24,
    },
    config: defaultConfig({
      root: {
        agents: {
          sisyphus: {
            model: "ollama/deepseek-r1-a:7b",
            fallback_models: [],
          },
        },
      },
    }),
    aiResponse: {
      analysis: "placements",
      cloudRecommendations: [
        {
          name: "sisyphus",
          type: "agent",
          model: { provider: "ollama", model: "deepseek-r1-b:8b" },
          routing: [],
          fallback_models: [],
        },
      ],
    },
  });

  const result = await runCli(harness.env, "", [
    "-y",
    "--no-install",
  ], 12000);

  assert.equal(result.timedOut, false, result.stderr);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /skipped installation of deepseek-r1-b:8b via --no-install/);
});
