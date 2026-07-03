https://github.com/user-attachments/assets/993c0030-4235-468b-a3c3-4d9d74b15343

# 🛠️ omo-recommend-models

A CLI utility for OpenCode + OmO that profiles your hardware and generates a baseline, static configuration file with fallback models enabled by default for each agent. 

> [!TIP]
> This tool generates a *point-in-time snapshot*. It does not replace dynamic API routing, it will not prevent real-time API quota rejections. Use this tool to get your initial bearings, or to recalibrate when you add more AI models to opencode, then let OmO handle the actual execution.

## Quick Start

Run the utility in your project directory to evaluate your available providers and preview the default deterministic rule-based recommendation:

```
$ npx omo-recommend-models --cloud-only --yes
│
◇  Checking GPU: skipped by --cloud-only
│
◇  Checking Ollama: skipped by --cloud-only
│
◇  Discovering local model catalog: skipped by --cloud-only
│
◇  Loaded: 5 providers from ~/.cache/oh-my-opencode/provider-models.json
│  Filtered against live models (via `opencode models --pure`) to prevent stale entries
│
◇  AI Analysis of available providers/models against recommended oh-my-openagent model rule-chains in:
│  • https://github.com/code-yeongyu/oh-my-openagent/blob/dev/packages/model-core/src/agent-model-requirements.ts
│  • https://github.com/code-yeongyu/oh-my-openagent/blob/dev/packages/model-core/src/category-model-requirements.ts
│
◇  Recommended provider/model configurations for ~/.opencode/oh-my-openagent.jsonc:
│  • agents.sisyphus
│    model: openai/gpt-5.5
│    fallback_models:
│      1. opencode/big-pickle
│      2. opencode/nemotron-3-ultra-free
│
│  → Dry run mode enabled; no changes have been applied.

```

---

## 🚩 CLI Flags Reference

### Discovery Control

| Flag | Default | Alias | Description |
|------|---------|-------|-------------|
| `--cloud-only` | `false` | `--exclude-local` | Skip GPU detection, Ollama, and all local model discovery. Only cloud providers are considered. |
| `--local-only` | `false` | `--exclude-cloud` | Skip cloud model discovery and API provider checks. Only local/Ollama models are considered. |
| `--exclude-model <ref>` | — | — | Exclude a specific model reference from consideration. Repeatable. |

### Exclusion Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--exclude-free` | `false` | Exclude free/open-source models from the final JSONC configuration output. Free models are included by default. |
| `--no-exclude-free` | `false` | Negation of `--exclude-free`. Ensures free models are allowed in the final JSONC configuration. |
| `--free-config` | `false` | Compatibility flag. Free models are already included in the JSONC configuration by default. |
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

### Transparency Logging

When running (even in `--dry-run` mode), the CLI prints a clearly labeled section showing which models, providers, and agents were included or excluded, and which CLI flags caused each exclusion:

```
── Model Considerations & Exclusions ──
  • Local / Ollama models excluded via --exclude-local
  • Cloud / paid models considered
  • Free models excluded via --exclude-free
  • Free models considered for JSONC configuration
```

---

## 🎯 What this actually does

* **Computed local fit recommendations** 

    Detects your GPU and Ollama catalog, estimates each local model's weight plus KV-cache cost, and recommends only models that fit the active role and the available VRAM budget. Local recommendations are computed from metadata and hardware facts, not a hand-curated static table.
* **Cloud cost, context, and availability comparisons** 

    Provides a quick, point-in-time stack-rank of models from AI cloud providers you have authenticated in opencode (via `opencode auth login`), then removes providers that are currently rate-limited, quota-blocked, or otherwise unavailable. Advertised model refs are also probed before assignment; a provider can stay eligible while one unavailable model from that provider is rejected.
* **Initial template generation** 

    Writes a baseline `oh-my-openagent.jsonc` file with valid syntax, canonical `provider/model` references, cloud fallbacks, and local fallbacks when they are confirmed installed or explicitly installed during the run.

---

## 🚫 What this tool can't do, and why you shouldn't overuse it

* **It does NOT handle rate limits or empty quotas over time**
  
    If a provider runs out of credits mid-task, running a CLI tool is the wrong way to fix it. Set up the `fallback_models: []` array natively in OmO, or use a unified router like LiteLLM/OpenRouter to handle 402/429 errors automatically at runtime.
* **It does NOT provide real-time speed benchmarks**
  
    Cloud API latency fluctuates by the minute based on network traffic. The "fastest" provider at 9:00 AM might be the slowest by 9:05 AM. Do not rely on this tool for real-time latency routing.
* **It does NOT evaluate "hallucinations"**
  
    Model intelligence and hallucination rates require massive, standardized evaluation datasets (like MMLU) to quantify. This lightweight CLI cannot programmatically test a model's accuracy. 

---

## 🚦 When should you actually run this?

1. **You just bought a new GPU** 

    and want to know exactly how large of a local model you can cram into your VRAM.
2. **You are starting completely from scratch** 

    and want a quick CLI wizard to generate your first valid JSON config file.
3. **A restructuring of available providers** 

    If there are changes to what AI providers you're using, and need to add or remove models from your configuration.

---

## How model selection works

`omo-recommend-models` builds a point-in-time recommendation. It does not continuously test providers, benchmark latency, or route around live outages. The important parts are:

* **Cloud inventory**

    The tool loads the cached OpenCode provider model list, scores models by family, release date, context length, reasoning capability, variant, provider prestige, and advertised cost, then keeps a compact candidate list for rule-chain matching.
* **Local inventory**

    If local discovery is enabled, the tool checks GPU/VRAM and Ollama, normalizes installed and cached Ollama models into candidate cards, infers each agent/category requirement, and ranks candidates by specialty, context support, estimated memory, parameter count, OpenRouter popularity when available, and installed-state tie-breaks. The fit budget is `gpu.vramGb * 0.90`; the active dynamic path does not subtract the old fixed 1.5 GB margin.

    The local memory estimate is approximate: model weight comes from Ollama manifest layer sizes when available, then catalog metadata, and KV cache is estimated from target context and parameter count. Candidates with unsafe missing metadata are rejected instead of guessed. When no same-specialty local model fits, the CLI prints a hardware deficit warning with practical next steps such as lowering context, installing a smaller model, using `--cloud-only`, or upgrading VRAM.
* **Rate-limit and quota filtering**

    Rate-limited and quota-restricted providers are excluded once detected. The CLI probes configured cloud models before deterministic rule matching, removes blocked models from primary and `fallback_models`, and sanitizes recommendations before writing JSONC.

## How `fallback_models` are determined

By default, the CLI starts from upstream `rules(model-core)` fallback chains. The CLI then:

1. Picks or preserves the primary `model` from the rule chain.
2. Adds cloud `fallback_models` entries from rule chains.
3. Fills in missing cloud providers with each provider's highest-scored model, so a config is not dominated by one provider.
4. Adds at most one computed local fallback for each entry when local discovery finds a fitting candidate for that entry's role.
5. Creates a local `keep` decision for installed picks and an `install` decision for missing picks. Missing local models are not written to config unless installation is confirmed; `--no-install` leaves them out.
6. Deduplicates `fallback_models`, removes anything that duplicates the primary model, and orders local fallbacks last after cloud fallbacks.
7. If no primary model remains but fallbacks exist, promotes the first fallback to `model`.
