import { createProgress } from "../display-utils.js";

export function skippedGpu() {
  return {
    hasGpu: false,
    name: "",
    label: "Not checked (--cloud-only)",
    vramGb: 0,
  };
}

export function skippedOllama() {
  return { installed: false, running: false, version: null, models: [] };
}

export async function discoverLocalEnvironment({
  cloudOnlyFlag,
  detectGPU,
  detectOllama,
  discoverModels,
}) {
  let gpu;
  let ollama;
  if (cloudOnlyFlag) {
    createProgress("Checking GPU").skip("skipped by --cloud-only");
    createProgress("Checking Ollama").skip("skipped by --cloud-only");
    gpu = skippedGpu();
    ollama = skippedOllama();
  } else {
    const gpuProgress = createProgress("Checking GPU");
    gpu = detectGPU();
    gpuProgress.done(gpu.label);

    const ollamaProgress = createProgress("Checking Ollama");
    ollama = detectOllama();
    ollamaProgress.done(
      ollama.running
        ? `${ollama.models.length} installed model(s)`
        : ollama.installed
          ? "installed, not running"
          : "not installed",
    );
  }

  let allLocalModels = [];
  let localModelNames = [];
  if (!cloudOnlyFlag && ollama.installed) {
    const localProgress = createProgress("Discovering local model catalog");
    allLocalModels = await discoverModels(false, localProgress);
    localModelNames = ollama.models.map((model) => model.name);
  } else {
    createProgress("Discovering local model catalog").skip(
      cloudOnlyFlag ? "skipped by --cloud-only" : "Ollama not installed",
    );
  }

  return { gpu, ollama, allLocalModels, localModelNames };
}
