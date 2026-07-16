#!/usr/bin/env node

import fs from "node:fs";

const fixtureFile = process.env.OMO_PROBE_FIXTURE_FILE;
const invocationFile = process.env.OMO_PROBE_INVOCATIONS_FILE;
const environmentAuditFile = process.env.OMO_PROBE_ENVIRONMENT_AUDIT_FILE;
if (!fixtureFile || !invocationFile || !environmentAuditFile) {
  console.error("missing OMO probe fixture environment");
  process.exit(64);
}

const credentialKeys = [
  "AGY_API_KEY",
  "ANTHROPIC_API_KEY",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "CODEX_API_KEY",
  "GITHUB_TOKEN",
  "GOOGLE_API_KEY",
  "OPENAI_API_KEY",
].filter((key) => process.env[key] !== undefined);
fs.appendFileSync(environmentAuditFile, `${JSON.stringify({ credentialKeys })}\n`);

const fixture = JSON.parse(fs.readFileSync(fixtureFile, "utf8"));
const args = process.argv.slice(2);
const modelIndex = args.indexOf("--model");
const modelRef = modelIndex === -1 ? "" : args[modelIndex + 1];

if (args.includes("--version")) {
  console.log("opencode 1.0.0");
  process.exit(0);
}

if (args[0] === "models") {
  for (const entry of fixture.entries) {
    console.log(entry.ref);
    if (args.includes("--verbose") && entry.metadata !== null) {
      console.log(JSON.stringify(entry.metadata, null, 2));
    }
  }
  process.exit(0);
}

if (args[0] !== "run" || !args.includes("--pure") || !modelRef) {
  process.exit(65);
}

fs.appendFileSync(invocationFile, `${JSON.stringify({ modelRef })}\n`);
const outcome = fixture.outcomes[modelRef] ?? { kind: "success" };
switch (outcome.kind) {
  case "success":
    console.log(JSON.stringify({ type: "text", part: { text: "1" } }));
    process.exit(0);
  case "rate-limited":
    console.error("HTTP 429 too many requests");
    process.exit(1);
  case "policy":
    console.error("HTTP 403 forbidden by data policy and privacy controls");
    process.exit(1);
  case "strong-exhaustion":
    console.error("HTTP 402 payment required: insufficient balance");
    process.exit(1);
  case "model-unavailable":
    console.error("model not found");
    process.exit(1);
  default:
    console.error(`unsupported fixture outcome: ${String(outcome.kind)}`);
    process.exit(66);
}
