import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  openRouterPolicyCacheIdentity,
  fetchOpenRouterUserModelIds,
} from "../../lib/shared/openrouter-policy.js";

function makeAuthFixture(t, authJson) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "omo-openrouter-auth-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dataDir = path.join(root, "data");
  fs.mkdirSync(path.join(dataDir, "opencode"), { recursive: true });
  const authFile = path.join(dataDir, "opencode", "auth.json");
  if (authJson !== undefined) {
    fs.writeFileSync(authFile, JSON.stringify(authJson));
  }
  return { env: { XDG_DATA_HOME: dataDir } };
}

test("openRouterPolicyCacheIdentity resolves an API-key credential from opencode's auth.json when no env var is set", (t) => {
  const { env } = makeAuthFixture(t, {
    openrouter: { type: "api", key: "sk-or-v1-from-auth-file" },
  });

  const identity = openRouterPolicyCacheIdentity(env);

  assert.notEqual(identity, "openrouter-policy:none");
});

test("openRouterPolicyCacheIdentity resolves an OAuth credential's access token from opencode's auth.json", (t) => {
  const { env } = makeAuthFixture(t, {
    openrouter: { type: "oauth", access: "oauth-access-token", refresh: "r", expires: 0 },
  });

  const identity = openRouterPolicyCacheIdentity(env);

  assert.notEqual(identity, "openrouter-policy:none");
});

test("openRouterPolicyCacheIdentity prefers an explicit env var over opencode's auth.json", (t) => {
  const { env } = makeAuthFixture(t, {
    openrouter: { type: "api", key: "sk-or-v1-from-auth-file" },
  });
  env.OPENROUTER_API_KEY = "sk-or-v1-from-env";

  const fromEnv = openRouterPolicyCacheIdentity(env);
  const fromEnvDirect = openRouterPolicyCacheIdentity({ OPENROUTER_API_KEY: "sk-or-v1-from-env" });

  assert.equal(fromEnv, fromEnvDirect);
});

test("openRouterPolicyCacheIdentity falls back to none when auth.json has no openrouter credential", (t) => {
  const { env } = makeAuthFixture(t, { google: { type: "api", key: "unrelated" } });

  assert.equal(openRouterPolicyCacheIdentity(env), "openrouter-policy:none");
});

test("openRouterPolicyCacheIdentity falls back to none when auth.json is missing entirely", (t) => {
  const { env } = makeAuthFixture(t, undefined);

  assert.equal(openRouterPolicyCacheIdentity(env), "openrouter-policy:none");
});

test("openRouterPolicyCacheIdentity falls back to none when auth.json is malformed JSON", (t) => {
  const { env } = makeAuthFixture(t, { openrouter: { type: "api", key: "x" } });
  const authFile = path.join(env.XDG_DATA_HOME, "opencode", "auth.json");
  fs.writeFileSync(authFile, "{ not valid json");

  assert.equal(openRouterPolicyCacheIdentity(env), "openrouter-policy:none");
});

for (const [label, authJson] of [
  ["a top-level JSON array", []],
  ["a top-level JSON null", null],
  ["a non-object openrouter value", { openrouter: "just-a-string" }],
  ["an openrouter credential with an unrecognized type", { openrouter: { type: "wellknown", token: "y" } }],
]) {
  test(`openRouterPolicyCacheIdentity falls back to none when auth.json is ${label}`, (t) => {
    const { env } = makeAuthFixture(t, authJson);

    assert.equal(openRouterPolicyCacheIdentity(env), "openrouter-policy:none");
  });
}

test("fetchOpenRouterUserModelIds authenticates with a key sourced from opencode's auth.json", async (t) => {
  const { env } = makeAuthFixture(t, {
    openrouter: { type: "api", key: "sk-or-v1-from-auth-file" },
  });

  let capturedAuthHeader = null;
  const fakeHttps = {
    get(url, options, callback) {
      capturedAuthHeader = options.headers.Authorization;
      const response = new EventEmitter();
      response.statusCode = 200;
      const request = new EventEmitter();
      request.destroy = () => {};
      queueMicrotask(() => {
        callback(response);
        response.emit("data", JSON.stringify({ data: [{ id: "some-model" }] }));
        response.emit("end");
      });
      return request;
    },
  };

  const ids = await fetchOpenRouterUserModelIds(env, fakeHttps);

  assert.equal(capturedAuthHeader, "Bearer sk-or-v1-from-auth-file");
  assert.deepEqual([...ids], ["some-model"]);
});
