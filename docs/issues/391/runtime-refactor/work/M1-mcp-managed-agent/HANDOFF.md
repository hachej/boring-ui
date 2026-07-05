# M1-mcp-managed-agent - Handoff checklist

Derived strictly from [TODO.md](./TODO.md) and [PLAN.md](./PLAN.md). Tick each before calling M1 done. Invent nothing.

## Prerequisites

- [ ] P1 pr2 `createAgent()` facade is merged on current main.
- [ ] Public Markdown share API is merged on current main; PR cites the actual mainline functions/routes.
- [ ] If the public-share API names differ from the amendment-time expected names, M1 docs were updated before implementation.

## Beads

- [ ] BBM1-001 - Exposed MCP delegate server.
- [ ] BBM1-002 - Public share result integration + vertical demo composition.
- [ ] BBM1-003 - Stock-client smoke and docs.

## Verification commands

- [ ] `pnpm --filter @hachej/boring-agent run build`
- [ ] `pnpm --filter @hachej/boring-agent run typecheck`
- [ ] `pnpm --filter @hachej/boring-agent run test`
- [ ] Host-specific build/typecheck/test/e2e commands for the chosen demo host.
- [ ] `pnpm audit:imports`
- [ ] `pnpm e2e`

## PR-PLAN reconciliation

- [ ] `pr1-exposed-mcp-delegate` completed BBM1-001.
- [ ] `pr2-share-result-demo-composition` completed BBM1-002.
- [ ] `pr3-stock-client-smoke` completed BBM1-003.

## Review gates

- [ ] Every PR description includes review-time estimate, review-focus notes, and stack merge order.
- [ ] `plugins/boring-mcp` duality documented: it consumes MCP; M1 exposes a boring agent over MCP.
- [ ] One session per delegation; no cross-delegation session reuse.
- [ ] `SessionCtx` is host-chosen and real; MCP caller cannot spoof tenancy.
- [ ] No secret canary appears in MCP tool results, logs, or public share output.
- [ ] Progress uses MCP progress notifications or the documented polling fallback.
- [ ] Result returns a public Markdown share link from the verified public-share API.
- [ ] Share link opens and does not expose workspace APIs, shell routes, model keys, broker secrets, or internal session details.

## Exit criteria

- [ ] A stock MCP client connects to the M1 endpoint.
- [ ] The client delegates a representative brief.
- [ ] Progress is visible.
- [ ] The final result includes a public share URL.
- [ ] The share URL opens to the rendered Markdown artifact.

## Closeout

- [ ] Zero unowned `TODO(remove:*)` markers for this package.
- [ ] M1 PRs merged in the order recorded in [PR-PLAN.md](../../PR-PLAN.md).
