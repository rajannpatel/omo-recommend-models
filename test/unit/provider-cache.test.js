import test from "node:test";
import assert from "node:assert/strict";
import {
  filterFreeModelRefs,
} from "../../lib/shared/provider-cache.js";

test("filterFreeModelRefs keeps only usable opencode refs", () => {
  assert.deepEqual(
    filterFreeModelRefs([
      "opencode/big-pickle",
      "github-copilot/Claude 4.5 Haiku",
      "anthropic/claude-sonnet-4.6",
      "opencode/north-mini-code-free",
      "Available models:",
      "  opencode/south-fast-free  ",
      "north-mini-code-free",
    ]),
    [
      "opencode/big-pickle",
      "opencode/north-mini-code-free",
      "opencode/south-fast-free",
    ],
  );
});
