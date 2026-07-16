import { discoverFreeModels, isZeroCostModelMeta } from "../../shared/provider-cache.js";

let resolvedFreeModels = null;

function resolveFreeModels() {
  if (resolvedFreeModels) return resolvedFreeModels;
  try {
    resolvedFreeModels = discoverFreeModels();
  } catch {
    resolvedFreeModels = [];
  }
  return resolvedFreeModels;
}

function freeModelsFromLookup(cloudLookup) {
  const refs = [];
  for (const [provider, modelMap] of Object.entries(cloudLookup?.byId || {})) {
    if (!modelMap || modelMap.size === 0) continue;
    for (const [model, meta] of modelMap.entries()) {
      if (isZeroCostModelMeta(meta) && meta?.capabilities?.toolcall === true) {
        refs.push(`${provider}/${model}`);
      }
    }
  }
  return refs;
}

function uniqueModelRefs(...groups) {
  return [...new Set(groups.flat())];
}

function splitModelRef(ref) {
  const slash = ref.indexOf("/");
  if (slash === -1) return null;
  return { provider: ref.slice(0, slash), model: ref.slice(slash + 1) };
}

function zeroCostRefsFromAllowedModels(allowedPaidModels, cloudLookup) {
  return [...allowedPaidModels].filter((ref) => {
    const parsed = splitModelRef(ref);
    if (!parsed) return false;
    const meta = cloudLookup?.byId?.[parsed.provider]?.get(parsed.model);
    return isZeroCostModelMeta(meta) && meta?.capabilities?.toolcall === true;
  });
}

export function validatedZeroCostEvaluatorModels(
  cloudLookup,
  isModelAllowed,
  allowedPaidModels,
) {
  const validatedZeroCostRefs = zeroCostRefsFromAllowedModels(
    allowedPaidModels,
    cloudLookup,
  );

  return uniqueModelRefs(
    validatedZeroCostRefs,
    freeModelsFromLookup(cloudLookup),
    resolveFreeModels(),
  ).filter((ref) => {
    const parsed = splitModelRef(ref);
    if (!parsed) return false;
    return isModelAllowed(parsed);
  });
}
