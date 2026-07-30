# Plan: one identity store for chat surfaces (issue #978)

## Problem

A chat surface's session identity is stored **twice, in two formats**:

| Surface | Store | Key |
| --- | --- | --- |
| docked / split panes | `chatPaneState.ids` (`WorkspaceAgentFront`) | `workspaceSessionKey(id, agentTypeId)` — addressed |
| detached ("Quick chat") | `FloatingChatSession { viewKey, sessionId }` (`useWorkspaceShellCapabilitiesController.ts:12`) | bare `sessionId`, key **reconstructed** later |

The reconstruction step is where bugs come from. It produced the Quick chat
failure fixed in #968 (`4eaca5e35`): the host rebuilt a *legacy* key in an
addressed host, matched nothing in `resolvedSessions`, so `sessionEphemeral`
stayed false, the panel treated its `local-*` placeholder as a real remote
session, and polled `/sessions/local-<uuid>/state` in a 404 loop forever.

The popover is **not a distinct surface**: it renders the same chat panel via the
same `makeCenterParams` factory (`WorkspaceShellCapabilitiesHost.tsx:91` vs
`WorkspaceAgentFront.tsx:1862`). Only its container and focus behaviour differ.
Yet because it owns a parallel store it also needs a **duplicate native-adoption
effect** (`WorkspaceShellCapabilitiesHost.tsx:53-60`) mirroring what panes get
from `replaceSessionId`.

Two stores for one fact means every identity change must be applied twice; each
miss is silent. #968 fixed four dropped-owner sites in one pass, and a
thermo-nuclear review predicted the recurrence before the popover site was found.

## Approach

Model placement as an attribute of a chat surface rather than a separate
subsystem:

```ts
{ sessionKey, placement: 'docked' | 'split' | 'floating' }
```

One store. Floating surfaces then inherit `replaceSessionId`, `forgetSession`,
adoption handling and key derivation with no per-surface duplication.

## Constraints (must hold)

1. **Floating surfaces stay out of active-pane bookkeeping.** Quick chat must not
   steal `activeId` — see the `rawSwitch(previousActiveId)` guard in
   `createChatSessionInPopover` (`WorkspaceAgentFront.tsx:2026`). This is an
   exclusion from active/pinned/stage logic, not merely a flag on a pane.
2. **Public contract unchanged.** `openDetachedChat(sessionId: string, options?)`
   (`shared/plugins/workspaceShellCapabilities.ts:24`) stays bare-id; the owner is
   resolved internally, as #968 already does via `resolveSessionKey`.
3. **Placement-conditional params preserved**: `bridgeEnabled: false` for
   floating, plus `composingEnabled` and `initialDraft`.
4. **Adoption still survives** an id change mid-flight (native first send in a
   popover). Today two mechanisms cover this — the handoff lookup ahead of the
   key fallback, and the floating store's own rewrite effect. After
   consolidation, exactly one must remain and be proven.
5. `viewKey` currently forces a React remount of the popover; whatever replaces it
   must preserve that behaviour or justify the change.

## Changes

1. Extend the pane store with `placement`, defaulting existing entries to
   `docked`/`split` as today.
2. Represent the detached chat as a `floating` entry in that store; delete
   `FloatingChatSession` and its `setFloatingChatSession` plumbing.
3. Delete the duplicate adoption effect (`WorkspaceShellCapabilitiesHost.tsx:53-60`)
   once floating inherits `replaceSessionId`.
4. Exclude `floating` entries from active-pane / pinned / stage-dock selection.
5. Extract `materializeCreatedSession(created) -> { id, agentTypeId, key }` and use
   it in all three creation paths (`createChatSession` ~:1560, split-pane ~:1604,
   `createChatSessionInPopover` ~:2013), which currently re-derive the owner
   independently — paths 1 and 2 are near-identical copies.

## Tests

- Existing: `packages/workspace/src/app/front/__tests__/WorkspaceAgentFront.test.tsx`,
  `useWorkspaceShellCapabilitiesController.test.tsx`, `ChatPaneStageDock.test.tsx`.
- Add: opening a detached chat does **not** change `activeId` (constraint 1).
- Add: a detached chat survives native adoption — its surface follows the new
  session id with exactly one identity update (constraint 4).
- Add: `materializeCreatedSession` returns an addressed key in an addressed host
  and a legacy key when the host has no `agentTypeId`.

## Verification

- `apps/workspace-playground/repro-popover.mjs` — reproduces the original failure
  headlessly in ~30s; must stay green (1 session created, native-prompt posted,
  no `local-*` 404 loop).
- `packages/workspace`: `src/app/front`, `src/front/layout` suites.
- `npx tsc --noEmit -p tsconfig.front.json`.

## Out of scope

- The dual prompt path (#979).
- Cross-process channel convergence (noted in #979).

## Rollback

Behavioural surface is the workspace front only; revertable as one commit.
