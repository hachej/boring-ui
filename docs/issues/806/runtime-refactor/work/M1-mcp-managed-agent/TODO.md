> **Work-package status:** follow this package’s linked Bead/GitHub tracker. It is
> not part of Decision 25’s static P0→N1 critical path, but Decision 25 does not
> cancel it. AgentHost/D1-dependent passages must be recut before dispatch.

# TODO-M1 - MVP-M1: managed agent via MCP

> **Dispatch supersession (2026-07-11).** Do not dispatch the legacy bead list
> below. After D1, recut #549/#556 into current-main M1 beads for authenticated
> workspace/default-agent ingress and bounded result delivery. Do not revive
> BBM1-004 or depend on #424; AR1 is the sole owner of share/intake behavior.
> The M1 result bead must use the authorized bound `Workspace` to replace
> current path-only/truncated artifact refs with one complete UTF-8 Markdown
> payload <=256 KiB plus digest. Add the three stable artifact errors named in
> `PLAN.md`; reject binary, malformed, missing, changed-during-read, truncated,
> and oversize sources with no path fallback. AR1 starts only after this proof.

Coordinator: never assign this whole file. Dispatch one bead/PR with this
file's context, dependencies, and non-negotiables included in the assignment.

## Context (read first)

- Plan: `docs/issues/806/runtime-refactor/work/M1-mcp-managed-agent/PLAN.md`.
- Ordering: `docs/issues/806/plan.md` Phase M1 and "Execution operating mode - outreach weeks".
- PR plan: `docs/issues/391/runtime-refactor/PR-PLAN.md` M1 rows.
- Architecture:
  - `docs/issues/391/runtime-refactor/architecture/00-global-isa.md`
  - `docs/issues/391/runtime-refactor/architecture/01-agent-core-runtime-free.md`
  - `docs/issues/391/runtime-refactor/architecture/08-pluggable-agent-surfaces.md`
  - `docs/issues/391/runtime-refactor/architecture/07-tests-review-acceptance.md`
- Existing MCP consumer reference, for duality only:
  - `plugins/boring-mcp/README.md`
  - `plugins/boring-mcp/src/server/mcpSdkTransport.ts`
  - `plugins/boring-mcp/src/server/agentBridge.ts`

## Prerequisites - stop if false

- The P1 workspace/Fastify boundary is merged. Verify current main, not an old
  branch. M1 depends on `createAgent().start`, `createAgent().stream`, and the
  existing live-tail behavior. It does not wait for BBP1-008, prE, or T1.
- **R0 delivery ruling:** #424 is not a prerequisite. To avoid dangling remote
  paths, R0 returns final text plus at most one inline UTF-8 Markdown artifact
  capped at 256 KiB. Large/binary/download handles and share links are later
  BBM1-004/M2 work. Do not return workspace-relative paths to a remote client.
- Do not build a parallel share implementation or facade shim under any circumstance.

## Goal / exit criteria

Expose one configured boring vertical agent as authenticated MCP tools. An
authorized stock client delegates a brief, watches progress, and receives final
text plus bounded inline Markdown.

Exit criteria:

1. One bearer-authenticated MCP endpoint reachable by URL from a stock client.
2. `delegate_task({ brief, idempotencyKey })` starts at most one fresh agent
   session for same-process retries; retry under a new JSON-RPC/tool-call id
   returns the original while the bounded receipt remains resident.
3. Verified host policy resolves the principal to a concrete authorized
   workspace membership, then resolves that workspace's bound deployment and
   explicit `default` agent before start. `SessionCtx.workspaceId` is mandatory
   in R0; no fake or caller-supplied routing authority.
4. Progress is exposed via MCP progress notifications if supported by the SDK/client path; otherwise via an explicit polling tool.
5. Input/progress/poll/final/artifact/total serialized payloads obey the
   explicit byte budgets below. Oversize uses stable input/result/artifact
   codes without a path. Share/download links are later.
6. Missing/invalid/expired credentials, foreign-workspace or non-member access,
   missing/mismatched workspace/deployment/default-agent bindings, and rate/
   concurrency excess reject before model execution. No secrets, internal file
   APIs, shell routes, storage paths, or provider credentials reach the caller.

## Non-negotiables

- This package **exposes** a boring agent over MCP. `plugins/boring-mcp` **consumes** external MCP sources. Use it for SDK transport patterns only; do not inherit its read-only source policy model as the server design.
- Session-per-delegation. No shared long-running session across independent `delegate_task` calls in M1.
- Bearer-only R0. Endpoint stays disabled without a configured verifier,
  subject-to-workspace-membership plus bound-deployment/default-agent policy,
  and rate/concurrency limits.
- No secrets to callers. Return redacted status, final text, and bounded inline
  Markdown only.
- Behavior freeze for the live demo app. Land additive/dark; flip exposure only after smoke proof.
- The receipt map is host-owned, process-local, capacity/TTL bounded, and scoped
  by authenticated subject + resolved `workspaceId` + resolved `deploymentId`/
  `agentId` + caller idempotency key. It is not a durable admission authority.
  Restart loss and possible duplicate delegation are an explicit R0 limitation
  until T1.
- PR descriptions must include review-time estimate, review-focus notes, and stack merge order.

## Do NOT

- Do NOT build a farm UI.
- Do NOT depend on BBP1-008, prE, or T1 durable events. Use the existing P1 live
  tail, keep the R0 receipt map process-local, and document the durable upgrade.
- Do NOT add billing, marketplace, task service, or multi-agent control-plane concepts.
- Do NOT create a second public Markdown share/download route while #424 is
  unmerged; R0 rejects unsupported artifact delivery instead.
- Do NOT expose raw transcripts, workspace roots, broker secrets, env vars, OAuth tokens, or model keys through MCP payloads/logs.

## Beads

### BBM1-001 - Exposed MCP delegate server (M/L)

- Description: Add a thin MCP server package or app route that exposes a configured agent through `delegate_task({ brief, idempotencyKey })` plus progress/status support.
- Files: choose the smallest additive shape after reading current package layout. Preferred for the outreach demo is an app route in the demo host (`apps/full-app` if that is the running sales demo, otherwise CLI); extract a package only if both full-app and CLI consume it in M1.
- Implementation notes:
  - Require bearer authentication at MCP connection/request admission. The host
    verifier returns an authenticated subject, then host policy resolves
    `AuthorizedM1Target { subjectId, workspaceId, deploymentId, agentId:
    'default' }` only after proving current workspace membership and the bound
    deployment/default-agent relationship. Bind that target to mandatory
    `SessionCtx.workspaceId` and receipt scope. Never accept tenant/workspace/
    deployment/agent authority from tool arguments.
  - Look up the fully scoped `(subjectId, workspaceId, deploymentId, agentId,
    idempotencyKey)` receipt before rate/quota/concurrency
    admission. An existing same-payload record returns its original delegation/
    receipt/result; a different payload conflicts. Only a new key proceeds to
    host-configured limits and `agent.start`.
  - Use one bounded process-local single-flight/receipt map with explicit
    capacity and retention. It deduplicates concurrent and later same-process
    retries only. Do not persist it or claim crash/restart idempotency.
  - Configure one agent via `createAgent(...)` with host-supplied instructions/tools.
  - `delegate_task` validates `{ brief: string, idempotencyKey: string }`.
    `brief` is at most 32 KiB UTF-8. `idempotencyKey` is required, at most 128
    UTF-8 bytes, and matches `[A-Za-z0-9._:-]+`; scope it by authenticated
    `(subjectId, workspaceId, deploymentId, agentId)`, never by caller routing
    fields or JSON-RPC request id.
  - Derive `requestId` from that stable scoped identity for attribution only;
    P1 does not provide durable request admission. Call
    `agent.start({ content: brief, actor, ctx, originSurface: 'mcp-managed-agent', requestId })`.
  - Consume `agent.stream(sessionId, { startIndex })` from the P1 live tail. Do
    not require T1 replay and do not promise recovery after process restart.
  - Emit MCP progress notifications when the SDK/client path supports it. Each
    notification is <=4 KiB UTF-8. Coalesce/bound retained progress to at most
    128 events and 64 KiB. If notifications are unavailable, expose
    `delegate_task_status({ delegationId })`; its serialized payload is <=96 KiB.
  - Store only server-side delegation/session state. MCP callers never receive internal session paths, raw SessionCtx, or secrets.
- Tests: valid bearer plus current membership and a bound default deployment
  creates one session with mandatory `workspaceId`; missing, malformed, expired,
  foreign-workspace, non-member, missing-binding, and mismatched deployment/
  agent attempts reject before start; tool arguments cannot override routing;
  rate/concurrency limit rejects before start for new keys; same scoped key
  retry dedupes before quota and returns the
  original; same key/different brief conflicts; concurrent requests single-
  flight; a same-process lost response followed by a retry with a different
  JSON-RPC/tool-call id starts no second run; capacity/TTL eviction is bounded;
  restart loss and its possible duplicate are documented; exact and
  over-boundary brief/key/progress/poll sizes; no secret canary appears.
- Acceptance: authenticated `delegate_task` and progress work without T1; no
  workspace/file/shell route or anonymous/public-demo mode is exposed.

### BBM1-002 - Delivery v0 result payload + vertical demo composition (M)

- Description: Wire the **delivery v0** payload (final text + bounded inline
  Markdown) and host one vertical-agent config. Share/download delivery is later.
- Files: demo host config plus the delegation result assembly in the M1 server code.
- Implementation notes:
  - **R0/v1 rule:** M1 remains dispatchable for R0 with
    `ManagedAgentVerticalConfig`. BBA1-003 becomes a P8 gate only if the shipped
    D1 path consumes duplicated M1 behavior configuration; then it moves that
    behavior to canonical `AgentDefinition`. Optional M1's mere existence does
    not create the gate, and any remaining M1 config is deployment-only.
  - R0 host config is bearer-only and carries verifier/policy/quota refs. It has
    no public-demo policy. Hardcoded demo verticals are fixtures only.
  - The agent may produce one UTF-8 Markdown artifact. Inline it only when <=
    256 KiB; reject larger output with `MCP_AGENT_ARTIFACT_TOO_LARGE` and
    binary/disallowed output with `MCP_AGENT_ARTIFACT_INVALID`. Never include a
    workspace-relative or absolute path in the MCP result.
  - Final assistant text is <=96 KiB UTF-8 and the complete serialized MCP
    result is <=384 KiB. Configure model maximum output consistently, then
    enforce bytes again at the host boundary. Oversized brief/key uses
    `TOOL_INVALID_INPUT`; oversized final/total/artifact uses
    `MCP_AGENT_ARTIFACT_TOO_LARGE`; binary/disallowed/truncated/malformed
    artifact content uses `MCP_AGENT_ARTIFACT_INVALID`; and bytes that cannot
    be read stably use `MCP_AGENT_ARTIFACT_UNAVAILABLE`.
  - Host one vertical-agent config (instructions + tools) in full-app or CLI. Pick one host for M1; do not build two compositions unless the second is only a smoke fixture.
  - The endpoint URL must be usable by any stock MCP client that supports Streamable HTTP or the repo's chosen MCP transport.
- Tests: exact/over boundaries for final text (96 KiB), artifact (256 KiB), and
  total serialized result (384 KiB); oversize/binary rejects without path;
  model-output cap aligns with the host cap; secret canary absent.
- Acceptance: a delegated brief completes with self-contained caller-visible
  output and no inaccessible reference.

### BBM1-004 - Share-link delivery slice (S) — HARD GATED on PR #424 merging

- Description: Once #424 is merged on main, upgrade the delivery payload with a public Markdown share URL created through the verified public-share API.
- Implementation notes: re-check current main and cite the actual public-share symbols/routes in the PR (expected provenance: `createMarkdownReviewShare`, `registerPublicShareRoutes`, `PublicShareRecord`, routes under `/share/:token/`) — **unconfirmed — pending #424; these symbols do not exist on current main (only referenced in this package's own docs); re-derive at dispatch.** Do not start this bead while #424 is unmerged.
- Tests: share creation uses the verified API; returned share URL points at the mounted public route; caller-visible result contains no raw workspace path beyond the public share URL.
- Acceptance: a delegated brief completes with a share link that opens the rendered Markdown artifact.

### BBM1-003 - Stock-client smoke and docs (S)

- Description: Prove the complete demo path from a stock MCP client.
- Files: minimal docs in the demo host or this work package; no marketing page.
- Implementation notes:
  - Run a stock MCP client against the URL.
  - Call `delegate_task` with a representative outreach-demo brief and stable
    idempotency key; repeat under a new tool-call id and prove one delegation.
  - Observe progress through notification or polling.
  - Capture the result and verify inline Markdown content/size; no path exists.
  - Record exact command/client/version, URL shape, and proof notes.
- Tests: smoke script or documented manual smoke, whichever the repo already accepts for MCP endpoint proof.
- Acceptance: proof shows authenticated delegate -> progress -> self-contained result.

## Verification

Run the affected host/package gates plus repo-wide guards. Exact commands must be re-verified in the implementation PR because the host choice is part of BBM1-001:

```bash
pnpm --filter @hachej/boring-agent run build
pnpm --filter @hachej/boring-agent run typecheck
pnpm --filter @hachej/boring-agent run test
pnpm audit:imports
pnpm e2e
```

If M1 lands in `apps/full-app`, also run its existing build/typecheck/test/e2e scripts. If M1 lands in the CLI, also run the CLI build/typecheck/test scripts.

## PR-PLAN reconciliation

- `pr1-exposed-mcp-delegate` -> BBM1-001.
- `pr2-delivery-v0-demo-composition` -> BBM1-002.
- `pr3-stock-client-smoke` -> BBM1-003.
- `pr2b-share-links` -> BBM1-004 (HARD GATED on PR #424 merging; not part of the M1 v0 exit).

## Review gates

- The P1 workspace/Fastify boundary is cited from current main; no BBP1-008,
  prE, or T1 prerequisite is claimed.
- `plugins/boring-mcp` duality is explicitly noted: consumes MCP there, exposes MCP here.
- Each authenticated delegation creates exactly one session and does not leak `SessionCtx`.
- The bounded process-local receipt map is keyed by authenticated subject,
  resolved workspace, resolved deployment/default agent, and caller key, then
  checked before quota; a same-process retry with a new protocol request id
  returns the original delegation. Restart durability is explicitly not claimed.
- Mandatory R0 workspace membership and bound deployment/default-agent resolve
  before start; foreign-workspace, non-member, missing/mismatched binding,
  missing/invalid/expired bearer, and quota excess reject before model work.
- MCP result payloads pass secret-canary and bounded-inline checks; no artifact
  path is returned in R0.
- Brief/key/progress/retained-progress/poll/final/artifact/total byte bounds and
  stable size error codes have exact-boundary coverage.
- (BBM1-004 only) Public-share API symbols/routes are cited from current main; share URL opens without exposing workspace APIs, shell routes, model keys, or internal session details.
