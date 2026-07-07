export class AbortError extends Error {
  constructor(message = "Operation aborted") {
    super(message);
    this.name = "AbortError";
  }
}

export class QuotaExceededError extends Error {
  constructor(message = "Provider quota exceeded") {
    super(message);
    this.name = "QuotaExceededError";
  }
}

export class RateLimitedError extends Error {
  /**
   * @param {number} [retryAfter=15] - Seconds to wait before retrying
   * @param {string} [message="Rate limited"]
   */
  constructor(retryAfter = 15, message = "Rate limited") {
    super(message);
    this.name = "RateLimitedError";
    this.retryAfter = retryAfter;
  }
}

export class ConfigError extends Error {
  constructor(message = "Configuration error") {
    super(message);
    this.name = "ConfigError";
  }
}

export class ValidationError extends Error {
  constructor(message = "Validation failed") {
    super(message);
    this.name = "ValidationError";
  }
}
