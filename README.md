https://github.com/user-attachments/assets/993c0030-4235-468b-a3c3-4d9d74b15343

# 🛠️ omo-recommend-models

A CLI utility for OpenCode + OmO that profiles your hardware and generates a baseline, static configuration file. 

> [!TIP]
> This tool generates a *point-in-time snapshot*. It does not replace dynamic API routing, it will not prevent real-time API quota rejections, and it certainly cannot measure "hallucinations" between one provider and another. Use this tool to get your initial bearings, then let OmO handle the actual execution.

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

## 🎯 What this actually does

* **Hardware profiling (The Best Feature)** 

    Detects your GPU architecture and available VRAM to shortlist local models (GGUFs, Ollama, vLLM) that will actually fit on your machine without OOM (Out of Memory) errors.
* **Static cost & context comparisons** 

    Provides a quick, point-in-time stack-rank of cloud providers (OpenRouter, Groq, Together AI) based on their advertised pricing and context windows so you can decide who gets your credit card.
* **Initial template generation** 

    Spits out a baseline `oh-my-openagent.jsonc` file with valid syntax, saving you from manually typing out provider endpoints on day one.

---

## 🚫 What this tool can't do, and why you shouldn't overuse it

* **It does NOT handle rate limits or empty quotas**
  
    If a provider runs out of credits mid-task, running a CLI tool is the wrong way to fix it. Set up the `fallbacks: []` array natively in OmO, or use a unified router like LiteLLM/OpenRouter to handle 402/429 errors automatically at runtime.
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
3. **A massive new model family drops** 

    (e.g., Llama 4) and you want to quickly see the static pricing comparison across different cloud hosts.
