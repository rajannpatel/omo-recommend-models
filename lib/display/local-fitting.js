import { normalizeLocalModelName } from "../omo-shared.js";

export function usableLocalVramGb(gpu) {
  const gpuVram = Number(gpu?.vramGb);
  if (!gpu?.hasGpu || !Number.isFinite(gpuVram)) return 0;
  return Math.max(0, gpuVram - 1.5);
}

export function buildFittingModels(allLocalModels, gpu) {
  const usableVramGb = usableLocalVramGb(gpu);
  return (allLocalModels || [])
    .filter((model) => {
      const modelVram = Number(model?.vram);
      return Boolean(
        model &&
        normalizeLocalModelName(model.name) &&
        Number.isFinite(modelVram) &&
        modelVram >= 0 &&
        modelVram <= usableVramGb,
      );
    })
    .map((model) => ({ ...model, name: normalizeLocalModelName(model.name) }));
}

export function buildFittingModelMap(allLocalModels, gpu) {
  const byName = new Map();
  for (const model of buildFittingModels(allLocalModels, gpu)) {
    if (!byName.has(model.name)) byName.set(model.name, model);
  }
  return byName;
}

export function resolveFittingLocalName(modelName, fittingByName) {
  const name = normalizeLocalModelName(modelName);
  return name && fittingByName.has(name) ? name : "";
}
