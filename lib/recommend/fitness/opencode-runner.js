import process from "node:process";
import { spawn } from "node:child_process";
import { writeGroupLine } from "../../display/progress.js";
import { createVerboseSubprocessReporter } from "../../display/subprocess-output.js";

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

function probeOpencode(bin, { verbose = false } = {}) {
  return new Promise((resolve) => {
    const args = ["--version"];
    const reporter = createVerboseSubprocessReporter({ enabled: verbose, command: bin, args });
    const child = spawn(bin, args, {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5000,
    });
    let resolved = false;
    let receivedOutput = false;
    const done = (ok) => {
      if (!resolved) {
        resolved = true;
        reporter.finish();
        resolve(ok);
      }
    };
    child.on("error", (error) => {
      reporter.stderr(error.message);
      done(false);
    });
    child.on("close", (code) => done(code === 0 || receivedOutput));
    child.stdout.on("data", (data) => {
      receivedOutput = true;
      reporter.stdout(data);
    });
    child.stderr.on("data", (data) => reporter.stderr(data));
    setTimeout(() => {
      child.kill?.();
      done(false);
    }, 5000).unref();
  });
}

export async function findOpencode(options = {}) {
  if (_opencodeBinSearched) return _opencodeBin;
  if (_opencodeProbing) return _opencodeProbing;

  _opencodeProbing = (async () => {
    for (const bin of OPENCODE_CANDIDATES) {
      if (await probeOpencode(bin, options)) {
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
  const bin = await findOpencode(options);
  if (!bin) throw new Error("opencode binary not found");

  const { debug = false, verbose = false } = options;

  return new Promise((resolve, reject) => {
    const args = ["run", "--format", "json", "--model", modelRef];
    const reporter = createVerboseSubprocessReporter({ enabled: verbose, command: bin, args });
    if (debug && !verbose) writeGroupLine(`[exec] ${bin} ${args.join(" ")}`);
    const spawnOptions = {
      stdio: ["pipe", "pipe", "pipe"],
    };
    const child = ctx && typeof ctx.registerChild === "function"
      ? ctx.registerChild(spawn(bin, args, spawnOptions))
      : spawn(bin, args, spawnOptions);

    let stdout = "";
    let stderr = "";
    let eventCount = 0;
    let watchdog = null;

    const resetWatchdog = () => {
      if (watchdog) clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        child.kill();
        reject(new Error(`opencode timed out - no output for 60s`));
      }, 60000);
    };
    resetWatchdog();

    // Stream stdout in real-time as JSON events
    child.stdout.on("data", (data) => {
      resetWatchdog();
      const raw = data.toString();
      reporter.stdout(raw);
      const lines = raw.split("\n");
      for (const line of lines) {
        if (!line.trim()) continue;
        
        stdout += line + "\n";
        eventCount++;
        
        try {
          const event = JSON.parse(line);
          
          // Show event type and key data in real-time
          if (event.type === "text" && event.part?.text) {
            // Show text event with preview
            const preview = event.part.text.slice(0, 100);
            if (debug && !verbose) writeGroupLine(`[event:text] ${preview}${preview.length < event.part.text.length ? "..." : ""}`);
          } else if (event.type === "error" && debug && !verbose) {
            writeGroupLine(`[event:error] ${JSON.stringify(event).slice(0, 200)}`);
          } else if (debug && !verbose) {
            // Show other event types briefly
            writeGroupLine(`[event:${event.type}] ${JSON.stringify(event).slice(0, 200)}`);
          }
        } catch (parseError) {
          // Not valid JSON, show raw line if debug
          if (debug && !verbose) {
            writeGroupLine(`[raw] ${line.slice(0, 200)}`);
          }
        }
      }
    });

    child.stderr.on("data", (data) => {
        const line = data.toString();
        stderr += line;
        reporter.stderr(line);
        if (debug && !verbose) {
        process.stderr.write(`│  [stderr] ${line.slice(0, 500)}\n`);
        }
      });

    child.on("error", (err) => {
      reporter.stderr(err.message);
      reporter.finish();
      reject(err);
    });

    child.on("close", (code) => {
      if (watchdog) clearTimeout(watchdog);
      reporter.finish();

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
        if (debug && !verbose) writeGroupLine(`[complete] query ${modelRef}: ${eventCount} events`);
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
