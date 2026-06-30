import assert from "node:assert/strict";
import test from "node:test";

import {
  parseOllamaManifestWeightGb,
} from "../../lib/recommend/local-model-metadata.js";

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
