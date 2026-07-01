# Wave 1 Reachability Report

Generated during Wave 1 planning for the `omo-recommend-models` cleanup and recommendation overhaul. This report is evidence only: it does not authorize deletion by itself. Cleanup must wait until recommendation behavior is covered by tests and the AI Panel contract is locked.

## Scope

- Static reachability across CLI entrypoints, recommendation execution, finalization, display/apply, panel modules, tests, and docs.
- Cleanup candidates are classified as `SAFE`, `REVIEW`, or `KEEP`.
- The hard invariant is preserved: `npx omo-recommend-models` must keep working without a local `node_modules` directory or an implicit install step.

## Current Entry Points

`package.json` exposes two bins:

- `omo-recommend-models` -> `./bin/omo-recommend-models`
- `omo-validate-config` -> `./bin/omo-validate-config`

`package.json` includes only `eslint` as a dev dependency. The package surface is intentionally small: published files are `bin/omo-recommend-models`, `bin/omo-validate-config`, `lib`, and `README.md`.

`test/unit/package-contract.test.js` already locks the bin shims, export map, CLI version, schema branch, and package self-reference import. Treat this test as `KEEP` because it protects the zero-install/npx contract.

## Recommendation Paths

### Deterministic Default Path: KEEP

Evidence:

- `lib/cli/recommend-execution.js::selectRecommendation` uses `createRuleBasedRecommendations()` when `!runOptions.useAiPanel`.
- `lib/cli/recommend-inputs.js::buildRunOptions` derives `useAiPanel` from the parsed `--ai-panel` flag.
- Non-TTY execution without explicit `--yes` falls back to dry-run behavior.

Decision: `KEEP`. This is the primary path the user identified as working: `npx omo-recommend-models` without local dependencies or `node_modules`.

### Legacy AI Panel Path: KEEP FOR NOW

Evidence:

- `--ai-panel` is parsed in `lib/cli-options.js` and documented in CLI usage.
- Reachable path: `selectPanel()` -> `selectPanelRecommendation()` -> `runPanelAndSelect()` -> `completeAiRecommendations()`.
- Reachable modules include `lib/recommend/panel-selection.js`, `lib/recommend/panel-selection/*`, `lib/recommend/panel-core/*`, `lib/recommend/panel-candidates.js`, `lib/recommend/cli-agents/*`, and `lib/consensus.js`.
- `test/omo-recommend-models.test.js` intentionally exercises panel behavior; the harness adds `--ai-panel` by default unless `--rules-default` is present.

Decision: `KEEP FOR NOW`. Do not delete or fold panel modules into cleanup until the behavior contract in `docs/ai-panel-contract.md` is acted on and tests are adjusted.

## Output vs Apply Parity

Classification: `REVIEW`

Evidence:

- `lib/recommend/recommendation-finalizer.js::completeAiRecommendations` normalizes recommendations, applies `isProviderAllowed` and `isModelAllowed`, adds cloud/local fallbacks, and leaves normalized `routing` on recommendations.
- `lib/recommend/apply-recommendations.js::applyCloudAssignments` separately filters provider/local/free refs, writes `section.model` and `section.fallback_models`, and deletes `section.routing`.
- This means terminal output/dry-run and applied JSONC can diverge if they do not consume the same finalized artifact.

Decision: `REVIEW`. This is not dead code. It is an architectural risk to address in later waves by creating one finalized recommendation artifact consumed by both display and apply.

## Tests

### KEEP

These tests cover reachable behavior and should not be removed during cleanup:

- `test/omo-recommend-models.test.js`
- `test/unit/cli-options.test.js`
- `test/unit/recommend-execution.test.js`
- `test/unit/rules-assignment.test.js`
- `test/unit/recommendation-finalizer.test.js`
- `test/unit/consensus.test.js`
- `test/unit/panel-core.test.js`
- `test/unit/cli-agents.test.js`
- `test/unit/paid-provider-prep.test.js`
- `test/unit/display-progress.test.js`
- `test/unit/apply-recommendations.test.js`
- `test/unit/package-contract.test.js`

### REVIEW: Weak or Missing Direct Coverage

The following reachable symbols need direct tests before refactor or cleanup:

- `selectPreferredPanelModels`
- `selectDiversePanelModels`
- `panelModelsRequireOpencode`
- `selectPanelRecommendation`
- `runPanelByTier`
- `runPanelAndSelect`
- `defaultPanelModels`
- `finalizeRecommendation`
- `bestCloudRecommendationForProvider`
- `probeModel`
- `finalizeEntryRecommendation`

Decision: `REVIEW`. Add focused tests in later waves; do not delete these symbols solely because direct coverage is weak.

## Documentation

### KEEP / UPDATE

- `README.md` is published in the package and reflects the current deterministic default plus opt-in `--ai-panel` mode. Keep it, but update later if the recommendation pipeline changes.

### REVIEW: Stale Superpowers Docs

Only two Markdown files currently exist under `docs/`:

- `docs/superpowers/specs/2026-06-27-npx-esm-modernization-design.md`
- `docs/superpowers/plans/2026-06-27-npx-esm-modernization-plan.md`

They reference obsolete implementation details such as `lib/recommend/core.js`, `lib/recommend/ai.js`, `mri`, `@clack/prompts`, v1.0.0 tarballs, and old npx examples.

Decision: `REVIEW`. These are stale historical planning artifacts. They are candidates for deletion or archival after Wave 1 is reviewed, but should not be updated as source-of-truth docs.

## Cleanup Candidate Summary

| Area | Classification | Action |
| --- | --- | --- |
| Deterministic rule path | KEEP | Preserve and test before recommendation changes. |
| AI Panel modules | KEEP FOR NOW | Keep gated under `--ai-panel`; decide separately. |
| Output/apply duplicate filtering | REVIEW | Refactor later into one finalized artifact. |
| Package bin/export contract tests | KEEP | Protect npx/no-node_modules invariant. |
| Stale superpowers docs | REVIEW | Delete or archive after review. |
| Weakly covered reachable symbols | REVIEW | Add tests before refactor or deletion. |

## Next Gates

1. Complete the AI Panel contract decision.
2. Add model-level gating tests before changing provider probing.
3. Add output/apply parity tests before unifying display and JSONC mutation.
4. Only then perform dead-code and stale-doc cleanup.
