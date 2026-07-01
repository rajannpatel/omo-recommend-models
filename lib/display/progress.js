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
  const separator = symbol === "◇" ? "  " : " ";
  const prefix = symbol === "◇" ? "" : "  ";
  process.stdout.write(`${prefix}${symbol}${separator}${label}: ${message}\n`);
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
  if (process.stdout.isTTY) {
    process.stdout.write(`  ⏳ ${label}${total ? `: ${formatProgressCount(current, total)}` : "..."} `);
  } else {
    writeProgressLine("⏳", label, total ? formatProgressCount(current, total) : "started");
  }

  function writeUpdate(message) {
    if (process.stdout.isTTY) {
      process.stdout.write(`\r  ⏳ ${label}: ${rendered(message)}\x1b[K`);
      return;
    }
    writeProgressLine("⏳", label, rendered(message));
  }

  return {
    setTotal(value) {
      total = parseTotal(value);
      current = clampProgress(current, total);
      writeUpdate("");
    },
    set(value, message = "") {
      current = clampProgress(value, total);
      writeUpdate(message);
    },
    advance(step = 1, message = "") {
      current = clampProgress(current + step, total);
      writeUpdate(message);
    },
    update(message) {
      writeUpdate(message);
    },
    done(message = "done") {
      if (total) current = total;
      const elapsed = Math.max(0, Math.round((Date.now() - start) / 1000));
      const text = `${rendered(message)} (${elapsed}s)`;
      if (process.stdout.isTTY) {
        const separator = doneSymbol === "◇" ? "  " : " ";
        const prefix = doneSymbol === "◇" ? "" : "  ";
        process.stdout.write(`\r${prefix}${doneSymbol}${separator}${label}: ${text}\x1b[K\n`);
        return;
      }
      writeProgressLine(doneSymbol, label, text);
    },
    skip(message) {
      if (process.stdout.isTTY) {
        process.stdout.write(`\r  • ${label}: ${rendered(message)}\x1b[K\n`);
        return;
      }
      writeProgressLine("•", label, rendered(message));
    },
  };
}
