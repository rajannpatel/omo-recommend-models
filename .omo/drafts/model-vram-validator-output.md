# model-vram-validator-output draft

status: awaiting-approval
created: 2026-06-26T04:22:14Z
intent: CLEAR
classification: Standard
tier: LIGHT

## Objective
Create a decision-complete work plan for:

- Preventing AI/local completion logic from recommending or applying any local model whose estimated VRAM exceeds available GPU VRAM after the existing safety buffer.
- Renaming the panel picker heading from `Available opencode models (N):` to `agent-model recommendations from:`.
- Recreating `omo-validate-config` so applied `oh-my-openagent.jsonc` output is validated against opencode plus OMO schema requirements.
- Improving recommendation presentation by showing JSONC-style proposed configuration changes with comments instead of the current scattered `model`, `recommended`, and `fallback_models` lines.

## Skill Survey
- omo:ulw-plan: required by explicit user request; planner only, no product code edits before approval.
- omo:programming: relevant for later JavaScript/CommonJS implementation and tests, but not loaded for this planning-only phase.
- omo:debugging: not active; this is planning around known behavior, not a runtime debugging request.
- omo:git-master: not active; no commit requested.

## Route And Tier
- Intent route: CLEAR. The desired outcomes are concrete; the only owner-visible fork is output presentation shape.
- Classify: Standard. Expected changes touch the CLI executable, shared validation helpers, and tests, but stay within the existing Node CLI layer.
- Ultrawork tier: LIGHT. No new domain layer, DB, auth, external service integration, or cross-boundary refactor is required; behavior is CLI/data-shaped.

## Components Ledger
- C1 VRAM eligibility: A local model is eligible only if its normalized catalog entry exists and `model.vram <= usableVramGb`, where usable VRAM is the detected GPU VRAM minus the existing 1.5 GB buffer. Status: grounded. Evidence: `bin/omo-recommend-models:981`, `bin/omo-recommend-models:1308`, `bin/omo-recommend-models:1337`, `bin/omo-recommend-models:1348`, `bin/omo-recommend-models:1381`.
- C2 Recommendation completion/apply safety: Local model refs can be injected after AI voting by `completeAiRecommendations`, then written by the apply path and `applyLocalPlacements`; both must enforce the same fitting set, not only the prompt. Status: grounded. Evidence: `bin/omo-recommend-models:1381`, `bin/omo-recommend-models:1516`, `bin/omo-recommend-models:1970`.
- C3 CLI presentation: Panel picker text lives in `pickPanelModels`; recommendation presentation currently prints line-oriented `model`, `recommended`, and `fallback_models` blocks in `showCloudRecommendations` and local sections in `showLocalDecisions`. Status: grounded. Evidence: `bin/omo-recommend-models:575`, `bin/omo-recommend-models:631`, `bin/omo-recommend-models:1096`.
- C4 Config validation: Apply paths already shell out to `omo-validate-config --fix`, but no executable exists in this repo; shared JSONC parser and upstream schema URL are available in `lib/omo-shared.js`. Status: grounded. Evidence: `bin/omo-recommend-models:1827`, `bin/omo-recommend-models:2009`, `lib/omo-shared.js:237`, `lib/omo-shared.js:283`.
- C5 Test surface: Existing `node:test` harness drives the real CLI with fake `opencode` and `ollama`; it can cover RED->GREEN for prompt filtering, completion filtering, output labels, JSONC preview, and validator CLI. Status: grounded. Evidence: `test/omo-recommend-models.test.js:1`.

## Findings
- The prompt filters locals with `allLocalModels.filter((m) => m.vram <= vramAvail)` at `bin/omo-recommend-models:1037`, but later completion can still choose `bestLocalModel(allLocalModels, ollama)` from the unfiltered full catalog at `bin/omo-recommend-models:1337` and `bin/omo-recommend-models:1361`.
- `completeAiRecommendations` accepts AI-supplied local decisions/placements after normalization without rejecting oversized models, so a model that never appeared in the prompt can still be injected into `fallback_models`.
- `applyLocalPlacements` chooses the highest-scored local placement without checking VRAM fit, so apply-time safety depends on earlier code behaving perfectly.
- `pickPanelModels` prints the exact heading the user wants replaced: `Available opencode models (${all.length}):`.
- Upstream schema at `https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/oh-my-opencode.schema.json` uses draft-07 shape and allows `model` as string plus `fallback_models` as string, array of strings, or array of objects with required `model`; section objects generally use `additionalProperties: false`.
- Pre-existing test status before product edits: `node --test` currently fails `AI panel runs recommendation models in pure text mode` because the fake home lacks `.cache/oh-my-opencode/provider-models.json`; the second test passes.

## Recommended Approach
- Add one shared usable-VRAM helper and one local-model eligibility helper inside `bin/omo-recommend-models`, then thread the already-filtered local catalog through prompt building, completion fallback selection, AI decision/placement normalization, display, install/apply, and orphan cleanup.
- Treat "oversized by even a little" as strict numeric rejection: no epsilon, no rounding-to-fit. Display can round for humans, but eligibility compares raw numeric `vram` against raw usable VRAM.
- Reject unknown local model names unless they match a normalized installed/catalog entry that also fits; this prevents AI hallucinations from becoming install/apply refs.
- Recreate `bin/omo-validate-config` as an executable CommonJS CLI using existing `jsoncParse`, local schema validation for the schema surface used here, provider/model reference checks against cached provider models and installed/fitting locals where available, and `--fix` normalization for safe mechanical repairs such as converting object fallback refs to strings only if the target schema accepts both.
- Add focused `node:test` coverage before implementation: failing tests for oversized local prompt omission, oversized AI placement rejection, no oversized apply refs, panel heading copy, JSONC preview output, validator success/failure, and the existing provider cache fixture failure.
- Change dry-run/apply preview to a JSONC patch-style preview per agent/category, with comments for removed current values and added proposed values, while preserving recommendation order semantics: `model` first, then `routing`, then `fallback_models`.

## Owner-visible Presentation Default
Recommended default for the plan: implement JSONC-style proposed config blocks in dry-run/analysis output, e.g.:

```jsonc
// agents.sisyphus
{
  // remove: "model": "old/provider-model"
  "model": "openai/gpt-5.5",
  "fallback_models": [
    "opencode/nemotron-3-ultra-free",
    "local/tinyllama:1.1b" // fits usable VRAM: 0.2 <= 6.5 GB
  ]
}
```

Must not emit `fallback_modules`; the actual key is `fallback_models`. If preserving the typo in a regression fixture is needed, it should appear only as a negative assertion.

## Verification Plan Sketch
- Failing-first: add node:test cases and capture initial RED for each behavior before production changes.
- Unit/data QA: run `node --test`.
- Real CLI QA: run `NODE_PATH=$PWD node ./bin/omo-recommend-models --dry-run --local-only` against a temp `HOME`, fake `opencode`, fake `ollama`, and cached local catalog containing one fitting and one oversized model; PASS if stdout contains no oversized local ref and does contain JSONC preview plus renamed panel heading in the interactive path.
- Validator QA: run `NODE_PATH=$PWD node ./bin/omo-validate-config --config <temp-jsonc>` for a valid fixture and for an invalid fixture; PASS if valid exits 0 and invalid exits nonzero with a field path.

## Approval Gate
Pending action after approval: run `node /home/ubuntu/.codex/plugins/cache/sisyphuslabs/omo/4.13.0/skills/ulw-plan/scripts/scaffold-plan.mjs model-vram-validator-output --clear`, then append the decision-complete todos to `.omo/plans/model-vram-validator-output.md`.

Approval needed: approve the recommended JSONC-style presentation default above, or specify a different CLI preview format before the plan is written.
