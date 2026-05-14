# Low-Hanging Cleanup Batch 3

Branch: `cleanup/low-hanging`

Process used: one task at a time, focused checks, subagent review with `ship`, commit, then move on. Working checklist was kept at `/tmp/boring-ui-low-hanging-batch3-todo.md` per request.

## Tasks

| ID | Status | Scope | Review | Commit |
| --- | --- | --- | --- | --- |
| B3-01 | done | Add/align file-search glob contract tests for agent mention search and workspace search semantics. | reviewer: ship | `8b9a479d` |
| B3-02 | skipped | Check whether image attachment display regression is already fixed on `main`. | no main delta found for relevant files | n/a |
| B3-03 | done | Extract ChatPanel submit/enrichment logic into a focused helper. | reviewer: ship | `b13a6aba` |
| B3-04 | done | Extract ChatPanel model/skills fetching effects into focused hooks. | reviewer: ship | `e0ff672f` |
| B3-05 | done | Extract PromptInput attachment provider logic. | reviewer: ship | `939904e5` |
| B3-06 | done | Extract CommandPalette keyboard/open-close behavior into a focused hook. | reviewer: ship | `7380437d` |
| B3-07 | done | Document temporary `@file` abstraction leak and issue #26. | reviewer: ship | `2708b230` |

## Final verification

- `pnpm check:generated-artifacts`
- `pnpm --filter @hachej/boring-agent exec vitest run src/front/primitives/__tests__/mention-picker.test.tsx src/front/__tests__/ChatPanel.test.tsx src/front/primitives/__tests__/prompt-input-upload.test.tsx`
- `pnpm --filter @hachej/boring-workspace exec vitest run src/plugins/filesystemPlugin/front/__tests__/search.test.ts src/front/components/__tests__/CommandPalette.test.tsx`
- `pnpm --filter @hachej/boring-agent run typecheck`
- `pnpm --filter @hachej/boring-workspace run typecheck`
- `git diff --check`

## Notes

- `origin/main` had no newer relevant commits for ChatPanel/prompt-input/CommandPalette versus this branch when B3-02 was checked.
- Issue #26 tracks the larger package-boundary fix for moving `@file` mentions into a workspace-provided composer extension.
