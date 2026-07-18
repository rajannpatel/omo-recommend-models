import path from "node:path";

import { resolveInstallDecisions } from "../apply-local.js";
import { applyRecommendations } from "../recommend/apply-recommendations.js";
import { isProviderAvailable } from "../probe-providers.js";
import { buildFreeModelRefPredicate } from "../shared/provider-cache.js";
import {
  showAiAnalysis,
  showAiAnalysisGaps,
  showCloudRecommendations,
  showLocalModelDecisions,
  showLocalPlacements,
  showLocalWarnings,
  showRuleChainMatched,
} from "./recommend-output.js";
import { getBackupPath, getConfigPath } from "../omo-shared.js";

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
  showRuleChainMatched(aiResult);
  showAiAnalysisGaps(aiResult);
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
    ctx,
  });

  const globalFlag = Boolean(parsedArgs.global);
  const isFreeRef = buildFreeModelRefPredicate(inputs.cloudLookup);
  console.log("│");
  console.log(`◇  Recommended provider/model configurations for ${getConfigPath({ global: globalFlag })}:`);
  const cloudChanges = showCloudRecommendations({
    aiResult,
    config: inputs.config,
    confirmedModels: installedModels,
    excludeFreeFromConfig,
    isFreeRef,
    isProviderAllowed: (provider) => {
      const excluded = new Set((parsedArgs?.["exclude-model"] || []).map(m => String(m).trim().toLowerCase()));
      if (excluded.has(provider.toLowerCase())) return false;
      return isProviderAvailable(ctx, provider);
    },
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
  const configPath = getConfigPath({ global: globalFlag });
  const backupPath = getBackupPath({ global: globalFlag });
  console.log("│");
  console.log("◇  Choosing to apply will:");
  console.log(`│  \u2022 Move existing file to: ${backupPath}`);
  console.log(`│  \u2022 Write new file: ${configPath}`);
  console.log("│");
  if (!autoYes && !await runtime.confirmDefaultYes("◇  Apply these changes? (Y/n) ")) {
    console.log("│");
    console.log("◇  Skipped.");
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
    isFreeRef,
    global: globalFlag,
    validatorPath: path.join(packageRoot, "bin", "omo-validate-config"),
    isProviderAllowed: (provider) => isProviderAvailable(ctx, provider),
    confirmedModels: installedModels,
    ctx,
  });
}

async function resolveConfirmedModels({ aiResult, autoYes, ctx, dryRun, inputs, parsedArgs }) {
  const canAskInDryRun = dryRun && (parsedArgs.interactive || process.stdin.isTTY);
  if (!parsedArgs.apply || (dryRun && !canAskInDryRun && !autoYes)) return null;
  const configPath = getConfigPath({ global: Boolean(parsedArgs.global) });
  return resolveInstallDecisions({
    decisions: aiResult.localModels?.decisions,
    ollama: inputs.ollama,
    autoYes,
    noInstall: !parsedArgs.install,
    dryRun,
    configPath,
    ctx,
  });
}
