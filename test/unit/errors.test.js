import assert from "node:assert/strict";
import test from "node:test";
import {
  AbortError,
  QuotaExceededError,
  RateLimitedError,
  ConfigError,
  ValidationError,
} from "../../lib/errors.js";

test("AbortError is an instance of Error", () => {
  const err = new AbortError();
  assert.ok(err instanceof Error);
  assert.equal(err.name, "AbortError");
  assert.equal(err.message, "Operation aborted");
});

test("AbortError accepts custom message", () => {
  const err = new AbortError("Custom abort");
  assert.equal(err.message, "Custom abort");
});

test("QuotaExceededError is an instance of Error", () => {
  const err = new QuotaExceededError();
  assert.ok(err instanceof Error);
  assert.equal(err.name, "QuotaExceededError");
  assert.equal(err.message, "Provider quota exceeded");
});

test("QuotaExceededError accepts custom message", () => {
  const err = new QuotaExceededError("Custom quota");
  assert.equal(err.message, "Custom quota");
});

test("RateLimitedError is an instance of Error", () => {
  const err = new RateLimitedError();
  assert.ok(err instanceof Error);
  assert.equal(err.name, "RateLimitedError");
  assert.equal(err.message, "Rate limited");
});

test("RateLimitedError defaults retryAfter to 15", () => {
  const err = new RateLimitedError();
  assert.equal(err.retryAfter, 15);
});

test("RateLimitedError accepts custom retryAfter", () => {
  const err = new RateLimitedError(60, "Too many requests");
  assert.equal(err.retryAfter, 60);
  assert.equal(err.message, "Too many requests");
});

test("ConfigError is an instance of Error", () => {
  const err = new ConfigError();
  assert.ok(err instanceof Error);
  assert.equal(err.name, "ConfigError");
  assert.equal(err.message, "Configuration error");
});

test("ValidationError is an instance of Error", () => {
  const err = new ValidationError();
  assert.ok(err instanceof Error);
  assert.equal(err.name, "ValidationError");
  assert.equal(err.message, "Validation failed");
});

test("All error types are distinct", () => {
  const errors = [
    new AbortError(),
    new QuotaExceededError(),
    new RateLimitedError(),
    new ConfigError(),
    new ValidationError(),
  ];
  const names = errors.map((e) => e.name);
  assert.equal(new Set(names).size, 5, "Each error type should have a unique name");
});
