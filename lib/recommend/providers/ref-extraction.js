import { LOCAL_PROVIDER } from "../../constants.js";

const INELIGIBLE_PROBE_PROVIDERS = new Set([LOCAL_PROVIDER, "ollama", "cli"]);

function isValidProviderSegment(provider) {
  return (
    typeof provider === "string" &&
    provider.length > 0 &&
    !provider.includes("/") &&
    !/\s/.test(provider)
  );
}

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
  const seen = new Set();
  const providerSets = cloudLookup?.sets || {};
  for (const [provider, modelSet] of Object.entries(providerSets)) {
    if (
      !isValidProviderSegment(provider) ||
      INELIGIBLE_PROBE_PROVIDERS.has(provider) ||
      !modelSet
    ) {
      continue;
    }
    for (const rawModelId of modelSet) {
      if (typeof rawModelId !== "string") continue;
      const modelId = rawModelId.trim();
      if (!modelId || /\s/.test(modelId)) continue;
      const metadata = cloudLookup?.byId?.[provider]?.get(modelId);
      if (metadata?.capabilities?.toolcall === false) continue;
      const ref = `${provider}/${modelId}`;
      if (seen.has(ref)) continue;
      seen.add(ref);
      refs.push(ref);
    }
  }
  return refs;
}

export function probeModelRefsFromAdvertisement(advertisedRefs, cloudLookup) {
  const refs = [];
  for (const ref of providerProbeCandidates(advertisedRefs)) {
    const slash = ref.indexOf("/");
    const provider = ref.slice(0, slash);
    const modelId = ref.slice(slash + 1);
    if (!cloudLookup?.sets?.[provider]?.has(modelId)) continue;
    const metadata = cloudLookup?.byId?.[provider]?.get(modelId);
    if (metadata?.capabilities?.toolcall === false) continue;
    refs.push(ref);
  }
  return refs;
}

export function providerProbeCandidates(advertisedRefs) {
  const out = [];
  const seen = new Set();
  for (const rawRef of advertisedRefs || []) {
    if (typeof rawRef !== "string") continue;
    const ref = rawRef.trim();
    const slash = ref.indexOf("/");
    if (slash <= 0 || slash === ref.length - 1 || /\s/.test(ref)) continue;
    const provider = ref.slice(0, slash);
    if (INELIGIBLE_PROBE_PROVIDERS.has(provider) || seen.has(ref)) continue;
    seen.add(ref);
    out.push(ref);
  }
  return out;
}
