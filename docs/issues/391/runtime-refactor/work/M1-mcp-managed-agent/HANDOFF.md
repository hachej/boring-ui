# M1-mcp-managed-agent - Handoff checklist

Derived strictly from [TODO.md](./TODO.md) and [PLAN.md](./PLAN.md). Tick each before calling M1 done. Invent nothing.

## Prerequisites

- [ ] P1 through BBP1-008 admission/idempotency/attribution is merged on current main.
- [ ] Delivery v0 ruling honored: no share dependency in BBM1-001..003; share-link work exists only as BBM1-004, hard-gated on #424 merging.
- [ ] Bearer verifier, principal-to-tenant/agent policy, and rate/concurrency
      limits are configured before the endpoint is enabled.

## Beads

- [ ] BBM1-001 - Exposed MCP delegate server.
- [ ] BBM1-002 - Delivery v0 result payload + vertical demo composition.
- [ ] BBM1-003 - Stock-client smoke and docs.
- [ ] BBM1-004 - Share-link delivery slice (only after #424 merges; not an M1 v0 exit gate).

## Verification commands

- [ ] `pnpm --filter @hachej/boring-agent run build`
- [ ] `pnpm --filter @hachej/boring-agent run typecheck`
- [ ] `pnpm --filter @hachej/boring-agent run test`
- [ ] Host-specific build/typecheck/test/e2e commands for the chosen demo host.
- [ ] `pnpm audit:imports`
- [ ] `pnpm e2e`

## PR-PLAN reconciliation

- [ ] `pr1-exposed-mcp-delegate` completed BBM1-001.
- [ ] `pr2-delivery-v0-demo-composition` completed BBM1-002.
- [ ] `pr3-stock-client-smoke` completed BBM1-003.
- [ ] `pr2b-share-links` (post-#424) completed BBM1-004, or is explicitly parked with #424 still open.

## Review gates

- [ ] Every PR description includes review-time estimate, review-focus notes, and stack merge order.
- [ ] `delegate_task` requires caller `idempotencyKey` (<=128 UTF-8 bytes),
      scopes it by authenticated subject/tenant/agent, and derives stable
      `requestId`; changing JSON-RPC/tool-call id never starts a second session.
- [ ] Existing-key dedupe runs before rate/quota/concurrency admission; same
      payload returns the original and a different payload conflicts.
- [ ] `plugins/boring-mcp` duality documented: it consumes MCP; M1 exposes a boring agent over MCP.
- [ ] One session per delegation; no cross-delegation session reuse.
- [ ] `SessionCtx` is host-chosen and real; MCP caller cannot spoof tenancy.
- [ ] Missing/invalid/expired/foreign bearer and quota excess reject before
      `agent.start`.
- [ ] No secret canary appears in MCP tool results or logs.
- [ ] Progress uses MCP progress notifications or polling and enforces 4 KiB per
      item, 128 items/64 KiB retained, and 96 KiB polling payload limits.
- [ ] Brief <=32 KiB, final text <=96 KiB, optional UTF-8 Markdown <=256 KiB,
      and complete serialized result <=384 KiB; exact/over boundaries use the
      stable input/result/artifact codes and no path.
- [ ] (BBM1-004 only) Share link from the verified public-share API opens and does not expose workspace APIs, shell routes, model keys, broker secrets, or internal session details.

## Exit criteria

- [ ] A stock MCP client connects with an authorized bearer credential.
- [ ] The client delegates a representative brief.
- [ ] Progress is visible.
- [ ] The final result is self-contained and includes no inaccessible artifact reference.
- [ ] (Post-#424, BBM1-004) The result additionally includes a public share URL that opens to the rendered Markdown artifact.

## Closeout

- [ ] Zero unowned `TODO(remove:*)` markers for this package.
- [ ] M1 PRs merged in the order recorded in [PR-PLAN.md](../../PR-PLAN.md).
