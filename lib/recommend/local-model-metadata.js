function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
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
