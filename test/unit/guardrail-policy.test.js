import assert from "node:assert/strict";
import test from "node:test";
import { isGuardrailOrPolicyError, isTrueQuotaExhaustion, isQuotaError, isRateLimitError, parseRetryAfterSeconds } from "../../lib/providers/errors.js";
import { providerProbeCandidates } from "../../lib/recommend/providers/ref-extraction.js";
import { RuntimeContext } from "../../lib/runtime-context.js";

test("isGuardrailOrPolicyError identifies privacy/policy violations", () => {
  const errorText = "No endpoints available matching your guardrail restrictions and data policy. Configure: https://openrouter.ai/settings/privacy";
  assert.ok(isGuardrailOrPolicyError(errorText));
  assert.ok(isGuardrailOrPolicyError("violated guardrail settings"));
  assert.ok(isGuardrailOrPolicyError("Data Policy restrictions"));
  assert.ok(!isGuardrailOrPolicyError("Rate limit exceeded 429"));
  assert.ok(!isGuardrailOrPolicyError("Billing quota exceeded 402"));
});

test("providerProbeCandidates returns all openrouter models and one for others", () => {
  const sortedPaidRefs = [
    "openrouter/google/gemini-2.5",
    "openrouter/meta-llama/llama-3",
    "anthropic/claude-3.5",
    "anthropic/claude-3",
    "openai/gpt-4o",
  ];
  const candidates = providerProbeCandidates(sortedPaidRefs);
  assert.deepEqual(candidates, [
    "openrouter/google/gemini-2.5",
    "openrouter/meta-llama/llama-3",
    "anthropic/claude-3.5",
    "openai/gpt-4o",
  ]);
});

test("isTrueQuotaExhaustion vs isQuotaError", () => {
  // True quota/credit limit failures
  assert.ok(isTrueQuotaExhaustion(402, "payment required"));
  assert.ok(isTrueQuotaExhaustion(null, "quota exceeded"));
  assert.ok(isTrueQuotaExhaustion(null, "insufficient funds"));

  assert.ok(isQuotaError(402, "payment required"));
  assert.ok(isQuotaError(null, "quota exceeded"));

  // Auth/forbidden failures (should be isQuotaError but not isTrueQuotaExhaustion)
  assert.ok(!isTrueQuotaExhaustion(null, "forbidden"));
  assert.ok(!isTrueQuotaExhaustion(null, "unauthorized"));
  assert.ok(!isTrueQuotaExhaustion(null, "invalid api key"));

  assert.ok(isQuotaError(null, "forbidden"));
  assert.ok(isQuotaError(null, "unauthorized"));
  assert.ok(isQuotaError(null, "invalid api key"));
});

test("parseRetryAfterSeconds and rate limit errors for natural language cooldowns", () => {
  assert.ok(isRateLimitError("opencode/big-pickle has free usage exceeded, and it's on a 45 minute cooldown to retry"));
  assert.equal(parseRetryAfterSeconds("on a 45 minute cooldown to retry"), 45 * 60);
  assert.equal(parseRetryAfterSeconds("retry in 10 seconds"), 10);
  assert.equal(parseRetryAfterSeconds("cooldown of 2 hours"), 2 * 3600);
});

