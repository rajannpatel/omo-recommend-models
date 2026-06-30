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
  isProviderAllowed = () => true,
}) {
  let totalCloud = 0;
  const refString = (ref) => `${ref.provider}/${ref.model}`;
  const fallbackValue = (ref) => {
    const hasSettings =
      ref.variant ||
      ref.reasoningEffort ||
      ref.temperature !== undefined ||
      ref.top_p !== undefined ||
      ref.maxTokens !== undefined ||
      ref.thinking;
    if (!hasSettings) return refString(ref);
    return {
      model: refString(ref),
      ...(ref.variant ? { variant: ref.variant } : {}),
      ...(ref.reasoningEffort ? { reasoningEffort: ref.reasoningEffort } : {}),
      ...(ref.temperature !== undefined ? { temperature: ref.temperature } : {}),
      ...(ref.top_p !== undefined ? { top_p: ref.top_p } : {}),
      ...(ref.maxTokens !== undefined ? { maxTokens: ref.maxTokens } : {}),
      ...(ref.thinking ? { thinking: ref.thinking } : {}),
    };
  };

  for (const rec of recommendations || []) {
    const section =
      config.agents?.[rec.name] || config.categories?.[rec.name];
    if (!section) continue;

    const localOk = (ref) =>
      ref.provider !== LOCAL_PROVIDER ||
      (confirmedModels && confirmedModels.has(normalizeLocalModelName(ref.model)));
    const freeOk = (ref) => !excludeFreeFromConfig || ref.provider !== "opencode";
    const providerOk = (ref) => isProviderAllowed(ref.provider);

    const modelOk =
      rec.model && providerOk(rec.model) && localOk(rec.model) && freeOk(rec.model);
    const fallbackOk = (rec.fallback_models || []).filter(
      (ref) => providerOk(ref) && localOk(ref) && freeOk(ref),
    );

    if (!modelOk && fallbackOk.length === 0) {
      continue;
    }

    if (modelOk) {
      section.model = refString(rec.model);
      if (rec.model.variant) section.variant = rec.model.variant;
      else delete section.variant;
    }
    delete section.routing;
    section.fallback_models =
      fallbackOk.length > 0
        ? fallbackOk.map(fallbackValue)
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
  validatorPath,
  isProviderAllowed,
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
    isProviderAllowed,
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
