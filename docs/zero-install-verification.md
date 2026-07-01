# Zero-Install Verification

Generated: 2026-07-01

## Package Under Test

- Package: `omo-recommend-models`
- Version: `1.7.9`
- Tarball: `/tmp/opencode/omo-wave6/omo-recommend-models-1.7.9.tgz`
- Pack command: `npm pack --pack-destination /tmp/opencode/omo-wave6`
- Pack result: 86 files, including `bin/`, `lib/`, `README.md`, and `lib/recommend/finalized-recommendations.js`

`package.json` ships two binaries and no runtime dependencies:

- `omo-recommend-models`
- `omo-validate-config`

## Clean-Room Setup

All commands were run from fresh directories under `/tmp/opencode/omo-wave6/` without a local project `node_modules` directory.

Use `npx --package <tarball> <bin>` for local tarballs. Direct `npx <tarball>` was rejected with `Permission denied`, which is npm invocation behavior rather than a package runtime dependency issue.

## Verified Commands

### Cloud-only dry run

```bash
npx --yes --package /tmp/opencode/omo-wave6/omo-recommend-models-1.7.9.tgz omo-recommend-models --dry-run --cloud-only --yes
```

Result: passed.

Evidence:

- Skipped GPU, Ollama, and local catalog discovery due to `--cloud-only`.
- Loaded provider cache.
- Verified paid model availability with bounded model counters, ending at `done 58/58`.
- Printed recommended provider/model configurations.
- Ended with `Dry run mode enabled; no changes have been applied.`

### Local-only dry run

```bash
npx --yes --package /tmp/opencode/omo-wave6/omo-recommend-models-1.7.9.tgz omo-recommend-models --dry-run --local-only --yes
```

Result: passed.

Evidence:

- Skipped cloud provider loading due to `--local-only`.
- Checked GPU and Ollama availability.
- Printed recommended provider/model configurations.
- Ended with `Dry run mode enabled; no changes have been applied.`

### Help output

```bash
npx --yes --package /tmp/opencode/omo-wave6/omo-recommend-models-1.7.9.tgz omo-recommend-models --help
```

Result: passed.

Evidence: help lists current supported flags including `--dry-run`, `--cloud-only`, `--local-only`, `--exclude-opencode`, and `--ai-panel`.

### Config validator

```bash
npx --yes --package /tmp/opencode/omo-wave6/omo-recommend-models-1.7.9.tgz omo-validate-config
```

Result: passed with a minimal `.opencode/oh-my-openagent.jsonc` containing schema, agent description, and empty categories.

Evidence:

```text
Config valid: /tmp/opencode/omo-wave6/clean-validate/.opencode/oh-my-openagent.jsonc
```

## Obsolete Plan Flags

The original Wave 6 plan mentioned `--rules-default` and `--rebalance`. The packaged CLI rejected both as unknown options:

```text
Error: unknown option '--rules-default'
Error: unknown option '--rebalance'
```

These are not current CLI flags and should not be used as release gates unless they are intentionally reintroduced.

## Conclusion

The packaged CLI runs from clean directories through `npx --package <tarball>` without local `node_modules` and without triggering a project install. The current supported dry-run modes and both shipped binaries were verified.
