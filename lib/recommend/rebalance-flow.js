import fs from "node:fs";

import {
  buildProviderAliases,
  buildRichModelLookup,
  getBackupPath,
  getConfigPath,
  loadProviderModels,
} from "../omo-shared.js";
import {
  buildTierChains,
  rebalanceConfig,
  showRebalance,
} from "../rebalance.js";
import {
  backupConfig,
  writeConfigWithValidation,
} from "./apply.js";

export function addLocalModelsToLookup(richLookup, localModelNames) {
  if (localModelNames.length === 0) return richLookup;

  if (!richLookup.sets.local) richLookup.sets.local = new Set();
  for (const modelName of localModelNames) {
    richLookup.sets.local.add(modelName);
  }

  if (!richLookup.byId.local) richLookup.byId.local = new Map();
  for (const modelName of localModelNames) {
    if (!richLookup.byId.local.has(modelName)) {
      richLookup.byId.local.set(modelName, null);
    }
  }

  return richLookup;
}

export async function runRebalanceFlow({
  config,
  localModelNames,
  dryRun,
  autoYes,
  confirm,
  validatorPath,
}) {
  const cache = loadProviderModels();
  const aliases = buildProviderAliases(config);
  const richLookup = addLocalModelsToLookup(
    buildRichModelLookup(cache),
    localModelNames,
  );

  showRebalance(config, richLookup, aliases, localModelNames);

  const tierChains = buildTierChains(richLookup, aliases);
  const rebalanceChanges = rebalanceConfig(config, {
    unavailableModels: new Set(),
    providerAliases: aliases,
    modelCache: richLookup,
    tierChains,
  });

  if (rebalanceChanges.length === 0) {
    console.log("\n\u2705 No restructuring needed.\n");
    return;
  }

  console.log(
    `\n\uD83D\uDCCB ${rebalanceChanges.length} section(s) would be restructured:\n`,
  );
  for (const change of rebalanceChanges) console.log(`  ${change}`);

  if (dryRun) {
    console.log(`\n   \u2192 Apply: omo-recommend-models --rebalance\n`);
    return;
  }

  if (!autoYes) {
    const ok = await confirm(`Apply ${rebalanceChanges.length} changes? (y/N) `);
    if (!ok) {
      console.log("  Skipped.\n");
      return;
    }
  }

  if (backupConfig(getConfigPath(), getBackupPath())) {
    console.log(`  \u2713 Backup saved to ${getBackupPath()}`);
  }
  console.log(`  Backup: ${getBackupPath()}`);

  try {
    writeConfigWithValidation({
      config,
      configPath: getConfigPath(),
      backupPath: getBackupPath(),
      validatorPath,
      validateStdio: "inherit",
    });
    console.log(`\u2705 ${rebalanceChanges.length} section(s) restructured.\n`);
  } catch (validationErr) {
    console.error(`\n\u2716 Validation FAILED.`);
    if (fs.existsSync(getBackupPath())) {
      console.log(
        `  \u2713 Reverted to previous config (backup at ${getBackupPath()})`,
      );
    } else {
      console.log(
        `  \u26A0 No backup found at ${getBackupPath()} \u2014 config on disk may be invalid.`,
      );
    }
    throw validationErr;
  }
}
