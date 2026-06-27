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
    $schema: "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/oh-my-opencode.schema.json",
    runtime_fallback: true,
    agents: {
      sisyphus: {
        model_quality: "high",
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
      ],
    },
  };
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
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

function writeLocalCatalog(homeDir, models = []) {
  const catalogPath = path.join(homeDir, ".cache", "oh-my-opencode", "ollama-models.json");
  writeJson(catalogPath, models);
  return catalogPath;
}

function writePanelCache(homeDir, result, options = {}) {
  const cachePath = path.join(homeDir, ".cache", "oh-my-opencode", "panel-cache.json");
  writeJson(cachePath, {
    timestamp: options.timestamp ?? Date.now(),
    models: options.models ?? null,
    result,
  });
  return cachePath;
}

function writeFakeOpencode(binDir, aiResponse = defaultAiResponse, providerCache = defaultProviderCache()) {
  const fakePath = path.join(binDir, "opencode");
  const fakeJsPath = path.join(binDir, "opencode.js");
  const responseJson = JSON.stringify(aiResponse);
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
const NL = String.fromCharCode(10);
if (logPath) fs.appendFileSync(logPath, JSON.stringify(args) + NL);
if (promptPath && args[0] === "run") fs.appendFileSync(promptPath, args[args.length - 1] + NL + "---PROMPT---" + NL);
if (args[0] === "models") {
  process.stdout.write("opencode/big-pickle" + NL);
  process.stdout.write("opencode/north-mini-code-free" + NL);
${extraModelsStr}
} else if (args[0] === "run") {
  const model = args[args.indexOf("--model") + 1];
  const pure = args.includes("--pure");
  if (model && model.includes("quota-exceeded")) {
    process.stderr.write("Error: billing quota exceeded (HTTP 402)" + NL);
    process.exit(1);
  }
  if (model && model.includes("stdout-quota")) {
    process.stdout.write("Payment Required: {\\\"error\\\": \\\"quota exceeded\\\"}" + NL);
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

  const configPath = writeConfig(homeDir, options.config || defaultConfig());
  writeProviderCache(homeDir, options.providerCache || defaultProviderCache());
  if (options.localCatalog) writeLocalCatalog(homeDir, options.localCatalog);
  writeFakeOpencode(binDir, options.aiResponse || defaultAiResponse, options.providerCache || defaultProviderCache());
  if (options.ollamaModels) writeFakeOllama(binDir, options.ollamaModels);
  if (options.gpu) writeFakeGpu(binDir, options.gpu);
  if (options.validator) writePathFakeValidator(binDir, options.validator);
  if (options.panelCache) writePanelCache(homeDir, options.panelCache.result, options.panelCache);

  const env = {
    HOME: homeDir,
    XDG_CONFIG_HOME: path.join(homeDir, ".config"),
    PATH: binDir,
    NODE_PATH: repoRoot,
    OMO_FAKE_LOG: path.join(tempDir, "opencode-args.log"),
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
    child.stdin.end(input);
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

function readConfig(configPath) {
  return JSON.parse(fs.readFileSync(configPath, "utf8"));
}

test("captured recommendation output fixture is a JSON array of records", () => {
  const fixturePath = path.join(repoRoot, "bin", "recommendation-output.json");
  const parsed = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  assert.ok(Array.isArray(parsed), "fixture should be a JSON array");
  assert.ok(parsed.length > 0, "fixture should contain recommendation entries");
  assert.equal(typeof parsed[0], "object");
  assert.ok(parsed[0] && typeof parsed[0].name === "string");
  assert.ok(parsed[0] && typeof parsed[0].type === "string");
});

test("AI panel runs recommendation models in pure text mode", async (t) => {
  const harness = createHarness(t);

  const result = await runCli(harness.env, "\n");

  assert.equal(result.timedOut, false, result.stderr);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /AI Panel: 1 agents, 2 panel models/);
  assert.match(result.stdout, /big-pickle/);
  assert.match(result.stdout, /north-mini-code-free/);
  assert.doesNotMatch(result.stdout, /Only opencode\/north-mini-code-free returned valid results/);

  const runCalls = fs.readFileSync(harness.env.OMO_FAKE_LOG, "utf8")
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line))
    .filter((args) => args[0] === "run");
  assert.ok(runCalls.length >= 2);
  assert.ok(runCalls.every((args) => args.includes("--pure")));
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

test("VRAM rejection excludes oversized local models and keeps fitting locals", async (t) => {
  const harness = createHarness(t, {
    gpu: { name: "Small Test GPU", vramGb: 8 },
    localCatalog: [
      { name: "oversized:70b", size: "40 GB", vram: 40, score: 99, baseModel: "oversized", tag: "70b" },
      { name: "tinyllama:1.1b", size: "0.6 GB", vram: 0.2, score: 30, baseModel: "tinyllama", tag: "1.1b" },
    ],
    ollamaModels: [{ name: "tinyllama:1.1b", size: "0.6GB" }],
  });

  const result = await runCli(harness.env, "\n", ["--dry-run", "--local-only", "--model", "opencode/big-pickle"]);

  assert.equal(result.timedOut, false, result.stderr);
  assert.equal(result.code, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /local\/oversized:70b/);
  assert.doesNotMatch(result.stdout, /\boversized:70b\b/);
  assert.match(result.stdout, /local\/tinyllama:1\.1b/);
});

test("unknown VRAM local models are rejected from recommendations", async (t) => {
  const harness = createHarness(t, {
    gpu: { name: "Small Test GPU", vramGb: 8 },
    localCatalog: [
      { name: "mystery:latest", size: "unknown", score: 100, baseModel: "mystery", tag: "latest" },
      { name: "tinyllama:1.1b", size: "0.6 GB", vram: 0.2, score: 30, baseModel: "tinyllama", tag: "1.1b" },
    ],
    ollamaModels: [{ name: "tinyllama:1.1b", size: "0.6GB" }],
  });

  const result = await runCli(harness.env, "\n", ["--dry-run", "--local-only", "--model", "opencode/big-pickle"]);

  assert.equal(result.timedOut, false, result.stderr);
  assert.equal(result.code, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /local\/mystery:latest/);
  assert.doesNotMatch(result.stdout, /\bmystery:latest\b/);
  assert.match(result.stdout, /local\/tinyllama:1\.1b/);
});

test("no GPU means local models are not recommended", async (t) => {
  const harness = createHarness(t, {
    localCatalog: [
      { name: "tinyllama:1.1b", size: "0.6 GB", vram: 0.2, score: 30, baseModel: "tinyllama", tag: "1.1b" },
    ],
  });

  const result = await runCli(harness.env, "\n", ["--dry-run", "--local-only", "--model", "opencode/big-pickle"]);

  assert.equal(result.timedOut, false, result.stderr);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Checking GPU: No GPU detected/);
  assert.doesNotMatch(result.stdout, /local\/tinyllama:1\.1b/);
  assert.doesNotMatch(result.stdout, /AI: Local config placements/);
});

test("stale panel cache is rejected before recommendations are displayed", async (t) => {
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const staleResult = {
    recommender: "panel(opencode/old-free)",
    analysis: "stale cached recommendations",
    cloudRecommendations: [
      {
        name: "sisyphus",
        type: "agent",
        profile: "orchestrator",
        model: { provider: "local", model: "oversized:70b", reason: "stale cache" },
        routing: [],
        fallback_models: [],
      },
    ],
    localModels: { decisions: [], placements: [] },
    panel: { models: ["opencode/old-free"] },
  };
  const harness = createHarness(t, {
    panelCache: { result: staleResult, timestamp: thirtyDaysAgo, models: ["opencode/old-free"] },
    aiResponse: {
      analysis: "fresh recommendations",
      cloudRecommendations: [
        {
          name: "sisyphus",
          type: "agent",
          profile: "orchestrator",
          model: { provider: "opencode", model: "big-pickle", reason: "fresh panel" },
          routing: [],
          fallback_models: [],
        },
      ],
      localModels: { decisions: [], placements: [] },
    },
  });

  const result = await runCli(harness.env, ["\n", "y\n", "n\n"], ["--cloud-only"]);

  assert.equal(result.timedOut, false, result.stderr);
  assert.equal(result.code, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /Loaded cached panel result/);
  assert.doesNotMatch(result.stdout, /local\/oversized:70b/);
  assert.match(result.stdout, /opencode: big-pickle/);
});

test("panel picker label and recommendation preview uses bulleted format", async (t) => {
  const harness = createHarness(t, {
    aiResponse: {
      analysis: "preview recommendations",
      cloudRecommendations: [
        {
          name: "sisyphus",
          type: "agent",
          profile: "orchestrator",
          model: { provider: "opencode", model: "big-pickle", reason: "best cloud" },
          routing: [],
          fallback_models: [
            { provider: "opencode", model: "north-mini-code-free", reason: "cheap fallback" },
          ],
        },
      ],
      localModels: { decisions: [], placements: [] },
    },
  });

  const result = await runCli(harness.env, ["\n", "\n", "n\n"], ["--cloud-only"]);

  assert.equal(result.timedOut, false, result.stderr);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /AI Analysis/);
  assert.doesNotMatch(result.stdout, /Available opencode models/);
  assert.match(result.stdout, /agents\.sisyphus/);
  assert.match(result.stdout, /fallback_models:/);
  assert.doesNotMatch(result.stdout, /fallback_modules/);
});

test("canonical local output is local slash refs and local models never enter routing", async (t) => {
  const harness = createHarness(t, {
    config: defaultConfig({ sisyphus: { model: "opencode/north-mini-code-free" } }),
    gpu: { name: "Small Test GPU", vramGb: 8 },
    localCatalog: [
      { name: "tinyllama:1.1b", size: "0.6 GB", vram: 0.2, score: 30, baseModel: "tinyllama", tag: "1.1b" },
    ],
    ollamaModels: [{ name: "tinyllama:1.1b", size: "0.6GB" }],
    validator: { code: 0 },
    aiResponse: {
      analysis: "routing recommendations",
      cloudRecommendations: [
        {
          name: "sisyphus",
          type: "agent",
          profile: "orchestrator",
          model: { provider: "opencode", model: "big-pickle", reason: "best cloud" },
          routing: [{ provider: "ollama", model: "tinyllama:1.1b", reason: "bad local route" }],
          fallback_models: [{ provider: "ollama", model: "tinyllama:1.1b", reason: "local fallback" }],
        },
      ],
      localModels: {
        decisions: [{ name: "ollama/tinyllama:1.1b", action: "keep", rationale: "installed local fallback" }],
        placements: [{ modelName: "ollama/tinyllama:1.1b", agentName: "sisyphus", role: "fallback", justification: "installed local fallback" }],
      },
    },
  });

  const result = await runCli(harness.env, "", ["-y", "--local-only", "--model", "opencode/big-pickle"]);

  assert.equal(result.timedOut, false, result.stderr);
  assert.equal(result.code, 0, result.stderr);
  const written = readConfig(harness.configPath);
  assert.deepEqual(written.agents.sisyphus.routing || [], []);
  assert.ok((written.agents.sisyphus.fallback_models || []).includes("local/tinyllama:1.1b"));
  assert.doesNotMatch(fs.readFileSync(harness.configPath, "utf8"), /ollama\/tinyllama:1\.1b/);
});

test("non-interactive runs preview by default and do not write config without yes", async (t) => {
  const initialConfig = defaultConfig({ sisyphus: { model: "opencode/north-mini-code-free" } });
  const harness = createHarness(t, {
    config: initialConfig,
    aiResponse: {
      analysis: "non-interactive preview",
      cloudRecommendations: [
        {
          name: "sisyphus",
          type: "agent",
          profile: "orchestrator",
          model: { provider: "opencode", model: "big-pickle", reason: "preview only" },
          routing: [],
          fallback_models: [],
        },
      ],
      localModels: { decisions: [], placements: [] },
    },
  });
  const original = fs.readFileSync(harness.configPath, "utf8");

  const result = await runCliRaw(harness.env, "", ["--cloud-only", "--model", "opencode/big-pickle"]);

  assert.equal(result.timedOut, false, result.stderr);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Non-interactive environment detected; previewing changes only/);
  assert.match(result.stdout, /Apply: omo-recommend-models/);
  assert.equal(fs.readFileSync(harness.configPath, "utf8"), original);
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

test("validator rollback integration uses sibling validator and restores config", async (t) => {
  const initialConfig = defaultConfig({ sisyphus: { model_quality: "balanced", model: "opencode/north-mini-code-free" } });
  const normal = createHarness(t, {
    config: initialConfig,
    providerCache: { models: { opencode: [{ id: "north-mini-code-free", family: "opencode-north" }] } },
    validator: { code: 1, stderr: "agents.sisyphus.model: forced validator failure" },
    aiResponse: {
      analysis: "apply recommendations",
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

  const normalOriginal = fs.readFileSync(normal.configPath, "utf8");
  const normalResult = await runCli(normal.env, "", ["-y", "--cloud-only", "--model", "opencode/big-pickle"]);
  assert.equal(normalResult.timedOut, false, normalResult.stderr);
  assert.notEqual(normalResult.code, 0);
  assert.match(normalResult.stderr, /Validation FAILED|unknown model opencode\/big-pickle/);
  assert.doesNotMatch(normalResult.stderr, /forced validator failure/);
  assert.equal(fs.readFileSync(normal.configPath, "utf8"), normalOriginal);

  const rebalance = createHarness(t, {
    config: defaultConfig({
      sisyphus: { model_quality: "balanced", model: "opencode/big-pickle" },
      root: { categories: { bad: { routing: ["missing-slash"] } } },
    }),
    providerCache: { models: { opencode: [{ id: "north-mini-code-free", family: "opencode-north" }] } },
    validator: { code: 1, stderr: "agents.sisyphus.model: forced validator failure" },
  });
  const rebalanceOriginal = fs.readFileSync(rebalance.configPath, "utf8");
  const rebalanceResult = await runCli(rebalance.env, "", ["--rebalance", "-y", "--cloud-only"]);

  assert.equal(rebalanceResult.timedOut, false, rebalanceResult.stderr);
  assert.notEqual(rebalanceResult.code, 0);
  assert.match(rebalanceResult.stderr, /categories\.bad\.routing\.0|Command failed/);
  assert.doesNotMatch(rebalanceResult.stderr, /forced validator failure/);
  assert.equal(fs.readFileSync(rebalance.configPath, "utf8"), rebalanceOriginal);
});

test("quota exceeded errors block recommendations for that provider", async (t) => {
  const initialConfig = defaultConfig({ sisyphus: { model_quality: "balanced" } });
  const harness = createHarness(t, {
    config: initialConfig,
    providerCache: {
      models: {
        "quota-exceeded-prov": [{ id: "model-1", family: "model-family" }],
        "good-prov": [{ id: "model-2", family: "model-family" }]
      }
    },
    aiResponse: {
      analysis: "quota test",
      cloudRecommendations: [
        {
          name: "sisyphus",
          type: "agent",
          profile: "orchestrator",
          model: { provider: "quota-exceeded-prov", model: "model-1", reason: "quota model" },
          routing: [],
          fallback_models: [],
        },
      ],
      localModels: { decisions: [], placements: [] },
    },
  });

  const result = await runCli(harness.env, "", ["-y", "--cloud-only", "--model", "quota-exceeded-prov/model-1"]);
  assert.equal(result.timedOut, false, result.stderr);
  assert.equal(result.code, 0, result.stderr);

  const configText = fs.readFileSync(harness.configPath, "utf8");
  const configJson = JSON.parse(configText);
  assert.notEqual(configJson.agents.sisyphus.model, "quota-exceeded-prov/model-1");
});

test("quota exceeded errors in stdout block recommendations for that provider", async (t) => {
  const initialConfig = defaultConfig({ sisyphus: { model_quality: "balanced" } });
  const harness = createHarness(t, {
    config: initialConfig,
    providerCache: {
      models: {
        "stdout-quota-prov": [{ id: "model-1", family: "model-family" }],
        "good-prov": [{ id: "model-2", family: "model-family" }]
      }
    },
    aiResponse: {
      analysis: "quota test",
      cloudRecommendations: [
        {
          name: "sisyphus",
          type: "agent",
          profile: "orchestrator",
          model: { provider: "stdout-quota-prov", model: "model-1", reason: "quota model" },
          routing: [],
          fallback_models: [],
        },
      ],
      localModels: { decisions: [], placements: [] },
    },
  });

  const result = await runCli(harness.env, "", ["-y", "--cloud-only", "--model", "stdout-quota-prov/model-1"]);
  assert.equal(result.timedOut, false, result.stderr);
  assert.equal(result.code, 0, result.stderr);

  const configText = fs.readFileSync(harness.configPath, "utf8");
  const configJson = JSON.parse(configText);
  assert.notEqual(configJson.agents.sisyphus.model, "stdout-quota-prov/model-1");
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

test("async probe of paid models and selecting paid in prompt", async (t) => {
  const initialConfig = defaultConfig({ sisyphus: { model_quality: "balanced" } });
  const harness = createHarness(t, {
    config: initialConfig,
    providerCache: {
      models: {
        "quota-exceeded-prov": [{ id: "model-1", family: "model-family" }],
        "good-prov": [{ id: "model-2", family: "model-family" }]
      }
    },
    aiResponse: {
      analysis: "paid recommendation",
      cloudRecommendations: [
        {
          name: "sisyphus",
          type: "agent",
          profile: "orchestrator",
          model: { provider: "good-prov", model: "model-2", reason: "good model" },
          routing: [],
          fallback_models: [],
        },
      ],
      localModels: { decisions: [], placements: [] },
    },
  });

  const result = await runCli(harness.env, ["\n", "p\n", "n\n"], ["--cloud-only"]);
  assert.equal(result.timedOut, false, result.stderr);
  // Verify that the prompt listed the good model but NOT the quota exceeded one
  assert.match(result.stdout, /Available paid models/);
  assert.match(result.stdout, /good-prov: model-2/);
  assert.doesNotMatch(result.stdout, /Available paid models:[\s\S]+quota-exceeded-prov/);
});

test("panel cache exact match loads without displaying 'This run would query'", async (t) => {
  const initialConfig = defaultConfig({ sisyphus: { model_quality: "balanced" } });
  const harness = createHarness(t, {
    config: initialConfig,
    panelCache: {
      timestamp: Date.now(),
      models: ["opencode/nemotron-3-ultra-free"],
      result: {
        analysis: "cached recommendation",
        cloudRecommendations: [
          {
            name: "sisyphus",
            type: "agent",
            profile: "orchestrator",
            model: { provider: "opencode", model: "nemotron-3-ultra-free", reason: "cached" },
            routing: [],
            fallback_models: [],
          },
        ],
        localModels: { decisions: [], placements: [] },
      },
    },
  });

  const result = await runCli(harness.env, ["y\n", "n\n"], ["--cloud-only", "--model", "opencode/nemotron-3-ultra-free"]);
  assert.equal(result.timedOut, false, result.stderr);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Loaded cached panel result/);
  assert.doesNotMatch(result.stdout, /This run would query/);
});

test("panel cache declined displays 'This run would query' when running fresh", async (t) => {
  const initialConfig = defaultConfig({ sisyphus: { model_quality: "balanced" } });
  const harness = createHarness(t, {
    config: initialConfig,
    panelCache: {
      timestamp: Date.now(),
      models: ["opencode/nemotron-3-ultra-free"],
      result: {
        analysis: "cached recommendation",
        cloudRecommendations: [
          {
            name: "sisyphus",
            type: "agent",
            profile: "orchestrator",
            model: { provider: "opencode", model: "nemotron-3-ultra-free", reason: "cached" },
            routing: [],
            fallback_models: [],
          },
        ],
        localModels: { decisions: [], placements: [] },
      },
    },
  });

  const result = await runCli(harness.env, ["n\n", "\n", "n\n"], ["--cloud-only", "--model", "opencode/nemotron-3-ultra-free"]);
  assert.equal(result.timedOut, false, result.stderr);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /This run would query:/);
  assert.match(result.stdout, /opencode/);
});

test("no panel models available falls back to free models and prints quota-exceeded details", async (t) => {
  const initialConfig = defaultConfig({ sisyphus: { model_quality: "balanced" } });
  const harness = createHarness(t, {
    config: initialConfig,
    providerCache: {
      models: {
        "opencode": [
          { id: "big-pickle", family: "opencode-big-pickle", context_length: 200000 },
          { id: "north-mini-code-free", family: "opencode-north", context_length: 32000 },
          { id: "nemotron-3-ultra-free", family: "opencode-nemotron", context_length: 32000 }
        ],
        "quota-exceeded-prov": [{ id: "model-1", family: "model-family" }]
      }
    },
    aiResponse: {
      analysis: "free fallback recommendations",
      cloudRecommendations: [
        {
          name: "sisyphus",
          type: "agent",
          profile: "orchestrator",
          model: { provider: "opencode", model: "nemotron-3-ultra-free", reason: "free model" },
          routing: [],
          fallback_models: [],
        },
      ],
      localModels: { decisions: [], placements: [] },
    }
  });

  const result = await runCli(harness.env, ["y\n"], ["--cloud-only", "--model", "quota-exceeded-prov/model-1"]);
  assert.equal(result.timedOut, false, result.stderr);
  assert.equal(result.code, 0, `code: ${result.code}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  assert.match(result.stdout, /No panel models are available \(all are quota-restricted or rate-limited\)\. Limiting analysis/);
  assert.match(result.stdout, /Failed model details \/ errors:/);
  assert.match(result.stdout, /quota-exceeded-prov.*model-1/);
  assert.match(result.stdout, /quota-exceeded/);
  assert.match(result.stdout, /Falling back to free opencode models\.\.\./);
  assert.match(result.stdout, /model: opencode\/nemotron-3-ultra-free/);
});

test("early cache prompt allows repurposing cached results", async (t) => {
  const initialConfig = defaultConfig({ sisyphus: { model_quality: "balanced" } });
  const harness = createHarness(t, {
    config: initialConfig,
    panelCache: {
      timestamp: Date.now(),
      models: ["opencode/north-mini-code-free"],
      result: {
        analysis: "cached recommendation results",
        cloudRecommendations: [
          {
            name: "sisyphus",
            type: "agent",
            profile: "orchestrator",
            model: { provider: "opencode", model: "north-mini-code-free", reason: "from cache" },
            routing: [],
            fallback_models: [],
          },
        ],
        localModels: { decisions: [], placements: [] },
      }
    }
  });

  const result = await runCli(harness.env, ["y\n"], ["--cloud-only"]);
  assert.equal(result.timedOut, false, result.stderr);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /Cached panel result:/);
  assert.match(result.stdout, /Use cached\? \(y\/N\)/);
  assert.match(result.stdout, /Loaded cached panel result\./);
  assert.match(result.stdout, /model: opencode\/north-mini-code-free/);
});

test("interactive model picker awaits probes and lists only available models", async (t) => {
  const initialConfig = defaultConfig({ sisyphus: { model_quality: "balanced" } });
  const harness = createHarness(t, {
    config: initialConfig,
    providerCache: {
      models: {
        "opencode": [
          { id: "big-pickle", family: "opencode-big-pickle", context_length: 200000 },
          { id: "north-mini-code-free", family: "opencode-north", context_length: 32000 }
        ],
        "good-prov": [{ id: "model-paid", family: "model-family" }],
        "quota-exceeded-prov": [{ id: "model-bad", family: "model-family" }]
      }
    }
  });

  const result = await runCli(harness.env, ["a\n", "p\n", "n\n"], ["--cloud-only"]);
  assert.equal(result.timedOut, false, result.stderr);
  assert.equal(result.code, 0, result.stderr);

  assert.match(result.stdout, /Evaluate these models for opencode OMO agent roles:/);
  assert.match(result.stdout, /good-prov\/model-paid/);
  assert.doesNotMatch(result.stdout, /quota-exceeded-prov\/model-bad/);
});


