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
import { matchModel, MATCH_STRATEGIES } from "./model-matching.js";
import { fetchProviderModelCatalog, isProviderCatalogFetchable } from "../probe-providers.js";

export function applyCloudAssignments({
  recommendations,
  config,
  confirmedModels,
  excludeFreeFromConfig,
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

async function enhanceCloudRecommendationsWithMatchingPipeline(cloudRecommendations, _isProviderAllowed) {
  if (!cloudRecommendations) return [];
  
  const enhanced = [];
  
  for (const rec of cloudRecommendations) {
    let enhancedModel = rec.model;
    
    // Get the provider's model catalog - provider is in the model object
    const provider = enhancedModel.provider;
    if (isProviderCatalogFetchable(provider)) {
      const catalog = await fetchProviderModelCatalog(provider);
      if (catalog?.models?.length > 0) {
        // Create requirement object for matching (model and variant from recommendation)
        const requirement = {
          model: enhancedModel.model,
          variant: enhancedModel.variant,
        };
        
        // Try deterministic matching first
        const deterministicMatches = matchModel(requirement, new Map(catalog.models.map(m => [m.id, m])), MATCH_STRATEGIES.DETERMINISTIC);
        const bestDeterministic = deterministicMatches[0];
        
        if (bestDeterministic && bestDeterministic.confidence > (enhancedModel.confidence || 0)) {
          enhancedModel = {
            ...enhancedModel,
            ...bestDeterministic,
            confidence: bestDeterministic.confidence,
            matchType: bestDeterministic.matchType,
          };
        } else {
          // Try machine-readable matching if deterministic didn't improve
          const machineReadableMatches = matchModel(requirement, new Map(catalog.models.map(m => [m.id, m])), MATCH_STRATEGIES.MACHINE_READABLE);
          const bestMachineReadable = machineReadableMatches.find(m => m.confidence > 0.7);
          
          if (bestMachineReadable) {
            enhancedModel = {
              ...enhancedModel,
              ...bestMachineReadable,
              confidence: bestMachineReadable.confidence,
              matchType: bestMachineReadable.matchType,
            };
          }
        }
      }
    }
    
    enhanced.push({
      ...rec,
      model: enhancedModel,
    });
  }
  
  return enhanced;
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
  confirmedModels,
  ctx = null,
  useMatchingPipeline = false,
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

  const enhancedCloudRecommendations = useMatchingPipeline ? 
    await enhanceCloudRecommendationsWithMatchingPipeline(aiResult.cloudRecommendations, isProviderAllowed) : 
    aiResult.cloudRecommendations;

  const totalCloud = applyCloudAssignments({
    recommendations: enhancedCloudRecommendations,
    config,
    confirmedModels: resolvedConfirmedModels,
    excludeFreeFromConfig,
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
    if (stderr) {
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
