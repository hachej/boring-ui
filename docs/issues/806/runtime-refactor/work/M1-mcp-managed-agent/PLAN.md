> **Work-package status:** follow this package’s linked Bead/GitHub tracker. It is
> not part of Decision 25’s static P0→N1 critical path, but Decision 25 does not
> cancel it. AgentHost/D1-dependent passages must be recut before dispatch.

# M1-mcp-managed-agent - Plan

> **Binding priority-2 supersession (2026-07-11).** M1 follows P6-R and the D1
> host composition; it is not an optional P1 side tracer. Recut #549/#556 on
> current main to expose one authenticated subject -> authorized workspace ->
> deployed `default` agent with bounded self-contained output. BBM1-004 and all
> #424/public-share coupling are superseded: AR1 owns artifact transfer and
> destination-local links after the M1 recut. The detailed rows below are
> historical input until the recut replaces them with exact micro-beads.
>
> The recut must close the current byte-source gap in
> `managedAgentDelegate.ts`: resolve a returned workspace-relative artifact only
> through the already-authorized bound `Workspace`, read the complete bytes,
> require one well-formed UTF-8 Markdown payload <=256 KiB, and return content +
> digest without a path. Replace silent `truncated:true`, path-only output, and
> `INTERNAL_ERROR` fallbacks with stable `MCP_AGENT_ARTIFACT_INVALID`,
> `MCP_AGENT_ARTIFACT_TOO_LARGE`, and `MCP_AGENT_ARTIFACT_UNAVAILABLE` errors.
> Binary, malformed UTF-8, missing, changed-during-read, or oversize artifacts
> reject; no partial content/path result reaches AR1.

> Phase: Phase M1 - managed agent via MCP (outreach demo sidecar) · Work order: [TODO.md](TODO.md) · Handoff: [HANDOFF.md](HANDOFF.md)
> Ordering authority: [INDEX.md](../../../../391/runtime-refactor/INDEX.md) · Vision: [VISION.md](../../../../391/runtime-refactor/VISION.md) · PR plan: [PR-PLAN.md](../../../../391/runtime-refactor/PR-PLAN.md)

## Governing architecture

- [00-global-isa.md](../../../../391/runtime-refactor/architecture/00-global-isa.md) - package ownership, behavior-freeze discipline, `SessionCtx` tenancy, and no-secrets invariants.
- [01-agent-core-runtime-free.md](../../../../391/runtime-refactor/architecture/01-agent-core-runtime-free.md) - `createAgent()` environment-independent boundary, workspace host composition, and no ambient reads.
- [08-pluggable-agent-surfaces.md](../../../../391/runtime-refactor/architecture/08-pluggable-agent-surfaces.md) - four-part surface contract: message in, event stream out, approvals, session state.
- [07-tests-review-acceptance.md](../../../../391/runtime-refactor/architecture/07-tests-review-acceptance.md) - acceptance proof and review gates.

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
  - Host verifies a bearer credential, resolves the subject through host policy
    to one concrete authorized workspace membership, and resolves that
    workspace's bound deployment and explicit `default` agent before
    `agent.start`. `workspaceId` is mandatory in R0. Caller/tool routing fields
    grant nothing.
  - `delegate_task({ brief, idempotencyKey })` requires a caller-stable key and
    uses a bounded process-local receipt map keyed by authenticated subject,
    resolved `workspaceId`, resolved `deploymentId`/`agentId`, and the caller
    key. It creates at most one session for same-process retries. This R0 map is
    not restart-durable; a retry after host restart may start a second
    delegation.
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
- No BBP1-008, prE, or T1 dependency: M1 works on the workspace-composed P1
  façade and its existing live tail. M1 owns only the bounded process-local
  receipt map above; T1 owns restart-durable admission and idempotency.
- No billing.
- No multi-agent control plane, marketplace, or task service.
- No anonymous/public-demo R0 access; M2 owns later public-demo policy.
- No secrets to MCP callers; callers receive only redacted status, final text,
  and bounded inline Markdown.

## Exit criteria

- A stock MCP client connects with an authorized bearer credential and calls
  `delegate_task`; invalid/expired/foreign credentials and quota excess reject
  before model work.
- Before starting, host policy proves the subject is a member of one concrete
  workspace and resolves its bound deployment and explicit `default` agent.
  The server starts exactly one agent session per delegation with mandatory
  `SessionCtx.workspaceId`; no synthesized or caller-selected tenancy.
- Foreign-workspace, non-member, missing-workspace-binding, and mismatched
  deployment/default-agent attempts reject before model work.
- The caller supplies a stable idempotency key; dedupe happens before quota/rate/
  concurrency checks, so a same-process retry after a lost response returns the
  original delegation even when its JSON-RPC/tool-call id changes. Receipt-map
  capacity and retention are bounded and tested. Restart clears the map; R0
  documents that a post-restart retry may start a second delegation.
- Progress is available either through MCP progress notifications or the documented polling fallback.
- The final result includes final assistant text plus bounded inline Markdown;
  no artifact path or private retrieval dependency is returned.
- Byte limits are enforced before storage/notification/serialization: brief 32
  KiB, retained progress 100 items (code: `MAX_RETAINED_PROGRESS=100`), final
  text 96 KiB, artifact 256 KiB, and complete serialized result 384 KiB. Four
  caps are declared, enforcement pending — recut target: idempotency-key 128
  bytes, progress-item 4 KiB, retained-bytes, and polling-payload 96 KiB.
- (Post-#424, BBM1-004) The result additionally includes a public Markdown share URL that renders the artifact without exposing workspace file APIs, shell, tokens, model keys, or session internals.
