function formatArgument(value) {
  const text = String(value);
  return /^[A-Za-z0-9_./:=@+-]+$/.test(text) ? text : JSON.stringify(text);
}

function escapeTerminalControls(value) {
  return String(value)
    .replace(/\t/g, "\\t")
    .replace(/[\x00-\x08\x0B-\x1F\x7F-\x9F]/g, (character) =>
      `\\x${character.codePointAt(0).toString(16).padStart(2, "0")}`,
    );
}

function outputWidth(width) {
  const configured = Number(width ?? process.env.COLUMNS ?? process.stdout.columns);
  return Number.isInteger(configured) && configured > 12 ? configured : 80;
}

function writeWrapped(prefix, text, width) {
  const contentWidth = Math.max(1, width - prefix.length);
  const value = escapeTerminalControls(text);
  if (value.length === 0) {
    process.stdout.write(`${prefix}\n`);
    return;
  }
  for (let index = 0; index < value.length; index += contentWidth) {
    process.stdout.write(`${prefix}${value.slice(index, index + contentWidth)}\n`);
  }
}

function writeExec(command, args, width, inGroup = false) {
  const rendered = [command, ...args.map(formatArgument)].join(" ");
  const firstPrefix = inGroup ? "├  [exec] " : "┌  [exec] ";
  const continuationPrefix = "│  [exec] ";
  const contentWidth = Math.max(1, width - firstPrefix.length);
  process.stdout.write(`${firstPrefix}${rendered.slice(0, contentWidth)}\n`);
  for (let index = contentWidth; index < rendered.length; index += width - continuationPrefix.length) {
    const nextWidth = Math.max(1, width - continuationPrefix.length);
    process.stdout.write(`${continuationPrefix}${rendered.slice(index, index + nextWidth)}\n`);
  }
}

function noOp() {
  return undefined;
}

export function createVerboseSubprocessReporter({
  enabled = false,
  command = "",
  args = [],
  displayArgs = args,
  width,
  inGroup = false,
} = {}) {
  if (!enabled) {
    return { stdout: noOp, stderr: noOp, finish: noOp };
  }

  const resolvedWidth = outputWidth(width);
  const buffers = { stdout: "", stderr: "" };
  const records = [];
  let finished = false;

  function flush(source, final = false) {
    const value = buffers[source];
    let lineStart = 0;
    for (let index = 0; index < value.length; index += 1) {
      const character = value[index];
      if (character === "\n") {
        const end = index > lineStart && value[index - 1] === "\r" ? index - 1 : index;
        records.push({ source, line: value.slice(lineStart, end) });
        lineStart = index + 1;
      } else if (character === "\r" && (index + 1 < value.length || final)) {
        records.push({ source, line: value.slice(lineStart, index) });
        lineStart = value[index + 1] === "\n" ? index + 2 : index + 1;
        if (value[index + 1] === "\n") index += 1;
      }
    }
    if (final) {
      if (lineStart < value.length) {
        records.push({ source, line: value.slice(lineStart) });
      }
      buffers[source] = "";
    } else {
      buffers[source] = value.slice(lineStart);
    }
  }

  function append(source, chunk) {
    if (finished) return;
    buffers[source] += String(chunk);
    if (buffers[source].includes("\n") || buffers[source].includes("\r")) {
      flush(source);
    }
  }

  function finish(statusMessage = "") {
    if (finished) return;
    finished = true;
    flush("stdout", true);
    flush("stderr", true);
    writeExec(command, displayArgs, resolvedWidth, inGroup);
    for (const { source, line } of records) {
      writeWrapped(`│  [${source}] `, line, resolvedWidth);
    }
    if (inGroup) {
      if (statusMessage) {
        process.stdout.write(`└  ${statusMessage}\n`);
      } else {
        process.stdout.write("└\n");
      }
    } else {
      if (statusMessage) {
        process.stdout.write(`└  ${statusMessage}\n`);
      } else {
        process.stdout.write("└\n┌\n│\n");
      }
    }
  }

  return { stdout: (chunk) => append("stdout", chunk), stderr: (chunk) => append("stderr", chunk), finish };
}
