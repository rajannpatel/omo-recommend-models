export {
  isProviderAvailable,
  markProviderCreditExhausted,
  markProviderRateLimited,
  providerState,
  shouldProbeProviderAvailability,
} from "./providers/state.js";
export {
  compactErrorText,
  isQuotaError,
  isRateLimitError,
  parseRetryAfterSeconds,
  isGuardrailOrPolicyError,
  isModelUnavailableError,
} from "./providers/errors.js";
export { probeModel } from "./providers/probe.js";

export const PROVIDER_CATALOG_ENDPOINTS = {
  openrouter: "https://openrouter.ai/api/v1/models",
};

export function isProviderCatalogFetchable(provider) {
  return provider in PROVIDER_CATALOG_ENDPOINTS;
}

function httpsGet(url, signal) {
  return new Promise((resolve, reject) => {
    const { URL } = require("node:url");
    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === "https:" ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: "GET",
      headers: {
        "User-Agent": "omo-recommend-models/1.0",
      },
    };

    const req = require("node:https").request(options, (res) => {
      const contentLength = res.headers["content-length"];
      if (contentLength && parseInt(contentLength) > 5 * 1024 * 1024) {
        res.destroy();
        return reject(new Error("Response size exceeds 5MB limit"));
      }

      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString();
        let parsed;
        try {
          parsed = JSON.parse(body);
        } catch (e) {
          return reject(new Error(`Failed to parse JSON: ${e.message}`));
        }
        resolve({ statusCode: res.statusCode, data: parsed });
      });
    });

    req.on("error", (err) => reject(err));
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error("Request timeout after 15 seconds"));
    });

    if (signal) {
      signal.addEventListener("abort", () => {
        req.destroy();
        reject(new Error("Request aborted"));
      });
    }

    req.end();
  });
}

export async function fetchProviderModelCatalog(provider, options = {}) {
  if (!isProviderCatalogFetchable(provider)) {
    return null;
  }

  const url = PROVIDER_CATALOG_ENDPOINTS[provider];
  const signal = options.signal;

  try {
    const { statusCode, data } = await httpsGet(url, signal);

    if (statusCode >= 400) {
      return {
        provider,
        fetchedAt: Date.now(),
        error: `HTTP ${statusCode}`,
      };
    }

    const models = Array.isArray(data.data) ? data.data : [];

    const normalizedModels = models.map((model) => ({
      id: model.id,
      name: model.name || model.id,
      context_length: model.context_length || 0,
      pricing: model.pricing || { prompt: 0, completion: 0 },
      capabilities: model.capabilities || {},
      created: model.created || Date.now() / 1000,
    }));

    return {
      provider,
      fetchedAt: Date.now(),
      models: normalizedModels,
    };
  } catch (error) {
    return {
      provider,
      fetchedAt: Date.now(),
      error: error.message,
    };
  }
}
