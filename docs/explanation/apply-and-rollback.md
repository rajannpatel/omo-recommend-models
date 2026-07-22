# Apply and rollback boundaries

This page explains which changes `omo-recommend-models` can reverse and why local Ollama actions are separate from configuration rollback.

## Preview and apply are different phases

Every invocation builds recommendations from current provider and local state. A later apply invocation does not reuse a prior preview. Enabled local installs can be confirmed and pulled before final recommendations are displayed; the final apply prompt controls configuration writing and the remaining enabled actions.

`--dry-run` stops before the final configuration write and actual local-model changes. `--no-apply` stops before configuration writing and local install resolution.

A preview is not a promise that the process has no side effects. Discovery and policy caches can change, configuration directories can be created during path resolution, and a recommendation failure can write the configuration loaded for the run when no project configuration exists. The failure path uses project resolution even during `--global` or `--dry-run` use, so it can copy a loaded global configuration into the project.

Cloud probes and fitness evaluators make authenticated requests that can consume quota or incur charges. Traditional OpenCode reachability probes run `opencode` with `--dangerously-skip-permissions` in a temporary directory. AGY runs with `--dangerously-skip-permissions`, and Codex runs with `--dangerously-bypass-approvals-and-sandbox`, so use these operations only in a trusted environment.

`--interactive` disables automatic preview in a non-TTY environment, but it does not guarantee that a person answers every prompt. If standard input is at EOF, default-yes confirmations are accepted. Configuration apply and default-yes actions can therefore proceed without an explicit `--yes`.

## The configuration write boundary

For an existing target, the apply path copies the file to `<path>.pre-recommend`. It then normalizes generated sections, serializes the configuration, writes it, and invokes the bundled validator.

If validation succeeds, the new file remains. If validation fails and the current run backed up an existing target, the previous bytes are copied back to the target.

Serialization and the target write happen before the validator rollback block. A serialization, truncation, or write failure does not trigger automatic restoration. Inspect both the target and backup after a write error.

This rollback boundary protects one configuration file. It is not a transaction spanning the whole run.

## A new file has no rollback source

When no target existed, no `.pre-recommend` file can be created. If validation of the new write fails, the CLI reports that no backup is available. The newly written file can remain and require manual inspection or removal.

A `.pre-recommend` file left by an earlier run is not proof that the current run restored a newly created target. Verify the target contents after any failure instead of relying only on the status message.

This difference is why recovery instructions should always use the path reported by the CLI rather than assuming that rollback succeeded.

## Local actions have separate boundaries

Local Ollama actions occur at different points:

| Action | Position in the normal apply flow | Reversed by config rollback |
| --- | --- | --- |
| Install a recommended model | Can be confirmed before final config apply confirmation | No |
| Uninstall a conflicting or superseded model | After apply confirmation, before config validation | No |
| Remove an orphan model | After config validation succeeds | No |

The `.pre-recommend` copy contains configuration only. It cannot restore removed model data or remove a model pulled earlier.

## Serialization changes the document

The input parser accepts JSONC comments and trailing commas. Apply and fix paths serialize normalized JSON with indentation.

As a result, comments and original formatting are not part of rollback semantics unless they are present in a backup. Generated sections also lose unsupported `routing` and `model_quality` fields, and generated `ollama/...` references become `local/...`.

## Two backup suffixes serve different operations

| Suffix | Created by | Purpose |
| --- | --- | --- |
| `.pre-recommend` | Recommendation apply | Restore the prior target if post-write validation fails. |
| `.bak` | Validator `--fix` | Preserve the original before valid mechanical fixes are written. |

Neither backup records Ollama state.

## Design consequence

Configuration validation provides post-write rollback for validator failures when the current run backed up an existing target. It does not make file writes or the wider run transactional. Use explicit opt-out flags when local side effects are not acceptable.

Use `--cloud-only` to remove local actions from the run. Use `--no-install`, `--no-uninstall`, and `--no-remove-orphans` when local discovery is useful but local state must remain unchanged.

## Related pages

- [Validate, fix, and recover a configuration](../how-to/validate-and-recover.md)
- [Control local model changes](../how-to/manage-local-models.md)
- [Generated configuration reference](../reference/configuration.md)
