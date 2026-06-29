/**
 * hardware-detection.js — GPU and Ollama detection via subprocess.
 *
 * Extracted from bin/omo-recommend-models (L518-603). Detects NVIDIA GPU
 * via nvidia-smi and Ollama installation + running status via CLI.
 */

import { execFileSync } from "node:child_process";

function dumbEnv() {
  return { ...process.env, TERM: "dumb" };
}

/**
 * Detect NVIDIA GPU via nvidia-smi, falling back to Ollama presence.
 *
 * Returns { hasGpu, name, label, vramGb }.
 */
export function detectGPU() {
  const env = dumbEnv();
  try {
    const out = execFileSync(
      "nvidia-smi",
      [
        "--query-gpu=name,memory.total",
        "--format=csv,noheader,nounits",
      ],
      {
        encoding: "utf-8",
        timeout: 5000,
        stdio: ["ignore", "pipe", "pipe"],
        env,
      },
    );
    const [name, memStr] = out.trim().split(", ");
    const memGB = Math.round(parseInt(memStr) / 1024);
    return {
      hasGpu: true,
      name: name.trim(),
      label: `${name.trim()} (${memGB} GB VRAM)`,
      vramGb: memGB,
    };
  } catch (_) {}
  try {
    const out = execFileSync("ollama", ["list"], {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "pipe"],
      env,
    });
    if (out.includes("NAME"))
      return {
        hasGpu: true,
        name: "unknown GPU",
        label: "GPU detected (no nvidia-smi)",
        vramGb: 8,
      };
  } catch (_) {}
  return { hasGpu: false, name: "", label: "No GPU detected", vramGb: 0 };
}

/**
 * Detect Ollama installation and running status.
 *
 * Accepts commandExistsFn (e.g. the local commandExists helper) as a
 * dependency since it is defined in the main file.
 *
 * Returns { installed, running, version, models }.
 */
export function detectOllama(commandExistsFn) {
  let installed = false,
    running = false,
    version = null,
    models = [];
  const env = dumbEnv();
  installed = commandExistsFn("ollama").length > 0;
  if (installed) {
    try {
      version = (
        execFileSync("ollama", ["--version"], {
          encoding: "utf-8",
          timeout: 3000,
          stdio: ["ignore", "pipe", "pipe"],
          env,
        }) || ""
      ).trim();
    } catch (_) {}
    try {
      const list = execFileSync("ollama", ["list"], {
        encoding: "utf-8",
        timeout: 5000,
        stdio: ["ignore", "pipe", "pipe"],
        env,
      });
      running = list.includes("NAME");
      if (running) {
        const lines = list.trim().split("\n").slice(1);
        for (const line of lines) {
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 2) {
            const rawName = parts[0];
            models.push({
              name: rawName.includes(":") ? rawName : `${rawName}:latest`,
              size: parts[1] || "unknown",
            });
          }
        }
      }
    } catch (_) {}
  }
  return { installed, running, version, models };
}
