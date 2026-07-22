# Choose a project or global configuration

Use the default project scope for repository-specific model placements. Use `--global` when the same placements should apply through your user-level OpenCode configuration.

## Use a project configuration

Run the CLI from the project or one of its subdirectories:

```bash
npx omo-recommend-models --dry-run --cloud-only
```

Without `--global`, the CLI walks upward from the current directory. At each level, it checks for these existing files in order:

1. `.opencode/oh-my-openagent.jsonc`
2. `.opencode/oh-my-openagent.json`

If neither file exists, the first directory containing `workshop.yaml` or `.gitignore` anchors a new `.opencode/oh-my-openagent.jsonc`. If no anchor is found, the current directory is used.

Review the target path in the preview before applying:

```bash
npx omo-recommend-models --cloud-only --yes
```

## Use the global configuration

Add `--global` to every recommendation command that should target the user-level file:

```bash
npx omo-recommend-models --dry-run --cloud-only --global
npx omo-recommend-models --cloud-only --global --yes
```

The global path is:

```text
~/.config/opencode/oh-my-openagent.jsonc
```

> [!WARNING]
> The current recommendation-failure handler always uses project path resolution. If recommendation generation fails when no project configuration exists, it can write the configuration loaded for the run to a project path even during a `--global` or `--dry-run` invocation. This can copy an existing global configuration into the project. Check the project worktree after a failed run.

Validate the same scope with:

```bash
npx omo-validate-config --global
```

## Check the backup path

When the target file already exists, an apply run copies it to the same path with `.pre-recommend` appended.

| Scope | Configuration | Backup |
| --- | --- | --- |
| Project | Resolved `.opencode/oh-my-openagent.jsonc` or existing `.opencode/oh-my-openagent.json` | `<resolved-path>.pre-recommend` |
| Global | `~/.config/opencode/oh-my-openagent.jsonc` | `~/.config/opencode/oh-my-openagent.jsonc.pre-recommend` |

> [!IMPORTANT]
> Keep the same scope flag through preview, apply, validation, and recovery. Otherwise, each command can resolve a different file.

For recovery procedures, see [Validate, fix, and recover a configuration](validate-and-recover.md).
