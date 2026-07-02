import assert from "node:assert/strict";
import test from "node:test";

import { createProgress } from "../../lib/display/progress.js";

function captureStdout(fn) {
  const originalWrite = process.stdout.write;
  const chunks = [];
  process.stdout.write = (chunk, encoding, callback) => {
    chunks.push(String(chunk));
    if (typeof encoding === "function") encoding();
    if (typeof callback === "function") callback();
    return true;
  };
  try {
    fn();
  } finally {
    process.stdout.write = originalWrite;
  }
  return chunks.join("");
}

test("createProgress formats known-count updates and completion in non-TTY output", () => {
  const output = captureStdout(() => {
    const progress = createProgress("Known API calls", { total: 2 });

    progress.advance();
    progress.done("complete");
  });

  assert.match(output, /Known API calls: complete 2\/2/);
  assert.match(output, /\│\n$/);
});

test("createProgress set clamps known-count progress at the declared total", () => {
  const output = captureStdout(() => {
    const progress = createProgress("Known AI calls", { total: 2 });

    progress.set(3);
    progress.done();
  });

  assert.match(output, /Known AI calls: done 2\/2/);
});

test("createProgress supports late-bound totals for discovery loops", () => {
  const output = captureStdout(() => {
    const progress = createProgress("Known registry calls");

    progress.setTotal(3);
    progress.set(2, "cataloging");
    progress.done("cataloged");
  });

  assert.match(output, /Known registry calls: cataloged 3\/3/);
});
