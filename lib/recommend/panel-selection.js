import { savePanelCache } from "../constants.js";
import { loadCachedRecommendation } from "./panel-selection/cache.js";
import { resolvePanelModels } from "./panel-selection/sources.js";
import { runPanelByTier } from "./panel-selection/run.js";

function printPanelConsiderations(env, excludeFreeFromConfig) {
  console.log("│");
  console.log("◇  AI Panel Considerations & Exclusions");
  console.log(env.cloudOnlyFlag ? "│  \u2022 Local / Ollama models excluded via --exclude-local" : "│  \u2022 Local / Ollama models considered");
  console.log(env.localOnlyFlag ? "│  \u2022 Cloud models excluded via --exclude-cloud" : "│  \u2022 Cloud models considered");
  console.log(env.cliOptions.noCache ? "│  \u2022 Panel cache disabled via --no-cache" : "│  \u2022 Panel cache enabled");
  console.log(env.cliOptions.excludeCodex ? "│  \u2022 AI CLI agent cli/codex excluded via --exclude-codex" : "│  \u2022 AI CLI agent cli/codex considered");
  console.log(env.cliOptions.excludeAgy ? "│  \u2022 AI CLI agent cli/agy excluded via --exclude-agy" : "│  \u2022 AI CLI agent cli/agy considered");
  console.log(env.cliOptions.excludeOpencode ? "│  \u2022 AI CLI agent cli/opencode excluded via --exclude-opencode" : "│  \u2022 AI CLI agent cli/opencode considered");
  console.log(env.parsedArgs._noFreePanelExplicit ? "│  \u2022 Free models excluded from AI Panel via --no-free-panel" : "│  \u2022 Free models considered for AI Panel");
  console.log(excludeFreeFromConfig ? "│  \u2022 Free models excluded from JSONC configuration" : "│  \u2022 Free models considered for JSONC configuration");
  console.log("│");
}

export async function selectPanelRecommendation(env) {
  const state = {
    excludeFreeFromConfig: env.initialExcludeFreeFromConfig,
    excludeFreeExplicit: env.parsedArgs._excludeFreeExplicit,
    noExcludeFreeExplicit: env.parsedArgs._noExcludeFreeExplicit,
    freeConfigExplicit: env.parsedArgs._freeConfigExplicit,
    noFreeConfigExplicit: env.parsedArgs._noFreeConfigExplicit,
  };
  const cached = await loadCachedRecommendation(env);
  if (cached) return { ...cached, excludeFreeFromConfig: state.excludeFreeFromConfig };

  const panelModels = await resolvePanelModels(env, state);
  printPanelConsiderations(env, state.excludeFreeFromConfig);
  await env.ensureProbesAwaited();

  const { panelResult, chosenModels } = await runPanelByTier(env, panelModels);
  const aiResult = env.completeAiRecommendations(panelResult.selected);
  savePanelCache(
    { ...panelResult.selected, panel: { models: panelResult.panel?.models } },
    chosenModels,
    env.gpuCtx,
  );
  return {
    aiResult,
    panel: panelResult.panel,
    excludeFreeFromConfig: state.excludeFreeFromConfig,
  };
}
