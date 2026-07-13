import test from "node:test";
import assert from "node:assert/strict";
import {
  buildFreeModelRefPredicate,
  filterFreeModelRefs,
  isZeroCostModelMeta,
} from "../../lib/shared/provider-cache.js";

test("isZeroCostModelMeta reads cost and normalized pricing metadata", () => {
  assert.equal(isZeroCostModelMeta({ cost: { input: 0, output: 0 } }), true);
  assert.equal(isZeroCostModelMeta({ pricing: { input: 0, output: 0 } }), true);
  assert.equal(isZeroCostModelMeta({ cost: { input: 0, output: 0.01 } }), false);
  assert.equal(isZeroCostModelMeta({}), false);
});

test("buildFreeModelRefPredicate classifies zero-cost refs from any provider", () => {
  const isFreeRef = buildFreeModelRefPredicate({
    byId: {
      opencode: new Map([
        ["paid-opencode", { pricing: { input: 0.2, output: 0.5 } }],
      ]),
      "github-copilot": new Map([
        ["zero-copilot", { pricing: { input: 0, output: 0 } }],
      ]),
    },
  });

  assert.equal(isFreeRef({ provider: "github-copilot", model: "zero-copilot" }), true);
  assert.equal(isFreeRef({ provider: "opencode", model: "paid-opencode" }), false);
});

test("filterFreeModelRefs does not treat opencode provider name as free metadata", () => {
  assert.deepEqual(
    filterFreeModelRefs([
      "opencode/model-alpha",
      "github-copilot/Claude 4.5 Haiku",
      "anthropic/claude-sonnet-4.6",
      "opencode/zero-beta",
      "Available models:",
      "  opencode/zero-gamma  ",
      "zero-beta",
    ]),
    [],
  );
});
