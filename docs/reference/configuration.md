# Generated configuration reference

This reference describes the configuration paths and model-placement fields read or written by `omo-recommend-models`.

## Paths and backups

| Scope | Configuration path | Apply backup |
| --- | --- | --- |
| Project | Resolved `.opencode/oh-my-openagent.jsonc` or existing `.json` file | `<path>.pre-recommend` |
| Global | `~/.config/opencode/oh-my-openagent.jsonc` | `~/.config/opencode/oh-my-openagent.jsonc.pre-recommend` |

The project resolver walks upward from the current directory. It prefers an existing `.jsonc` file, then an existing `.json` file. Without either file, it anchors a new `.jsonc` file at the first directory containing `workshop.yaml` or `.gitignore`, or at the current directory when no anchor exists.

The recommendation-failure path currently resolves the project target without forwarding `--global`. When recommendation generation fails and no project configuration exists, it writes the configuration loaded for the run to the project target. During `--global` use, this can copy an existing global configuration into the project, including in preview mode.

`omo-validate-config --fix` uses a separate `<path>.bak` backup when it writes fixes.

## Top-level defaults

When no configuration exists, the in-memory default includes:

- the upstream `$schema` URL
- `team_mode` defaults
- `model_fallback: true`
- `runtime_fallback` defaults
- `git_master` defaults
- known `agents` and `categories` with descriptions

The recommendation package generates these values but does not execute runtime model routing or fallback attempts. Those behaviors belong to the runtime that consumes the file.

## Agent and category placements

Generated placements are written under `agents` or `categories`:

```json
{
  "agents": {
    "example-agent": {
      "model": "provider/primary-model",
      "fallback_models": [
        "another-provider/fallback-model",
        {
          "model": "provider/second-fallback",
          "variant": "high"
        }
      ]
    }
  }
}
```

The strings are illustrative. A usable configuration must reference providers and models available through OpenCode, or an installed local model.

### `model`

`model` is the primary `provider/model` reference. A generated primary can also have a sibling string `variant` field.

### `fallback_models`

`fallback_models` is ordered. Each item is either a `provider/model` string or an object with `model` and supported placement settings.

Generated fallback objects can contain:

- `variant`
- `reasoningEffort`
- `temperature`
- `top_p`
- `maxTokens`
- `thinking`

### Local references

Generated local references use `local/<model>`. The validator rejects `ollama/<model>` and directs the user to the canonical `local/` prefix.

A missing local model is written only after installation is confirmed. Each recommendation contains at most one selected local fallback.

## Generated cleanup

Before writing, the generator:

- adds a missing `$schema`
- adds missing `git_master` defaults
- removes `routing` and `model_quality` from generated agent and category sections
- converts generated `ollama/...` references to `local/...`

The input parser accepts JSONC comments and trailing commas. An apply or fix write serializes normalized JSON, so comments and original formatting are not preserved.

## Availability and ordering

Only provider/model references that survive active availability and exclusion rules are eligible for generated placements. Zero-cost models are included by default unless `--no-free-config` is present.

The first available recommendation becomes `model`. Remaining values become `fallback_models` in order. Duplicate references and disallowed providers are removed before the file is written.

## Related pages

- [`omo-recommend-models` command reference](recommend-models-cli.md)
- [`omo-validate-config` command reference](validate-config-cli.md)
- [Apply and rollback boundaries](../explanation/apply-and-rollback.md)
