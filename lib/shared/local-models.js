import { execFileSync } from "node:child_process";

export function discoverLocalModels() {
  try {
    const raw = execFileSync("omo-recommend-local", ["--json"], {
      encoding: "utf-8",
      timeout: 10000,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, TERM: "dumb" },
    });
    const data = JSON.parse(raw);
    return (data.ollama.models || [])
      .filter((model) => model.name)
      .map((model) => model.name);
  } catch {
    return [];
  }
}
