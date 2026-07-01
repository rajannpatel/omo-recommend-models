let stdinBuffer = [];
let stdinWaiters = [];
let stdinInitialized = false;

function initStdin() {
  if (stdinInitialized) return;
  stdinInitialized = true;
  process.stdin.setEncoding("utf-8");
  process.stdin.resume();

  let currentLine = "";
  process.stdin.on("data", (chunk) => {
    currentLine += chunk;
    let index;
    while ((index = currentLine.indexOf("\n")) !== -1) {
      const line = currentLine.slice(0, index);
      currentLine = currentLine.slice(index + 1);
      const resolve = stdinWaiters.shift();
      if (resolve) resolve(line);
      else stdinBuffer.push(line);
    }
  });

  process.stdin.on("end", () => {
    if (currentLine) {
      const resolve = stdinWaiters.shift();
      if (resolve) resolve(currentLine);
      else stdinBuffer.push(currentLine);
    }
    while (stdinWaiters.length > 0) stdinWaiters.shift()("");
  });
}

function isStdinEnded() {
  return (
    process.stdin.readableEnded ||
    !process.stdin.readable ||
    Boolean(process.stdin._readableState && process.stdin._readableState.ended)
  );
}

export function readLineFromStdin() {
  initStdin();
  if (stdinBuffer.length > 0) return Promise.resolve(stdinBuffer.shift());
  if (isStdinEnded()) return Promise.resolve("");
  return new Promise((resolve) => {
    stdinWaiters.push(resolve);
  });
}

function pauseStdinIfIdle() {
  if (
    stdinInitialized &&
    process.stdin.isTTY &&
    stdinWaiters.length === 0 &&
    stdinBuffer.length === 0 &&
    !isStdinEnded()
  ) {
    process.stdin.pause();
  }
}

export async function promptLine(question) {
  if (isStdinEnded()) return "";
  process.stdout.write(question);
  try {
    return await readLineFromStdin();
  } finally {
    pauseStdinIfIdle();
  }
}

export async function confirm(question) {
  const answer = await promptLine(question);
  return answer.toLowerCase().trim() === "y";
}

export async function confirmDefaultYes(question) {
  const answer = (await promptLine(question)).toLowerCase().trim();
  return answer === "" || answer === "y" || answer === "yes";
}
