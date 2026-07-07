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

export async function callOpencode(prompt, modelRef) {
  const bin = await findOpencode();
  if (!bin) throw new Error("opencode binary not found");

  return new Promise((resolve, reject) => {
    const child = spawn(bin, ["run", "--format", "json", "--model", modelRef], {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 120_000,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => { stdout += data.toString(); });
    child.stderr.on("data", (data) => { stderr += data.toString(); });

    child.on("error", (err) => reject(err));

    child.on("close", (code) => {
      if (code !== 0 && !stdout) {
        const detail = stderr.trim() ? `: ${stderr.trim().slice(0, 200)}` : "";
        reject(new Error(`opencode exited with code ${code}${detail}`));
        return;
      }

      for (const line of stdout.trim().split("\n")) {
        try {
          const event = JSON.parse(line);
          if (event.type === "text" && event.part?.text) {
            resolve(event.part.text);
            return;
          }
        } catch {
          continue;
        }
      }

      const preview = stdout.trim().slice(0, 120).replace(/\n/g, "\\n");
      const stderrInfo = stderr.trim() ? `; stderr: "${stderr.trim().slice(0, 200)}"` : "";
      reject(
        new Error(
          `opencode returned no text response (exit ${code}${stderrInfo}; stdout: "${preview}")`,
        ),
      );
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}
