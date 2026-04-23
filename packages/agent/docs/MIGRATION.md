# MIGRATION

Migration notes for moving from legacy monorepo-integrated agent flows to
`@boring/agent` in v2.

## What Changes

v1-style app code typically mixed these concerns in one place:

- Chat UI
- Tool catalog wiring
- Filesystem behavior
- Sandbox/process execution

In v2, split responsibilities are intentional:

- `@boring/agent`: runtime contracts + tool/harness/sandbox layers.
- `@boring/workspace`: IDE-style layout package (frontend-only).
- App shell: final composition, mode selection, and product policy.

## Practical Migration Steps

1. Move chat/runtime logic into `@boring/agent` integration points.
2. Keep editor/file-tree/layout code in `@boring/workspace` or your own UI.
3. Route all filesystem and command execution through runtime mode adapters.
4. Replace ad-hoc shared types with imports from `@boring/agent/shared`.
5. Keep server-only code in server entry points; avoid server imports in
   frontend/shared paths.

## Runtime Mode Migration

Current scaffold status:

- `direct` mode is available.
- `local` (`bwrap`) and `vercel-sandbox` are planned.

If you are migrating today, target `direct` first and keep your integration
surface mode-agnostic so later adapter swaps are non-breaking.

## Contract Hygiene Checklist

- No `node:*` imports in `src/shared/**`.
- No `Buffer` in shared contracts (`Uint8Array` only).
- Keep UI commands flowing through `UiBridge.postCommand`.
- Keep session/tool/workspace behavior aligned with `@boring/agent/shared`.

## References

- Agent spec + migration design rationale: `docs/plans/agent-package-spec.md`
- README quickstart/context: `../README.md`
