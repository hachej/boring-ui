# D-1719 Documents list goes stale

## Reproduction (reproduced)

`test/contracts/documents-render.impl.mjs`, "an edit made while the page is hidden shows in the list when the page is shown again". A fictional SQLite workspace whose `changes` feed can be dropped. Steps: Documents mounted and live; the page goes hidden and the browser closes the stream; a file (`late.md`) is written; the page is shown again. Before the change the list never showed `late.md` (`useWorkspaceVersion` read the feed once and, when it ended, never reconnected or refreshed). After the change the feed resumes with `since` on show, the resnapshot moves `seq`, the tree refreshes once, and no feed connection is opened while hidden.

## One feed

`useWorkspaceChangeFeed` (`packages/ui/src/workspace-change-feed.ts`, exported from `@hachej/boring-ui-kit/file-tree-view`), moved unchanged from `agent-workspace.tsx`. Used by `Documents` and `AgentWorkspace`. `Documents` exposes `data-live` on `[data-testid=documents]`.

## The three file-tree controller bindings (not merged)

| | documents.tsx `useFileTree` | agent-workspace.tsx | use-revision-attachments.ts |
|---|---|---|---|
| Provider wrapped | `withBlobPointers(provider, blobBase)` | `withBlobPointers(libraryProvider, blobBase)` | raw `revisionProvider` (no blob pointers) |
| Created when | always | only with a `libraryProvider` (revision or resources) | only when no `fileTree` is passed and there is a `revisionProvider` |
| Effect deps | provider, blobBase | libraryProvider, blobBase | fileTree, revisionProvider |
| First refresh | `refresh()` on create | `refresh()` on create | none (used for uploads only) |
| Refresh on change | in the hook: search again if a query, else every expanded directory plus the root, skipped at version 0 | in the component: `refresh()` of the root when seq or the deprecated `refreshKey` moves | none |
| Published as | `useState` tree | `useState` `{provider, tree}`, ignored when the provider differs | `useState` `{provider, tree}`, ignored when the provider differs |
| Dispose | cleanup | cleanup | cleanup |

Documents' state holds only the tree, so for one render after a provider switch it can expose the previous provider's tree; the other two guard on the provider. The refresh-on-change rules differ (Documents refreshes expanded folders and the search; the workspace refreshes the root). Merging them would change refresh timing, so they are left for a separate change.
