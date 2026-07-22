# `omo-validate-config` command reference

This reference describes the configuration validator shipped with `omo-recommend-models`.

## Usage

```text
omo-validate-config [--config <path>] [--fix] [--global] [--help]
```

## Options

| Option | Description |
| --- | --- |
| `--config <path>` | Validate an explicit JSONC file. The path must be a separate argument. |
| `--global` | Validate `~/.config/opencode/oh-my-openagent.jsonc`. |
| `--fix` | Apply supported mechanical fixes, then validate. A changed valid file is written after copying the original to `<path>.bak`. |
| `-h`, `--help` | Show help and exit. `-h` is accepted even though the short form is not displayed in help. |

The validator has no version option. Unknown options and positional arguments are usage errors.

When `--config <path>` and `--global` are both present, the explicit `--config` path wins regardless of option order.

## Validation scope

The validator checks the model-placement subset managed by this package:

- the top level is an object
- `$schema` is a non-empty string
- `agents` and `categories`, when present, are objects
- each agent and category entry is an object
- `model` uses `provider/model` syntax
- local references use `local/<model>`, not `ollama/<model>`
- `variant` is a string and appears only with `model`
- `fallback_models` is a model string or an array of model strings and placement objects
- placement settings use supported keys and value ranges

When provider cache facts are available, the validator also checks cloud provider and model names. When local facts are available, it checks local model names. The absence of those facts limits these availability checks.

This command does not validate every setting accepted by the upstream oh-my-openagent schema.

## Placement object fields

| Field | Constraint |
| --- | --- |
| `model` | Required `provider/model` string. |
| `variant` | String. |
| `reasoningEffort` | `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`. |
| `temperature` | Finite number from `0` through `2`. |
| `top_p` | Finite number from `0` through `1`. |
| `maxTokens` | Finite number. |
| `thinking` | Object with `type` set to `enabled` or `disabled`, and optional finite `budgetTokens`. |

## Mechanical fixes

`--fix` can:

- add the default `$schema` when the field is not a string
- add the default `git_master` object or missing default keys
- remove `routing` and `model_quality` from agent and category entries
- canonicalize supported model references, including `ollama/...` to `local/...`
- simplify supported provider/model objects inside `fallback_models` arrays to strings
- remove an empty `fallback_models` array

Fixes are applied in memory before validation. A file is written only when the fixed result is valid and changed.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | The configuration is valid, including a successful fix. |
| `1` | The file cannot be read or parsed, or validation fails. |
| `2` | Command-line arguments are invalid. |

## Related pages

- [Validate, fix, and recover a configuration](../how-to/validate-and-recover.md)
- [Generated configuration reference](configuration.md)
