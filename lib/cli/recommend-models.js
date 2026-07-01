import path, { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CLI_VERSION,
  parseCliOptions,
  usage,
} from "../cli-options.js";
import { selectedPanelRequiresOpencode } from "../display-utils.js";
import {
  discoverCliModels as discoverCliModelsImpl,
} from "../recommend/cli-agents.js";
import {
  buildRecommendationInputs,
  buildRunOptions,
} from "./recommend-inputs.js";
import {
  commandExists,
  ctx,
  defaultPanelModels,
  discoverFreeModels,
  handleRecommendModelsFatalError,
  runtime,
  subprocess,
} from "./recommend-runtime.js";
import { previewAndApplyRecommendations } from "./recommend-apply.js";
import { selectRecommendation } from "./recommend-execution.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = path.resolve(__dirname, "..", "..");

export { handleRecommendModelsFatalError };

export async function runRecommendModelsCli(argv = process.argv.slice(2)) {
  runtime.installSignalHandlers();
  const parsedArgs = parseCliOptions(argv);
  if (handleInformationalFlag(parsedArgs)) return;

  ctx.debugMode = parsedArgs.debug;
  ctx.providerExclusionOptions.rateLimited = true;
  ctx.providerExclusionOptions.quotaRestricted = true;

  const runOptions = buildRunOptions(parsedArgs);
  if (runOptions.cloudOnlyFlag && runOptions.localOnlyFlag) {
    console.error("Error: --cloud-only and --local-only are mutually exclusive");
    process.exitCode = 1;
    return;
  }

  await runtime.configureTerminalUi(runOptions.realTty);
  if (runOptions.dryRunFallback) {
    console.log(
      "  • Non-interactive environment detected; previewing changes only. Pass --yes to apply.",
    );
  }

  const inputs = await buildRecommendationInputs({
    commandExists,
    ctx,
    parsedArgs,
    runOptions,
    subprocess,
  });
  if (missingRequiredOpencode(inputs.config, runOptions)) return;
  announceRecommendationMode(inputs, runOptions, parsedArgs);

  const recommendation = await selectRecommendation({
    commandExists,
    defaultPanelModels,
    discoverFreeModels,
    inputs,
    parsedArgs,
    runOptions,
    runtime: {
      confirm: runtime.confirm.bind(runtime),
      ctx,
      promptUser: runtime.promptUser.bind(runtime),
      subprocess,
    },
  });
  if (!recommendation) return;

  await previewAndApplyRecommendations({
    aiResult: recommendation.aiResult,
    autoYes: runOptions.autoYes,
    ctx,
    dryRun: runOptions.dryRun,
    excludeFreeFromConfig: recommendation.excludeFreeFromConfig,
    inputs,
    packageRoot,
    parsedArgs,
    runtime,
  });
}

function handleInformationalFlag(parsedArgs) {
  if (parsedArgs.help) {
    console.log(usage());
    return true;
  }
  if (parsedArgs.version) {
    console.log(CLI_VERSION);
    return true;
  }
  return false;
}

function missingRequiredOpencode(config, runOptions) {
  if (
    !runOptions.useAiPanel ||
    !selectedPanelRequiresOpencode(config, runOptions.explicitModels) ||
    commandExists("opencode")
  ) {
    return false;
  }

  console.error(
    [
      "Error: OpenCode CLI (`opencode`) is required to query AI panel models, but it was not found on PATH.",
      "Install OpenCode, add `opencode` to PATH, or configure `omo.panel_models` with only `cli/...` agents.",
      "No config changes were made.",
    ].join("\n"),
  );
  process.exitCode = 1;
  return true;
}

function announceRecommendationMode(inputs, runOptions) {
  if (runOptions.useAiPanel) {
    const cliAgents = discoverCliModelsImpl(
      inputs.config,
      inputs.cliOptions,
      ctx,
      commandExists,
      subprocess,
    );
    console.log(
      `│  \u2713 AI Panel: ${inputs.cloudProviderCount} opencloud provider(s), ${cliAgents.length} installed AI CLI(s)`,
    );
    console.log("│");
  }
}
