# Run recommendations in CI

Use explicit flags in CI so the run cannot depend on terminal detection or interactive input.

## Prepare credentials

Make the `opencode` CLI available in the job and provide credentials for every cloud provider that should be considered. Run from the repository whose project configuration should be updated, or add `--global` deliberately.

## Preview in a pull request

Run a cloud-only preview without interactive input:

```bash
npx omo-recommend-models --dry-run --cloud-only
```

In a non-TTY environment, omission of an explicit `--yes` also selects preview behavior unless `--interactive` is present. Keep `--dry-run` in CI configuration so the intent remains visible to reviewers.

Do not add `--interactive` to an unattended job as a safety mechanism. If standard input reaches EOF, default-yes confirmations are accepted, so configuration apply and default-yes cleanup can proceed without `--yes`.

Capture the command output as a job artifact or log. Review the target path and proposed placements before enabling application.

Preview mode still makes authenticated discovery, probe, and evaluator requests. Give the job only the credentials and provider budget that it needs.

## Detect caught recommendation failures

Recommendation-generation failures are caught internally and can exit with code `0` after printing `AI recommendation failed:`. Do not use the process exit code as the only CI success condition.

Capture the output and fail the job when that message appears:

```bash
set -e -o pipefail
npx omo-recommend-models --dry-run --cloud-only 2>&1 | tee recommendation.log
if grep -Fq "AI recommendation failed:" recommendation.log; then
  exit 1
fi
```

Keep `recommendation.log` as a job artifact. Also confirm that the expected preview section or configuration diff exists before allowing an apply job to run.

## Apply in an approved job

Use an explicit `--yes` only in a job that is allowed to modify the selected configuration:

```bash
npx omo-recommend-models --cloud-only --yes
npx omo-validate-config
```

`--cloud-only` excludes local model operations. If local discovery is required but Ollama changes are not allowed, use:

```bash
npx omo-recommend-models --yes --no-install --no-uninstall --no-remove-orphans
```

> [!WARNING]
> Without the opt-out flags, `--yes` also authorizes enabled local installation, uninstall, and orphan-removal decisions. Do not use unattended local actions on a shared runner unless that state change is intentional.

## Pin exclusions in the job

Exclude a provider or exact model reference with repeatable options:

```bash
npx omo-recommend-models \
  --cloud-only \
  --yes \
  --exclude-model openrouter \
  --exclude-model google/example-model
```

Use `--no-free-config` when zero-cost models must not appear in the generated configuration:

```bash
npx omo-recommend-models --cloud-only --yes --no-free-config
```

For the complete option set, see the [`omo-recommend-models` command reference](../reference/recommend-models-cli.md).
