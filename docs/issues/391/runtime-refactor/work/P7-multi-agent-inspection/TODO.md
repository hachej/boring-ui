# TODO-P7 — Multi-agent routing/session/search + agent inspection (the steering mechanism)

Coordinator: never assign this whole file. Dispatch one bead/PR with this
file's context, dependencies, and non-negotiables included in the assignment.

## Context (read first)

- Plan: `docs/issues/391/runtime-refactor/INDEX.md` § "Phase 7 — Multi-agent routing/session/search" (v1 body + v2 additions: surface adapters address agents via `agentId`; the `GET /api/v1/agents` list endpoint and `GET /api/v1/agents/:agentId/info` inspection endpoint). Exit: v1 + "two surfaces bound to two agents in one workspace do not collide".
- Plan: `docs/issues/391/runtime-refactor/architecture/05-multi-agent-sessions-hooks.md` — the full requirement set: workspace agent registry, route/session namespace scoping, session history search (#379), deep links (#243/#211), external harness hooks (#380), user-as-principal, concurrency safeguards, and the § "Tests" list (these are the checkable v1 exit criteria).
- Plan: `docs/issues/391/runtime-refactor/architecture/08-pluggable-agent-surfaces.md` § "The steering surface" (the workspace is the control plane; steering = the workspace consuming the same public contracts, with more of them — the agent-list endpoint plus `/info`, never private core hooks; eve `/eve/v1/info` analog) and § "Two handles (hard rule)".
- Plan: `docs/issues/391/runtime-refactor/architecture/00-global-isa.md` § "North star" (eve-class UX steered from the workspace) and invariants 11 (surfaces never own the loop), 12 (two handles), 9 (user as principal, not a model-callable root agent). Open decision 4 (multi-agent route shape) is **resolved — locked at pass 3**: the single canonical `/api/v1/agents/:agentId` path-prefix family (no header alternative). BBP7-002 records and implements it.
- Plan: `docs/issues/391/runtime-refactor/architecture/09-environments-attachable.md` § "Consumers" (subagent attaches by explicit `EnvironmentAttachment`, never cwd inheritance) — P7 is the first real subagent consumer and lands the E1-deferred grant.
- BINDING policy: `docs/issues/391/runtime-refactor/INDEX.md` "Simplicity & no-compat policy" — no shims, no abstraction without two real consumers, `TODO(remove:<bead-id>)` regime, migrate every importer in the same PR.

### Depends on

- **P6-R stateless resolved-value contract:** [`../../INDEX.md`](../../INDEX.md)
  Phase 7 consumes P6-R as a function over verified definition/deployment,
  authorized workspace-composition manifest/digest, and runtime facts. P7 does
  not depend on P6b child-app scoping. BBP7-002 is the named first consumer that
  may introduce one host-owned registry for multi-agent routing; do not add it
  to P6-R or create competing registries.
- **T1** supplies `agent.db`, on-stream approvals, pending requests, and `resolveInput`.
- **T2** ([`../T2-transport/TODO.md`](../T2-transport/TODO.md)): `sessionId`-only public transport; the platform-addressing invariant guard. Surface `agentId` binding (BBP7-007) rides the two-handles boundary T2 formalized.
- **E1** ([`../E1-environment-attachments/TODO.md`](../E1-environment-attachments/TODO.md)): `prepareAttachmentLifetime` returns methodless facts plus auth-gated contributions; every operation enters `AttachmentLifetimeOwner.withAuthorizedView`. Raw prepared handles never leave that callback. `AttachmentLifetimeKey` is canonically encoded from trusted storage/workspace/subject/agent/runtime/session identity and excludes request id. BBP7-008 lands E1's deferred `BBE1-005` (`SubagentEnvironmentGrant` / `deriveSubagentAttachment`) on that API.

### Current boring code this extends (verified paths)

- `packages/agent/src/server/registerAgentRoutes.ts`:
  - `interface RuntimeScope { root; key; templatePath?; pi; sessionNamespace? }` (L130-136).
  - `resolveRuntimeScope()` (L395-425) builds `key = JSON.stringify([resolvedMode, workspaceId, root, scopedTemplatePath ?? null, pi, sessionNamespace ?? null, extraToolsAuthSubject ?? null])` (L415-423). **`agentId` is NOT in this array** — this is the exact `05` note "do not assume a preexisting single composite key has every field". The per-workspace `runtimeBindings` Map is keyed on `scope.key`; `earlySessionStores` too (L848). **This is the binding scope key P7 must extend with `agentId`.**
  - `getRequestWorkspaceId(request)` (L143) reads `request.workspaceContext?.workspaceId` — the request-scope resolver that P7's **path** `agentId` resolver sits beside. There is no header form for `agentId`.
- `sessionNamespace` seam (the transcript-isolation authority — `05` "session namespace includes agent id"): `createAgentApp.ts:71,212` → `registerAgentRoutes.ts` (`normalizeSessionNamespace` L172, `resolveRuntimeScope` L406-408) → `harness.ts:12` → `harness/pi-coding-agent/createHarness.ts:349,366` → `harness/pi-coding-agent/sessions.ts:93,113` (`PiSessionStore` → `sessionDirForNamespace(namespace, sessionRoot)`). Including `agentId` in `sessionNamespace` **physically** separates transcript dirs — the AGENTS.md rule (`05`: transcripts under host durable `BORING_AGENT_SESSION_ROOT`) stays intact.
- `packages/agent/src/server/harness/pi-coding-agent/sessions.ts` — `PiSessionStore implements SessionStore`; `list(ctx: SessionCtx, options?: SessionListOptions)` (L122) lists `.jsonl` files in `sessionDir` sorted by mtime; **no content search, no `agentId` scope**. `SessionCtx { workspaceId, userId? }` (verified `__tests__/session.test-d.ts:17-18`). What exists today: only a **front-side** fuzzy/recent filter — `packages/agent/src/front/chat/session/piSessionSearch.ts` (`searchPiSessions`, `matchPiSessionSearch`, `parsePiSessionSearchQuery` over already-loaded `PiSessionSearchItem`s). It does NOT do server-side content search, redaction, or `agentId` scoping. The `#379` delta is a **server** search API (below), not a new UI.
- `packages/agent/src/server/pi-chat/harnessPiChatService.ts` — `listSessions(ctx, options)` (L93) delegates to `sessionStore.list(toSessionCtx(ctx), options)`; `toSessionCtx(ctx)` (L681) maps the request context to `SessionCtx`.
- Readiness: `packages/agent/src/server/runtime/readyStatus.ts` (`ReadyStatusTracker`), `.getReadiness()` → `{ sandboxReady, harnessReady, capabilities: { runtimeDependencies: { state } } }`; route `packages/agent/src/server/http/routes/readyStatus.ts` (`GET /api/v1/ready-status`, SSE). Per-agent readiness = one tracker per `(workspaceId, agentId)`.
- Tool catalog / model info precedent for `/info`: `packages/agent/src/server/http/routes/models.ts` — `GET /api/v1/agent/models`; **public, cheap, safe-to-call-unauthenticated, never leaks key material** (header comment L18-19). The `/info` endpoint mirrors this shape and safety posture exactly.
- Tool seams (per-agent catalog): `buildHarnessAgentTools()`, `buildFilesystemAgentTools()`, `mergeTools({ checkReadiness })` (`00` § "Current seams to reuse").
- No external-hook seam exists (`grep` for `externalHook|reviewHook|onOperationalEvent` → 0). `#380` is greenfield.

## Goal / exit criteria

Make [`../../INDEX.md`](../../INDEX.md) Phase 7 + [`../../architecture/05-multi-agent-sessions-hooks.md`](../../architecture/05-multi-agent-sessions-hooks.md) § "Tests" checkable:

1. Agent addressing resolves an `agentId` per request via the canonical
   `/api/v1/agents/:agentId/...` path-prefix family against the single P7 host
   registry of stateless P6-R entries; unknown/undeclared `agentId` fails closed.
2. Trusted structured scope contains workspace/tenant, `agentId`, and public
   `sessionId`; UUID uniqueness is not authorization. Default JSONL namespace
   compatibility remains an adapter concern.
3. Per-agent tool catalog and per-agent readiness (reviewer readonly/no-exec while coding agent has bash; pure concierge has no boring-bash — `05` Tests).
4. Later P7 slice: redacted no-filesystem search from a derived `agent.db` table.
5. External harness hook target resolution: authenticate caller, validate `(workspace, agent, session)`, redact, route to the HITL channel, audit attribution, no boring-bash dep (`#380` / `05`).
6. `GET /api/v1/agents` returns a scrubbed list sourced from the P7 host
   registry, and `GET /api/v1/agents/:agentId/info` returns
   `{ agentId, model, tools, readiness, channels, environments }` per listed id
   — public contracts, no private core hooks (the steering mechanism, `08`/`00`).
7. Surface adapters (workspace pane, Slack `conversationKey`, Excel workbook) each bind exactly one `agentId` per addressing entry (INDEX Phase 7 addition).
8. First real subagent consumer: `SubagentEnvironmentGrant` / `deriveSubagentAttachment` (E1-deferred `BBE1-005`) lands, jailed by `agentId` scope + `scope.subpath`, minimal.
9. **Two surfaces × two agents in one workspace do not collide by namespace/scope/metadata** (the Phase 7 exit test); no implementation relies on duplicate `sessionId` strings across agents.

## Non-negotiables

- P7 owns exactly one host registry whose entries are stateless P6-R outputs.
  Do not add registry/pointer/generation ownership to P6-R or build a second
  registry (`00` invariant 10).
- The P7 registry stays local/minimal. Do not reserve speculative
  remote-entry fields (`endpoint`, `auth`, remote client shape, delegation
  channel) until a remote-delegation bead lands with a real consumer.
- Extend the existing `RuntimeScope.key` array for all agents and `sessionNamespace` for non-default agents — do NOT assume a preexisting composite key already has `agentId` (`05` explicit warning). Legacy fields (root/template/pi/sessionNamespace) stay isolated where they already are, and the default agent keeps its pre-P7 `sessionNamespace` unchanged.
- `/info` is a **public read contract** modeled on `models.ts`: cheap, safe unauthenticated at the same level `models` is, and it MUST NOT leak secrets, broker credentials, or provider key material (`00` invariant 14).
- Two-handles rule (`08`/T2): public agent APIs stay `sessionId`-keyed; `agentId` is boring's own routing scope (like `workspaceId`/`SessionCtx`), NOT surface-native platform addressing — allowed on the façade/routes, subject to the same rule that surface-native identifiers are not. One addressing entry → one `agentId`; a surface never multiplexes agents on one continuation key.
- `sessionId` is runtime-owned public identity. Store/cache access always checks
  trusted structured scope including `agentId`; public id alone grants nothing.
- User is a principal/supervisor/approval channel, NOT a model-callable agent (`00` invariant 9; `05`). Do not add the human as a P7 registry entry.
- Subagent grant is minimal (E1 BBE1-005 shape) — explicit attachment only, `execPolicy: 'none'` default, no cwd inheritance, no lifecycle framework. Abstraction is justified only because P7 is its **first real consumer** (`README.md` rule 3).
- Session search has no filesystem requirement and uses a derived `agent.db` index.
- `@hachej/boring-agent` keeps zero value imports from `@hachej/boring-bash`; `#380` hooks and search stay boring-bash-free (`05`).
- **Amendment (2026-07-06) — run-context threading guardrail (475 watch-list):** the run-context threading via `createHarness.ts` AsyncLocalStorage is fragile — a run spawned without binding context silently loses identity (fails closed, but a debugging tax). Every new run-spawn path added in P7 (subagent runs, BBP7-008) MUST bind `BoundFilesystemContext` and MUST extend the #498 binding test suite with that path.

## Do NOT

- Do NOT touch `/home/ubuntu/projects/boring-ui-v2`. Work on a dedicated branch/worktree per the PR-PLAN branch naming; never commit to main directly; every bead lands as a PR per INDEX.
- Do NOT add any registry besides the one P7-owned host registry of stateless
  P6-R outputs; P6 owns no resolved registry.
- Do NOT put platform-addressing (Slack thread ts, workbook id, pane id) into any core signature — `agentId`/`sessionId`/`SessionCtx` only (T2 guard must stay green).
- Do NOT build the control-plane UI panels — that is [`../S3-control-plane-ux/TODO.md`](../S3-control-plane-ux/TODO.md) (S3 consumes the `/info` endpoint this bead ships).
- Do NOT build a full policy/permission engine for subagents; ship the grant contract + reduction only.
- Do NOT leak any secret/key material through `/info` or search.

## Beads

### BBP7-001 — Thread `agentId` through `RuntimeScope`, the scope key, and `sessionNamespace` · size M
- **Title**: Add `agentId` to `RuntimeScope`, the `runtimeBindings`/`earlySessionStores` key array, and the session namespace.
- **Files touch**: `packages/agent/src/server/registerAgentRoutes.ts` — add `agentId?: string` to `interface RuntimeScope` (L130); resolve it in `resolveRuntimeScope()` (from BBP7-002's addressing resolver) and append it to the `key` array (L415-423) **and** fold it into `sessionNamespace`. **The `:agent:<agentId>` suffix applies to NON-DEFAULT agents ONLY**: for a non-default agent compose `${baseNamespace ?? ''}:agent:${agentId}` via `normalizeSessionNamespace`, so its transcript dirs separate; for the **default agent, leave `sessionNamespace` exactly as pre-P7 — NO `:agent:` suffix, no other change** (so its on-disk JSONL session dir is byte-identical to today and existing sessions keep loading). Note the `key` array still carries `agentId` for all agents (binding isolation); it is only the *sessionNamespace* that stays untouched for the default agent (transcript-dir compat). `packages/agent/src/server/createAgentApp.ts` — pass an `agentId`/`getAgentId` option through to `registerAgentRoutes` (adapter over the Phase-1 `createAgent()` façade; if the façade already carries agent identity, thread from there).
- **Notes**: Do not disturb the E1 `filesystemRuntimeScopeKey` (already has `agentId`) — this bead is the *route/runtime* scope key, the sibling `05` calls out as possibly missing the field. Keep single-agent behavior byte-identical when `agentId` is the default agent: the sessionNamespace is unchanged for the legacy default (no `:agent:` suffix) so existing on-disk sessions keep loading — verify against `sessions.ts` `sessionDirForNamespace` that the default agent's `sessionDir` is identical to the pre-P7 path.
- **Tests**: `registerAgentRoutes.test.ts` — two **non-default** `agentId`s in one `workspaceId` produce distinct `scope.key` and distinct `:agent:`-suffixed `sessionNamespace`; the **default agent yields the pre-P7 namespace unchanged** (no `:agent:` suffix, no session-dir migration). **Explicit compat test:** seed a session-dir with a pre-P7 default-agent JSONL transcript, then load it through the P7 default-agent path and assert it resolves to the SAME `sessionDir` and the existing session loads unchanged (no migration, no new dir). Extend `createHarness.test.ts` namespace cases with an `agentId` axis (default vs non-default).
- **Acceptance**: binding cache + session namespace include `agentId` (`05` Tests: "session namespace includes agent id", "binding cache includes agent id"); default-agent sessions load unchanged.

### BBP7-002 — `agentId` addressing against the P7-owned registry · size M
- **Title**: Resolve a validated `agentId` per request from the canonical `/api/v1/agents/:agentId` path prefix; fail closed on unknown agents.
- **Files touch/create**: create exactly one host-owned `P7AgentRegistry` whose entries are stateless P6-R outputs, then inject it into `packages/agent/src/server/registerAgentRoutes.ts`. Add a `getAgentId(request)` resolver alongside `getRequestWorkspaceId` (L143): read the `/api/v1/agents/:agentId/...` path param (the locked route shape — **no header form**) and validate it against the P7 registry. **There is NO absent-`agentId` fallback: `default` is an explicit path segment (`/api/v1/agents/default/...`) that resolves to the workspace's default agent; an absent/empty `:agentId` is an invalid route → 404, never silently mapped to the default.** Reject both an undeclared `agentId` and an absent `:agentId` with a stable `AGENT_NOT_FOUND`/invalid-route error (mirror `createHttpError`, `error-codes.ts`). Wire the resolved `agentId` into `resolveRuntimeScope` (BBP7-001).
- **Notes (`00` open decision 4 — resolved/locked at pass 3; record it in the file header)**: the decision is already made — adopt **ONE canonical route family — the path prefix `/api/v1/agents/:agentId/...`** for all agent-**session** routes (explicit, cache-key-friendly, matches the `/info` endpoint and the eve `/eve/v1/*` analog). **No header/request-scope form exists.** **T1 owns and created this canonical family from day one, and T2 already deleted the legacy `…/pi-chat/:sessionId/*` routes** — so **P7 migrates no legacy route paths; it still adds `/info` and `/sessions/search` within the canonical family** (BBP7-005/004): nothing unprefixed is left to move and P7 introduces no bridge, but P7 does grow the already-canonical family with these two agent-session sub-paths. P7 **only adds** `agentId` resolution against the registry, scoping validation, and per-agent catalog/info on top of the already-canonical family (BBP7-003/005). Do not add a header form for any agent-scoped route. **Route-family scope (locked, `08` "Route-family scope"):** this family is agent-**session** routes ONLY (sessions, events/stream, prompt, input, interrupt, stop, pending-inputs, `/info`); file/environment routes (`/api/v1/files/*`, tree/search/fs-events/git) are workspace/environment-scoped and explicitly OUT of the family — `agentId` never prefixes a file route.
- **Tests**: route test — a request for a declared `agentId` resolves + scopes; an undeclared one 404/`AGENT_NOT_FOUND`; the explicit `default` segment (`/api/v1/agents/default/...`) resolves to the workspace default agent; an **absent/empty** `:agentId` is an invalid route → 404 (NOT mapped to the default).
- **Acceptance**: one P7-owned registry is seeded only with authorized stateless P6-R outputs; unknown agent fails closed; P6 owns no registry.

### BBP7-003 — Per-agent tool catalog + per-agent readiness · size M
- **Title**: One tool catalog and one `ReadyStatusTracker` per `(workspaceId, agentId)`.
- **Files touch**: the per-scope tool assembly path in `registerAgentRoutes.ts` / `createAgentApp.ts` where `mergeTools`/`buildHarnessAgentTools`/`buildFilesystemAgentTools` are composed — key the catalog by the BBP7-001 scope so a reviewer (`bash: { fs: 'readonly', exec: false }`) and a coding agent (full bash) and a pure concierge (no bash attachment) each get a distinct catalog. Readiness: instantiate a `ReadyStatusTracker` per scope (`runtime/readyStatus.ts`) and resolve the agent's tracker from the BBP7-001 scope. **P7 adds NO agent-scoped `/ready-status` route** — per-agent readiness is served inside the existing `GET /api/v1/agents/:agentId/info` payload (BBP7-005). P7 is readiness *resolution-only*; the canonical agent-scoped route family is owned/created by T1/T2, not extended here. The existing non-agent-scoped `GET /api/v1/ready-status` SSE route stays as-is; do not add an agent-scoped `/ready-status` variant.
- **Notes**: `provisioning is per (workspaceId, agentId, bashPlanFingerprint)` (`05`) — the scope key from BBP7-001 already yields this because `getOrCreateRuntimeBinding()` reads/writes `runtimeBindings` by `scope.key` (verified current code: `registerAgentRoutes.ts` L725-777). `runRuntimeProvisioning(workspaceId, scope, request)` is called from that binding creation path; do not add a separate provisioning cache key. No readiness bleed across agents (`05` concurrency: "tool readiness bleed").
- **Tests**: `05` Tests — "per-agent tool catalog differs as expected"; "reviewer has readonly fs/no exec while coding agent has bash"; "pure concierge has no boring-bash"; two agents' readiness trackers report independently (each surfaced via its `GET /api/v1/agents/:agentId/info` payload per BBP7-005 — assert no agent-scoped `/ready-status` route is added).
- **Acceptance**: catalog + readiness differ per agent with no cross-agent bleed.

### BBP7-004 — Session index/search scoped by workspace + agent (#379) · size L
- **Title**: A derived `agent.db` session index/search API independent of boring-bash, scoped by trusted workspace + agent context.
- **Files create/touch**: fold the `agent.db` event tables into a derived session
  index keyed by trusted structured scope; search redacts private/tool output and
  carries deep-link metadata. The index is rebuildable and never authority.
- **Notes**: no filesystem requirement; query serving reads derived `agent.db`
  tables, not workspace files or raw JSONL on the hot path.
- **Tests**: agent A cannot return agent B; redaction and deep links work; drop/rebuild the derived index from `agent.db` events and compare results.
- **Acceptance**: scoped, redacted, no-fs search over a rebuildable `agent.db` derivative.

### BBP7-005 — Agent list + inspection endpoints (the steering mechanism) · size M
- **Title**: Public agent-list and per-agent info endpoints — list declared agents, then inspect one agent's model/tools/readiness/channels/environments — modeled on `models.ts`.
- **Files create/touch**: `packages/agent/src/server/http/routes/agentInfo.ts` (new) — `GET /api/v1/agents` and `GET /api/v1/agents/:agentId/info`. The list route is the public, checkable source for Fleet's agent ids: return a scrubbed `{ defaultAgentId, agents: [{ agentId, label? }] }` payload sourced from the P7 host registry of stateless P6-R entries; no tool/env/readiness details in the list. The info route composes from public sources already wired: model selection (`models.ts` / `modelConfig`), the per-agent tool catalog names (BBP7-003), readiness snapshot (`ReadyStatusTracker.getReadiness()`), declared channels (from the resolved entry / surface bindings BBP7-007), and attached environments (`ResolvedEnvironment` facts: filesystem ids, access, accepts-input-assets, tools/provider labels — type-only shape from E1, never handles or methods). Register beside `modelsRoutes` in `createAgentApp`.
- **Notes**: Info shape (stable public contract, eve `/eve/v1/info` analog):
  ```jsonc
  { "agentId": "coding",
    "model": { "provider": "anthropic", "id": "claude-...", "available": true },
    "tools": [{ "name": "bash", "ready": true }, ...],
    "readiness": { "state": "ready", "runtimeDependencies": "ready" },
    "channels": [{ "kind": "workspace" }, { "kind": "slack" }],
    "environments": [{ "filesystem": "company_context", "access": "readonly", "exec": "none" }] }
  ```
  **Never** emit secrets, broker credentials, provider key material, or environment handles (`00` invariant 14; `models.ts` safety posture). S3 ([`../S3-control-plane-ux/TODO.md`](../S3-control-plane-ux/TODO.md)) is the consumer — these endpoints are the entire private-hook-free steering surface.
- **Tests**: `agentInfo.route.test.ts` — `GET /api/v1/agents` returns every registered agent id/label and the default id from the single P7 registry with no secret/detail fields; `/agents/:agentId/info` reports that agent's model/tools/readiness/channels/environments; a reviewer agent shows readonly env + no bash tool; a pure concierge shows no environments and no bash; asserts no key/secret field is present in either payload.
- **Acceptance**: [`../../INDEX.md`](../../INDEX.md) Phase 7 "agent inspection endpoint … consumed by workspace panels"; the Fleet page has a public source for every declared agent id; no private core hooks, no secret leak.

### BBP7-006 — External harness hook target resolution (#380) · size M
- **Title**: Resolve `(workspace, agent, session)` for an external review/question/approval hook; authenticate, validate, redact, route to the HITL channel, audit.
- **Files create**: `packages/agent/src/server/hooks/externalHookTarget.ts` (new) — the external-hook **request/callback/redaction contract** `ExternalAgentHookRequest { source{ harnessId, agentId?, workspaceId?, sessionId?, provider? }; kind: 'review'|'question'|'approval'; body; redactionPolicy?; callback?{ url; authRef? } }` **and** `resolveHookTarget({ authCaller, workspaceId, agentId, sessionId }): Promise<{ ctx; agentId; sessionId } | { rejected, reason }>`: authenticate the caller (host auth seam), validate the workspace/agent against the single P7-owned registry and validate that the session belongs to that agent scope; reject cross-agent/cross-workspace targets. Route the hook onto the **single approval channel** (T1 on-stream request/`resolveInput`) — an external question becomes a `data-approval-request` on that session's stream; no second channel. Redact before writing to history; record audit attribution (caller id).
- **Notes**: boring-bash-free (`05` Requirements: "no boring-bash dependency"). This is target *resolution + routing onto T1*, not a new approval mechanism (`00` invariant 13 — one approval channel). The external-hook contract itself is **P7 scope** — it was **moved out of Phase 1 in pass-4** (it depends on the T1 durable approval channel, so it cannot land before durable approvals); `01-agent-core-runtime-free.md` now de-scopes it from P1 and points here. This bead **owns** the request/callback/redaction contract shape (above) plus the multi-agent routing/validation (`05` § "External harness review/question hooks").
- **Tests**: `externalHookTarget.test.ts` — a valid caller/workspace/agent/session resolves and emits a request on that session's stream; a foreign agent/session or unauthenticated caller rejects; the written history entry is redacted; audit attribution recorded.
- **Acceptance**: `05` Tests "external hooks authenticate/redact/route"; routes onto the single T1 approval channel; no boring-bash import.

### BBP7-007 — Surface adapters bind one `agentId` per addressing entry · size S
- **Title**: One addressing entry (workspace pane / Slack `conversationKey` / Excel workbook) binds to exactly one `agentId`.
- **Files touch**: the surface addressing seam from T2/S1 — extend the surface-owned `addressing → sessionId` map to carry `agentId` (the map becomes `addressing → { sessionId, agentId }`), so `agent.send`/`stream`/`resolveInput` for that entry always target that agent's scope. For the Slack adapter (`packages/channels/slack`, if landed) the `SlackSessionStore` records `agentId` alongside the `sessionId` when it `set`s the mapping (the store never allocates the `sessionId` — `agent.start` does, per S1 BBS1-003); the workspace pane binding records the pane's agent.
- **Notes**: `agentId` stays surface-side metadata that selects the routing scope — it is NOT passed as platform addressing into a core signature (BBP7-001 resolves it into `RuntimeScope`). One surface cannot address two agents on one continuation key ([`../../INDEX.md`](../../INDEX.md): a Slack channel or embed binds to one `agentId` per addressing entry).
- **Tests**: adapter test — two panes/threads bound to two agents resolve to two distinct scopes; a single continuation key never yields two `agentId`s.
- **Acceptance**: one addressing entry ↔ one `agentId`; addressing isolation holds across agents.

### BBP7-008 — Subagent environment grant (first real consumer; lands E1 BBE1-005) · size S
- **Title**: `SubagentEnvironmentGrant` + `deriveSubagentAttachment` — explicit attachment, jailed by `agentId` + `scope.subpath`.
- **Files create/touch**: `packages/boring-bash/src/shared/environment.ts` — add `SubagentEnvironmentGrant { parentEnvironmentId: string; scope?: { subpath?: string }; access: FilesystemAccess }` (E1-deferred shape). `packages/boring-bash/src/server/deriveSubagentAttachment.ts` — add the pure function `deriveSubagentAttachment(parent: EnvironmentAttachment, grant: SubagentEnvironmentGrant): EnvironmentAttachment` (reuses parent `environmentId`/`filesystem`, adds `scope.subpath` for a jailed view, `execPolicy: 'none'` default, never copies a cwd). **This is a pure helper — no registry object, no lifecycle, no state.** Export from the server barrel. The host prepares a distinct child `AttachmentLifetimeKey` containing the subagent `agentId`; consumers receive only child facts/contributions and each operation reauthorizes through `withAuthorizedView`.
- **Notes**: Minimal (`README.md` rule 3) — this is the first real subagent consumer, so the abstraction is now justified. No harness spawn plumbing beyond the grant + reduction; if the Phase 6/7 subagent/task tool is the caller, wire it to `deriveSubagentAttachment` and stop. Do NOT build a delegation-depth engine here beyond honoring the cap contract (`05`).
- **Tests**: `packages/boring-bash/src/server/__tests__/subagentAttachment.test.ts` (the E1 BBE1-005 test, now scheduled) — derive a scoped-view grant from a parent, prepare under a distinct child lifetime, assert authorized child operations read only within the subpath; foreign/parent request context rejects; no raw handle is returned or capturable and an expired callback lease rejects.
- **Acceptance**: E1 deferred acceptance — "subagent scoped-view attachment resolves and is isolated by `agentId`"; no cwd inheritance.

### BBP7-009 — Two surfaces × two agents no-collision integration test (Phase 7 exit) · size M
- **Title**: The Phase 7 exit criterion as an executable test.
  - **Files create**: `packages/agent/src/server/__tests__/multiAgentIsolation.integration.test.ts` (new) — one workspace declaring two agents (`coding` full bash, `reviewer` readonly/no-exec), driven through **two surfaces** (e.g. in-process transport + HTTP/fastify-inject). Assert distinct bindings, catalogs, transcripts, readiness; an approval on A is not answerable through B. Public calls use runtime-owned `sessionId`, while event/pending/receipt storage resolves the authenticated server-only `SessionKey`; include imported/restored same-string ids under different subject/agent scopes and prove no collision/access.
  - **Notes**: This is [`../../architecture/05-multi-agent-sessions-hooks.md`](../../architecture/05-multi-agent-sessions-hooks.md) "Isolation test" + [`../../INDEX.md`](../../INDEX.md) Phase 7 exit. UUID global uniqueness is a generation invariant, not an authorization/storage-key assumption. Reuse the T2 interleaved-transport harness.
- **Tests**: the file is the test.
- **Acceptance**: two agents/two surfaces never cross-contaminate bindings/
  catalog/transcript/readiness/approvals; APIs remain `sessionId`-shaped and all
  internal store/replay resolution remains separated by trusted structured key.

## Verification — exact commands verified against package.json scripts

```bash
# agent package (scripts confirmed in packages/agent/package.json)
pnpm --filter @hachej/boring-agent run test
pnpm --filter @hachej/boring-agent run typecheck
pnpm --filter @hachej/boring-agent run lint:invariants     # bash ../../scripts/check-invariants.sh .
pnpm --filter @hachej/boring-agent run check:isolation     # tsx ./scripts/check-agent-isolation.ts

# boring-bash (subagent grant lands here)
pnpm --filter @hachej/boring-bash run test
pnpm --filter @hachej/boring-bash run typecheck
pnpm --filter @hachej/boring-bash run check:invariants

# workspace (surface binding / P7AgentRegistry consumers)
pnpm --filter @hachej/boring-workspace run typecheck
pnpm --filter @hachej/boring-workspace run test

# repo-wide boundary + isolation guards (root package.json)
pnpm lint:invariants        # agent + boring-bash + workspace-plugin
pnpm audit:imports          # tsx scripts/audit-imports.ts (no agent→bash value import; no platform addressing in core)
pnpm typecheck              # build:packages then per-pkg typecheck

# Manual proof (workspace playground): declare two agents, drive two surfaces, confirm no collision.
#   Rebuild dist before driving the playground (see run-workspace-playground recipe).
```

## PR-PLAN reconciliation

Matches [`../../PR-PLAN.md`](../../PR-PLAN.md) P7 rows exactly:

- `pr1-agentid-scope-namespace` → BBP7-001.
- `pr2-agentid-addressing` → BBP7-002.
- `pr3-per-agent-catalog-readiness` → BBP7-003.
- `pr4-session-search` → BBP7-004.
- `pr5-agent-info-endpoint` → BBP7-005.
- `pr6-external-hook-target` → BBP7-006.
- `pr7-surface-agent-binding` → BBP7-007.
- `pr8-subagent-grant` → BBP7-008 (may combine with pr7 only if the PR-PLAN budget still holds).
- `pr9-two-surface-isolation` → BBP7-009.

## Review gates

- The single P7 host registry exists, contains stateless P6-R outputs, and no
  registry/pointer/generation state was added to P6-R.
- `agentId` in the `RuntimeScope.key` array for all agents; `sessionNamespace` carries `agentId` only for non-default agents; default-agent sessions load unchanged (on-disk JSONL compat).
- Per-agent tool catalog + readiness with zero cross-agent bleed (`05` Tests reproduced).
- Session search scoped by `workspace+agent`, no fs requirement, redaction enforced.
- External hook routes onto the single T1 approval channel; boring-bash-free; authenticates/validates/redacts/audits.
- `/api/v1/agents` and `/api/v1/agents/:agentId/info` are public, private-hook-free, and leak no secret/key material (assert in test).
- One addressing entry ↔ one `agentId`; T2 platform-addressing guard stays green (`agentId`/`sessionId`/`SessionCtx` only in core signatures).
- Subagent grant is minimal, explicit-attachment-only, `execPolicy:'none'`, isolated by `agentId`.
- Two-surfaces × two-agents namespace/scope no-collision test present and green; it does not require duplicate `sessionId` store keys.
- Any transitional code carries `TODO(remove:<bead-id>)` naming its deletion-owner bead; a later owner is allowed only when explicitly named per [`../../INDEX.md`](../../INDEX.md), and no marker outlives its named owner's phase.
