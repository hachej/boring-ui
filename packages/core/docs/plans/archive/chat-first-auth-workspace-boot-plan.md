# Unified Chat-First Auth + Workspace Boot Plan

**Status:** draft plan for review  
**Branch:** `main`  
**Scope:** child-app chat entry, auth return, default workspace selection, authenticated workspace identity gate, background workspace warmup, server-side agent runtime preparation, workbench readiness UI, and workspace/tool readiness errors  
**Supersedes:**

- `packages/core/docs/plans/chat-first-workspace-boot-plan.md`
- `packages/core/docs/plans/child-app-chat-entry-auth-plan.md`

**Related plan:** runtime/workspace provisioning remains owned by the agent provisioning plan:

```txt
/tmp/boring-ui-runtime-provisioning-simplified/packages/agent/docs/plans/runtime-provisioning-simplified.md
```

This plan must stay compatible with that provisioning plan. In particular, selected workspaces own generated runtime state under:

```txt
$WORKSPACE/.boring-agent/
```

and runtime setup is an idempotent reconciler whose fingerprints remain the correctness source. Runtime dependency reconciliation may continue in the background after chat/workspace capabilities are usable. This plan defines **when browser app flows may request/observe that server-side work without blocking shell/draft UX**; it does not redefine provisioning internals.

---

## 1. Goal

Create one consistent user journey from public chat-first entry through authenticated workspace readiness:

```txt
public product-shaped shell
  → user types locally
  → first Send opens signin overlay
  → auth may redirect/reload
  → same shell returns leanly
  → top bar Sign in becomes avatar menu
  → draft is restored and focused
  → default/target workspace resolves in background
  → workspace/workbench warmup runs in background; agent runtime prepares server-side when workspace identity is valid
  → user manually sends when ready
```

For already-authenticated initial load and workspace switch, apply the same smart-loading rule:

```txt
route or switch targets workspace B
  → block only until workspace B identity is valid
  → remount B shell with key={workspaceId}
  → show B chat shell immediately
  → warm sessions/tree/sandbox/workbench in background and prepare agent runtime server-side
  → keep unready workspace surfaces local to workbench
```

Why unify the plans:

- Chat-first auth and workspace boot are one visible flow.
- The post-auth moment is exactly where workspace loading begins.
- Split plans risk one implementation restoring draft while another blocks on workspace preload.
- A single state machine gives implementers one source of truth.

---

## 2. Fixed product decisions

These are the decisions currently agreed for v1.

### 2.1 Entry modes

Child app chooses one of two modes only:

```ts
type ChatEntryMode = "auth-first" | "chat-first"
```

```txt
auth-first
  → route/page signin before app
  → authenticated workspace/app shell
```

```txt
chat-first
  → public product-shaped shell
  → user types locally
  → first Send opens auth overlay
  → authenticated shell restores draft
```

No third mode in v1.

### 2.2 Auth timing

For `chat-first`, auth appears on **first Send**, not page load.

Reason:

- user can explore the product shape first
- no agent/model/tool/private-workspace cost before auth
- auth appears at commitment moment
- draft preservation is simple and reliable

### 2.3 Auth overlay default

The auth overlay defaults to **signin**.

Signup is available as a secondary tab/link inside the same overlay, but the initial mode is signin.

### 2.4 Pre-auth workbench scope

The pre-auth workbench empty state appears only inside app/workspace-shaped public routes, for example:

```txt
/app
/workspace/:id
/new
```

It should not be forced onto unrelated marketing pages such as:

```txt
/
/pricing
/docs
```

### 2.5 Pre-auth top bar

Before auth, the top bar shows no workspace dropdown/list/switcher.

Allowed:

```txt
branding / public nav / Sign in CTA
```

Not allowed:

```txt
workspace dropdown
workspace list
workspace switcher
workspace settings/members/invites
```

Reason: those imply private workspace state and would require workspace queries before auth.

### 2.6 Every authenticated user has a default workspace

New users do not land in an empty workspace-picker dead end.

After auth:

```txt
if user has no workspace
  → create/select default workspace record in background
  → keep draft
  → route/settle into default workspace when ready
```

If a saved target workspace is invalid or access is denied:

```txt
keep draft
route to user's default workspace
show small notice
```

### 2.7 No auto-send

A restored draft is focused and ready, but never auto-sent.

Reason:

- avoids surprising model/tool calls after auth redirects
- lets user review text after signup/verification
- keeps consent boundary clear

---

## 3. Non-goals for v1

Do not build these in this plan:

- public unauthenticated model endpoint
- guest workspace mode
- usage/token thresholds before auth
- custom auth trigger predicates
- anonymous persisted chat sessions
- anonymous workspace files/tree/search
- anonymous tools/sandbox/bash
- workspace dropdown before auth
- package-level marketing landing page
- replacing the runtime provisioning reconciler design

Future work may add a public no-tool demo chat, but it must be a separate product/security plan.

---

## 4. Readiness model

Keep the model simple. The UI only needs three gates.

### 4.1 Auth + draft gate

Before auth:

```txt
chat shell = local-only
draft = local/sessionStorage
real Send = blocked by signin overlay
```

After auth:

```txt
top bar Sign in → avatar
draft restored/focused
real Send may still wait on workspace/agent readiness
```

Auth/session status checks are allowed before auth. Agent/model/private-workspace/session-history calls are not.

### 4.2 Workspace identity gate

Workspace identity is the only global blocker after auth.

```txt
target workspace unknown/mismatched
  → do not show real workspace surfaces

target workspace valid
  → mount keyed workspace shell
  → show chat shell
  → start/observe background warmup
```

For normal authenticated route loads/switches, this gate may show a short identity transition page to avoid stale workspace UI.

For a `chat-first` auth return with a pending draft, prefer the lean shell: keep chat/draft visible, keep real workspace surfaces hidden, and show local `Preparing workspace…` status until the default/target workspace identity is valid.

### 4.3 Workbench / agent-ready gate

Workbench, sandbox, sessions, tools, and server-side agent runtime readiness may become ready after the shell.

Rules:

- do not replace the shell with a full-screen loader
- do not erase or auto-send the restored draft
- if real Send is not ready, keep the draft and show composer-local `Preparing chat…` / `Preparing agent…`
- show readiness only in composer/workbench/tool status
- do not show FileTree/editor/plugin panes until ready for the current workspace id

Runtime package status names and install/update policy are defined only by the runtime provisioning plan. For UI purposes, browser code only needs to know whether the agent runtime is `preparing`, `ready`, or `failed`.

---

## 5. End-to-end flows

### 5.1 `auth-first`

```txt
open app
  → route/page signin
  → signin/signup completes
  → default/target workspace resolves
  → authenticated shell mounts
  → chat visible after workspace identity is valid
  → workbench warms in background; agent runtime prepares server-side when needed
```

`auth-first` remains the conservative default for apps that do not want a public product shell.

### 5.2 `chat-first` pre-auth landing

```txt
open app/workspace-shaped route
  → render public shell
  → top bar shows Sign in, no workspace dropdown
  → chat area shows real empty state + composer
  → workbench area shows static public explainer
  → user types locally
```

No private workspace, agent, model, tool, or session-history calls happen in this state. Auth/session status checks are allowed.

If the public URL contains `/workspace/:id`, do not display workspace name, owner, members, repo, availability, not-found status, or any other existence-confirming metadata before auth. Treat the id only as intended return context.

### 5.3 First Send

```txt
user clicks Send
  → onBeforeSubmit runs before any agent/model/session-history network call
  → child app saves redirect-safe state
  → backend submission is cancelled
  → signin overlay opens, defaulting to signin mode
```

The draft stays visible/preserved. Empty-state suggestion clicks must go through the same interception path.

If the user clicks the top-bar Sign in CTA before sending, open the same signin-default overlay. Preserve any current local draft. After auth, restore it, but do not auto-send.

If the user closes the auth overlay, keep the local draft in the composer. A later Send reopens the signin overlay.

### 5.4 Signup inside signin overlay

Signup is not a separate app flow. It is a mode/tab/link inside the auth overlay.

Rules:

- default mode is signin
- signup option is visible
- switching signin/signup does not clear the draft
- failed auth does not clear the draft
- closing overlay does not clear the draft unless user explicitly discards it
- email verification keeps draft through return

### 5.5 OAuth/email verification redirect

Auth may redirect or reload.

Before auth, save one child-app-owned JSON blob. Keep v1 simple:

```ts
interface PendingChatEntryState {
  draft: string
  returnTo: string
  intendedWorkspaceId?: string
  publicContext?: {
    promptCategory?: string
  }
  createdAt: number
}
```

Suggested storage shape:

```ts
sessionStorage.setItem(
  "boring:pending-chat-entry",
  JSON.stringify({
    draft,
    returnTo: location.pathname + location.search,
    intendedWorkspaceId: workspaceId,
    publicContext,
    createdAt: Date.now(),
  }),
)
```

A nonce-scoped key carried through OAuth `state` is a good hardening improvement if the app already has that plumbing, but it is not required for v1.

Rules:

- save before opening auth overlay
- keep `publicContext` tiny and app-owned; v1 only needs public prompt/category state, if anything
- validate `returnTo` as same-origin/app-relative before using it
- validate `publicContext`; it must be small, JSON-serializable, and public only
- never store private workspace data
- survive OAuth redirect
- survive email verification redirect
- if verification completes on another browser/device and `sessionStorage` is missing, continue to the default workspace without draft restore; do not treat it as an error
- expire old drafts, e.g. after 24 hours
- do not store attachment data URLs in v1
- restore only after authenticated session exists
- clear when user sends or explicitly discards
- never auto-send

### 5.6 Lean post-auth return

```txt
auth callback / overlay success
  → return to saved returnTo route
  → same shell layout is reconstructed from persisted state and stays visually stable
  → top bar changes Sign in → avatar/account menu
  → draft is restored and composer focused
  → authenticated chat/session begins initializing
  → default/target workspace resolves in background
  → workbench warmup starts and agent runtime preparation is requested when workspace identity is valid
```

Do not:

- show full-screen app loader
- replace the whole shell with a boot page
- block draft restore on workspace list/detail/session/tree/sandbox/plugin/provisioning readiness
- show FileTree/editor/plugin panes before they are ready for the current workspace id

### 5.7 New user default workspace

```txt
new user completes auth
  → no workspace exists yet
  → create/select default workspace record in background
  → keep shell stable
  → restore draft immediately
  → once default workspace identity is valid, warm workbench in background and request agent runtime preparation
```

If the user clicks Send after auth before default workspace identity is ready, keep the draft in the composer and show a small local `Preparing workspace…` status. Do not queue or auto-send; the user clicks Send again when ready.

### 5.8 Authenticated initial workspace load

```txt
/workspace/:id
  → resolve route workspace entitlement/identity
  → if currentWorkspace missing or mismatched, show identity transition
  → once currentWorkspace.id === routeWorkspaceId, mount shell key={workspaceId}
  → render chat shell/draft immediately
  → initialize authenticated chat/session as its own readiness lane
  → start sessions/tree/sandbox/workbench warmup in background and request agent runtime preparation
```

The identity transition is allowed because it prevents stale workspace A UI under workspace B. It must not wait for tree/session/sandbox/provisioning warmup.

### 5.9 Authenticated workspace switch

```txt
user switches A → B
  → route/currentWorkspace updates
  → block while currentWorkspace is still A or unresolved
  → once B identity is valid, remount shell key={B.id}
  → show B chat shell immediately
  → B workbench warms in background and agent runtime prepares server-side
```

Never show A's FileTree, editors, panels, chat sessions, or plugin state under B.

---

## 6. Public shell UI contract

### 6.1 Layout

For app/workspace-shaped public routes:

```txt
public shell
  ├─ top bar: branding/public nav/Sign in
  ├─ chat: real empty state + composer
  └─ workbench: static public explainer
```

### 6.2 Workbench explainer copy

Option A:

```txt
Workspace
Files, previews, and artifacts will appear here once you start a chat.
Sign in to let the agent create and edit your workspace.
```

Option B:

```txt
Your workspace will appear here
After you send your first message and sign in, the agent can create files, open previews, and show artifacts in this area.
```

### 6.3 Pre-auth forbidden UI/data

Before auth, do not render or call:

- workspace dropdown/list/switcher
- `/api/v1/workspaces`
- `/api/v1/workspaces/:id`
- `/api/v1/agent/*`
- `/api/v1/tree`
- `/api/v1/ui/*`
- persisted sessions
- FileTree/editor/plugin panels backed by private data
- workspace bridge commands
- tools/sandbox/bash
- background workspace boot
- backend agent/model calls

Important current-code warning: `CoreFront` currently mounts workspace/auth providers as part of the normal authenticated app shell. The public `chat-first` shell must avoid any provider path that triggers private workspace list/detail queries before auth.

---

## 7. Authenticated shell and workbench readiness

After auth and workspace identity validation, chat can render while workbench surfaces warm. Workspace dropdown/list/switcher may appear only after authenticated workspace list/detail has loaded; the immediate lean chrome change is avatar/account menu only.

```txt
chat: usable / draft restored / session initializing locally if needed
workbench: local empty/loading/overlay state until ready
```

Workbench-local states:

- `Preparing files…`
- `Preparing sandbox…`
- `Restoring layout…`
- `Loading workspace tools…`
- `Unable to prepare workspace` with retry

Do not use:

- full-app loading banner
- top-bar warmup strip
- chat overlay blocking typing
- global skeleton that hides chat

Real FileTree/editor/plugin panes should appear only when their backing workspace state is ready for the current workspace id.

---

## 8. Runtime provisioning alignment

This section exists only to keep this plan synced with:

```txt
/tmp/boring-ui-runtime-provisioning-simplified/packages/agent/docs/plans/runtime-provisioning-simplified.md
```

### 8.1 Ownership boundary

Runtime provisioning plan owns:

- `.boring-agent` layout
- skill mirroring
- workspace file seeding
- node/python runtime package installs
- provisioning state/locks
- package install/update policy, fingerprints, and stable provisioning errors
- Vercel artifact behavior

This plan owns only the UI contract around it:

- when browser app flows may start/observe provisioning
- what the user sees while agent runtime is preparing
- which UI surfaces stay visible before provisioning is done

### 8.2 Browser app provisioning starts after identity is valid

For authenticated browser/core app flows, do not run runtime provisioning before auth and do not run it for a stale workspace id during switch.

Start or resume browser-app provisioning only after:

```txt
authenticated === true
AND currentWorkspace.id === targetWorkspaceId
AND provisionWorkspace !== false
```

When `provisionWorkspace === false`, background boot must not call agent-runtime warmup endpoints such as `/api/v1/agent/sessions` or `/api/v1/ready-status`.

CLI project/workspaces mode still provisions the selected workspace according to the runtime provisioning plan; it is outside this browser auth gate.

### 8.3 Capability-scoped UI mapping

Do not duplicate runtime provisioning internals here. The agent runtime now exposes readiness as three capability levels instead of one global blocker:

```txt
chat ready
  → composer/chat shell may proceed; first token is not blocked by pandas/bm installs

workspace/files ready
  → file tree/editor/workspace file tools may proceed after workspace root/template seeding is safe

runtimeDependencies preparing
  → show non-blocking “Runtime dependencies installing…” / “Macro runtime installing…” status
  → dependency-backed tools return retryable AGENT_RUNTIME_NOT_READY

runtimeDependencies ready
  → bm, macro SDK, pandas/requests/numpy, node/python package contributions may proceed

runtimeDependencies failed
  → keep draft/chat shell visible
  → show retry/actionable local error
  → dependency-backed tools return RUNTIME_PROVISIONING_FAILED
```

Required runtime setup may block dependency-backed tools. It must not block public shell continuity, draft restoration, the top-bar Sign in → avatar transition, normal chat, or already-ready workspace/file surfaces.

Do not convert every provisioning state to `WORKSPACE_NOT_READY`. Use `WORKSPACE_NOT_READY` only for workspace substrate readiness such as files, sandbox, or UI bridge. Runtime dependency readiness uses `AGENT_RUNTIME_NOT_READY` while preparing and `RUNTIME_PROVISIONING_FAILED` when provisioning fails.

---

## 9. Tool readiness and retryable errors

Workspace-dependent tools declare readiness requirements:

```ts
type ToolReadinessRequirement =
  | "workspace-fs"
  | "sandbox-exec"
  | "ui-bridge"

interface AgentToolDefinition {
  readinessRequirements?: ToolReadinessRequirement[]
}
```

If invoked too early, return stable retryable details:

```ts
{
  code: "WORKSPACE_NOT_READY",
  retryable: true,
  requirement: "workspace-fs",
  workspaceId,
  message: "Workspace files are still preparing. Try again shortly."
}
```

Requirements:

- use canonical error-code enum/import
- preserve structured details through `adaptToolForPi`
- preserve details through stream projection
- render friendly chat/tool status on frontend
- do not treat retryable readiness as fatal chat failure

Package-specific runtime errors belong to the runtime provisioning plan, not this chat-first boot plan.

---

## 10. Implementation shape

### 10.1 Child app config

Keep config intentionally small:

```ts
type ChatEntryConfig =
  | { mode: "auth-first" }
  | { mode: "chat-first" }
```

The child app owns:

- choosing auth-first vs chat-first
- public shell route composition
- auth overlay implementation
- signin default mode
- redirect-safe draft persistence
- post-auth return handling

Packages provide only hooks/primitives.

### 10.2 Minimal chat seam

Packages should expose one submit interception seam and one draft restoration seam.

Conceptual props:

```ts
initialDraft?: string
onBeforeSubmit?: (draft: string, ctx: ChatSubmitContext) => false | void | Promise<false | void>
```

Rules:

- `onBeforeSubmit` runs before any agent/model/session-history network call
- returning `false` cancels backend submission
- normal submit and empty-state suggestions must use the same path
- slash/skill send paths must also pass through normal submit handling
- draft restoration focuses composer but never auto-sends
- do not add trigger predicates, usage thresholds, or auth policy config to packages

### 10.3 Background workspace warmup coordinator

Use one minimal coordinator/effect after authenticated workspace identity is valid. Do not design a configurable preload framework for v1.

Conceptual API, only if a named helper is useful in code:

```ts
startWorkspaceWarmup({ workspace, signal })
```

Responsibilities:

- key work by `workspace.id`
- cancel/ignore stale work after workspace switch
- start or observe session/tree/sandbox preparation
- ask the server-side agent/workspace layer to prepare the selected workspace's agent runtime
- expose simple UI readiness: `preparing | ready | failed`

Non-responsibilities:

- no pre-auth execution
- no frontend package-manager/provisioning work
- no `.boring-agent` layout ownership
- no node/python install logic
- no plugin skill mirroring implementation
- no configurable preload matrix in v1
- no global top-bar loading UI

### 10.4 Route/current workspace identity gate

Keep the transition page only while identity is unsafe for normal authenticated route loads/switches:

```txt
routeWorkspaceId exists
currentWorkspace missing or currentWorkspace.id !== routeWorkspaceId
  → identity transition page

currentWorkspace.id === routeWorkspaceId
  → render keyed workspace shell immediately
  → start background warmup
```

For `chat-first` auth return with a pending draft, keep the lean shell and show workspace-resolution status locally instead of replacing the whole page.

### 10.5 Default workspace creation/selection

Core/cloud/app layer must ensure authenticated users have a default workspace record.

Suggested contract:

```ts
ensureDefaultWorkspaceForUser(user): Promise<WorkspaceSummary>
```

Rules:

- idempotent
- safe to call after auth return
- does not require rendering workspace dropdown first
- creates or selects the default workspace record for new users
- if target route workspace is invalid, route to default workspace with draft preserved

This default workspace creation is distinct from `.boring-agent` runtime provisioning inside the selected workspace.

---

## 11. Implementation phases

Keep implementation small. Do not create runtime-provisioning abstractions in this plan.

### Phase 1 — public shell + submit interception

- Keep this file as source of truth; old split docs remain superseded pointers.
- Build app-owned public shell without workspace providers.
- Pre-auth top bar has no workspace dropdown.
- Add/verify chat submit interception seam.
- Ensure empty-state suggestions use the same submit path.

### Phase 2 — redirect-safe auth return + default workspace

- Save draft/returnTo before auth.
- Auth overlay defaults to signin; signup path preserves draft.
- Restore/focus draft after auth or redirect; never auto-send.
- Ensure every authenticated user has a default workspace record.
- Swap Sign in CTA to avatar/account menu without full-page loader.

### Phase 3 — identity-gated chat-first workspace boot

- Render chat shell after target workspace identity is valid.
- For auth return with pending draft, keep lean shell while identity resolves.
- Move tree/session/sandbox preparation out of the blocking path.
- Key/cancel warmup by workspace id.
- Keep workbench readiness local.

### Phase 4 — tool/readiness polish

- Add readiness requirements metadata where needed.
- Return structured retryable `WORKSPACE_NOT_READY` for workspace substrate readiness.
- Preserve details through Pi adapter/stream/frontend.
- Render friendly local tool status.

Server-side runtime preparation is a dependency of Phase 3/4, but its internals remain in the runtime provisioning plan.

---

## 12. Testing plan

Keep v1 tests focused on the user-critical contract.

### 12.1 Pre-auth shell

- `chat-first` public shell makes no workspace/agent/private calls.
- Top bar shows Sign in and no workspace dropdown/list/switcher.
- `/workspace/:id` pre-auth does not reveal workspace metadata or existence.
- Workbench shows static public explainer only.

### 12.2 First Send + auth

- First Send opens signin overlay and does not call `/api/v1/agent/chat`.
- Draft is preserved if overlay closes and Send is clicked again.
- Empty-state suggestion click follows the same interception path.
- Signup path preserves draft.

### 12.3 Redirect + post-auth return

- OAuth/email redirect restores draft + returnTo when saved state exists.
- Missing/expired saved state falls back to authenticated default workspace without error.
- Restored draft is focused and not auto-sent.
- Top bar changes Sign in → avatar/account menu without full-screen loader.

### 12.4 Default workspace + background loading

- New authenticated user gets a default workspace record automatically.
- Invalid saved workspace routes to default workspace and keeps draft.
- Workspace list/detail/session/warmup does not block draft restoration.
- If agent runtime is preparing, composer/workbench shows local preparing state and keeps draft.

### 12.5 Workspace switch + tools

- Initial `/workspace/:id` renders chat shell after identity match before tree/sandbox warmup resolves.
- Workspace switch A → B never shows A files/panels/sessions under B.
- Warmup from A cannot update B after switch.
- Workspace tool before substrate readiness returns retryable structured `WORKSPACE_NOT_READY`.

---

## 13. Task mapping

Current tasks for this unified plan:

- `boring-ui-v2-reorg-31w6` — minimal authenticated workspace warmup coordinator
- `boring-ui-v2-reorg-iitg` — render workspace chat shell after identity match before preload
- `boring-ui-v2-reorg-ix20` — workbench-local warmup overlay
- `boring-ui-v2-reorg-7tvg` — readiness source + metadata
- `boring-ui-v2-reorg-uvjh` — structured `WORKSPACE_NOT_READY`
- `boring-ui-v2-reorg-8jx1` — friendly chat/tool rendering
- `boring-ui-v2-reorg-edcw` — default workspace record on chat-first auth return
- `boring-ui-v2-reorg-rc6o` — child-app chat entry/auth hooks
- `boring-ui-v2-reorg-bxzy` — regression + e2e coverage
- `boring-ui-v2-reorg-60da` — final docs

---

## 14. Definition of done

- One canonical plan governs chat-first auth and workspace boot.
- Old split docs point to this plan as superseded historical context.
- `auth-first` remains route/page auth before app.
- `chat-first` renders product-shaped public shell only on app/workspace-shaped routes.
- Pre-auth top bar has no workspace dropdown/list/switcher.
- Auth overlay opens on first Send and defaults to signin.
- Signup and verification preserve draft.
- No agent/model/private-workspace call happens before auth. Auth/session status checks are allowed.
- Pending draft + returnTo + public context survive OAuth/email verification redirects.
- Restored draft is focused but never auto-sent.
- Every authenticated user has a default workspace record automatically.
- Post-auth transition is lean: top bar avatar switch + draft restore, no full-app loading screen.
- Workspace list/detail warmup starts in background after auth; session/runtime warmup starts only when `provisionWorkspace !== false`.
- In browser app flows, server-side runtime preparation starts only after auth + valid workspace identity + `provisionWorkspace !== false`; CLI provisioning follows the runtime provisioning plan outside this auth gate.
- `.boring-agent` runtime provisioning remains owned by the runtime provisioning reconciler plan.
- Initial load and workspace switch block only on target workspace identity, not tree/session/sandbox/workbench warmup; real Send may still wait on server-side agent runtime readiness.
- Workbench readiness is local to workbench.
- Workspace-dependent tools return retryable structured readiness errors while requirements are unmet.
- Tests cover pre-auth, auth redirect, default workspace, post-auth background loading, runtime-preparing UI, initial workspace boot, workspace switch, and tool readiness.
