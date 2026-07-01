import path from "node:path";

import { CACHE_DIR } from "../omo-shared.js";

export const DEFAULT_SCHEMA =
  "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/master/assets/oh-my-opencode.schema.json";
export const SCHEMA_CACHE_PATH = path.join(CACHE_DIR, "oh-my-opencode.schema.json");
export const GIT_MASTER_DEFAULT = {
  commit_footer: true,
  include_co_authored_by: true,
  git_env_prefix: "GIT_MASTER=1",
};
export const FALLBACK_OPTION_KEYS = new Set([
  "model",
  "variant",
  "reasoningEffort",
  "temperature",
  "top_p",
  "maxTokens",
  "thinking",
]);
export const REASONING_EFFORTS = new Set([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);
