> **Work-package status:** follow this package’s linked Bead/GitHub tracker. It is
> not part of Decision 25’s static P0→N1 critical path, but Decision 25 does not
> cancel it. AgentHost/D1-dependent passages must be recut before dispatch.

# P7-multi-agent-inspection — Handoff checklist

Derived strictly from [TODO.md](./TODO.md) and [PLAN.md](./PLAN.md). Tick each before calling this package done. Invent nothing.

## Prerequisites (packages + gates)
- [ ] P6-R stateless resolved-value contract merged — [../P6-plugin-child-app/P6-V1-HANDOFF.md](../P6-plugin-child-app/P6-V1-HANDOFF.md)
- [ ] E1-environment-attachments merged — [../E1-environment-attachments/HANDOFF.md](../E1-environment-attachments/HANDOFF.md)
- [ ] T2-transport merged — [../T2-transport/HANDOFF.md](../T2-transport/HANDOFF.md)
- [ ] P7 BBP7-002 is explicitly authorized as the first named consumer to add
      one host-owned multi-agent registry; it must not move registry ownership
      into P6-R or create competing registries.

## Owner questions / verdict
- OWNER-QUESTIONS: none.
- GO/NO-GO: GO after stateless P6-R, E1, and T2 are merged; BBP7-002 then creates
  the single minimal P7 host registry.

## Beads
- [ ] BBP7-001 — Thread `agentId` through `RuntimeScope`, the scope key, and `sessionNamespace`
- [ ] BBP7-002 — P7 host registry of stateless P6-R entries + `agentId` request addressing
- [ ] BBP7-003 — Per-agent tool catalog + per-agent readiness
- [ ] BBP7-004 — Derived `agent.db` session index/search scoped by workspace + agent (#379)
- [ ] BBP7-005 — Agent list + inspection endpoints (the steering mechanism)
- [ ] BBP7-006 — External harness hook target resolution (#380)
- [ ] BBP7-007 — Surface adapters bind one `agentId` per addressing entry
- [ ] BBP7-008 — Subagent environment grant (first real consumer; lands E1 BBE1-005)
- [ ] BBP7-009 — Two surfaces × two agents no-collision integration test (Phase 7 exit)

## Verification commands
- [ ] `pnpm --filter @hachej/boring-agent run test`
- [ ] `pnpm --filter @hachej/boring-agent run typecheck`
- [ ] `pnpm --filter @hachej/boring-agent run lint:invariants`
- [ ] `pnpm --filter @hachej/boring-agent run check:isolation`
- [ ] `pnpm --filter @hachej/boring-bash run test`
- [ ] `pnpm --filter @hachej/boring-bash run typecheck`
- [ ] `pnpm --filter @hachej/boring-bash run check:invariants`
- [ ] `pnpm --filter @hachej/boring-workspace run typecheck`
- [ ] `pnpm --filter @hachej/boring-workspace run test`
- [ ] `pnpm lint:invariants`
- [ ] `pnpm audit:imports`
- [ ] `pnpm typecheck`

## PR-PLAN reconciliation
- [ ] `pr1-agentid-scope-namespace` completed BBP7-001
- [ ] `pr2-agentid-addressing` completed BBP7-002
- [ ] `pr3-per-agent-catalog-readiness` completed BBP7-003
- [ ] `pr4-session-search` completed BBP7-004
- [ ] `pr5-agent-info-endpoint` completed BBP7-005
- [ ] `pr6-external-hook-target` completed BBP7-006
- [ ] `pr7-surface-agent-binding` completed BBP7-007
- [ ] `pr8-subagent-grant` completed BBP7-008, or explicitly combined with pr7 within PR-PLAN budget
- [ ] `pr9-two-surface-isolation` completed BBP7-009

## Review gates
- [ ] Exactly one P7 host registry exists; its entries are stateless P6-R
      outputs, and P6-R owns no registry/pointer/generation state.
- [ ] `agentId` in the `RuntimeScope.key` array for all agents; `sessionNamespace` carries `agentId` only for non-default agents, and default-agent sessions load unchanged (on-disk JSONL compat).
- [ ] Per-agent tool catalog + readiness with zero cross-agent bleed (`05` Tests reproduced).
- [ ] Session search scoped by trusted workspace+agent, served from a rebuildable derived `agent.db` table, no fs requirement, redaction enforced.
- [ ] External hook routes onto the single T1 approval channel; boring-bash-free; authenticates/validates/redacts/audits.
- [ ] `/api/v1/agents` and `/api/v1/agents/:agentId/info` are public, private-hook-free, and leak no secret/key material (assert in test).
- [ ] One addressing entry ↔ one `agentId`; T2 platform-addressing guard stays green (`agentId`/`sessionId`/`SessionCtx` only in core signatures).
- [ ] Subagent grant is minimal, explicit-attachment-only, `execPolicy:'none'`, isolated by `agentId`.
- [ ] Two-surfaces × two-agents no-collision test present and green.
- [ ] Any transitional code carries `TODO(remove:<bead-id>)` naming its deletion-owner bead; a later owner is allowed only when explicitly named per [INDEX.md](../../INDEX.md), and no marker outlives its named owner's phase.

## Exit criteria
- [ ] Agent addressing resolves an `agentId` per request via the canonical
      `/api/v1/agents/:agentId/...` path prefix against the P7 host registry;
      unknown/undeclared `agentId` fails closed.
- [ ] `agentId` is in the binding scope `key` for all agents; `sessionNamespace`
      carries it only for non-default agents. `sessionId` remains the public
      runtime-owned handle, while event/replay access uses T1's server-only
      encoded structured `SessionKey` including authenticated scope/subject/
      agent. Duplicate public ids across scopes cannot collide or authorize.
- [ ] Per-agent tool catalog and per-agent readiness (reviewer readonly/no-exec; coding agent has bash; pure concierge has no boring-bash).
- [ ] Session index/search scoped by trusted workspace+agent, served from a rebuildable derived `agent.db` table, no filesystem requirement.
- [ ] External harness hook target resolution: authenticate caller, validate `(workspace, agent, session)`, redact, route to the HITL channel, audit attribution, no boring-bash dep.
- [ ] `GET /api/v1/agents` returns a scrubbed declared-agent list, and `GET /api/v1/agents/:agentId/info` returns `{ agentId, model, tools, readiness, channels, environments }` — public contracts, no private core hooks.
- [ ] Surface adapters each bind exactly one `agentId` per addressing entry.
- [ ] First real subagent consumer: `SubagentEnvironmentGrant` /
      `deriveSubagentAttachment` lands, jailed by child lifetime `agentId` +
      `scope.subpath`; every operation uses E1 `withAuthorizedView`, no raw
      prepared handle.
- [ ] Two surfaces × two agents in one workspace do not collide by namespace/scope/metadata (the Phase 7 exit test); no implementation relies on duplicate `sessionId` strings across agents.

## Closeout
- [ ] Zero unowned `TODO(remove:*)` markers for this phase
- [ ] PRs merged per [PR-PLAN.md](../../PR-PLAN.md) (this package's section)
