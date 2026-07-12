export function parseRetryAfterSeconds(text) {
  const raw = String(text || "");
  const numericPatterns = [
    /retry-after["']?\s*[:=]\s*["']?(\d+)/i,
    /retry_after["']?\s*[:=]\s*["']?(\d+)/i,
    /retryAfter["']?\s*[:=]\s*["']?(\d+)/i,
    /x-ratelimit-reset["']?\s*[:=]\s*["']?(\d+)/i,
    /x-rate-limit-reset["']?\s*[:=]\s*["']?(\d+)/i,
  ];
  for (const pattern of numericPatterns) {
    const match = raw.match(pattern);
    if (!match) continue;
    const value = Number.parseInt(match[1], 10);
    if (!Number.isFinite(value)) continue;
    if (pattern.source.includes("reset") && value > 1000000000) {
      return Math.max(1, value - Math.floor(Date.now() / 1000));
    }
    return Math.max(1, value);
  }

  const dateMatch = raw.match(/retry-after["']?\s*[:=]\s*["']?([^"'\r\n]+)/i);
  if (dateMatch) {
    const ts = Date.parse(dateMatch[1].trim());
    if (Number.isFinite(ts)) {
      return Math.max(1, Math.ceil((ts - Date.now()) / 1000));
    }
  }

  // Parse natural language cooldowns (e.g., "45 minute cooldown to retry", "retry in 10 seconds")
  const cooldownRegex = /(\d+)\s*(minute|min|second|sec|hour|hr)s?\s*(?:cooldown|retry|wait)/i;
  const retryRegex = /(?:cooldown|retry|wait)\s*(?:in|for|of)?\s*(\d+)\s*(minute|min|second|sec|hour|hr)s?/i;
  const match = raw.match(cooldownRegex) || raw.match(retryRegex);
  if (match) {
    const value = Number.parseInt(match[1], 10);
    const unit = match[2].toLowerCase();
    if (Number.isFinite(value)) {
      if (unit.startsWith("min")) {
        return value * 60;
      } else if (unit.startsWith("hour") || unit.startsWith("hr")) {
        return value * 3600;
      } else {
        return value; // seconds
      }
    }
  }

  return null;
}

export function compactErrorText(text) {
  return (text || "")
    .replace(/\x1b\[[0-9;]*m/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-3)
    .join(" ");
}

export function isRateLimitError(text) {
  const lower = String(text || "").toLowerCase();
  return (
    lower.includes("429") ||
    lower.includes("rate limit") ||
    lower.includes("rate_limit") ||
    lower.includes("too many requests") ||
    lower.includes("too_many_requests") ||
    lower.includes("cooldown") ||
    lower.includes("free usage exceeded")
  );
}

export function isQuotaError(code, text) {
  const lower = String(text || "").toLowerCase();
  return (
    code === 402 ||
    lower.includes("402") ||
    lower.includes("payment required") ||
    lower.includes("payment_required") ||
    lower.includes("quota exceeded") ||
    lower.includes("quota_exceeded") ||
    lower.includes("billing limit") ||
    lower.includes("billing_limit") ||
    lower.includes("credit limit") ||
    lower.includes("credit_limit") ||
    lower.includes("insufficient funds") ||
    lower.includes("insufficient_funds") ||
    lower.includes("usage limit") ||
    lower.includes("budget exceeded") ||
    lower.includes("budget exhausted") ||
    lower.includes("quota restricted") ||
    lower.includes("credit expired") ||
    lower.includes("credits expired") ||
    lower.includes("unauthorized") ||
    lower.includes("forbidden") ||
    lower.includes("invalid api key") ||
    lower.includes("invalid_api_key") ||
    lower.includes("incorrect api key") ||
    lower.includes("incorrect key") ||
    lower.includes("key invalid") ||
    lower.includes("access denied") ||
    lower.includes("quota exhausted") ||
    lower.includes("restricted") ||
    lower.includes("limit exceeded") ||
    lower.includes("limit_exceeded") ||
    lower.includes("usage exceeded")
  );
}

export function isGuardrailOrPolicyError(text) {
  const lower = String(text || "").toLowerCase();
  return (
    lower.includes("guardrail") ||
    lower.includes("data policy") ||
    lower.includes("privacy")
  );
}

export function isModelUnavailableError(text) {
  const lower = String(text || "").toLowerCase();
  if (!/\b(model|deployment|engine)\b/.test(lower)) return false;
  return (
    lower.includes("not supported") ||
    lower.includes("unsupported") ||
    lower.includes("not found") ||
    lower.includes("does not exist") ||
    lower.includes("doesn't exist") ||
    lower.includes("not available") ||
    lower.includes("unavailable") ||
    lower.includes("unknown model") ||
    lower.includes("invalid model") ||
    lower.includes("model_not_found") ||
    lower.includes("model_not_supported")
  );
}

export function isTrueQuotaExhaustion(code, text) {
  const lower = String(text || "").toLowerCase();
  return (
    code === 402 ||
    lower.includes("402") ||
    lower.includes("payment required") ||
    lower.includes("payment_required") ||
    lower.includes("quota exceeded") ||
    lower.includes("quota_exceeded") ||
    lower.includes("billing limit") ||
    lower.includes("billing_limit") ||
    lower.includes("credit limit") ||
    lower.includes("credit_limit") ||
    lower.includes("insufficient funds") ||
    lower.includes("insufficient_funds") ||
    lower.includes("usage limit") ||
    lower.includes("budget exceeded") ||
    lower.includes("budget exhausted") ||
    lower.includes("quota restricted") ||
    lower.includes("credit expired") ||
    lower.includes("credits expired") ||
    lower.includes("quota exhausted") ||
    lower.includes("limit exceeded") ||
    lower.includes("limit_exceeded") ||
    lower.includes("usage exceeded")
  );
}

