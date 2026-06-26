# 03a — Persistent Shell + No-Takeover Cross-Project Open

## Purpose

First persistent-shell implementation step: keep the multi-project nav and previously visible workspace content mounted while a target workspace route is loading.

This does **not** implement the full LRU mounted workspace cache yet. It creates the shell/router seam and proves no takeover.

Depends on:

- 01 — no-boot session list + lazy fetch;
- 02 — provider-scoped workspace store is preferred but not required if this step retains only one previous visible workspace and does not mount two active providers long-term. If implementation mounts two providers even briefly, 02 is required first.

## Review budget

Target non-test/non-doc added LOC: **< 2,000**.
Hard cap for PR review: **< 15,000** non-test/non-doc added LOC.

## Scope

- Add a persistent multi-project shell around routed workspace content.
- Separate route target from visible workspace content:
  - `routeWorkspaceId`
  - `openingWorkspaceId`
  - `visibleWorkspaceId`
  - `activeWorkspaceId`
- On cross-project open, keep current content/nav visible while target route is `loading` / `mismatched`.
- Show pending feedback in nav/content chrome only.
- Preserve single-project behavior exactly.

## Non-scope

- LRU cache of multiple recent workspace UIs (03b).
- Store isolation refactor (02), unless technically required by chosen shell seam.
- Inactive side-effect gating beyond the one retained previous visible workspace (05 series).
- Runtime preboot (04c).

## Implementation sketch

Current bad flow:

```tsx
if (routeStatus.status !== 'matched' || currentWorkspace?.id !== workspaceId) {
  return <>{resolvedLoadingFallback}</>
}
return <WorkspaceAgentFront key={workspaceId} ... />
```

Desired multi-project flow:

```tsx
if (isMultiProject) {
  return <MultiProjectWorkspaceShell routeWorkspaceId={workspaceId} routeStatus={routeStatus} />
}
```

The shell owns:

- project/session nav;
- current visible workspace entry;
- pending target metadata;
- content fallback/pending state.

When target route is pending and previous visible workspace exists:

- render previous content;
- keep nav visible;
- mark target row as opening;
- do not render page/content takeover spinner.

## Tests / acceptance

- Start at workspace A matched.
- Trigger cross-project open to B.
- Simulate route status `loading` / target not matched.
- Assert:
  - A content still rendered;
  - project nav still rendered;
  - target B row has pending/opening indication;
  - loading fallback does not replace content;
  - URL/navigation intent was issued.
- When B becomes matched, B content renders.
- Single-project route still shows existing loading fallback behavior.
- Forbidden/not-found/switch-failed during target open keeps nav mounted and presents a content-pane error policy rather than blanking unrelated previous content.

## Risks

- If shell state reads `useCurrentWorkspace()` as visible workspace, route target and visible content will drift incorrectly. Keep explicit identities.
- Avoid implementing a half-cache here. This PR is about the shell seam and no takeover only.
