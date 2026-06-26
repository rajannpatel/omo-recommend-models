[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**omo-recommend-models** is an intelligent CLI utility that evaluates your GPU and uses AI to recommend the absolute best local and cloud-hosted AI models for your computer. Local models are automatically used in opencode *only* when they will outperform cloud AI providers.

Whenever a new model drops, don't spend hours reading benchmarks, calculating quantized VRAM footprints, or guessing your token-per-second throughput. Run `omo-recommend-models` and optimize your configuration for performance and price, across both cloud and local AI models you have chosen to use in opencode, instantly.

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