import assert from "node:assert/strict";
import test, { mock } from "node:test";

const FREE_EVALUATOR = "free-provider/failing-evaluator";
const PAID_EVALUATOR = "paid-provider/working-evaluator";
const FAILING_PAID_EVALUATOR = "paid-provider/failing-evaluator";
const FREE_EVALUATOR_1 = "free-provider/free-eval-1";
const FREE_EVALUATOR_2 = "free-provider/free-eval-2";
const PAID_EVALUATOR_1 = "paid-provider/paid-eval-1";
const VALIDATED_FREE_EVALUATOR = "free-provider/validated-free";
const UNPROBED_FREE_EVALUATOR = "free-provider/unprobed-free";

const opencodeCalls = [];
const FREE_META = { pricing: { input: 0, output: 0 }, capabilities: { toolcall: true } };
const PAID_META = { pricing: { input: 1, output: 1 }, capabilities: { toolcall: true } };

function ranking(name, suffix) {
  const prefix = suffix ? `${suffix}-` : "";
  return JSON.stringify({
    [name]: [
      `alpha-provider/${prefix}best`,
      `beta-provider/${prefix}backup`,
      `gamma-provider/${prefix}third`,
    ],
  });
}

mock.module("../../lib/recommend/fitness/opencode-runner.js", {
  namedExports: {
    callOpencode: mock.fn(async (prompt, modelRef) => {
      opencodeCalls.push(modelRef);
      const promptText = String(prompt);
      if (modelRef === FREE_EVALUATOR_1 && promptText.includes("entryA")) {
        return ranking("entryA", "entry-a");
      }
      if (
        (modelRef === FREE_EVALUATOR_1 || modelRef === FREE_EVALUATOR_2) &&
        promptText.includes("entryB")
      ) {
        throw new Error(`${modelRef} failed for entryB`);
      }
      if (modelRef === PAID_EVALUATOR_1 && promptText.includes("entryB")) {
        return ranking("entryB", "entry-b");
      }
      if (modelRef === VALIDATED_FREE_EVALUATOR) {
        const entryName = promptText.includes("entryB") ? "entryB" : "entryA";
        const suffix = entryName === "entryB" ? "entry-b" : "entry-a";
        return ranking(entryName, suffix);
      }
      if (modelRef === UNPROBED_FREE_EVALUATOR) {
        throw new Error("unprobed free evaluator should not be selected");
      }
      if (modelRef === FREE_EVALUATOR) {
        throw new Error("free evaluator failed");
      }
      if (modelRef === PAID_EVALUATOR) {
        return ranking("atlas", "");
      }
      if (modelRef === FAILING_PAID_EVALUATOR) {
        throw new Error("paid evaluator failed");
      }
      throw new Error(`unexpected evaluator ${modelRef}`);
    }),
  },
});

function freeEvaluatorLookup() {
  return {
    byId: {
      "free-provider": new Map([["failing-evaluator", FREE_META]]),
    },
  };
}

function atlasRecommendation() {
  return {
    name: "atlas",
    type: "agent",
    ruleChainMatched: false,
    model: { provider: "alpha-provider", model: "best-fit" },
    fallback_models: [{ provider: "beta-provider", model: "backup-fit" }, { provider: "gamma-provider", model: "third-fit" }],
  };
}

function recommendation(name, suffix) {
  return {
    name,
    type: "agent",
    ruleChainMatched: false,
    model: { provider: "alpha-provider", model: `${suffix}-best` },
    fallback_models: [{ provider: "beta-provider", model: `${suffix}-backup` }, { provider: "gamma-provider", model: `${suffix}-third` }],
  };
}

function multiEvaluatorLookup() {
  return {
    byId: {
      "free-provider": new Map([
        ["free-eval-1", FREE_META],
        ["free-eval-2", FREE_META],
      ]),
      "paid-provider": new Map([["paid-eval-1", PAID_META]]),
    },
  };
}

async function captureStdout(fn) {
  let output = "";
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk, encoding, callback) => {
    const text = Buffer.isBuffer(chunk) ? chunk.toString(encoding) : String(chunk);
    output += text;
    if (typeof encoding === "function") encoding();
    if (typeof callback === "function") callback();
    return true;
  };
  try {
    const value = await fn();
    return { output, value };
  } finally {
    process.stdout.write = originalWrite;
  }
}

async function withOnlyLookupFreeModels(fn) {
  const originalHome = process.env.HOME;
  const originalPath = process.env.PATH;
  process.env.HOME = "/tmp/omo-recommend-empty-home";
  process.env.PATH = "";
  try {
    return await fn();
  } finally {
    originalHome === undefined ? delete process.env.HOME : (process.env.HOME = originalHome);
    originalPath === undefined ? delete process.env.PATH : (process.env.PATH = originalPath);
  }
}

async function rankFor({
  recommendations,
  cloudLookup,
  allowedModels = new Set(),
  isModelAllowed = () => true,
}) {
  const { rankFallbacksByFitness } = await import(
    "../../lib/recommend/fitness-ranking.js"
  );
  opencodeCalls.length = 0;
  return withOnlyLookupFreeModels(() => captureStdout(() =>
    rankFallbacksByFitness(recommendations, cloudLookup, null, null, null, isModelAllowed, allowedModels),
  ));
}

test("rankFallbacksByFitness falls back to an allowed paid evaluator when the free evaluator fails", async () => {
  const atlas = atlasRecommendation();

  const { output, value: result } = await rankFor({
    recommendations: [atlas],
    cloudLookup: freeEvaluatorLookup(),
    allowedModels: new Set([PAID_EVALUATOR]),
  });

  assert.deepEqual(opencodeCalls, [FREE_EVALUATOR, PAID_EVALUATOR]);
  assert.equal(result, true);
  assert.doesNotMatch(output, /\[exec\].*failing-free-model/);
  assert.doesNotMatch(output, /\[exec\].*working-paid-model/);
  assert.equal(atlas.aiUsedModel, PAID_EVALUATOR);
});

test("rankFallbacksByFitness uses paid evaluators immediately when no free evaluators are available", async () => {
  const atlas = atlasRecommendation();
  const paidOnlyLookup = {
    byId: {
      "paid-provider": new Map([["working-evaluator", PAID_META]]),
    },
  };

  const { value: result } = await rankFor({
    recommendations: [atlas],
    cloudLookup: paidOnlyLookup,
    allowedModels: new Set([PAID_EVALUATOR]),
  });

  assert.equal(result, true);
  assert.deepEqual(opencodeCalls, [PAID_EVALUATOR]);
  assert.equal(atlas.aiUsedModel, PAID_EVALUATOR);
});

test("rankFallbacksByFitness reports unavailable when no evaluator models exist", async () => {
  const atlas = atlasRecommendation();

  const { output, value: result } = await rankFor({
    recommendations: [atlas],
    cloudLookup: { byId: {} },
  });

  assert.equal(result, false);
  assert.deepEqual(opencodeCalls, []);
  assert.match(output, /AI ranking unavailable/);
  assert.equal(atlas.aiUsedModel, undefined);
});

test("rankFallbacksByFitness reports unavailable after free and paid evaluators fail", async () => {
  const atlas = atlasRecommendation();

  const { output, value: result } = await rankFor({
    recommendations: [atlas],
    cloudLookup: freeEvaluatorLookup(),
    allowedModels: new Set([FAILING_PAID_EVALUATOR]),
  });

  assert.equal(result, false);
  assert.deepEqual(opencodeCalls, [FREE_EVALUATOR, FAILING_PAID_EVALUATOR]);
  assert.match(output, /atlas by free-provider\/failing-evaluator — free evaluator failed/);
  assert.match(output, /atlas by paid-provider\/failing-evaluator — paid evaluator failed/);
  assert.match(output, /AI ranking unavailable/);
  assert.equal(atlas.aiUsedModel, undefined);
});

test("rankFallbacksByFitness does not try a paid evaluator when none are allowed", async () => {
  const atlas = atlasRecommendation();

  const { value: result } = await rankFor({
    recommendations: [atlas],
    cloudLookup: freeEvaluatorLookup(),
  });

  assert.equal(result, false);
  assert.deepEqual(opencodeCalls, [FREE_EVALUATOR]);
  assert.equal(atlas.aiUsedModel, undefined);
});

test("rankFallbacksByFitness tries paid fallback for a later entry after an earlier free success", async () => {
  const entryA = recommendation("entryA", "entry-a");
  const entryB = recommendation("entryB", "entry-b");

  const { value: result } = await rankFor({
    recommendations: [entryA, entryB],
    cloudLookup: multiEvaluatorLookup(),
    allowedModels: new Set([PAID_EVALUATOR_1]),
  });

  assert.equal(result, true);
  assert.deepEqual(opencodeCalls, [
    FREE_EVALUATOR_1,
    FREE_EVALUATOR_2,
    FREE_EVALUATOR_1,
    PAID_EVALUATOR_1,
  ]);
  assert.equal(entryA.aiUsedModel, FREE_EVALUATOR_1);
  assert.equal(entryB.aiUsedModel, PAID_EVALUATOR_1);
});

test("rankFallbacksByFitness does not select an unprobed free evaluator from a validated provider", async () => {
  const entryA = recommendation("entryA", "entry-a");
  const entryB = recommendation("entryB", "entry-b");
  const cloudLookup = {
    byId: {
      "free-provider": new Map([
        ["validated-free", FREE_META],
        ["unprobed-free", FREE_META],
      ]),
    },
  };
  const allowedFreeEvaluator = ({ provider, model }) =>
    `${provider}/${model}` === VALIDATED_FREE_EVALUATOR;

  const { value: result } = await rankFor({
    recommendations: [entryA, entryB],
    cloudLookup,
    isModelAllowed: allowedFreeEvaluator,
    allowedModels: new Set([VALIDATED_FREE_EVALUATOR]),
  });

  assert.equal(result, true);
  assert.deepEqual(opencodeCalls, [
    VALIDATED_FREE_EVALUATOR,
    VALIDATED_FREE_EVALUATOR,
  ]);
  assert.equal(entryA.aiUsedModel, VALIDATED_FREE_EVALUATOR);
  assert.equal(entryB.aiUsedModel, VALIDATED_FREE_EVALUATOR);
});
