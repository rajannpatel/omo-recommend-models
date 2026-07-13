import test, { mock } from "node:test";
import assert from "node:assert/strict";

mock.module("../../lib/shared/provider-cache.js", {
  namedExports: {
    isFreeModelRef: () => true,
    isZeroCostModelMeta: (meta) => {
      const cost = meta?.cost || meta?.pricing;
      return cost?.input === 0 && cost?.output === 0;
    },
  },
});

test("computeFreeModelCandidates trusts verbose cost metadata over stale free refs", async () => {
  const { computeFreeModelCandidates } = await import(
    "../../lib/recommend/rules-assignment/helpers.js"
  );

  const cloudLookup = {
    byId: {
      "github-copilot": new Map([
        ["paid-by-verbose", { pricing: { input: 0.01, output: 0.02 }, capabilities: { toolcall: true } }],
        ["zero-by-verbose", { pricing: { input: 0, output: 0 }, capabilities: { toolcall: true } }],
      ]),
    },
  };

  const candidates = computeFreeModelCandidates(cloudLookup, () => true, new Set());

  assert.deepEqual(
    candidates.map((candidate) => `${candidate.provider}/${candidate.model}`),
    ["github-copilot/zero-by-verbose"],
  );
});
