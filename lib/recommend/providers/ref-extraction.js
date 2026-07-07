import { LOCAL_PROVIDER } from "../../constants.js";

export function paidModelRefsFromLookup(cloudLookup) {
  const refs = [];
  for (const [provider, modelMap] of Object.entries(cloudLookup.byId || {})) {
    if (provider === LOCAL_PROVIDER || provider === "opencode") continue;
    for (const modelId of modelMap.keys()) refs.push(`${provider}/${modelId}`);
  }
  return refs;
}

export function probeModelRefsFromLookup(cloudLookup) {
  const refs = [];
  for (const [provider, modelMap] of Object.entries(cloudLookup.byId || {})) {
    if (provider === LOCAL_PROVIDER || provider === "cli") continue;
    for (const modelId of modelMap.keys()) refs.push(`${provider}/${modelId}`);
  }
  return refs;
}

export function providerProbeCandidates(sortedPaidRefs) {
  const byProvider = {};
  for (const ref of sortedPaidRefs) {
    const provider = ref.split("/")[0];
    if (!byProvider[provider]) byProvider[provider] = [];
    byProvider[provider].push(ref);
  }
  const out = [];
  for (const [provider, models] of Object.entries(byProvider)) {
    if (provider === "openrouter" || provider === "opencode") {
      out.push(...models);
    } else {
      if (models.length > 0) {
        out.push(models[0]);
      }
    }
  }
  return out;
}