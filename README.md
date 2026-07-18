# omo-recommend-models

`omo-recommend-models` creates point-in-time model recommendations for OpenCode OMO agent and category entries. It discovers the models currently available to you, checks cloud reachability and optional local capacity, then previews or writes `model` and `fallback_models` in `oh-my-openagent.jsonc`.

This package prepares configuration. It does not execute runtime fallbacks, route requests between models, retry HTTP failures, or resume interrupted conversations; those behaviors belong to the runtime that consumes the generated configuration.

## Requirements

- Node.js 18 or newer. This has been built and tested with Node.js 24 on Ubuntu 26.04 LTS.
- The `opencode` CLI, available on `PATH` and authenticated for the cloud providers you want discovered and probed.
- Optional: Ollama and supported GPU inspection tools for local-model discovery. Use `--cloud-only` when local discovery is not needed.

Run the published package without installing it globally:

```bash
npx omo-recommend-models --dry-run --cloud-only
```

Or run a local clone:

```bash
git clone https://github.com/rajannpatel/omo-recommend-models.git
cd omo-recommend-models
npm install
node ./bin/omo-recommend-models --dry-run --cloud-only
```

## Quick start

Preview cloud-only recommendations first:

```bash
npx omo-recommend-models --dry-run --cloud-only
```

Apply the previewed cloud-only recommendations without prompts:

```bash
npx omo-recommend-models --cloud-only --yes
```

In a terminal, a run without `--yes` prompts before writing. In a non-TTY environment, a run without an explicit `--yes` automatically becomes a preview and does not write the config. `--interactive` can force prompts in a non-TTY environment.

## Configuration and backups

Without `--global`, the CLI walks upward from the current directory for `.opencode/oh-my-openagent.jsonc` or `.opencode/oh-my-openagent.json`. If neither exists, it selects a local `.opencode/oh-my-openagent.jsonc` at the detected workspace or current directory.

`--global` uses:

```text
~/.config/opencode/oh-my-openagent.jsonc
```

Before replacing an existing config, the CLI copies it to the same path with `.pre-recommend` appended. The generated file is validated before the run succeeds. If validation fails and a prior config was backed up, that backup is restored.

## How recommendations are built

1. The CLI loads the live `opencode models` inventory. Eligible advertised cloud model references are probed as exact `provider/model` pairs. Model-scoped failures remove only that reference; provider-scoped failures such as confirmed quota exhaustion make the remaining references from that provider ineligible. Active rate-limit and provider state are also honored.
2. Vendored upstream oh-my-openagent agent and category rule chains are applied first. Only currently allowed, reachable model references survive.
3. When a rule-chain reference is unavailable, matching tries deterministic name matching, machine-readable metadata matching, and an in-process closest-match stage. If those stages do not produce a usable result, the best verified candidates outside the rule chain provide a deterministic heuristic order.
4. Finalization fills useful provider gaps, removes unavailable and duplicate references, and promotes the first fallback if no primary remains. Recommendation order is significant: `model` is primary and `fallback_models` follows in order.
5. Model-fitness ranking runs only for entries that did not match an upstream rule-chain model and have multiple fallback candidates. It tries validated zero-cost evaluators first, then validated paid evaluators. `--agy-analysis` and `--codex-analysis` select those local CLI evaluators instead. If evaluation is unavailable or invalid, the heuristic order is kept.

Zero-cost models are eligible for the generated config by default. `--no-free-config` excludes models whose live cost metadata identifies zero input and output cost.

### Local model fit

When local discovery is enabled, the CLI inspects the GPU, Ollama, installed models, and its local model catalog. A candidate must satisfy the entry's context and specialty requirements, and its estimated weights plus KV cache must fit within 90% of detected VRAM. At most one fitting local model is added to an entry as a fallback.

Installed selections can be kept immediately. A missing local model is written into the config only after its Ollama installation has been confirmed. Local installation, uninstall, and orphan-removal actions are enabled by default and can be disabled individually with the opt-out flags below.

## CLI options

| Option | Meaning |
| --- | --- |
| `-y`, `--yes` | Apply without interactive confirmation. An explicit `--yes` is required to write in a non-TTY environment. |
| `--dry-run` | Preview recommendations without writing the config or changing local models. |
| `--flush-cache` | Clear cached policy-excluded model references before probing. |
| `--global` | Use the global OpenCode config instead of a project config. |
| `--cloud-only` | Skip GPU, Ollama, and local-model discovery. Hidden alias: `--exclude-local`. |
| `--local-only` | Skip cloud discovery and API checks. Hidden alias: `--exclude-cloud`. |
| `--interactive` | Force interactive prompts in a non-TTY environment. |
| `--free-config` | Explicitly include zero-cost models; this is already the default. |
| `--no-free-config` | Exclude models identified as zero-cost by cost metadata. |
| `--exclude-model <ref>` | Exclude a provider or one `provider/model` reference. Repeat the option for multiple exclusions. |
| `--no-install` | Do not install recommended local Ollama models. |
| `--no-uninstall` | Do not remove local models marked as conflicting or superseded. |
| `--no-remove-orphans` | Do not remove installed Ollama models outside the retained decisions. |
| `--no-apply` | Show the final recommendations without writing them. |
| `--agy-analysis` | Use the AGY CLI for eligible model-fitness ranking instead of OpenCode evaluators. |
| `--codex-analysis` | Use the Codex CLI for eligible model-fitness ranking instead of OpenCode evaluators. |
| `--debug` | Print stack traces for errors. |
| `--verbose` | Show executed commands and complete subprocess output. |
| `-h`, `--help` | Show help. |
| `-v`, `--version` | Show the package version. |

`--cloud-only` and `--local-only` are mutually exclusive.

## Validate a configuration

The companion command validates the JSONC syntax and the model-placement subset written by this package:

```bash
npx omo-validate-config
npx omo-validate-config --config /path/to/oh-my-openagent.jsonc
npx omo-validate-config --global
npx omo-validate-config --fix
```

Options:

| Option | Meaning |
| --- | --- |
| `--config <path>` | Validate a specific config file. |
| `--global` | Validate the global config path. |
| `--fix` | Apply safe mechanical fixes. When changes are written, the original is copied to `<path>.bak`. |
| `-h`, `--help` | Show help. |

The validator checks JSONC parsing, the required schema value, agent and category section shapes, `provider/model` syntax, known providers/models when discovery facts are available, and supported placement options.

Exit codes are:

| Code | Meaning |
| --- | --- |
| `0` | Valid, including a successful fix. |
| `1` | File read, JSONC parse, or validation failure. |
| `2` | Invalid command-line arguments. |

`omo-recommend-models` invokes this validator after writing. On failure, it restores the `.pre-recommend` copy when one exists and reports when no prior backup is available.

## Development

```bash
npm test
npm run lint
npm run pack:check
```

- `npm test` runs the Node test suite.
- `npm run lint` checks the executable and library JavaScript with ESLint.
- `npm run pack:check` previews the npm package contents.
