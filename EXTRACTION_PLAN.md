# Module Extraction Plan: omo-recommend-models

**Generated**: 2026-06-29  
**Source**: Converged hyperplan findings + codebase exploration  
**Main file**: `/project/bin/omo-recommend-models` (2353 lines)  
**Tests**: `/project/test/omo-recommend-models.test.js` (27 tests, node:test + fake binaries)

---

## EXTRACTION ORDER (Dependency-Aware)

### Phase 1: Leaf Modules (Safe, Pure, Zero Panel Coupling)
*Extract in order — each has no dependencies on other extraction candidates*

| Step | Module | Lines in Main | Functions | Risk | Est. Effort |
|------|--------|---------------|-----------|------|-------------|
| 1 | `lib/recommend/panel-candidates.js` | 179–380 (~200) | 15 pure functions | 🟢 LOW | ~30 min |
| 2 | `lib/recommend/ollama-registry.js` | 435–512 (~80) | 5 pure functions | 🟢 LOW | ~20 min |
| 3 | `lib/recommend/hardware-detection.js` | 518–603 (~86) | 2 pure functions | 🟢 LOW | ~20 min |
| 4 | `lib/recommend/cli-agents.js` | 760–984 (~230) | 1 main + 12 helpers | 🟡 MED | ~45 min |
| 5 | `lib/recommend/recommendation-finalizer.js` | 1732–2026 (~295) | 5 pure functions | 🟢 LOW | ~30 min |

### Phase 2: Root Module (Risky, Extract as ONE)
| Step | Module | Lines in Main | Functions | Risk | Est. Effort |
|------|--------|---------------|-----------|------|-------------|
| 6 | `lib/recommend/panel-core.js` | 989–1730 (~740) | 9 core functions | 🔴 HIGH | ~90 min |

---

## DETAILED STEP-BY-STEP

### Step 1: `lib/recommend/panel-candidates.js` 🟢 LOW
**Source lines**: 179–380  
**Functions to move**:
- `isCliProvider` (179–181)
- `cloudModelMeta` (183–192)
- `contextTokenLimit` (194–205)
- `hasEnoughContextForPanel` (207–214)
- `panelCandidateFamily` (216–221)
- `isPanelCandidateUsable` (223–228)
- `hasPanelCandidateShapeAndContext` (230–234)
- `uniqueModelRefs` (236–246)
- `sortedPanelCandidates` (248–277)
- `selectDiversePanelModels` (279–309)
- `filterUsablePanelModels` (311–315)
- `filterPanelModelsForContext` (317–321)
- `isUsableRecommendation` (323–328)
- `isUsableForConfig` (331–335)
- `describeCliPanelModel` (337–341)
- `printCliPanelDisclosure` (343–351)
- `includeDetectedCliPanelModels` (353–360)
- `preferDetectedCliPanelModels` (362–376)
- `selectPreferredPanelModels` (378–380)

**Dependencies**: 
- Imports from `../lib/constants.js` (`LOCAL_PROVIDER`, `MAX_PANEL_MODELS`, `MIN_PANEL_CONTEXT_TOKENS`, `modelRef`, `splitModelRef`)
- Imports from `../lib/omo-shared.js` (`isProviderAvailable`)
- Imports from `../lib/scoring.js` (`scoreModel`, `panelModelOrder`, `sortPanelModelRefs`)
- Imports from `../lib/display-utils.js` (`panelModelFamilyLabel`)
- Uses `ctx` from outer scope (runtime context)

**Main file changes**:
- Add import: `import { ... } from "../lib/recommend/panel-candidates.js";`
- Remove lines 179–380

**Verification gate**:
```bash
npm test  # All 27 tests pass
node ./bin/omo-recommend-models --dry-run --cloud-only  # Manual smoke test
```

---

### Step 2: `lib/recommend/ollama-registry.js` 🟢 LOW
**Source lines**: 435–512  
**Functions to move**:
- `execCurl` (435–437)
- `registryModelSizeGb` (439–456)
- `loadCachedModels` (458–464)
- `saveCachedModels` (466–476)
- `discoverModels` (478–512)

**Dependencies**:
- Imports from `../lib/constants.js` (`MODEL_CACHE_FILE`, `KNOWN_MODELS`, `BASE_VRAM`, `MODEL_SCORES`)
- Uses `subprocess.fetchUrl` from `ctx.subprocess` (injected via closure)
- Uses `createProgress` from `../lib/display-utils.js` (optional progress callback)

**Main file changes**:
- Add import: `import { ... } from "../lib/recommend/ollama-registry.js";`
- Remove lines 435–512

**Verification gate**:
```bash
npm test
node ./bin/omo-recommend-models --dry-run --local-only  # Exercises local discovery
```

---

### Step 3: `lib/recommend/hardware-detection.js` 🟢 LOW
**Source lines**: 518–603  
**Functions to move**:
- `detectGPU` (518–559)
- `detectOllama` (561–603)

**Dependencies**:
- Uses `commandExists` (defined at line 160–173 in main file) — **needs to be moved or passed in**
- Uses `execFileSync` from `node:child_process`
- Uses `BASE_VRAM` from constants (indirectly via detectGPU fallback)

**Main file changes**:
- Move `commandExists` helper to this module OR export it from a shared util
- Add import: `import { detectGPU, detectOllama } from "../lib/recommend/hardware-detection.js";`
- Remove lines 518–603

**Verification gate**:
```bash
npm test
node ./bin/omo-recommend-models --dry-run --local-only
```

---

### Step 4: `lib/recommend/cli-agents.js` 🟡 MED
**Source lines**: 760–984  
**Functions to move**:
- `discoverCliModels` (760–984) — main export
- Internal helpers: `isExcludedCliId`, `parseCliJson`, `parseAndValidateCliResponse`, `renderCliCommand`, `inferCliBinary`, `compactCliFailure`, `classifyCliFailure`, `buildCliInvoker`
- `normalizeCliModelLine` (382–386)
- `rankAgyModel` (388–400)
- `resolveAgyPanelModel` (402–423)
- `configuredCliPanelModel` (425–427)

**Dependencies**:
- Imports from `../lib/constants.js` (none directly, but uses `LOCAL_PROVIDER` concept)
- Imports from `../lib/omo-shared.js` (none directly)
- Imports from `../lib/display-utils.js` (`normalizeAgentRec`)
- Uses `ctx` (for `ctx.cachedAgyPanelModel`)
- Uses `subprocess` via `execFileSync`/`execSync`
- Uses `commandExists` helper (line 160–173)
- Uses `compactErrorText` from `../lib/probe-providers.js`
- Uses `normalizeLocalRecommendation` from `../lib/display-utils.js`

**Main file changes**:
- Add import: `import { discoverCliModels, ... } from "../lib/recommend/cli-agents.js";`
- Remove lines 382–427 (cli panel model helpers) and 760–984
- Pass `commandExists`, `ctx`, `compactErrorText`, `normalizeAgentRec` as parameters or module-level config

**Verification gate**:
```bash
npm test
node ./bin/omo-recommend-models --dry-run --cloud-only  # Exercises CLI agent discovery
```

---

### Step 5: `lib/recommend/recommendation-finalizer.js` 🟢 LOW
**Source lines**: 1732–2026  
**Functions to move**:
- `bestCloudRecommendationForProvider` (1732–1750)
- `bestLocalModel` (1752–1764)
- `localModelForEntry` (1766–1787)
- `ensureLocalDecision` (1789–1814)
- `completeAiRecommendations` (1816–2026)

**Dependencies**:
- Imports from `../lib/omo-shared.js` (`modelRef`, `splitModelRef`, `hasEnoughContextForPanel`, `isProviderAvailable`)
- Imports from `../lib/constants.js` (`LOCAL_PROVIDER`)
- Imports from `../lib/display-utils.js` (`buildFittingModels`, `buildFittingModelMap`, `resolveFittingLocalName`, `normalizeLocalRecommendation`, `normalizeAgentRec`, `finalizeFallbackModels`, `uniqueByModelRef`, `installedLocalNameSet` from `../lib/apply-local.js`)
- Imports from `../lib/consensus.js` (`finalizeFallbackModels`, `uniqueByModelRef`)

**Main file changes**:
- Add import: `import { ... } from "../lib/recommend/recommendation-finalizer.js";`
- Remove lines 1732–2026

**Verification gate**:
```bash
npm test
node ./bin/omo-recommend-models --dry-run --cloud-only
node ./bin/omo-recommend-models --dry-run --local-only
```

---

### Step 6: `lib/recommend/panel-core.js` 🔴 HIGH
**Source lines**: 989–1730  
**Functions to move**:
- `extractOpencodeText` (1004–1015)
- `callPanelModelAsync` (1017–1081)
- `findCliAgent` (1083–1085)
- `cleanAiResponse` (1096–1113)
- `callModelForAgent` (1120–1211)
- `buildAgentPrompt` (1217–1429)
- `runPool` (1435–1449)
- `pickPanelModels` (1456–1480)
- `runPanelAndSelect` (1488–1730)

**Dependencies** (EXTENSIVE - this is why it's HIGH risk):
- Uses `ctx` (signal, providerAvailability)
- Uses `subprocess.execAsync`
- Uses `os.tmpdir()`
- Imports from `../lib/constants.js` (multiple)
- Imports from `../lib/omo-shared.js` (`discoverFreeModels`, `callOpencodeChat`, `parseAiJson`)
- Imports from `../lib/scoring.js` (`scoreModel`, `hasEnoughContextForPanel`)
- Imports from `../lib/probe-providers.js` (`isProviderAvailable`, `markProviderCreditExhausted`, `markProviderRateLimited`, `parseRetryAfterSeconds`, `compactErrorText`, `probeModel`)
- Imports from `../lib/display-utils.js` (`createProgress`, `usableLocalVramGb`, `buildFittingModels`, `buildFittingModelMap`, `resolveFittingLocalName`, `normalizeAgentRec`, `normalizeLocalRecommendation`, `isUsableForConfig`, `installedLocalNameSet`)
- Imports from `../lib/consensus.js` (`computeConsensus`)
- Uses `cliAgents` from `discoverCliModels`
- Uses `defaultPanelModels` from display-utils
- Uses `filterPanelModelsForContext`, `selectPreferredPanelModels`, `printCliPanelDisclosure` from panel-candidates (Step 1)

**Main file changes**:
- Add import: `import { ... } from "../lib/recommend/panel-core.js";`
- Remove lines 989–1730

**Verification gate**:
```bash
npm test  # CRITICAL - all 27 tests must pass
node ./bin/omo-recommend-models --dry-run --cloud-only  # Full AI panel flow
node ./bin/omo-recommend-models --dry-run --local-only  # Local-only path
node ./bin/omo-recommend-models --rebalance --dry-run --cloud-only  # Rebalance path
```

---

## VERIFICATION GATES (After Each Step)

| Gate | Command | Must Pass |
|------|---------|-----------|
| **Unit Tests** | `npm test` | ✅ All 27 tests pass |
| **Dry-run Cloud** | `node ./bin/omo-recommend-models --dry-run --cloud-only` | ✅ No errors, shows panel models |
| **Dry-run Local** | `node ./bin/omo-recommend-models --dry-run --local-only` | ✅ GPU/Ollama detection works |
| **Rebalance Path** | `node ./bin/omo-recommend-models --rebalance --dry-run --cloud-only` | ✅ Algorithmic path works |
| **Apply Path** | `node ./bin/omo-recommend-models --dry-run --cloud-only --yes` | ✅ Apply logic triggers |

---

## ROLLBACK STRATEGY

### Branching
```bash
# Before starting
git checkout -b extract-modules

# After each step, commit atomically
git add -A
git commit -m "extract: lib/recommend/panel-candidates.js (step 1/6)"
```

### Rollback Commands
```bash
# Quick rollback to last working commit
git reset --hard HEAD~1

# Or full rollback to main
git checkout main
git branch -D extract-modules
```

### Safety Net
- Each step creates a **separate commit** with only the extraction changes
- Tests run after **every commit** before proceeding
- If any step breaks tests → immediate rollback to previous commit

---

## PHASE 2: POST-EXTRACTION FOLLOW-UPS

| Item | Description | Priority |
|------|-------------|----------|
| **CLI wiring separation** | Move argument parsing (`lib/cli-options.js`) and runtime setup (`lib/cli-runtime.js`) out of main; main becomes thin orchestrator | 🔴 HIGH |
| **Typed errors** | Replace `console.error(e.stack)` with typed error classes from `lib/errors.js` | 🟡 MED |
| **Auto-help on no args** | Ensure `omo-recommend-models` (no args) shows help — verify `lib/cli-options.js` handles this | 🟢 LOW |
| **Process exit codes** | Standardize exit codes: 0=success, 1=config error, 2=validation fail, 3=missing deps | 🟡 MED |
| **Fast npx startup** | Audit bundle size; ensure no heavy deps in main path; consider lazy imports for panel-core | 🟢 LOW |
| **Remove `ctx` global** | Pass runtime context explicitly instead of closure capture | 🔴 HIGH |
| **Consolidate display-utils** | Move remaining display helpers from main to `lib/display-utils.js` | 🟢 LOW |

---

## TOTAL ESTIMATED EFFORT

| Phase | Steps | Time |
|-------|-------|------|
| Phase 1 (Leaf) | 5 | ~2.5 hrs |
| Phase 2 (Root) | 1 | ~1.5 hrs |
| Verification/buffer | — | ~1 hr |
| **Total** | **6** | **~5 hrs** |

---

## COMMIT STRATEGY

```bash
# Step 1
git add lib/recommend/panel-candidates.js bin/omo-recommend-models
git commit -m "extract: lib/recommend/panel-candidates.js (panel candidate helpers)

- Move 15 pure functions from bin/omo-recommend-models:179-380
- No side effects, zero panel coupling
- Tests: npm test ✅"

# Step 2
git add lib/recommend/ollama-registry.js bin/omo-recommend-models
git commit -m "extract: lib/recommend/ollama-registry.js (Ollama catalog)

- Move 5 functions from bin/omo-recommend-models:435-512
- Pure registry catalog, no panel coupling
- Tests: npm test ✅"

# ... etc for each step
```

---

## SUCCESS CRITERIA (Final)

- [ ] All 6 modules extracted to `lib/recommend/`
- [ ] `bin/omo-recommend-models` reduced to ~800 lines (orchestration only)
- [ ] All 27 existing tests pass
- [ ] Manual smoke tests pass for all 4 CLI modes
- [ ] No new dependencies added
- [ ] Each extraction in its own atomic commit
- [ ] Phase 2 follow-ups documented as GitHub issues