> **#391 status (2026-07-17): historical reference / non-dispatchable.**
>
> Active authority: `docs/issues/391/plan.md` and Decision 25 in
> `docs/DECISIONS.md`. Where this file conflicts, the active authority wins.

# E2-mcp-projection — Handoff checklist

Status: **historical, non-dispatchable checklist**. E2 must be recut after M1,
AR1, and the M2 recut per [`PLAN.md`](./PLAN.md) and
[`../../INDEX.md`](../../INDEX.md); the generic E1/catalog gates below are
superseded.

Derived strictly from [TODO.md](./TODO.md) and [PLAN.md](./PLAN.md). Tick each before calling this package done. Invent nothing.

## Prerequisites (packages + gates)
- [ ] E1-environment-attachments merged — [../E1-environment-attachments/HANDOFF.md](../E1-environment-attachments/HANDOFF.md)
- [ ] P6-R injected `DeploymentAttachmentCatalog` merged.
- [ ] E1 auth-gated contributions + scoped views landed; E2 receives no raw
      prepared handle or long-lived projection operation.

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

## PR-PLAN reconciliation
- [ ] `pr1-mcp-server-exec-gating` completed BBE2-001 + BBE2-004
- [ ] `pr2-mcp-session-identity` completed BBE2-002
- [ ] `pr3-mcp-conformance-doc` completed BBE2-003 + BBE2-005

## Review gates
- [ ] Grep handlers: every fs/exec call authenticates, enters an E1 contribution
      `withAuthorizedView` callback, and only then reaches existing projection
      ops; zero raw op/handle/lease retention or new path policy.
- [ ] Readonly attachment registers exactly the read-family tools; readwrite adds write/edit; exec only under `execPolicy: 'attached'`.
- [ ] Conformance mount reuses the same expected visible-path set as in-process (diff the subject seeds).
- [ ] No broker secret is present in any client-reachable MCP payload (assert in BBE2-004).
- [ ] `@modelcontextprotocol/sdk` pinned to an exact `1.29.0` (no caret), matching the pack's exact-pin discipline.
- [ ] Expired/revoked/foreign token and invalidated lifetime fail on the next
      operation even after MCP session establishment.
- [ ] E2 consumes the injected P6-R lookup and creates no second environment Map.
- [ ] Factory derives facts/policy/contributions from one catalog-selected entry;
      no API can pair one attachment ref with another lifetime's contributions.
- [ ] Caller supplies trusted scope, never a lifetime key; catalog derives and
      E1 verifies the attachment-set digest before cache reuse.

## Exit criteria
- [ ] An external MCP client (e.g. Claude Code) mounts a boring environment and sees exactly what an in-process readonly attachment sees.
- [ ] Denied files are absent over MCP (no-leak).
- [ ] No broker secret is reachable from the MCP client.
- [ ] Every operation gets a fresh authorized callback-scoped lease; none can be
      reused after settlement.
- [ ] The existing no-leak conformance suite runs as the MCP mount (alongside in-process and scoped-view; the remote-worker provider mount deferred to BBP5-010).
- [ ] Remote-worker stays a provider (P2/P5); its transport reclassification is filed as a deferred post-E2 P8 follow-up, not performed (BBE2-005).

## Closeout
- [ ] Zero unowned `TODO(remove:*)` markers for this phase
- [ ] PRs merged per [PR-PLAN.md](../../PR-PLAN.md) (this package's section)
