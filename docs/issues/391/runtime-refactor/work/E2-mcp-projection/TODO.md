# TODO-E2 — MCP environment projection

Handoff: self-contained work order for one autonomous coding agent (pi or gpt-5.5-xhigh). Cite plan files by relative path. No prior conversation assumed.

## Context (read first)

- Plan: `docs/issues/391/runtime-refactor/architecture/09-environments-attachable.md` § "MCP projection: external reuse for free" and § "Security invariants" (read in full).
- Plan: `docs/issues/391/runtime-refactor/INDEX.md` § "Phase E2" (deliverables + exit criteria; E2 depends on E1 only).
- Plan: `docs/issues/391/runtime-refactor/architecture/08-pluggable-agent-surfaces.md` § "Conformance" item 2 (readonly projection no-leak already exists).
- Depends on **BBE1** ([`../E1-environment-attachments/TODO.md`](../E1-environment-attachments/TODO.md)): `Environment`, `EnvironmentAttachment`, `ResolvedEnvironments`, and the `resolveAttachments` reduction in `@hachej/boring-bash`. Do not start until E1's attachment contracts + scoped views land. **E1 deliberately ships no address-by-id store** — E2 introduces the plain `Map<environmentId, Environment>` (this is the first place the projection needs address-by-id), so E2 owns that Map, not E1.
- Enforcement code you MUST reuse (no parallel policy):
  - `packages/boring-bash/src/server/readonlyProjectionOperations.ts` — `createReadonlyProjectionOperations(handle)`, `ReadonlyProjectionOperations` (`read/list/find/grep/stat/rejectMutation`), error codes `READONLY_PROJECTION_MUTATION_CODE` / `_INVALID_PATH_CODE` / `_BINDING_NOT_FOUND_CODE`.
  - `packages/boring-bash/src/server/managementProjectionOperations.ts` — `createManagementProjectionOperations`, `ManagementProjectionOperations`, `ManagementProjectionHandle`.
  - `packages/boring-bash/src/server/testing/readonlyProjectionConformance.ts` — `checkReadonlyProjectionConformance(subject)`, `ReadonlyProjectionConformanceSubject`.
- Identity spine: `packages/boring-bash/src/shared/index.ts` — `BoundFilesystemContext { humanUserId, agentId, sessionId, workspaceId, requestId }`. An MCP session maps to exactly one of these.
- MCP SDK reality (verified): `@modelcontextprotocol/sdk` is already present elsewhere in the repo, but not in `@hachej/boring-bash`. `plugins/boring-mcp/package.json` currently declares the range `^1.29.0`, and `pnpm-lock.yaml` currently resolves `@modelcontextprotocol/sdk@1.29.0`. Existing production use is client-side (`plugins/boring-mcp/src/server/mcpSdkTransport.ts` imports `@modelcontextprotocol/sdk/client/index.js` `Client` + `.../client/streamableHttp.js`); existing tests already import server-side SDK classes (`McpServer`, `StreamableHTTPServerTransport`) for fake MCP servers. E2 needs the **server** side in boring-bash: `McpServer` from `@modelcontextprotocol/sdk/server/mcp.js` + `StreamableHTTPServerTransport` from `@modelcontextprotocol/sdk/server/streamableHttp.js`. Add the dependency to `packages/boring-bash/package.json` pinned exactly to `"1.29.0"` (no caret).
- Server barrel to extend: `packages/boring-bash/src/server/index.ts` may keep non-MCP exports only. Package exports live in `packages/boring-bash/package.json` (`.`/`./shared`/`./server` today). **Pinned decision:** E2 adds a separate `./mcp` entrypoint so the MCP/SDK dependency is not pulled by the base `@hachej/boring-bash/server` import path for non-MCP consumers.

## Goal / exit criteria

Match `INDEX.md` Phase E2 exit criteria:
1. An external MCP client (e.g. Claude Code) mounts a boring environment and sees exactly what an in-process **readonly** attachment sees.
2. Denied files are absent over MCP (no-leak).
3. No broker secret is reachable from the MCP client.
4. The existing no-leak conformance suite runs as the **MCP mount** (alongside the in-process and scoped-view delivered mounts; the remote-worker provider mount is deferred to BBP5-010).
5. Remote-worker stays a provider (P2/P5); its reclassification as an environment transport is **deferred to a post-E2 follow-up filed at P8** — E2 does not perform it (see BBE2-005).

## Non-negotiables

- Enforcement reuses the existing projection operations verbatim. The MCP tool handlers are a **thin adapter**: `read` tool → `operations.read(descriptor)`; a denied path throws the existing `ReadonlyProjectionOperationError` and the MCP handler maps it to an MCP error/`isError` result **without leaking the path** (the projection already replaces leaked paths with `not_found_or_denied`/`readonly`). No new path-filtering, no new policy branch.
- Tool surface is capability-gated by the attachment:
  - Always (any access): `fs.read`, `fs.list`, `fs.stat`, `fs.find`, `fs.grep`.
  - `fs.write` / `fs.edit` **iff** `access: 'readwrite'` (route through management projection ops; readonly attachments must not register these tools at all).
  - `exec` **iff** `execPolicy: 'attached'` (default `'none'` → no exec tool). Follows #416 exec rules unchanged.
- MCP session → `BoundFilesystemContext` identity mapping is mandatory; every tool call carries the same audit identity as an in-process attachment (`09` MCP projection bullet + security invariant 1).
- Credential brokering stays at the environment boundary; the MCP client never receives broker secrets (`09` security invariant 3).
- **Amendment (2026-07-06) — run-context threading guardrail (475 watch-list):** the run-context threading via `createHarness.ts` AsyncLocalStorage is fragile — a run spawned without binding context silently loses identity (fails closed, but a debugging tax). Every new run-spawn path added in E2 (MCP-projection tool sessions) MUST bind `BoundFilesystemContext` and MUST extend the #498 binding test suite with that path.

## Do NOT

- Do NOT write a second enforcement path. If you find yourself re-implementing path jailing or readonly rejection, stop and call the existing projection op.
- Do NOT expose `fs.write`/`fs.edit`/`exec` tools on a readonly / `execPolicy: 'none'` attachment — omit them from the registered tool list, don't just reject at call time.
- Do NOT put the MCP/SDK dependency on the base `@hachej/boring-bash/server` import path; use the required `./mcp` subpath export.
- Do NOT touch `/home/ubuntu/projects/boring-ui-v2`. Work on a dedicated branch/worktree per the PR-PLAN branch naming; never commit to main directly; every bead lands as a PR per INDEX.

## Beads

### BBE2-001 — MCP server projection factory (M)
- Description: `createEnvironmentMcpServer(attachment, operations, identity)` returns a configured `McpServer` exposing the capability-gated tool surface.
- Files: create `packages/boring-bash/src/server/mcp/environmentMcpServer.ts`; add `@modelcontextprotocol/sdk` pinned exactly to `1.29.0` (no caret) to `packages/boring-bash/package.json` deps; add a `./mcp` export in `package.json` + `packages/boring-bash/src/server/mcp/index.ts`.
- Notes: Register tools from `@modelcontextprotocol/sdk/server/mcp.js` `McpServer`. Each tool's handler is a one-liner over the injected `ReadonlyProjectionOperations` / `ManagementProjectionOperations` (from E1's `resolveAttachments` reduction). **Address-by-id lands here (not in E1):** introduce a plain `Map<environmentId, Environment>` in `packages/boring-bash/src/server/mcp/` so an MCP mount can resolve an environment by id before projecting it — this is the first real need for id-lookup, which is why E1 ships none. Gate `write`/`edit` on `attachment.access === 'readwrite'`; gate `exec` on `attachment.execPolicy === 'attached'`. Input schemas take `{ path }` (+ `{ content }` for write, `{ pattern, offset?, limit? }` for find/grep) — mirror the projection op signatures. Map thrown `ReadonlyProjectionOperationError`/`ManagementProjectionOperationError` to MCP error results using the error `code`, never the raw path.
- Tests: `packages/boring-bash/src/server/mcp/__tests__/environmentMcpServer.test.ts` — instantiate against a readonly `company_context` attachment (via E1 `resolveAttachments` + `FixtureCompanyContextBindingProvider`); assert `write`/`edit`/`exec` tools are NOT registered; assert `read` of an allowed path succeeds and denied path returns an error result with no denied-name/sentinel in the payload.
- Acceptance: readwrite attachment additionally registers `write`/`edit`; exec attachment additionally registers `exec`; readonly does not.

### BBE2-002 — MCP session → `BoundFilesystemContext` identity (token-per-projection v1) (M)
- Description: Authenticate the MCP actor and bind each session to one `BoundFilesystemContext`.
- Files: `packages/boring-bash/src/server/mcp/mcpSessionIdentity.ts`.
- Notes: v1 model (propose + implement): **token-per-projection**. The host mints an opaque bearer token when it projects an environment for an actor; the token maps 1:1 to a fixed `BoundFilesystemContext`. The MCP transport (`StreamableHTTPServerTransport` from `@modelcontextprotocol/sdk/server/streamableHttp.js`) validates the token on connect and stamps the resolved `BoundFilesystemContext` onto every tool call for that session. Reject connections with a missing/unknown token. Document that finer-grained per-request identity is a later transport concern; v1 pins identity at session establishment. The token is a projection capability, NOT a broker secret — brokered credentials never cross to the client. **Workspace-bound context is required (`09` security invariant 5):** the host only mints a projection token for a **workspace-bound** `BoundFilesystemContext` (`workspaceId` is real — locked #416). An environment (`company_context`, any governed fs) is **never projected for a workspace-less context**; there is no MCP projection until the host has bound the actor to a workspace, and the token never carries a synthesized `workspaceId`.
- Tests: `.../mcp/__tests__/mcpSessionIdentity.test.ts` — a valid token resolves to the expected `BoundFilesystemContext`; an unknown token is rejected; two tokens for two actors resolve to distinct contexts and cannot cross-read.
- Acceptance: every projected tool call carries the session's `BoundFilesystemContext`; unauthenticated calls rejected.

### BBE2-003 — No-leak conformance as the MCP mount (M)
- Description: Run `checkReadonlyProjectionConformance` with `operations`/`projection` driven **through the MCP tool surface** (a client calling the projected server), proving parity with in-process/scoped/remote-worker.
- Files: `packages/boring-bash/src/server/mcp/__tests__/mcpProjectionConformance.test.ts`.
- Notes: Build a `ReadonlyProjectionConformanceSubject` whose `operations.read/list/find/grep` call the MCP client (`@modelcontextprotocol/sdk/client` in-memory transport pair) against the projected server, and whose `projection.listVisiblePaths` enumerates via the `fs.list`/`fs.find` tools. Reuse the same fixture seeds/expected paths the in-process mount uses so the assertion set is identical. The suite's existing checks (denied read rejects, grep sentinel absent, write rejects) then validate over MCP unchanged.
- Tests: the file is the test; `passed: true`.
- Acceptance: identical expected visible-path set to the in-process mount; denied files absent; writes reject over MCP.

### BBE2-004 — Exec-over-MCP gating (S)
- Description: When `execPolicy: 'attached'`, expose an `exec` tool that follows #416 exec rules; otherwise omit it.
- Files: `packages/boring-bash/src/server/mcp/environmentMcpServer.ts` (exec branch); `.../mcp/__tests__/execGating.test.ts`.
- Notes: The exec handler delegates to the environment's exec ops (the same seam a real `bwrap`/`direct` provider exposes); for E2 a fixture/no-exec environment simply never registers the tool. Assert secrets injected at the environment boundary are not present in exec output or tool metadata returned to the client (`09` invariant 3).
- Tests: no-exec attachment → tool absent; a fixture exec attachment → tool present, and a brokered-secret sentinel is unreachable from the client-visible result.
- Acceptance: exec presence tracks `execPolicy`; no broker secret leaks.

### BBE2-005 — File the remote-worker-as-transport follow-up (do NOT reclassify here) (S)
- Description: Documentation-only bead. **Remote-worker stays a provider in this epic (P2/P5 as written).** Do NOT reclassify it as an environment transport in E2 — that reclassification is a **post-E2 follow-up**.
- Files: append to `packages/boring-bash/docs/environments.md` (or the nearest existing env doc — check `packages/boring-bash/README.md`) a short note that MCP is the external-agent transport and that reclassifying remote-worker from a provider to *a transport for an environment* (peer to in-process and MCP) is an identified future direction, **deferred to a follow-up issue to be filed at P8** — it is not done here and nothing in E2 changes the P2/P5 remote-worker-as-provider design. Cross-link `docs/issues/391/runtime-refactor/architecture/09-environments-attachable.md` ("Remote-worker ownership").
- Notes: State the "one suite, N mounts" invariant per `07` (delivered mounts: in-process, scoped+symlink, MCP; the remote-worker provider-attachment mount is deferred, owned by BBP5-010). Mounts are named, never numbered. No code. No live instruction that contradicts P2/P5.
- Tests: none (doc); ensure any doc-lint/link check in CI passes.
- Acceptance: remote-worker still described as a provider; the transport reclassification is filed as a deferred P8 follow-up, not performed; no contradiction with `09`, P2, or P5.

## Verification — exact commands verified against package.json scripts

```bash
pnpm --filter @hachej/boring-bash run build       # tsup — confirms ./mcp entrypoint bundles
pnpm --filter @hachej/boring-bash run typecheck   # tsc --noEmit
pnpm --filter @hachej/boring-bash run check:invariants
pnpm --filter @hachej/boring-bash run test        # vitest run — includes the delivered conformance mounts

# repo-wide regression + import audit
pnpm run build:packages
pnpm audit:imports
pnpm run test
```

## PR-PLAN reconciliation

Matches [`../../PR-PLAN.md`](../../PR-PLAN.md) E2 rows exactly:

- `pr1-mcp-server-exec-gating` → BBE2-001 + BBE2-004.
- `pr2-mcp-session-identity` → BBE2-002.
- `pr3-mcp-conformance-doc` → BBE2-003 + BBE2-005.

## Review gates

- Grep the new MCP handlers: every fs/exec handler calls an existing projection op — zero new jailing/readonly/traversal logic.
- Readonly attachment registers exactly the read-family tools; readwrite adds write/edit; exec only under `execPolicy: 'attached'`.
- Conformance mount reuses the same expected visible-path set as in-process (diff the subject seeds).
- No broker secret is present in any client-reachable MCP payload (assert in BBE2-004).
- `@modelcontextprotocol/sdk` pinned to an exact `1.29.0` (no caret), matching the pack's exact-pin discipline.
