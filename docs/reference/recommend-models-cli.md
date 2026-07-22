# `omo-recommend-models` command reference

This reference describes the complete command-line surface for `omo-recommend-models` version 3.1.1.

## Usage

```text
omo-recommend-models [options]
```

The command accepts options only. Positional arguments are rejected.

## Execution defaults

| Context | Behavior |
| --- | --- |
| TTY without `--yes` | Build recommendations. An enabled local install can be confirmed before final recommendations are displayed; the command prompts again before configuration apply and the remaining enabled actions. |
| Non-TTY without an explicit `--yes` | Select preview behavior automatically unless `--interactive` is present. With `--interactive`, the command follows its prompt path; EOF on standard input accepts default-yes confirmations and can apply changes without `--yes`. |
| Any environment with `--dry-run` | Display recommendations without writing the final configuration or performing local-model actions. Discovery, probes, and fitness evaluation still run. |
| Any environment with an explicit `--yes` | Apply without interactive confirmation unless `--dry-run` is also present. |

Zero-cost models are eligible for generated configuration by default. Configuration apply, local installation, local uninstall, and orphan removal are enabled by default when the run reaches those actions.

> [!WARNING]
> Preview mode is not an offline or no-cost mode. Authenticated cloud probes and evaluator requests can consume quota or incur charges. Traditional OpenCode reachability probes invoke `opencode run` with `--dangerously-skip-permissions` in a temporary directory. `--agy-analysis` invokes AGY with `--dangerously-skip-permissions`, and `--codex-analysis` invokes Codex with `--dangerously-bypass-approvals-and-sandbox`. Run these operations only from a trusted environment.

Path resolution and caches can also change during preview. If recommendation generation fails and no project configuration exists, the current failure handler writes the configuration loaded for the run to a project path. During `--global` use, this can copy an existing global configuration into the project, including in preview mode.

The recommendation-generation failure path is caught internally and can return with exit code `0` after printing `AI recommendation failed:`. Exit code `0` therefore does not prove that recommendations were built. Automation should treat that message as a failure and inspect the expected configuration or preview output.

## Options

| Option | Default | Description |
| --- | --- | --- |
| `-y`, `--yes` | Off | Apply recommendations without interactive confirmation. |
| `--dry-run` | Off | Preview recommendations without writing the final configuration or performing local-model actions. Discovery, probes, and fitness evaluation still run. |
| `--flush-cache` | Off | Clear cached policy-excluded model references before discovery and probing. |
| `--global` | Off | Use `~/.config/opencode/oh-my-openagent.jsonc` instead of project resolution. |
| `--cloud-only` | Off | Skip GPU, Ollama, and local-model discovery. |
| `--local-only` | Off | Skip cloud model discovery and API checks. |
| `--interactive` | Off | Disable automatic non-TTY preview and follow the prompt path. If standard input is at EOF, default-yes confirmations are accepted; this option is not an unattended safety guard. |
| `--free-config` | Off | Explicitly include zero-cost models. Inclusion is already the generated-config default. |
| `--no-free-config` | Off | Exclude models whose metadata identifies zero input and output cost. |
| `--exclude-model <ref>` | None | Exclude a provider or exact `provider/model` reference. Repeat the option for multiple exclusions. The `--exclude-model=<ref>` form is also accepted. |
| `--no-install` | Install enabled | Skip installation of recommended local Ollama models. |
| `--no-uninstall` | Uninstall enabled | Skip removal of local models marked as conflicting or superseded. |
| `--no-remove-orphans` | Orphan removal enabled | Skip removal of installed Ollama models outside the retained decisions. |
| `--no-apply` | Apply enabled | Display final recommendations without writing the configuration or resolving local install decisions. |
| `--agy-analysis` | Off | Use the AGY CLI to rank eligible unmatched recommendations. |
| `--codex-analysis` | Off | Use the Codex CLI to rank eligible unmatched recommendations. |
| `--debug` | Off | Print stack traces for errors. |
| `--verbose` | Off | Show executed commands and complete subprocess output. |
| `-h`, `--help` | Off | Show help and exit. |
| `-v`, `--version` | Off | Show the package version and exit. |

`--cloud-only` and `--local-only` are mutually exclusive. Their accepted help-hidden aliases are:

| Alias | Equivalent option |
| --- | --- |
| `--exclude-local` | `--cloud-only` |
| `--exclude-cloud` | `--local-only` |

When both free-config options are present, `--no-free-config` wins regardless of option order. When both CLI evaluator options are present, `--agy-analysis` wins over `--codex-analysis`.

## Configuration targets

Without `--global`, the command uses project path resolution. With `--global`, it uses the user-level OpenCode configuration. See the [generated configuration reference](configuration.md#paths-and-backups).

## Analysis evaluators

Fitness ranking is limited to recommendations that did not match an upstream rule-chain model and have more than one fallback model. In the normal finalized shape, this means a primary model plus at least two fallbacks.

Without an evaluator option, the command tries eligible zero-cost OpenCode models first and validated paid models when needed. `--agy-analysis` or `--codex-analysis` replaces that evaluator selection with the named local CLI. Evaluators rank candidate placements; they are not written into the configuration as target models unless the same target reference is independently eligible through OpenCode.

## Related pages

- [Run recommendations in CI](../how-to/run-in-ci.md)
- [Control local model changes](../how-to/manage-local-models.md)
- [How the recommendation pipeline works](../explanation/recommendation-pipeline.md)
