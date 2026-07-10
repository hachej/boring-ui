# M1-mcp-managed-agent - Plan

> Phase: Phase M1 - managed agent via MCP (outreach demo sidecar) · Work order: [TODO.md](./TODO.md) · Handoff: [HANDOFF.md](./HANDOFF.md)
> Ordering authority: [INDEX.md](../../INDEX.md) · Vision: [VISION.md](../../VISION.md) · PR plan: [PR-PLAN.md](../../PR-PLAN.md)

## Governing architecture

- [00-global-isa.md](../../architecture/00-global-isa.md) - package ownership, behavior-freeze discipline, `SessionCtx` tenancy, and no-secrets invariants.
- [01-agent-core-runtime-free.md](../../architecture/01-agent-core-runtime-free.md) - `createAgent()` facade, pure/core API, host-owned config, and no ambient reads.
- [08-pluggable-agent-surfaces.md](../../architecture/08-pluggable-agent-surfaces.md) - four-part surface contract: message in, event stream out, approvals, session state.
- [07-tests-review-acceptance.md](../../architecture/07-tests-review-acceptance.md) - acceptance proof and review gates.

## Design context

M1 is the outreach demo artifact: expose one configured boring agent as MCP
tools so an authenticated stock MCP client can delegate a brief and receive the
finished result. R0 deliberately supports final text plus one inline UTF-8
Markdown artifact up to 256 KiB; larger/binary/downloadable artifacts wait for
the #424/M2 delivery contract. Exposure stays dark until bearer auth, quota,
and smoke proof are present.

This package **exposes** boring agents over MCP. That is the inverse of `plugins/boring-mcp`, which **consumes** external MCP sources and contributes read-only bridge tools to a boring agent. M1 should read `plugins/boring-mcp/README.md` and `plugins/boring-mcp/src/server/mcpSdkTransport.ts` for SDK/client patterns only; it must not reuse the policy assumptions of a consumer bridge as if they were an exposed-agent server.

## Verified repo reality for this amendment

- `plugins/boring-mcp` is a consuming bridge: `createBoringMcpServerPlugin()` contributes `mcp_servers_list`, `mcp_server_status`, `mcp_server_doctor`, `mcp_server_probe`, `mcp_tools_search`, `mcp_tool_describe`, and `mcp_readonly_call`.
- Local `origin/main` at amendment time did not contain `packages/agent/src/server/http/routes/publicShare.ts`, `packages/workspace/src/front/public-share/PublicMarkdownReviewApp.tsx`, or `docs/plans/public-workspace-share-routes-plan.md`.
- The local `feature/cli-public-md-share` branch contains the expected public Markdown share API: `createMarkdownReviewShare`, `registerPublicShareRoutes`, `PublicShareRecord`, `PublicShareCapabilities` exported from `packages/agent/src/server/index.ts`, with routes `GET /share/:token/`, `GET /share/:token/meta`, `GET /share/:token/raw`, `GET /share/:token/portable.md`, `GET /share/:token/bundle.zip`, `GET /share/:token/assets/*`, and `POST /share/:token/raw`.
- **R0 delivery ruling:** #424 is not a prerequisite. R0 is self-contained:
  final text plus optional inline UTF-8 Markdown <=256 KiB, never a remote
  workspace path. Share/download delivery is BBM1-004/M2.

## Deliverables

- Thin MCP server package or app route that exposes a configured agent as MCP tools:
  - Host verifies a bearer credential, authorizes one tenant/agent, applies
    principal rate/concurrency limits, and creates trusted session/admission
    scope. Caller routing fields grant nothing.
  - `delegate_task({ brief, idempotencyKey })` requires a caller-stable key,
    scoped by authenticated subject, and creates at most one session via
    `createAgent().start` across retries.
  - Progress is emitted through MCP progress notifications if the SDK and stock client path support them; otherwise a polling tool (for example `delegate_task_status`) is the explicit fallback.
  - Completion returns final assistant text plus at most one inline UTF-8
    Markdown artifact within the explicit payload budget. Brief, key, progress,
    polling, final text, artifact, and total serialized result are all byte-
    bounded. Oversize/binary output fails with a stable code and never returns a
    dangling path.
- One vertical-agent demo composition, hosted in `full-app` or the CLI, with instructions/tools wired by config and reachable by URL from any MCP client.
- Smoke proof from an authenticated stock MCP client: delegate a brief, observe
  progress, receive the self-contained result, and prove auth/quota negatives.

## Non-goals

- No farm UI.
- No T1 dependency: M1 works on the P1 façade live-tail after prE closes
  admission/idempotency/attribution; durable streams upgrade later.
- No billing.
- No multi-agent control plane, marketplace, or task service.
- No anonymous/public-demo R0 access; M2 owns later public-demo policy.
- No secrets to MCP callers; callers receive only redacted status, final text,
  and bounded inline Markdown.

## Exit criteria

- A stock MCP client connects with an authorized bearer credential and calls
  `delegate_task`; invalid/expired/foreign credentials and quota excess reject
  before model work.
- The server starts exactly one agent session per delegation and scopes it with a real `SessionCtx`; no synthesized tenancy.
- The caller supplies a stable idempotency key; dedupe happens before quota/rate/
  concurrency checks, so a retry after a lost response returns the original
  delegation even when its JSON-RPC/tool-call id changes.
- Progress is available either through MCP progress notifications or the documented polling fallback.
- The final result includes final assistant text plus bounded inline Markdown;
  no artifact path or private retrieval dependency is returned.
- Byte limits are enforced before storage/notification/serialization: brief 32
  KiB, idempotency key 128 bytes, progress item 4 KiB, retained progress 128
  items/64 KiB, polling payload 96 KiB, final text 96 KiB, artifact 256 KiB,
  and complete serialized result 384 KiB.
- (Post-#424, BBM1-004) The result additionally includes a public Markdown share URL that renders the artifact without exposing workspace file APIs, shell, tokens, model keys, or session internals.
