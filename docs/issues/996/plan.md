# Issue #996: preserve multi-filesystem file-tree root

## Problem

`FileTreePane` reconciles its local root selection from the default `filesystem` prop whenever the configured `roots` array changes identity. Hosts commonly rebuild an equivalent roots array during file-open rerenders, so a still-valid user selection such as `company_context` is replaced by the default `user` root. Reveal/open synchronization also needs the optional filesystem identity to select the intended root rather than treating a path as globally unique.

## Plan

1. Reconcile root changes with the current selection first, falling back to the configured default and then the first available root only when the current root was removed.
   - Verify with focused component tests for an equivalent roots-array rerender and deterministic selected-root removal fallback.
2. Add optional filesystem identity to file-tree reveal requests and use explicit reveal/open events to select a matching configured root.
   - Requests without filesystem identity target the primary `user` filesystem.
   - Verify explicit company/user synchronization and ensure requests are only delivered to the matching active tree.
3. Carry optional filesystem through the existing `expandToFile` command/bridge/surface path and ensure successful surface file opens emit the existing identity-bearing `file:opened` event.
   - Verify bridge/dispatcher forwarding and surface event behavior with targeted unit tests.
4. Run the focused workspace tests and package typecheck. Add browser coverage only if the playground can enable its multi-filesystem fixture without changing unrelated test-suite behavior.

## Proof status

- Focused FileTreePane, SurfaceShell, mock bridge, bridge/dispatcher/link/client, and agent UI-tool tests pass (246 tests).
- Workspace and workspace-playground typechecks pass after building playground dependencies.
- A dedicated Playwright test uses distinct Workspace and Company fixture roots, verifies filesystem-qualified file reads plus visible editor content/tabs, and checks the selector after each open.
- Reveal requests are one-shot at both the SurfaceShell and FileTreePane boundaries. FileTreePane owns bridge-to-prop conversion for nested trees, while standalone FileTreeView keeps direct bridge expansion support; authoritative prop + event pairs are deduplicated.

## Scope and rollback

This change is limited to file-tree selection and the existing optional filesystem field on open/reveal synchronization. It does not depend on or include #995. Rollback is a direct revert of the issue commit; no persistence or migration changes are involved.
