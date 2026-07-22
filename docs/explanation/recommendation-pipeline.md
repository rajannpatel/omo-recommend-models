# How the recommendation pipeline works

This page explains how `omo-recommend-models` turns the current environment into an ordered, point-in-time configuration. The pipeline favors reproducible upstream rules, then fills gaps with progressively broader matching and optional fitness ranking.

## A snapshot, not a runtime router

The command evaluates the models and provider state visible during one run. Its output is a static `model` and `fallback_models` order in `oh-my-openagent.jsonc`.

The package does not route requests or execute fallbacks after the file is written. The consuming OpenCode OMO runtime owns those behaviors. Re-run the recommender when provider access, available models, local hardware, or selection requirements change.

## Inventory and availability

Cloud discovery starts with the live `opencode models` inventory. The pipeline enriches the advertised references with available metadata and applies explicit provider or model exclusions.

Cloud references from the live advertised inventory are probed as exact `provider/model` pairs. This distinction prevents one unavailable model from incorrectly excluding a healthy sibling:

- model-scoped failures remove only the failed reference
- a confirmed provider-wide quota failure closes the remaining queue for that provider
- a rate limit makes every model from that provider ineligible for the remainder of the cooldown
- policy and account restrictions are applied before final placement

OpenRouter receives an additional account-effective model filter when the authenticated allowlist is available. Cached policy exclusions can avoid repeating known disallowed probes.

Zero-cost models have a separate path. After the advertised-reference probe set is formed, catalog entries with zero input and output cost and tool-call capability are injected into the lookup, including entries from providers that are not configured. Free references do not need membership in the successful probe set to remain eligible, so a catalog-injected or probe-failed free model can become a fallback without an exact reachability confirmation from that run.

## Upstream rules first

The package vendors the oh-my-openagent agent and category model requirements. Each entry has an ordered fallback chain that can include model families, providers, variants, and requirement constraints.

For every agent and category, the recommender expands that chain against the current inventory. The first allowed and available candidate becomes the primary model. Remaining eligible chain candidates become ordered fallbacks.

This deterministic first stage keeps known roles aligned with upstream intent. An evaluator cannot replace a valid rule-chain primary.

## Gap matching

An upstream model family can be present under a provider-specific spelling that differs from the vendored chain. When no exact rule-chain candidate survives, the pipeline tries broader matching in order:

1. deterministic semantic name matching
2. machine-readable metadata matching
3. an in-process closest-match stage

The first stage that produces usable candidates wins. If every stage is empty, verified candidates outside the rule chain provide a deterministic heuristic order. The entry remains marked as unmatched so later fitness ranking can refine that order.

## Finalization

Finalization turns candidate lists into configuration-ready placements. It:

- removes unavailable, excluded, and duplicate references
- adds a strong verified candidate from a missing cloud provider when useful
- limits redundant same-provider placements
- adds one fitting local fallback when available
- places local fallback candidates after cloud candidates
- promotes the first fallback when no primary remains

The resulting order is semantic. The first placement is primary; later placements are fallbacks.

## Fitness ranking

Fitness ranking is additive rather than the default selection engine. It runs only when an entry did not match an upstream rule-chain model and has more than one fallback model. In the normal finalized shape, the entry has a primary model and at least two fallbacks.

Without a CLI evaluator option, the evaluator order is:

1. eligible zero-cost models with tool-call capability
2. validated paid models when zero-cost evaluators are unavailable or fail

Selecting `--agy-analysis` or `--codex-analysis` replaces that default evaluator selection with the named CLI. It is not a third fallback stage after the zero-cost and paid evaluators.

An evaluator can reorder only the candidate pool already built for the entry. Hallucinated or unavailable references are not added. A failed evaluator reference is blacklisted and removed wherever it appears in recommendations, which can promote a surviving fallback. If no usable order is returned, the remaining candidates keep their deterministic relative order.

## Local model selection

Local discovery inspects GPU memory, Ollama, installed models, and catalog metadata. Each agent or category contributes a specialty and context requirement.

A candidate must satisfy the role and context constraints. Estimated model weights and KV-cache use must fit within 90 percent of detected VRAM. Installed state breaks ties between otherwise equivalent candidates; it does not make an unsuitable model eligible.

At most one fitting local model is selected for each entry. A missing model becomes a configuration fallback only after installation is confirmed.

## Why availability is checked before assignment

Provider visibility alone does not prove that an advertised model can serve requests for the current account. Exact-reference probes and policy filters reduce unreachable advertised placements while preserving usable siblings.

That reachability guarantee does not extend to the catalog-injected zero-cost exception. Those entries broaden fallback coverage, but the current run may not have confirmed that the account can reach them.

## Related pages

- [Generated configuration reference](../reference/configuration.md)
- [Control local model changes](../how-to/manage-local-models.md)
- [Apply and rollback boundaries](apply-and-rollback.md)
