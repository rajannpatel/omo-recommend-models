[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**omo-recommend-models** is an intelligent CLI utility that evaluates your GPU and uses AI to recommend the absolute best local and cloud-hosted AI models for your computer. Local models are automatically used in opencode *only* when they will outperform cloud AI providers.

Best Practice
If you know a specific provider is completely out of credits (e.g., your OpenAI prepaid balance is dry), it is highly recommended to either temporarily remove that API key from your OpenCode config or manually edit your oh-my-openagent.jsonc to strip those models out.

If you leave a quota-constrained model as an agent's primary choice, OmO will waste a second or two on every single task hitting the provider's rejection wall before successfully rolling over to the fallback model.

Whenever a new model drops, don't spend hours reading benchmarks, calculating quantized VRAM footprints, or guessing your token-per-second throughput. Run `omo-recommend-models` and optimize your configuration for performance and price, across both cloud and local AI models you have chosen to use in opencode, instantly.

https://github.com/code-yeongyu/oh-my-openagent/issues/1538#:~:text=Bug%20Description,the%20oh%2Dmy%2Dopencode.
There is a known, heavily documented issue where OpenCode's UI actively fights OmO's configuration for the primary orchestrator (Sisyphus).  

Because Sisyphus is your main agent, OpenCode frequently forces its uiSelectedModel (whatever you have selected in the top-right corner of the OpenCode UI) down into Sisyphus, unconditionally overriding the `model` and `fallback_models` you wrote in your JSON file.

The fix for this: Make sure your configuration file is saved in the project root at `.opencode/oh-my-openagent.jsonc` rather than just the global `~/.config/` directory. Project-level configs force the model resolution pipeline to respect your JSON file over the UI's default state.



---

## ✨ Features

- **⚡ AI driven hardware profiling:** Detects GPU architecture and VRAM and aligns it with available models. Shortlists the absolute best models for a variety of tasks and purposes, that can fit completely into VRAM.
- **📊 Cross-provider evaluation:** Compares local execution (via Ollama, vLLM, Llama.cpp) against state-of-the-art cloud providers (Anyscale, Together AI, Groq, OpenRouter) based on cost, speed, and context window requirements. Stack ranks AI models based on a combination of speed, accuracy, completeness, and hallucination-free outputs.
- **🔄 Rolling model registry:** Keeps track of the latest model releases (Llama 3, Mistral, Phi-3, Gemma) and maps them to your hardware whenever you run `omo-recommend-models`.

---

## 🚀 Quick Start

### Installation

download everything and
chmod +x omo-recommend-models

npx coming soon...

## Panel model configuration

Add persistent panel preferences to `oh-my-openagent.jsonc` under `omo`:

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

`--model` flags still override `omo.panel_models` for one run.
