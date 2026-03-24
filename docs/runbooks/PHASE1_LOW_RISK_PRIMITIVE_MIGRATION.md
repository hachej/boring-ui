# Phase 1 Low-Risk Primitive Migration

This runbook tracks `bd-hlx1.2.2.6` (remaining shared primitive migration and low-risk ergonomics).

## Migrated In This Slice

- Shared tooltip primitives now back the host `Tooltip` wrapper:
  - `TooltipProvider`
  - `Tooltip`
  - `TooltipTrigger`
  - `TooltipContent`
- `UserMenu` avatar and separators now use shared primitives:
  - `Avatar`
  - `AvatarFallback`
  - `Separator`
- `SyncStatusFooter` menu separators and inline branch creation input now use shared primitives:
  - `Separator`
  - `Input`
- `AuthPage` sign-in/sign-up mode switch now uses shared tabs primitives:
  - `Tabs`
  - `TabsList`
  - `TabsTrigger`

## Intentionally Custom Low-Risk Surfaces (For Now)

- `SyncStatusFooter` menu and Git branch submenu remain custom.
  - Reason: nested flyout positioning, async branch loading, and inline branch creation are still behavior-coupled to this surface.
- `FileTree` and `TerminalPanel` still rely on the local `Tooltip` wrapper API.
  - Reason: this slice migrates tooltip internals first to reduce call-site risk; direct call-site primitive rewrites can be done later if needed.

## Migration Guardrail

- Prefer shared primitives for presentational and interaction patterns that have direct equivalents.
- Keep custom behavior where the surface is stateful/flow-heavy and a thin primitive swap risks regressions.
- Document every intentional exception before adding new ad hoc primitive patterns.
