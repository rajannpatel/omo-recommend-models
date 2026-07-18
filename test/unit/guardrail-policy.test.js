import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { isGuardrailOrPolicyError, isTrueQuotaExhaustion, isQuotaError, isRateLimitError, parseRetryAfterSeconds } from "../../lib/providers/errors.js";
import {
  probeModelRefsFromLookup,
  providerProbeCandidates,
} from "../../lib/recommend/providers/ref-extraction.js";
import { preparePaidProviderModels } from "../../lib/recommend/paid-provider-prep.js";
import { RuntimeContext } from "../../lib/runtime-context.js";
import { loadProviderModels, resetCache } from "../../lib/omo-shared.js";

test("isGuardrailOrPolicyError identifies privacy/policy violations", () => {
  const errorText = "No endpoints available matching your guardrail restrictions and data policy. Configure: https://openrouter.ai/settings/privacy";
  assert.ok(isGuardrailOrPolicyError(errorText));
  assert.ok(isGuardrailOrPolicyError("violated guardrail settings"));
  assert.ok(isGuardrailOrPolicyError("Data Policy restrictions"));
  assert.ok(!isGuardrailOrPolicyError("Rate limit exceeded 429"));
  assert.ok(!isGuardrailOrPolicyError("Billing quota exceeded 402"));
});

test("providerProbeCandidates preserves every stable exact ref", () => {
  const sortedPaidRefs = [
    "openrouter/google/gemini-2.5",
    "openrouter/meta-llama/llama-3",
    "anthropic/claude-3.5",
    "anthropic/claude-3",
    "openai/gpt-4o",
  ];
  const candidates = providerProbeCandidates(sortedPaidRefs);
  assert.deepEqual(candidates, sortedPaidRefs);
});

test("providerProbeCandidates schedules all twelve eligible Google advertisements", () => {
  const advertisedRefs = Array.from(
    { length: 12 },
    (_, index) => `google/gemini-${index + 1}`,
  );

  assert.deepEqual(
    providerProbeCandidates([...advertisedRefs, advertisedRefs[3]]),
    advertisedRefs,
  );
});

test("providerProbeCandidates does not narrow by provider or cost metadata", () => {
  const sortedPaidRefs = [
    "free-provider/working-free-1",
    "free-provider/working-free-2",
    "free-provider/paid-sibling",
    "paid-provider/working-paid",
    "paid-provider/paid-sibling",
  ];
  const cloudLookup = {
    byId: {
      "free-provider": new Map([
        ["working-free-1", { capabilities: { toolcall: true }, cost: { input: 0, output: 0 } }],
        ["working-free-2", { capabilities: { toolcall: true }, cost: { input: 0, output: 0 } }],
        ["paid-sibling", { capabilities: { toolcall: true }, cost: { input: 1, output: 1 } }],
      ]),
      "paid-provider": new Map([
        ["working-paid", { capabilities: { toolcall: true }, cost: { input: 1, output: 1 } }],
        ["paid-sibling", { capabilities: { toolcall: true }, cost: { input: 1, output: 1 } }],
      ]),
    },
  };

  const candidates = providerProbeCandidates(sortedPaidRefs, cloudLookup);

  assert.deepEqual(candidates, [
    "free-provider/working-free-1",
    "free-provider/working-free-2",
    "free-provider/paid-sibling",
    "paid-provider/working-paid",
    "paid-provider/paid-sibling",
  ]);
});

test("probeModelRefsFromLookup includes string-only refs and excludes only ineligible advertisements", () => {
  const cloudLookup = {
    sets: {
      google: new Set([
        "gemini-string-only",
        "gemini-toolcall",
        "gemini-no-toolcall",
        "gemini-toolcall",
      ]),
      local: new Set(["local-model"]),
      ollama: new Set(["ollama-model"]),
      cli: new Set(["codex"]),
      opencode: new Set(["free-model"]),
    },
    byId: {
      google: new Map([
        ["gemini-toolcall", { capabilities: { toolcall: true } }],
        ["gemini-no-toolcall", { capabilities: { toolcall: false } }],
      ]),
      local: new Map(),
      ollama: new Map(),
      cli: new Map(),
      opencode: new Map(),
    },
  };

  assert.deepEqual(probeModelRefsFromLookup(cloudLookup), [
    "google/gemini-string-only",
    "google/gemini-toolcall",
    "opencode/free-model",
  ]);
});

test("preparePaidProviderModels drops malformed live catalog entries before enrichment", async () => {
  const ctx = new RuntimeContext();
  ctx.abortController.abort();
  const initialCache = {
    models: {
      google: [
        null,
        42,
        false,
        [],
        {},
        { id: null },
        { id: "" },
        "   ",
        "gemini-string-only",
        { id: "gemini-object", capabilities: { toolcall: true } },
      ],
      malformedProvider: "not-an-array",
      "": ["empty-provider"],
      "bad provider": ["whitespace-provider"],
      "/nested": ["slash-leading-provider"],
    },
  };

  const prepared = await preparePaidProviderModels({
    config: {},
    ctx,
    initialCache,
    localOnlyFlag: false,
  });
  await prepared.ensureProbesAwaited();

  assert.deepEqual(prepared.initialCache.models, {
    google: [
      "gemini-string-only",
      { id: "gemini-object", capabilities: { toolcall: true } },
    ],
  });
  assert.deepEqual(
    [...prepared.initialCloudLookup.sets.google],
    ["gemini-string-only", "gemini-object"],
  );
  assert.deepEqual(
    (await prepared.probeRecordsPromise).map((record) => record.modelRef),
    ["google/gemini-string-only", "google/gemini-object"],
  );
});

test("live loader preserves raw interleaved advertisement order through preparation", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "omo-provider-order-test-"));
  const fakeBin = path.join(tempRoot, "bin");
  const invocationLog = path.join(tempRoot, "invocations.jsonl");
  const executable = path.join(fakeBin, "opencode");
  const originalPath = process.env.PATH;
  const originalLog = process.env.PROVIDER_ORDER_LOG;
  const rawRefs = [
    "google/a",
    "anthropic/b",
    "google/no-tools",
    "local/local-model",
    "/nested/malformed-provider",
    "malformed-without-slash",
    "google/c",
    "anthropic/d",
  ];
  fs.mkdirSync(fakeBin, { recursive: true });
  fs.writeFileSync(executable, `#!/usr/bin/env node
import fs from "node:fs";
const args = process.argv.slice(2);
fs.appendFileSync(process.env.PROVIDER_ORDER_LOG, JSON.stringify(args) + "\\n");
const refs = ${JSON.stringify(rawRefs)};
if (args.length === 1 && args[0] === "models") {
  process.stdout.write(refs.join("\\n") + "\\n");
  process.exit(0);
}
if (args.length === 2 && args[0] === "models" && args[1] === "--verbose") {
  for (const ref of refs) {
    if (!ref.includes("/")) continue;
    process.stdout.write(ref + "\\n");
    process.stdout.write(JSON.stringify({ capabilities: { toolcall: ref !== "google/no-tools" } }) + "\\n");
  }
  process.exit(0);
}
process.exit(2);
`, { mode: 0o755 });

  try {
    process.env.PATH = `${fakeBin}:${originalPath}`;
    process.env.PROVIDER_ORDER_LOG = invocationLog;
    resetCache();
    const ctx = new RuntimeContext();
    ctx.abortController.abort();
    const cache = await loadProviderModels({ ctx });
    const prepared = await preparePaidProviderModels({
      config: {},
      ctx,
      initialCache: cache,
      localOnlyFlag: false,
    });
    await prepared.ensureProbesAwaited();

    assert.deepEqual({
      advertisedRefs: cache.advertisedRefs,
      recordRefs: (await prepared.probeRecordsPromise).map((record) => record.modelRef),
      invocations: fs.readFileSync(invocationLog, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line)),
    }, {
      advertisedRefs: rawRefs,
      recordRefs: ["google/a", "anthropic/b", "google/c", "anthropic/d"],
      invocations: [["models"], ["models", "--verbose"]],
    });
  } finally {
    resetCache();
    process.env.PATH = originalPath;
    if (originalLog === undefined) delete process.env.PROVIDER_ORDER_LOG;
    else process.env.PROVIDER_ORDER_LOG = originalLog;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("isTrueQuotaExhaustion accepts only strong textual provider-wide evidence", () => {
  const exactMessage = "Org member budget limit exceeded (monthly limit). Contact your org admin.";
  const providerWide = [
    "HTTP 402",
    "upstream returned HTTP/1.1 402 Payment Required",
    "protocol HTTP/2 402",
    'status: 402',
    'statusCode="402"',
    "payment required",
    "insufficient funds",
    "insufficient balance",
    "billing limit reached",
    "credit limit reached",
    "credits expired",
    "credit expired",
    "budget exhausted",
    exactMessage,
    "You exceeded your current quota, please check your plan and billing details.",
    'type: "insufficient_quota"',
  ];
  for (const text of providerWide) {
    assert.equal(isTrueQuotaExhaustion(null, text), true, text);
  }

  const exactRefOnly = [
    "process exit code 402",
    "error 402",
    "quota exceeded",
    "quota_exceeded",
    "usage limit",
    "budget exceeded",
    "quota restricted",
    "quota exhausted",
    "limit exceeded",
    "usage exceeded",
    "payment_required",
    "insufficient_funds",
    "forbidden",
    "unauthorized",
    "invalid api key",
  ];
  for (const text of exactRefOnly) {
    assert.equal(isTrueQuotaExhaustion(402, text), false, text);
  }

  assert.equal(isTrueQuotaExhaustion(402, ""), false);
  assert.equal(isQuotaError(402, ""), false);
  assert.equal(isQuotaError(null, "quota exceeded"), true);
  assert.equal(isQuotaError(null, "forbidden"), true);
  assert.equal(isQuotaError(null, "unauthorized"), true);
  assert.equal(isQuotaError(null, "invalid api key"), true);
});

test("parseRetryAfterSeconds and rate limit errors for natural language cooldowns", () => {
  assert.ok(isRateLimitError("opencode/model-alpha has free usage exceeded, and it's on a 45 minute cooldown to retry"));
  assert.equal(parseRetryAfterSeconds("on a 45 minute cooldown to retry"), 45 * 60);
  assert.equal(parseRetryAfterSeconds("retry in 10 seconds"), 10);
  assert.equal(parseRetryAfterSeconds("cooldown of 2 hours"), 2 * 3600);
});
