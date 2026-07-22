# Control local model changes

Local discovery is enabled unless `--cloud-only` is present. The CLI inspects the GPU, Ollama, installed models, and its model catalog before choosing at most one fitting local fallback per agent or category.

## Preview without changing Ollama

Disable every local mutation while retaining local discovery:

```bash
npx omo-recommend-models \
  --dry-run \
  --no-install \
  --no-uninstall \
  --no-remove-orphans
```

The preview can show installed candidates and local fit decisions without pulling or removing models.

## Apply placements without changing Ollama

Apply cloud placements and keep only already installed local selections:

```bash
npx omo-recommend-models \
  --yes \
  --no-install \
  --no-uninstall \
  --no-remove-orphans
```

A missing local model is not written into the configuration when installation is disabled or not confirmed.

## Allow installation but prevent removal

Permit recommended pulls while retaining all installed models:

```bash
npx omo-recommend-models \
  --yes \
  --no-uninstall \
  --no-remove-orphans
```

## Exclude local models completely

Skip GPU detection, Ollama, and local catalog discovery:

```bash
npx omo-recommend-models --cloud-only --yes
```

## Understand action order

Local actions and configuration writes do not form one transaction:

1. Recommended installs can be confirmed before the final configuration apply confirmation.
2. Explicit uninstall decisions run after apply confirmation but before configuration validation.
3. Orphan removal runs after configuration validation succeeds.

> [!WARNING]
> Restoring `.pre-recommend` restores only the configuration file. It does not reinstall removed Ollama models or remove models pulled earlier in the run.

> [!IMPORTANT]
> `--yes` confirms all enabled actions. Use the three local opt-out flags whenever unattended local state changes are not intended.

For the memory and selection policy, read [How the recommendation pipeline works](../explanation/recommendation-pipeline.md#local-model-selection).
