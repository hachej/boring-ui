> **Work-package status:** retained research and non-dispatchable until this
> child issue’s canonical plan and Bead graph are recut under Decision 26.
> Stale readiness, Decision 25 P0→N1, and AgentHost/D1 passages have no authority.

# TODO-M2 - MCP as an agent surface

Status: **historical, non-dispatchable work order**. Recut after M1 and AR1 per
[`PLAN.md`](PLAN.md) and [`../../../plan.md`](../../../../391/runtime-refactor/INDEX.md). The P7 and T1/T2
prerequisites below are superseded and must not be dispatched as written.

Coordinator: never assign this whole file. Dispatch one bead/PR with this
file's context, dependencies, and non-negotiables included in the assignment.

## Context (read first)

- Plan: [`PLAN.md`](PLAN.md)
- Ordering: [`../../../plan.md`](../../../../391/runtime-refactor/INDEX.md) Phase M2 and dependency graph.
- Architecture: [`../../architecture/08-pluggable-agent-surfaces.md`](../../../../391/runtime-refactor/architecture/08-pluggable-agent-surfaces.md), [`../../architecture/09-environments-attachable.md`](../../../../391/runtime-refactor/architecture/09-environments-attachable.md)
- Definitions: [`../P6-plugin-child-app/TODO.md`](../../../../805/runtime-refactor/work/P6-plugin-child-app/TODO.md) BBP6-009
- Registry/info: [`../P7-multi-agent-inspection/TODO.md`](../../../../805/runtime-refactor/work/P7-multi-agent-inspection/TODO.md)
- Transport: [`../T1-durable-events/TODO.md`](../../../../807/runtime-refactor/work/T1-durable-events/TODO.md), [`../T2-transport/TODO.md`](../../../../807/runtime-refactor/work/T2-transport/TODO.md)
- M1 predecessor: [`../M1-mcp-managed-agent/TODO.md`](../M1-mcp-managed-agent/TODO.md)

## Prerequisites - stop if false

- P6-R `ResolvedAgent`, `AgentDeployment`, and resolved-agent lookup exist.
- P7 `GET /api/v1/agents` and `GET /api/v1/agents/:agentId/info` exist.
- T1/T2 public transport exists and can create/send/reconnect by `sessionId`.
- If M1 code exists, any `ManagedAgentVerticalConfig` is treated as a temporary projection, not as source of truth.

## Goal / exit criteria

Expose declared agents as MCP servers by config. A stock MCP client can mount an
agent by `agentId`, authenticate through `bearer` or `public-demo` policy, submit
a brief, observe progress, and receive a safe result/share URL shape.
**Amendment (2026-07-08):** an agent exposed over MCP exposes its resolved
plugin-contributed tools through the delegate surface, subject to the same
no-secret and policy rules as built-in tools.

## Non-negotiables

- Do not define a second vertical-agent schema. Behavior comes from
  `ResolvedAgent`; exposure comes from `AgentDeployment` plus host policy.
- Do not expose raw workspace roots, session roots, environment handles, broker
  secrets, model keys, or raw transcripts.
- Do not expose plugin-contributed tools that are absent from the agent's
  resolved plugin set or denied by policy.
- Do not bypass P7 registry/info or T1/T2 transport.
- Public-demo access is policy-controlled by `demoPolicy`; it is never an
  unauthenticated backdoor to tenant data.
- **Amendment (2026-07-08):** `demoPolicy`/`exposureId` must be reusable as a
  per-tenant subdomain trial gate for D2, not only as a per-agent MCP mount.
- M2 exposes an agent over MCP. E2 exposes an environment over MCP. Keep those
  two authority models separate.

## Beads

### BBM2-001 - Deployment-owned MCP exposure config (M)

- **Files touch/create:** host/server types for `McpAgentExposureConfig` with
  `agentId`, `authMode: 'bearer' | 'public-demo'`, `demoPolicy`, `exposureId`,
  endpoint path/URL shape, result/share URL policy, redaction policy, and a
  D2-consumable per-tenant subdomain trial-gate projection.
- **Notes:** Resolve a validated `AgentDeployment` to its immutable
  `ResolvedAgent`, then apply the host-owned exposure config. Unknown agent,
  deployment exposure, exposure id, or policy ref fails closed. Definition data
  cannot request or enable exposure.
- **Tests:** deployment+host exposure config resolves to one MCP mount; a
  definition alone resolves to none; unknown deployment exposure refs reject
  with stable errors; fixture-only hardcoded verticals remain isolated from
  production config.
- **Acceptance:** per-agent MCP exposure is declarative host/deployment config,
  never reusable behavior.

### BBM2-002 - MCP surface adapter over T1/T2 transport (M/L)

- **Files touch/create:** MCP server adapter/route/package matching the repo's
  M1 location; use SDK transport patterns from M1/`plugins/boring-mcp` only as
  implementation references.
- **Notes:** `delegate_task` or equivalent calls the public agent transport:
  create/start, stream/reconnect, `resolveInput`, `interrupt`, and `stop`.
  Session tenancy is host-resolved; callers cannot supply raw `SessionCtx`.
  Preserve M1's admission contract: input requires caller-stable
  `idempotencyKey` (<=128 UTF-8 bytes, `[A-Za-z0-9._:-]+`), scoped by the
  authenticated bearer subject or a host-issued demo principal plus exposure/
  tenant/agent. Map it deterministically to T1 `requestId`. Existing-key lookup
  happens before rate/quota/concurrency; same payload returns the original and a
  mismatch conflicts. JSON-RPC/tool-call ids are never the retry identity.
- **Payload contract:** preserve M1's byte ceilings: brief 32 KiB; progress item
  4 KiB; retained progress 128 items/64 KiB; polling payload 96 KiB; final text
  96 KiB; inline Markdown/artifact payload 256 KiB; complete serialized result
  384 KiB. A deployment may configure lower limits, never higher without a new
  versioned surface contract. Use the same stable input/result/artifact errors.
- **Tests:** fake MCP client drives a declared agent; lost response followed by
  same key under a new JSON-RPC/tool-call id returns one session; same-key
  mismatch conflicts; dedupe precedes quota; bearer subjects and demo
  principals do not share key scope; reconnect/progress/approval works; every
  exact and over byte boundary is covered.
- **Acceptance:** MCP is a surface adapter over the public contract.

### BBM2-003 - Auth modes and demo policy (M)

- **Files touch/create:** auth middleware/policy resolver for `bearer` and
  `public-demo` modes.
- **Notes:** Bearer mode scopes to an authorized tenant/workspace. Public-demo
  mode uses `demoPolicy` limits (allowed tools, rate/expiry, data scope, share
  capability) and must not widen environment facts.
- **Tests:** bearer missing/invalid/foreign token rejected; public-demo allowed
  only under matching `demoPolicy`; policy denial returns stable errors.
- **Acceptance:** endpoint exposure is policy-bound and fail-closed.

### BBM2-004 - Result/share URL shape + conformance (M)

- **Files touch/create:** result serializer and conformance suite.
- **Notes:** Result payload shape includes final text and safe artifact/share
  references. It never returns absolute paths, internal session ids unless they
  are intended public handles, workspace roots, or broker secrets. Share URLs
  are emitted only through verified platform share contracts.
- Enforce the BBM2-002 byte budget after assembling URLs/artifacts and before
  storage/serialization. Share URLs do not exempt the aggregate limit.
- **Tests:** P7 registry + T1/T2 transport conformance path; secret canary absent;
  URL shape stable; public-demo and bearer mode both covered.
- **Acceptance:** stock-client smoke proves retry-stable delegate -> bounded
  progress -> bounded result/share URL without duplicate work or private data.

## Verification

Commands must be re-verified in the implementation PR based on the chosen host:

```bash
pnpm --filter @hachej/boring-agent run build
pnpm --filter @hachej/boring-agent run typecheck
pnpm --filter @hachej/boring-agent run test
pnpm audit:imports
```

Run host-specific build/typecheck/test/e2e commands for the app/package that
mounts the MCP endpoint.

## PR-PLAN reconciliation

- `pr1-mcp-exposure-config` -> BBM2-001.
- `pr2-mcp-surface-adapter` -> BBM2-002.
- `pr3-auth-demo-policy` -> BBM2-003.
- `pr4-result-share-conformance` -> BBM2-004.

## Review gates

- `ResolvedAgent` is the behavior source and deployment/host config is the
  exposure source; no second vertical schema and no definition-owned exposure.
- P7 registry/info and T1/T2 transport are consumed, not bypassed.
- Bearer and public-demo auth modes are both covered.
- Result/share URL payloads contain no raw paths or secrets.
- M1 projection, if present, is documented as temporary and derived.
