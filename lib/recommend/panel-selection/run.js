function hasSuccessfulResponse(res) {
  return res &&
    res.panel &&
    res.panel.state &&
    res.panel.state.some((state) => state.results.some((result) => result !== null));
}

export async function runPanelByTier(env, panelModels) {
  if (env.cliOptions.parallelPanel) {
    return {
      panelResult: await env.runPanelAndSelect(panelModels),
      chosenModels: panelModels,
    };
  }
  const tier1 = panelModels.filter((model) => model.startsWith("opencode/") || model === "cli/opencode");
  const tier2 = panelModels.filter((model) => model === "cli/agy");
  const tier3 = panelModels.filter((model) => model === "cli/codex");
  const otherModels = panelModels.filter((model) =>
    !tier1.includes(model) && !tier2.includes(model) && !tier3.includes(model),
  );
  tier2.push(...otherModels);
  for (const tier of [tier1, tier2, tier3]) {
    if (tier.length === 0) continue;
    const res = await env.runPanelAndSelect(tier);
    if (hasSuccessfulResponse(res)) {
      return { panelResult: res, chosenModels: tier };
    }
  }
  return {
    panelResult: await env.runPanelAndSelect(panelModels),
    chosenModels: panelModels,
  };
}
