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
function formatProgressCount(current, total) {
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

export function writeGroupLine(message) {
  const lines = String(message).replace(/\r\n?/g, "\n").split("\n");
  if (lines.length > 1 && lines.at(-1) === "") lines.pop();
  for (const line of lines) process.stdout.write(`│  ${line}\n`);
}

export function writeTopLevelLine(message) {
  process.stdout.write(`${message}\n`);
}

export function writeGroupSeparator() {
  process.stdout.write("│\n");
}

/**
 * Creates a CLI progress reporter.
 *
 * Pass `{ total }` for known-count API probes or AI-agent calls, or call
 * `setTotal(total)` when a lower layer discovers the count. Then call
 * `advance()` or `set(completed)` as each query finishes. The reporter writes
 * grouped, parseable `label: current/total` lines in every terminal mode.
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
    writeTopLevelLine(`${symbol}  ${label}: ${message}`);
    writeGroupSeparator();
  }

  return {
    setTotal(value) {
      total = parseTotal(value);
      current = clampProgress(current, total);
    },
    set(value, _message = "") {
      current = clampProgress(value, total);
    },
    advance(step = 1, _message = "") {
      current = clampProgress(current + step, total);
    },
    update(_message) {
    },
    done(message = "done") {
      if (total) current = total;
      const elapsed = Math.max(0, Math.round((Date.now() - start) / 1000));
      const text = `${rendered(message)} (${elapsed}s)`;
      writeFinalLine(doneSymbol, text);
    },
    skip(message) {
      writeFinalLine(doneSymbol, rendered(message));
    },
  };
}
