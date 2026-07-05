# TODO-M1 - MVP-M1: managed agent via MCP

Handoff: self-contained work order for one autonomous coding agent. This work-order text is the sole executor authority for M1; do not rely on prior chat context.

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

- P1 pr2 `createAgent()` facade is merged into current main. Verify current main, not an old branch. The M1 implementation depends on `createAgent().start`, `createAgent().stream`, and the P1 live-tail behavior.
- Public Markdown share API is merged into current main. Owner says this is #424; verify the real symbols/routes on current main before coding and cite them in the PR.
- Local amendment-time fact: the available `origin/main` did **not** contain the public-share files, while `feature/cli-public-md-share` contained `createMarkdownReviewShare`, `registerPublicShareRoutes`, and `/share/:token/...` routes. Treat those names as expected provenance only until current main confirms them.
- If either prerequisite is absent, do not build a parallel share implementation or facade shim. Update the M1 docs with the current fact and stop.

## Goal / exit criteria

Expose one configured boring vertical agent as MCP tools. From a stock MCP client, a reviewer can delegate a brief, watch progress, receive a public Markdown share link, and open the artifact.

Exit criteria:

1. One MCP endpoint reachable by URL from a stock MCP client.
2. `delegate_task(brief)` starts exactly one fresh agent session via `createAgent().start`.
3. Session tenancy uses a real `SessionCtx` chosen by the host composition; no fake workspace id and no caller-supplied tenant authority.
4. Progress is exposed via MCP progress notifications if supported by the SDK/client path; otherwise via an explicit polling tool.
5. Result includes final text plus a public Markdown share link generated through the verified public-share API.
6. Share link opens and renders the artifact; no secrets, internal file APIs, shell routes, session storage paths, or model/provider credentials reach the caller.

## Non-negotiables

- This package **exposes** a boring agent over MCP. `plugins/boring-mcp` **consumes** external MCP sources. Use it for SDK transport patterns only; do not inherit its read-only source policy model as the server design.
- Session-per-delegation. No shared long-running session across independent `delegate_task` calls in M1.
- No secrets to callers. Return public share URLs and redacted status only.
- Behavior freeze for the live demo app. Land additive/dark; flip exposure only after smoke proof.
- PR descriptions must include review-time estimate, review-focus notes, and stack merge order.

## Do NOT

- Do NOT build a farm UI.
- Do NOT depend on T1 durable events; use P1 pr2 live-tail and document the durable-stream upgrade path.
- Do NOT add billing, marketplace, task service, or multi-agent control-plane concepts.
- Do NOT create a second public Markdown share route if #424 is not present; stop and report.
- Do NOT expose raw transcripts, workspace roots, broker secrets, env vars, OAuth tokens, or model keys through MCP payloads/logs.

## Beads

### BBM1-001 - Exposed MCP delegate server (M/L)

- Description: Add a thin MCP server package or app route that exposes a configured agent through `delegate_task(brief)` plus progress/status support.
- Files: choose the smallest additive shape after reading current package layout. Preferred for the outreach demo is an app route in the demo host (`apps/full-app` if that is the running sales demo, otherwise CLI); extract a package only if both full-app and CLI consume it in M1.
- Implementation notes:
  - Configure one agent via `createAgent(...)` with host-supplied instructions/tools.
  - `delegate_task` validates a short `{ brief: string }` input and allocates one delegation id.
  - Call `agent.start({ content: brief, actor, ctx, originSurface: 'mcp-managed-agent' })`.
  - Consume `agent.stream(sessionId, { startIndex })` from the P1 live tail. Do not require T1 replay.
  - Emit MCP progress notifications when the SDK/client path supports it. If not, expose `delegate_task_status({ delegationId })` that returns redacted status/progress and eventual result.
  - Store only server-side delegation/session state. MCP callers never receive internal session paths, raw SessionCtx, or secrets.
- Tests: unit/integration with a fake MCP client and fake `createAgent()` facade: one delegation creates one session; progress can be observed; unknown delegation is a stable error; no secret canary appears in tool results.
- Acceptance: `delegate_task` and fallback progress path work without T1; no workspace/file/shell routes are exposed through the MCP endpoint.

### BBM1-002 - Public share result integration + vertical demo composition (M)

- Description: Wire the delegation result to the public Markdown share API and host one vertical-agent config for the demo.
- Files: demo host config plus the verified public-share API import path from current main.
- Implementation notes:
  - Re-check current main and cite actual public-share symbols/routes in the PR. Expected names from the local branch are `createMarkdownReviewShare`, `registerPublicShareRoutes`, `PublicShareRecord`, and routes under `/share/:token/`.
  - The agent writes or returns a Markdown artifact. The host creates a public share record using the verified API and returns the share URL in the MCP result.
  - Host one vertical-agent config (instructions + tools) in full-app or CLI. Pick one host for M1; do not build two compositions unless the second is only a smoke fixture.
  - The endpoint URL must be usable by any stock MCP client that supports Streamable HTTP or the repo's chosen MCP transport.
- Tests: share creation uses the verified API; returned share URL points at the mounted public route; caller-visible result contains no raw workspace path beyond the public share URL.
- Acceptance: a delegated brief completes with a share link that opens the rendered Markdown artifact.

### BBM1-003 - Stock-client smoke and docs (S)

- Description: Prove the complete demo path from a stock MCP client.
- Files: minimal docs in the demo host or this work package; no marketing page.
- Implementation notes:
  - Run a stock MCP client against the URL.
  - Call `delegate_task` with a representative outreach-demo brief.
  - Observe progress through notification or polling.
  - Capture the returned share URL and open it.
  - Record exact command/client/version, URL shape, and proof notes.
- Tests: smoke script or documented manual smoke, whichever the repo already accepts for MCP endpoint proof.
- Acceptance: proof shows delegate -> progress -> result -> public share open.

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
- `pr2-share-result-demo-composition` -> BBM1-002.
- `pr3-stock-client-smoke` -> BBM1-003.

## Review gates

- Public-share API symbols/routes are cited from current main in the PR.
- P1 pr2 facade API is cited from current main in the PR.
- `plugins/boring-mcp` duality is explicitly noted: consumes MCP there, exposes MCP here.
- Each delegation creates exactly one session and does not leak `SessionCtx`.
- MCP result payloads pass a secret-canary check.
- Share URL opens without exposing workspace APIs, shell routes, model keys, or internal session details.
