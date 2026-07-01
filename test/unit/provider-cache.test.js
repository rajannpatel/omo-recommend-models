import test from "node:test";
import assert from "node:assert/strict";
import { filterAccessibleModels } from "../../lib/shared/provider-cache.js";

test("filterAccessibleModels matches exact and fuzzy model names", () => {
  const models = {
    "github-copilot": [
      { id: "claude-opus-4.7", name: "Claude 4.7 Opus" },
      { id: "gemini-3.1-pro", name: "Gemini 3.1 Pro", api: { id: "gemini-3.1-pro" } },
      { id: "gpt-5.5", name: "GPT 5.5" },
    ],
    openai: [
      "gpt-5.4",
      "gpt-5.5-preview",
    ],
  };

  const accessible = new Set([
    "github-copilot/claude-opus-4.7",
    "github-copilot/gemini-3.1-pro-preview",
    "openai/gpt-5.4",
    "openai/gpt-5.5",
  ]);

  const result = filterAccessibleModels(models, accessible);

  assert.deepEqual(result, {
    "github-copilot": [
      { id: "claude-opus-4.7", name: "Claude 4.7 Opus" }, // Exact match
      { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro", api: { id: "gemini-3.1-pro-preview" } }, // Fuzzy match
    ],
    openai: [
      "gpt-5.4", // Exact match
      "gpt-5.5", // Fuzzy match (string model)
    ],
  });
});
