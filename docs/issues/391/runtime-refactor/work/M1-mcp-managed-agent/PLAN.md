# M1-mcp-managed-agent - Plan

> Phase: Phase M1 - managed agent via MCP (outreach demo sidecar) · Work order: [TODO.md](./TODO.md) · Handoff: [HANDOFF.md](./HANDOFF.md)
> Ordering authority: [INDEX.md](../../INDEX.md) · Vision: [VISION.md](../../VISION.md) · PR plan: [PR-PLAN.md](../../PR-PLAN.md)

## Governing architecture

- [00-global-isa.md](../../architecture/00-global-isa.md) - package ownership, behavior-freeze discipline, `SessionCtx` tenancy, and no-secrets invariants.
- [01-agent-core-runtime-free.md](../../architecture/01-agent-core-runtime-free.md) - `createAgent()` facade, pure/core API, host-owned config, and no ambient reads.
- [08-pluggable-agent-surfaces.md](../../architecture/08-pluggable-agent-surfaces.md) - four-part surface contract: message in, event stream out, approvals, session state.
- [07-tests-review-acceptance.md](../../architecture/07-tests-review-acceptance.md) - acceptance proof and review gates.

## Design context

M1 is the outreach demo artifact: expose one configured boring agent as MCP tools so any stock MCP client can delegate a brief and receive the finished result (final text + artifact references in v0; a public Markdown share link once the #424-gated slice lands). It is a sidecar lane, parallel to the runtime-refactor lanes after its prerequisites land. It must keep the live sales demo behavior-frozen: additive routes/package only, e2e green, and no risky default flip without conformance.

This package **exposes** boring agents over MCP. That is the inverse of `plugins/boring-mcp`, which **consumes** external MCP sources and contributes read-only bridge tools to a boring agent. M1 should read `plugins/boring-mcp/README.md` and `plugins/boring-mcp/src/server/mcpSdkTransport.ts` for SDK/client patterns only; it must not reuse the policy assumptions of a consumer bridge as if they were an exposed-agent server.

## Verified repo reality for this amendment

- `plugins/boring-mcp` is a consuming bridge: `createBoringMcpServerPlugin()` contributes `mcp_servers_list`, `mcp_server_status`, `mcp_server_doctor`, `mcp_server_probe`, `mcp_tools_search`, `mcp_tool_describe`, and `mcp_readonly_call`.
- Local `origin/main` at amendment time did not contain `packages/agent/src/server/http/routes/publicShare.ts`, `packages/workspace/src/front/public-share/PublicMarkdownReviewApp.tsx`, or `docs/plans/public-workspace-share-routes-plan.md`.
- The local `feature/cli-public-md-share` branch contains the expected public Markdown share API: `createMarkdownReviewShare`, `registerPublicShareRoutes`, `PublicShareRecord`, `PublicShareCapabilities` exported from `packages/agent/src/server/index.ts`, with routes `GET /share/:token/`, `GET /share/:token/meta`, `GET /share/:token/raw`, `GET /share/:token/portable.md`, `GET /share/:token/bundle.zip`, `GET /share/:token/assets/*`, and `POST /share/:token/raw`.
- **Orchestrator ruling (2026-07-06):** #424 was verified **unmerged** on main at M1 execution time (the earlier "merged" premise was wrong). M1 delivery v0 is decoupled from #424: results return final text + workspace-relative artifact references (inline content for small text artifacts). Share-link delivery is the BBM1-004 / `pr2b-share-links` slice, HARD GATED on #424 merging; that slice re-checks main and cites the actual symbols/routes before coding.

## Deliverables

- Thin MCP server package or app route that exposes a configured agent as MCP tools:
  - `delegate_task(brief)` creates a fresh session via `createAgent().start`.
  - Progress is emitted through MCP progress notifications if the SDK and stock client path support them; otherwise a polling tool (for example `delegate_task_status`) is the explicit fallback.
  - Completion returns the final assistant text plus workspace-relative artifact references (inline content for small text artifacts); a public share link is added by the #424-gated BBM1-004 slice.
- One vertical-agent demo composition, hosted in `full-app` or the CLI, with instructions/tools wired by config and reachable by URL from any MCP client.
- Smoke proof from a stock MCP client: delegate a brief, observe progress, receive the result, resolve the artifact reference successfully (share-link open moves to BBM1-004).

## Non-goals

- No farm UI.
- No T1 dependency: M1 works on the P1 pr2 facade live-tail; durable streams upgrade later.
- No billing.
- No multi-agent control plane, marketplace, or task service.
- No secrets to MCP callers; callers receive only redacted status, final text, and workspace-relative artifact references (share links once BBM1-004 lands).

## Exit criteria

- A stock MCP client connects to the M1 endpoint and calls `delegate_task` with a brief.
- The server starts exactly one agent session per delegation and scopes it with a real `SessionCtx`; no synthesized tenancy.
- Progress is available either through MCP progress notifications or the documented polling fallback.
- The final result includes the final assistant text plus artifact references that resolve to the produced artifact; no absolute host paths.
- (Post-#424, BBM1-004) The result additionally includes a public Markdown share URL that renders the artifact without exposing workspace file APIs, shell, tokens, model keys, or session internals.
