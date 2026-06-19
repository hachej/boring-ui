# MIGRATION

Migration notes for moving from legacy monorepo-integrated agent flows to
`@hachej/boring-agent` in v2.

## What Changes

v1-style app code typically mixed these concerns in one place:

- Chat UI
- Tool catalog wiring
- Filesystem behavior
- Sandbox/process execution

In v2, split responsibilities are intentional:

- `@hachej/boring-agent`: agent runtime, tool catalog, harness, sandbox/workspace
  adapters, and the chat UI (`ChatPanel`).
- `@hachej/boring-workspace`: IDE-style layout/panes plus the UI-bridge tools
  (`exec_ui`, `get_ui_state`) and `/api/v1/ui/*` routes.
- App shell: final composition, mode selection, and product policy.

## Practical Migration Steps

1. Move chat/runtime logic into `@hachej/boring-agent` integration points.
2. Keep editor/file-tree/layout code in `@hachej/boring-workspace` or your own UI.
3. Route all filesystem and command execution through runtime mode adapters.
4. Replace ad-hoc shared types with imports from `@hachej/boring-agent/shared`.
5. Keep server-only code in server entry points; avoid server imports in
   frontend/shared paths.

## Runtime Mode Migration

All three modes ship: `direct`, `local` (`bwrap`), and `vercel-sandbox`. Select
via `mode` in `createAgentApp` or the `BORING_AGENT_MODE` env var. Keep your
integration surface mode-agnostic so adapter swaps are non-breaking. See
[runtime.md](./runtime.md).

## Contract Hygiene Checklist

- No `node:*` imports in `src/shared/**`.
- No `Buffer` in shared contracts (`Uint8Array` only).
- Keep session/tool/workspace behavior aligned with `@hachej/boring-agent/shared`.

## References

- Runtime modes: [runtime.md](./runtime.md)
- API surface: [API.md](./API.md)
- README quickstart/context: `../README.md`
- Historical design notes: `docs/plans/archive/` (archival; not current truth)
