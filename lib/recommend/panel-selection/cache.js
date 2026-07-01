import { loadPanelCache } from "../../constants.js";
import {
  buildFittingModelMap,
  printNumberedPanelModelGroups,
  resultHasRejectedLocal,
} from "../../display-utils.js";

function panelCacheAge(timestamp) {
  const age = Date.now() - timestamp;
  if (age > 86400000) return `${(age / 86400000).toFixed(1)}d`;
  if (age > 3600000) return `${(age / 3600000).toFixed(1)}h`;
  return `${Math.round(age / 60000)}m`;
}

function printCachedPanel(cached) {
  const cachedModelList = cached.models || cached.result?.panel?.models || [];
  const ts = new Date(cached.timestamp)
    .toISOString()
    .replace("T", " ")
    .slice(0, 19);
  console.log(`\nCached panel result:`);
  if (cachedModelList.length > 0) {
    console.log(`  \u2022 Surveyed AI models:`);
    printNumberedPanelModelGroups(cachedModelList, "    ");
  }
  if (cached.gpu?.label) {
    const gpuLine = `  \u2022 Hardware: ${cached.gpu.label}`;
    console.log(cached.gpu.vramGb ? `${gpuLine} (${cached.gpu.vramGb} GB VRAM)` : gpuLine);
  }
  console.log(`  \u2022 Recorded: ${ts} (${panelCacheAge(cached.timestamp)} ago)`);
}

export async function loadCachedRecommendation(env) {
  if (env.autoYes || env.dryRun || env.cliOptions.noCache) return null;
  const cached = loadPanelCache();
  if (!cached) return null;
  printCachedPanel(cached);
  if (!(await env.confirm(`\nUse cached? (y/N) `))) return null;
  await env.ensureProbesAwaited();
  const fittingByName = env.localRecommendationContext?.fittingByName ||
    buildFittingModelMap(env.localCtx, env.gpuCtx);
  if (resultHasRejectedLocal(cached.result, fittingByName, env.localRecommendationContext)) {
    console.log(`  \u2022 Cached result references unavailable local models; running fresh.\n`);
    return null;
  }
  console.log(`  \u2713 Loaded cached panel result.\n`);
  return {
    aiResult: env.completeAiRecommendations(cached.result),
    panel: cached.result.panel || null,
  };
}
