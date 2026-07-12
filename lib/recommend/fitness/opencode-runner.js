import process from "node:process";
import { spawn } from "node:child_process";

let _opencodeBin = null;
let _opencodeBinSearched = false;
let _opencodeProbing = null;

const OPENCODE_CANDIDATES = [
  "opencode",
  "/var/lib/workshop/sdk/opencode/bin/opencode",
  "/usr/local/bin/opencode",
  process.env.HOME ? `${process.env.HOME}/.local/bin/opencode` : null,
  process.env.HOME ? `${process.env.HOME}/.opencode/opencode` : null,
].filter(Boolean);

function probeOpencode(bin) {
  return new Promise((resolve) => {
    const child = spawn(bin, ["--version"], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5000,
    });
    let resolved = false;
    const done = (ok) => { if (!resolved) { resolved = true; resolve(ok); } };
    child.on("error", () => done(false));
    child.on("close", (code) => done(code === 0));
    child.stdout.on("data", () => done(true));
    setTimeout(() => done(false), 5000);
  });
}

export async function findOpencode() {
  if (_opencodeBinSearched) return _opencodeBin;
  if (_opencodeProbing) return _opencodeProbing;

  _opencodeProbing = (async () => {
    for (const bin of OPENCODE_CANDIDATES) {
      if (await probeOpencode(bin)) {
        _opencodeBin = bin;
        return bin;
      }
    }
    return null;
  })();

  const result = await _opencodeProbing;
  _opencodeBinSearched = true;
  _opencodeProbing = null;
  return result;
}

export async function callOpencode(prompt, modelRef, ctx = null, options = {}) {
  const bin = await findOpencode();
  if (!bin) throw new Error("opencode binary not found");

  const { debug = false } = options;

  return new Promise((resolve, reject) => {
    const args = ["run", "--format", "json", "--model", modelRef];
    process.stdout.write(`\n│  [exec] ${bin} ${args.join(" ")}\n`);
    const spawnOptions = {
      stdio: ["pipe", "pipe", "pipe"],
    };
    const child = ctx && typeof ctx.registerChild === "function"
      ? ctx.registerChild(spawn(bin, args, spawnOptions))
      : spawn(bin, args, spawnOptions);

    let stdout = "";
    let stderr = "";
    let eventCount = 0;
    let lastOutputTime = Date.now();
    let watchdog = null;
    let textReceived = false;

    const resetWatchdog = () => {
      lastOutputTime = Date.now();
      if (watchdog) clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        child.kill();
        reject(new Error(`opencode timed out - no output for 60s`));
      }, 60_000);
    };
    resetWatchdog();

    // Stream stdout in real-time as JSON events
    child.stdout.on("data", (data) => {
      resetWatchdog();
      const lines = data.toString().split("\n");
      for (const line of lines) {
        if (!line.trim()) continue;
        
        stdout += line + "\n";
        eventCount++;
        
        try {
          const event = JSON.parse(line);
          
          // Show event type and key data in real-time
          if (event.type === "text" && event.part?.text) {
            textReceived = true;
            // Show text event with preview
            const preview = event.part.text.slice(0, 100);
            process.stdout.write(`\n│  [event:text] ${preview}${preview.length < event.part.text.length ? "..." : ""}`);
          } else if (event.type === "error") {
            process.stdout.write(`\n│  [event:error] ${JSON.stringify(event).slice(0, 200)}`);
          } else {
            // Show other event types briefly
            process.stdout.write(`\n│  [event:${event.type}] ${JSON.stringify(event).slice(0, 200)}`);
          }
        } catch (parseError) {
          // Not valid JSON, show raw line if debug
          if (debug) {
            process.stdout.write(`\n│  [raw] ${line.slice(0, 200)}`);
          }
        }
      }
    });

    // Stream stderr in real-time if debug mode
    if (debug) {
      child.stderr.on("data", (data) => {
        const line = data.toString();
        stderr += line;
        process.stderr.write(`\n│  [stderr] ${line.slice(0, 500)}`);
      });
    } else {
      child.stderr.on("data", (data) => {
        stderr += data.toString();
      });
    }

    child.on("error", (err) => {
      reject(err);
    });

    child.on("close", (code) => {
      if (watchdog) clearTimeout(watchdog);

      if (code !== 0 && !stdout) {
        const detail = stderr.trim() ? `: ${stderr.trim().slice(0, 200)}` : "";
        reject(new Error(`opencode exited with code ${code}${detail}`));
        return;
      }

      let extractedText = null;
      for (const line of stdout.trim().split("\n")) {
        try {
          const event = JSON.parse(line);
          if (event.type === "text" && event.part?.text) {
            extractedText = event.part.text;
            break;
          }
        } catch {
          continue;
        }
      }

      if (extractedText) {
        // Show completion indicator
        process.stdout.write(`\n│  [complete] probe ${modelRef}: ${eventCount} events`);
        resolve(extractedText);
      } else {
        const eventTypes = [];
        for (const line of stdout.trim().split("\n")) {
          try {
            const event = JSON.parse(line);
            if (event.type) eventTypes.push(event.type);
          } catch { /* ignore */ }
        }
        const eventSummary = eventTypes.length > 0 ? ` (events: ${[...new Set(eventTypes)].join(", ")})` : "";
        const stderrInfo = stderr.trim() ? `; stderr: "${stderr.trim().slice(0, 200)}"` : "";
        reject(
          new Error(
            `opencode returned no text response (exit ${code}${eventSummary}${stderrInfo})`,
          ),
        );
      }
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}
