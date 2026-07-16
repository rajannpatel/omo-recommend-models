import path, { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CLI_VERSION,
  parseCliOptions,
  usage,
} from "../cli-options.js";
import {
  buildRecommendationInputs,
  buildRunOptions,
} from "./recommend-inputs.js";
import {
  commandExists,
  ctx,
  handleRecommendModelsFatalError,
  runtime,
  subprocess,
} from "./recommend-runtime.js";
import { previewAndApplyRecommendations } from "./recommend-apply.js";
import { selectRecommendation } from "./recommend-execution.js";
import { createPolicyExclusionCache } from "../providers/policy-exclusion-cache.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = path.resolve(__dirname, "..", "..");

export { handleRecommendModelsFatalError };

export function initializePolicyExclusionCache({
  context,
  parsedArgs,
  createCache = createPolicyExclusionCache,
  writeLine = console.log,
}) {
  if (!context.policyExclusionCache) {
    context.policyExclusionCache = createCache({
      debug: Boolean(context.debugMode),
      verbose: Boolean(context.verboseMode),
    });
  }
  if (parsedArgs["flush-cache"]) {
    context.policyExclusionCache.flush();
    writeLine("◇  Model policy-exclusion cache flushed");
  }
  return context.policyExclusionCache;
}

export async function runRecommendModelsCli(
  argv = process.argv.slice(2),
  dependencies = {},
) {
  const cliRuntime = dependencies.runtime ?? runtime;
  const runtimeContext = dependencies.context ?? cliRuntime.ctx ?? ctx;
  const subprocessRunner = dependencies.subprocess ?? cliRuntime.subprocess ?? subprocess;
  const buildInputs =
    dependencies.buildRecommendationInputs ?? buildRecommendationInputs;
  const select = dependencies.selectRecommendation ?? selectRecommendation;
  const preview =
    dependencies.previewAndApplyRecommendations ?? previewAndApplyRecommendations;

  const disposeSignalHandlers = cliRuntime.installSignalHandlers();
  try {
    const parsedArgs = parseCliOptions(argv);
    if (handleInformationalFlag(parsedArgs)) return;

    runtimeContext.debugMode = parsedArgs.debug;
    runtimeContext.verboseMode = parsedArgs.verbose;

    const runOptions = buildRunOptions(parsedArgs);
    if (runOptions.cloudOnlyFlag && runOptions.localOnlyFlag) {
      console.error("Error: --cloud-only and --local-only are mutually exclusive");
      process.exitCode = 1;
      return;
    }

    await cliRuntime.configureTerminalUi(runOptions.realTty);
    if (runOptions.dryRunFallback) {
      console.log(
        "│  • Non-interactive environment detected; previewing changes only. Pass --yes to apply.",
      );
    }

    initializePolicyExclusionCache({
      context: runtimeContext,
      parsedArgs,
      createCache:
        dependencies.createPolicyExclusionCache ?? createPolicyExclusionCache,
      writeLine: dependencies.writeLine ?? console.log,
    });

    const inputs = await buildInputs({
      commandExists,
      ctx: runtimeContext,
      parsedArgs,
      runOptions,
      subprocess: subprocessRunner,
    });

    const recommendation = await select({
      commandExists,
      inputs,
      parsedArgs,
      runOptions,
      runtime: {
        confirm: cliRuntime.confirm?.bind(cliRuntime),
        ctx: runtimeContext,
        promptUser: cliRuntime.promptUser?.bind(cliRuntime),
        subprocess: subprocessRunner,
      },
    });
    if (!recommendation) return;

    await preview({
      aiResult: recommendation.aiResult,
      autoYes: runOptions.autoYes,
      ctx: runtimeContext,
      dryRun: runOptions.dryRun,
      excludeFreeFromConfig: recommendation.excludeFreeFromConfig,
      inputs,
      packageRoot,
      parsedArgs,
      runtime: cliRuntime,
    });
  } finally {
    disposeSignalHandlers?.();
  }
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
