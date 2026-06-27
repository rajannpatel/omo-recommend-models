# omo-recommend-models

A CLI utility that profiles your GPU and recommends the most optimized local and cloud AI models for OpenCode and OmO. Run this whenever a new model drops to instantly optimize your configuration for performance and price, completely eliminating the need to manually calculate VRAM footprints or benchmark throughput.

## Quick Start

Run the utility in your project directory to evaluate your hardware and update your model registry:

```bash
npx omo-recommend-models
```

## Why Run This?

* **Smart Routing:** 

Local models are automatically used in OpenCode *only* when they will outperform your cloud AI providers.
* **Hardware Profiling:** 

Detects your GPU architecture and VRAM to shortlist the best models that fit locally.
* **Cross-Provider Evaluation:** 

Stack-ranks local execution (Ollama, vLLM, Llama.cpp) against cloud providers (Anyscale, Together AI, Groq, OpenRouter) based on cost, speed, context window, and hallucination-free outputs.

## Crucial Configuration Rules

To ensure OmO runs without friction or delays, you must structure your configuration properly:

* **Bypass Sisyphus UI Overrides:** 

OpenCode's UI actively fights your OmO configuration for the primary orchestrator (Sisyphus), unconditionally overriding your fallback models. **The fix:** Save your configuration file at the project level (`.opencode/oh-my-openagent.jsonc`) instead of the global directory (`~/.config/`). Project-level configs force the pipeline to respect your JSON file over the UI.
* **Strip Dead API Keys:** 

If a provider is out of credits, OmO will waste time hitting a rejection wall on every single task before triggering the fallback model. Manually remove empty-quota keys from your OpenCode config or strip those models from `oh-my-openagent.jsonc`.

## Panel Model Configuration

Add persistent panel preferences to your `oh-my-openagent.jsonc` file under the `omo` key:

```jsonc
"omo": {
  "panel_model_order": "opencode-first", // or "score"
  "panel_models": [
    "opencode/nemotron-3-ultra-free",
    "opencode/mimo-v2.5-free",
    "cli/codex",
    "cli/my-agent"
  ],
  "panel_cli_agents": {
    "my-agent": {
      "binary": "my-agent",
      "command": "my-agent --json --prompt {prompt}"
    }
  }
}
```

> **Note:** Passing `--model` flags via CLI will override `omo.panel_models` for a single run.