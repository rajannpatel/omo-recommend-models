import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  CLI_VERSION,
  parseCliOptions,
  usage,
} from "../../lib/cli-options.js";
import { RuntimeContext } from "../../lib/runtime-context.js";

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

test("parseCliOptions exposes --flush-cache as a strict boolean", () => {
  assert.equal(parseCliOptions([])["flush-cache"], false);
  assert.equal(parseCliOptions(["--flush-cache"])["flush-cache"], true);
  assert.throws(
    () => parseCliOptions(["--flush-cache=true"]),
    /option '--flush-cache' does not take a value/,
  );
  assert.match(
    usage(),
    /^      --flush-cache                  Clear cached policy-excluded model refs before probing$/m,
  );
});

test("policy cache initialization is lazy, ordered, and continues after ENOENT", async () => {
  const recommendModels = await import("../../lib/cli/recommend-models.js");
  assert.equal(typeof recommendModels.initializePolicyExclusionCache, "function");

  const ctx = new RuntimeContext();
  const events = [];
  const cache = {
    flush() {
      events.push("flush-enoent");
      return false;
    },
  };
  assert.equal(ctx.policyExclusionCache, null);

  const result = recommendModels.initializePolicyExclusionCache({
    context: ctx,
    parsedArgs: { "flush-cache": true },
    createCache(options) {
      events.push(["create", options]);
      return cache;
    },
    writeLine(line) {
      events.push(["line", line]);
    },
  });

  events.push("discovery");
  assert.equal(result, cache);
  assert.equal(ctx.policyExclusionCache, cache);
  assert.deepEqual(events, [
    ["create", { debug: false, verbose: false }],
    "flush-enoent",
    ["line", "◇  Model policy-exclusion cache flushed"],
    "discovery",
  ]);
});

test("normal CLI lifecycle flushes after UI setup and before discovery in all modes", async () => {
  const { runRecommendModelsCli } = await import("../../lib/cli/recommend-models.js");
  const ctx = new RuntimeContext();
  const events = [];
  const fakeRuntime = {
    ctx,
    subprocess: {},
    installSignalHandlers() {
      events.push("signals");
    },
    async configureTerminalUi() {
      events.push("ui");
    },
    confirm: async () => true,
    promptUser: async () => "",
  };

  await runRecommendModelsCli(
    ["--flush-cache", "--local-only", "--dry-run", "--no-apply", "--global"],
    {
      runtime: fakeRuntime,
      createPolicyExclusionCache() {
        events.push("cache-create");
        return {
          flush() {
            events.push("cache-flush");
            return true;
          },
        };
      },
      writeLine(line) {
        events.push(line);
      },
      async buildRecommendationInputs() {
        events.push("discovery");
        return {};
      },
      async selectRecommendation() {
        events.push("recommend");
        return { aiResult: {}, excludeFreeFromConfig: false };
      },
      async previewAndApplyRecommendations() {
        events.push("preview");
      },
    },
  );

  assert.deepEqual(events, [
    "signals",
    "ui",
    "cache-create",
    "cache-flush",
    "◇  Model policy-exclusion cache flushed",
    "discovery",
    "recommend",
    "preview",
  ]);
});

test("non-ENOENT policy cache flush failure is fatal before discovery", async () => {
  const { runRecommendModelsCli } = await import("../../lib/cli/recommend-models.js");
  const ctx = new RuntimeContext();
  const events = [];
  const failure = Object.assign(new Error("simulated unlink failure"), {
    code: "EACCES",
  });

  await assert.rejects(
    runRecommendModelsCli(["--flush-cache", "--local-only", "--dry-run"], {
      runtime: {
        ctx,
        subprocess: {},
        installSignalHandlers() {},
        async configureTerminalUi() {
          events.push("ui");
        },
      },
      createPolicyExclusionCache() {
        return {
          flush() {
            events.push("flush");
            throw failure;
          },
        };
      },
      writeLine() {
        events.push("success-line");
      },
      async buildRecommendationInputs() {
        events.push("discovery");
        return {};
      },
    }),
    failure,
  );

  assert.deepEqual(events, ["ui", "flush"]);
});

test("help and version do not initialize the policy cache", async () => {
  const { runRecommendModelsCli } = await import("../../lib/cli/recommend-models.js");
  for (const flag of ["--help", "--version"]) {
    const events = [];
    await runRecommendModelsCli([flag], {
      runtime: {
        ctx: new RuntimeContext(),
        subprocess: {},
        installSignalHandlers() {
          events.push("signals");
        },
      },
      createPolicyExclusionCache() {
        events.push("cache-create");
        throw new Error("informational flags must not initialize cache storage");
      },
      async buildRecommendationInputs() {
        events.push("discovery");
        throw new Error("informational flags must not discover inputs");
      },
      writeLine() {},
    });
    assert.deepEqual(events, ["signals"]);
  }
});

test("real CLI flush is isolated, continues, and fails before discovery", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "omo-flush-cli-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, "home");
  const cwd = path.join(root, "work");
  const fakeBin = path.join(root, "bin");
  const policyFile = path.join(
    home,
    ".cache",
    "oh-my-opencode",
    "policy-excluded-models.json",
  );
  const ollamaCache = path.join(
    home,
    ".cache",
    "oh-my-opencode",
    "ollama-models.json",
  );
  const providerCache = path.join(home, ".cache", "opencode", "models.json");
  const configFile = path.join(cwd, ".opencode", "oh-my-openagent.jsonc");
  const configBytes = "{\n  \"agents\": {},\n  \"categories\": {}\n}\n";
  fs.mkdirSync(path.dirname(policyFile), { recursive: true });
  fs.mkdirSync(path.dirname(providerCache), { recursive: true });
  fs.mkdirSync(path.dirname(configFile), { recursive: true });
  fs.mkdirSync(fakeBin, { recursive: true });
  fs.writeFileSync(
    policyFile,
    '{"schemaVersion":1,"policyExcludedModelRefs":["provider/model"]}\n',
  );
  fs.writeFileSync(ollamaCache, "ollama-sentinel\n");
  fs.writeFileSync(providerCache, "provider-sentinel\n");
  fs.writeFileSync(configFile, configBytes);

  const env = {
    ...process.env,
    CI: "true",
    HOME: home,
    PATH: fakeBin,
    TERM: "dumb",
  };
  const cliPath = path.join(repoRoot, packageJson.bin["omo-recommend-models"]);
  for (const flag of ["--help", "--version"]) {
    const infoHome = path.join(root, flag.slice(2));
    fs.mkdirSync(infoHome, { recursive: true });
    const result = spawnSync(process.execPath, [cliPath, flag], {
      cwd,
      encoding: "utf8",
      env: { ...env, HOME: infoHome },
      timeout: 5000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(fs.readdirSync(infoHome), []);
  }

  const success = spawnSync(
    process.execPath,
    [cliPath, "--flush-cache", "--local-only", "--dry-run"],
    { cwd, encoding: "utf8", env, timeout: 10000 },
  );
  assert.equal(success.status, 0, success.stderr);
  assert.match(success.stdout, /^◇  Model policy-exclusion cache flushed$/m);
  assert.match(success.stdout, /skipped by --local-only/);
  assert.equal(fs.existsSync(policyFile), false);
  assert.equal(fs.readFileSync(ollamaCache, "utf8"), "ollama-sentinel\n");
  assert.equal(fs.readFileSync(providerCache, "utf8"), "provider-sentinel\n");
  assert.equal(fs.readFileSync(configFile, "utf8"), configBytes);
  assert.deepEqual(fs.readdirSync(fakeBin), []);

  const missingCache = spawnSync(
    process.execPath,
    [cliPath, "--flush-cache", "--local-only", "--dry-run"],
    { cwd, encoding: "utf8", env, timeout: 10000 },
  );
  assert.equal(missingCache.status, 0, missingCache.stderr);
  assert.match(
    missingCache.stdout,
    /^◇  Model policy-exclusion cache flushed$/m,
  );
  assert.equal(fs.existsSync(policyFile), false);
  assert.equal(fs.readFileSync(configFile, "utf8"), configBytes);

  fs.mkdirSync(policyFile, { recursive: true });
  fs.writeFileSync(path.join(policyFile, "failure-sentinel"), "unchanged\n");
  const failure = spawnSync(
    process.execPath,
    [cliPath, "--flush-cache", "--local-only", "--dry-run"],
    { cwd, encoding: "utf8", env, timeout: 5000 },
  );
  assert.equal(failure.status, 1);
  assert.match(failure.stderr, /Error: EISDIR|Error: EPERM/);
  assert.doesNotMatch(failure.stdout, /Model policy-exclusion cache flushed/);
  assert.doesNotMatch(failure.stdout, /Checking GPU|skipped by --local-only/);
  assert.equal(
    fs.readFileSync(path.join(policyFile, "failure-sentinel"), "utf8"),
    "unchanged\n",
  );
  assert.equal(fs.readFileSync(ollamaCache, "utf8"), "ollama-sentinel\n");
  assert.equal(fs.readFileSync(providerCache, "utf8"), "provider-sentinel\n");
  assert.equal(fs.readFileSync(configFile, "utf8"), configBytes);
  assert.deepEqual(fs.readdirSync(fakeBin), []);
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
