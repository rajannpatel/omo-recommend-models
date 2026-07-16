import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createPolicyExclusionCache } from "../../lib/providers/policy-exclusion-cache.js";

const SCHEMA_VERSION = 1;

function makeFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "omo-policy-cache-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return {
    root,
    cacheFile: path.join(root, "cache", "policy-excluded-models.json"),
  };
}

function captureStderr() {
  let text = "";
  return {
    stream: { write: (chunk) => (text += String(chunk)) },
    read: () => text,
  };
}

function readCache(cacheFile) {
  return JSON.parse(fs.readFileSync(cacheFile, "utf8"));
}

function tempFiles(cacheFile) {
  const directory = path.dirname(cacheFile);
  return fs.existsSync(directory) && fs.statSync(directory).isDirectory()
    ? fs.readdirSync(directory).filter((name) => name.includes(".tmp-"))
    : [];
}

test("sorts, deduplicates, reloads, and retains nested and stale exact refs", (t) => {
  const { cacheFile } = makeFixture(t);
  const cache = createPolicyExclusionCache({ cacheFile });

  assert.equal(cache.add("  zed/model-z  "), true);
  assert.equal(cache.add("google/publishers/google/models/gemini-2.5-pro"), true);
  assert.equal(cache.add("stale/provider/model"), true);
  assert.equal(cache.add("zed/model-z"), false);

  const expected = [
    "google/publishers/google/models/gemini-2.5-pro",
    "stale/provider/model",
    "zed/model-z",
  ];
  assert.deepEqual(cache.values(), expected);
  assert.deepEqual(readCache(cacheFile), {
    schemaVersion: SCHEMA_VERSION,
    policyExcludedModelRefs: expected,
  });
  assert.deepEqual(createPolicyExclusionCache({ cacheFile }).values(), expected);
  assert.equal(fs.statSync(path.dirname(cacheFile)).mode & 0o777, 0o700);
  assert.equal(fs.statSync(cacheFile).mode & 0o777, 0o600);
  assert.equal(fs.readFileSync(cacheFile, "utf8").endsWith("\n"), true);
  assert.deepEqual(tempFiles(cacheFile), []);
});

test("invalid cache inputs fail open and normal mode stays silent", async (t) => {
  const invalidCases = [
    ["malformed JSON", "{"],
    ["wrong version", JSON.stringify({ schemaVersion: 2, policyExcludedModelRefs: [] })],
    ["wrong refs shape", JSON.stringify({ schemaVersion: 1, policyExcludedModelRefs: {} })],
    ["invalid ref", JSON.stringify({ schemaVersion: 1, policyExcludedModelRefs: ["missing-slash"] })],
  ];

  for (const [name, bytes] of invalidCases) {
    await t.test(name, (subtest) => {
      const { cacheFile } = makeFixture(subtest);
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      fs.writeFileSync(cacheFile, bytes);
      const stderr = captureStderr();

      const cache = createPolicyExclusionCache({ cacheFile, stderr: stderr.stream });

      assert.deepEqual(cache.values(), []);
      assert.equal(stderr.read(), "");
    });
  }
});

test("debug and verbose modes emit exact invalid-read diagnostics", (t) => {
  const debugFixture = makeFixture(t);
  fs.mkdirSync(path.dirname(debugFixture.cacheFile), { recursive: true });
  fs.writeFileSync(debugFixture.cacheFile, "{");
  const debugStderr = captureStderr();

  createPolicyExclusionCache({
    cacheFile: debugFixture.cacheFile,
    debug: true,
    stderr: debugStderr.stream,
  });

  assert.equal(
    debugStderr.read(),
    `[cache] ignoring invalid policy-exclusion cache at ${debugFixture.cacheFile}: invalid JSON\n`,
  );

  const verboseFixture = makeFixture(t);
  const denied = Object.assign(new Error("simulated read denial"), { code: "EACCES" });
  const verboseStderr = captureStderr();
  createPolicyExclusionCache({
    cacheFile: verboseFixture.cacheFile,
    verbose: true,
    stderr: verboseStderr.stream,
    fileSystem: { ...fs, readFileSync: () => { throw denied; } },
  });
  assert.equal(
    verboseStderr.read(),
    `[cache] ignoring invalid policy-exclusion cache at ${verboseFixture.cacheFile}: simulated read denial\n`,
  );
});

test("a policy add replaces an invalid schema with schema version 1", (t) => {
  const { cacheFile } = makeFixture(t);
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  fs.writeFileSync(
    cacheFile,
    JSON.stringify({ schemaVersion: 99, policyExcludedModelRefs: ["old/ref"] }),
  );
  const cache = createPolicyExclusionCache({ cacheFile });

  assert.equal(cache.add("new/provider/model"), true);

  assert.deepEqual(readCache(cacheFile), {
    schemaVersion: SCHEMA_VERSION,
    policyExcludedModelRefs: ["new/provider/model"],
  });
  assert.deepEqual(tempFiles(cacheFile), []);
});

test("save uses a same-directory temporary file and atomic rename", (t) => {
  const { cacheFile } = makeFixture(t);
  const operations = [];
  const fileSystem = {
    ...fs,
    writeFileSync(file, bytes, options) {
      operations.push(["write", file, bytes, options]);
      return fs.writeFileSync(file, bytes, options);
    },
    renameSync(from, to) {
      operations.push(["rename", from, to]);
      return fs.renameSync(from, to);
    },
  };

  createPolicyExclusionCache({ cacheFile, fileSystem }).add("provider/model");

  const write = operations.find(([name]) => name === "write");
  const rename = operations.find(([name]) => name === "rename");
  assert.ok(write[1].startsWith(`${path.dirname(cacheFile)}${path.sep}`));
  assert.match(path.basename(write[1]), /\.tmp-/);
  assert.equal(write[3].mode, 0o600);
  assert.deepEqual(rename.slice(1), [write[1], cacheFile]);
  assert.deepEqual(tempFiles(cacheFile), []);
});

test("an interrupted rename preserves old bytes, current memory, and no temp residue", (t) => {
  const { cacheFile } = makeFixture(t);
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  const oldBytes = `${JSON.stringify({ schemaVersion: 1, policyExcludedModelRefs: ["old/ref"] }, null, 2)}\n`;
  fs.writeFileSync(cacheFile, oldBytes, { mode: 0o600 });
  const stderr = captureStderr();
  const interrupted = Object.assign(new Error("simulated rename interruption"), { code: "EINTR" });
  const cache = createPolicyExclusionCache({
    cacheFile,
    stderr: stderr.stream,
    fileSystem: { ...fs, renameSync: () => { throw interrupted; } },
  });

  assert.equal(cache.add("new/ref"), true);

  assert.deepEqual(cache.values(), ["new/ref", "old/ref"]);
  assert.equal(fs.readFileSync(cacheFile, "utf8"), oldBytes);
  assert.equal(
    stderr.read(),
    `[cache] unable to persist policy-exclusion cache at ${cacheFile}: simulated rename interruption\n`,
  );
  assert.deepEqual(tempFiles(cacheFile), []);
});

test("rename and unlink failures use the secondary cleanup path without residue", (t) => {
  const { cacheFile } = makeFixture(t);
  const stderr = captureStderr();
  let fallbackCalls = 0;
  const cache = createPolicyExclusionCache({
    cacheFile,
    stderr: stderr.stream,
    fileSystem: {
      ...fs,
      renameSync() {
        throw Object.assign(new Error("simulated rename failure"), { code: "EIO" });
      },
      unlinkSync() {
        throw Object.assign(new Error("simulated unlink failure"), { code: "EACCES" });
      },
      rmSync(file, options) {
        fallbackCalls += 1;
        return fs.rmSync(file, options);
      },
    },
  });

  assert.equal(cache.add("provider/model"), true);

  assert.equal(fallbackCalls, 1);
  assert.deepEqual(tempFiles(cacheFile), []);
  assert.equal(
    stderr.read(),
    `[cache] unable to persist policy-exclusion cache at ${cacheFile}: simulated rename failure\n`,
  );
});

test("total temporary-file cleanup failure emits an always-on diagnostic", (t) => {
  const { cacheFile } = makeFixture(t);
  const stderr = captureStderr();
  let temporaryFile;
  const cache = createPolicyExclusionCache({
    cacheFile,
    stderr: stderr.stream,
    fileSystem: {
      ...fs,
      renameSync(from) {
        temporaryFile = from;
        throw Object.assign(new Error("simulated rename failure"), { code: "EIO" });
      },
      unlinkSync() {
        throw Object.assign(new Error("simulated unlink failure"), { code: "EACCES" });
      },
      rmSync() {
        throw Object.assign(new Error("simulated fallback failure"), { code: "EPERM" });
      },
    },
  });

  assert.equal(cache.add("provider/model"), true);

  assert.deepEqual(tempFiles(cacheFile), [path.basename(temporaryFile)]);
  assert.equal(
    stderr.read(),
    `[cache] unable to persist policy-exclusion cache at ${cacheFile}: simulated rename failure\n` +
      `[cache] unable to remove temporary policy-exclusion cache at ${temporaryFile}: simulated fallback failure\n`,
  );
});

test("a partial temporary write is removed after a write failure", (t) => {
  const { cacheFile } = makeFixture(t);
  const stderr = captureStderr();
  const failedWrite = Object.assign(new Error("simulated partial write"), { code: "EIO" });
  const cache = createPolicyExclusionCache({
    cacheFile,
    stderr: stderr.stream,
    fileSystem: {
      ...fs,
      writeFileSync(file) {
        fs.writeFileSync(file, "partial", { mode: 0o600 });
        throw failedWrite;
      },
    },
  });

  assert.equal(cache.add("provider/model"), true);

  assert.equal(cache.has("provider/model"), true);
  assert.equal(fs.existsSync(cacheFile), false);
  assert.equal(
    stderr.read(),
    `[cache] unable to persist policy-exclusion cache at ${cacheFile}: simulated partial write\n`,
  );
  assert.deepEqual(tempFiles(cacheFile), []);
});

test("save failures always warn while retaining the ref in current-run memory", (t) => {
  const { root } = makeFixture(t);
  const blockedParent = path.join(root, "not-a-directory");
  fs.writeFileSync(blockedParent, "sentinel");
  const cacheFile = path.join(blockedParent, "cache.json");
  const stderr = captureStderr();
  const cache = createPolicyExclusionCache({ cacheFile, stderr: stderr.stream });

  assert.equal(cache.add("provider/model"), true);

  assert.equal(cache.has("provider/model"), true);
  assert.match(
    stderr.read(),
    new RegExp(`^\\[cache\\] unable to persist policy-exclusion cache at ${cacheFile.replaceAll("/", "\\/")}: .+\\n$`),
  );
  assert.deepEqual(tempFiles(cacheFile), []);
});

test("flush removes only its cache, is ENOENT-idempotent, and clears memory", (t) => {
  const { root, cacheFile } = makeFixture(t);
  const sentinel = path.join(root, "sentinel.json");
  fs.writeFileSync(sentinel, "preserve me");
  const cache = createPolicyExclusionCache({ cacheFile });
  cache.add("provider/model");

  assert.equal(cache.flush(), true);
  assert.equal(fs.existsSync(cacheFile), false);
  assert.deepEqual(cache.values(), []);
  assert.equal(fs.readFileSync(sentinel, "utf8"), "preserve me");
  assert.equal(cache.flush(), false);
});

test("flush propagates every non-ENOENT removal failure", (t) => {
  const { cacheFile } = makeFixture(t);
  const denied = Object.assign(new Error("simulated flush denial"), { code: "EACCES" });
  const cache = createPolicyExclusionCache({
    cacheFile,
    fileSystem: { ...fs, unlinkSync: () => { throw denied; } },
  });

  assert.throws(() => cache.flush(), (error) => error === denied);
});

test("explicit cache paths remain isolated within one process", (t) => {
  const { root } = makeFixture(t);
  const firstPath = path.join(root, "first", "cache.json");
  const secondPath = path.join(root, "second", "cache.json");
  const first = createPolicyExclusionCache({ cacheFile: firstPath });
  const second = createPolicyExclusionCache({ cacheFile: secondPath });

  first.add("provider/first");
  second.add("provider/second");

  assert.deepEqual(first.values(), ["provider/first"]);
  assert.deepEqual(second.values(), ["provider/second"]);
  assert.deepEqual(readCache(firstPath).policyExcludedModelRefs, ["provider/first"]);
  assert.deepEqual(readCache(secondPath).policyExcludedModelRefs, ["provider/second"]);
});

test("invalid refs are rejected before entering memory or storage", (t) => {
  const { cacheFile } = makeFixture(t);
  const cache = createPolicyExclusionCache({ cacheFile });

  for (const invalid of ["", "missing-slash", "/model", "provider/", "provider//model", 42]) {
    assert.throws(() => cache.add(invalid), /valid exact model ref/);
  }
  assert.deepEqual(cache.values(), []);
  assert.equal(fs.existsSync(cacheFile), false);
});
