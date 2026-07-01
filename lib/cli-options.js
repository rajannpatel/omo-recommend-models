import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json");

export const CLI_VERSION = packageJson.version;

const BOOLEAN_DEFAULTS = {
  yes: false,

  "dry-run": false,
  "exclude-local": false,
  "exclude-cloud": false,
  "exclude-rate-limited": true,
  "exclude-quota-restricted": true,
  debug: false,
  interactive: false,
  version: false,
  "exclude-free": false,
  "free-config": false,
  "free-panel": false,
  "exclude-codex": false,
  "exclude-agy": false,
  "exclude-opencode": false,
  "parallel-panel": false,
  "ai-panel": false,
  cache: true,
  install: true,
  uninstall: true,
  "remove-orphans": true,
  apply: true,
};

function collect(value, previous) {
  return previous.concat([value]);
}

function hasArg(rawArgs, ...flags) {
  return rawArgs.some((arg) => flags.includes(arg));
}

const OPTION_DEFS = new Map([
  ["--help", { key: "help" }],
  ["-h", { key: "help" }],
  ["--version", { key: "version" }],
  ["-v", { key: "version" }],
  ["--yes", { key: "yes" }],
  ["-y", { key: "yes" }],
  ["--no-yes", { key: "yes", value: false }],
  ["--dry-run", { key: "dryRun" }],
  ["--cloud-only", { key: "cloudOnly" }],
  ["--exclude-local", { key: "excludeLocal" }],
  ["--local-only", { key: "localOnly" }],
  ["--exclude-cloud", { key: "excludeCloud" }],
  ["--model", { key: "model", valueRequired: true, collect: true }],
  ["--exclude-rate-limited", { key: "excludeRateLimited" }],
  ["--exclude-quota-restricted", { key: "excludeQuotaRestricted" }],
  ["--interactive", { key: "interactive" }],
  ["--debug", { key: "debug" }],
  ["--no-cache", { key: "cache", value: false }],
  ["--no-free-panel", { key: "freePanel", value: false }],
  ["--free-panel", { key: "freePanel" }],
  ["--exclude-free", { key: "excludeFree" }],
  ["--no-exclude-free", { key: "excludeFree", value: false }],
  ["--free-config", { key: "freeConfig" }],
  ["--no-free-config", { key: "freeConfig", value: false }],
  ["--exclude-codex", { key: "excludeCodex" }],
  ["--exclude-codex-cli", { key: "excludeCodexCli" }],
  ["--exclude-agy", { key: "excludeAgy" }],
  ["--exclude-agy-cli", { key: "excludeAgyCli" }],
  ["--exclude-opencode", { key: "excludeOpencode" }],
  ["--exclude-opencode-cli", { key: "excludeOpencodeCli" }],
  ["--parallel-panel", { key: "parallelPanel" }],
  ["--exclude-model", { key: "excludeModel", valueRequired: true, collect: true }],
  ["--ai-panel", { key: "aiPanel" }],
  ["--no-install", { key: "install", value: false }],
  ["--no-uninstall", { key: "uninstall", value: false }],
  ["--no-remove-orphans", { key: "removeOrphans", value: false }],
  ["--no-apply", { key: "apply", value: false }],
]);

function parseCommandOptions(rawArgs) {
  const opts = {
    model: [],
    excludeModel: [],
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    const [flag, inlineValue] = arg.startsWith("--") ? arg.split(/=(.*)/s, 2) : [arg];
    const def = OPTION_DEFS.get(flag);

    if (!def) {
      if (arg.startsWith("-")) {
        throw new Error(`unknown option '${arg}'`);
      }
      throw new Error(`too many arguments. Expected 0 arguments but got 1.`);
    }

    if (def.valueRequired) {
      const value = inlineValue ?? rawArgs[index + 1];
      if (!value || value.startsWith("-")) {
        throw new Error(`option '${flag} <ref>' argument missing`);
      }
      opts[def.key] = collect(value, opts[def.key] ?? []);
      if (inlineValue === undefined) {
        index += 1;
      }
      continue;
    }

    if (inlineValue !== undefined) {
      throw new Error(`option '${flag}' does not take a value`);
    }

    opts[def.key] = def.value ?? true;
  }

  return opts;
}

export function usage() {
  return [
    "Usage: omo-recommend-models [options]",
    "",
    "Recommend OpenCode OMO model placements for oh-my-openagent.jsonc.",
    "",
    "Options:",
    "  -y, --yes          Apply recommendations without interactive confirmation",
    "      --dry-run      Preview recommendations without writing config",
    "      --cloud-only   Skip GPU, Ollama, and local model discovery",
    "      --local-only   Skip cloud model discovery and API checks",
    "      --model <ref>  Use an explicit AI panel model; may be repeated",
    "      --exclude-rate-limited       Compatibility flag; rate-limited providers are always excluded once detected",
    "      --exclude-quota-restricted   Compatibility flag; quota/billing restricted providers are always excluded once detected",
    "      --interactive  Force interactive prompts in non-TTY environments",
    "      --no-cache                    Skip cached panel results, run fresh",
    "      --no-free-panel              Exclude free models from the AI Panel",
    "      --free-panel                 Include free models in the AI Panel",
    "      --exclude-free               Exclude free models from final JSONC configuration",
    "      --no-exclude-free            Ensure free models are allowed in final JSONC",
    "      --free-config                Include free models in JSONC configuration",
    "      --no-free-config             Exclude free models from JSONC configuration",
    "      --exclude-codex              Exclude codex CLI agent from the AI Panel",
    "      --exclude-agy                Exclude agy CLI agent from the AI Panel",
    "      --exclude-opencode           Exclude opencode CLI agent from the AI Panel",
    "      --parallel-panel             Run all panel models in parallel instead of using tiered sequential fallback",
    "      --exclude-model <ref>        Exclude provider or provider/model from rule-based assignments",
    "      --ai-panel                   Use the legacy AI Panel recommender",
    "      --no-install                 Skip installation of recommended local models",
    "      --no-uninstall               Skip removal of conflicting local models",
    "      --no-remove-orphans          Skip pruning orphan Ollama models",
    "      --no-apply                   Do not write final recommendations to config",
    "      --debug        Print stack traces for errors",
    "  -h, --help         Show this help",
    "  -v, --version      Show version",
  ].join("\n");
}

export function parseCliOptions(rawArgs = process.argv.slice(2)) {
  const opts = parseCommandOptions(rawArgs);
  const parsed = { ...BOOLEAN_DEFAULTS };

  parsed.yes = Boolean(opts.yes);
  parsed["dry-run"] = Boolean(opts.dryRun);
  parsed["exclude-local"] = Boolean(opts.cloudOnly || opts.excludeLocal);
  parsed["exclude-cloud"] = Boolean(opts.localOnly || opts.excludeCloud);
  parsed["exclude-rate-limited"] = true;
  parsed["exclude-quota-restricted"] = true;
  parsed.debug = Boolean(opts.debug);
  parsed.interactive = Boolean(opts.interactive);
  parsed.help = Boolean(opts.help);
  parsed.version = Boolean(opts.version);
  parsed["exclude-free"] = Boolean(opts.excludeFree);
  parsed["free-config"] = Boolean(opts.freeConfig);
  parsed["free-panel"] = Boolean(opts.freePanel);
  parsed["exclude-codex"] = Boolean(opts.excludeCodex || opts.excludeCodexCli);
  parsed["exclude-agy"] = Boolean(opts.excludeAgy || opts.excludeAgyCli);
  parsed["exclude-opencode"] = Boolean(opts.excludeOpencode || opts.excludeOpencodeCli);
  parsed["parallel-panel"] = Boolean(opts.parallelPanel);
  parsed["ai-panel"] = Boolean(opts.aiPanel);
  parsed.cache = opts.cache !== false;
  parsed.install = opts.install !== false;
  parsed.uninstall = opts.uninstall !== false;
  parsed["remove-orphans"] = opts.removeOrphans !== false;
  parsed.apply = opts.apply !== false;
  parsed.model = opts.model;
  parsed["exclude-model"] = opts.excludeModel;

  parsed._rawArgs = [...rawArgs];
  parsed._explicitYes = hasArg(rawArgs, "--yes", "-y") && !hasArg(rawArgs, "--no-yes");
  parsed._excludeFreeExplicit = hasArg(rawArgs, "--exclude-free");
  parsed._noExcludeFreeExplicit = hasArg(rawArgs, "--no-exclude-free");
  parsed._freeConfigExplicit = hasArg(rawArgs, "--free-config");
  parsed._noFreeConfigExplicit = hasArg(rawArgs, "--no-free-config");
  parsed._freePanelExplicit = hasArg(rawArgs, "--free-panel");
  parsed._noFreePanelExplicit = hasArg(rawArgs, "--no-free-panel");

  return parsed;
}
