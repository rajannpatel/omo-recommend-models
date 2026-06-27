# PROJECT KNOWLEDGE BASE

**Generated:** 2026-06-27
**Commit:** 29478729cd7e8a97522fa95f061775def7b0ce0f
**Branch:** master

## OVERVIEW
Node CLI tooling for recommending OpenCode OMO agent model placements in `oh-my-openagent.jsonc`. Modernized to run as an ES Modules package with dependency management, interactive terminal prompts, and subprocess tracking, fully optimized for execution via `npx`.

## STRUCTURE
```
omo-recommend/
├── bin/
│   ├── omo-recommend-models # main executable CLI and AI panel flow (ESM)
│   └── omo-validate-config  # config validation tool (ESM)
├── lib/
│   ├── omo-shared.js       # config paths, JSONC parsing, and model lookup helpers
│   └── recommend/
│       └── apply.js        # decoupled backup, validation, and write logic
├── package.json            # NPM package and dependency definitions
├── package-lock.json       # lockfile for dependencies
└── workshop.yaml           # workshop configurations
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| AI panel calls, prompt, consensus, dry-run flow | `bin/omo-recommend-models` | `main()` is at the bottom; uses `mri` for arg parsing and `@clack/prompts` for UI. |
| Config paths and JSONC parsing | `lib/omo-shared.js` | Traverses directories backwards from process.cwd() for `.opencode/oh-my-openagent.jsonc`. |
| Provider aliases and lookup | `lib/omo-shared.js` | `buildProviderAliases`, `resolveProvider`, `buildRichModelLookup`. |
| Backup and configuration validation writing | `lib/recommend/apply.js` | Manages backups, validating runs, and rollbacks on validation failures. |

## CONVENTIONS
- Runtime is Node.js with ES Modules (ESM). All imports must use explicit `.js` extensions.
- Built-in Node modules are imported using the `node:` protocol prefix (e.g., `import fs from "node:fs"`).
- Third-party dependencies are managed via `package.json` (`mri`, `@clack/prompts`, `picocolors`).
- Subprocess execution must use argument arrays instead of raw shell command strings to prevent shell escaping issues.
- Non-interactive/non-TTY execution defaults to dry-run mode, printing proposed updates without applying unless `--yes` or `-y` is passed.

## ANTI-PATTERNS (THIS PROJECT)
- Local models must not go into routing arrays; they belong in `fallback_models` unless the script intentionally sets a local primary for a utility/no-cloud scenario.
- Do not place multiple local models for the same agent; choose the highest-scored fitting local model.
- Recommendation order is semantic: first item becomes primary, later items become fallbacks.
- Free models should not become primary for demanding agents when higher-scored paid/cloud models exist.
- Redundant local models, same-tier duplicates, and unused low-value installed models should be marked for uninstall.

## COMMANDS
```bash
node ./bin/omo-recommend-models --dry-run --cloud-only
node ./bin/omo-recommend-models --rebalance --yes
npm test
```

## NOTES
- The test harness is configured in `test/omo-recommend-models.test.js` and runs via `npm test` using Node's built-in `node:test`.
- `.codegraph` is a local symlink for indexed navigation and is excluded from git.
- Keep any temporary debug files out of the repo; use `/tmp` or `.git/info/exclude` for local-only artifacts.

