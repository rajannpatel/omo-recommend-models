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
  if (!dateMatch) return null;
  const ts = Date.parse(dateMatch[1].trim());
  return Number.isFinite(ts)
    ? Math.max(1, Math.ceil((ts - Date.now()) / 1000))
    : null;
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
    lower.includes("too_many_requests")
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
    lower.includes("key invalid") ||
    lower.includes("access denied") ||
    lower.includes("exhausted") ||
    lower.includes("restricted") ||
    lower.includes("limit exceeded") ||
    lower.includes("limit_exceeded")
  );
}
