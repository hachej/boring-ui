# Issue 380 — Inbox / Ask-User Human Action Refactor Slice

## Goal

Continue in `/home/ubuntu/projects/boring-ui-v2-inbox-poc` and make the next **small, reviewable refactor slice** toward merging:

- the Inbox surface,
- the ask-user question flow,
- and a generic human-action / human-input projection hook.

This slice should learn from the older `/home/ubuntu/projects/boring-ui-v2` `WorkspaceInbox.tsx` PoC, but should **not copy it wholesale**. The PoC proved that attention blockers can render as an Inbox. The current `boring-ui-v2-inbox-poc` worktree already has the better architecture: a dedicated `packages/workspace/src/plugins/inboxPlugin/front/*` Inbox model/shell plus ask-user-owned HumanAction projection helpers.

## Current state

### Main repo PoC (`/home/ubuntu/projects/boring-ui-v2`)

The old PoC added `packages/workspace/src/front/attention/WorkspaceInbox.tsx` directly under workspace attention. It is useful as product evidence only:

- Gmail-ish list/detail UI directly maps `WorkspaceAttentionBlocker` to rows.
- It opens details and emits blocker actions.
- It is not the right long-term home because it keeps Inbox domain UI in workspace attention/core-ish code.

### Current worktree (`/home/ubuntu/projects/boring-ui-v2-inbox-poc`)

The current worktree already has the better split:

- `packages/workspace/src/plugins/inboxPlugin/front/*` owns Inbox list/detail/shell UI.
- `WorkspaceAttentionBlocker.inbox` is the generic UI projection seam.
- `plugins/ask-user/src/shared/humanAction.ts` owns ask-user -> HumanAction/blocker projection helpers.
- `plugins/ask-user/src/front/providerHooks.ts` emits blockers through those helpers.

Existing issue: `attentionBlockerToInboxItem()` still has to infer source as a generic plugin from `reason`. Ask-user's projection can say `sourceLabel: "question"`, but cannot yet provide explicit plugin provenance such as `{ type: "plugin", id: ASK_USER_PLUGIN_ID, label: "question" }`. That leaves source identity partially encoded in strings.

## Decision

Do **not** move/copy the old `WorkspaceInbox.tsx` PoC into this worktree.

Instead, keep the current worktree's Inbox plugin and implement the smallest refactor that makes ask-user/human-action the owner of its Inbox row metadata:

1. Extend `WorkspaceAttentionInboxMetadata` with an optional **generic provenance** source descriptor.
2. Teach `attentionBlockerToInboxItem()` to use the explicit source descriptor instead of parsing `reason`.
3. Teach ask-user's HumanAction projection to emit plugin provenance `source: { type: "plugin", id: ASK_USER_PLUGIN_ID, label: "question" }` in its `inbox` metadata. Do not make `ask-user` a first-class workspace-attention source kind.
4. Add tests proving:
   - ask-user projected blockers produce generic plugin provenance metadata,
   - the Inbox adapter maps explicit source metadata to `WorkspaceInboxItem.source` without parsing `reason`,
   - generic/legacy fallback behavior still works,
   - no `answerToken` or secret-like fields appear in blocker/list projections,
   - existing ask-user behavior and current Inbox model tests still pass.

## Non-goals

This slice must not:

- migrate bridge ops to `human-action.v1`,
- rewrite ask-user storage or waiter semantics,
- move/delete `packages/workspace/src/plugins/inboxPlugin/front/*`,
- copy, move, or directly reuse the stale workspace-attention `WorkspaceInbox.tsx` PoC,
- add durable Inbox APIs,
- add server routes,
- expose raw answer tokens in UI state, list rows, blockers, logs, or generic projections.

## Proposed type shape

Keep workspace attention generic. Do not import Inbox-specific unions into `WorkspaceAttentionProvider`, and do not add ask-user-specific source kinds there.

```ts
export type WorkspaceAttentionInboxSourceMetadata =
  | { type: "plugin"; id: string; label: string }
  | { type: "external-hook"; id: string; label: string }
  | { type: "review"; id: string; label: string }
  | { type: "generic"; label: string; id?: string }

export type WorkspaceAttentionInboxMetadata = {
  kind: "question" | "review" | "approval" | "notice"
  sourceLabel: string // retained for compatibility/fallback
  source?: WorkspaceAttentionInboxSourceMetadata
  createdAt?: string | number | Date
  updatedAt?: string | number | Date
  priority?: number
}
```

Ask-user has a local `HumanActionInboxMetadata` type. Update it with a compatible local source descriptor so the ask-user projection remains self-contained and browser-safe.

Inbox adapter mapping lives in one helper inside `packages/workspace/src/plugins/inboxPlugin/front/attentionBlockerAdapter.ts`:

```ts
function blockerSource(blocker: WorkspaceAttentionBlocker): WorkspaceInboxItemSource {
  const source = blocker.inbox?.source
  const fallbackLabel = blocker.inbox?.sourceLabel ?? workspaceAttentionSessionBadgeForBlocker(blocker)?.label ?? "workspace"
  if (source?.type === "plugin") return { type: "plugin", pluginId: source.id, label: source.label || fallbackLabel }
  if (source?.type === "external-hook") return { type: "external-hook", externalId: source.id, label: source.label || fallbackLabel }
  if (source?.type === "review") return { type: "review", reviewId: source.id, label: source.label || fallbackLabel }
  return { type: "plugin", pluginId: source?.id ?? blocker.reason, label: source?.label || fallbackLabel }
}
```

Ask-user projection emits generic plugin provenance:

```ts
inbox: {
  kind: "question",
  sourceLabel: "question",
  source: { type: "plugin", id: ASK_USER_PLUGIN_ID, label: "question" },
  createdAt,
  updatedAt,
  priority,
}
```

If the Inbox UI later wants to style ask-user specially, that translation belongs in the Inbox adapter/UI layer, not in `WorkspaceAttentionBlocker.inbox`.

## Verification

Run from `/home/ubuntu/projects/boring-ui-v2-inbox-poc`:

```bash
pnpm --filter @hachej/boring-ask-user exec vitest run src/shared/__tests__/humanAction.test.ts src/front/__tests__/askUserPlugin.test.tsx
pnpm --filter @hachej/boring-workspace exec vitest run src/plugins/inboxPlugin/front/__tests__/inboxItemModel.test.ts
pnpm --filter @hachej/boring-ask-user typecheck
pnpm --filter @hachej/boring-workspace typecheck
```

If full workspace typecheck is blocked by unrelated existing stack drift, record the exact blocker and ensure targeted workspace Inbox tests pass.

## Expected result

After this slice:

- ask-user remains behavior-compatible,
- Inbox rows no longer need to infer ask-user plugin provenance from `reason`,
- HumanAction projection is the explicit source of generic Inbox provenance metadata,
- the old PoC remains product-reference-only; no component/module moves, no direct reuse of stale attention-layer Inbox UI code, and no Inbox UI reintroduced under `front/attention`,
- the codebase moves one step toward plugin-owned HumanAction without a broad migration.
