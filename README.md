# 🛠️ omo-recommend-models

A CLI utility for OpenCode + OmO that profiles your hardware and generates a baseline, static configuration file with fallback models enabled by default for each agent. If you are rate limited on a model, or if an AI provider is quota exhausted, the AI model fallback for the oh-my-openagent AI harness in opencode will retry models from other providers automatically. If the automatic retry fails, you can resume without losing context by typing "continue".

<img width="100%" alt="export_10mb" src="https://github.com/user-attachments/assets/5d91cbe3-0967-4293-9d1b-081ee6acbe33" />

> [!TIP]
> This tool generates a *point-in-time snapshot* of model recommendations. It enables dynamic API routing, and will help you navigate real-time API quota rejections when using opencode with oh-my-opencode (OmO). Use this tool to get your initial bearings, or to recalibrate when you add more AI models to opencode, then let OmO handle the actual execution.

## Quick Start

Run the utility in your project directory to evaluate your available providers and preview the default deterministic rule-based recommendation:

```bash
$ npx omo-recommend-models --cloud-only --yes
```

Output (abridged — actual output varies by hardware and provider availability):

```
◇  Verifying availability for 3 cloud provider(s) — this may take ~30s...
◇  Checking GPU: NVIDIA GeForce RTX 3070 Ti Laptop GPU (8 GB VRAM) (0s)
◇  Checking Ollama: 1 installed model(s) (0s)
◇  Loaded: 3 providers (live from `opencode models`) (2s)
✓  Verifying cloud models availability: done 3/3 (30s)
◇  AI ranking 21 agent(s)/category(ies) by model fitness — this may take ~60s...
✓  Ranking models by AI fitness: ranked by opencode/big-pickle 1/1 (75s)

◇  AI Analysis of available providers/models against recommended oh-my-openagent model rule-chains in:
│  • https://github.com/code-yeongyu/oh-my-openagent/blob/dev/packages/model-core/src/agent-model-requirements.ts
│  • https://github.com/code-yeongyu/oh-my-openagent/blob/dev/packages/model-core/src/category-model-requirements.ts
│
│  No available rule-chain models for: hephaestus, oracle, librarian, explore, ... (17 entries)
│
◇  Recommended provider/model configurations for /project/.opencode/oh-my-openagent.jsonc:
│  • agents.sisyphus
│    ◦ model: opencode/big-pickle
│    ◦ fallback_models: opencode/deepseek-v4-flash-free, opencode/north-mini-code-free, opencode/mimo-v2.5-free
│  • agents.oracle
│    ◦ model: opencode/mimo-v2.5-free
│    ◦ fallback_models: opencode/deepseek-v4-flash-free, opencode/north-mini-code-free, opencode/big-pickle
│  • ...(remaining 19 agents and categories follow the same pattern)
│
◇  Choosing to apply will:
│  • Move existing file to: /project/.opencode/oh-my-openagent.jsonc.pre-recommend
│  • Write new file: /project/.opencode/oh-my-openagent.jsonc
│
✓  • Backup saved to /project/.opencode/oh-my-openagent.jsonc.pre-recommend
|  → Validating changes...
|  • Config valid: /project/.opencode/oh-my-openagent.jsonc
✓  • 21 section(s) updated.
|
✓  Done.
```

---

## 🚩 CLI Flags Reference

### Discovery Control

| Flag | Default | Alias | Description |
|------|---------|-------|-------------|
| `--cloud-only` | `false` | `--exclude-local` | Skip GPU detection, Ollama, and all local model discovery. Only cloud providers are considered. |
| `--local-only` | `false` | `--exclude-cloud` | Skip cloud model discovery and API provider checks. Only local/Ollama models are considered. |
| `--exclude-model <ref>` | — | — | Exclude a specific model reference from consideration. Repeatable. Format: `provider` (excludes all models from that provider) or `provider/model` (excludes a single model). |

### Exclusion Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--free-config` | `true` | Compatibility flag. Free models are already included in the JSONC configuration by default. |
| `--no-free-config` | `false` | Negation of `--free-config`. Exclude free models from JSONC configuration. |

### Behavior Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--yes`, `-y` | `false` | Apply all recommendations without interactive confirmation. Required for non-interactive/CI environments to proceed past preview. |
| `--global` | `false` | Write configuration to `~/.config/opencode/oh-my-openagent.jsonc` instead of the local `.opencode/oh-my-openagent.jsonc` in the project directory. |
| `--dry-run` | `false` | Preview all recommendations without writing any changes to the JSONC config file. Default behavior in non-TTY environments unless `--yes` is passed. |
| `--interactive` | `false` | Force interactive prompts even in non-TTY environments (e.g., CI pipelines with user input). |
| `--debug` | `false` | Print full stack traces for errors to aid debugging. |

### Opt-Out Flags (Enabled by Default)

These flags use an **opt-out** pattern — the behavior they control is enabled by default, and passing the flag disables it via the `--no-` prefix.

| Flag | Default | Description |
|------|---------|-------------|
| `--no-install` | `true` (install enabled) | Skip pulling/installing recommended local Ollama models. Useful for preview-only runs or when you manage models separately. |
| `--no-uninstall` | `true` (uninstall enabled) | Skip removing conflicting or superseded local Ollama models. |
| `--no-remove-orphans` | `true` (orphan removal enabled) | Skip pruning Ollama models that the AI never evaluated or recommended. |
| `--no-apply` | `true` (apply enabled) | Do not write any final recommendations to the JSONC config file. Shows what would change without modifying anything. |

### Informational Flags

| Flag | Description |
|------|-------------|
| `-h`, `--help` | Show the usage help text and exit. |
| `-v`, `--version` | Print the installed version and exit. |

### Interactive vs. Non-Interactive Behavior

| Context | Default Behavior | How to Override |
|---------|-----------------|-----------------|
| **TTY terminal** | Prompts for confirmation on installs, uninstalls, and config writes. Auto-yes only if `--yes` passed. | Pass `--yes` to skip all prompts. Pass `--interactive` to force prompts in CI. |
| **Non-TTY / CI** | Dry-run preview only. Shows what would change without writing anything. | Pass `--yes` to auto-apply. Pass individual `--no-*` flags to opt out of specific steps. |

```
── Model Considerations & Exclusions ──
  • Local / Ollama models excluded via --exclude-local
  • Cloud / paid models considered
  • Free models excluded via --no-free-config
  • Free models considered for JSONC configuration
```

---

## 🎯 What this actually does

* **Computed local fit recommendations** 

    Detects your GPU and Ollama catalog, estimates each local model's weight plus KV-cache cost, and recommends only models that fit the active role and the available VRAM budget. Local recommendations are computed from metadata and hardware facts, not a hand-curated static table.
* **Automatic retry and fallback to free and local models** 

    Provides a sensible fallback to the most preferred cloud and local AI models for each oh-my-openagent agent and category. These fallbacks are identified from rules published in the oh-my-openagent project, and from an AI assessment.
* **Initial template generation** 

    Writes a baseline `oh-my-openagent.jsonc` file with valid syntax, canonical `provider/model` references, cloud fallbacks, and local fallbacks when they are confirmed installed or explicitly installed during the run.
* **It configures oh-my-opencode to proceed, despite rate limits or quota exhaustion in preferred AI Providers**
  
    If a provider runs out of credits mid-task, the `fallback_models: []` array is used by OmO with 60 second timeout intervals. 400 (Bad Request), 402 (quota exhaustion) and 429 (too many requests), 503 (service unavailable) and 529 (site is overloaded) errors result in automatic failover at runtime.

---

### Provider probing and state tracking

Before any recommendation is made, the tool probes each discovered AI provider for availability and rate-limit status:

- **State tracking** (`lib/providers/state.js`) — each provider is tracked in a state machine with statuses: `available`, `rate-limited`, `quota-exhausted`, or `error`.
- **Probe logic** (`lib/providers/probe.js`) — each provider's models are tested with lightweight requests, measuring response time and HTTP status.
- **Error classification** (`lib/providers/errors.js`) — 402 (quota) and 429 (rate-limit) responses are identified; `Retry-After` headers are parsed for backoff.
- **Provider-level debarment** — a provider that fails probing is excluded from all recommendation stages for the duration of the run.

Probing runs concurrently across all discovered providers. The results feed into both the deterministic rule-chain matcher and the AI ranking stage, ensuring that unavailable or exhausted providers never appear in the final config.

### Three‑stage matching pipeline

When the upstream rule chain (deterministic lookup) cannot find a match for an entry, the tool falls through a three‑stage pipeline before reaching the AI ranking system:

| Stage | Strategy | Trigger | File |
|-------|----------|---------|------|
| **1 — Deterministic** | Semantic matching against provider model metadata | Always attempted first | `lib/recommend/model-matching.js` (`MATCH_STRATEGIES.DETERMINISTIC`) |
| **2 — Machine‑readable** | Fuzzy/structural matching against model specs | Runs only if Stage 1 finds nothing | `lib/recommend/model-matching.js` (`MATCH_STRATEGIES.MACHINE_READABLE`) |
| **3 — AI stub** | Lightweight in‑process AI matcher | Runs only if Stages 1‑2 find nothing | `lib/ai-matcher.js` via `rules-assignment.js` |

Each stage uses a different `matchModel()` strategy from `lib/recommend/model-matching.js`. The stages are cascading: the first stage that produces matches wins; if all three fail, the entry falls through to the full AI ranking system described below.

---

## 🚦 When should you actually run this?

1. **You just bought a new GPU** 

    and want to know exactly how large of a local model you can cram into your VRAM.
2. **You are starting completely from scratch** 

    and want a quick CLI wizard to generate your first valid JSON config file.
3. **A restructuring of available providers** 

    If there are changes to what AI providers you're using, or your AI providers have added or removed AI models.

---

## How model selection works

`omo-recommend-models` builds a point-in-time recommendation.

* **Cloud inventory**

    The tool loads the cached OpenCode provider model list, scores models by family, release date, context length, reasoning capability, variant, provider prestige, and advertised cost, then keeps a compact candidate list for rule-chain matching.

    For select providers (e.g., OpenRouter), the tool also fetches their **live model catalog** via HTTPS (`https://openrouter.ai/api/v1/models`) to supplement locally cached models. This catalog is fetched at startup and merged into the candidate pool before scoring.
* **Local inventory**

    If local discovery is enabled, the tool checks GPU/VRAM and Ollama, normalizes installed and cached Ollama models into candidate cards, infers each agent/category requirement, and ranks candidates by specialty, context support, estimated memory, parameter count, OpenRouter popularity when available, and installed-state tie-breaks. The fit budget is `gpu.vramGb * 0.90`; the active dynamic path does not subtract the old fixed 1.5 GB margin.

    The local memory estimate is approximate: model weight comes from Ollama manifest layer sizes when available, then catalog metadata, and KV cache is estimated from target context and parameter count. Candidates with unsafe missing metadata are rejected instead of guessed. When no same-specialty local model fits, the CLI prints a hardware deficit warning with practical next steps such as lowering context, installing a smaller model, using `--cloud-only`, or upgrading VRAM.
* **Rate-limit and quota filtering**

    Rate-limited and quota-restricted providers are excluded once detected. If one AI model at a provider responds with a 402 or 429 error, it is excluded from the configuration. Recommendations are sanitized and sorted before being written to the JSONC configuration file.

## How `fallback_models` are determined

By default, the CLI starts from upstream `rules(model-core)` fallback chains. The CLI then:

1. Picks or preserves the primary `model` from the rule chain.
2. Adds cloud `fallback_models` entries from rule chains.
3. Fills in missing cloud providers with each provider's highest-scored model, so a config is not dominated by one provider.
4. Adds at most one computed local fallback for each entry when local discovery finds a fitting candidate for that entry's role.
5. Creates a local `keep` decision for installed picks and an `install` decision for missing picks. Missing local models are not written to config unless installation is confirmed; `--no-install` leaves them out.
6. Deduplicates `fallback_models`, removes anything that duplicates the primary model, and orders local fallbacks last after cloud fallbacks.
7. If no primary model remains but fallbacks exist, promotes the first fallback to `model`.

## How the AI model-fitness ranking works

When the deterministic upstream rule chain cannot find matching models for an entry (agent or category), the tool offloads model selection to an AI ranking process. This happens for entries where no rule-chain candidate survives provider availability filtering or exclusion rules.

### Which models do the ranking

The ranking is performed by **free OpenCode models** — models tagged as free-tier in the OpenCode model catalog (e.g., `opencode/mimo-v2.5-free`, `opencode/deepseek-v4-flash-free`, `opencode/north-mini-code-free`, `opencode/big-pickle`). These are discovered at startup via `opencode models opencode` (positional argument, not `--json --include-free`) and cached in `FREE_MODELS`. If no free models are available, the tool falls back to `opencode/mimo-v2.5-free`.

These free models are queried **only for ranking other models' fitness**. They are not themselves necessarily installed or written as primary models — they serve as impartial judges.

### What information is sent to the AI

For each entry that needs ranking, the tool builds a prompt containing:

- **Agent/category name and type** — e.g., `sisyphus (agent)` or `visual-engineering (category)`.
- **Upstream rule-chain requirements** — extracted from the vendored `AGENT_MODEL_REQUIREMENTS` or `CATEGORY_MODEL_REQUIREMENTS` snapshots (mirrored from `code-yeongyu/oh-my-openagent` `dev` branch). This includes the full prioritized provider/model fallback chain with any variant, `requiresProvider`, or `requiresAnyModel` constraints.
- **Available model pool** — every model that survived provider availability probing, rate-limit filtering, quota checks, and exclusion rules, formatted as `provider/model` strings.

The prompt asks the AI to rank **all** available models from most suitable (1) to least suitable (N) for each entry's role, considering model quality tier, provider reputation, and model-specific strengths. The AI must return a bare JSON object — no explanation or markdown.

### How the ranking is applied

When the AI returns a valid JSON ranking for an entry:

1. Each `provider/model` string in the ranking is fuzzy-matched against the entry's actual model pool using `matchModelRef()`, which tries exact match → case-insensitive match → provider-stripped name match.
2. The matched models are reordered by AI rank position. Models the AI did not rank (unranked or unrecognized refs) are pushed to the end, sorted last.
3. The first ranked model becomes the entry's new `model`; the rest become `fallback_models` in AI order.
4. The entry is tagged with `rec.aiUsedModel` recording which free OpenCode model produced the ranking.

Any model ref the AI outputs that cannot be matched to the actual available pool (e.g., hallucinated provider names) is silently dropped. If the AI returns no valid ranking at all, the entry keeps its heuristic order from `recommendation-finalizer.js`.

### Round-robin concurrency model

All entries that need AI ranking are processed **concurrently**, with one important optimization to distribute load evenly across available free models:

- **Round-robin initial assignment**: entry `i` starts its query with model `models[i % modelCount]`. This spreads the initial ~19 queries uniformly across all available free models rather than hammering the first model with all requests.
- **Retry with rotation**: if a model call fails (timeout, crash, invalid response) for a given entry, the entry advances to `models[(modelStart + 1) % modelCount]`, then `(modelStart + 2)`, and so on, wrapping around until either a model returns a valid ranking or all models are exhausted for that entry.
- **Concurrency ceiling**: because each entry fires one `opencode run` call at a time (sequential retries within each entry's handler), the maximum concurrent `opencode` processes equals the number of entries being ranked. In practice this is ~19 subprocesses, each with a 120-second timeout. There is no batch limit or throttling — the OS process scheduler handles fairness.
- **No per-model retries**: each model is tried exactly once per entry. If it fails, the entry moves to the next model immediately. There is no exponential backoff or retry within the same model. A failure is logged to stderr with the debug label `agentName@provider/model`.
- **Fail-open**: if all models fail for an entry, the entry keeps its original heuristic ordering from the finalization pipeline. The CLI prints a summary of how many entries were ranked and which models were used.

### How the ranking process is exposed to the user

During execution, the CLI prints a live progress line:

```
◇  AI ranking 19 agent(s)/category(ies) by model fitness — processed 12/19
```

Each failed model call appends a diagnostic line to stderr:

```
  ✗ sisyphus@opencode/mimo-v2.5-free — opencode exited with code 1
```

On completion, a summary line shows reachable models and ranking coverage:

```
✓  AI ranking 19: 19/19 ranked (used: opencode/deepseek-v4-flash-free, opencode/north-mini-code-free)
```

or, if all AI calls failed:

```
◇  AI ranking 19: AI unavailable — using heuristic order
```

### AI analysis is additive, not exclusive

The AI ranking **only** runs for entries where the upstream rule chain could not find a match. Entries with a valid rule-chain match (`rec.ruleChainMatched === true`) are printed as skipped and keep their deterministic assignment. The AI ranking thus fills gaps in the rule chain rather than replacing it, ensuring deterministic behavior for well-covered entries and AI-driven selection for uncovered ones.

---

## 🔧 Validating Configuration: `omo-validate-config`

`omo-validate-config` is a companion subcommand that validates an existing `oh-my-openagent.jsonc` file against upstream OpenCode configuration schema requirements.

```bash
npx omo-validate-config
# or pointing to a specific file:
npx omo-validate-config --config /path/to/oh-my-openagent.jsonc
```

### What it checks

- **Provider/model reference syntax** — every `provider/model` string is parsed and validated.
- **Schema compliance** — the config is validated against the oh-my-openagent JSON schema.
- **Required fields** — agents and categories must have valid `model` and optional `fallback_models` arrays.
- **File readability** — the config file must be valid JSONC.

### When to use

- After manually editing `oh-my-openagent.jsonc` to verify correctness before running opencode.
- In CI pipelines to catch config drift before deployment.
- After running `omo-recommend-models` with unexpected results.

### Exit codes

| Code | Meaning |
|------|---------|
| `0` | Config is valid |
| `1` | Config failed validation (details printed to stderr) |

### Validation rollback

When `omo-recommend-models --yes` fails validation after writing a new config (e.g., due to upstream schema changes or corruption during write), the tool automatically restores the **backup** from `.opencode/oh-my-openagent.jsonc.pre-recommend`. This ensures the CLI never leaves a broken config in place.
