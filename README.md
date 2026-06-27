# omo-recommend-models

A CLI utility that profiles your GPU and recommends the most optimized local and cloud AI models for OpenCode and OmO. Run this whenever a new model drops to instantly optimize your configuration for performance and price, completely eliminating the need to manually calculate VRAM footprints or benchmark throughput.

## Quick Start

Run the utility in your project directory to evaluate your hardware and update your model registry:

```
$ npx npx omo-recommend-models --cloud-only --yes
│
◇  Checking GPU: skipped by --cloud-only
│
◇  Checking Ollama: skipped by --cloud-only
│
◇  Discovering local model catalog: skipped by --cloud-only
│
◇  Loading cloud provider cache: 5 provider(s)
  ✓ Model picture: 5 cloud provider(s), 0 installed local model(s)

│
◇  Verifying paid models availability: done

This run would query:
  1. opencode: nemotron-3-ultra-free
               mimo-v2.5-free
               deepseek-v4-flash-free
               big-pickle
               north-mini-code-free

│
◇  Verifying panel models availability: 5 of 5 model(s) available

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

## Why Run This?

* **Smart Routing** 

    Local models are automatically used in OpenCode *only* when they will outperform your cloud AI providers.
* **Hardware Profiling** 

    Detects your GPU architecture and VRAM to shortlist the best models that fit locally.
* **Cross-Provider Evaluation** 

    Stack-ranks local execution (Ollama, vLLM, Llama.cpp) against cloud providers (Anyscale, Together AI, Groq, OpenRouter) based on cost, speed, context window, and hallucination-free outputs.

## Problems omo-recommend-models solves

* **Bypass Sisyphus UI Overrides** 

    OpenCode's UI actively fights your OmO configuration for the primary orchestrator (Sisyphus), unconditionally overriding your fallback models. This is a known bug which will not be fixed in opencode. 
    
    **The fix:** 
    
    omo-recommend-models saves your configuration file at the project level (`.opencode/oh-my-openagent.jsonc`) instead of the global directory (`~/.config/`). Project-level configs force the pipeline to respect your JSON file over the UI. Add `.opencode` directory to your `.gitignore` file to prevent pushing your configuration to the repository.
* **Remove delays while running opencode** 

    If a provider is out of credits, OmO will waste time hitting a rejection wall on every single task before triggering the fallback model. Manually removing empty-quota keys from your OpenCode config, or stripping those models from `oh-my-openagent.jsonc` is a nuisance. Run omo-recommed-models to automatically get the latest configuration optimized for performance and price, through your preferred AI providers.
