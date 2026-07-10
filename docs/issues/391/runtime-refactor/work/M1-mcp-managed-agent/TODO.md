# TODO-M1 - MVP-M1: managed agent via MCP

Coordinator: never assign this whole file. Dispatch one bead/PR with this
file's context, dependencies, and non-negotiables included in the assignment.

## Context (read first)

- Plan: `docs/issues/391/runtime-refactor/work/M1-mcp-managed-agent/PLAN.md`.
- Ordering: `docs/issues/391/runtime-refactor/INDEX.md` Phase M1 and "Execution operating mode - outreach weeks".
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

- P1 is merged through BBP1-008 admission/idempotency/attribution closeout.
  Verify current main, not an old branch. M1 depends on `createAgent().start`,
  `createAgent().stream`, the P1 live-tail behavior, and stable caller write ids.
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
   session; retry under a new JSON-RPC/tool-call id returns the original.
3. Verified principal+tenant/agent policy creates real host `SessionCtx` and
   admission scope; no fake workspace id or caller-supplied tenant authority.
4. Progress is exposed via MCP progress notifications if supported by the SDK/client path; otherwise via an explicit polling tool.
5. Input/progress/poll/final/artifact/total serialized payloads obey the
   explicit byte budgets below. Oversize uses stable input/result/artifact
   codes without a path. Share/download links are later.
6. Missing/invalid/expired/foreign credentials and rate/concurrency excess
   reject before model execution. No secrets, internal file APIs, shell routes,
   storage paths, or provider credentials reach the caller.

## Non-negotiables

- This package **exposes** a boring agent over MCP. `plugins/boring-mcp` **consumes** external MCP sources. Use it for SDK transport patterns only; do not inherit its read-only source policy model as the server design.
- Session-per-delegation. No shared long-running session across independent `delegate_task` calls in M1.
- Bearer-only R0. Endpoint stays disabled without a configured verifier,
  principal-to-tenant/agent authorization policy, and rate/concurrency limits.
- No secrets to callers. Return redacted status, final text, and bounded inline
  Markdown only.
- Behavior freeze for the live demo app. Land additive/dark; flip exposure only after smoke proof.
- PR descriptions must include review-time estimate, review-focus notes, and stack merge order.

## Do NOT

- Do NOT build a farm UI.
- Do NOT depend on T1 durable events; use the P1 live-tail after BBP1-008 and
  document the durable-stream upgrade path.
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
    verifier returns `AuthenticatedMcpPrincipal { subjectId, tenantId,
    allowedAgentIds, expiresAt }`; bind it to trusted `SessionCtx` and receipt
    scope after policy validation. Never accept tenant/workspace/agent authority
    from tool arguments.
  - Look up the subject-scoped idempotency key before rate/quota/concurrency
    admission. An existing same-payload record returns its original delegation/
    receipt/result; a different payload conflicts. Only a new key proceeds to
    host-configured limits and `agent.start`.
  - Configure one agent via `createAgent(...)` with host-supplied instructions/tools.
  - `delegate_task` validates `{ brief: string, idempotencyKey: string }`.
    `brief` is at most 32 KiB UTF-8. `idempotencyKey` is required, at most 128
    UTF-8 bytes, and matches `[A-Za-z0-9._:-]+`; scope it by authenticated
    subject/tenant/agent, never by caller routing fields or JSON-RPC request id.
  - Derive `requestId` from that stable scoped idempotency identity. Do not
    generate a fresh nonce on retry. Call
    `agent.start({ content: brief, actor, ctx, originSurface: 'mcp-managed-agent', requestId })`.
  - Consume `agent.stream(sessionId, { startIndex })` from the P1 live tail. Do not require T1 replay.
  - Emit MCP progress notifications when the SDK/client path supports it. Each
    notification is <=4 KiB UTF-8. Coalesce/bound retained progress to at most
    128 events and 64 KiB. If notifications are unavailable, expose
    `delegate_task_status({ delegationId })`; its serialized payload is <=96 KiB.
  - Store only server-side delegation/session state. MCP callers never receive internal session paths, raw SessionCtx, or secrets.
- Tests: valid bearer creates one session; missing, malformed, expired, and
  foreign tenant/agent tokens reject; rate/concurrency limit rejects before
  start for new keys; same key retry dedupes before quota and returns the
  original; same key/different brief conflicts; a lost response followed by a
  retry with a different JSON-RPC/tool-call id starts no second run; exact and
  over-boundary brief/key/progress/poll sizes; no secret canary appears.
- Acceptance: authenticated `delegate_task` and progress work without T1; no
  workspace/file/shell route or anonymous/public-demo mode is exposed.

### BBM1-002 - Delivery v0 result payload + vertical demo composition (M)

- Description: Wire the **delivery v0** payload (final text + bounded inline
  Markdown) and host one vertical-agent config. Share/download delivery is later.
- Files: demo host config plus the delegation result assembly in the M1 server code.
- Implementation notes:
  - **R0/v1 rule:** M1 remains dispatchable for R0 with
    `ManagedAgentVerticalConfig`, but A1 is its named migration owner. BBA1-003
    moves behavior to canonical `AgentDefinition`; any remaining M1 config is
    deployment-only and cannot duplicate behavior.
  - R0 host config is bearer-only and carries verifier/policy/quota refs. It has
    no public-demo policy. Hardcoded demo verticals are fixtures only.
  - The agent may produce one UTF-8 Markdown artifact. Inline it only when <=
    256 KiB; reject larger or binary output with `M1_ARTIFACT_UNSUPPORTED`.
    Never include a workspace-relative or absolute path in the MCP result.
  - Final assistant text is <=96 KiB UTF-8 and the complete serialized MCP
    result is <=384 KiB. Configure model maximum output consistently, then
    enforce bytes again at the host boundary. Oversized brief/key uses
    `M1_INPUT_TOO_LARGE`; oversized final/total uses `M1_RESULT_TOO_LARGE`;
    binary or oversized artifact uses `M1_ARTIFACT_UNSUPPORTED`.
  - Host one vertical-agent config (instructions + tools) in full-app or CLI. Pick one host for M1; do not build two compositions unless the second is only a smoke fixture.
  - The endpoint URL must be usable by any stock MCP client that supports Streamable HTTP or the repo's chosen MCP transport.
- Tests: exact/over boundaries for final text (96 KiB), artifact (256 KiB), and
  total serialized result (384 KiB); oversize/binary rejects without path;
  model-output cap aligns with the host cap; secret canary absent.
- Acceptance: a delegated brief completes with self-contained caller-visible
  output and no inaccessible reference.

### BBM1-004 - Share-link delivery slice (S) — HARD GATED on PR #424 merging

- Description: Once #424 is merged on main, upgrade the delivery payload with a public Markdown share URL created through the verified public-share API.
- Implementation notes: re-check current main and cite the actual public-share symbols/routes in the PR (expected provenance: `createMarkdownReviewShare`, `registerPublicShareRoutes`, `PublicShareRecord`, routes under `/share/:token/`). Do not start this bead while #424 is unmerged.
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

- P1 through BBP1-008 façade/admission API is cited from current main in the PR.
- `plugins/boring-mcp` duality is explicitly noted: consumes MCP there, exposes MCP here.
- Each authenticated delegation creates exactly one session and does not leak `SessionCtx`.
- Caller-stable idempotency is subject-scoped and checked before quota; a retry
  with a new protocol request id returns the original delegation.
- Missing/invalid/expired/foreign bearer and quota excess reject before model work.
- MCP result payloads pass secret-canary and bounded-inline checks; no artifact
  path is returned in R0.
- Brief/key/progress/retained-progress/poll/final/artifact/total byte bounds and
  stable size error codes have exact-boundary coverage.
- (BBM1-004 only) Public-share API symbols/routes are cited from current main; share URL opens without exposing workspace APIs, shell routes, model keys, or internal session details.
