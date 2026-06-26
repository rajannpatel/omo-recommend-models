# vram-safe-model-validation - Work Plan

## TL;DR (For humans)
**What you'll get:** Local models will only be suggested or written when they have a numeric VRAM estimate that fits currently available GPU VRAM. The recommendation preview will show JSONC-style proposed config blocks using `fallback_models`, and the missing config validator will be restored.

**Why this approach:** The current prompt already tries to filter locals, but later completion and apply paths can put oversized models back. The plan makes one strict eligibility rule and applies it everywhere recommendations enter or leave the system, then proves the result through the real CLI and validator commands.

**What it will NOT do:** It will not add packages or network schema fetching. It will not write comments into the actual config. It will not use `fallback_modules`, and it will not place local models in routing.

**Effort:** Medium
**Risk:** Medium - the config validator contract and apply rollback paths affect real user config writes.
**Decisions to sanity-check:** No detected GPU means no local model is eligible; unknown/non-numeric VRAM is ineligible; validator fixes are safe/mechanical only.

Your next move: start work from this plan, or run a high-accuracy plan review first. Full execution detail follows below.

---

> TL;DR (machine): Medium effort, medium risk; enforce strict local VRAM eligibility end-to-end, add JSONC preview/label fixes, recreate built-in Node validator, and verify through node:test plus real CLI/validator surfaces.

## Scope
### Must have
- Reuse/fix `buildFittingModels` in `bin/omo-recommend-models` as the single local-model eligibility rule instead of adding a competing VRAM calculation.
- A local catalog entry is eligible only when `Number.isFinite(model.vram)`, `model.vram >= 0`, and `model.vram <= usableVramGb`.
- `usableVramGb` is `gpu.vramGb - 1.5` when `gpu.hasGpu` is true and finite; otherwise it is `0`. Negative usable VRAM clamps to `0`.
- Input local refs may be `local/<name>`, `ollama/<name>`, or bare catalog/installed names; all config output local refs must be canonical `local/<normalized-name>`.
- Oversized, unknown-VRAM, hallucinated, or no-GPU local models must be absent from `model`, `routing`, `fallback_models`, install decisions, keep decisions, placements, and written config.
- Oversized locals may appear only in explicit skip/rejection/uninstall diagnostics, not in JSONC recommendation blocks or config fields.
- Local models must never be emitted into `routing`; local primary is allowed only for the existing no-cloud/utility behavior when the chosen local is eligible.
- Panel picker heading must be exactly `agent-model recommendations from:` and must not print `Available opencode models`.
- Recommendation display must use approved JSONC-style preview blocks with comments for removes/changes and actual keys `model`, `routing`, and `fallback_models`.
- JSONC comments are preview-only; actual config writes continue through JSON serialization unless an existing write path already preserves comments.
- Recreate `bin/omo-validate-config` as an executable CommonJS CLI using built-in Node APIs only.
- Validator must support default config path and `--config <path>`, `--fix`, `--help`, exit `0` for valid/fixed config, exit nonzero for invalid config, and field-path errors on stderr.
- Validator must validate the local OMO/opencode subset this repo writes: top-level object, `$schema`, `agents`, `categories`, section `model`, `variant`, `routing`, `fallback_models`, fallback object options, provider/model ref syntax, provider/model existence when cache/local facts are available, and no unknown keys inside model placement sections.
- Validator `--fix` may only add missing `$schema`, canonicalize `ollama/` local refs to `local/`, normalize fallback object/string arrays to supported output strings when no option fields would be lost, delete empty `routing`/`fallback_models`, and format JSON. It must create a backup before writing.
- `omo-recommend-models` must invoke the sibling validator path reliably instead of depending on `bin/` being on `PATH`, while direct `bin/omo-validate-config` invocation also works.
- Normal apply and `--rebalance` apply must both roll back config writes on validation failure.
- Existing and new tests must use temp `HOME`, fake `opencode`, fake `ollama`, fake provider-model cache, fake local catalog, and fake GPU/no-GPU command behavior without touching the real user config.

### Must NOT have (guardrails, anti-slop, scope boundaries)
- No npm dependencies, `package.json`, package-lock files, or network schema fetch.
- No product-code edits outside `bin/omo-recommend-models`, `bin/omo-validate-config`, `lib/omo-shared.js`, and `test/omo-recommend-models.test.js` unless a tiny shared helper extraction is forced by imports.
- No `fallback_modules` spelling except a negative test assertion.
- No local model in `routing`.
- No silent destructive validator fixes, no dropping fallback option objects with extra fields, and no removing invalid refs under `--fix`.
- No reliance on grep-only verification; every behavior has a command-driven proof.

## Verification strategy
> Zero human intervention - all verification is agent-executed.
- Test decision: TDD with Node's built-in `node:test`; for each behavior, add or update the test first, capture RED, implement the smallest change, then capture GREEN.
- Unit/integration evidence: `node --test 2>&1 | tee .omo/evidence/node-test-vram-safe-model-validation.txt`
- Real CLI evidence: temp-home command transcripts saved under `.omo/evidence/cli-*.txt`; no command may read or write the real `~/.config/opencode/oh-my-openagent.jsonc`.
- Validator evidence: direct `bin/omo-validate-config` invocations against valid, invalid, and fixable JSONC fixtures saved under `.omo/evidence/validator-*.txt`.
- Human approval is a closure gate only. It is not verification evidence and must not replace any agent-executed QA.

## Execution strategy
### Parallel execution waves
> Target 5-8 todos per wave. Fewer than 3 (except the final) means you under-split.
- Wave 1: Todo 1 only. Stabilize fixtures and capture RED tests so later work has a clean signal.
- Wave 2: Todos 2, 3, and 4 can proceed after Todo 1 because they touch related code but separable behavior. Coordinate edits in `bin/omo-recommend-models`.
- Wave 3: Todo 5 after Todo 1; it can run in parallel with Wave 2 if the executor can avoid conflicts, but final integration depends on apply-path decisions from Todo 3.
- Wave 4: Todo 6 after Todos 2-5. Run end-to-end CLI/validator QA, clean artifacts, and reconcile evidence.

### Dependency matrix
| Todo | Depends on | Blocks | Can parallelize with |
| --- | --- | --- | --- |
| 1 | none | 2, 3, 4, 5, 6 | none |
| 2 | 1 | 3, 6 | 4, 5 |
| 3 | 1, 2 | 6 | 4, 5 |
| 4 | 1 | 6 | 2, 3, 5 |
| 5 | 1 | 6 | 2, 3, 4 |
| 6 | 2, 3, 4, 5 | final verification wave | none |

## Todos
> Implementation + Test = ONE todo. Never separate.
<!-- APPEND TASK BATCHES BELOW THIS LINE WITH edit/apply_patch - never rewrite the headers above. -->
- [x] 1. Stabilize the executable test harness and add failing coverage for the requested behaviors
  What to do / Must NOT do: Add reusable test helpers in `test/omo-recommend-models.test.js` for temp home setup, fake provider cache, fake local model catalog, fake `opencode`, fake `ollama`, fake GPU/no-GPU behavior, config writes, CLI execution, and validator execution. Fix the existing first test by writing `.cache/oh-my-opencode/provider-models.json` before it runs. Add tests that initially fail for strict VRAM rejection, stale panel cache rejection, no-GPU local rejection, unknown-VRAM rejection, canonical `local/` output, no local `routing`, panel label text, JSONC preview blocks, validator direct CLI behavior, and validator rollback integration. Do not weaken or skip the existing tests.
  Parallelization: Wave 1 | Blocked by: none | Blocks: 2, 3, 4, 5, 6
  References (executor has NO interview context - be exhaustive): `test/omo-recommend-models.test.js:24-64`, `test/omo-recommend-models.test.js:67-83`, `test/omo-recommend-models.test.js:86-101`, `test/omo-recommend-models.test.js:104-141`, `test/omo-recommend-models.test.js:143-194`, `bin/omo-recommend-models:1831-1867`, `bin/omo-recommend-models:1875-1903`, `.omo/drafts/vram-safe-model-validation.md`
  Acceptance criteria (agent-executable): After adding tests but before production fixes, `mkdir -p .omo/evidence && node --test 2>&1 | tee .omo/evidence/task-1-red-vram-safe-model-validation.txt` exits nonzero and the output names the new failing behaviors. After adding only fixture corrections that are prerequisite to meaningful failures, the pre-existing `AI panel runs recommendation models in pure text mode` failure is gone or replaced by the intended new RED tests.
  QA scenarios (name the exact tool + invocation): failure: `node --test 2>&1 | tee .omo/evidence/task-1-red-vram-safe-model-validation.txt` must fail for new behavior assertions, not missing cache setup. happy: after later todos, `node --test 2>&1 | tee .omo/evidence/task-1-green-vram-safe-model-validation.txt` must exit 0.
  Commit: Y | `test(harness): add vram and validator regression coverage`

- [ ] 2. Enforce one strict local VRAM eligibility rule through prompt, completion, cache, and local decisions
  What to do / Must NOT do: Reuse and fix `buildFittingModels` so it computes usable VRAM once with the adopted policy: finite GPU VRAM minus 1.5 GB buffer, clamped at 0; no GPU or invalid GPU VRAM means 0; only finite nonnegative model VRAM can fit. Add normalization/lookup helpers as needed so `local/`, `ollama/`, and bare local names resolve to canonical catalog names, but output refs are `local/<normalized-name>`. Make `buildAgentPrompt`, `bestLocalModel`, `localModelForEntry`, `ensureLocalDecision`, and `completeAiRecommendations` use the same eligible set. Sanitize AI and cached local `model`, `routing`, `fallback_models`, decisions, and placements; reject unknown, oversized, and unknown-VRAM locals before they reach display or apply. Do not create a second VRAM formula.
  Parallelization: Wave 2 | Blocked by: 1 | Blocks: 3, 6
  References (executor has NO interview context - be exhaustive): `bin/omo-recommend-models:981-1070`, `bin/omo-recommend-models:1308-1312`, `bin/omo-recommend-models:1314-1346`, `bin/omo-recommend-models:1348-1363`, `bin/omo-recommend-models:1365-1379`, `bin/omo-recommend-models:1381-1485`, `bin/omo-recommend-models:1871-1903`, `test/omo-recommend-models.test.js:143-194`
  Acceptance criteria (agent-executable): `node --test --test-name-pattern "VRAM|local|cache|no GPU|unknown VRAM" 2>&1 | tee .omo/evidence/task-2-vram-safe-model-validation.txt` exits 0. Assertions must prove no oversized or unknown local ref appears in recommendation JSONC blocks or normalized recommendation data for `model`, `routing`, or `fallback_models`; stale cached AI results are sanitized; no-GPU produces no local recommendation; `ollama/foo` input becomes `local/foo` only when eligible.
  QA scenarios (name the exact tool + invocation): failure: run the same `node --test --test-name-pattern "VRAM|local|cache|no GPU|unknown VRAM"` immediately after RED tests and before implementation; it must fail on oversized/no-GPU/unknown-VRAM assertions. happy: rerun after implementation and save `.omo/evidence/task-2-vram-safe-model-validation.txt`; it must pass and include tests for prompt, completion, and stale cache.
  Commit: Y | `fix(models): enforce strict local vram eligibility`

- [ ] 3. Harden install, apply, local placement, and rollback paths against invalid local refs
  What to do / Must NOT do: Thread the eligible local set into the main apply loop, `applyCloudChanges`, `applyLocalPlacements`, and install/uninstall decision handling. Local refs in `model`, `routing`, and `fallback_models` must be filtered with the same rule before config mutation; local refs must never survive in `routing`; local placement scoring must only compare eligible candidates. Ensure oversized locals cannot be installed or kept as placement candidates, even if already installed. Add rollback handling for the `--rebalance` validation path to match the normal apply rollback behavior. Do not remove invalid cloud refs silently; validator handles those as errors.
  Parallelization: Wave 2 | Blocked by: 1, 2 | Blocks: 6
  References (executor has NO interview context - be exhaustive): `bin/omo-recommend-models:1492-1513`, `bin/omo-recommend-models:1516-1574`, `bin/omo-recommend-models:1585-1659`, `bin/omo-recommend-models:1790-1828`, `bin/omo-recommend-models:1952-2005`, `bin/omo-recommend-models:2006-2030`, `bin/omo-recommend-models:2032-2035`
  Acceptance criteria (agent-executable): `node --test --test-name-pattern "apply|install|routing|rollback|rebalance" 2>&1 | tee .omo/evidence/task-3-vram-safe-model-validation.txt` exits 0. Tests must inspect the written temp config and prove no oversized `local/` or `ollama/` ref exists in `model`, `routing`, or `fallback_models`; `routing` has no local refs at all; oversized installed locals are not installed/kept/placed; failed validator on normal apply and rebalance restores the prior temp config.
  QA scenarios (name the exact tool + invocation): failure: run the targeted test command before implementation and confirm config-write assertions fail. happy: after implementation, run the targeted command and then `node --test 2>&1 | tee .omo/evidence/task-3-full-suite-vram-safe-model-validation.txt`; both must pass.
  Commit: Y | `fix(apply): filter invalid local refs before config writes`

- [ ] 4. Replace recommendation presentation with approved JSONC-style preview and fix the panel picker label
  What to do / Must NOT do: Replace the line-oriented `model`, `recommended`, and `fallback_models` presentation with JSONC-style preview blocks for agent/category changes. Blocks must show section path comments such as `// agents.sisyphus`, comment out removed values with `// remove:`, print proposed `model`, `routing`, and `fallback_models` keys in semantic order, and use only `fallback_models`. Integrate local placement/install decision context without duplicating conflicting sections: local install/uninstall diagnostics may remain list-like, but model placement recommendations must be reflected in the JSONC config preview. Change `pickPanelModels` heading to exactly `agent-model recommendations from:` and ensure `Available opencode models` no longer appears. Do not write JSONC comments to config files.
  Parallelization: Wave 2 | Blocked by: 1 | Blocks: 6
  References (executor has NO interview context - be exhaustive): `bin/omo-recommend-models:575-628`, `bin/omo-recommend-models:631-689`, `bin/omo-recommend-models:1096-1108`, `bin/omo-recommend-models:1861-1867`, `bin/omo-recommend-models:1920-1944`, `task.md:24-63`, user approval "I approve that JSONC-style presentation default, and confirm it is fallback_models."
  Acceptance criteria (agent-executable): `node --test --test-name-pattern "JSONC|panel|fallback_models|preview" 2>&1 | tee .omo/evidence/task-4-vram-safe-model-validation.txt` exits 0. Assertions must prove stdout includes `agent-model recommendations from:`, does not include `Available opencode models`, includes JSONC preview blocks with `// agents.` or `// categories.`, includes `fallback_models`, does not include `fallback_modules`, and the actual written config has no comments.
  QA scenarios (name the exact tool + invocation): failure: targeted tests fail before presentation implementation. happy: run a real interactive-path temp command from the test helper equivalent, without `--dry-run`, without `--local-only`, without `-y`, send newline for default panel and `n` at apply prompt, save stdout to `.omo/evidence/task-4-interactive-panel-vram-safe-model-validation.txt`; PASS if the heading is changed and no config write occurs after declining apply.
  Commit: Y | `feat(output): show jsonc recommendation previews`

- [ ] 5. Recreate `omo-validate-config` and integrate it with existing shellouts
  What to do / Must NOT do: Add executable `bin/omo-validate-config` as a CommonJS CLI. It must parse JSONC using a parser that handles comments, trailing commas, and strings containing `//`; if `lib/omo-shared.js:237-249` cannot safely do that, improve the shared parser with tests. CLI contract: default path is `CONFIG_PATH`; `--config <path>` overrides it; `--fix` writes only safe mechanical fixes after creating a sibling backup; `--help` prints usage; valid config exits 0 with a concise success line on stdout; invalid config exits nonzero with field-path errors on stderr. Validation must cover the local schema subset listed in Scope and provider/model references using `loadProviderModels`, `buildRichModelLookup`, `collectModelRefs`, and installed local facts when available. Integrate `omo-recommend-models` to invoke the sibling validator path with `process.execPath` or an absolute script path so apply works when `bin/` is not on `PATH`. Do not add dependencies or network schema fetches.
  Parallelization: Wave 3 | Blocked by: 1 | Blocks: 6
  References (executor has NO interview context - be exhaustive): `bin/omo-recommend-models:1827`, `bin/omo-recommend-models:2009-2030`, `lib/omo-shared.js:21-34`, `lib/omo-shared.js:237-249`, `lib/omo-shared.js:252-283`, `lib/omo-shared.js:286-347`, `lib/omo-shared.js:350-385`, `lib/omo-shared.js:392-408`, `lib/omo-shared.js:414-430`
  Acceptance criteria (agent-executable): `test -x bin/omo-validate-config`; `node --test --test-name-pattern "validate|jsonc|schema|fix" 2>&1 | tee .omo/evidence/task-5-vram-safe-model-validation.txt` exits 0. Direct commands must pass: `NODE_PATH=$PWD node ./bin/omo-validate-config --help`, `NODE_PATH=$PWD node ./bin/omo-validate-config --config <valid-temp-jsonc>`, invalid fixture exits nonzero with paths like `agents.sisyphus.model`, and `--fix` creates a backup while only applying allowed safe fixes.
  QA scenarios (name the exact tool + invocation): failure: before implementation, `NODE_PATH=$PWD node ./bin/omo-validate-config --help 2>&1 | tee .omo/evidence/task-5-missing-validator-red.txt` must fail because the executable is missing. happy: after implementation, run direct valid, invalid, and fixable fixture commands and save transcripts as `.omo/evidence/task-5-validator-valid.txt`, `.omo/evidence/task-5-validator-invalid.txt`, and `.omo/evidence/task-5-validator-fix.txt`.
  Commit: Y | `feat(validate): restore omo config validator`

- [ ] 6. Drive the integrated CLI through real temp-home surfaces and clean planning artifacts
  What to do / Must NOT do: Run the full suite and real CLI/validator scenarios against temp homes. Verify the normal recommendation dry-run, interactive panel picker decline path, local-only dry-run, normal apply with validator success, normal apply rollback on validator failure, rebalance rollback on validator failure, and direct validator valid/invalid/fix flows. Do not use the real user config. Do not count tests alone as done.
  Parallelization: Wave 4 | Blocked by: 2, 3, 4, 5 | Blocks: final verification wave
  References (executor has NO interview context - be exhaustive): `bin/omo-recommend-models:1750-2035`, `test/omo-recommend-models.test.js:1-194`, `.omo/drafts/vram-safe-model-validation.md`, `.omo/plans/vram-safe-model-validation.md`
  Acceptance criteria (agent-executable): The following all exit with expected status and artifacts: `node --test 2>&1 | tee .omo/evidence/task-6-node-test.txt`; temp-home `NODE_PATH=$PWD PATH="$PWD/bin:$FAKE_BIN:$PATH" node ./bin/omo-recommend-models --dry-run --local-only` transcript contains JSONC preview and no oversized local config refs; interactive panel command without `--dry-run`, `--local-only`, or `-y` shows `agent-model recommendations from:` and exits after declined apply without writing; validator failure scenarios restore config from backup.
  QA scenarios (name the exact tool + invocation): happy: execute the commands above and write `.omo/evidence/task-6-cli-local-only.txt`, `.omo/evidence/task-6-cli-panel-decline.txt`, `.omo/evidence/task-6-apply-rollback.txt`, `.omo/evidence/task-6-rebalance-rollback.txt`. failure: intentionally point `omo-recommend-models` at a temp invalid validator fixture and confirm rollback transcript includes `Validation FAILED` plus restored config checksum.
  Commit: Y | `test(cli): verify vram safe recommendation flow`

## Final verification wave
> Runs in parallel after ALL todos. ALL must APPROVE. Surface results and wait for the user's explicit okay as a closure step, not as verification evidence.
- [ ] F1. Plan compliance audit: read `.omo/plans/vram-safe-model-validation.md` and the final diff; verify every Must have and Must NOT have has direct evidence under `.omo/evidence/`.
- [ ] F2. Code quality review: review changed files for duplicate VRAM formulas, unsafe parser behavior, silent destructive validator fixes, config write risks, and test brittleness.
- [ ] F3. Real manual QA: rerun the temp-home CLI scenarios from Todo 6 and verify transcripts, written config, and backups directly.
- [ ] F4. Scope fidelity: verify no files outside planned scope changed except evidence artifacts and no product code introduces npm/package metadata.

## Commit strategy
- Do not commit unless the user explicitly asks.
- If committing is later requested, use atomic Conventional Commits in this order:
- `test(harness): add vram and validator regression coverage`
- `fix(models): enforce strict local vram eligibility`
- `fix(apply): filter invalid local refs before config writes`
- `feat(output): show jsonc recommendation previews`
- `feat(validate): restore omo config validator`
- `test(cli): verify vram safe recommendation flow`
- Every commit must pass `node --test` before the next commit is made.

## Success criteria
- No local model with `vram > usableVramGb` is present in recommendation preview config blocks, normalized AI result config fields, install/keep/placement decisions, or written config.
- No local model with missing, nonnumeric, infinite, or negative VRAM is recommended or applied.
- No detected GPU means no local model is recommended or applied.
- Local refs are canonicalized to `local/<name>` in config output; `ollama/` and bare names are accepted only as input forms.
- No local model appears in `routing`.
- The panel picker prints `agent-model recommendations from:` and does not print `Available opencode models`.
- Recommendation output uses JSONC-style preview blocks with `fallback_models`, never `fallback_modules`.
- Actual config writes contain no comments.
- `bin/omo-validate-config` exists, is executable, supports default config and `--config`, validates valid JSONC, rejects invalid config with field-path stderr, and safely backs up before `--fix` writes.
- Normal apply and `--rebalance` apply roll back on validator failure.
- `node --test` exits 0.
- Real temp-home CLI and validator QA transcripts exist under `.omo/evidence/` and prove the user-facing surfaces work.
