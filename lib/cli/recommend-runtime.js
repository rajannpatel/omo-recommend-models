import fs from "node:fs";
import path from "node:path";

import { createCliRuntime } from "../cli-runtime.js";
import {
  discoverFreeModels as originalDiscoverFreeModels,
} from "../omo-shared.js";
import {
  defaultPanelModels as defaultPanelModelsImpl,
} from "../display-utils.js";
import {
  discoverCliModels as discoverCliModelsImpl,
  preferDetectedCliPanelModels as preferDetectedCliPanelModelsImpl,
} from "../recommend/cli-agents.js";

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

export function discoverFreeModels(options = {}) {
  return options.noFreePanel ? [] : originalDiscoverFreeModels();
}

export function defaultPanelModels(config, cloudLookup = null, options = {}) {
  return defaultPanelModelsImpl(config, cloudLookup, {
    ...options,
    _discoverFreeModels: discoverFreeModels,
    _preferDetectedCliPanelModels: (refs, cfg, cl, max, opts) => {
      const discoverFn = (cfg2, opts2) =>
        discoverCliModelsImpl(cfg2, opts2, ctx, commandExists, subprocess);
      return preferDetectedCliPanelModelsImpl(refs, cfg, cl, max, opts, discoverFn, ctx);
    },
  });
}

export function handleRecommendModelsFatalError(error) {
  runtime.handleFatalError(error);
}
