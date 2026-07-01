import { LOCAL_PROVIDER } from "../constants.js";

function isCliProvider(provider) {
  return provider === "cli/codex" || provider === "cli/agy";
}

export function providerState(ctx, provider) {
  if (!ctx.providerAvailability.has(provider)) {
    ctx.providerAvailability.set(provider, {
      creditExhausted: false,
      rateLimitedUntil: 0,
      reason: null,
    });
  }
  return ctx.providerAvailability.get(provider);
}

export function isProviderAvailable(ctx, provider, now = Date.now()) {
  if (!provider || provider === LOCAL_PROVIDER || provider === "ollama" || isCliProvider(provider)) {
    return true;
  }
  if (ctx.opencodeOnlyMode && provider !== "opencode") return false;
  if (
    ctx.providerExclusionOptions.quotaRestricted &&
    ctx.quotaExceededProviders.has(provider)
  ) {
    return false;
  }
  const state = ctx.providerAvailability.get(provider);
  if (!state) return true;
  if (ctx.providerExclusionOptions.quotaRestricted && state.creditExhausted) {
    return false;
  }
  return !(
    ctx.providerExclusionOptions.rateLimited &&
    state.rateLimitedUntil &&
    state.rateLimitedUntil > now
  );
}

export function shouldProbeProviderAvailability(ctx) {
  return (
    ctx.providerExclusionOptions.quotaRestricted ||
    ctx.providerExclusionOptions.rateLimited
  );
}

export function markProviderCreditExhausted(ctx, provider, reason) {
  if (!provider) return;
  ctx.quotaExceededProviders.add(provider);
  const state = providerState(ctx, provider);
  state.creditExhausted = true;
  state.reason = reason || "credit-exhausted";
}

export function markProviderRateLimited(ctx, provider, retryAfterSeconds, reason) {
  if (!provider) return;
  const state = providerState(ctx, provider);
  const delayMs = Math.max(1, Number(retryAfterSeconds) || 15) * 1000;
  state.rateLimitedUntil = Math.max(
    state.rateLimitedUntil || 0,
    Date.now() + delayMs,
  );
  state.reason = reason || "rate-limited";
}
