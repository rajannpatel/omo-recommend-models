const OLLAMA_REGISTRY_BASE_URL = "https://registry.ollama.ai/v2/library";

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function parseOllamaRef(ref) {
  const trimmed = String(ref || "").replace(/^(?:local|ollama)\//, "").trim();
  if (!trimmed) return null;
  const separator = trimmed.lastIndexOf(":");
  if (separator === -1) return { name: trimmed, tag: "latest" };
  const name = trimmed.slice(0, separator);
  const tag = trimmed.slice(separator + 1) || "latest";
  return name ? { name, tag } : null;
}

async function fetchJson(url, fetchFn, accept) {
  const response = await fetchFn(url, { headers: { accept } });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.json();
}

export function parseOpenRouterModels(payload) {
  const source = Array.isArray(payload) ? payload : asObject(payload)?.data;
  if (!Array.isArray(source)) return [];
  return source.flatMap((entry) => {
    const model = asObject(entry);
    if (!model || typeof model.id !== "string") return [];
    return [
      {
        id: model.id,
        name: typeof model.name === "string" ? model.name : model.id,
        contextLength: Number(model.context_length) || 0,
        architecture: asObject(model.architecture) || {},
        pricing: asObject(model.pricing) || {},
        topProvider: asObject(model.top_provider) || {},
        defaultParameters: asObject(model.default_parameters),
        popularity: Number(model.popularity) || 0,
      },
    ];
  });
}

export async function fetchOpenRouterModels({
  fetchFn = globalThis.fetch,
  url = "https://openrouter.ai/api/v1/models",
} = {}) {
  if (typeof fetchFn !== "function") throw new TypeError("fetchFn is required");
  const payload = await fetchJson(url, fetchFn, "application/json");
  return parseOpenRouterModels(payload);
}

export function parseOllamaManifestWeightGb(manifest) {
  const layers = asObject(manifest)?.layers;
  if (!Array.isArray(layers) || layers.length === 0) return null;
  let sizeBytes = 0;
  for (const layer of layers) {
    const size = asObject(layer)?.size;
    if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) return null;
    sizeBytes += size;
  }
  return sizeBytes > 0 ? sizeBytes / 1e9 : null;
}

export async function fetchOllamaManifestWeight(ref, { fetchManifest, fetchFn } = {}) {
  const parsed = parseOllamaRef(ref);
  if (!parsed) return null;
  try {
    const manifest = fetchManifest
      ? await fetchManifest(parsed)
      : await fetchJson(
          `${OLLAMA_REGISTRY_BASE_URL}/${encodeURIComponent(parsed.name)}/manifests/${encodeURIComponent(parsed.tag)}`,
          fetchFn,
          "application/vnd.docker.distribution.manifest.v2+json",
        );
    return parseOllamaManifestWeightGb(manifest);
  } catch {
    return null;
  }
}

export async function fetchOllamaManifestWeights(ollamaRefs, options = {}) {
  const weights = new Map();
  for (const ref of ollamaRefs || []) {
    const parsed = parseOllamaRef(ref);
    if (!parsed) continue;
    const key = `${parsed.name}:${parsed.tag}`;
    if (weights.has(key)) continue;
    weights.set(key, await fetchOllamaManifestWeight(key, options));
  }
  return weights;
}

export function buildOpenRouterIndex(openRouterModels) {
  const index = new Map();
  for (const model of openRouterModels || []) {
    if (model?.id) index.set(model.id, model);
  }
  return index;
}

export async function buildRegistryWeightMap({
  ollamaRefs = [],
  openRouterModels: _openRouterModels = [],
  fetchManifest,
  fetchFn,
} = {}) {
  return fetchOllamaManifestWeights(ollamaRefs, { fetchManifest, fetchFn });
}
