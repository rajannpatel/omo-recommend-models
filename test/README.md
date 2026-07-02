# Test Guide

This project uses Node's built-in `node:test` runner. Run the full suite with:

```bash
npm test
```

## Where Tests Belong

- `test/unit/*.test.js`: pure or mostly pure module behavior. Put parser, scoring, rule-chain, provider/model filtering, finalizer, and config mutation tests here when the behavior can be exercised without spawning the CLI.
- `test/omo-recommend-models.test.js`: end-to-end CLI behavior. Use this harness only when the behavior depends on fake `opencode`, `ollama`, `codex`, `agy`, GPU commands, prompt input, TTY/non-TTY behavior, cache files, validator subprocesses, or config writes.
- `test/fixtures/`: static JSON/JSONC inputs or snapshots. Do not place generated fixtures under `bin/`.

## Model Availability Coverage

Provider availability is not enough for recommendations. If a provider advertises a model, tests must cover model-level probing before that `provider/model` ref can be assigned.

When changing model selection or provider probing, cover these cases:

1. A probed available model remains eligible for `model` or `fallback_models`.
2. An advertised model whose probe fails is excluded from both `model` and `fallback_models`.
3. A different available model from the same provider remains eligible when one sibling model fails.
4. Invalid provider/model spellings are rejected without blocking valid refs from other providers.

Prefer focused unit coverage in `test/unit/paid-provider-prep.test.js`, `test/unit/rules-assignment.test.js`, or `test/unit/apply-recommendations.test.js`. Add one integration test only when the full CLI surface needs to prove the behavior.
