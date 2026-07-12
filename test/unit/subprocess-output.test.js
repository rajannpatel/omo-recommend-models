import assert from "node:assert/strict";
import test from "node:test";

import { createVerboseSubprocessReporter } from "../../lib/display/subprocess-output.js";

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

test("verbose subprocess reporter frames complete stdout and stderr without breaking the border", () => {
  const longOutput = "x".repeat(70);
  const output = captureStdout(() => {
    const reporter = createVerboseSubprocessReporter({
      enabled: true,
      command: "opencode",
      args: ["run", "--model", "demo"],
      width: 30,
    });

    reporter.stdout("alpha ");
    reporter.stdout(`beta\n${longOutput}\n`);
    reporter.stderr("bad key\n");
    reporter.finish();
  });

  assert.match(output, /^┌  \[exec\] opencode run/m);
  assert.match(output, /│  \[stdout\] alpha beta\n/);
  assert.match(output, /│  \[stderr\] bad key\n/);
  assert.match(output, /└\n┌\n│\n$/);
  for (const line of output.split("\n").filter(Boolean)) {
    assert.ok(line.startsWith("┌") || line.startsWith("└") || line.startsWith("│"));
  }
  assert.ok((output.match(/\[stdout\]/g) || []).length > 2);
});

test("disabled verbose subprocess reporter writes nothing", () => {
  const output = captureStdout(() => {
    const reporter = createVerboseSubprocessReporter({ enabled: false });
    reporter.stdout("hidden\n");
    reporter.stderr("hidden\n");
    reporter.finish();
  });

  assert.equal(output, "");
});

test("verbose subprocess reporter keeps CRLF split across chunks as one line and escapes controls", () => {
  const output = captureStdout(() => {
    const reporter = createVerboseSubprocessReporter({
      enabled: true,
      command: "tool",
      width: 80,
    });
    reporter.stdout("alpha\r");
    reporter.stdout("\nbeta\r");
    reporter.stdout("\n");
    reporter.stderr("\u001b]52;c;clipboard\u0007\n");
    reporter.finish();
  });

  assert.match(output, /│  \[stdout\] alpha\n│  \[stdout\] beta\n/);
  assert.doesNotMatch(output, /│  \[stdout\] \n/);
  assert.match(output, /│  \[stderr\] \\x1b\]52;c;clipboard\\x07/);
  assert.doesNotMatch(output, /\u001b/);
});
