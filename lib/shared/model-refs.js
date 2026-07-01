export function buildProviderAliases(config) {
  const aliases = {};
  const canonicalProviders = new Set(["local", "openai", "opencode"]);
  for (const [key, entry] of Object.entries(config.providers || {})) {
    if (entry.type && entry.type !== key && !canonicalProviders.has(key)) {
      aliases[key] = entry.type;
    }
  }
  return aliases;
}

export function resolveProvider(providerKey, aliases) {
  return aliases[providerKey] || providerKey;
}

export function normalizeLocalModelName(modelName) {
  const trimmed = String(modelName || "").trim();
  const withoutProvider = trimmed.replace(/^(?:local|ollama)\//, "");
  if (!withoutProvider) return "";
  return withoutProvider.includes(":") ? withoutProvider : `${withoutProvider}:latest`;
}

export function formatModelRef(provider, modelName) {
  if (provider === "local") {
    const trimmed = String(modelName || "").trim();
    const withoutProvider = trimmed.replace(/^(?:local|ollama)\//, "");
    if (withoutProvider) {
      return `local/${withoutProvider.includes(":") ? withoutProvider : `${withoutProvider}:latest`}`;
    }
    return `local/${trimmed}`;
  }
  return `${provider}/${String(modelName || "")}`;
}

export function modelRef(provider, modelName) {
  return formatModelRef(provider, modelName);
}

export function splitModelRef(ref) {
  const trimmed = String(ref || "").trim();
  const slash = trimmed.indexOf("/");
  if (slash === -1) return { provider: "", model: trimmed };
  return {
    provider: trimmed.slice(0, slash),
    model: trimmed.slice(slash + 1),
  };
}

export function buildRichModelLookup(cache) {
  const byId = {};
  const sets = {};
  if (!cache || !cache.models) return { byId, sets };
  for (const [provider, models] of Object.entries(cache.models)) {
    const modelMap = new Map();
    const modelSet = new Set();
    for (const model of Array.isArray(models) ? models : []) {
      const id = typeof model === "string" ? model : model.id;
      modelSet.add(id);
      if (typeof model === "object" && model !== null) modelMap.set(id, model);
    }
    byId[provider] = modelMap;
    sets[provider] = modelSet;
  }
  return { byId, sets };
}

export function normalizeModelNameForMatching(name) {
  return String(name || "")
    .toLowerCase()
    .trim()
    .replace(/-preview$/, "")
    .replace(/[\s._]+/g, "-");
}

function sortedModelTokens(name) {
  return normalizeModelNameForMatching(name)
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .sort();
}

export function modelNamesEquivalent(left, right) {
  const normalizedLeft = normalizeModelNameForMatching(left);
  const normalizedRight = normalizeModelNameForMatching(right);
  if (!normalizedLeft || !normalizedRight) return false;
  if (normalizedLeft === normalizedRight) return true;

  const leftTokens = sortedModelTokens(left);
  const rightTokens = sortedModelTokens(right);
  if (leftTokens.length < 2 || leftTokens.length !== rightTokens.length) {
    return false;
  }
  return leftTokens.every((token, index) => token === rightTokens[index]);
}
