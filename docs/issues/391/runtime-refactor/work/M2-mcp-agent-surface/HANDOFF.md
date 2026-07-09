# M2-mcp-agent-surface - Handoff checklist

Derived strictly from [TODO.md](./TODO.md) and [PLAN.md](./PLAN.md). Tick each
before calling M2 done. Invent nothing.

## Prerequisites

- [ ] P6a `AgentDefinitionDeclaration` + `AgentRegistry` merged.
- [ ] P7 agent list/info endpoints merged.
- [ ] T1/T2 public transport merged.

## Beads

- [ ] BBM2-001 - Per-agent MCP exposure config from definitions.
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

- [ ] MCP exposure config derives from `AgentDefinitionDeclaration`.
- [ ] No hardcoded production demo verticals outside fixtures.
- [ ] Bearer/public-demo modes fail closed.
- [ ] P7 registry/info and T1/T2 transport are the only agent/session seams used.
- [ ] Result/share payloads contain no secrets, absolute paths, workspace roots, or session roots.

## Exit criteria

- [ ] Stock MCP client connects to a per-agent endpoint by `agentId`.
- [ ] Delegation creates one session and streams progress.
- [ ] Result/share URL shape is stable and safe.

## Closeout

- [ ] Zero unowned `TODO(remove:*)` markers for this package.
- [ ] PRs merged per [PR-PLAN.md](../../PR-PLAN.md).
