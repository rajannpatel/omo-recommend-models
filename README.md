# omo-recommend-models

`omo-recommend-models` creates point-in-time model recommendations for OpenCode OMO agent and category entries. It discovers the models currently available to you, checks cloud reachability and optional local capacity, then previews or writes `model` and `fallback_models` in `oh-my-openagent.jsonc`.

This package prepares configuration. It does not execute runtime fallbacks, route requests between models, retry HTTP failures, or resume interrupted conversations; those behaviors belong to the runtime that consumes the generated configuration.

## Requirements

- Node.js 18 or newer.
- The `opencode` CLI, available on `PATH` and authenticated for the cloud providers you want discovered and probed.
- Optional: Ollama and supported GPU inspection tools for local-model discovery. Use `--cloud-only` when local discovery is not needed.

## Quick start

Preview cloud-only recommendations:

```bash
npx omo-recommend-models --dry-run --cloud-only
```

Build a fresh cloud-only recommendation and apply it without prompts:

```bash
npx omo-recommend-models --cloud-only --yes
```

> [!IMPORTANT]
> `--yes` authorizes every enabled action. The example uses `--cloud-only`, so the run does not install or remove local models.

The apply command repeats discovery, probing, and selection against current state. Its result can differ from an earlier preview.

In a non-TTY environment, omission of an explicit `--yes` selects preview behavior automatically unless `--interactive` is present. Do not use `--interactive` as an unattended safety guard: when standard input is at EOF, default-yes confirmations are accepted, so configuration apply and other default-yes actions can proceed without `--yes`.

To run a local checkout:

```bash
git clone https://github.com/rajannpatel/omo-recommend-models.git
cd omo-recommend-models
npm install
node ./bin/omo-recommend-models --dry-run --cloud-only
```

## Documentation

The [documentation home](docs/index.md) organizes the project by reader need:

- [Create your first recommendation](docs/tutorials/first-recommendation.md)
- [Complete common tasks](docs/how-to/index.md)
- [Look up commands and configuration](docs/reference/index.md)
- [Understand selection and rollback boundaries](docs/explanation/index.md)

The command references are:

- [`omo-recommend-models`](docs/reference/recommend-models-cli.md)
- [`omo-validate-config`](docs/reference/validate-config-cli.md)

## Development

```bash
npm test
npm run lint
npm run pack:check
```

- `npm test` runs the Node test suite.
- `npm run lint` checks the executable and library JavaScript with ESLint.
- `npm run pack:check` previews the npm package contents.
