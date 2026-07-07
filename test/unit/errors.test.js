import assert from "node:assert/strict";
import test from "node:test";

import {
  AbortError,
  QuotaExceededError,
  RateLimitedError,
  ConfigError,
  ValidationError,
} from "../../lib/errors.js";

test("AbortError is an Error", () => {
  const err = new AbortError();
  assert.ok(err instanceof Error);
  assert.equal(err.name, "AbortError");
  assert.equal(err.message, "Operation aborted");
});

test("AbortError accepts custom message", () => {
  const err = new AbortError("Cancelled by user");
  assert.equal(err.message, "Cancelled by user");
});

test("QuotaExceededError is an Error", () => {
  const err = new QuotaExceededError();
  assert.ok(err instanceof Error);
  assert.equal(err.name, "QuotaExceededError");
  assert.equal(err.message, "Provider quota exceeded");
});

test("QuotaExceededError accepts custom message", () => {
  const err = new QuotaExceededError("Out of credits");
  assert.equal(err.message, "Out of credits");
});

test("RateLimitedError is an Error with retryAfter", () => {
  const err = new RateLimitedError();
  assert.ok(err instanceof Error);
  assert.equal(err.name, "RateLimitedError");
  assert.equal(err.message, "Rate limited");
  assert.equal(err.retryAfter, 15);
});

test("RateLimitedError accepts custom retryAfter and message", () => {
  const err = new RateLimitedError(60, "Too many requests");
  assert.equal(err.retryAfter, 60);
  assert.equal(err.message, "Too many requests");
});

test("ConfigError is an Error", () => {
  const err = new ConfigError();
  assert.ok(err instanceof Error);
  assert.equal(err.name, "ConfigError");
  assert.equal(err.message, "Configuration error");
});

test("ConfigError accepts custom message", () => {
  const err = new ConfigError("Invalid setting");
  assert.equal(err.message, "Invalid setting");
});

test("ValidationError is an Error", () => {
  const err = new ValidationError();
  assert.ok(err instanceof Error);
  assert.equal(err.name, "ValidationError");
  assert.equal(err.message, "Validation failed");
});

test("ValidationError accepts custom message", () => {
  const err = new ValidationError("Field is required");
  assert.equal(err.message, "Field is required");
});

test("instanceof checks work across error types", () => {
  assert.ok(new AbortError() instanceof Error);
  assert.ok(new QuotaExceededError() instanceof Error);
  assert.ok(new RateLimitedError() instanceof Error);
  assert.ok(new ConfigError() instanceof Error);
  assert.ok(new ValidationError() instanceof Error);

  assert.ok(!(new AbortError() instanceof QuotaExceededError));
  assert.ok(!(new RateLimitedError() instanceof ConfigError));
});
