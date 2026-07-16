# OpenCode Free Model Latency Investigation

## Question

Command investigated:

```bash
opencode run --pure --agent summary --format json --model openrouter/meta-llama/llama-3.3-70b-instruct:free "say 1"
```

The practical question is whether there is a faster way to determine that this model is outside a compliance policy than asking the model to generate a trivial response.

## Short Answer

Yes. Do not use generation as the compliance check. Treat the model reference and catalog metadata as the source of truth, then reject the model before `opencode run` starts.

For this specific model, the reference itself is already enough for most policies that ban free external/cloud routes:

```text
openrouter/meta-llama/llama-3.3-70b-instruct:free
```

It is an `openrouter` model and the model id ends in `:free`. If the policy excludes OpenRouter free routes, it should be denied deterministically without sending a prompt.

## Runtime Evidence

The direct generation path was slow in practice. A timed run of the exact command produced no stdout before a 45 second timeout:

```text
real 45.09
user 6.31
sys 0.87
```

By contrast, model listing is a faster classification path. Running a model-list check found the target model directly:

```bash
opencode models | rg -n "^openrouter/meta-llama/llama-3\.3-70b-instruct:free$|openrouter/meta-llama/llama-3\.3-70b-instruct:free"
```

Observed hit:

```text
157:openrouter/meta-llama/llama-3.3-70b-instruct:free
```

That confirms the model is advertised in OpenCode's catalog/listing as the free OpenRouter ref, without waiting for the model to produce tokens.

## Why `say 1` Can Take Forever

`opencode run` exercises the whole runtime path: CLI startup, agent setup, provider routing, OpenRouter request handling, free-tier scheduling, model availability, queueing, retries, streaming, and JSON formatting. A trivial prompt does not make that control plane trivial.

Free OpenRouter routes can be especially slow because they may be rate-limited, queued, unavailable, or backed by providers with variable capacity. If the question is compliance, all of that runtime work is unnecessary.

## Faster Compliance Check

Use a deterministic preflight check on the model ref and/or cached model metadata:

```bash
model='openrouter/meta-llama/llama-3.3-70b-instruct:free'

if [[ "$model" == openrouter/*:free ]]; then
  printf 'DENY: OpenRouter free model route is outside policy: %s\n' "$model"
  exit 1
fi
```

For a one-off shell check against OpenCode's known model list:

```bash
opencode models | rg -n '^openrouter/meta-llama/llama-3\.3-70b-instruct:free$'
```

For repository code, the existing helper path is metadata-based rather than generation-based:

- `lib/shared/provider-cache.js` exposes `isFreeModelRef(provider, model)`.
- `lib/shared/provider-cache.js` exposes `discoverFreeModels()`.
- `lib/shared/provider-cache.js` exposes `isZeroCostModelMeta(meta)` for catalog entries with zero input and output cost.
- `lib/recommend/rules-assignment/helpers.js` uses those helpers to classify free candidates before assignment.

In other words, policy enforcement should parse the ref as:

```json
{
  "provider": "openrouter",
  "model": "meta-llama/llama-3.3-70b-instruct:free"
}
```

Then reject it if the provider, suffix, zero-cost metadata, or model class violates policy.

## Caveat

The `:free` suffix and zero-cost catalog metadata answer the cost/route classification question. They do not, by themselves, prove every data-handling detail needed for compliance. If the policy is about data residency, training use, retention, or approved subprocessors, encode those requirements separately as explicit provider/model allow-list rules.

The important point is that the allow/deny decision should happen before `opencode run`, not after a slow generation probe.
