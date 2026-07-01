import path from "node:path";

import { resolveInstallDecisions } from "../apply-local.js";
import { applyRecommendations } from "../recommend/apply-recommendations.js";
import { isProviderAvailable } from "../probe-providers.js";
import {
  showAiAnalysis,
  showCloudRecommendations,
  showLocalModelDecisions,
  showLocalPlacements,
  showLocalWarnings,
} from "./recommend-output.js";
import { getConfigPath } from "../omo-shared.js";

export async function previewAndApplyRecommendations({
  aiResult,
  autoYes,
  confirmedModels = null,
  ctx,
  dryRun,
  excludeFreeFromConfig,
  inputs,
  packageRoot,
  parsedArgs,
  runtime,
}) {
  showAiAnalysis(aiResult);
  if (aiResult.localModels) {
    showLocalModelDecisions({
      aiResult,
      allLocalModels: inputs.allLocalModels,
      ollama: inputs.ollama,
      localRecommendationContext: inputs.localRecommendationContext,
    });
    showLocalWarnings(inputs.localRecommendationContext);
  }

  const installedModels = confirmedModels || await resolveConfirmedModels({
    aiResult,
    autoYes,
    dryRun,
    inputs,
    parsedArgs,
  });

  console.log("│");
  console.log(`◇  Recommended provider/model configurations for ${getConfigPath()}:`);
  const cloudChanges = showCloudRecommendations({
    aiResult,
    config: inputs.config,
    confirmedModels: installedModels,
    isProviderAllowed: (provider) => isProviderAvailable(ctx, provider),
  });
  const localPlacements = showLocalPlacements(aiResult, installedModels);
  const hasLocalChanges = aiResult.localModels && localPlacements.length > 0;
  if (cloudChanges.length === 0 && !hasLocalChanges) {
    console.log("│");
    console.log("◇  \u2705 No JSONC changes needed.");
    console.log("│");
    return;
  }

  if (!parsedArgs.apply) {
    console.log("│  \u2192 Apply skipped via --no-apply");
    console.log("│");
    return;
  }
  if (dryRun) {
    console.log("│");
    console.log("│  \u2192 Dry run mode enabled; no changes have been applied.");
    console.log("│");
    return;
  }
  if (!autoYes && !await runtime.confirm("Apply these JSONC changes? (y/N) ")) {
    console.log("│  Skipped.");
    console.log("│");
    return;
  }

  await applyRecommendations({
    aiResult,
    config: inputs.config,
    ollama: inputs.ollama,
    allLocalModels: inputs.allLocalModels,
    autoYes,
    install: parsedArgs.install,
    uninstall: parsedArgs.uninstall,
    removeOrphans: parsedArgs["remove-orphans"],
    excludeFreeFromConfig,
    validatorPath: path.join(packageRoot, "bin", "omo-validate-config"),
    isProviderAllowed: (provider) => isProviderAvailable(ctx, provider),
    confirmedModels: installedModels,
  });
}

async function resolveConfirmedModels({ aiResult, autoYes, dryRun, inputs, parsedArgs }) {
  if (!parsedArgs.apply || dryRun) return null;
  return resolveInstallDecisions({
    decisions: aiResult.localModels?.decisions,
    ollama: inputs.ollama,
    autoYes,
    noInstall: !parsedArgs.install,
  });
}
