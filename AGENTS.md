# PROJECT KNOWLEDGE BASE

**Generated:** 2026-06-29
**Commit:** 473a6fe
**Branch:** master

## OVERVIEW
Node ESM CLI tooling for recommending OpenCode OMO agent/category model placements in `oh-my-openagent.jsonc`. The default path is deterministic upstream rule matching; the legacy AI panel remains opt-in through `--ai-panel`.

## STRUCTURE
```
omo-recommend/
├── bin/
│   ├── omo-recommend-models # main executable CLI orchestration (ESM)
│   └── omo-validate-config  # config validation tool (ESM)
├── lib/
│   ├── cli-options.js      # commander flag parsing and defaults
│   ├── omo-shared.js       # config paths, JSONC parsing, and model lookup helpers
│   ├── probe-providers.js  # provider availability / quota / rate-limit state
│   └── recommend/
│       ├── rules-assignment.js          # upstream model-chain matcher
│       ├── model-requirements.js        # vendored upstream source-of-truth snapshot
│       ├── recommendation-finalizer.js  # normalize, backfill, deduplicate
│       ├── apply-recommendations.js     # config mutation and apply pipeline
│       └── apply.js                     # backup, validation, and write logic
├── package.json            # NPM package and dependency definitions
├── package-lock.json       # lockfile for dependencies
└── workshop.yaml           # workshop configurations
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| CLI startup, dry-run/apply flow | `bin/omo-recommend-models` | `main()` is at the bottom; argument parsing is delegated to `lib/cli-options.js`. |
| CLI flags and defaults | `lib/cli-options.js` | Uses `commander`; aliases like `--cloud-only` normalize to internal exclude flags. |
| Rule-chain assignment | `lib/recommend/rules-assignment.js` | Uses `AGENT_MODEL_REQUIREMENTS` and `CATEGORY_MODEL_REQUIREMENTS` from `model-requirements.js`. |
| Upstream model source snapshot | `lib/recommend/model-requirements.js` | Mirrors `code-yeongyu/oh-my-openagent` `dev` branch model-core requirement files. |
| Provider quota/rate-limit handling | `lib/probe-providers.js` | Tracks provider state in `RuntimeContext`; final config filtering must honor it. |
| Config paths and JSONC parsing | `lib/omo-shared.js` | Traverses directories backwards from process.cwd() for `.opencode/oh-my-openagent.jsonc`. |
| Provider aliases and lookup | `lib/omo-shared.js` | `buildProviderAliases`, `resolveProvider`, `buildRichModelLookup`. |
| Recommendation normalization | `lib/recommend/recommendation-finalizer.js` | Filters unusable refs, fills provider fallbacks, adds fitting local fallback. |
| Config writes and validation | `lib/recommend/apply.js`, `lib/recommend/apply-recommendations.js` | Manages backups, mutation, validation, and rollback on validation failures. |
| Integration harness | `test/omo-recommend-models.test.js` | Fakes `opencode`, `ollama`, `codex`, `agy`, and GPU commands. |
| Test placement guidance | `test/README.md` | Explains unit vs integration tests, fixture placement, and model availability coverage expectations. |

## CONVENTIONS
- Runtime is Node.js with ES Modules (ESM). All imports must use explicit `.js` extensions.
- Built-in Node modules are imported using the `node:` protocol prefix (e.g., `import fs from "node:fs"`).
- Third-party dependencies are managed via `package.json` (`mri`, `@clack/prompts`, `picocolors`).
- Subprocess execution must use argument arrays instead of raw shell command strings to prevent shell escaping issues.
- Non-interactive/non-TTY execution defaults to dry-run mode, printing proposed updates without applying unless `--yes` or `-y` is passed.
- Built-in upstream model matching follows `packages/model-core/src/agent-model-requirements.ts` and `packages/model-core/src/category-model-requirements.ts` from `code-yeongyu/oh-my-openagent` `dev`.
- Free OpenCode models are allowed in config by default. Use `--no-free-config` only when the user explicitly wants them removed.
- Provider availability is not enough for assignment. Advertised model refs must be probed; reject only the failing `provider/model` ref while keeping other available refs from that provider eligible.

## ANTI-PATTERNS (THIS PROJECT)
- Do not write `routing` into `oh-my-openagent.jsonc`; the upstream schema allows `model` and `fallback_models`, not `routing`.
- Do not place multiple local models for the same agent; choose the highest-scored fitting local model.
- Recommendation order is semantic: first item becomes primary, later items become fallbacks.
- Free models should not become primary for demanding agents when higher-scored paid/cloud models exist.
- Quota-exhausted or currently rate-limited providers must not appear in `model` or `fallback_models` once detected.
- Redundant local models, same-tier duplicates, and unused low-value installed models should be marked for uninstall.

## COMMANDS
```bash
node ./bin/omo-recommend-models --dry-run --cloud-only
node ./bin/omo-recommend-models --yes
npm test
```

## NOTES
- The test harness is configured in `test/omo-recommend-models.test.js`; focused unit tests live under `test/unit/`. See `test/README.md` before adding coverage. All tests run via `npm test` using Node's built-in `node:test`.
- `.codegraph` is a local symlink for indexed navigation and is excluded from git.
- Keep any temporary debug files out of the repo; use `/tmp` or `.git/info/exclude` for local-only artifacts.
