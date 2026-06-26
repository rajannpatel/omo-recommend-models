# PROJECT KNOWLEDGE BASE

**Generated:** 2026-06-26
**Commit:** none yet
**Branch:** master

## OVERVIEW
Node CLI tooling for recommending OpenCode OMO agent model placements in `oh-my-openagent.jsonc`. The repo is intentionally minimal: one executable orchestrator and one shared CommonJS helper module.

## STRUCTURE
```
omo-recommend/
├── bin/
│   └── omo-recommend-models # main executable CLI and AI panel flow
├── lib/
│   └── omo-shared.js       # config paths, JSONC parsing, model discovery, apply helpers
└── task.md                 # captured bug report / repro transcript
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| AI panel calls, prompt, consensus, dry-run flow | `bin/omo-recommend-models` | `main()` is at the bottom; panel helpers start near the "AI Panel" section. |
| Config paths and JSONC parsing | `lib/omo-shared.js` | Defaults to `~/.config/opencode/oh-my-openagent.jsonc` and `~/.cache/oh-my-opencode/provider-models.json`. |
| Provider aliases and lookup | `lib/omo-shared.js` | `buildProviderAliases`, `resolveProvider`, `buildRichModelLookup`. |
| Local model install/uninstall and placement | `bin/omo-recommend-models` | Keep local placement rules synchronized with prompt rules. |
| Reported bug context | `task.md` | Shows non-north panel models timing out before this fix work. |

## CONVENTIONS
- Runtime is Node.js with CommonJS.
- The executable uses `require("../lib/omo-shared")` from `bin/`. Run from source with `node ./bin/omo-recommend-models ...`.
- There is no `package.json`; use built-in Node commands directly.
- CLI verification should use the real executable surface: `NODE_PATH=$PWD node ./omo-recommend-models ...`.
- Use `--cloud-only --dry-run` for fast panel QA that avoids Ollama registry discovery and config writes.

## ANTI-PATTERNS (THIS PROJECT)
- Local models must not go into routing arrays; they belong in `fallback_models` unless the script intentionally sets a local primary for a utility/no-cloud scenario.
- Do not place multiple local models for the same agent; choose the highest-scored fitting local model.
- Recommendation order is semantic: first item becomes primary, later items become fallbacks.
- Free models should not become primary for demanding agents when higher-scored paid/cloud models exist.
- Redundant local models, same-tier duplicates, and unused low-value installed models should be marked for uninstall.

## COMMANDS
```bash
node ./bin/omo-recommend-models --dry-run --cloud-only
node ./bin/omo-recommend-models --rebalance --dry-run
node --test
```

## NOTES
- No LSP or package-managed test harness is configured; tests added here should use Node's built-in `node:test`.
- `.codegraph` is a local symlink for indexed navigation and is excluded from git.
- Keep any temporary debug files out of the repo; use `/tmp` or `.git/info/exclude` for local-only artifacts.
