import { Command } from "commander";

export const CLI_VERSION = "1.2.3";

const BOOLEAN_DEFAULTS = {
  yes: false,

  "dry-run": false,
  "exclude-local": false,
  "exclude-cloud": false,
  "exclude-rate-limited": false,
  "exclude-quota-restricted": false,
  debug: false,
  interactive: false,
  help: false,
  "dangerously-skip-permissions": false,
  version: false,
  "exclude-free": false,
  "free-config": false,
  "free-panel": false,
  "exclude-codex": false,
  "exclude-agy": false,
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

function buildCommand() {
  return new Command()
    .name("omo-recommend-models")
    .description("Recommend OpenCode OMO model placements for oh-my-openagent.jsonc.")
    .configureOutput({
      writeErr: () => {},
    })
    .helpOption(false)
    .exitOverride()
    .allowExcessArguments(false)
    .option("-h, --help", "Show this help")
    .option("-v, --version", "Show version")
    .option("-y, --yes", "Apply recommendations without interactive confirmation")
    .option("--no-yes", "Disable automatic confirmation")
    .option("--dry-run", "Preview recommendations without writing config")
    .option("--cloud-only", "Skip GPU, Ollama, and local model discovery")
    .option("--exclude-local", "Skip GPU, Ollama, and local model discovery")
    .option("--local-only", "Skip cloud model discovery and API checks")
    .option("--exclude-cloud", "Skip cloud model discovery and API checks")
    .option("--model <ref>", "Use an explicit AI panel model; may be repeated", collect, [])
    .option("--profile <name>", "Profile name")
    .option("--exclude-rate-limited", "Exclude providers after rate-limit errors")
    .option("--exclude-quota-restricted", "Exclude providers after quota/billing errors")
    .option("--interactive", "Force interactive prompts in non-TTY environments")
    .option("--dangerously-skip-permissions", "Skip validation permission checks")
    .option("--no-cache", "Skip cached panel results, run fresh")
    .option("--no-free-panel", "Exclude free models from the AI Panel")
    .option("--free-panel", "Include free models in the AI Panel")
    .option("--exclude-free", "Exclude free models from final JSONC configuration")
    .option("--no-exclude-free", "Ensure free models are allowed in final JSONC")
    .option("--free-config", "Include free models in JSONC configuration")
    .option("--no-free-config", "Exclude free models from JSONC configuration")
    .option("--exclude-codex", "Exclude codex CLI agent from the AI Panel")
    .option("--exclude-codex-cli", "Exclude codex CLI agent from the AI Panel")
    .option("--exclude-agy", "Exclude agy CLI agent from the AI Panel")
    .option("--exclude-agy-cli", "Exclude agy CLI agent from the AI Panel")
    .option("--no-install", "Skip installation of recommended local models")
    .option("--no-uninstall", "Skip removal of conflicting local models")
    .option("--no-remove-orphans", "Skip pruning orphan Ollama models")
    .option("--no-apply", "Do not write final recommendations to config");
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
    "      --exclude-rate-limited       Exclude providers after rate-limit errors",
    "      --exclude-quota-restricted   Exclude providers after quota/billing errors",
    "      --interactive  Force interactive prompts in non-TTY environments",
    "      --dangerously-skip-permissions Skip validation permission checks",
    "      --no-cache                    Skip cached panel results, run fresh",
    "      --no-free-panel              Exclude free models from the AI Panel",
    "      --free-panel                 Include free models in the AI Panel",
    "      --exclude-free               Exclude free models from final JSONC configuration",
    "      --no-exclude-free            Ensure free models are allowed in final JSONC",
    "      --free-config                Include free models in JSONC configuration",
    "      --no-free-config             Exclude free models from JSONC configuration",
    "      --exclude-codex              Exclude codex CLI agent from the AI Panel",
    "      --exclude-agy                Exclude agy CLI agent from the AI Panel",
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
  const program = buildCommand();
  program.parse(rawArgs, { from: "user" });
  const opts = program.opts();
  const parsed = { ...BOOLEAN_DEFAULTS };

  parsed.yes = Boolean(opts.yes);
  parsed["dry-run"] = Boolean(opts.dryRun);
  parsed["exclude-local"] = Boolean(opts.cloudOnly || opts.excludeLocal);
  parsed["exclude-cloud"] = Boolean(opts.localOnly || opts.excludeCloud);
  parsed["exclude-rate-limited"] = Boolean(opts.excludeRateLimited);
  parsed["exclude-quota-restricted"] = Boolean(opts.excludeQuotaRestricted);
  parsed.debug = Boolean(opts.debug);
  parsed.interactive = Boolean(opts.interactive);
  parsed.help = Boolean(opts.help);
  parsed["dangerously-skip-permissions"] = Boolean(opts.dangerouslySkipPermissions);
  parsed.version = Boolean(opts.version);
  parsed["exclude-free"] = Boolean(opts.excludeFree);
  parsed["free-config"] = Boolean(opts.freeConfig);
  parsed["free-panel"] = Boolean(opts.freePanel);
  parsed["exclude-codex"] = Boolean(opts.excludeCodex || opts.excludeCodexCli);
  parsed["exclude-agy"] = Boolean(opts.excludeAgy || opts.excludeAgyCli);
  parsed.cache = opts.cache !== false;
  parsed.install = opts.install !== false;
  parsed.uninstall = opts.uninstall !== false;
  parsed["remove-orphans"] = opts.removeOrphans !== false;
  parsed.apply = opts.apply !== false;
  parsed.model = opts.model;
  parsed.profile = opts.profile;

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
