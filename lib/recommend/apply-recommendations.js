import fs from "node:fs";
import {
  getBackupPath,
  getConfigPath,
  normalizeLocalModelName,
} from "../omo-shared.js";
import { LOCAL_PROVIDER } from "../constants.js";
import {
  applyLocalPlacements,
  installAndUninstallModels,
  offerUninstallOrphans,
} from "../apply-local.js";
import {
  backupConfig,
  writeConfigWithValidation,
} from "./apply.js";

export function applyCloudAssignments({
  recommendations,
  config,
  confirmedModels,
  excludeFreeFromConfig,
}) {
  let totalCloud = 0;
  for (const rec of recommendations || []) {
    const section =
      config.agents?.[rec.name] || config.categories?.[rec.name];
    if (!section) continue;

    const localOk = (ref) =>
      ref.provider !== LOCAL_PROVIDER ||
      (confirmedModels && confirmedModels.has(normalizeLocalModelName(ref.model)));
    const freeOk = (ref) => !excludeFreeFromConfig || ref.provider !== "opencode";

    const modelOk = rec.model && localOk(rec.model) && freeOk(rec.model);
    const routingOk = (rec.routing || []).filter(
      (ref) => localOk(ref) && freeOk(ref),
    );
    const fallbackOk = (rec.fallback_models || []).filter(
      (ref) => localOk(ref) && freeOk(ref),
    );

    if (!modelOk && routingOk.length === 0 && fallbackOk.length === 0) {
      continue;
    }

    if (modelOk) section.model = `${rec.model.provider}/${rec.model.model}`;
    section.routing =
      routingOk.length > 0
        ? routingOk.map((ref) => `${ref.provider}/${ref.model}`)
        : undefined;
    section.fallback_models =
      fallbackOk.length > 0
        ? fallbackOk.map((ref) => `${ref.provider}/${ref.model}`)
        : undefined;
    if (!section.routing) delete section.routing;
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
  validatorPath,
}) {
  if (backupConfig(getConfigPath(), getBackupPath())) {
    console.log(`  \u2713 Backup saved to ${getBackupPath()}`);
  }

  const confirmedModels = await installAndUninstallModels(
    aiResult.localModels?.decisions,
    ollama,
    autoYes,
    !install,
    !uninstall,
  );

  const totalCloud = applyCloudAssignments({
    recommendations: aiResult.cloudRecommendations,
    config,
    confirmedModels,
    excludeFreeFromConfig,
  });

  let totalLocal = 0;
  if (aiResult.localModels?.placements) {
    const confirmedPlacements = aiResult.localModels.placements.filter((placement) =>
      confirmedModels.has(normalizeLocalModelName(placement.modelName)),
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

  console.log(`  Backup: ${getBackupPath()}`);
  const totalChanges = totalCloud + totalLocal;

  console.log("\u2192 Validating changes...");
  try {
    writeConfigWithValidation({
      config,
      configPath: getConfigPath(),
      backupPath: getBackupPath(),
      validatorPath,
      validateStdio: ["inherit", "inherit", "pipe"],
    });
    console.log(`\u2705 ${totalChanges} section(s) updated.\n`);
  } catch (validationErr) {
    const stderr = validationErr.stderr ? validationErr.stderr.toString() : "";
    console.error(`\n\u2716 Validation FAILED.`);
    if (stderr) {
      for (const line of stderr.trim().split("\n")) {
        console.error(`  ${line}`);
      }
    }
    if (fs.existsSync(getBackupPath())) {
      console.log(
        `  \u2713 Reverted to previous config (backup at ${getBackupPath()})`,
      );
    } else {
      console.log(
        `  \u26A0 No backup found at ${getBackupPath()} \u2014 config on disk may be invalid.`,
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
  );

  console.log("\n\u2705 Done.");
}
