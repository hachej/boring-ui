# TODO-M2 - MCP as an agent surface

Handoff: self-contained work order for one autonomous coding agent. Cite plan
files by relative path. No prior conversation assumed.

## Context (read first)

- Plan: [`PLAN.md`](./PLAN.md)
- Ordering: [`../../INDEX.md`](../../INDEX.md) Phase M2 and dependency graph.
- Architecture: [`../../architecture/08-pluggable-agent-surfaces.md`](../../architecture/08-pluggable-agent-surfaces.md), [`../../architecture/09-environments-attachable.md`](../../architecture/09-environments-attachable.md)
- Definitions: [`../P6-plugin-child-app/TODO.md`](../P6-plugin-child-app/TODO.md) BBP6-009
- Registry/info: [`../P7-multi-agent-inspection/TODO.md`](../P7-multi-agent-inspection/TODO.md)
- Transport: [`../T1-durable-events/TODO.md`](../T1-durable-events/TODO.md), [`../T2-transport/TODO.md`](../T2-transport/TODO.md)
- M1 predecessor: [`../M1-mcp-managed-agent/TODO.md`](../M1-mcp-managed-agent/TODO.md)

## Prerequisites - stop if false

- P6a `AgentDefinitionDeclaration` and `AgentRegistry` exist.
- P7 `GET /api/v1/agents` and `GET /api/v1/agents/:agentId/info` exist.
- T1/T2 public transport exists and can create/send/reconnect by `sessionId`.
- If M1 code exists, any `ManagedAgentVerticalConfig` is treated as a temporary projection, not as source of truth.

## Goal / exit criteria

Expose declared agents as MCP servers by config. A stock MCP client can mount an
agent by `agentId`, authenticate through `bearer` or `public-demo` policy, submit
a brief, observe progress, and receive a safe result/share URL shape.

## Non-negotiables

- Do not define a second vertical-agent schema. Config derives from
  `AgentDefinitionDeclaration` or a lossless projection.
- Do not expose raw workspace roots, session roots, environment handles, broker
  secrets, model keys, or raw transcripts.
- Do not bypass P7 registry/info or T1/T2 transport.
- Public-demo access is policy-controlled by `demoPolicy`; it is never an
  unauthenticated backdoor to tenant data.
- **Amendment (2026-07-08):** `demoPolicy`/`exposureId` must be reusable as a
  per-tenant subdomain trial gate for D2, not only as a per-agent MCP mount.
- M2 exposes an agent over MCP. E2 exposes an environment over MCP. Keep those
  two authority models separate.

## Beads

### BBM2-001 - Per-agent MCP exposure config from definitions (M)

- **Files touch/create:** shared/server types for `McpAgentExposureConfig` with
  `agentId`, `authMode: 'bearer' | 'public-demo'`, `demoPolicy`, `exposureId`,
  endpoint path/URL shape, result/share URL policy, redaction policy, and a
  D2-consumable per-tenant subdomain trial-gate projection.
- **Notes:** The config is derived from the canonical definition registry. Unknown
  `agentId`, exposure id, or policy ref fails closed.
- **Tests:** definition with exposure config resolves to one MCP mount; unknown
  refs reject with stable errors; fixture-only hardcoded verticals remain
  isolated from production config.
- **Acceptance:** per-agent MCP exposure is declarative config, not code wiring.

### BBM2-002 - MCP surface adapter over T1/T2 transport (M/L)

- **Files touch/create:** MCP server adapter/route/package matching the repo's
  M1 location; use SDK transport patterns from M1/`plugins/boring-mcp` only as
  implementation references.
- **Notes:** `delegate_task` or equivalent calls the public agent transport:
  create/start, stream/reconnect, `resolveInput`, `interrupt`, and `stop`.
  Session tenancy is host-resolved; callers cannot supply raw `SessionCtx`.
- **Tests:** fake MCP client drives a declared agent; one delegation creates one
  session; reconnect/progress works via T1/T2; approval request can be answered.
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
- **Tests:** P7 registry + T1/T2 transport conformance path; secret canary absent;
  URL shape stable; public-demo and bearer mode both covered.
- **Acceptance:** stock-client smoke proves delegate -> progress -> result/share
  URL without private data exposure.

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

- Definition registry is the source of truth; no second vertical schema.
- P7 registry/info and T1/T2 transport are consumed, not bypassed.
- Bearer and public-demo auth modes are both covered.
- Result/share URL payloads contain no raw paths or secrets.
- M1 projection, if present, is documented as temporary and derived.
