# NPX & ES Modules Modernization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Modernize the `omo-recommend-models` CLI tool to support seamless `npx` execution, ES Modules, clean architectural separation of concerns, modern visual prompts/spinners, robust subprocess safety, and signal cleanup.

**Architecture:** Split the monolithic CLI flow into distinct ES module files for CLI execution, AI panel polling, system/Ollama execution, and config modifications. Argument parsing uses `mri` and terminal interactions are driven by `@clack/prompts` with automatic non-TTY dry-run fallbacks.

**Tech Stack:** Node.js (ESM), `@clack/prompts`, `mri`, `picocolors`, `node:test`.

## Global Constraints
*   Node.js version floor: `>=18.0.0`
*   No CommonJS: Strictly use ESM (`import`, `export`, and explicit `.js` import paths).
*   Built-in standard libraries must use `node:` prefix.
*   Subprocess safety: Spawn subprocesses via argument arrays instead of string command lines.
*   Non-TTY fallback: Default to dry-run mode, no changes without explicit `--yes`.
*   Signal handling: Clean up child processes with SIGTERM then SIGKILL (2s wait), and remove specific temp files.
*   Behavior-preservation: Keep routing limits, ordering constraints, cache checks, and validator rollbacks.

---

### Task 1: Package Setup & ES Modules Migration (Phase 1)

**Files:**
*   Create: `package.json`
*   Modify: `lib/omo-shared.js`, `bin/omo-validate-config`, `bin/omo-recommend-models`
*   Test: `test/omo-recommend-models.test.js`

**Interfaces:**
*   Consumes: Original codebase structures.
*   Produces: Working ES Modules project with dependencies installed, executing standard tests successfully.

- [ ] **Step 1: Create `package.json`**
  Create the root `package.json` with the following configuration:
  ```json
  {
    "name": "omo-recommend-models",
    "version": "1.0.0",
    "description": "Consolidated AI-powered model recommendation CLI for OpenCode OMO agent configurations",
    "type": "module",
    "bin": {
      "omo-recommend-models": "./bin/omo-recommend-models"
    },
    "engines": {
      "node": ">=18.0.0"
    },
    "license": "MIT",
    "repository": {
      "type": "git",
      "url": "git+https://github.com/rajannpatel/omo-recommend-models.git"
    },
    "files": [
      "bin",
      "lib"
    ],
    "scripts": {
      "test": "node --test"
    },
    "dependencies": {
      "@clack/prompts": "^0.7.0",
      "mri": "^1.2.0",
      "picocolors": "^1.0.1"
    }
  }
  ```

- [ ] **Step 2: Run npm install**
  Run: `npm install`
  Expected: Dependencies downloaded and `package-lock.json` created.

- [ ] **Step 3: Migrate `lib/omo-shared.js` to ESM**
  Convert the imports and exports of `lib/omo-shared.js` to ES module syntax.
  *   Use `import fs from 'node:fs'` and `import path from 'node:path'` instead of `require`.
  *   Define path variables using `import.meta.url`:
      ```javascript
      import { fileURLToPath } from 'node:url';
      import { dirname } from 'node:path';
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = dirname(__filename);
      ```
  *   Replace `module.exports = { ... }` with standard ESM exports:
      ```javascript
      export {
        confirm,
        promptUser,
        pickFreeModel,
        discoverFreeModels,
        callOpencodeChat,
        callOpencodeChatAsync,
        parseAiJson,
        CONFIG_DIR,
        CONFIG_PATH,
        CACHE_DIR,
        CACHE_PATH,
        BACKUP_PATH,
        jsoncParse,
        loadConfig,
        loadProviderModels,
        buildProviderAliases,
        resolveProvider,
        normalizeLocalModelName,
        formatModelRef,
        buildRichModelLookup,
        collectModelRefs,
        discoverLocalModels,
        applyAiRecommendations
      };
      ```

- [ ] **Step 4: Migrate `bin/omo-validate-config` to ESM**
  Convert imports in `bin/omo-validate-config` to ESM:
  ```javascript
  import fs from 'node:fs';
  import path from 'node:path';
  import { fileURLToPath } from 'node:url';
  import { dirname } from 'node:path';
  import {
    CONFIG_PATH,
    CACHE_DIR,
    jsoncParse,
    loadProviderModels,
    buildProviderAliases,
    resolveProvider,
    buildRichModelLookup,
    discoverLocalModels,
  } from '../lib/omo-shared.js';

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  ```

- [ ] **Step 5: Migrate `bin/omo-recommend-models` to ESM**
  Convert all imports in `bin/omo-recommend-models` to ESM:
  *   Convert `const fs = require("fs");` to `import fs from 'node:fs';`.
  *   Convert `require("../lib/omo-shared")` to `import { ... } from '../lib/omo-shared.js';`.
  *   Define `__dirname` and `__filename` dynamically using `import.meta.url` at the top of the file.

- [ ] **Step 6: Migrate `test/omo-recommend-models.test.js` to ESM**
  Convert test file imports to ESM:
  *   Replace `require` statements with `import assert from 'node:assert/strict';`, `import fs from 'node:fs';`, `import os from 'node:os';`, `import path from 'node:path';`, `import { spawn } from 'node:child_process';`, `import test from 'node:test';`.
  *   Define `__dirname` using `import.meta.url`.

- [ ] **Step 7: Run existing test suite**
  Run: `npm test`
  Expected: All tests pass.

- [ ] **Step 8: Commit Phase 1**
  Run:
  ```bash
  git add package.json package-lock.json lib/omo-shared.js bin/omo-validate-config bin/omo-recommend-models test/omo-recommend-models.test.js
  git commit -m "feat: migrate project structure to ES Modules"
  ```

---

### Task 2: Architectural Decoupling (Phase 2)

**Files:**
*   Create: `lib/recommend/core.js`, `lib/recommend/local.js`, `lib/recommend/ai.js`, `lib/recommend/apply.js`
*   Modify: `bin/omo-recommend-models`, `lib/omo-shared.js`

**Interfaces:**
*   `lib/recommend/core.js`: Exports mathematical scoring (`scoreModel`), group sorting (`sortPanelModelRefs`), rebalancer (`rebalanceConfig`), and prompt builder (`buildAgentPrompt`).
*   `lib/recommend/local.js`: Exports `detectGPU`, `detectOllama`, `discoverModels`, `bestLocalModel`, and Ollama state mutation logic.
*   `lib/recommend/ai.js`: Exports model probing (`probeModel`), consensus execution (`runPanelAndSelect`), and recommendation finalizing (`completeAiRecommendations`).
*   `lib/recommend/apply.js`: Exports `applyConfigChanges` which manages backups, JSONC writes, validation runs, and rollbacks on validation failures.

- [ ] **Step 1: Create `lib/recommend/core.js`**
  Write scoring, sorting, and prompting heuristics:
  *   Move constants: `FAMILY_TIERS`, `PROVIDER_PRESTIGE`, `VARIANT_BONUS`, `KNOWN_MODELS`, `MODEL_SCORES`, `BASE_VRAM`, `QUALITY_TIERS`.
  *   Move functions: `scoreFromCache`, `scoreFromHeuristics`, `scoreModel`, `panelModelOrder`, `sortPanelModelRefs`, `panelModelFamilyLabel`, `groupPanelModelRefs`, `configuredPanelModels`, `defaultPanelModels`, `plannedPanelModels`, `buildAgentPrompt`, `buildTierChains`, `fbToString`, `applyTierChain`, `findModelInCache`, `rebalanceEntry`, `rebalanceConfig`.
  *   Export these variables and functions.

- [ ] **Step 2: Create `lib/recommend/local.js`**
  Write Ollama and GPU inspection helpers:
  *   Move constants: `MODEL_CACHE_FILE`.
  *   Move functions: `usableLocalVramGb`, `buildFittingModels`, `buildFittingModelMap`, `resolveFittingLocalName`, `normalizeLocalRecommendation`, `resultHasRejectedLocal`, `loadCachedModels`, `saveCachedModels`, `discoverModels`, `detectGPU`, `detectOllama`.
  *   Implement CLI uninstallation orphan helper `offerUninstallOrphans` and model installs, decoupled from interactive prompts. Instead of printing/confirming directly, return lists of candidates for formatting in the CLI, or take callbacks.
  *   Export the functions.

- [ ] **Step 3: Create `lib/recommend/ai.js`**
  Write model probing and consensus debate loop:
  *   Move constants: `PANEL_MODEL_TIMEOUT_SECONDS`, `PANEL_FIRST_BYTE_TIMEOUT_SECONDS`, `PANEL_CACHE_FILE`.
  *   Move functions: `loadPanelCache`, `savePanelCache`, `modelListEquals`, `isSubsetList`, `normalizeAgentRec`, `normalizeRecommendation`, `modelRef`, `providerState`, `isProviderAvailable`, `markProviderCreditExhausted`, `markProviderRateLimited`, `probeModel`, `allConfigEntries`, `uniqueByModelRef`, `finalizeFallbackModels`, `execCurl`, `registryModelSizeGb`, `runPanelAndSelect`, `completeAiRecommendations`.
  *   Provide progress update hooks in `runPanelAndSelect` so it can trigger CLI spinner progress callbacks rather than printing directly to console.
  *   Export all functions.

- [ ] **Step 4: Create `lib/recommend/apply.js`**
  Write config write and backup rollback manager:
  *   Add function `backupAndWriteConfig(config, newRecommendations, confirmedModels, isDryRun)`:
      *   Create backup file at `BACKUP_PATH` (`oh-my-openagent.jsonc.pre-rebalance`).
      *   Write updated configuration to `CONFIG_PATH`.
      *   Execute sibling validator `bin/omo-validate-config --fix`.
      *   If validation fails, restore the backup file from `BACKUP_PATH` and throw validation error.
  *   Export `backupAndWriteConfig`.

- [ ] **Step 5: Clean up `lib/omo-shared.js`**
  Strip out CLI prompting, AI calling, and local model commands to keep `omo-shared.js` focused on config loaders and JSONC parser. Keep path resolution functions.

- [ ] **Step 6: Update `bin/omo-recommend-models` to import modules**
  Modify imports at the top of the file to pull from the newly created modular modules under `lib/recommend/`. Ensure `main()` hooks are intact.

- [ ] **Step 7: Run tests to verify logic remains identical**
  Run: `npm test`
  Expected: PASS.

- [ ] **Step 8: Commit Phase 2**
  Run:
  ```bash
  git add lib/recommend bin/omo-recommend-models lib/omo-shared.js
  git commit -m "refactor: decouple CLI shell from core recommendation modules"
  ```

---

### Task 3: Modern CLI UI, Subprocess Safety, and Graceful Signals (Phase 3)

**Files:**
*   Modify: `bin/omo-recommend-models`, `lib/recommend/ai.js`, `lib/recommend/local.js`, `lib/recommend/apply.js`

**Interfaces:**
*   CLI uses `mri` to parse flags.
*   CLI wraps long-running functions using `@clack/prompts` spinners.
*   Bypasses prompts entirely if `--yes` is specified, or runs in dry-run mode in non-TTY environments if `--yes` is omitted.
*   Spawns subprocesses using safe argument arrays.

- [ ] **Step 1: Replace argument parsing with `mri`**
  Modify argument parsing in `bin/omo-recommend-models`'s `main()` function:
  *   Replace processed index loops with `mri` parsing:
      ```javascript
      import mri from 'mri';
      const parsedArgs = mri(process.argv.slice(2), {
        boolean: ['yes', 'rebalance', 'dry-run', 'cloud-only', 'local-only', 'debug', 'interactive'],
        alias: { y: 'yes' },
        default: { yes: false, rebalance: false, 'dry-run': false, 'cloud-only': false, 'local-only': false, debug: false, interactive: false }
      });
      ```
  *   Resolve priority: `--dry-run` always wins over `--yes`.
  *   Verify `--interactive` compatibility: original code defaults to auto-yes if `--interactive` is missing. Preserve this behavior *except* when non-TTY limits apply:
      ```javascript
      const isTTY = process.stdout.isTTY && process.env.TERM !== 'dumb' && process.env.CI !== 'true';
      const autoYes = parsedArgs.yes || (!parsedArgs.interactive && isTTY);
      const isDryRunFallback = !isTTY && !parsedArgs.yes;
      ```

- [ ] **Step 2: Add subprocess safety using argument arrays**
  Refactor all process spawning to use safe argument arrays:
  *   In `lib/recommend/local.js` (Ollama uninstall and installs):
      *   Replace `execSync(\`ollama rm ${m.name}\`)` with `execFileSync('ollama', ['rm', m.name])`.
      *   Replace other `execSync` commands with safe array equivalents.
  *   In `lib/recommend/ai.js`:
      *   Refactor `callPanelModelAsync` to pass command line arguments as an array to `spawn`:
          ```javascript
          const child = spawn("opencode", [
            "run", "--pure", "--agent", "summary",
            "--dir", tempDir, "--format", "json",
            "--model", model, "--dangerously-skip-permissions",
            prompt
          ], { ... });
          ```
      *   Handle custom CLI agents (`panel_cli_agents`):
          *   If `command` is a string: Execute inside shell context (treating as a trusted local shell command).
          *   If `command` is an array: Execute directly using `spawn` with argument array.

- [ ] **Step 3: Integrate `@clack/prompts` and colors**
  Update `bin/omo-recommend-models` to render modern visual UX:
  *   Lazy-load clack prompts using dynamic import:
      ```javascript
      const clack = await import('@clack/prompts');
      ```
  *   Replace text-based spinner animations with Clack's `spinner()` widget.
  *   Use `picocolors` to print output messages.

- [ ] **Step 4: Implement process tracking and graceful signals**
  In `bin/omo-recommend-models`:
  *   Maintain a tracking registry of spawned child processes (`const activeProcesses = new Set()`). Add child process handles during spawning, and delete them on close.
  *   Track created temporary directories/files.
  *   Register signal handlers:
      ```javascript
      function handleExitSignal(signal) {
        // Stop active spinners
        // Clean specific temp files
        for (const child of activeProcesses) {
          child.kill('SIGTERM');
        }
        setTimeout(() => {
          for (const child of activeProcesses) {
            child.kill('SIGKILL');
          }
          process.exit(1);
        }, 2000).unref();
      }
      process.on('SIGINT', () => handleExitSignal('SIGINT'));
      process.on('SIGTERM', () => handleExitSignal('SIGTERM'));
      ```

- [ ] **Step 5: Run tests**
  Run: `npm test`
  Expected: Tests pass successfully.

- [ ] **Step 6: Commit Phase 3**
  Run:
  ```bash
  git add bin/omo-recommend-models lib/recommend/
  git commit -m "feat: modernize argument parsing, CLI widgets, subprocess safety, and signal handlers"
  ```

---

### Task 4: NPM Packaging & Validation (Phase 4)

**Files:**
*   Modify: `package.json`

**Interfaces:**
*   Package includes all source code and executables.
*   Executes cleanly as an NPX package without modifications.

- [ ] **Step 1: Check whitelisted files**
  Run: `npm pack --dry-run`
  Expected: Check that `bin/` and `lib/` files are correctly whitelisted and no redundant directories are included.

- [ ] **Step 2: Pack the package**
  Run: `npm pack`
  Expected: Generates a `.tgz` archive file (e.g. `omo-recommend-models-1.0.0.tgz`).

- [ ] **Step 3: Run packed package via npx**
  Run: `npx -y ./omo-recommend-models-1.0.0.tgz --dry-run --cloud-only --yes`
  Expected: The local packaged package executes successfully, prints its dry-run analysis recommendation, and exits with 0.

- [ ] **Step 4: Verify executable modes**
  Run: `ls -l bin/omo-recommend-models bin/omo-validate-config`
  Expected: The file mode displays `-rwxr-xr-x` (execute permissions set, mode `755`).

- [ ] **Step 5: Commit Phase 4**
  Run:
  ```bash
  git add package.json
  git commit -m "feat: complete package configuration and validation verification steps"
  ```

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-27-npx-esm-modernization-plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach would you like to take?
