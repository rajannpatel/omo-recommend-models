import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json");

export const CLI_VERSION = packageJson.version;

const BOOLEAN_DEFAULTS = {
  yes: false,
  global: false,

  "dry-run": false,
  "exclude-local": false,
  "exclude-cloud": false,
  debug: false,
  interactive: false,
  version: false,
  "free-config": false,
  install: true,
  uninstall: true,
  "remove-orphans": true,
  apply: true,
  "agy-analysis": false,
  "codex-analysis": false,
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
  ["--global", { key: "global" }],
  ["--dry-run", { key: "dryRun" }],
  ["--cloud-only", { key: "cloudOnly" }],
  ["--exclude-local", { key: "excludeLocal" }],
  ["--local-only", { key: "localOnly" }],
  ["--exclude-cloud", { key: "excludeCloud" }],
  ["--interactive", { key: "interactive" }],
  ["--debug", { key: "debug" }],
  ["--free-config", { key: "freeConfig" }],
  ["--no-free-config", { key: "freeConfig", value: false }],
  ["--exclude-model", { key: "excludeModel", valueRequired: true, collect: true }],
  ["--no-install", { key: "install", value: false }],
  ["--no-uninstall", { key: "uninstall", value: false }],
  ["--no-remove-orphans", { key: "removeOrphans", value: false }],
  ["--no-apply", { key: "apply", value: false }],
  ["--agy-analysis", { key: "agyAnalysis" }],
  ["--codex-analysis", { key: "codexAnalysis" }],
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
    "      --global       Write config to ~/.config/opencode/ instead of project .opencode/",
    "      --cloud-only   Skip GPU, Ollama, and local model discovery",
    "      --local-only   Skip cloud model discovery and API checks",
    "      --interactive  Force interactive prompts in non-TTY environments",
    "      --free-config                Include free models in JSONC configuration",
    "      --no-free-config             Exclude free models from JSONC configuration",
    "      --exclude-model <ref>        Exclude provider or provider/model from assignments",
    "      --no-install                 Skip installation of recommended local models",
    "      --no-uninstall               Skip removal of conflicting local models",
    "      --no-remove-orphans          Skip pruning orphan Ollama models",
    "      --no-apply                   Do not write final recommendations to config",
    "      --agy-analysis               Use AGY in the CLI terminal to run AI analysis",
    "      --codex-analysis             Use Codex in the CLI terminal to run AI analysis",
    "      --debug        Print stack traces for errors",
    "  -h, --help         Show this help",
    "  -v, --version      Show version",
  ].join("\n");
}

export function parseCliOptions(rawArgs = process.argv.slice(2)) {
  const opts = parseCommandOptions(rawArgs);
  const parsed = { ...BOOLEAN_DEFAULTS };

  parsed.yes = Boolean(opts.yes);
  parsed.global = Boolean(opts.global);
  parsed["dry-run"] = Boolean(opts.dryRun);
  parsed["exclude-local"] = Boolean(opts.cloudOnly || opts.excludeLocal);
  parsed["exclude-cloud"] = Boolean(opts.localOnly || opts.excludeCloud);
  parsed.debug = Boolean(opts.debug);
  parsed.interactive = Boolean(opts.interactive);
  parsed.help = Boolean(opts.help);
  parsed.version = Boolean(opts.version);
  parsed["free-config"] = Boolean(opts.freeConfig);
  parsed.install = opts.install !== false;
  parsed.uninstall = opts.uninstall !== false;
  parsed["remove-orphans"] = opts.removeOrphans !== false;
  parsed.apply = opts.apply !== false;
  parsed["exclude-model"] = opts.excludeModel;
  parsed["agy-analysis"] = Boolean(opts.agyAnalysis);
  parsed["codex-analysis"] = Boolean(opts.codexAnalysis);

  parsed._rawArgs = [...rawArgs];
  parsed._explicitYes = hasArg(rawArgs, "--yes", "-y");
  parsed._freeConfigExplicit = hasArg(rawArgs, "--free-config");
  parsed._noFreeConfigExplicit = hasArg(rawArgs, "--no-free-config");

  return parsed;
}
