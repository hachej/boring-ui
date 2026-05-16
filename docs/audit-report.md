# boring-ui-v2 Systematic Audit Report

**Date:** 2026-05-15
**Scope:** All packages (`agent`, `core`, `ui`, `workspace`, `cli`) + all apps
**Method:** Static analysis, import tracing, file scanning

---

## Executive Summary

The codebase is **remarkably clean** on architectural invariants and import boundaries. No `node:*` or `Buffer` leaks in shared code. No cross-package contamination (agent↔workspace, agent↔core, workspace↔core). All UI primitives are heavily used. All hooks are consumed.

**Key finding:** The codebase is architecturally clean. The only actionable item is a single abandoned test file. The routes and provisioner initially flagged as "dead" are actually live code — wired into `createCoreWorkspaceAgentServer.ts` and `createCoreApp`.

---

## P0: Critical (fix before next release)

### None

No critical issues found.

---

## P1: High (should fix soon)

### 1.1 ~~Unused Server Route Files~~ — Actually LIVE

**Files:**
- `packages/core/src/server/routes/workspaces.ts`
- `packages/core/src/server/routes/members.ts`
- `packages/core/src/server/routes/invites.ts`
- `packages/core/src/server/routes/settings.ts`

**Status:** NOT dead. These are wired into `createCoreWorkspaceAgentServer.ts` (line 471-474):
```ts
await app.register(registerWorkspaceRoutes)
await app.register(registerMemberRoutes)
await app.register(registerSettingsRoutes)
await app.register(registerInviteRoutes)
```

Also used by `apps/full-app` (in generated bundle). The provisioner IS used in workspaces.ts (create/destroy workspace dirs) and settings.ts (workspace directory management).

**Verdict:** P1 issue retracted. These are live, production routes.

### 1.2 ~~Unused Provisioner~~ — Actually LIVE

**File:** `packages/core/src/server/provisioner/fsProvisioner.ts`

**Status:** NOT dead. Used in:
- `createCoreApp.ts:184` — decorated on app instance: `app.decorate('provisioner', options?.provisioner ?? null)`
- `workspaces.ts:9,28,31,134,136` — `provisioner.provision()` on workspace create, `provisioner.destroy()` on workspace delete
- `settings.ts:63` — workspace directory management

**Verdict:** P1 issue retracted. Provisioner is live and functional.

### 1.3 `__tmp-skip.test.ts` — Abandoned Test File

**File:** `packages/agent/src/__tmp-skip.test.ts`

**Evidence:** File exists with a `beforeAll` hook that logs "ROOT BEFORE". No other code references it.

**Recommendation:** Delete this file — it's clearly abandoned work.

---

## P2: Medium (nice to fix)

### 2.1 Near-Empty Barrel Files

Several barrel/index files are intentionally minimal (just re-exporting one thing). This is fine but worth noting:

| File | Content |
|------|---------|
| `packages/workspace/src/front/theme/index.ts` | Re-exports `createShadcnTheme` from codemirror-theme |
| `packages/agent/src/shared/message.ts` | Re-exports `UIMessage, UIMessageChunk` from 'ai' |
| `packages/core/src/front/hooks/useTheme.ts` | Re-exports `useTheme` from ThemeProvider |
| `packages/core/src/app/front/index.ts` | Re-exports `CoreWorkspaceAgentFront` |

**Assessment:** These are fine — they're barrel exports that make the public API cleaner.

### 2.2 Storybook Stories Are Isolated

All 12 Storybook stories are wired into `.storybook/main.ts` but are NOT used in any actual app. They're development-only artifacts.

**Assessment:** This is intentional — Storybook is for component exploration, not app usage. No action needed.

### 2.3 Large Files (Potential Refactoring Targets)

| File | Lines | Concern |
|------|-------|---------|
| `packages/agent/src/front/ChatPanel.tsx` | 1227 | Single component doing too much |
| `packages/agent/src/front/primitives/prompt-input.tsx` | 1161 | Complex input with attachments, slash commands |
| `packages/core/src/server/db/stores/PostgresWorkspaceStore.ts` | 1089 | Large DB store |
| `packages/agent/src/server/harness/pi-coding-agent/createHarness.ts` | 846 | Complex harness factory |

**Assessment:** These are large but may be justified by their complexity. Consider breaking `ChatPanel.tsx` and `prompt-input.tsx` into smaller sub-components.

### 2.4 Console.warn in Production Code

Multiple `console.warn` calls in production code (not errors, just warnings):

| File | Count | Purpose |
|------|-------|---------|
| `packages/workspace/src/front/chrome/artifact-surface/SurfaceShell.tsx` | 6 | Debug warnings for surface resolution |
| `packages/workspace/src/front/bridge/uiCommandDispatcher.ts` | 3 | Warning for unknown commands |
| `packages/workspace/src/front/store/index.ts` | 2 | Warning for layout sync issues |
| `packages/workspace/src/front/plugin/CatalogRegistry.ts` | 1 | Warning for catalog errors |
| `packages/agent/src/server/logging.ts` | 2 | Logging infrastructure |
| `packages/core/src/server/config/loadConfig.ts` | 1 | Config warning |
| `packages/core/src/server/mail/transport.ts` | 2 | Mail logging |

**Assessment:** These are reasonable for a dev tool — they help surface issues during development. Consider gating some behind a debug flag.

---

## P3: Low (cosmetic / cleanup)

### 3.1 No `node:*` or `Buffer` Leaks in Shared Code

**Status:** ✅ CLEAN

- Only one `node:fs` import found in `packages/agent/src/shared/__tests__/error-codes.test.ts` — which is a test file, so it's fine.
- No `Buffer` usage in any `shared/` directory.

### 3.2 No Cross-Package Contamination

**Status:** ✅ CLEAN

- `packages/workspace/src/shared/` has ZERO imports from `@boring/agent`
- `packages/workspace/src/front/` has ZERO imports from `@boring/agent`
- `packages/agent/src/` has ZERO imports from `@boring/core`
- `packages/workspace/src/` has ZERO imports from `@boring/core`

### 3.3 All UI Primitives Are Heavily Used

**Status:** ✅ CLEAN

| Component | Callers |
|-----------|---------|
| Button | 182 |
| Badge | 142 |
| Input | 186 |
| Textarea | 18 |
| Separator | 90 |
| Tooltip | 21 |
| Dialog | 32 |
| DropdownMenu | 10 |
| Select | 249 |
| Command | 187 |
| Tabs | 66 |
| IconButton | 26 |
| Kbd | 12 |

### 3.4 All Core Hooks Are Used

**Status:** ✅ CLEAN

| Hook | Callers |
|------|---------|
| useReducedMotion | 5 |
| useBlobUrl | 4 |
| useCapabilities | 5 |
| useWorkspaceMembers | 5 |
| useKeyboardShortcuts | 13 |
| useViewportBreakpoint | 12 |

### 3.5 All Core Components Are Used

**Status:** ✅ CLEAN

| Component | Callers |
|-----------|---------|
| UserMenu | 11 |
| TopBarSlotProvider | 5 |
| ThemeToggle | 6 |
| WorkspaceSwitcher | 9 |
| AuthGate | 4 |
| AppErrorBoundary | 4 |

### 3.6 No Circular Dependencies Detected

**Status:** ✅ CLEAN

No A→B→A import cycles found in the analysis.

---

## P4: Observations (informational)

### 4.1 Eval Harness Is Used

The `@boring/agent/eval` package is actively used:
- `packages/agent/scripts/eval.ts` — CLI runner
- `packages/agent/scripts/eval-provisioning-agent.mts` — provisioning eval
- `apps/workspace-playground/src/eval/run.ts` — playground eval

This is good — the eval framework is not dead code.

### 4.2 DebugDrawer Is Used

`DebugDrawer` is exported and rendered in `ChatPanel.tsx`. It's a dev tool for debugging sessions.

### 4.3 Slash Commands Are Used

Slash command parsing, registry, and builtins are all consumed by `ChatPanel.tsx` and exported through the public API.

### 4.4 All Sandbox Modes Are Used

- `direct` — used in `runtime/modes/direct.ts`
- `local` (bwrap) — used in `runtime/modes/local.ts`
- `vercel-sandbox` — used in `runtime/modes/vercel-sandbox.ts` and tools

### 4.5 All DB Stores Are Used

- `LocalUserStore`, `LocalWorkspaceStore` — for local/dev mode
- `PostgresWorkspaceStore`, `PostgresUserStore` — for production

### 4.6 All Mail Templates Are Used

All 6 mail templates (VerifyEmail, ResetPassword, MagicLink, WorkspaceInvite, Welcome, Layout) are referenced in the auth flow.

---

## Summary Table

| Category | Status | Issues Found |
|----------|--------|-------------|
| Import boundaries (node:*, Buffer) | ✅ CLEAN | 0 |
| Cross-package contamination | ✅ CLEAN | 0 |
| Dead exports | ⚠️ MINOR | 4 unused route files |
| Dead files | ⚠️ MINOR | 1 abandoned test file |
| Unused hooks | ✅ CLEAN | 0 |
| Unused components | ✅ CLEAN | 0 |
| Unused UI primitives | ✅ CLEAN | 0 |
| Unused server routes | ✅ CLEAN | Wired into `createCoreWorkspaceAgentServer.ts` |
| Unused provisioner | ✅ CLEAN | Wired into `createCoreApp`, used in workspace/settings routes |
| Circular dependencies | ✅ CLEAN | 0 |
| Large files | ⚠️ 4 files | ChatPanel, prompt-input, PostgresWorkspaceStore, createHarness |
| Console.warn in prod | ℹ️ INFO | 17 calls (reasonable for dev tool) |

---

## Recommended Actions (Prioritized)

1. **[P1]** Delete `packages/agent/src/__tmp-skip.test.ts` — abandoned test file

*(P1 items 1-2 retracted: routes and provisioner are live code wired into `createCoreWorkspaceAgentServer` and `createCoreApp`)*
4. **[P2]** Consider breaking `ChatPanel.tsx` (1227 lines) into sub-components
5. **[P2]** Consider breaking `prompt-input.tsx` (1161 lines) into sub-components
6. **[P3]** Gate some `console.warn` calls behind a debug flag
