import fs from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// Mirrors opencode's own auth-storage resolution (see `opencode auth login`):
// $XDG_DATA_HOME/opencode/auth.json, falling back to ~/.local/share/opencode/auth.json.
function opencodeAuthFilePath(env) {
  const dataHome = nonEmptyString(env.XDG_DATA_HOME) || path.join(os.homedir(), ".local", "share");
  return path.join(dataHome, "opencode", "auth.json");
}

// Credentials saved by `opencode auth login openrouter` land here, not in an
// env var - `opencode/auth.json` stores either an API key (`type: "api"`) or
// an OAuth token pair (`type: "oauth"`), keyed by provider id.
function openRouterAuthFileCredential(env) {
  try {
    const raw = fs.readFileSync(opencodeAuthFilePath(env), "utf8");
    const parsed = JSON.parse(raw);
    const credential = parsed?.openrouter;
    if (credential?.type === "api") return nonEmptyString(credential.key);
    if (credential?.type === "oauth") return nonEmptyString(credential.access);
    return null;
  } catch {
    return null;
  }
}

function openRouterApiKey(env = process.env) {
  const envKey = nonEmptyString(env.OPENROUTER_API_KEY) || nonEmptyString(env.OPENROUTER_BEARER);
  return envKey || openRouterAuthFileCredential(env);
}

export function openRouterPolicyCacheIdentity(env = process.env) {
  const apiKey = openRouterApiKey(env);
  if (!apiKey) return "openrouter-policy:none";
  const digest = createHash("sha256").update(apiKey).digest("hex");
  return `openrouter-policy:${digest}`;
}

export function fetchOpenRouterUserModelIds(env = process.env, httpsModule = https) {
  const apiKey = openRouterApiKey(env);
  if (!apiKey) return Promise.resolve(null);

  return new Promise((resolve) => {
    const req = httpsModule.get("https://openrouter.ai/api/v1/models/user", {
      timeout: 5000,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "User-Agent": "omo-recommend-models",
      },
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        if (res.statusCode >= 400) {
          resolve(null);
          return;
        }
        try {
          const parsed = JSON.parse(data);
          if (!Array.isArray(parsed?.data)) {
            resolve(null);
            return;
          }
          const modelIds = parsed.data
            .map((model) => model?.id)
            .filter((id) => typeof id === "string");
          resolve(new Set(modelIds));
        } catch {
          resolve(null);
        }
      });
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
  });
}
