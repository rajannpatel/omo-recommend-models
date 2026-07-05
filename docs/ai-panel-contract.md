# Legacy AI Panel Contract

This document locks the current `--ai-panel` behavior before cleanup. It is intentionally conservative: the AI Panel is legacy and opt-in, but it remains reachable and tested.

## Decision

`KEEP FOR NOW`, gated behind `--ai-panel`.

Do not delete AI Panel modules in cleanup. Do not make the legacy panel the primary recommendation engine. Future work may deprecate or replace it after provider-complete deterministic ranking and output/apply parity are implemented.

## User-Facing Contract

By default, `omo-recommend-models` uses deterministic rule matching. The AI Panel runs only when the user passes:

```bash
npx omo-recommend-models --ai-panel
```

The default command path must continue to work without a local `node_modules` directory and without requiring an install step.

## Reachable Flow

The `--ai-panel` flag is parsed in `lib/cli-options.js` and becomes `runOptions.useAiPanel` through `lib/cli/recommend-inputs.js::buildRunOptions`.

When enabled, the recommendation path flows through:

1. `lib/cli/recommend-execution.js::selectRecommendation`
2. `selectPanel()`
3. `selectPanelRecommendation()`
4. `runPanelAndSelect()`
5. `completeAiRecommendations()`

Reachable module families include:

- `lib/recommend/panel-selection.js`
- `lib/recommend/panel-selection/*`
- `lib/recommend/panel-core/*`
- `lib/recommend/panel-candidates.js`
- `lib/recommend/cli-agents/*`
- `lib/consensus.js`

## Supported Flags Affecting Panel Behavior

The following flags are part of the reachable AI Panel surface:

- `--ai-panel`
- `--parallel-panel`
- `--model <ref>`
- `--exclude-model <ref>`
- `--no-cache`
- `--free-panel`
- `--no-free-panel`
- `--exclude-codex` / `--exclude-codex-cli`
- `--exclude-agy` / `--exclude-agy-cli`
- `--exclude-opencode` / `--exclude-opencode-cli`

The final JSONC output can also be affected by shared config flags such as `--no-free-config`, `--no-free-config`, `--cloud-only`, `--local-only`, `--no-install`, and `--no-apply`.

## Current Limits

- The AI Panel is legacy and opt-in.
- It should not be treated as the source of truth for provider-complete fallback ranking.
- Its output is normalized by `completeAiRecommendations()`, but the apply path still performs its own filtering in `applyCloudAssignments()`.
- It may not use upstream oh-my-opencode TypeScript model requirement files as directly as the deterministic rule matcher.

## Required Protection Before Refactor

Before removing or rewriting AI Panel code, add or retain tests for:

- `selectPanelRecommendation`
- `runPanelByTier`
- `runPanelAndSelect`
- `selectPreferredPanelModels`
- `selectDiversePanelModels`
- CLI behavior with `--ai-panel`
- CLI behavior without `--ai-panel`, proving deterministic mode remains default

## Cleanup Rule

AI Panel files are not dead code while `--ai-panel` remains documented, parsed, reachable, and covered by tests. They may be simplified only after a replacement path has equivalent coverage and an explicit deprecation/removal decision.
