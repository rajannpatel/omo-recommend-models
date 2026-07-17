

# 🛠️ omo-recommend-models

A CLI utility for OpenCode + OmO that profiles your hardware and generates a baseline, static configuration file with fallback models enabled by default for each agent. If you are rate limited on a model, or if an AI provider is quota exhausted, the AI model fallback for the oh-my-openagent AI harness in opencode will retry models from other providers automatically. If the automatic retry fails, you can resume without losing context by typing "continue".





https://github.com/user-attachments/assets/cd619621-adc9-4523-a87b-b82fbac71352




> [!TIP]
> This tool generates a *point-in-time snapshot* of model recommendations. It enables dynamic API routing, and will help you navigate real-time API quota rejections when using opencode with oh-my-opencode (OmO). Use this tool to get your initial bearings, or to recalibrate when you add more AI models to opencode, then let OmO handle the actual execution.

## Quick Start

Run the utility in your project directory to evaluate your available cloud providers and apply the default rule-based recommendation, with AI fitness ranking for eligible fallback sets, without interactive confirmation:

```bash
$ npx omo-recommend-models --cloud-only --yes
```

Output (abridged — actual output varies by hardware and provider availability):

```
◇  Checking live provider models...
◇  <P> providers identified in `opencode models` output (2s)
◇  Probing <M> model(s) across AI providers...
✓  Checking GPU: skipped by --cloud-only
✓  Checking Ollama: skipped by --cloud-only
✓  Discovering local model catalog: skipped by --cloud-only
◇  Cloud model verification complete: <M> eligible; <M> probed, <A> available, <F> failed, <C> cached, <S> skipped
◇  AI ranking <M> agent(s)/category(ies) by model fitness — processed 0/<M>
│  → librarian by <zero-cost-provider>/<zero-cost-model>...
│  ✓  processed  librarian by <zero-cost-provider>/<zero-cost-model>
│
◇  AI ranking complete: <ranked>/<M> ranked using
│  • <zero-cost-provider>/<zero-cost-model>

◇  AI Analysis of available providers/models against recommended oh-my-openagent model rule-chains in:
│  • https://github.com/code-yeongyu/oh-my-openagent/blob/dev/packages/model-core/src/agent-model-requirements.ts
│  • https://github.com/code-yeongyu/oh-my-openagent/blob/dev/packages/model-core/src/category-model-requirements.ts
│
│  No available rule-chain models for: hephaestus, oracle, librarian, explore, ...
│
◇  Recommended provider/model configurations for /project/.opencode/oh-my-openagent.jsonc:
│  • agents.sisyphus
│    ◦ model: <provider>/<model>
│    ◦ fallback_models:
│      1. <zero-cost-provider>/<zero-cost-model>
│      2. <paid-provider>/<paid-model>
│  • agents.oracle
│    ◦ model: <zero-cost-provider>/<zero-cost-model-a>
│    ◦ fallback_models:
│      1. <paid-provider>/<paid-model>
│      2. <local-provider>/<local-model>
│  • ...(remaining agents and categories follow the same pattern)
│
◇  Choosing to apply will:
│  • Move existing file to: /project/.opencode/oh-my-openagent.jsonc.pre-recommend
│  • Write new file: /project/.opencode/oh-my-openagent.jsonc
│
✓  • Backup saved to /project/.opencode/oh-my-openagent.jsonc.pre-recommend
|  → Validating changes...
|  • Config valid: /project/.opencode/oh-my-openagent.jsonc
✓  • <N> section(s) updated.
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
| `--free-config` | `false` | Compatibility flag. Zero-cost models are already included in the JSONC configuration unless `--no-free-config` is passed. |
| `--no-free-config` | `false` | Negation of `--free-config`. Exclude models whose `opencode models --verbose` metadata reports zero input and output `cost`, regardless of provider. |

### Behavior Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--yes`, `-y` | `false` | Apply all recommendations without interactive confirmation. Required for non-interactive/CI environments to proceed past preview. |
| `--global` | `false` | Write configuration to `~/.config/opencode/oh-my-openagent.jsonc` instead of the local `.opencode/oh-my-openagent.jsonc` in the project directory. |
| `--dry-run` | `false` | Preview all recommendations without writing any changes to the JSONC config file. Default behavior in non-TTY environments unless `--yes` is passed. |
| `--interactive` | `false` | Force interactive prompts even in non-TTY environments (e.g., CI pipelines with user input). |
| `--agy-analysis` | `false` | Skip zero-cost OpenCode evaluator models and instead use AGY in the CLI terminal to rank eligible non-rule-chain fallback sets. |
| `--codex-analysis` | `false` | Skip zero-cost OpenCode evaluator models and instead use Codex in the CLI terminal to rank eligible non-rule-chain fallback sets. |
| `--debug` | `false` | Print full stack traces for errors to aid debugging. |
| `--verbose` | `false` | Show executed commands and complete subprocess output. |

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
  • Zero-cost models excluded via --no-free-config
  • Zero-cost models considered for JSONC configuration
```

---

## 🎯 What this actually does

* **Computed local fit recommendations** 

    Detects your GPU and Ollama catalog, estimates each local model's weight plus KV-cache cost, and recommends only models that fit the active role and the available VRAM budget. Local recommendations are computed from metadata and hardware facts, not a hand-curated static table.
* **Automatic retry and fallback to zero-cost and local models**

    Provides a sensible fallback to the most preferred cloud and local AI models for each oh-my-openagent agent and category. These fallbacks are identified from rules published in the oh-my-openagent project, and from an AI assessment.
* **Initial template generation** 

    Writes a baseline `oh-my-openagent.jsonc` file with valid syntax, canonical `provider/model` references, cloud fallbacks, and local fallbacks when they are confirmed installed or explicitly installed during the run.
* **It configures oh-my-opencode to proceed, despite rate limits or quota exhaustion in preferred AI Providers**
  
    If a provider runs into a retryable runtime error mid-task, the `fallback_models: []` array is used by OmO with 60 second timeout intervals. 400 (Bad Request), 429 (too many requests), 500, 502, 503, 504, and 529 (site is overloaded) errors result in automatic failover at runtime.

---

### Provider probing and state tracking

Before any recommendation is made, the tool probes each discovered AI provider for availability and rate-limit status:

- **State tracking** (`lib/providers/state.js`) — each provider records whether credits are exhausted, whether it is rate-limited until a future timestamp, and the reason for that state; availability is computed from those fields and the active exclusion options.
- **Probe logic** (`lib/providers/probe.js`) — every eligible model ref advertised by the provider's live `opencode models` output is queued and tested with a lightweight request, measuring response time and HTTP status, subject to the bounded concurrency scheduler described below. There is no "highest-ranked candidate only" shortcut — model-specific failures (unavailable model, guardrail/policy) are scoped to that one ref, while true provider-wide quota exhaustion closes out the rest of that provider's queue immediately.
- **Error classification** (`lib/providers/errors.js`) — 402 (quota) and 429 (rate-limit) responses are identified; `Retry-After` headers are parsed for backoff.
- **Provider and model exclusion** — quota-exhausted or currently rate-limited providers are excluded according to the active exclusion options, while some model-specific probe failures reject only the failing `provider/model` ref.

#### Efficient Probing Architecture & Concurrency Control
- **Single-Call Diagnosis**: Rather than making multiple separate diagnostic calls, the tool makes exactly **one lightweight test call (`say 1`)** to each tested model. We inspect the success status or the resulting error output of this single invocation to gather all reachability, rate limiting, billing quota, and guardrail/data policy restrictions in one go.
- **Bounded Concurrent Execution**: To balance throughput against CPU/memory strain and provider rate limits, provider probes are run with a bounded scheduler (default: up to 6 concurrent `opencode` subprocesses globally, at most 2 concurrent probes per individual paid provider, and at most 1 concurrent probe across free/local/CLI-backed candidates). Availability is rechecked immediately before each dispatch so quota/rate-limit state discovered mid-run is honored without spawning stale subprocesses. A model-scope rate-limited probe result cools its provider down for the remainder of the run (remaining queued refs for that provider are skipped) without invalidating that provider's already-confirmed successes, distinguishing a temporary throttle from full quota exhaustion.
- **Intelligent Short-Circuiting**: If a model probe fails with a true quota-exhausted error (e.g. HTTP 402, billing limit, insufficient funds), non-OpenRouter/non-OpenCode providers are marked credit-exhausted (`quota-exceeded`) and any still-queued candidates from that provider are skipped instantly without spawning new subprocesses. Any probe that started concurrently before the exhaustion was detected has its result invalidated (successes are converted to `provider-quota-exhausted` failures) so a lucky race never leaks through.
- **Model-Specific Resiliency**: Model-specific unavailable-model and policy/guardrail failures are isolated to the failing model. Authorization and quota-like failures can still mark non-OpenRouter/non-OpenCode providers unavailable, while OpenRouter/OpenCode keep those failures scoped more narrowly so other viable models from the provider can still be probed and used.


The results feed into both the deterministic rule-chain matcher and the AI ranking stage, ensuring that unavailable or exhausted providers never appear in the final config.

### Three‑stage matching pipeline

When the upstream rule chain (deterministic lookup) cannot find a match for an entry, the tool falls through a three‑stage pipeline before reaching the AI ranking system:

| Stage | Strategy | Trigger | File |
|-------|----------|---------|------|
| **1 — Deterministic** | Semantic matching against provider model metadata | Always attempted first | `lib/recommend/model-matching.js` (`MATCH_STRATEGIES.DETERMINISTIC`) |
| **2 — Machine‑readable** | Fuzzy/structural matching against model specs | Runs only if Stage 1 finds nothing | `lib/recommend/model-matching.js` (`MATCH_STRATEGIES.MACHINE_READABLE`) |
| **3 — AI stub** | Lightweight in‑process `findClosestMatch()` matcher | Runs only if Stages 1‑2 find nothing | `lib/ai-matcher.js` via `rules-assignment.js` |

Stages 1 and 2 use different `matchModel()` strategies from `lib/recommend/model-matching.js`; Stage 3 calls the in-process AI matcher directly. The stages are cascading: the first stage that produces matches wins; if all three fail, the entry falls through to the full AI ranking system described below.

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

    For OpenRouter, the tool efficiently excludes policy-disallowed models before any slow probe: it fetches the authenticated user-effective model allowlist (`https://openrouter.ai/api/v1/models/user`, requires `OPENROUTER_API_KEY`/`OPENROUTER_BEARER`) and drops OpenRouter refs the account cannot use; it also removes OpenRouter refs already recorded in the persisted policy-exclusion cache from a prior guardrail/policy probe failure. Both exclusions happen before `opencode models --verbose` enrichment and before any `say 1` probe, and the CLI prints how many models were excluded (or that the live allowlist was unavailable and cached exclusions were checked instead) at each step.
* **Local inventory**

    If local discovery is enabled, the tool checks GPU/VRAM and Ollama, normalizes installed and cached Ollama models into candidate cards, infers each agent/category requirement, and ranks candidates by specialty, context support, estimated memory, parameter count, OpenRouter popularity when available, and installed-state tie-breaks. The fit budget is `gpu.vramGb * 0.90`; the active dynamic path does not subtract the old fixed 1.5 GB margin.

    The local memory estimate is approximate: model weight comes from Ollama manifest layer sizes when available, then catalog metadata, and KV cache is estimated from target context and parameter count. Candidates with unsafe missing metadata are rejected instead of guessed. When no same-specialty local model fits, the CLI prints a hardware deficit warning with practical next steps such as lowering context, installing a smaller model, using `--cloud-only`, or upgrading VRAM.
* **Rate-limit and quota filtering**

    Rate-limited and quota-restricted providers are excluded once detected according to provider state and exclusion options. Some probe failures reject only a specific `provider/model` ref; quota and rate-limit classifications can exclude the whole provider, with OpenRouter/OpenCode handled more narrowly. Recommendations are sanitized and sorted before being written to the JSONC configuration file.

## How `fallback_models` are determined

By default, the CLI starts from upstream `rules(model-core)` fallback chains. The CLI then:

1. Picks or preserves the primary `model` from the rule chain.
2. Adds cloud `fallback_models` entries from rule chains, but only when the exact `provider/model` ref survived probing and active exclusion rules.
3. Fills in missing cloud providers with each provider's highest-scored verified model, so a config is not dominated by one provider.
4. Adds at most one computed local fallback for each entry when local discovery finds a fitting candidate for that entry's role.
5. Creates a local `keep` decision for installed picks and an `install` decision for missing picks. Missing local models are not written to config unless installation is confirmed; `--no-install` leaves them out.
6. Deduplicates `fallback_models`, removes anything that duplicates the primary model, keeps at most one non-free and one zero-cost model per provider across `model + fallback_models`, and orders local fallbacks last after cloud fallbacks.
7. If no primary model remains but fallbacks exist, promotes the first fallback to `model`.

## How the AI model-fitness ranking works

When the deterministic upstream rule chain cannot find matching models for an entry (agent or category), the tool offloads model selection to an AI ranking process. This happens only for generated recommendations where no rule-chain candidate survives provider availability filtering or exclusion rules and there is more than one fallback candidate to rank.

### Which models do the ranking

The ranking first tries **zero-cost evaluator models** — models whose cached OpenCode catalog metadata reports `cost.input === 0` and `cost.output === 0` and supports tool calls. The evaluator selector reads local/project model catalog files, then falls back to `opencode models opencode` when needed. If no zero-cost evaluators are available, or if every zero-cost evaluator fails during the run, the CLI falls back to the best available **validated paid** evaluators: paid `provider/model` refs that survived provider probing and active exclusion rules. If neither zero-cost nor validated paid evaluators can rank an entry, the heuristic recommendation order is preserved.

These evaluator models are queried **only for ranking other models' fitness**. They are not themselves necessarily installed or written as primary models — they serve as impartial judges.

> [!NOTE]
> If `--agy-analysis` or `--codex-analysis` is passed, the tool will skip the zero-cost evaluator models entirely and instead invoke the selected local CLI tool (`agy` or `codex` respectively) in the terminal to rank eligible entries: non-rule-chain recommendations with more than one fallback candidate.

### Evaluator Models vs. Target Models (Account Separation)

When utilizing `--agy-analysis` or `--codex-analysis` for model-fitness ranking, it is important to distinguish between the **offline evaluator** and the **runtime target**:

* **The Offline Evaluator:** The models returned by `agy models` (such as `Gemini 3.5 Flash`) run under your local CLI tool environment (e.g., `agy` or `codex`), which uses its own distinct accounts, credentials, and API keys. These models act purely as offline judges to process the ranking prompts.
* **The Runtime Target:** The final configurations written to `.opencode/oh-my-openagent.jsonc` can only specify providers and models that are registered and accessible through the **OpenCode** CLI (such as `google/gemini-3.1-pro-preview` or `google/gemma-4-31b-it`). These utilize your OpenCode environment accounts and credentials. 

Because the `oh-my-openagent` runtime routes its API calls entirely through OpenCode, the tool cannot write `agy` models directly into the configuration.

---

### Why Zero-Cost Models Can Outrank or Exclude Paid Models

During recommendation finalization, you may observe zero-cost models outranking or excluding paid models (like Google or xAI) in the generated `model` and `fallback_models` fields. This happens due to the following design constraints:

#### 1. Deterministic Upstream Rule Chain
The plugin prioritizes a deterministic matching chain defined in [model-requirements.js](lib/recommend/model-requirements.js).
* If an agent/category matches a rule in this upstream chain (indicated by `ruleChainMatched === true`), its primary model selection is kept fixed to match that rule chain deterministically.
* For these rule-chain matched entries, **AI ranking is skipped** to preserve stability for well-defined roles.
* For roles like `sisyphus` (Primary orchestrator), the upstream rule chain may omit a provider family such as `google`, so deterministic assignment follows the next available rule-chain candidate instead of choosing an unrelated higher-tier model.

#### 2. Zero-Cost Fallback Supplementation
To protect against paid API quota exhaustion or rate limits, the tool supplements fallback chains with available zero-cost models when allowed candidates exist.
* Rule-chain recommendations can append zero-cost fallback models through `withMinimumFreeFallbacks` after preserving existing rule-chain and provider fallbacks.
* Finalization also considers allowed zero-cost, tool-call-capable cloud models after missing-provider fallback filling, so unmatched entries receive zero-cost fallback coverage when a verified candidate exists.
* Available paid provider models (such as `xai/grok-4.20-0309-reasoning` or `google` models) can appear before zero-cost models when they are selected by the rule chain or missing-provider fallback logic.

#### 3. Per-Provider Model Limits
For agents/categories where a Google model (like `google/gemini-3.1-pro-preview`) is the primary model:
* The finalizer enforces a strict constraint of **at most one non-free model and one zero-cost model per provider** across the entire recommendation (model + fallbacks combined). This prevents multiple paid slots or a long free-model list from being occupied by the same provider.
* Because the primary model occupies the paid slot for `google`, any other Google model (like `google/gemma-4-31b-it`) is filtered out of `fallback_models`. A separate verified zero-cost Google model could still occupy the provider's zero-cost slot.

#### 4. AI-Ranked Entries Respect Provider Constraints
For entries that do not match the rule chain (like `hephaestus` or `sysadmin`), AI ranking is performed:
* If the agent has strict provider requirements (e.g. `hephaestus` requires providers from `["openai", "github-copilot", "opencode", "vercel"]`), the AI respects this constraint and ranks `google` or `xai` models at the bottom, even if they are higher-quality models generally.
* For the remaining matching providers, zero-cost models with larger context windows are naturally preferred by the AI for task-heavy roles.

---

### What information is sent to the AI

For each entry that needs ranking, the tool builds a prompt containing:

- **Agent/category name and type** — e.g., `sisyphus (agent)` or `visual-engineering (category)`.
- **Upstream rule-chain requirements** — extracted from the vendored `AGENT_MODEL_REQUIREMENTS` or `CATEGORY_MODEL_REQUIREMENTS` snapshots (mirrored from `code-yeongyu/oh-my-openagent` `dev` branch). This includes the full prioritized provider/model fallback chain with any variant, `requiresProvider`, or `requiresAnyModel` constraints.
- **Available model pool** — the finalized candidate subset for that entry: its current `model` plus `fallback_models`, formatted as `provider/model` strings.

The prompt asks the AI to rank that entry's available candidate subset from most suitable (1) to least suitable (N), considering model quality tier, provider reputation, and model-specific strengths. The AI must return a bare JSON object — no explanation or markdown.

### How the ranking is applied

When the AI returns a valid JSON ranking for an entry:

1. Each `provider/model` string in the ranking is fuzzy-matched against the entry's actual model pool using `matchModelRef()`, which tries exact match → case-insensitive match → provider-stripped name match.
2. The matched models are reordered by AI rank position. Models the AI did not rank (unranked or unrecognized refs) are pushed to the end, sorted last.
3. The first ranked model becomes the entry's new `model`; the rest become `fallback_models` in AI order.
4. The entry is tagged with `rec.aiUsedModel` recording which zero-cost evaluator model produced the ranking.

Any model ref the AI outputs that cannot be matched to the actual available pool (e.g., hallucinated provider names) is silently dropped. If the AI returns no valid ranking at all, the entry keeps its heuristic order from `recommendation-finalizer.js`.

### Round-robin concurrency model

Entries that need AI ranking are processed **sequentially**, with one important optimization to rotate evenly across the active evaluator set. Zero-cost evaluators are always tried first; validated paid evaluators become the active set only when no zero-cost evaluator is available or when all zero-cost evaluators fail.

- **Round-robin initial assignment**: entry `i` starts its query with model `models[i % modelCount]`. This spreads ranking requests uniformly across the active evaluator set rather than hammering the first model with all requests.
- **No per-entry model retry loop**: each entry receives the next available evaluator model. If that model fails or returns an invalid ranking, it is blacklisted for the rest of the run; affected recommendations keep their heuristic order after the blacklisted model is removed from primary, fallback, and routing candidates, promoting the next fallback when needed. If the zero-cost evaluator set is exhausted this way, ranking continues with validated paid evaluators.
- **Concurrency ceiling**: AI ranking invokes at most one evaluator subprocess at a time (see [Efficient Probing Architecture & Concurrency Control](#efficient-probing-architecture--concurrency-control) for provider probe concurrency, which uses a separate bounded scheduler).
- **Fail-open**: if both zero-cost and validated paid evaluator models fail, recommendations keep the finalization pipeline's heuristic ordering after blacklisted evaluator refs are filtered out. The CLI prints a summary of how many entries were ranked and which models were used.

### How the ranking process is exposed to the user

During execution, the CLI prints a live progress line:

```
◇  AI ranking <M> agent(s)/category(ies) by model fitness — processed <done>/<M>
```

Each failed model call appends a diagnostic line to the grouped CLI output:

```
│  ✗ librarian by <zero-cost-provider>/<zero-cost-model> — opencode exited with code 1
```

On completion, a summary line shows reachable models and ranking coverage:

```
◇  AI ranking complete: <ranked>/<M> ranked using
│  • <zero-cost-provider>/<zero-cost-model-a>
│  • <zero-cost-provider>/<zero-cost-model-b>
```

or, if all AI calls failed:

```
◇  AI ranking unavailable — using heuristic order
```

### AI analysis is additive, not exclusive

The AI ranking **only** runs for entries where the upstream rule chain could not find a match and there is more than one fallback candidate to rank. Entries with a valid rule-chain match (`rec.ruleChainMatched === true`) keep their deterministic assignment. The AI ranking thus fills gaps in the rule chain rather than replacing it, ensuring deterministic behavior for well-covered entries and AI-driven selection for uncovered ones.

---

## 🔧 Validating Configuration: `omo-validate-config`

`omo-validate-config` is a companion subcommand that validates the local `oh-my-openagent.jsonc` subset written by OMO tooling.

```bash
npx omo-validate-config
# or pointing to a specific file:
npx omo-validate-config --config /path/to/oh-my-openagent.jsonc
# or validating the global config:
npx omo-validate-config --global
```

### Validator Flags

| Flag | Description |
|------|-------------|
| `--config <path>` | Validate a specific JSONC config file. |
| `--global` | Validate `~/.config/opencode/oh-my-openagent.jsonc` instead of the nearest project config. |
| `--fix` | Apply safe mechanical fixes after creating `<path>.bak`. |
| `-h`, `--help` | Show validator usage help and exit. |

### What it checks

- **Provider/model reference syntax** — every `provider/model` string is parsed and validated.
- **Supported schema subset** — the config is checked against the model placement fields this tool writes and validates.
- **Model placement fields** — agents and categories may define a valid `model` and optional `fallback_models` value. `fallback_models` may be a single string or an array of strings/placement objects; placement objects support `model`, `variant`, `reasoningEffort`, `temperature`, `top_p`, `maxTokens`, and `thinking`.
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
| `2` | Argument or usage error before validation |

### Validation rollback

When `omo-recommend-models --yes` fails validation after writing a new config (e.g., due to upstream schema changes or corruption during write), the tool automatically restores the **backup** from `.opencode/oh-my-openagent.jsonc.pre-recommend`. This ensures the CLI never leaves a broken config in place.
