> **Work-package status:** retained research and non-dispatchable until this
> child issue’s canonical plan and Bead graph are recut under Decision 26.
> Stale readiness, Decision 25 P0→N1, and AgentHost/D1 passages have no authority.

# M2-mcp-agent-surface - Handoff checklist

Status: **historical, non-dispatchable checklist**. M2 must be recut after M1
and AR1 per [`PLAN.md`](PLAN.md) and [`../../../plan.md`](../../../../391/runtime-refactor/INDEX.md); the
P7 and T1/T2 gates below are superseded.

Derived strictly from [TODO.md](TODO.md) and [PLAN.md](PLAN.md). Tick each
before calling M2 done. Invent nothing.

## Prerequisites

- [ ] P6-R `ResolvedAgent`, `AgentDeployment`, and resolved-agent lookup merged.
- [ ] P7 agent list/info endpoints merged.
- [ ] T1/T2 public transport merged.

## Beads

- [ ] BBM2-001 - Deployment/host-owned MCP exposure config.
- [ ] BBM2-002 - MCP surface adapter over T1/T2 transport.
- [ ] BBM2-003 - Auth modes and demo policy.
- [ ] BBM2-004 - Result/share URL shape + conformance.

## Verification commands

- [ ] `pnpm --filter @hachej/boring-agent run build`
- [ ] `pnpm --filter @hachej/boring-agent run typecheck`
- [ ] `pnpm --filter @hachej/boring-agent run test`
- [ ] Host-specific build/typecheck/test/e2e commands.
- [ ] `pnpm audit:imports`

## PR-PLAN reconciliation

- [ ] `pr1-mcp-exposure-config` completed BBM2-001.
- [ ] `pr2-mcp-surface-adapter` completed BBM2-002.
- [ ] `pr3-auth-demo-policy` completed BBM2-003.
- [ ] `pr4-result-share-conformance` completed BBM2-004.

## Review gates

- [ ] MCP behavior derives from `ResolvedAgent`; exposure config derives from
      `AgentDeployment` and host policy, never `AgentDefinition`.
- [ ] Unknown deployment exposure refs fail closed.
- [ ] No hardcoded production demo verticals outside fixtures.
- [ ] Bearer/public-demo modes fail closed.
- [ ] P7 registry/info and T1/T2 transport are the only agent/session seams used.
- [ ] Caller idempotency key is scoped by bearer subject or host-issued demo
      principal plus exposure/tenant/agent, mapped to T1 requestId, and deduped
      before quota; changed tool-call id cannot duplicate a run.
- [ ] M1 byte ceilings remain enforced for brief/key/progress/retention/poll/
      final/artifact/serialized result, with exact boundary tests; config may
      only lower them.
- [ ] Result/share payloads contain no secrets, absolute paths, workspace roots, or session roots.

## Exit criteria

- [ ] Stock MCP client connects to a per-agent endpoint by `agentId`.
- [ ] Delegation creates one session across lost-response retry and streams
      bounded progress.
- [ ] Result/share URL shape is stable and safe.

## Closeout

- [ ] Zero unowned `TODO(remove:*)` markers for this package.
- [ ] PRs merged per [PR-PLAN.md](../../../../391/runtime-refactor/PR-PLAN.md).
