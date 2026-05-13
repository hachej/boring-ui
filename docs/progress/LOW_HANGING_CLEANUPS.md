# Low-Hanging Cleanup Tracker

Branch: `cleanup/low-hanging`

Goal: reduce large-file pressure and abstraction leaks through small, behavior-preserving cleanups. Each task gets an Oracle review before moving to the next task.

## Tasks

| ID | Status | Scope | Review |
| --- | --- | --- | --- |
| LH-01 | done | Extract pure ChatPanel helpers: attachment URL/text helpers, friendly error formatting, model/thinking storage helpers. | Oracle: ship |
| LH-02 | done | Extract ChatPanel model/provider display label helpers into a focused module. | Oracle: ship |
| LH-03 | done | Extract ChatPanel message rendering helpers/components where safe without changing behavior. | Oracle: ship |
| LH-04 | done | Extract pure CommandPalette helpers into a focused module. | Oracle: ship |
| LH-05 | done | Add generated-artifact guard script to detect accidentally tracked build outputs. | Oracle: ship after one revise round |

## Verification

Final focused checks passed:

- `pnpm check:generated-artifacts`
- `pnpm --filter @hachej/boring-agent run typecheck`
- `pnpm --filter @hachej/boring-workspace run typecheck`
- `git diff --check`

Final size markers:

- `packages/agent/src/front/ChatPanel.tsx`: 1619 lines
- `packages/workspace/src/front/components/CommandPalette.tsx`: 540 lines

## Notes

- Keep changes behavior-preserving.
- Prefer pure helper/module extraction over layout rewrites.
- Run focused typecheck after each implementation batch.
- Ask Oracle to review each task before marking reviewed.
