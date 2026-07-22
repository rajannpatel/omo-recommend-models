# Create your first recommendation

This tutorial guides you through a cloud-only recommendation for one OpenCode project. You will preview the proposed model placements, apply them, and validate the resulting configuration.

Allow about 10 minutes. The duration depends on the number and responsiveness of your configured providers.

## Prepare your environment

You need:

- Node.js 18 or newer
- the `opencode` CLI on `PATH`
- at least one provider authenticated in OpenCode
- a project directory where you can review configuration changes

Check the required commands:

```bash
node --version
opencode --version
```

Change to the project that should receive the recommendation:

```bash
cd /path/to/project
```

Replace `/path/to/project` with the project directory.

## Preview the recommendation

Run a cloud-only preview:

```bash
npx omo-recommend-models --dry-run --cloud-only
```

The CLI loads the models advertised by OpenCode, probes advertised eligible model references, and prints proposed `model` and `fallback_models` values. It can also add catalog-discovered zero-cost fallbacks that were not part of the exact-reference probe set. `--cloud-only` skips GPU, Ollama, and local-model discovery.

The preview still makes authenticated provider and evaluator requests. These requests can consume quota or incur provider charges even though no configuration is applied.

Review these parts of the output:

- the target `oh-my-openagent.jsonc` path
- model probes that failed or were skipped
- the primary and fallback order for each agent and category
- the final dry-run message

Recommendation order is significant. The `model` value is primary, and `fallback_models` are listed in fallback order.

## Apply the recommendation

Run the recommender again and apply its current cloud-only result without an interactive confirmation:

```bash
npx omo-recommend-models --cloud-only --yes
```

> [!IMPORTANT]
> `--yes` authorizes every enabled action. This tutorial also uses `--cloud-only`, so local model installation, uninstall, and orphan removal are outside the run. For a run that includes local models, review [Control local model changes](../how-to/manage-local-models.md) first.

The apply run repeats discovery, probing, and selection. Provider state can change after the preview, so review the applied file rather than assuming both runs produced identical placements.

If a project configuration already exists, the CLI copies it to the same path with `.pre-recommend` appended. It writes the generated configuration and invokes `omo-validate-config` before reporting success.

Look for output similar to:

```text
Config valid: /path/to/project/.opencode/oh-my-openagent.jsonc
Done.
```

The exact formatting and path depend on your environment.

## Validate the result

Run the validator independently:

```bash
npx omo-validate-config
```

A successful validation exits with code `0` and reports the resolved configuration path.

Open the generated file and confirm that the affected agent and category sections contain `model` and, where available, `fallback_models`.

> [!NOTE]
> The validator checks the model-placement subset supported by this package. It is not a complete validator for every upstream oh-my-openagent setting.

## Restore the previous configuration

Keep the generated file if the placements are suitable.

If you applied the tutorial to an existing configuration and want to restore it, copy the backup over the exact target path reported by the CLI:

```bash
cp /path/to/resolved-config.pre-recommend /path/to/resolved-config
```

Replace `/path/to/resolved-config` with the reported target. The target can end in `.jsonc` or `.json`; the backup appends `.pre-recommend` to that exact path.

> [!WARNING]
> Confirm the resolved path printed by the CLI before restoring a backup. A parent project or `--global` run can use a different location.

If the tutorial created a new configuration, remove it only when you are certain the project does not need it.

## Next steps

You have previewed, applied, and validated a cloud-only recommendation.

- Use [Choose a project or global configuration](../how-to/choose-config-scope.md) to control the target file.
- Use [Run recommendations in CI](../how-to/run-in-ci.md) for unattended runs.
- Read [How the recommendation pipeline works](../explanation/recommendation-pipeline.md) to understand how models are selected.
