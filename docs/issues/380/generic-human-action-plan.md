# Generic Human Action / Ask-User v2 Plan

## Context

Issue #380 started with external harness review/question hooks and led to the Workspace Inbox work:

- Inbox should surface work that needs owner attention.
- Ask-user already lets a runtime block and ask a structured question.
- Visual review, PR review, approvals, and external harness reviews all have the same user-facing shape: **a human must inspect something and take an action**.

The current implementation has three nearby concepts:

1. `ask-user`: blocking structured questions/forms.
2. `WorkspaceAttentionBlocker`: in-memory UI/session badge/composer blocker primitive.
3. durable Workspace Inbox API: persisted question/review/approval/notice items.

The open design question is whether to add a separate `agent-attention`/`human-attention` plugin, or generalize `ask-user`.

## Recommendation

Generalize **ask-user** and the **Inbox plugin** into one broader **human action** product plugin, while keeping the existing `ask-user.v1.*` API as a compatibility facade.

Do **not** create a second unrelated `agent-attention` plugin yet.

Rationale:

- The user-facing concept is not “attention” as a passive notification. It is “I need a human decision/action before I can safely proceed.”
- Ask-user and Inbox share the same core goal: an agent/external harness needs human attention, usually with a confirmation, answer, review, or approval.
- `ask-user` already owns the hard runtime lifecycle: blocking waits, answer tokens, bridge ops, pending state, session scoping, cancellation, transcript, and UI integration.
- The Inbox plugin owns the right product surface: a durable, Gmail-like list of human-action items, filters, preview/detail panels, and quick inspect/reply entry points.
- Reviews/approvals are not fundamentally different from questions; they are different **response modes**.
- A separate `agent-attention` plugin would duplicate storage, bridge semantics, session badge logic, Inbox rows, resolution lifecycle, and front-shell integration.
- Workspace core should remain generic. The domain owner should be a first-party human-action plugin/package that subsumes ask-user and inbox domain logic.

## Naming

Use “human action” as the internal/domain concept.

Candidate public names:

- New canonical package/plugin: `@hachej/boring-human-action` or first-party workspace plugin `humanActionPlugin`.
- `@hachej/boring-ask-user` remains as a compatibility facade/re-export for question/form APIs.
- Current inbox plugin code migrates under the human-action plugin as the list/detail surface.
- Internal module/model names become `humanAction*`.

Avoid making “attention” the domain name. Attention is a UI delivery mechanism; action is the product contract.

## Product model

A human action is a pending item created by a runtime/server/external harness that asks a human to resolve it.

```ts
type HumanActionKind =
  | "question"   // provide input / answer form
  | "approval"   // approve/reject a proposed action
  | "review"     // inspect diff/artifact and accept/request changes/comment
  | "choice"     // pick one option
  | "ack"        // acknowledge notice/blocker
```

Every item should have at least one resolution path. If it does not need a resolution, it is an Inbox notification, not a human action.

```ts
type HumanActionScope =
  | { type: "session"; sessionId: string }
  | { type: "workspace" }
  | { type: "external"; sourceId: string }

type HumanActionPublicStatus = "ready" | "resolved" | "cancelled" | "abandoned"
type HumanActionInternalStatus = "reserved" | "creating" | HumanActionPublicStatus

type HumanActionView = {
  actionId: string
  workspaceId: string
  scope: HumanActionScope
  ownerPrincipalId: string
  status: HumanActionPublicStatus
  kind: HumanActionKind
  title: string
  body?: string
  context?: string
  priority?: number
  blocking: boolean
  createdAt: string
  updatedAt: string
  expiresAt?: string

  artifact?: {
    surfaceKind: string
    target?: string
    label?: string
  }

  response:
    | { mode: "form"; schema: AskUserFormSchema; submitLabel?: string }
    | { mode: "approval"; approveLabel?: string; rejectLabel?: string; requireCommentOnReject?: boolean }
    | { mode: "choice"; choices: Array<{ id: string; label: string; description?: string }> }
    | { mode: "review"; actions: Array<{ id: string; label: string; destructive?: boolean; comment?: "optional" | "required" }> }
    | { mode: "ack"; label?: string }

}

type HumanActionRecord = Omit<HumanActionView, "status"> & {
  status: HumanActionInternalStatus
  // Server-only mutation secret material. Never expose raw values through
  // Inbox projections, UI state, list APIs, logs, or transcripts.
  answerTokenHash: string
  answerTokenVersion: number
  reservationKey?: string
  reservationExpiresAt?: string
}

type HumanActionRequestContext = {
  workspaceId: string // trusted from bridge/route auth, never caller payload
  principalId: string
  capabilities: string[]
  sessionId?: string
  externalSourceId?: string
}
```

Rules:

- Every persisted/listable action belongs to exactly one `workspaceId`; handlers check workspace ownership before scope, token, or idempotency handling.
- Composer blocking only applies when `scope.type === "session" && blocking`.
- Workspace-scoped/external-scoped actions can appear in Inbox but cannot block a chat composer unless explicitly linked to a session-scoped action.
- Only `ready | resolved | cancelled | abandoned` are projectable/listable public statuses. `reserved`/`creating` are internal only and must not appear in Inbox/list/get/transcript projections.
- Multiple ready actions can exist for the same workspace/session.
- At most one blocking form-question action per session is allowed for `ask-user.v1` compatibility; other non-blocking review/approval actions can coexist.

Resolution input/output:

```ts
type HumanActionResolveInput = {
  actionId: string
  answerToken: string
  idempotencyKey: string
  result:
    | { mode: "form"; values: Record<string, AskUserAnswerValue> }
    | { mode: "approval"; decision: "approved" | "rejected"; comment?: string }
    | { mode: "choice"; choiceId: string; comment?: string }
    | { mode: "review"; actionId: string; comment?: string }
    | { mode: "ack" }
}

type HumanActionResolutionView = {
  actionId: string
  scope: HumanActionScope
  resolvedAt: string
  result: HumanActionResolveInput["result"]
}
```

Secret-bearing boundary:

- Browser list/get/Inbox/blocker metadata never includes raw token material.
- Browser resolver surfaces obtain a just-in-time, action-local `HumanActionResolveCapability` only through an authorized resolver-read/submit path. Prefer server-side exchange through a short-lived one-use capability endpoint. The capability contains the minimum secret needed to submit that one action and is never persisted to durable Inbox rows, UI state, transcripts, logs, generic list rows, global stores/providers, query caches, or generic surface registry props. It should be held only inside the resolver component/callback for the current action.
- `HumanActionResolveInput` is the only mutation input type that carries this raw resolve secret.
- Resolve/cancel never trusts caller-supplied scope. Flow is: load action by `(workspaceId, actionId)`, use stored scope/owner/source/status for auth, validate token hash against stored record, then apply an idempotent transition. Forged scope/session/workspace assertions must fail even with a valid token.
- Stolen resolve secret without matching principal/scope authorization cannot resolve.
- `ask-user.v1.pending` preserves legacy behavior by returning a question-compatible DTO with `answerToken` only for the authorized session resolver path; new generic list/get APIs do not expose it.
- Persisted records, bridge outputs, transcript events, UI state, and Inbox projections use `HumanActionResolutionView` or redacted event types and never include raw token material.

## Bridge API

Add a new operation family owned by ask-user/human-action:

```ts
human-action.v1.request
human-action.v1.listPending
human-action.v1.get
human-action.v1.resolve
human-action.v1.cancel
human-action.v1.transcript
```

Canonical reads are list-based. Singular reads exist only for compatibility projections.

State machine and blocking waiter contract:

States:

```txt
creating (not visible) -> ready (visible/resolvable) -> resolved | cancelled | abandoned
```

Only `HumanActionRuntime.requestAndWait`/`publish` may transition an action to visible `ready`; raw store reservation writes are persistence details and do not publish UI-answerable state by themselves. `requestAndWait` is the only ask-user compatibility path that creates a blocking visible action and waiter together. For blocking actions, the safe sequence is reservation -> waiter registration -> commitReady/publish -> await; abort/crash before commitReady leaves no listable/resolvable Inbox row and the reservation is released or expires deterministically.

Blocking waiter contract:

- `human-action.v1.request` is the runtime-facing blocking call: it atomically registers a waiter, creates/publishes the action, then resolves only when the action is resolved/cancelled/abandoned/timeout.
- Internal service split:
  - `HumanActionStore`: persistence/list/get/status transitions only.
  - `HumanActionRuntime`: waiter coordination, timeout/abort handling, and request-and-wait semantics.
- Optional non-blocking create can be added as `human-action.v1.create` later, but it is not the ask-user compatibility path.
- Atomic legacy blocking form invariant: at most one non-terminal blocking action may exist per `(workspaceId, sessionId, blockingGroup)`, including `creating` and `ready` states. `ask-user.v1.request` / form-mode blocking human-action requests acquire a reservation before publish. For the file store this must be a per-key mutex/lockfile plus persisted reservation, not best-effort list-then-write. Conflict returns a stable existing-pending/conflict result or deterministic queueing result; it must never create two visible legacy blocking questions for one session.
- Generic `human-action.v1.request` may allow multiple blocking actions per session only when the response mode declares a compatible multi-blocker policy; default policy is single active blocking action per `(workspaceId, sessionId, blockingGroup)`.
- Ordering invariant: register waiter before publishing/persisting UI-answerable state. If create/publish fails after waiter registration, unregister waiter. If abort/timeout wins before publish, no visible orphan action may remain. If browser resolves between publish and waiter suspension, the waiter must still wake deterministically.
- Recovery invariant: after process/browser reload, a `ready` action with no in-process waiter remains resolvable and its resolution is recorded for transcript/runtime polling; cleanup may mark it `abandoned` only after explicit timeout/TTL policy.

Compatibility aliases:

```ts
ask-user.v1.request     -> human-action.v1.request(kind="question", response.mode="form", blocking=true)
ask-user.v1.pending     -> human-action.v1.listPending + deterministic question projection
ask-user.v1.answer      -> human-action.v1.resolve(form result)
ask-user.v1.cancel      -> human-action.v1.cancel
ask-user.v1.transcript  -> human-action.v1.transcript filtered/projected to question events
```

Important compatibility rules:

- Old ask-user callers must not see review/approval items from `ask-user.v1.pending`; it returns only `kind="question" && response.mode="form"` items.
- If multiple compatible form questions exist for a session, `ask-user.v1.pending` returns the oldest blocking ready question, then oldest non-blocking ready question as fallback, and logs/telemeters multiplicity.
- `ask-user.v1.answer/cancel/transcript` preserve old wire shapes through projection.
- Old file-store records are detected by version/missing `kind` and lazily normalized to `kind="question"`, `response.mode="form"`, `scope={type:"session",sessionId}`.
- Cancellation mapping: old `aborted`, `timeout`, and `user_cancelled` map to `cancelled` with reason metadata; stale unanswered records map to `abandoned` only through explicit cleanup.

## Plugin/package shape

Target shape:

```txt
plugins/human-action/
  shared/       HumanAction types, bridge op constants, validation
  server/       store, bridge handlers, ask-user compatibility handlers
  front/        provider, Inbox overlay, detail panels, human-action surface
  ask-user/     compatibility exports/helpers for form-question callers
```

Short-term in this repo, this can be staged without a package rename:

- Keep `plugins/ask-user` as the package.
- Move/merge `packages/workspace/src/plugins/inboxPlugin/front/*` domain UI into ask-user/human-action front code.
- Keep only generic shell primitives in workspace:
  - app-left slot/open overlay plumbing;
  - detached popover/chat primitive;
  - generic attention provider;
  - generic surface registry.

This makes the first-party plugin own the complete human-action product surface: request lifecycle, Inbox list, detail panes, and resolution UI.

## UI behavior

### Inbox

The human-action plugin owns the Inbox overlay/list/detail UI. The provider emits explicit `WorkspaceAttentionBlocker.inbox` metadata for ready actions:

```ts
addBlocker({
  id: `human-action:${actionId}`,
  reason: `human-action.${kind}`,
  label: title,
  ...(scope.type === "session" ? { sessionId: scope.sessionId } : {}),
  surfaceKind: "human-action",
  target: actionId,
  sessionBadge: scope.type === "session" ? { kind, label: kind, tone: badgeTone, priority } : undefined,
  inbox: { kind: inboxKind, sourceLabel: kind, createdAt, updatedAt, priority },
  actions: quickActions,
})
```

Inbox should only display explicit `blocker.inbox` items plus durable inbox API items. It should not infer from all blockers.

### Composer blocking

If `scope.type === "session" && blocking: true`, the item blocks the owning session composer until resolved/cancelled/stopped.

If `blocking: false`, it appears in Inbox/session badges but does not block composer. Workspace/external-scoped actions appear in Inbox but not as composer blockers.

### Surface/detail panel

Add a generic `human-action` surface/panel that renders based on `response.mode`:

- form: current ask-user form UI.
- approval: approve/reject buttons, optional comment.
- choice: choice buttons/radio cards.
- review: artifact preview/action buttons/comment.
- ack: acknowledge button.

### Non-stealing default

Creation should not steal focus for background sessions.

- active/open session: may open the human-action panel.
- background/closed session: only badge + Inbox item.
- `openOnlyWhenSessionOpen` remains the routing rule.

## Server/storage

Refactor ask-user storage into a generic `HumanActionStore`:

```ts
interface HumanActionStore {
  // Store is workspace-owned: every method receives trusted context and cannot list/get across namespaces.
  reserveBlocking(ctx: HumanActionRequestContext, input): Promise<{ reservationId: string }>
  commitReady(ctx: HumanActionRequestContext, reservationId: string, input): Promise<HumanActionView>
  releaseReservation(ctx: HumanActionRequestContext, reservationId: string): Promise<void>
  listPending(ctx: HumanActionRequestContext, filters?: { scope?: HumanActionScope; kind?: HumanActionKind[]; status?: HumanActionPublicStatus[] }): Promise<HumanActionView[]>
  get(ctx: HumanActionRequestContext, actionId: string): Promise<HumanActionView | null>
  resolve(ctx: HumanActionRequestContext, input: HumanActionResolveInput): Promise<HumanActionResolutionView>
  cancel(ctx: HumanActionRequestContext, input): Promise<HumanActionView>
  transcript(ctx: HumanActionRequestContext, filters: { scope?: HumanActionScope; actionId?: string }): Promise<HumanActionTranscriptEvent[]>
}

interface HumanActionRuntime {
  requestAndWait(ctx: HumanActionRequestContext, input, options: { signal?: AbortSignal; timeoutMs?: number; idempotencyKey?: string }): Promise<HumanActionResolutionView>
  publish(ctx: HumanActionRequestContext, input): Promise<HumanActionView>
  resolve(ctx: HumanActionRequestContext, input: HumanActionResolveInput): Promise<HumanActionResolutionView>
  cancel(ctx: HumanActionRequestContext, input): Promise<HumanActionView>
}

`workspaceId`, principal, session authorization, and source authorization always come from `HumanActionRequestContext` derived from route/bridge auth context, never from caller-controlled payloads. Action ids are only looked up within `ctx.workspaceId`.
```

Existing file store can migrate in place:

- read old question records;
- normalize to `kind="question"`, `response.mode="form"`;
- write new records lazily or via one-time migration.

## Relationship to durable Workspace Inbox API

The durable Inbox API should be treated as a generic projection/read model, not as a competing source of truth.

Projection shape:

```ts
type InboxProjection = {
  id: string
  workspaceId: string
  sourceType: "human-action" | "external" | "notification"
  sourceId: string
  status: "open" | "resolved" | "archived"
  display: { kind: InboxItemKind; title: string; body?: string; sourceLabel?: string; priority?: number }
  scope?: HumanActionScope
  resolutionRef?: { type: "human-action"; actionId: string }
  createdAt: string
  updatedAt: string
}
```

`InboxProjection` must never include `answerToken` or other mutation secrets.

Short term:

- Human-action front provider emits attention blockers from plugin pending state.
- Human-action-owned Inbox UI displays those blockers.
- Durable inbox API remains for external harness-created projection rows and early persistence.

Medium term:

- Before generic Inbox UI migration, implement a single `HumanActionInboxReadModel`/merge adapter. The Inbox UI consumes only this adapter, never raw blockers plus durable rows independently.
- Human-action server creates/updates durable inbox rows for persistence across browser reloads and centralized listing.
- Human-action Inbox read model merges with deterministic identity and precedence:
  1. canonical identity is `(sourceType, sourceId)`;
  2. live attention blockers and durable projections with the same identity render as one row;
  3. HumanAction status is authoritative for `sourceType="human-action"`;
  4. resolved/cancelled/abandoned HumanActions update or suppress stale open durable projections;
  5. InboxProjection is read-model only and may not override HumanAction workflow status;
  6. on reload, durable rows render immediately, then hydrate/merge live HumanAction state when available;
  7. external projections not backed by HumanAction keep their own source status/handler and never masquerade as resolvable HumanActions.

Long term:

- Generic durable inbox item is the persisted projection/read model.
- Human-action remains the resolvable workflow source of truth for workflows it owns.
- External harness rows either create real HumanActions through authorized APIs, or remain external Inbox projections resolved by their own external handler.
- Pure notifications stay as `sourceType="notification"` projections and are not forced into HumanAction.
- The standalone `inboxPlugin` disappears or becomes an internal module of human-action.

## Security / auth

- Runtime/server may create actions only with appropriate bridge capability, e.g. `human-action:request`.
- Browser read/resolve authorization is scope-specific:
  - session-scoped: principal must be authorized for that session;
  - workspace-scoped: principal must be authorized for workspace-level human actions;
  - external-scoped: principal may read/resolve only if the external source grants or links a resolvable human-action capability.
- `answerToken` is necessary for resolution/cancel mutation but never sufficient by itself for browser calls; principal/scope authorization must also pass. Server/runtime calls use bridge capabilities plus scope/resource checks.
- Review/approval actions must be idempotent.
- External harness durable inbox creation should remain separately token-scoped; do not let arbitrary harness tokens resolve runtime-created human actions unless explicitly authorized.

## Migration plan

### Phase 0 — stabilize current PR stack

Already underway:

- Ask-user emits explicit Inbox metadata for questions.
- Inbox only admits explicit inbox blockers.
- Playground has E2E coverage for plugin-owned demo items.

### Phase 0.5 — workspace shell extension boundary

Before moving Inbox UI out of workspace internals, expose or verify stable shell APIs:

- plugin/app-left action registration;
- overlay host registration/open/close contract;
- panel/surface registration;
- detached panel primitive;
- attention provider APIs.

Workspace core must not import human-action domain types. Human-action registers UI through these contracts. Keep the current `inboxPlugin` in place until this boundary is stable.

### Phase 1 — model extraction inside ask-user/inbox

- Add `HumanAction` and `HumanActionResolution` shared types.
- Move current Inbox item model toward a projection of `HumanAction`.
- Implement conversion helpers:
  - `askUserRequestToHumanActionRequest`
  - `humanActionToAskUserQuestion`
  - `humanActionResolutionToAskUserAnswer`
  - `humanActionToInboxItem`
- Keep all existing ask-user and inbox tests green.

### Phase 2 — generic bridge ops

- Add `human-action.v1.*` operation definitions and handlers.
- Internally route ask-user v1 handlers through the human-action service.
- Add tests for:
  - form question compatibility;
  - approval request/resolve;
  - choice request/resolve;
  - list-based multiplicity;
  - deterministic `ask-user.v1.pending` projection;
  - idempotency conflict;
  - browser session scoping;
  - answer-token enforcement;
  - waiter wakeup and browser-answer-before-waiter race;
  - timeout/abort cleanup with no orphan visible action;
  - missing waiter abandonment/recovery;
  - concurrent legacy requests;
  - cancel/request and timeout/request races;
  - pending projection after multiplicity conflict;
  - crash/abort between reservation and publish leaves no listable/resolvable Inbox row and releases/expires reservation deterministically.

Resolution idempotency:

- repeated resolve with same idempotency key/body returns previous result;
- same key with different result returns stable conflict;
- resolving an already resolved action without matching idempotency returns stable already-resolved conflict;
- cancel/resolve races settle once and return stable conflict for loser.

Authorization:

- create requires `human-action:request`;
- list/get requires read capability scoped to workspace/session;
- resolve requires browser/server resolve capability plus token/session/resource authorization;
- cancel requires cancel capability and owner/server/runtime authorization depending on source;
- add tests for workspace-scoped read/resolve, denied cross-session access, denied unauthorized external resolve, token + principal mismatch, action-id collision across workspaces, and cross-workspace denial for list/get/resolve/cancel/transcript/projection merge.

### Phase 2.5 — HumanActionInboxReadModel

Hard prerequisite before moving/renaming Inbox UI:

- Inbox UI consumes exactly one read-model adapter.
- Adapter merges live blockers + durable projections by `(sourceType, sourceId)`.
- HumanAction status wins for human-action rows.
- No UI component may independently join raw blockers and durable inbox rows.
- Add tests for duplicate live+durable rows, stale durable-open after resolve, durable resolved while live blocker exists, and external projection not backed by HumanAction.

### Phase 3 — merge Inbox UI into generic front UI

- Rename internal runtime/store hooks from questions to human actions.
- Move Inbox overlay/detail/list code under the human-action/ask-user package or first-party plugin module.
- Moved Inbox UI consumes only `HumanActionInboxReadModel`; it must not read raw blockers and durable rows separately.
- Add generic panel renderer by `response.mode`.
- Keep `QuestionsPane` as a wrapper/projection for form-mode items.
- Keep `InboxOverlay` as the generic human-action Inbox, not a workspace-owned domain plugin.
- Add visual tests for each mode.

### Phase 4 — session/composer integration

- Human-action provider emits explicit `WorkspaceAttentionBlocker.inbox` for all ready actions.
- Blocking actions also become composer blockers.
- Non-blocking actions only show in Inbox/session badges.
- Add E2E:
  - runtime creates approval -> Inbox count increments -> approve resolves -> item disappears/marks resolved;
  - runtime creates review for background session -> no focus steal, session badge + Inbox row;
  - ask-user legacy request still appears as a question.

### Phase 5 — durable projection

- Persist human-action items to workspace inbox API or a dedicated human-action table with an inbox projection.
- Add collision/source rules.
- Merge live blockers with durable rows.

## Test plan

Unit:

- model validators for each response mode;
- ask-user v1 compatibility projection;
- answer-token and idempotency rules;
- inbox blocker projection requires explicit `inbox` metadata;
- redaction: list/get/transcript/inbox/read-model/blocker payloads never contain `answerToken`, `answerTokenHash`, `resolveCapability`, or token-equivalent material.
- forged scope: valid token plus wrong session/workspace/external scope must fail.

Integration:

- bridge request/list/get/resolve/cancel for each mode;
- browser auth session/workspace/external scoping;
- runtime token capabilities;
- durable/live merge: duplicate durable+live rows, resolve while durable row still open, stale blocker after durable resolved, external projection not backed by HumanAction.

Frontend:

- provider emits attention blockers for pending human actions;
- blocking vs non-blocking composer behavior;
- Inbox filter counts for question/review/approval/ack;
- panel rendering for each response mode.

E2E:

- playground/demo human action modes;
- actual runtime creates question/approval and browser resolves it;
- background session attention does not steal focus.

## Non-goals

- Do not make workspace core understand questions/reviews/approvals.
- Do not make Inbox scrape all attention blockers.
- Do not remove `ask-user.v1.*` until downstream callers are migrated.
- Do not force pure notifications into human-action; items without a human resolution belong to Inbox/notifications, not ask-user/human-action.

## Final decision

Generalize ask-user **and Inbox together** into a reusable human-action workflow engine and product surface, rather than adding a separate agent-attention plugin or keeping Inbox as a disconnected workspace domain.

The conceptual stack should become:

```txt
WorkspaceBridge          generic capability RPC
WorkspaceAttention       generic live UI/session/composer signal
Workspace shell          generic app-left overlay + detached panel primitives
Human Action             resolvable human workflow source of truth + Inbox UI
Ask-user v1              compatibility facade for form/question human actions
Durable Inbox API        persistence/projection layer for human-action/external items
```
