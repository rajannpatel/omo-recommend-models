https://github.com/user-attachments/assets/993c0030-4235-468b-a3c3-4d9d74b15343

# 🛠️ omo-recommend-models

A CLI utility for OpenCode + OmO that profiles your hardware and generates a baseline, static configuration file with fallback models enabled by default for each agent. 

> [!TIP]
> This tool generates a *point-in-time snapshot*. It does not replace dynamic API routing, it will not prevent real-time API quota rejections. Use this tool to get your initial bearings, or to recalibrate when you add more AI models to opencode, then let OmO handle the actual execution.

## Quick Start

Run the utility in your project directory to evaluate your hardware and update your model registry:

```
$ npx omo-recommend-models --cloud-only --yes
│
◇  Checking GPU: skipped by --cloud-only
│
◇  Checking Ollama: skipped by --cloud-only
│
◇  Discovering local model catalog: skipped by --cloud-only
│
◇  Loading cloud provider cache: 5 provider(s)
  ✓ Model picture: 5 cloud provider(s), 0 installed local model(s)

This run would query:
  1. opencode: nemotron-3-ultra-free
               mimo-v2.5-free
               deepseek-v4-flash-free
               big-pickle
               north-mini-code-free

== AI Panel: 21 agents, 5 panel models ==
   Models:
   • opencode/nemotron-3-ultra-free:   19/21 successful responses
   • opencode/mimo-v2.5-free:          21/21 successful responses
   • opencode/deepseek-v4-flash-free:  21/21 successful responses
   • opencode/big-pickle:              21/21 successful responses
   • opencode/north-mini-code-free:    13/21 successful responses
evaluating -
   • tasks:                           105/105
   • agents:                           21/21


📊 AI Analysis (via panel(nemotron-3-ultra-free+mimo-v2.5-free+deepseek-v4-flash-free+big-pickle+north-mini-code-free)):
   Per-agent consensus across 5 panel models for 21 agent(s)

```

   [ [complete output](./output.md) ]

---

## 🚩 CLI Flags Reference

### Discovery Control

| Flag | Default | Alias | Description |
|------|---------|-------|-------------|
| `--cloud-only` | `false` | `--exclude-local` | Skip GPU detection, Ollama, and all local model discovery. Only cloud providers are considered. |
| `--local-only` | `false` | `--exclude-cloud` | Skip cloud model discovery and API provider checks. Only local/Ollama models are considered. |
| `--model <ref>` | — | — | Use an explicit AI panel model (e.g. `opencode/big-pickle`). May be repeated for multiple models. |

### Exclusion Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--exclude-free` | `false` | Exclude free/open-source models from the final JSONC configuration output. Free models will not appear in `model`, `routing`, or `fallback_models`. |
| `--no-exclude-free` | `false` | Negation of `--exclude-free`. Ensures free models are allowed in the final JSONC configuration. |
| `--free-config` | `false` | Explicitly include free models in the JSONC configuration file. |
| `--no-free-config` | `false` | Negation of `--free-config`. Exclude free models from JSONC configuration. |
| `--free-panel` | `false` | Explicitly include free/open-source models in the AI Panel evaluation. |
| `--no-free-panel` | `false` | Negation of `--free-panel`. Exclude free models from the AI Panel model selection. |
| `--exclude-codex` | `false` | Exclude `cli/codex` (OpenAI Codex CLI agent) from the AI Panel. |
| `--exclude-codex-cli` | `false` | Alias for `--exclude-codex`. |
| `--exclude-agy` | `false` | Exclude `cli/agy` (Agy CLI agent) from the AI Panel. |
| `--exclude-agy-cli` | `false` | Alias for `--exclude-agy`. |
| `--exclude-rate-limited` | `false` | Exclude providers that returned rate-limit (HTTP 429) errors during probing. Without this flag, rate-limited providers remain eligible. |
| `--exclude-quota-restricted` | `false` | Exclude providers with quota, billing, credit, or payment errors. Without this flag, quota-restricted providers remain eligible. |

### Behavior Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--yes`, `-y` | `false` | Apply all recommendations without interactive confirmation. Required for non-interactive/CI environments to proceed past preview. |
| `--dry-run` | `false` | Preview all recommendations without writing any changes to the JSONC config file. Default behavior in non-TTY environments unless `--yes` is passed. |
| `--rebalance` | `false` | Run in algorithmic rebalance mode. Skips the AI panel entirely and restructures existing `model` and `fallback_models` assignments around score-based tier chains. |
| `--interactive` | `false` | Force interactive prompts even in non-TTY environments (e.g., CI pipelines with user input). |
| `--dangerously-skip-permissions` | `false` | Skip validation permission checks during config writing. Use with caution. |
| `--debug` | `false` | Print full stack traces for errors to aid debugging. |
| `--model <ref>` | — | Specify an explicit AI panel model reference. Repeatable: `--model prov/model1 --model prov/model2`. |

### Opt-Out Flags (Enabled by Default)

These flags use an **opt-out** pattern — the behavior they control is enabled by default, and passing the flag disables it via the `--no-` prefix.

| Flag | Default | Description |
|------|---------|-------------|
| `--no-cache` | `true` (cache enabled) | Skip loading cached AI panel results. Forces a fresh panel evaluation on every run. |
| `--no-install` | `true` (install enabled) | Skip pulling/installing recommended local Ollama models. Useful for preview-only runs or when you manage models separately. |
| `--no-uninstall` | `true` (uninstall enabled) | Skip removing conflicting or superseded local Ollama models. |
| `--no-remove-orphans` | `true` (orphan removal enabled) | Skip pruning Ollama models that the AI never evaluated or recommended. |
| `--no-rebalance-apply` | `false` | Do not write restructuring changes in rebalance mode. Only applies when `--rebalance` is active. |
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

When running (even in `--dry-run` mode), the CLI prints a clearly labeled `AI Panel Considerations & Exclusions` section showing which models, providers, and agents were included or excluded, and which CLI flags caused each exclusion:

```
── AI Panel Considerations & Exclusions ──
  • Local / Ollama models excluded via --exclude-local
  • Cloud / paid models considered
  • AI CLI agent cli/codex excluded via --exclude-codex
  • AI CLI agent cli/agy excluded via --exclude-agy
  • Free models excluded from AI Panel via --no-free-panel
  • Free models considered for JSONC configuration
```

---

## 🎯 What this actually does

* **Hardware profiling (The Best Feature)** 

    Detects your GPU architecture and available VRAM to shortlist local models (GGUFs, Ollama, vLLM) that will actually fit on your machine without OOM (Out of Memory) errors.
* **Static cost & context comparisons** 

    Provides a quick, point-in-time stack-rank of models from AI cloud providers you have authenticated in opencode (via `opencode auth login`), so decision fatigue around ordering models from best to worst for each OmO agent and purpose is completed with AI-driven reasoning.
* **Initial template generation** 

    Spits out a baseline `oh-my-openagent.jsonc` file with valid syntax, saving you from manually typing out provider endpoints on day one.

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

    The tool loads the cached OpenCode provider model list, scores models by family, release date, context length, reasoning capability, variant, provider prestige, and advertised cost, then keeps a compact candidate list for the AI panel.
* **Local inventory**

    If local discovery is enabled, the tool checks GPU/VRAM and Ollama, then only presents local models that fit the detected hardware. Local models are never placed in `routing`; they are used as primaries only when the recommendation explicitly chooses a local-first role, or as `fallback_models` for offline/quota-limited operation.
* **Rate-limit and quota filtering**

    Rate-limited and quota-restricted providers are included by default. Passing `--exclude-rate-limited` filters providers after a 429/rate-limit probe. Passing `--exclude-quota-restricted` filters providers after quota, billing, credit, auth, or payment errors. Without those flags, the tool does not exclude an entire provider, family, or model just because a probe failed.
* **Panel model selection**

    If you pass `--model provider/model`, those models are used for the AI panel. Otherwise the CLI can use configured `omo.panel_models`, selected paid models, or the default top free OpenCode panel models.

## The AI suitability prompt

For each agent or category, every panel model receives a compact prompt built from the current config entry, cloud candidates, fitting local models, and hardware facts. The prompt asks for strict JSON, not prose. In simplified form, it looks like this:

```text
OUTPUT: valid JSON only. No markdown.

SCHEMA:
{
  "name": str,
  "type": "agent|category",
  "profile": str,
  "model": {"provider": str, "model": str, "reason": str},
  "routing": [{"provider": str, "model": str, "reason": str}],
  "fallback_models": [{"provider": str, "model": str, "reason": str}]
}

AGENT: <name> | <agent-or-category> | <quality> | cur=<current-model> | <description>
HW: GPU=<label> VRAM=<total>GB usable=<usable>GB

CLOUD (<count>):
<provider/model score>

LOCAL (<count> fit VRAM):
<model name, VRAM, score, installed status>

FIELDS: model=primary routing=delegation_pool fallback_models=retry_pool
RULES:
- Sort routing and fallback_models by score descending.
- Paid/cloud as primary for reasoning/code agents.
- Free model as fallback unless utility agent (explore/librarian/quick).
- Prefer highest-scored cloud model for primary unless GPU requirements force local.
- For utility agents, use highest-scored free cloud as primary.
- For other agents, prioritize highest-scored paid/cloud model.
- Fill routing with next highest-scored cloud models.
- Set three fallback_models when possible:
  * Slot 1 closely matches the primary model in intelligence and token window.
  * Slot 2 is a highly available, fast mid-tier model.
  * Slot 3 is the cheapest, highest-rate-limit model.
- Remove duplicate entries across model, routing, and fallback_models.
- No local models in routing arrays.
```

The real prompt also includes a few concrete examples so the panel models keep `model`, `routing`, and `fallback_models` distinct.

## How `fallback_models` are determined

The AI panel votes independently for each agent/category. The CLI then:

1. Picks the primary `model` by majority vote when possible, or by plurality when no model has a majority.
2. Adds `routing` entries that received majority support.
3. Adds `fallback_models` entries that received majority support.
4. Fills in missing cloud providers with each provider's highest-scored model, so a config is not dominated by one provider.
5. Adds the best fitting local model as a fallback when local discovery finds a useful installed model.
6. Deduplicates `fallback_models` and removes anything that duplicates the primary model.
7. If no primary model remains but fallbacks exist, promotes the first fallback to `model`.

In `--rebalance` mode, the AI panel is skipped. The CLI instead builds tier chains directly from model scores and restructures existing `model` plus `fallback_models` assignments around those score tiers.
