import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { RuntimeContext } from "../../lib/runtime-context.js";
import {
  getApiKeyForProvider,
  runDirectProbe,
  probeModel,
} from "../../lib/providers/probe.js";

function makeAuthFixture(t, authJson) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "omo-direct-auth-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dataDir = path.join(root, "data");
  fs.mkdirSync(path.join(dataDir, "opencode"), { recursive: true });
  const authFile = path.join(dataDir, "opencode", "auth.json");
  if (authJson !== undefined) {
    fs.writeFileSync(authFile, JSON.stringify(authJson));
  }
  return { env: { XDG_DATA_HOME: dataDir } };
}

test("getApiKeyForProvider resolves keys correctly from environment", () => {
  const env = {
    OPENAI_API_KEY: "sk-openai-env",
    GEMINI_API_KEY: "google-gemini-env",
    OPENROUTER_API_KEY: "sk-or-env",
    XDG_DATA_HOME: "/does-not-exist",
  };

  assert.equal(getApiKeyForProvider("openai", env), "sk-openai-env");
  assert.equal(getApiKeyForProvider("google", env), "google-gemini-env");
  assert.equal(getApiKeyForProvider("openrouter", env), "sk-or-env");
});

test("getApiKeyForProvider prefers auth.json key over env key", (t) => {
  const { env } = makeAuthFixture(t, {
    openai: "sk-from-file",
  });
  env.OPENAI_API_KEY = "sk-from-env";

  assert.equal(getApiKeyForProvider("openai", env), "sk-from-file");
});

test("getApiKeyForProvider resolves keys correctly from auth.json styles", (t) => {
  // Test OpenAI string style
  const { env: env1 } = makeAuthFixture(t, {
    openai: "sk-openai-string",
  });
  assert.equal(getApiKeyForProvider("openai", env1), "sk-openai-string");

  // Test OpenAI type: api style
  const { env: env2 } = makeAuthFixture(t, {
    openai: { type: "api", key: "sk-openai-api-key" },
  });
  assert.equal(getApiKeyForProvider("openai", env2), "sk-openai-api-key");

  // Test OpenAI providers nested style
  const { env: env3 } = makeAuthFixture(t, {
    providers: { openai: { apiKey: "sk-openai-nested" } },
  });
  assert.equal(getApiKeyForProvider("openai", env3), "sk-openai-nested");

  // Test OpenAI fallback flat sk- prefix find
  const { env: env4 } = makeAuthFixture(t, {
    randomKey: "sk-openai-flat-sk",
  });
  assert.equal(getApiKeyForProvider("openai", env4), "sk-openai-flat-sk");

  // Test Google type: oauth style
  const { env: env5 } = makeAuthFixture(t, {
    google: { type: "oauth", access: "google-access-token" },
  });
  assert.equal(getApiKeyForProvider("google", env5), "google-access-token");
});

test("runDirectProbe handles a successful response", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });

  let capturedUrl = "";
  let capturedHeaders = null;
  global.fetch = async (url, options) => {
    capturedUrl = url;
    capturedHeaders = options.headers;
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ id: "chatcmpl-123" }),
    };
  };

  const ctx = new RuntimeContext();
  const res = await runDirectProbe(ctx, "openai", "openai/gpt-4o", "mock-key", null, 5000);

  assert.deepEqual(res, { ok: true });
  assert.equal(capturedUrl, "https://api.openai.com/v1/chat/completions");
  assert.equal(capturedHeaders["Authorization"], "Bearer mock-key");
});

test("runDirectProbe handles OpenAI quota error", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });

  global.fetch = async () => {
    return {
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      json: async () => ({
        error: {
          code: "insufficient_quota",
          message: "You exceeded your current quota",
        },
      }),
    };
  };

  const ctx = new RuntimeContext();
  const res = await runDirectProbe(ctx, "openai", "openai/gpt-4o", "mock-key", null, 5000);

  assert.equal(res.ok, false);
  assert.equal(res.reason, "quota-exceeded");
  assert.equal(res.scope, "provider");
});

test("runDirectProbe handles Google Gemini RESOURCE_EXHAUSTED quota error", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });

  global.fetch = async () => {
    return {
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      json: async () => ({
        error: {
          status: "RESOURCE_EXHAUSTED",
          message: "Resource has been exhausted (e.g. check quota).",
        },
      }),
    };
  };

  const ctx = new RuntimeContext();
  const res = await runDirectProbe(ctx, "google", "google/gemini-1.5-pro", "mock-key", null, 5000);

  assert.equal(res.ok, false);
  assert.equal(res.reason, "quota-exceeded");
  assert.equal(res.scope, "provider");
});

test("runDirectProbe handles OpenRouter 402 credit exhaustion error", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });

  global.fetch = async () => {
    return {
      ok: false,
      status: 402,
      statusText: "Payment Required",
      json: async () => ({
        error: {
          message: "Credit exhaustion",
        },
      }),
    };
  };

  const ctx = new RuntimeContext();
  const res = await runDirectProbe(ctx, "openrouter", "openrouter/anthropic/claude-3", "mock-key", null, 5000);

  assert.equal(res.ok, false);
  assert.equal(res.reason, "quota-exceeded");
  assert.equal(res.scope, "provider");
});

test("probeModel routes through runDirectProbe when key is present and forced", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
    delete process.env.OMO_RECOMMEND_TEST_FORCE_DIRECT;
    delete process.env.OPENAI_API_KEY;
  });

  process.env.OMO_RECOMMEND_TEST_FORCE_DIRECT = "true";
  process.env.OPENAI_API_KEY = "mock-openai-key";

  global.fetch = async () => {
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({}),
    };
  };

  const ctx = new RuntimeContext();
  const res = await probeModel(ctx, "openai/gpt-4o");

  assert.deepEqual(res, { ok: true });
});
