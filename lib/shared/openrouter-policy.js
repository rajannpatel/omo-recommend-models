import https from "node:https";
import { createHash } from "node:crypto";

function openRouterApiKey(env = process.env) {
  const apiKey = env.OPENROUTER_API_KEY || env.OPENROUTER_BEARER;
  return typeof apiKey === "string" && apiKey.trim() ? apiKey.trim() : null;
}

export function openRouterPolicyCacheIdentity(env = process.env) {
  const apiKey = openRouterApiKey(env);
  if (!apiKey) return "openrouter-policy:none";
  const digest = createHash("sha256").update(apiKey).digest("hex");
  return `openrouter-policy:${digest}`;
}

export function fetchOpenRouterUserModelIds(env = process.env) {
  const apiKey = openRouterApiKey(env);
  if (!apiKey) return Promise.resolve(null);

  return new Promise((resolve) => {
    const req = https.get("https://openrouter.ai/api/v1/models/user", {
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
