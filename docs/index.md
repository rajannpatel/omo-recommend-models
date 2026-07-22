# omo-recommend-models documentation

Use `omo-recommend-models` to create point-in-time model placements for OpenCode OMO agents and categories. The CLI discovers available cloud and local models, builds recommendations, and previews or writes `model` and `fallback_models` in `oh-my-openagent.jsonc`.

This package prepares configuration. The runtime that reads the configuration is responsible for model routing, retries, and fallback execution.

## Start here

Follow [Create your first recommendation](tutorials/first-recommendation.md) to preview a cloud-only recommendation, inspect it, apply it, and validate the result.

## Complete a task

- [Choose a project or global configuration](how-to/choose-config-scope.md)
- [Run recommendations in CI](how-to/run-in-ci.md)
- [Control local model changes](how-to/manage-local-models.md)
- [Validate, fix, and recover a configuration](how-to/validate-and-recover.md)
- [Contribute documentation](how-to/contribute-documentation.md)

## Understand the system

- [How the recommendation pipeline works](explanation/recommendation-pipeline.md)
- [Apply and rollback boundaries](explanation/apply-and-rollback.md)

## Look up details

- [`omo-recommend-models` command reference](reference/recommend-models-cli.md)
- [`omo-validate-config` command reference](reference/validate-config-cli.md)
- [Generated configuration reference](reference/configuration.md)

## Documentation structure

This documentation follows [Diátaxis](https://diataxis.fr/):

| Section | Purpose |
| --- | --- |
| [Tutorials](tutorials/index.md) | Learn by completing a guided workflow. |
| [How-to guides](how-to/index.md) | Complete a specific task. |
| [Reference](reference/index.md) | Look up commands, options, and configuration details. |
| [Explanation](explanation/index.md) | Understand design decisions, boundaries, and tradeoffs. |
