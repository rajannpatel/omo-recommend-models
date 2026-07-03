import fs from "node:fs";
import path from "node:path";

import { createCliRuntime } from "../cli-runtime.js";

export const runtime = createCliRuntime();
export const { ctx, subprocess } = runtime;

export function commandExists(binary) {
  if (!binary || binary.includes(path.sep)) return "";
  for (const dir of String(process.env.PATH || "").split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, binary);
    try {
      const stat = fs.statSync(candidate);
      if (!stat.isFile()) continue;
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {}
  }
  return "";
}

export function handleRecommendModelsFatalError(error) {
  runtime.handleFatalError(error);
}
