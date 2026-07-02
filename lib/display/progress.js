function parseTotal(total) {
  const value = Number(total);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function clampProgress(value, total) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  if (!total) return Math.max(0, Math.floor(numeric));
  return Math.min(total, Math.max(0, Math.floor(numeric)));
}

/**
 * Formats known-count progress consistently across API probes and AI calls.
 *
 * Keep this helper panel-agnostic so future API/AI features can reuse the same
 * current/total contract without importing recommendation-specific modules.
 */
export function formatProgressCount(current, total) {
  const parsedTotal = parseTotal(total);
  if (!parsedTotal) return "";
  return `${clampProgress(current, parsedTotal)}/${parsedTotal}`;
}

function formatMessage(message, current, total) {
  const count = formatProgressCount(current, total);
  const text = String(message || "").trim();
  if (!count) return text;
  return text ? `${text} ${count}` : count;
}

function writeProgressLine(symbol, label, message) {
  process.stdout.write(`${symbol}  ${label}: ${message}\n`);
}

/**
 * Creates a CLI progress reporter.
 *
 * Pass `{ total }` for known-count API probes or AI-agent calls, or call
 * `setTotal(total)` when a lower layer discovers the count. Then call
 * `advance()` or `set(completed)` as each query finishes. The reporter keeps
 * TTY output spinner-like and writes parseable `label: current/total` lines in
 * non-TTY logs.
 */
export function createProgress(label, options = {}) {
  let total = parseTotal(options.total);
  let current = clampProgress(options.current || 0, total);
  const doneSymbol = options.doneSymbol || "✓";

  function rendered(message) {
    return formatMessage(message, current, total);
  }

  const start = Date.now();

  function writeFinalLine(symbol, message) {
    process.stdout.write(`${symbol}  ${label}: ${message}\n│\n`);
  }

  return {
    setTotal(value) {
      total = parseTotal(value);
      current = clampProgress(current, total);
    },
    set(value, message = "") {
      current = clampProgress(value, total);
    },
    advance(step = 1, message = "") {
      current = clampProgress(current + step, total);
    },
    update(message) {
    },
    done(message = "done") {
      if (total) current = total;
      const elapsed = Math.max(0, Math.round((Date.now() - start) / 1000));
      const text = `${rendered(message)} (${elapsed}s)`;
      writeFinalLine(doneSymbol, text);
    },
    skip(message) {
      writeFinalLine("•", rendered(message));
    },
  };
}
