# 🛠️ omo-recommend-models

A CLI utility for OpenCode + OmO that profiles your hardware and generates a baseline, static configuration file with fallback models enabled by default for each agent. 

> [!TIP]
> This tool generates a *point-in-time snapshot* of model recommendations. It enables dynamic API routing, and will help you navigate real-time API quota rejections when using opencode with oh-my-opencode (OmO). Use this tool to get your initial bearings, or to recalibrate when you add more AI models to opencode, then let OmO handle the actual execution.

## Quick Start

Run the utility in your project directory to evaluate your available providers and preview the default deterministic rule-based recommendation:

```bash
$ npx omo-recommend-models --cloud-only --yes
```

Output:

```
Need to install the following packages:
omo-recommend-models@2.0.3
Ok to proceed? (y) 

✓  Checking GPU: skipped by --cloud-only
│
✓  Checking Ollama: skipped by --cloud-only
│
✓  Discovering local model catalog: skipped by --cloud-only
│
◇  Loaded: 1 providers (live from `opencode models`) (2s)
│
✓  Verifying cloud models availability: done 1/1 (2s)
│
◇  AI Analysis of available providers/models against recommended oh-my-openagent model rule-chains in:
│  • https://github.com/code-yeongyu/oh-my-openagent/blob/dev/packages/model-core/src/agent-model-requirements.ts
│  • https://github.com/code-yeongyu/oh-my-openagent/blob/dev/packages/model-core/src/category-model-requirements.ts
│
│  No available rule-chain models for:
│
│  ◦ hephaestus:
│      1. (openai, github-copilot, opencode, vercel)/gpt-5.5)
│
│  ◦ oracle:
│      1. (openai, github-copilot, opencode, vercel)/gpt-5.5
│      2. (google, github-copilot, opencode, vercel)/gemini-3.1-pro
│      3. (anthropic, github-copilot, opencode, vercel)/claude-opus-4-7
│      4. (opencode-go, vercel)/glm-5.1)
│
│  ◦ librarian:
│      1. openai/gpt-5.4-mini-fast
│      2. (opencode-go, bailian-coding-plan)/qwen3.5-plus
│      3. vercel/minimax-m2.7-highspeed
│      4. (opencode-go, vercel)/minimax-m3
│      5. (minimax-coding-plan, minimax-cn-coding-plan)/MiniMax-M3
│      6. (opencode-go, vercel)/minimax-m2.7
│      7. (anthropic, github-copilot, vercel)/claude-haiku-4-5
│      8. (openai, vercel)/gpt-5.4-nano)
│
│  ◦ explore:
│      1. openai/gpt-5.4-mini-fast
│      2. (opencode-go, bailian-coding-plan)/qwen3.5-plus
│      3. vercel/minimax-m2.7-highspeed
│      4. (opencode-go, vercel)/minimax-m3
│      5. (minimax-coding-plan, minimax-cn-coding-plan)/MiniMax-M3
│      6. (opencode-go, vercel)/minimax-m2.7
│      7. (anthropic, github-copilot, vercel)/claude-haiku-4-5
│      8. (openai, vercel)/gpt-5.4-nano)
│
│  ◦ multimodal-looker:
│      1. (openai, opencode, vercel)/gpt-5.5
│      2. (opencode-go, vercel)/kimi-k2.6
│      3. (zai-coding-plan, vercel)/glm-4.6v
│      4. (openai, github-copilot, opencode, vercel)/gpt-5-nano)
│
│  ◦ prometheus:
│      1. (anthropic, github-copilot, opencode, vercel)/claude-opus-4-7
│      2. (openai, github-copilot, opencode, vercel)/gpt-5.5
│      3. (opencode-go, vercel)/glm-5.1
│      4. (google, github-copilot, opencode, vercel)/gemini-3.1-pro)
│
│  ◦ metis:
│      1. (anthropic, github-copilot, opencode, vercel)/claude-sonnet-4-6
│      2. (anthropic, github-copilot, opencode, vercel)/claude-opus-4-7
│      3. (openai, github-copilot, opencode, vercel)/gpt-5.5
│      4. (opencode-go, vercel)/glm-5.1
│      5. kimi-for-coding/k2p5)
│
│  ◦ momus:
│      1. (openai, github-copilot, opencode, vercel)/gpt-5.5
│      2. (anthropic, github-copilot, opencode, vercel)/claude-opus-4-7
│      3. (google, github-copilot, opencode, vercel)/gemini-3.1-pro
│      4. (opencode-go, vercel)/glm-5.1)
│
│  ◦ atlas:
│      1. (anthropic, github-copilot, opencode, vercel)/claude-sonnet-4-6
│      2. (opencode-go, vercel)/kimi-k2.6
│      3. (openai, github-copilot, opencode, vercel)/gpt-5.5
│      4. (opencode-go, vercel)/minimax-m3
│      5. (minimax-coding-plan, minimax-cn-coding-plan)/MiniMax-M3
│      6. (opencode-go, vercel)/minimax-m2.7)
│
│  ◦ visual-engineering:
│      1. (google, github-copilot, opencode, vercel)/gemini-3.1-pro
│      2. (zai-coding-plan, opencode, bailian-coding-plan, vercel)/glm-5
│      3. (anthropic, github-copilot, opencode, vercel)/claude-opus-4-7
│      4. (opencode-go, vercel)/glm-5.1
│      5. kimi-for-coding/k2p5)
│
│  ◦ ultrabrain:
│      1. (openai, opencode, vercel)/gpt-5.5
│      2. (google, github-copilot, opencode, vercel)/gemini-3.1-pro
│      3. (anthropic, github-copilot, opencode, vercel)/claude-opus-4-7
│      4. (opencode-go, vercel)/glm-5.1)
│
│  ◦ deep:
│      1. (openai, github-copilot, opencode, vercel)/gpt-5.5
│      2. (anthropic, github-copilot, opencode, vercel)/claude-opus-4-7
│      3. (google, github-copilot, opencode, vercel)/gemini-3.1-pro
│      4. (opencode-go, vercel)/kimi-k2.6
│      5. (opencode-go, vercel)/glm-5.1)
│
│  ◦ artistry:
│      1. (google, github-copilot, opencode, vercel)/gemini-3.1-pro
│      2. (anthropic, github-copilot, opencode, vercel)/claude-opus-4-7
│      3. (openai, github-copilot, opencode, vercel)/gpt-5.5
│      4. (opencode-go, vercel)/kimi-k2.6
│      5. (opencode-go, vercel)/glm-5.1)
│
│  ◦ quick:
│      1. (openai, github-copilot, opencode, vercel)/gpt-5.4-mini
│      2. (anthropic, github-copilot, vercel)/claude-haiku-4-5
│      3. (google, github-copilot, opencode, vercel)/gemini-3-flash
│      4. (opencode-go, vercel)/minimax-m3
│      5. (minimax-coding-plan, minimax-cn-coding-plan)/MiniMax-M3
│      6. (opencode-go, vercel)/minimax-m2.7
│      7. (opencode, vercel)/gpt-5-nano)
│
│  ◦ unspecified-low:
│      1. (anthropic, github-copilot, opencode, vercel)/claude-sonnet-4-6
│      2. (openai, opencode, vercel)/gpt-5.5
│      3. (opencode-go, vercel)/kimi-k2.6
│      4. (google, github-copilot, opencode, vercel)/gemini-3-flash
│      5. (opencode-go, vercel)/minimax-m3
│      6. (minimax-coding-plan, minimax-cn-coding-plan)/MiniMax-M3
│      7. (opencode-go, vercel)/minimax-m2.7)
│
│  ◦ unspecified-high:
│      1. (anthropic, github-copilot, opencode, vercel)/claude-opus-4-7
│      2. (openai, github-copilot, opencode, vercel)/gpt-5.5
│      3. (zai-coding-plan, opencode, bailian-coding-plan, vercel)/glm-5
│      4. kimi-for-coding/k2p5
│      5. (opencode-go, vercel)/glm-5.1
│      6. (opencode, bailian-coding-plan, vercel, moonshotai, moonshotai-cn, firmware, ollama-cloud, aihubmix)/kimi-k2.5)
│
│  ◦ writing:
│      1. (google, github-copilot, opencode, vercel)/gemini-3-flash
│      2. (opencode-go, vercel)/kimi-k2.6
│      3. (anthropic, github-copilot, opencode, vercel)/claude-sonnet-4-6
│      4. (opencode-go, vercel)/minimax-m3
│      5. (minimax-coding-plan, minimax-cn-coding-plan)/MiniMax-M3
│      6. (opencode-go, vercel)/minimax-m2.7)
│
◇  Recommended provider/model configurations for /project/.opencode/oh-my-openagent.jsonc:
│  • agents.sisyphus
│    ◦ model: opencode/big-pickle
│    ◦ fallback_models:
│      1. opencode/deepseek-v4-flash-free
│      2. opencode/north-mini-code-free
│      3. opencode/mimo-v2.5-free
│
│  • agents.hephaestus
│    ◦ model: opencode/mimo-v2.5-free
│    ◦ fallback_models:
│      1. opencode/deepseek-v4-flash-free
│      2. opencode/north-mini-code-free
│      3. opencode/big-pickle
│
│  • agents.oracle
│    ◦ model: opencode/mimo-v2.5-free
│    ◦ fallback_models:
│      1. opencode/deepseek-v4-flash-free
│      2. opencode/north-mini-code-free
│      3. opencode/big-pickle
│
│  • agents.librarian
│    ◦ model: opencode/mimo-v2.5-free
│    ◦ fallback_models:
│      1. opencode/deepseek-v4-flash-free
│      2. opencode/north-mini-code-free
│      3. opencode/big-pickle
│
│  • agents.explore
│    ◦ model: opencode/mimo-v2.5-free
│    ◦ fallback_models:
│      1. opencode/deepseek-v4-flash-free
│      2. opencode/north-mini-code-free
│      3. opencode/big-pickle
│
│  • agents.multimodal-looker
│    ◦ model: opencode/mimo-v2.5-free
│    ◦ fallback_models:
│      1. opencode/deepseek-v4-flash-free
│      2. opencode/north-mini-code-free
│      3. opencode/big-pickle
│
│  • agents.prometheus
│    ◦ model: opencode/mimo-v2.5-free
│    ◦ fallback_models:
│      1. opencode/deepseek-v4-flash-free
│      2. opencode/north-mini-code-free
│      3. opencode/big-pickle
│
│  • agents.metis
│    ◦ model: opencode/mimo-v2.5-free
│    ◦ fallback_models:
│      1. opencode/deepseek-v4-flash-free
│      2. opencode/north-mini-code-free
│      3. opencode/big-pickle
│
│  • agents.momus
│    ◦ model: opencode/mimo-v2.5-free
│    ◦ fallback_models:
│      1. opencode/deepseek-v4-flash-free
│      2. opencode/north-mini-code-free
│      3. opencode/big-pickle
│
│  • agents.atlas
│    ◦ model: opencode/mimo-v2.5-free
│    ◦ fallback_models:
│      1. opencode/deepseek-v4-flash-free
│      2. opencode/north-mini-code-free
│      3. opencode/big-pickle
│
│  • agents.sisyphus-junior
│    ◦ model: opencode/big-pickle
│    ◦ fallback_models:
│      1. opencode/deepseek-v4-flash-free
│      2. opencode/north-mini-code-free
│      3. opencode/mimo-v2.5-free
│
│  • agents.scout
│    ◦ model: opencode/deepseek-v4-flash-free
│
│  • agents.sysadmin
│    ◦ model: opencode/deepseek-v4-flash-free
│
│  • categories.visual-engineering
│    ◦ model: opencode/mimo-v2.5-free
│    ◦ fallback_models:
│      1. opencode/deepseek-v4-flash-free
│      2. opencode/north-mini-code-free
│      3. opencode/big-pickle
│
│  • categories.ultrabrain
│    ◦ model: opencode/mimo-v2.5-free
│    ◦ fallback_models:
│      1. opencode/deepseek-v4-flash-free
│      2. opencode/north-mini-code-free
│      3. opencode/big-pickle
│
│  • categories.deep
│    ◦ model: opencode/mimo-v2.5-free
│    ◦ fallback_models:
│      1. opencode/deepseek-v4-flash-free
│      2. opencode/north-mini-code-free
│      3. opencode/big-pickle
│
│  • categories.artistry
│    ◦ model: opencode/mimo-v2.5-free
│    ◦ fallback_models:
│      1. opencode/deepseek-v4-flash-free
│      2. opencode/north-mini-code-free
│      3. opencode/big-pickle
│
│  • categories.quick
│    ◦ model: opencode/mimo-v2.5-free
│    ◦ fallback_models:
│      1. opencode/deepseek-v4-flash-free
│      2. opencode/north-mini-code-free
│      3. opencode/big-pickle
│
│  • categories.unspecified-low
│    ◦ model: opencode/mimo-v2.5-free
│    ◦ fallback_models:
│      1. opencode/deepseek-v4-flash-free
│      2. opencode/north-mini-code-free
│      3. opencode/big-pickle
│
│  • categories.unspecified-high
│    ◦ model: opencode/mimo-v2.5-free
│    ◦ fallback_models:
│      1. opencode/deepseek-v4-flash-free
│      2. opencode/north-mini-code-free
│      3. opencode/big-pickle
│
│  • categories.writing
│    ◦ model: opencode/mimo-v2.5-free
│    ◦ fallback_models:
│      1. opencode/deepseek-v4-flash-free
│      2. opencode/north-mini-code-free
│      3. opencode/big-pickle
│
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
| `--exclude-model <ref>` | — | — | Exclude a specific model reference from consideration. Repeatable. |

### Exclusion Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--exclude-free` | `false` | Exclude free/open-source models from the final JSONC configuration output. Free models are included by default. |
| `--no-exclude-free` | `false` | Negation of `--exclude-free`. Ensures free models are allowed in the final JSONC configuration. |
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
  • Free models excluded via --exclude-free
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
