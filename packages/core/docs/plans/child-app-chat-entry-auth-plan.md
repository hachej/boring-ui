# Child-App Chat Entry / Auth Plan

> **Superseded:** implement from the unified canonical plan instead:  
> `packages/core/docs/plans/chat-first-auth-workspace-boot-plan.md`
>
> This file is retained for historical child-app auth/funnel detail only. The unified plan is the source of truth for consistent chat-first auth, redirect-safe draft restoration, lean post-auth transition, and smart workspace loading.

**Status:** superseded draft plan  
**Scope:** child-app-owned entry funnels and minimal package hooks for draft restoration / submit interception  
**Related plan:** `packages/core/docs/plans/chat-first-auth-workspace-boot-plan.md`  

---

## 1. Decision

Chat entry and auth presentation are **child app behavior**, not core/workspace/agent package policy.

Packages should expose small hooks/props that let an app implement the behavior, but packages must not force a landing funnel, overlay implementation, or auth timing.

The child app chooses exactly one of two entry modes:

```ts
type ChatEntryMode = "auth-first" | "chat-first"
```

```txt
auth-first
  → route/page login or signup first
  → authenticated app workspace
```

```txt
chat-first
  → public chat shell first
  → auth overlay opens by child-app trigger
  → authenticated app workspace with draft restored
```

No third mode in this plan. Overlay-vs-page is not another config axis:

- `auth-first` uses route/page auth before app.
- `chat-first` uses overlay auth over a public chat shell.

---

## 2. Goals

1. Let child apps use chat as the landing surface without granting anonymous workspace access.
2. Preserve a user draft across auth.
3. Keep default auth behavior unchanged.
4. Avoid mounting private workspace providers/data before auth.
5. Reuse the real chat empty state/composer visuals for public chat shell.
6. Keep package changes minimal: draft injection/restoration and submit interception hooks only.

---

## 3. Non-goals

- No guest workspace mode.
- No anonymous access to workspace files/tree/search.
- No anonymous sessions, sandbox, bash, tools, UI bridge, workspace settings, members, invites, private plugins, or private catalogs.
- No package-owned marketing landing page.
- No global weakening of `CoreFront` / `AuthGate`.
- No auto-send after login in v1. Restore the draft and let the user confirm.

---

## 4. Child-app config

Recommended app-owned config stays intentionally small:

```ts
type ChatEntryConfig =
  | { mode: "auth-first" }
  | { mode: "chat-first" }
```

Meaning:

```txt
auth-first
  → route/page login or signup first
  → authenticated app workspace
```

```txt
chat-first
  → public/local chat composer first
  → user types a draft locally
  → first submit opens auth overlay
  → signin or signup happens in that overlay
  → draft is restored after auth
  → user confirms send
```

No usage threshold, public model endpoint, or custom trigger in v1. Those can be future work after the basic flow is perfect.

---

## 5. `chat-first` UX

Unauthenticated user lands on app/workspace URL in a child app configured with `chatEntry.mode === "chat-first"`:

```txt
/open app or /workspace/:id
  → child app renders public workspace shell with the real chat empty state/composer
  → workbench area shows a public empty-state explainer, not real workspace data
  → user types a draft locally
  → user clicks Send
  → child app intercepts submit before any backend call
  → child app saves redirect-safe draft + returnTo + target workspace/app context
  → sign-in/sign-up overlay opens over the public chat shell
  → user signs in OR signs up
  → OAuth/email verification may redirect or reload the page
  → after authenticated session exists, app returns to saved returnTo route
  → shell stays visually stable; top bar changes Sign in → avatar/account menu
  → authenticated chat/runtime enables leanly behind the same shell
  → workspace list/detail/session boot starts in the background
  → restored draft appears in the real composer
  → inline notice says: Your message is ready. Review and send when you’re ready.
  → user clicks Send again
  → first real backend chat call happens
```

This makes chat feel like the landing page without allowing anonymous access to private workspace data or model budget.

### 5.1 Signup handling

Signup is not a separate flow. It is an auth overlay mode.

Overlay requirements:

- supports `signin` and `signup` modes/tabs
- child app chooses initial mode (`signup` is reasonable for public LP, `signin` for invite/returning-user contexts)
- switching between signin/signup does not clear the draft
- failed auth does not clear the draft
- closing overlay does not clear the draft unless user explicitly discards it

Successful signup:

```txt
signup succeeds and session is active
  → close overlay
  → keep the same shell visually stable
  → top bar changes Sign in → avatar/account menu
  → enable authenticated chat/runtime leanly
  → restore draft
  → user confirms send
```

Email verification required:

```txt
signup submitted
  → overlay shows Check your email / verification state
  → draft + returnTo + target workspace/app context remain in sessionStorage
  → user verifies email
  → app returns to saved returnTo route
  → shell renders lean authenticated chrome
  → top bar shows avatar/account menu
  → workspace list/detail/session boot starts in the background
  → draft is restored
  → user confirms send
```

Do **not** auto-send after signup or verification.

### 5.2 Redirect-safe state persistence

Auth may stay in-place, but OAuth and email verification can redirect or fully reload the app. Treat redirect survival as required, not optional.

Use local component state for smooth typing and `sessionStorage` for redirect/refresh survival.

Suggested child-app-owned keys:

```ts
sessionStorage.setItem("pendingChatDraft", draft)
sessionStorage.setItem("pendingChatReturnTo", location.pathname + location.search)
sessionStorage.setItem("pendingChatWorkspaceId", workspaceId ?? "")
sessionStorage.setItem("pendingChatAppContext", JSON.stringify(publicContext))
sessionStorage.setItem("pendingChatCreatedAt", String(Date.now()))
```

Where `publicContext` may contain only public/reconstructable UI state, for example selected public prompt category or intended route. It must not contain private workspace data.

Rules:

- save before opening auth overlay
- restore after authenticated session exists and route/context matches
- survive OAuth provider redirect
- survive email verification redirect
- expire old drafts, e.g. after 24 hours
- do not store attachments as raw data URLs in this draft flow in v1
- after draft is restored and user sends or discards, clear storage
- never auto-send restored draft

If the saved target workspace no longer exists or access is denied after auth, keep the draft and route the user to the default workspace picker/home with a small notice.

### 5.3 Lean post-auth transition

Auth success should not feel like a full app reload or heavy workspace mount.

The immediate post-auth transition should be tiny:

```txt
overlay closes
  → same chat/workspace-shaped shell remains
  → top bar changes Sign in → avatar/account menu
  → draft is restored in composer
  → workspace list/detail/session boot starts in background
  → user can manually send
  → workbench warms locally when ready
```

Rules:

- do not replace the whole screen with an app-level loading state
- do not block draft restoration on workspace list/detail/session/FileTree/editor/sandbox/plugin readiness
- start workspace list/detail/session/background boot after auth, but do not block the shell on it
- do not show real FileTree/editor/plugin panes until authenticated workspace providers are ready
- keep any loading or warmup state local to the workbench area
- top bar/account chrome may update immediately after auth
- chat backend/session becomes available after auth, but restored draft still does not auto-send

The user-visible change should be mostly: auth overlay disappears, and the top bar/account control switches from sign-in CTA to avatar menu.

### 5.4 Relationship to chat-first workspace boot

After auth completes and workspace identity is valid, use the normal authenticated boot behavior from the related plan:

```txt
auth complete
  → restore redirect-safe draft into lean authenticated shell
  → load workspace identity/list/detail/session in background
  → once target workspace identity is valid, keep chat mounted and warm workspace surfaces
  → workspace-dependent tools use WORKSPACE_NOT_READY if invoked too early
```

---

## 6. Security boundary

Before auth, the child app may show only public UI.

Allowed before auth:

- app branding
- public chat empty state/composer
- public static workbench empty-state explainer
- local composer draft
- sign-in/sign-up overlay
- public prompt examples supplied by the child app

Not allowed before auth:

- `/api/v1/workspaces`
- `/api/v1/workspaces/:id`
- `/api/v1/agent/*`
- `/api/v1/tree`
- `/api/v1/ui/*`
- workspace files/tree/search
- persisted sessions
- sandbox/bash/tool execution
- UI bridge commands for a real workspace
- workspace settings/members/invites
- private plugin/catalog data
- background workspace boot

So this is not “guest workspace mode.” It is public chat shell + local draft preservation. No backend chat/model call happens before auth in v1.

Important current-code warning: `CoreFront` currently mounts workspace/auth providers as part of the normal authenticated app shell. A `chat-first` public shell must avoid any provider path that triggers private workspace list/detail queries before auth.

---

## 7. Public chat shell display

The public chat shell should use the **same visual chat empty state and composer** as authenticated chat. Do not build a separate marketing-looking chat UI that drifts from the real product.

Same:

- empty state layout
- composer shape
- keyboard behavior
- responsive sizing
- prompt suggestions, if the child app makes them public

Different:

- submit while unauthenticated opens auth overlay instead of calling backend
- post-auth restored draft may show inline notice: `Your message is ready. Review and send when you’re ready.`

Minimal auth copy:

- submit button/tooltip: `Sign in to send`
- overlay title: `Sign in to start this chat`
- restored draft notice: `Your message is ready. Review and send when you’re ready.`

Rules:

- no fake workspace-ready status before auth
- no workspace warmup strip before auth
- no tool cards before auth
- no real file/workbench panels before auth; only the public static workbench empty-state explainer

---

## 8. Public pre-auth workspace empty state

For `chat-first`, the pre-auth page should feel like the product, but it must remain public and inert.

Layout:

```txt
public app/workspace shell
  ├─ chat area: real empty state + composer
  └─ workbench area: empty explainer panel
```

The workbench area should not be blank and should not look broken. It should show a simple centered message explaining what will appear after auth / after the agent starts working.

Example workbench copy:

```txt
Workspace
Files, previews, and artifacts will appear here once you start a chat.
Sign in to let the agent create and edit your workspace.
```

Alternative concise copy:

```txt
Your workspace will appear here
After you send your first message and sign in, the agent can create files, open previews, and show artifacts in this area.
```

Rules:

- render the workbench empty state as public static UI only
- no FileTree
- no editor panes
- no plugin panels backed by private data
- no workspace provider/data hooks that call private endpoints
- no background boot
- no fake loading/sandbox status
- no stale authenticated workspace data

Auth trigger:

- typing is local only
- first Send opens auth overlay
- overlay may blur/dim the public shell behind it, Perplexity-style
- draft remains visible/preserved behind or inside the overlay flow
- after signin/signup/OAuth redirect/email verification, the shell stays visually stable; top bar switches to avatar menu, workspaces load in the background, and the draft is restored

This is intentionally not a real workspace yet. It is a product-shaped preview of where workspace outputs will appear.

---

## 9. Package hooks needed

Packages should expose only minimal hooks/props.

Likely `ChatPanel` / chat hook props:

```ts
initialDraft?: string
onDraftRestored?: () => void
onBeforeSubmit?: (draft: string, ctx: ChatSubmitContext) => boolean | Promise<boolean>
```

Rules:

- `onBeforeSubmit` must run before any network call.
- Returning `false` cancels backend submission.
- Draft restoration must not auto-send.
- Interception must cover all user-send entry points:
  - normal composer submit
  - slash/skill sends inside submit handler
  - empty-state suggestion clicks
- First submit in chat-first opens auth overlay; it does not call the chat backend.

The child app owns:

- auth overlay UI
- draft persistence (`sessionStorage` or local state)
- return route
- signin/signup overlay
- OAuth/email verification redirect handoff if required
- redirect-safe draft/returnTo restoration
- lean post-auth transition where only account chrome changes immediately
- auth success handling

---

## 10. Testing plan

Required tests:

- default auth behavior unchanged
- public chat shell can intercept submit before backend call
- empty-state suggestion click is intercepted too
- no `/api/v1/workspaces`, `/api/v1/workspaces/:id`, `/api/v1/agent/*`, `/api/v1/tree`, `/api/v1/ui/*`, bridge, or tool call before auth
- after auth, draft is restored into authenticated chat but not auto-sent
- route/page auth remains the behavior for `auth-first`
- overlay auth is the behavior for `chat-first`
- signup mode preserves draft
- OAuth/email verification redirect path preserves draft until returnTo/auth completion

If using full-app e2e:

```txt
apps/full-app/e2e/chat-entry-auth.spec.ts
apps/full-app/e2e/playwright.config.ts
```

Remember full-app Playwright currently uses explicit `testMatch`, so the new spec must be added there.

---

## 11. Bead mapping

Existing bead moved to this plan:

```txt
boring-ui-v2-reorg-rc6o — Expose child-app chat entry hooks for auth-first and chat-first
```

That bead should carry the `child-app-chat-entry-auth` label and should not block authenticated chat-first workspace boot implementation.

Possible later beads if the first bead grows too large:

1. `chat-panel-draft-submit-hooks` — package hook surface only.
2. `full-app-chat-entry-example` — child app overlay/draft example.
3. `chat-entry-auth-e2e` — no-private-calls-before-auth Playwright coverage.
4. `chat-entry-auth-docs` — child-app integration docs.

---

## 12. Definition of done

- Child app can choose `auth-first` or `chat-first`.
- `auth-first` uses route/page login before app.
- `chat-first` uses public chat shell + auth overlay.
- `chat-first` opens auth overlay on first submit.
- Overlay supports signin and signup.
- No private workspace data/tools/preloads mount before auth.
- Public pre-auth workbench shows only static explanatory empty state.
- Draft is preserved through signin, signup, and email verification if required.
- Draft is restored after login/signup but not auto-sent.
- Package changes remain minimal and do not force child-app funnel policy.
