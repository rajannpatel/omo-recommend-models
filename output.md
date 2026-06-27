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

  • agents.sisyphus
    model: opencode/nemotron-3-ultra-free
    routing: opencode/north-mini-code-free
    fallback_models: opencode/mimo-v2.5-free, opencode/big-pickle

  • agents.hephaestus
    model: opencode/nemotron-3-ultra-free
    routing: opencode/north-mini-code-free
    fallback_models: opencode/deepseek-v4-flash-free, opencode/big-pickle, opencode/mimo-v2.5-free

  • agents.oracle
    model: opencode/nemotron-3-ultra-free
    routing: opencode/north-mini-code-free
    fallback_models: opencode/big-pickle, opencode/deepseek-v4-flash-free, opencode/mimo-v2.5-free

  • agents.librarian
    model: opencode/nemotron-3-ultra-free

  • agents.explore
    model: opencode/nemotron-3-ultra-free

  • agents.multimodal-looker
    model: opencode/nemotron-3-ultra-free
    routing: opencode/north-mini-code-free
    fallback_models: opencode/mimo-v2.5-free, opencode/big-pickle, opencode/deepseek-v4-flash-free

  • agents.prometheus
    model: opencode/nemotron-3-ultra-free
    routing: opencode/north-mini-code-free, opencode/deepseek-v4-flash-free
    fallback_models: opencode/big-pickle, opencode/deepseek-v4-flash-free, opencode/mimo-v2.5-free

  • agents.metis
    model: opencode/nemotron-3-ultra-free
    routing: opencode/north-mini-code-free, opencode/deepseek-v4-flash-free
    fallback_models: opencode/mimo-v2.5-free, opencode/big-pickle, opencode/deepseek-v4-flash-free

  • agents.momus
    model: opencode/nemotron-3-ultra-free
    routing: opencode/north-mini-code-free
    fallback_models: opencode/deepseek-v4-flash-free, opencode/big-pickle, opencode/mimo-v2.5-free

  • agents.atlas
    model: opencode/nemotron-3-ultra-free

  • agents.sisyphus-junior
    model: opencode/nemotron-3-ultra-free
    routing: opencode/north-mini-code-free, opencode/deepseek-v4-flash-free
    fallback_models: opencode/big-pickle, opencode/north-mini-code-free, opencode/mimo-v2.5-free

  • agents.scout
    model: opencode/nemotron-3-ultra-free

  • agents.sysadmin
    model: opencode/nemotron-3-ultra-free
    routing: opencode/north-mini-code-free
    fallback_models: opencode/mimo-v2.5-free, opencode/deepseek-v4-flash-free, opencode/big-pickle

  • categories.visual-engineering
    model: opencode/nemotron-3-ultra-free

  • categories.ultrabrain
    model: opencode/nemotron-3-ultra-free

  • categories.deep
    model: opencode/nemotron-3-ultra-free
    routing: opencode/north-mini-code-free
    fallback_models: opencode/big-pickle, opencode/mimo-v2.5-free, opencode/deepseek-v4-flash-free

  • categories.artistry
    model: opencode/nemotron-3-ultra-free

  • categories.quick
    model: opencode/nemotron-3-ultra-free

  • categories.unspecified-low
    model: opencode/nemotron-3-ultra-free

  • categories.unspecified-high
    model: opencode/nemotron-3-ultra-free

  • categories.writing
    model: opencode/nemotron-3-ultra-free
```
