import fs from "node:fs";
import {
  getBackupPath,
  getConfigPath,
  normalizeLocalModelName,
} from "../omo-shared.js";
import {
  applyLocalPlacements,
  offerUninstallOrphans,
  resolveInstallDecisions,
  uninstallModelsFromDecisions,
} from "../apply-local.js";
import { applicableCloudAssignment } from "./finalized-recommendations.js";
import {
  backupConfig,
  writeConfigWithValidation,
} from "./apply.js";

export function applyCloudAssignments({
  recommendations,
  config,
  confirmedModels,
  excludeFreeFromConfig,
  isFreeRef = () => false,
  isProviderAllowed = () => true,
}) {
  let totalCloud = 0;

  for (const rec of recommendations || []) {
    const section =
      config.agents?.[rec.name] || config.categories?.[rec.name];
    if (!section) continue;
    const assignment = applicableCloudAssignment({
      confirmedModels,
      excludeFreeFromConfig,
      isFreeRef,
      isProviderAllowed,
      rec,
      section,
    });
    if (!assignment?.hasChanges) continue;

    if (assignment.model) {
      section.model = assignment.modelString;
      if (assignment.model.variant) section.variant = assignment.model.variant;
      else delete section.variant;
    }
    delete section.routing;
    section.fallback_models =
      assignment.fallbackValues.length > 0
        ? assignment.fallbackValues
        : undefined;
    if (!section.fallback_models) delete section.fallback_models;
    totalCloud++;
  }
  return totalCloud;
}

export async function applyRecommendations({
  aiResult,
  config,
  ollama,
  allLocalModels,
  autoYes,
  install,
  uninstall,
  removeOrphans,
  excludeFreeFromConfig,
  global: isGlobal,
  validatorPath,
  isProviderAllowed,
  isFreeRef,
  confirmedModels,
  ctx = null,
}) {
  if (backupConfig(getConfigPath({ global: isGlobal }), getBackupPath({ global: isGlobal }))) {
    console.log(`\u2713  \u2022 Backup saved to ${getBackupPath({ global: isGlobal })}`);
  }

  const configPath = getConfigPath({ global: isGlobal });
  const resolvedConfirmedModels = confirmedModels || await resolveInstallDecisions({
    decisions: aiResult.localModels?.decisions,
    ollama,
    autoYes,
    noInstall: !install,
    configPath,
    ctx,
  });
  await uninstallModelsFromDecisions({
    decisions: aiResult.localModels?.decisions,
    ollama,
    autoYes,
    noUninstall: !uninstall,
    ctx,
  });

  const totalCloud = applyCloudAssignments({
    recommendations: aiResult.cloudRecommendations,
    config,
    confirmedModels: resolvedConfirmedModels,
    excludeFreeFromConfig,
    isFreeRef,
    isProviderAllowed,
  });

  let totalLocal = 0;
  if (aiResult.localModels?.placements) {
    const confirmedPlacements = aiResult.localModels.placements.filter((placement) =>
      resolvedConfirmedModels.has(normalizeLocalModelName(placement.modelName)),
    );
    if (confirmedPlacements.length > 0) {
      totalLocal = await applyLocalPlacements(
        confirmedPlacements,
        config,
        autoYes,
        allLocalModels,
      );
    }
  }

  const totalChanges = totalCloud + totalLocal;

  console.log("│  \u2192 Validating changes...");
  try {
    writeConfigWithValidation({
      config,
      configPath: getConfigPath({ global: isGlobal }),
      backupPath: getBackupPath({ global: isGlobal }),
      validatorPath,
      validateStdio: ["inherit", "inherit", "pipe"],
      ctx,
    });
    console.log(`\u2713  \u2022 ${totalChanges} section(s) updated.`);
    console.log("│");
  } catch (validationErr) {
    const stderr = validationErr.stderr ? validationErr.stderr.toString() : "";
    console.error(`\n\u2716 Validation FAILED.`);
    if ((ctx?.verboseMode || ctx?.debugMode) && stderr) {
      for (const line of stderr.trim().split("\n")) {
        console.error(`  ${line}`);
      }
    }
    if (fs.existsSync(getBackupPath({ global: isGlobal }))) {
      console.log(
        `  \u2713 Reverted to previous config (backup at ${getBackupPath({ global: isGlobal })})`,
      );
    } else {
      console.log(
        `  \u26A0 No backup found at ${getBackupPath({ global: isGlobal })} \u2014 config on disk may be invalid.`,
      );
    }
    console.log(
      `  Recommendations were NOT applied. Fix the issues above and re-run.`,
    );
    throw new Error(
      `Validation failed after applying recommendations. Config was reverted to backup.`,
    );
  }

  await offerUninstallOrphans(
    aiResult.localModels?.decisions,
    ollama,
    autoYes,
    !removeOrphans,
    ctx,
  );

  console.log("\u2713  Done.");
}
