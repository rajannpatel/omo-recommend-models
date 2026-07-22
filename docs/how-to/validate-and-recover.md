# Validate, fix, and recover a configuration

Use `omo-validate-config` after a manual edit, before committing a generated configuration, or when an apply run reports validation failure.

## Validate the resolved project file

Run:

```bash
npx omo-validate-config
```

The validator uses the same project path resolution as the recommendation CLI.

## Validate another file or scope

Validate an explicit path:

```bash
npx omo-validate-config --config /path/to/oh-my-openagent.jsonc
```

Replace `/path/to/oh-my-openagent.jsonc` with the file to check.

Validate the global configuration:

```bash
npx omo-validate-config --global
```

## Apply mechanical fixes

Preview the file in version control or make a separate copy, then run:

```bash
npx omo-validate-config --config /path/to/oh-my-openagent.jsonc --fix
```

When valid changes are written, the original file is copied to `<path>.bak`.

The fixer can:

- add the default `$schema` when it is missing
- add missing `git_master` defaults
- remove generated `routing` and `model_quality` fields
- canonicalize supported model references
- remove an empty `fallback_models` array

> [!WARNING]
> A fix rewrites the file as normalized JSON. JSONC comments and the original formatting are not preserved.

## Recover after recommendation validation fails

An apply run copies an existing target to `<path>.pre-recommend` before writing. If post-write validation fails and the current run created that backup, the CLI restores it automatically.

Check the restored file:

```bash
npx omo-validate-config
```

If no prior target existed, there is no `.pre-recommend` file to restore. Inspect or remove the newly written file manually after confirming the reported path.

Automatic restoration covers validator failure, not serialization, truncation, or write failure. After another write error, inspect the target and `.pre-recommend` file before choosing a recovery action.

> [!IMPORTANT]
> Configuration rollback does not undo Ollama installation or removal. See [Control local model changes](manage-local-models.md) before recovering a run that included local actions.

For validation rules and exit codes, see the [`omo-validate-config` command reference](../reference/validate-config-cli.md).
