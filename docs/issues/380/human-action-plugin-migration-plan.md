# Issue 380 — Ask-User as Human Action Plugin Migration Plan

## Intent

Move the Inbox product surface and ask-user runtime lifecycle into one first-party plugin package, while expanding the domain beyond plain questions.

Canonical short-term package: `plugins/ask-user` / `@hachej/boring-ask-user`.

Canonical domain name inside the package: **human action**.

Public compatibility remains: existing `ask-user.v1.*`, `ask_user` tool, Questions panel, and `@hachej/boring-ask-user` imports keep working.

## Product design

Agents and external harnesses need more than form questions. The common shape is:

> create a human-resolvable item, show enough context/artifact, then unblock or record the result when the user acts.

Canonical shared model:

```ts
type HumanActionKind =
  | "question"  // structured form input
  | "approval"  // approve/reject a proposed operation
  | "review"    // inspect artifact/diff/html and choose a review action
  | "choice"    // choose one option
  | "ack"       // acknowledge a blocking notice

type HumanActionStatus = "creating" | "ready" | "resolved" | "cancelled" | "abandoned"

type HumanActionScope =
  | { type: "session"; sessionId: string }
  | { type: "workspace" }
  | { type: "external"; sourceId: string }

type HumanActionResponse =
  | { mode: "form"; schema: AskUserFormSchema; submitLabel?: string }
  | { mode: "approval"; approveLabel?: string; rejectLabel?: string; requireCommentOnReject?: boolean }
  | { mode: "choice"; choices: Array<{ id: string; label: string; description?: string }> }
  | { mode: "review"; actions: Array<{ id: string; label: string; tone?: "primary" | "neutral" | "danger"; comment?: "optional" | "required" }> }
  | { mode: "ack"; label?: string }

type HumanActionArtifact =
  | { type: "text"; title?: string; markdown: string }
  | { type: "html"; title?: string; artifactId: string; csp: "strict-static" }
  | { type: "surface"; surfaceKind: string; target?: string; params?: Record<string, unknown> }
  | { type: "panel"; panelComponentId: string; params?: Record<string, unknown> }
  | { type: "diff"; title?: string; patch: string }

type HumanActionResult =
  | { mode: "form"; values: Record<string, AskUserAnswerValue> }
  | { mode: "approval"; decision: "approved" | "rejected"; comment?: string }
  | { mode: "choice"; choiceId: string; comment?: string }
  | { mode: "review"; actionId: string; comment?: string }
  | { mode: "ack" }

type HumanActionRequest = {
  kind: HumanActionKind
  title: string
  body?: string
  scope: HumanActionScope
  blocking: boolean
  artifact?: HumanActionArtifact
  response: HumanActionResponse
}

type HumanActionView = HumanActionRequest & {
  actionId: string
  workspaceId: string
  ownerPrincipalId: string
  status: Exclude<HumanActionStatus, "creating">
  createdAt: string
  updatedAt: string
}

// Server-only type. Must live in server code, not shared/front exports.
type StoredHumanActionRecord = HumanActionRequest & {
  actionId: string
  workspaceId: string
  ownerPrincipalId: string
  status: HumanActionStatus
  createdAt: string
  updatedAt: string
  answerTokenHash: string
  answerTokenVersion: number
}

type HumanActionResolution = {
  actionId: string
  workspaceId: string
  resolvedAt: string
  result: HumanActionResult
}
```

Compatibility matrix:

| Kind | Allowed response modes |
| --- | --- |
| `question` | `form`, `choice` |
| `approval` | `approval` |
| `review` | `review`, later `approval` for simple reviews |
| `choice` | `choice` |
| `ack` | `ack` |

`question` is a projection of `StoredHumanActionRecord` through a redacted `HumanActionView`, not a parallel state model. Existing `AskUserQuestion` DTOs are compatibility projections of `kind="question" && response.mode="form"` records. Projections from `StoredHumanActionRecord` to `HumanActionView`, Inbox rows, blockers, transcripts, and UI state must drop `answerTokenHash`, `answerTokenVersion`, reservation fields, and all other server-only material.

### HTML artifact rule

HTML is useful for previews/reviews, but it must be treated as untrusted display content:

- render only through a dedicated `HtmlArtifactFrame` component;
- iframe must be sandboxed with no same-origin and no scripts by default (`sandbox=""` unless a future reviewed exception adds narrowly-scoped capabilities);
- use a default-deny CSP for `srcdoc`/blob content (`default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:` as the starting point);
- no ambient workspace origin access, cookies, localStorage, or parent DOM access;
- no raw HTML stored in `WorkspaceAttentionBlocker`, Inbox rows, generic UI state, logs, or transcripts;
- HTML artifacts are stored behind plugin-owned artifact ids before rendering (`artifactId`), not carried inline in list/detail projections;
- Slice 3 must not implement HTML rendering. HTML storage/rendering is its own later security slice with tests.

### “Validate button” design

A validate button is not a special case. It is a human action with either:

- `kind: "approval", response.mode: "approval", approveLabel: "Validate"`, or
- `kind: "review", response.mode: "review", actions: [{ id: "validate", label: "Validate", tone: "primary" }]`.

Use approval when the result is binary approve/reject. Use review when the user can choose among multiple outcomes like `validate`, `request_changes`, `comment_only`, `cancel`.

## Package ownership target

Move these from workspace into ask-user/human-action ownership:

```txt
packages/workspace/src/plugins/inboxPlugin/front/*
```

Target shape:

```txt
plugins/ask-user/src/
  shared/
    humanAction.ts              # public request/view/result/projection types only; no server-only token fields
    humanActionBridge.ts         # human-action.v1 op names + schemas later
    constants.ts                 # ask-user + human-action ids/surface kinds
  front/
    index.tsx                    # plugin registration: provider + panels + surfaces
    providerHooks.ts             # ask-user compatibility hooks
    humanAction/
      HumanActionProvider.tsx    # shared runtime context/projection bridge
      HumanActionSurface.tsx     # generic resolver/detail surface
    inbox/
      InboxOverlay.tsx
      InboxDetailPanel.tsx
      InboxFilterBar.tsx
      InboxRow.tsx
      InboxSection.tsx
      WorkspaceInboxShellContext.tsx
      attentionBlockerAdapter.ts
      inboxItemModel.ts
      definition.ts
  server/
    askUserBridgeHandlers.ts     # compatibility facade
    humanActionBridgeHandlers.ts # canonical ops later
    humanActionRuntime.ts        # request/wait coordination later
    humanActionStore.ts          # persistence later; owns StoredHumanActionRecord with token hashes
```

Workspace keeps only generic host plumbing:

- app-left button slot / primary action composition;
- overlay host slot;
- detached chat primitive;
- panel registry and UI command dispatch;
- generic `WorkspaceAttentionProvider` and `WorkspaceAttentionBlocker` projection seam.

Workspace must not own Inbox domain rows, filters, detail panels, or human-action response rendering.

## Migration slices

### Slice 1 — current completed direction

- Add HumanAction view/projection helpers in ask-user.
- Ask-user emits explicit `WorkspaceAttentionBlocker.inbox` metadata.
- Inbox adapter consumes explicit metadata without reason parsing.
- No bridge/store migration.

### Slice 2 — move Inbox front code into ask-user package

Goal: same UI behavior, different ownership, without making workspace import ask-user.

Hard boundary: **no imports of `@hachej/boring-ask-user` from `packages/workspace/src/**`**. `@hachej/boring-ask-user` depends on workspace, so workspace core/app code cannot depend back on ask-user.

Composition rule: ask-user registers Inbox panels/provider pieces as plugin contributions, or an app outside `packages/workspace` statically composes ask-user Inbox components into generic workspace slots. Workspace only exposes generic slots/registries.

Preflight before moving files:

- list every import in `packages/workspace/src/plugins/inboxPlugin/front/*`;
- ensure moved code imports only from `@hachej/boring-workspace`, `@hachej/boring-workspace/plugin`, and `@hachej/boring-ui-kit` plus local ask-user files;
- no `packages/workspace/src/front/...` deep imports from `plugins/ask-user/src/front/inbox`;
- any missing helper (`cn`, attention hooks/types, panel types, shell slot contracts) must be intentionally promoted to a public workspace export first;
- add or extend an import-boundary test/lint check covering `plugins/ask-user/src/front/inbox`.

Steps:

1. Promote missing generic workspace helpers/types to public plugin/root exports where justified.
2. Copy/move `packages/workspace/src/plugins/inboxPlugin/front/*` to `plugins/ask-user/src/front/inbox/*`.
3. Update imports inside moved files to public exports only.
4. Register Inbox panels through `askUserPlugin`.
5. Remove workspace app host's direct Inbox domain import path by converting it to a generic shell slot/overlay host that receives plugin-registered Inbox contributions. If that host refactor is too large, stop after moving model/adapter/panels and leave overlay-host migration as a separate slice.
6. Leave temporary compatibility re-exports in workspace only if needed for incremental stack safety, with a TODO to remove after downstream imports are updated. These re-exports must not import ask-user.
7. Move tests with the code and keep workspace-only tests for generic host plumbing.

Verification:

```bash
pnpm --filter @hachej/boring-ask-user exec vitest run src/front/inbox/__tests__/inboxItemModel.test.ts src/shared/__tests__/humanAction.test.ts src/front/__tests__/askUserPlugin.test.tsx
pnpm --filter @hachej/boring-workspace typecheck
pnpm --filter @hachej/boring-ask-user typecheck
```

### Slice 3A — shared model/result union + front projection

Goal: add the canonical shared HumanAction request/record/result types and project existing ask-user questions through them. No new UI modes yet.

### Slice 3B — non-HTML resolver modes

Goal: add `approval`, `choice`, and `ack` UI components and submit payload tests. No artifacts beyond text/body.

### Slice 3C — review mode with text/diff artifacts

Goal: add review action buttons and safe text/diff artifact renderers. No HTML.

### Slice 3D — HTML artifact storage/rendering

Goal: add plugin-owned HTML artifact storage by `artifactId` plus `HtmlArtifactFrame` sandbox rendering and security tests. This slice must define storage before implementation and must not pass raw HTML through list/blocker/transcript state.

### Slice 3E — surface/panel artifact delegation

Goal: wire `surface` and `panel` artifact targets through generic workspace shell APIs after the basic review flow is stable.

### Slice 3F — resolve validation semantics

Before bridge switching, add canonical validation helpers and tests proving:

- `result.mode` matches the record's `response.mode`;
- `kind` is compatible with the response mode;
- `choiceId` exists in configured choices;
- `review.actionId` exists in configured actions;
- required comments are present for rejected approvals and review actions that require comments;
- form values validate against the form schema;
- terminal actions resolve idempotently for the same idempotency key or return a stable conflict/error for conflicting retries.

### Slice 4A — bridge op names and schemas only

Add `human-action.v1.*` constants/schemas and tests. Do not route callers yet.

### Slice 4B — runtime/store canonicalization

Make persistence/runtime store HumanAction records internally while preserving current ask-user behavior. Add parity tests before switching bridge handlers.

### Slice 4C — legacy ask-user facade

Map existing `ask-user.v1.*` handlers onto canonical HumanAction operations:

```txt
ask-user.v1.request     -> human-action.v1.request(kind="question", response.mode="form", blocking=true)
ask-user.v1.pending     -> human-action.v1.listPending filtered/projected to questions
ask-user.v1.answer      -> human-action.v1.resolve(form result)
ask-user.v1.cancel      -> human-action.v1.cancel
```

### Slice 4D — transcript projection

Project canonical HumanAction events back to old ask-user transcript event shapes.

### Slice 4E — cancellation/abandonment semantics

Finalize cancellation reasons, timeout/TTL cleanup, idempotency behavior, and tests. Each switch requires parity tests proving existing `ask-user.v1.*` behavior before and after.

### Slice 5 — agent-facing tools

Keep `ask_user` as the simple tool for forms.

Add a generic tool only after the runtime bridge is ready:

```txt
human_action
```

Suggested tool modes:

- `ask_form` — structured form question;
- `request_approval` — validate/approve/reject;
- `request_review` — show artifact/diff/html and ask for a decision;
- `choose` — pick one option;
- `acknowledge` — blocking notice.

Do not expose raw HTML as a casual default. Require explicit `artifact.type="html"` and render sandboxed.

## API examples

### Validate generated HTML artifact

```ts
const artifactId = await humanActionArtifacts.storeHtml({
  title: "Landing page preview",
  html: renderedHtml,
  csp: "strict-static",
})

await humanAction.requestAndWait({
  kind: "review",
  title: "Validate generated landing page",
  scope: { type: "session", sessionId },
  blocking: true,
  artifact: { type: "html", title: "Landing page preview", artifactId, csp: "strict-static" },
  response: {
    mode: "review",
    actions: [
      { id: "validate", label: "Validate", tone: "primary" },
      { id: "request_changes", label: "Request changes", comment: "required" },
    ],
  },
})
```

If a future API accepts raw HTML in a create call, that input must be a server-only/create-only DTO. The server immediately stores it as a plugin-owned artifact id and only the id appears in records, projections, blockers, transcripts, and UI state.


### Validate a proposed shell command

```ts
await humanAction.requestAndWait({
  kind: "approval",
  title: "Validate migration command",
  body: "Run pnpm migration against workspace database?",
  scope: { type: "session", sessionId },
  blocking: true,
  response: { mode: "approval", approveLabel: "Validate", rejectLabel: "Cancel" },
})
```

Approval resolve payload:

```ts
{ mode: "approval", decision: "approved" }
{ mode: "approval", decision: "rejected", comment: "Do not run against prod." }
```

Review resolve payloads are data-driven by configured action ids, not hard-coded UI branches:

```ts
{ mode: "review", actionId: "validate" }
{ mode: "review", actionId: "request_changes", comment: "Fix the hero spacing." }
{ mode: "review", actionId: "comment_only", comment: "Looks good except the footer." }
```

## Hard constraints

- No secrets in `WorkspaceAttentionBlocker`, Inbox rows, browser list state, generic UI state, logs, or transcripts.
- Raw resolve capability is fetched just-in-time by the resolver component and held only locally.
- `packages/workspace/src/**` must not import `@hachej/boring-ask-user`. Composition of ask-user Inbox surfaces must happen through plugin registrations/generic slots or in an app package outside workspace.
- Do not introduce `node:*` or `Buffer` in shared code.
- Do not move all code in one PR. Keep slices small and reviewable.
- Do not remove compatibility exports until downstream imports are migrated and tests prove parity.

## Open design questions before bridge/runtime implementation

1. Package rename timing: keep `@hachej/boring-ask-user` indefinitely as canonical package with human-action internals, or introduce `@hachej/boring-human-action` and make ask-user a facade?
2. HTML artifact persistence implementation detail: plugin-owned blob store vs workspace artifact storage by id. Inline raw HTML in action records is not allowed.
3. External harness auth: which principal/source registry authorizes `external` scoped actions?
4. Multiple blockers per session: default single blocking action, with explicit multi-blocker policy for review/approval?

## Recommended next implementation

Implement **Slice 2 only** next: move Inbox front code into `plugins/ask-user/src/front/inbox` and update host imports. This aligns ownership without changing runtime semantics.

Do not implement Slice 3+ until Slice 2 is green and reviewed.
