```
$ npx omo-recommend-models --yes
Need to install the following packages:
omo-recommend-models@1.0.1
Ok to proceed? (y) 

│
◇  Checking GPU: NVIDIA GeForce RTX 3070 Ti Laptop GPU (8 GB VRAM)
│
◇  Checking Ollama: 1 installed model(s)
│
◇  Discovering local model catalog: 68 cached models
│
◇  Loading cloud provider cache: 5 provider(s)
  ✓ Model picture: 5 cloud provider(s), 1 installed local model(s)

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
   • opencode/nemotron-3-ultra-free:   20/21 successful responses
   • opencode/mimo-v2.5-free:          20/21 successful responses
   • opencode/deepseek-v4-flash-free:  20/21 successful responses
   • opencode/big-pickle:              21/21 successful responses
   • opencode/north-mini-code-free:    16/21 successful responses
evaluating -
   • tasks:                           105/105
   • agents:                           21/21


📊 AI Analysis (via panel(nemotron-3-ultra-free+mimo-v2.5-free+deepseek-v4-flash-free+big-pickle+north-mini-code-free)):
   Per-agent consensus across 5 panel models for 21 agent(s)

  • agents.sisyphus
    model: opencode/nemotron-3-ultra-free
    routing: opencode/north-mini-code-free, opencode/deepseek-v4-flash-free
    fallback_models: opencode/mimo-v2.5-free, opencode/big-pickle, opencode/deepseek-v4-flash-free, local/qwen2.5-coder:1.5b

  • agents.hephaestus
    model: opencode/nemotron-3-ultra-free
    routing: opencode/north-mini-code-free, opencode/deepseek-v4-flash-free
    fallback_models: opencode/big-pickle, opencode/mimo-v2.5-free, opencode/deepseek-v4-flash-free, local/qwen2.5-coder:1.5b

  • agents.oracle
    model: opencode/nemotron-3-ultra-free
    routing: opencode/deepseek-v4-flash-free, opencode/north-mini-code-free
    fallback_models: opencode/big-pickle, opencode/north-mini-code-free, local/qwen2.5-coder:1.5b

  • agents.librarian
    model: opencode/nemotron-3-ultra-free
    fallback_models: local/qwen2.5-coder:1.5b

  • agents.explore
    model: opencode/nemotron-3-ultra-free
    fallback_models: local/qwen2.5-coder:1.5b

  • agents.multimodal-looker
    model: opencode/nemotron-3-ultra-free
    routing: opencode/north-mini-code-free, opencode/deepseek-v4-flash-free
    fallback_models: opencode/mimo-v2.5-free, opencode/big-pickle, local/qwen2.5-coder:1.5b

  • agents.prometheus
    model: opencode/nemotron-3-ultra-free
    routing: opencode/north-mini-code-free
    fallback_models: opencode/mimo-v2.5-free, opencode/big-pickle, opencode/deepseek-v4-flash-free, local/qwen2.5-coder:1.5b

  • agents.metis
    model: opencode/nemotron-3-ultra-free
    routing: opencode/north-mini-code-free
    fallback_models: opencode/mimo-v2.5-free, opencode/deepseek-v4-flash-free, opencode/big-pickle, local/qwen2.5-coder:1.5b

  • agents.momus
    model: opencode/nemotron-3-ultra-free
    routing: opencode/north-mini-code-free
    fallback_models: opencode/deepseek-v4-flash-free, opencode/mimo-v2.5-free, opencode/big-pickle, local/qwen2.5-coder:1.5b

  • agents.atlas
    model: opencode/nemotron-3-ultra-free
    fallback_models: opencode/deepseek-v4-flash-free, opencode/mimo-v2.5-free, opencode/big-pickle, local/qwen2.5-coder:1.5b

  • agents.sisyphus-junior
    model: opencode/nemotron-3-ultra-free
    routing: opencode/north-mini-code-free, opencode/deepseek-v4-flash-free
    fallback_models: opencode/mimo-v2.5-free, opencode/north-mini-code-free, opencode/big-pickle, local/qwen2.5-coder:1.5b

  • agents.scout
    model: opencode/nemotron-3-ultra-free
    fallback_models: local/qwen2.5-coder:1.5b

  • agents.sysadmin
    model: opencode/nemotron-3-ultra-free
    routing: opencode/deepseek-v4-flash-free, opencode/north-mini-code-free
    fallback_models: opencode/mimo-v2.5-free, opencode/deepseek-v4-flash-free, local/qwen2.5-coder:1.5b

  • categories.visual-engineering
    model: opencode/nemotron-3-ultra-free
    fallback_models: local/qwen2.5-coder:1.5b

  • categories.ultrabrain
    model: opencode/nemotron-3-ultra-free
    fallback_models: local/qwen2.5-coder:1.5b

  • categories.deep
    model: opencode/nemotron-3-ultra-free
    fallback_models: opencode/mimo-v2.5-free, local/qwen2.5-coder:1.5b

  • categories.artistry
    model: opencode/nemotron-3-ultra-free
    fallback_models: local/qwen2.5-coder:1.5b

  • categories.quick
    model: opencode/nemotron-3-ultra-free
    fallback_models: local/qwen2.5-coder:1.5b

  • categories.unspecified-low
    model: opencode/nemotron-3-ultra-free
    fallback_models: local/qwen2.5-coder:1.5b

  • categories.unspecified-high
    model: opencode/nemotron-3-ultra-free
    fallback_models: local/qwen2.5-coder:1.5b

  • categories.writing
    model: opencode/nemotron-3-ultra-free
    fallback_models: local/qwen2.5-coder:1.5b


── AI: Local config placements (21) ────────
  • qwen2.5-coder:1.5b → sisyphus (fallback)
    Justification: Required as the local fallback model.
  • qwen2.5-coder:1.5b → hephaestus (fallback)
    Justification: Required as the local fallback model.
  • qwen2.5-coder:1.5b → oracle (fallback)
    Justification: Required as the local fallback model.
  • qwen2.5-coder:1.5b → librarian (fallback)
    Justification: Required as the local fallback model.
  • qwen2.5-coder:1.5b → explore (fallback)
    Justification: Required as the local fallback model.
  • qwen2.5-coder:1.5b → multimodal-looker (fallback)
    Justification: Required as the local fallback model.
  • qwen2.5-coder:1.5b → prometheus (fallback)
    Justification: Required as the local fallback model.
  • qwen2.5-coder:1.5b → metis (fallback)
    Justification: Required as the local fallback model.
  • qwen2.5-coder:1.5b → momus (fallback)
    Justification: Required as the local fallback model.
  • qwen2.5-coder:1.5b → atlas (fallback)
    Justification: Required as the local fallback model.
  • qwen2.5-coder:1.5b → sisyphus-junior (fallback)
    Justification: Required as the local fallback model.
  • qwen2.5-coder:1.5b → scout (fallback)
    Justification: Required as the local fallback model.
  • qwen2.5-coder:1.5b → sysadmin (fallback)
    Justification: Required as the local fallback model.
  • qwen2.5-coder:1.5b → visual-engineering (fallback)
    Justification: Required as the local fallback model.
  • qwen2.5-coder:1.5b → ultrabrain (fallback)
    Justification: Required as the local fallback model.
  • qwen2.5-coder:1.5b → deep (fallback)
    Justification: Required as the local fallback model.
  • qwen2.5-coder:1.5b → artistry (fallback)
    Justification: Required as the local fallback model.
  • qwen2.5-coder:1.5b → quick (fallback)
    Justification: Required as the local fallback model.
  • qwen2.5-coder:1.5b → unspecified-low (fallback)
    Justification: Required as the local fallback model.
  • qwen2.5-coder:1.5b → unspecified-high (fallback)
    Justification: Required as the local fallback model.
  • qwen2.5-coder:1.5b → writing (fallback)
    Justification: Required as the local fallback model.

── AI: Keep (1) ──────────────────────────
  • qwen2.5-coder:1.5b  (1.0 GB, 1.5 GB VRAM, score 92)
    Required as the local fallback model.
  ✓ Backup saved to /home/workshop/testProject/.opencode/oh-my-openagent.jsonc.pre-rebalance
  ✓ sisyphus: local fallback set to local/qwen2.5-coder:1.5b
  ✓ hephaestus: local fallback set to local/qwen2.5-coder:1.5b
  ✓ oracle: local fallback set to local/qwen2.5-coder:1.5b
  ✓ librarian: local fallback set to local/qwen2.5-coder:1.5b
  ✓ explore: local fallback set to local/qwen2.5-coder:1.5b
  ✓ multimodal-looker: local fallback set to local/qwen2.5-coder:1.5b
  ✓ prometheus: local fallback set to local/qwen2.5-coder:1.5b
  ✓ metis: local fallback set to local/qwen2.5-coder:1.5b
  ✓ momus: local fallback set to local/qwen2.5-coder:1.5b
  ✓ atlas: local fallback set to local/qwen2.5-coder:1.5b
  ✓ sisyphus-junior: local fallback set to local/qwen2.5-coder:1.5b
  ✓ scout: local fallback set to local/qwen2.5-coder:1.5b
  ✓ sysadmin: local fallback set to local/qwen2.5-coder:1.5b
  ✓ visual-engineering: local fallback set to local/qwen2.5-coder:1.5b
  ✓ ultrabrain: local fallback set to local/qwen2.5-coder:1.5b
  ✓ deep: local fallback set to local/qwen2.5-coder:1.5b
  ✓ artistry: local fallback set to local/qwen2.5-coder:1.5b
  ✓ quick: local fallback set to local/qwen2.5-coder:1.5b
  ✓ unspecified-low: local fallback set to local/qwen2.5-coder:1.5b
  ✓ unspecified-high: local fallback set to local/qwen2.5-coder:1.5b
  ✓ writing: local fallback set to local/qwen2.5-coder:1.5b
  Backup: /home/workshop/testProject/.opencode/oh-my-openagent.jsonc.pre-rebalance
→ Validating changes...
Config valid: /home/workshop/testProject/.opencode/oh-my-openagent.jsonc
✅ 42 section(s) updated.


✅ Done.
```
