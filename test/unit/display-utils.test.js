import assert from "node:assert/strict";
import test from "node:test";

import {
  formatAiAnalysis,
} from "../../lib/display-utils.js";

test("formatAiAnalysis preserves provider groups inside unresolved rule chains", () => {
  const analysis = [
    "Assigned from upstream oh-my-openagent model fallback rules after loading provider availability.",
    "No available rule-chain model for:",
    "visual-engineering (tried: (google, github-copilot, opencode, vercel)/gemini-3.1-pro > (opencode-go, vercel)/glm-5.1),",
    "writing (tried: (google, github-copilot, opencode, vercel)/gemini-3-flash > (opencode-go, vercel)/kimi-k2.6).",
  ].join(" ");

  const formatted = formatAiAnalysis(analysis);

  assert.match(
    formatted,
    /◦ visual-engineering:\s*\n\s*1\.\s*\(google, github-copilot, opencode, vercel\)\/gemini-3\.1-pro\s*\n\s*2\.\s*\(opencode-go, vercel\)\/glm-5\.1\)/,
  );
  assert.match(
    formatted,
    /◦ writing:\s*\n\s*1\.\s*\(google, github-copilot, opencode, vercel\)\/gemini-3-flash\s*\n\s*2\.\s*\(opencode-go, vercel\)\/kimi-k2\.6\)/,
  );
  assert.doesNotMatch(formatted, /\n  • github-copilot/);
  assert.doesNotMatch(formatted, /\n  • opencode/);
  assert.doesNotMatch(formatted, /\n  • vercel\)/);
});
