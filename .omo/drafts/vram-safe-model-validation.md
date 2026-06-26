---
slug: vram-safe-model-validation
status: drafting
intent: clear
pending-action: write .omo/plans/vram-safe-model-validation.md
approach: approved JSONC-style preview blocks, strict VRAM eligibility, built-in Node validator
---

# Draft: vram-safe-model-validation

## Components (topology ledger)
| id | outcome | status | evidence path |
| --- | --- | --- | --- |
| C1 | VRAM eligibility is enforced with one shared rule across prompt, AI completion, stale cache, install decisions, cloud apply, local placements, and config writes. | active | bin/omo-recommend-models:981, bin/omo-recommend-models:1308, bin/omo-recommend-models:1337, bin/omo-recommend-models:1381, bin/omo-recommend-models:1516, bin/omo-recommend-models:1889, bin/omo-recommend-models:1970 |
| C2 | CLI presentation uses the approved JSONC-style preview blocks and the panel picker label reads `agent-model recommendations from:`. | active | bin/omo-recommend-models:575, bin/omo-recommend-models:631, bin/omo-recommend-models:1100, user approval |
| C3 | `bin/omo-validate-config` is recreated with a concrete CLI contract for default path, `--config`, `--fix`, exit codes, field-path errors, and executable-bit use from shellouts. | active | bin/omo-recommend-models:1827, bin/omo-recommend-models:2009, lib/omo-shared.js:237, lib/omo-shared.js:252, lib/omo-shared.js:330, lib/omo-shared.js:350 |
| C4 | Test harness has reusable fake provider cache, fake local catalog, fake GPU/Ollama/opencode fixtures, and RED->GREEN coverage for all changed behavior. | active | test/omo-recommend-models.test.js:24, test/omo-recommend-models.test.js:67, test/omo-recommend-models.test.js:86, test/omo-recommend-models.test.js:104 |
| C5 | Apply and rebalance write paths validate through the recreated validator and roll back on validation failure. | active | bin/omo-recommend-models:1819, bin/omo-recommend-models:1827, bin/omo-recommend-models:1952, bin/omo-recommend-models:2009 |

## Open assumptions (announced defaults)
| assumption | adopted default | rationale | reversible? |
| --- | --- | --- | --- |
| No GPU or failed GPU detection | Usable VRAM is 0 GB for recommendation/apply eligibility; no local model is eligible for `model`, `routing`, `fallback_models`, install, keep, or placement. | User asked that local models never exceed available VRAM; with no detected VRAM, available VRAM is not positive. | yes |
| Unknown/non-finite model VRAM | Ineligible. Reject missing, null, string, NaN, Infinity, or negative `vram` values. | "Even by a little" requires a numeric estimate before allowing a local model. | yes |
| Local ref forms | Accept AI/input forms `local/name`, `ollama/name`, and bare catalog/installed names for normalization; all output config refs must be canonical `local/<normalized-name>`. | Existing tests normalize `ollama/` to `local/`; config should have one stable provider form. | yes |
| Oversized model diagnostics | Oversized locals may appear only in explicit skip/rejection/uninstall diagnostic sections, never in JSONC recommendation blocks or written config fields. | The user prohibited recommendations, not diagnostic explanation. | yes |
| JSONC comments | Comments are preview-only; written config remains JSON via `JSON.stringify` unless existing code is separately changed. | Current write path emits JSON, and the request says "Perhaps print JSONC" for presentation. | yes |
| Validator dependencies | Use only built-in Node/CommonJS. Do not add `package.json`, npm dependencies, or network fetches. | Repo has no package harness; CLI should remain minimal/offline. | yes |
| Validator schema scope | Implement the local OMO/opencode subset this tool writes and validates: top-level object, `$schema`, `agents`, `categories`, `model`, `variant`, `routing`, `fallback_models`, fallback object option fields, provider/model reference syntax, and no unknown section keys inside model placement sections. | Full draft-07 validation would require a dependency; the tool only needs to protect its own output and user config surface. | yes |
| `--fix` mutations | Allowed fixes: add missing `$schema`, canonicalize `ollama/` local refs to `local/`, normalize fallback object/string arrays to supported output strings when no extra option fields would be lost, delete empty `routing`/`fallback_models` arrays, and JSON format. Not allowed: removing invalid models, silently changing cloud provider/model ids, dropping object fallback options, or writing without a backup. | Safe mechanical repair only; destructive corrections must be explicit errors. | yes |

## Findings (cited - path:lines)
- `buildAgentPrompt` computes usable VRAM inline and filters locals only for prompt display at `bin/omo-recommend-models:981-1070`.
- `buildFittingModels` already exists at `bin/omo-recommend-models:1308-1312` and must be fixed/reused instead of duplicating a new helper.
- `bestLocalModel` and `localModelForEntry` can select from unfiltered local catalog data at `bin/omo-recommend-models:1337-1362`.
- `completeAiRecommendations` accepts AI/cached local decisions and placements without rejecting oversized or unknown local refs at `bin/omo-recommend-models:1381-1485`.
- `applyCloudChanges` and the main apply loop map `routing` and `fallback_models` directly into config, so all three recommendation fields need local-ref filtering at `bin/omo-recommend-models:1492-1513` and `bin/omo-recommend-models:1970-1985`.
- `applyLocalPlacements` chooses the highest-scored local model from `allLocalModels` without fit checks at `bin/omo-recommend-models:1516-1574`.
- Cached panel results are re-completed through `completeAiRecommendations` at `bin/omo-recommend-models:1889`, so stale cached oversized refs must be sanitized there too.
- `pickPanelModels` owns the old label at `bin/omo-recommend-models:1100` and is reached only when `!autoYes && !dryRun && !localOnly` at `bin/omo-recommend-models:1861`.
- Current display is line-oriented in `showCloudRecommendations` and `showLocalDecisions` at `bin/omo-recommend-models:575-689`.
- Apply paths shell out to missing `omo-validate-config --fix` at `bin/omo-recommend-models:1827` and `bin/omo-recommend-models:2009`.
- `jsoncParse` is a simple comment/trailing comma parser at `lib/omo-shared.js:237-249`; tests must cover strings containing `//` before relying on it for validation.
- Existing first node:test lacks a fake `.cache/oh-my-opencode/provider-models.json` fixture and fails before new behavior can be trusted at `test/omo-recommend-models.test.js:104-141`.

## Decisions (with rationale)
- Use `.omo/plans/vram-safe-model-validation.md` as the executable plan path. The earlier `.omo/drafts/model-vram-validator-output.md` remains approval evidence only.
- Reuse/fix `buildFittingModels` as the single source of local eligibility. Add helpers around it only for normalization/lookups, not a competing VRAM calculation.
- Apply strict eligibility at every ingress and egress: prompt, AI response normalization, cached response completion, fallback injection, local decisions, display preview, cloud apply loop, `applyLocalPlacements`, install confirmation, and final config write.
- Treat no GPU as 0 usable VRAM and unknown/non-finite local VRAM as ineligible.
- Use canonical `local/<model>` in config output; tolerate `ollama/` and bare names only as input forms.
- Recreate `bin/omo-validate-config` as an executable built-in Node CLI with no npm dependencies and no network schema fetch.
- Make validator shellouts robust by invoking the sibling executable path from `omo-recommend-models`, while still allowing `bin/` on `PATH` for direct user calls.
- Use TDD: add failing tests first, capture RED, then implement the smallest code changes and capture GREEN.

## Scope IN
- `bin/omo-recommend-models`
- `bin/omo-validate-config`
- `lib/omo-shared.js` only if parser/model-ref helpers need to be shared safely
- `test/omo-recommend-models.test.js`
- `.omo/plans/vram-safe-model-validation.md`

## Scope OUT (Must NOT have)
- No npm dependencies, `package.json`, package manager setup, or network fetch for schema validation.
- No product-code edits outside the listed files unless an existing import/export forces a tiny helper move.
- No local model in `routing`.
- No oversized, unknown-VRAM, or hallucinated local model in `model`, `routing`, `fallback_models`, install/keep decisions, placements, or written config.
- No `fallback_modules` spelling anywhere except a negative test assertion.
- No comments written to the actual config file.
- No silent destructive validator fixes.

## Open questions
None. User approved JSONC-style presentation and confirmed `fallback_models`; remaining ambiguities are resolved by defaults above.

## Approval gate
status: approved
approved-by-user: 2026-06-26, "I approve that JSONC-style presentation default, and confirm it is fallback_models."
