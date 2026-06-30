import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRegistryWeightMap,
  fetchOllamaManifestWeights,
  parseOllamaManifestWeightGb,
  parseOpenRouterModels,
} from "../../lib/recommend/local-model-metadata.js";

test("parseOpenRouterModels normalizes stable metadata without fabricating Ollama tags", () => {
  // Given: realistic minimal OpenRouter model metadata with one missing popularity value.
  const payload = {
    data: [
      {
        id: "meta-llama/llama-3.1-8b-instruct",
        name: "Meta: Llama 3.1 8B Instruct",
        context_length: 131072,
        architecture: {
          modality: "text->text",
          tokenizer: "Llama3",
          instruct_type: "llama3",
        },
        pricing: { prompt: "0.00000018", completion: "0.00000018" },
        top_provider: { context_length: 131072, max_completion_tokens: 8192 },
        popularity: 847,
      },
      {
        id: "qwen/qwen-2.5-coder-7b-instruct",
        name: "Qwen2.5 Coder 7B Instruct",
        context_length: 32768,
        architecture: {
          modality: "text->text",
          tokenizer: "Qwen",
          instruct_type: "chatml",
        },
        pricing: { prompt: "0.00000007", completion: "0.00000009" },
        top_provider: { context_length: 32768, max_completion_tokens: 8192 },
      },
    ],
  };

  // When: the OpenRouter payload is parsed into local recommendation metadata.
  const models = parseOpenRouterModels(payload);

  // Then: stable metadata is preserved, absent popularity defaults to 0, and no Ollama tag is invented.
  assert.equal(models.length, 2);
  assert.equal(models[0].id, "meta-llama/llama-3.1-8b-instruct");
  assert.equal(models[0].name, "Meta: Llama 3.1 8B Instruct");
  assert.equal(models[0].contextLength, 131072);
  assert.equal(models[0].popularity, 847);
  assert.equal(models[1].id, "qwen/qwen-2.5-coder-7b-instruct");
  assert.equal(models[1].contextLength, 32768);
  assert.equal(models[1].popularity, 0);
  assert.equal(Object.hasOwn(models[0], "ollamaTag"), false);
  assert.equal(Object.hasOwn(models[0], "ollamaName"), false);
  assert.equal(Object.hasOwn(models[1], "ollamaTag"), false);
  assert.equal(Object.hasOwn(models[1], "ollamaName"), false);
});

test("parseOllamaManifestWeightGb sums OCI layer sizes and returns null for invalid manifests", () => {
  // Given: an Ollama OCI-style manifest with layer byte sizes and several invalid fallback shapes.
  const manifest = {
    schemaVersion: 2,
    mediaType: "application/vnd.docker.distribution.manifest.v2+json",
    layers: [
      {
        mediaType: "application/vnd.ollama.image.model",
        digest: "sha256:111",
        size: 3_500_000_000,
      },
      {
        mediaType: "application/vnd.ollama.image.params",
        digest: "sha256:222",
        size: 250_000_000,
      },
    ],
  };

  // When: the manifest weight is parsed from layer sizes.
  const weightGb = parseOllamaManifestWeightGb(manifest);

  // Then: all OCI layer sizes are converted from bytes to decimal GB, while invalid manifests fall back to null.
  assert.equal(weightGb, 3.75);
  assert.equal(parseOllamaManifestWeightGb(null), null);
  assert.equal(parseOllamaManifestWeightGb({ layers: [] }), null);
  assert.equal(parseOllamaManifestWeightGb({ layers: [{ size: "not-a-number" }] }), null);
});

test("fetchOllamaManifestWeights deduplicates manifest requests and keeps partial failures as null", async () => {
  // Given: duplicate Ollama refs plus a fetch adapter that fails for one manifest.
  const calls = [];
  const fetchManifest = async ({ name, tag }) => {
    calls.push(`${name}:${tag}`);
    if (name === "broken-model") {
      throw new Error("registry unavailable");
    }
    return {
      schemaVersion: 2,
      layers: [
        { mediaType: "application/vnd.ollama.image.model", size: 4_000_000_000 },
        { mediaType: "application/vnd.ollama.image.params", size: 500_000_000 },
      ],
    };
  };

  // When: weights are fetched through the injected adapter only.
  const weights = await fetchOllamaManifestWeights(
    ["llama3.1:8b", "llama3.1:8b", "qwen2.5-coder:7b", "broken-model:latest"],
    { fetchManifest },
  );

  // Then: duplicate refs are fetched once, successful weights are retained, and failed refs become null.
  assert.deepEqual(calls, ["llama3.1:8b", "qwen2.5-coder:7b", "broken-model:latest"]);
  assert.equal(weights.get("llama3.1:8b"), 4.5);
  assert.equal(weights.get("qwen2.5-coder:7b"), 4.5);
  assert.equal(weights.get("broken-model:latest"), null);
});

test("buildRegistryWeightMap fetches only explicit Ollama refs and never derives tags from OpenRouter ids", async () => {
  // Given: OpenRouter metadata for a Llama model and one explicit local Ollama ref with a different tag.
  const openRouterModels = parseOpenRouterModels({
    data: [
      {
        id: "meta-llama/llama-3.1-8b-instruct",
        name: "Meta: Llama 3.1 8B Instruct",
        context_length: 131072,
        architecture: { modality: "text->text", tokenizer: "Llama3" },
        pricing: { prompt: "0.00000018", completion: "0.00000018" },
        top_provider: { context_length: 131072 },
        popularity: 847,
      },
    ],
  });
  const calls = [];
  const fetchManifest = async ({ name, tag }) => {
    calls.push(`${name}:${tag}`);
    return {
      schemaVersion: 2,
      layers: [{ mediaType: "application/vnd.ollama.image.model", size: 5_250_000_000 }],
    };
  };

  // When: registry weights are built with injected fetch behavior.
  const weights = await buildRegistryWeightMap({
    ollamaRefs: ["llama3.1:8b-instruct-q4_K_M"],
    openRouterModels,
    fetchManifest,
  });

  // Then: only the explicit Ollama ref is fetched and indexed; no OpenRouter id is converted into an Ollama tag.
  assert.deepEqual(calls, ["llama3.1:8b-instruct-q4_K_M"]);
  assert.equal(weights.get("llama3.1:8b-instruct-q4_K_M"), 5.25);
  assert.equal(weights.has("llama-3.1-8b-instruct:latest"), false);
  assert.equal(weights.has("meta-llama/llama-3.1-8b-instruct"), false);
});
