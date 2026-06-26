# Task 1 Fix Gate Review

recommendation: REJECT

blockers:
- `test/omo-recommend-models.test.js:299` still defines `normalizes Ollama recommendations to local model refs with startup progress` without `gpu` in `createHarness(...)`, while asserting `local/tinyllama:1.1b` appears. With no fake `nvidia-smi`, usable VRAM is 0 by the plan, so this test still contradicts the no-GPU policy.
- `.omo/evidence/task-1-fix-doneclaim.json` claims fake GPU VRAM was added to the canonical local fallback fixture, but the current file does not contain that edit.

originalIntent:
- Stabilize the executable test harness and add failing coverage for strict VRAM eligibility, stale cache rejection, no-GPU local rejection, unknown-VRAM rejection, canonical local output, no local routing, panel label/JSONC preview, validator CLI behavior, and rollback integration.
- The focused fix was meant to remove a previously reported contradictory no-GPU test that expected a local fallback.

desiredOutcome:
- Focused baseline test exits 0.
- Full Task 1 RED suite exits nonzero for intended production gaps, not contradictory harness assumptions.
- Task 1 tests contain meaningful failing coverage and production files are not edited by the focused test-only fix.

userOutcomeReview:
- Stored and live baseline evidence exits 0 for `AI panel runs recommendation models in pure text mode`.
- Stored and live full-suite evidence exits nonzero with eight failures for production gaps.
- The user-visible expectation that the no-GPU contradiction was fixed is not met: the normalization test still expects a local model with no fake GPU.

checkedArtifactPaths:
- `.omo/plans/vram-safe-model-validation.md`
- `.omo/evidence/task-1-fix-doneclaim.json`
- `.omo/evidence/task-1-fix-baseline.txt`
- `.omo/evidence/task-1-fix-red-vram-safe-model-validation.txt`
- `test/omo-recommend-models.test.js`
- `bin/omo-recommend-models`
- `lib/omo-shared.js`

exactEvidenceGaps:
- Git cannot prove production files were untouched because the repository has no tracked baseline and all repo files are untracked. File mtimes show `bin/omo-recommend-models` and `lib/omo-shared.js` predate the focused test/evidence files, but that is weaker than a diff against tracked history.
- The validator malformed-input assertions exist in the test file, but the current RED run aborts earlier on missing `bin/omo-validate-config`, so malformed-input behavior is not independently observed in current output.

directSlopAndProgrammingPass:
- remove-ai-slops check: unresolved test slop remains. The passing normalization test gives false confidence by validating local fallback output under no-GPU conditions, which conflicts with the plan's eligibility rule.
- programming check: test shape uses observable CLI output and temp homes, but the contradictory fixture violates TDD accuracy because it encodes behavior that should become invalid under the requested production rules.

liveCommands:
- `timeout 20s node --test --test-name-pattern "AI panel runs recommendation models in pure text mode"` exited 0.
- `timeout 20s node --test --test-name-pattern "normalizes Ollama recommendations to local model refs with startup progress"` exited 0, confirming the contradictory test still passes.
- `timeout 30s node --test` exited 1 with 10 tests, 2 pass, 8 fail, matching the stored RED shape.
