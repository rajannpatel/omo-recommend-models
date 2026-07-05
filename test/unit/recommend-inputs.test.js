import test from "node:test";
import assert from "node:assert/strict";
import { resolveExcludeFreeFromConfig } from "../../lib/cli/recommend-inputs.js";

test("resolveExcludeFreeFromConfig - _noFreeConfigExplicit returns true", () => {
  const result = resolveExcludeFreeFromConfig({ _noFreeConfigExplicit: true });
  assert.equal(result, true);
});

test("resolveExcludeFreeFromConfig - _freeConfigExplicit returns false", () => {
  const result = resolveExcludeFreeFromConfig({ _freeConfigExplicit: true });
  assert.equal(result, false);
});

test("resolveExcludeFreeFromConfig - both explicit: _noFreeConfigExplicit wins", () => {
  const result = resolveExcludeFreeFromConfig({
    _noFreeConfigExplicit: true,
    _freeConfigExplicit: true,
  });
  assert.equal(result, true);
});

test("resolveExcludeFreeFromConfig - no flags returns false (default: free included)", () => {
  const result = resolveExcludeFreeFromConfig({});
  assert.equal(result, false);
});