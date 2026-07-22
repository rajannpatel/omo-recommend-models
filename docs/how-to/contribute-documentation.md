# Contribute documentation

Add or update documentation in the Diátaxis section that matches the reader's need. This repository adapts the conventions audited from the [snap-pi-hole wiki](https://github.com/rajannpatel/snap-pi-hole/wiki) at commit `8e92b8c263d113eeb865403411429b2f85d4ede0` and the [pinned Canonical documentation style guide](https://github.com/canonical/documentation-style-guide/blob/b07525527427f1d177fb344dc7170adf91b8f0ae/docs/index.md).

## Choose one documentation type

Ask what the page should help the reader do:

| Reader need | Directory | Page approach |
| --- | --- | --- |
| Learn through a guided experience | `docs/tutorials/` | Lead to a complete result with verification and cleanup. |
| Complete a specific task | `docs/how-to/` | Start from the goal and give only the steps needed. |
| Look up exact facts | `docs/reference/` | Use tables and concise factual descriptions. |
| Understand concepts or tradeoffs | `docs/explanation/` | Explain rationale and boundaries without turning into a procedure. |

Do not combine multiple documentation types in one page. Link to another type when the reader needs a different mode.

## Structure the page

1. Add one sentence-case H1 title.
2. Open with the outcome or scope in one short paragraph.
3. Use sentence-case H2 sections in a logical sequence.
4. Add descriptive links to related pages where the reader changes task or mode.
5. Update the section index and `docs/index.md` when the page changes navigation.

Do not add a hand-maintained table of contents or explicit HTML anchors. GitHub renders a heading outline and stable anchors for these Markdown files.

## Follow the editorial conventions

- Use US English.
- Address the reader as “you” and use imperative verbs for instructions.
- Avoid first-person narrative.
- Keep headings and introductions concise.
- Put commands, paths, options, configuration keys, and literal values in backticks.
- Use `bash` fences for copyable commands without shell prompts.
- Use `text` fences for output and keep output separate from input.
- Explain placeholders immediately after the first command that uses them.
- Use descriptive link text instead of “here” or bare URLs.
- Avoid em dashes.

Use callouts only when the information warrants interruption:

- `WARNING` for data loss, state changes, or operational risk
- `IMPORTANT` for required sequencing or a hard constraint
- `NOTE` for a useful non-blocking caveat

## Verify the change

Check links and project quality gates:

```bash
for file in README.md $(rg --files docs -g '*.md'); do
  npx --yes markdown-link-check "$file" || exit 1
done
npm test
npm run lint
npm run pack:check
git diff --check
```

Read the rendered Markdown before requesting review. Confirm that commands are copyable, output is separate, callouts render correctly, and every page is reachable from the documentation indexes.
