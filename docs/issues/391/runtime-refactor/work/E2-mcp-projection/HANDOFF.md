# E2-mcp-projection — Handoff checklist

Derived strictly from [TODO.md](./TODO.md) and [PLAN.md](./PLAN.md). Tick each before calling this package done. Invent nothing.

## Prerequisites (packages + gates)
- [ ] E1-environment-attachments merged — [../E1-environment-attachments/HANDOFF.md](../E1-environment-attachments/HANDOFF.md)
- [ ] E1's attachment contracts + scoped views landed (`Environment`, `EnvironmentAttachment`, `ResolvedEnvironments`, `resolveAttachments`) before starting

## Beads
- [ ] BBE2-001 — MCP server projection factory
- [ ] BBE2-002 — MCP session → `BoundFilesystemContext` identity (token-per-projection v1)
- [ ] BBE2-003 — No-leak conformance as the MCP mount
- [ ] BBE2-004 — Exec-over-MCP gating
- [ ] BBE2-005 — File the remote-worker-as-transport follow-up (do NOT reclassify here)

## Verification commands
- [ ] `pnpm --filter @hachej/boring-bash run build`
- [ ] `pnpm --filter @hachej/boring-bash run typecheck`
- [ ] `pnpm --filter @hachej/boring-bash run check:invariants`
- [ ] `pnpm --filter @hachej/boring-bash run test`
- [ ] `pnpm run build:packages`
- [ ] `pnpm audit:imports`
- [ ] `pnpm run test`

## Review gates
- [ ] Grep the new MCP handlers: every fs/exec handler calls an existing projection op — zero new jailing/readonly/traversal logic.
- [ ] Readonly attachment registers exactly the read-family tools; readwrite adds write/edit; exec only under `execPolicy: 'attached'`.
- [ ] Conformance mount reuses the same expected visible-path set as in-process (diff the subject seeds).
- [ ] No broker secret is present in any client-reachable MCP payload (assert in BBE2-004).
- [ ] `@modelcontextprotocol/sdk` pinned to an exact `1.29.0` (no caret), matching the pack's exact-pin discipline.

## Exit criteria
- [ ] An external MCP client (e.g. Claude Code) mounts a boring environment and sees exactly what an in-process readonly attachment sees.
- [ ] Denied files are absent over MCP (no-leak).
- [ ] No broker secret is reachable from the MCP client.
- [ ] The existing no-leak conformance suite runs as the MCP mount (alongside in-process and scoped-view; the remote-worker provider mount deferred to BBP5-010).
- [ ] Remote-worker stays a provider (P2/P5); its transport reclassification is filed as a deferred post-E2 P8 follow-up, not performed (BBE2-005).

## Closeout
- [ ] Zero unowned `TODO(remove:*)` markers for this phase
- [ ] PRs merged per [PR-PLAN.md](../../PR-PLAN.md) (this package's section)
