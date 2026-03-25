# Improvement Roadmap

## Status

Draft execution plan based on the March 25, 2026 repo review.

This plan assumes the recent Neon auth fixes are already landed:

- truthful verification-email messaging
- explicit public-origin support for hosted auth callbacks

Those fixes reduced immediate auth correctness risk. The next work should focus on maintainability, deploy confidence, and restoring trustworthy quality gates.

Related beads:

- `bd-znpbo` Tooling: restore tracked lint/style gate and style-guideline enforcement
- `bd-om29` Frontend: break App.jsx workspace shell into focused state/hooks modules
- `bd-b2fof` Backend: decompose Neon/stream auth flows into smaller contract-tested units
- `bd-3bs4j` Smoke: cover `AUTH_EMAIL_PROVIDER=none` and `BORING_UI_PUBLIC_ORIGIN` auth flows
- `bd-rm17p` Backend: split stream bridge/runtime paths into focused modules
- `bd-il78w` Auth UI: move server-rendered auth page out of embedded Python string templates

---

## Executive Summary

The highest-leverage improvements are:

1. restore a reliable lint gate
2. add deploy-shaped smoke coverage for auth edge cases
3. split the frontend shell out of `App.jsx`
4. decompose the largest hosted auth/backend files into smaller units
5. move server-rendered auth UI out of embedded Python string templates

The order matters. A large refactor without working gates is sloppy, and auth/deploy issues should be protected by smoke coverage before deeper code motion starts.

---

## Goals

- reduce regression risk in hosted auth flows
- reduce maintenance cost of oversized frontend/backend files
- make deploy-time failures easier to catch before production
- improve code ownership boundaries without broad rewrites

## Non-Goals

- no rewrite of the full frontend shell in one pass
- no new auth provider or major auth architecture change
- no broad UI redesign
- no large platform migration unrelated to the identified hotspots

---

## Current Constraints

### Frontend

- `src/front/App.jsx` is still a large workspace shell with too many responsibilities
- auth behavior now depends on capabilities/config contract that should stay stable
- lint is not a trustworthy gate yet

### Backend

- `auth_router_neon.py` and stream-related backend paths still hold too much logic per file
- deploy behavior is shaped by real proxy/origin conditions, not just unit tests

### Tooling

- smoke coverage does not yet protect the new `AUTH_EMAIL_PROVIDER=none` and `BORING_UI_PUBLIC_ORIGIN` paths
- `npm run lint` is not reliable enough to be treated as a hard quality gate
- this checkout has no active `.git/hooks/pre-commit`; only tracked repo lint/style commands can be relied on consistently

---

## Execution Order

### Phase 0: Restore Reliable Quality Gates

Target:

- make `npm run lint` a meaningful pass/fail gate
- make the repo's tracked lint/style commands the authoritative style-guidelines gate

Tracked bead:

- `bd-znpbo`

Files likely involved:

- `src/front/styles.css`
- stylelint config files
- `src/front/components/chat/ClaudeStreamChat.jsx`
- `src/front/__tests__/components/toolRenderers.test.jsx`

Work:

- add a valid Stylelint config to the repo
- fix or intentionally suppress the current known frontend lint warnings
- document the current enforcement path: this checkout has no active pre-commit hook, only stock sample hooks
- confirm the intended style-guideline checks are represented in tracked repo config/scripts
- if any expected style-guideline checks exist only in developer-local setup, move them into tracked repo config/scripts so every contributor runs the same gate
- keep the scope narrow: do not refactor unrelated feature logic during lint cleanup

Done when:

- `npm run lint` passes without configuration failures
- the style-guideline checks are defined in tracked repo files rather than relying on one local hook copy

Why first:

- every later frontend refactor depends on having a trustworthy static gate

---

### Phase 1: Add Hosted-Auth Smoke Coverage

Target:

- protect the recently fixed hosted auth behaviors with smoke tests

Tracked bead:

- `bd-3bs4j`

Files likely involved:

- `tests/smoke/smoke_neon_auth.py`
- `tests/smoke/smoke_capabilities.py`
- `tests/smoke/smoke_lib/auth.py`
- `tests/smoke/smoke_lib/resend.py`

Work:

- add a smoke scenario for `AUTH_EMAIL_PROVIDER=none`
- assert the app does not falsely promise verification email delivery when disabled
- assert capabilities expose `auth.verificationEmailEnabled`
- add a smoke scenario for `BORING_UI_PUBLIC_ORIGIN`
- assert delivered verification callbacks point back to the configured public app origin

Done when:

- smoke tests fail on the old behavior and pass on the new one

Why now:

- this is the fastest way to stop deploy-specific auth regressions from returning

---

### Phase 2: Split the Frontend Workspace Shell

Target:

- reduce `src/front/App.jsx` to a composition layer

Tracked bead:

- `bd-om29`

Files likely involved:

- `src/front/App.jsx`
- new modules under `src/front/hooks/` or `src/front/app-shell/`

Recommended extraction sequence:

1. `useAuthBoot`
2. `useDataProviderScope`
3. `useWorkspaceRouting`
4. `useDockviewPersistence`
5. `useWorkspaceShell`

Suggested target shape:

```jsx
export default function App() {
  const auth = useAuthBoot()
  const workspace = useWorkspaceShell(auth)
  const layout = useDockviewPersistence(workspace)
  const dataProvider = useDataProviderScope(workspace)

  return (
    <AppFrame
      auth={auth}
      workspace={workspace}
      layout={layout}
      dataProvider={dataProvider}
    />
  )
}
```

Work rules:

- do not rewrite behavior while extracting ownership boundaries
- land this in small commits, not one broad refactor
- preserve the current auth/capabilities contract while moving code

Done when:

- `App.jsx` is materially smaller
- existing auth/workspace tests still pass
- extracted hooks have clear inputs/outputs

Why this is high leverage:

- this is the largest frontend maintainability hotspot in the repo

---

### Phase 3: Decompose Hosted Auth Backend

Target:

- turn the Neon auth backend into smaller contract-tested units

Tracked bead:

- `bd-b2fof`

Files likely involved:

- `src/back/boring_ui/api/modules/control_plane/auth_router_neon.py`
- new support modules under `src/back/boring_ui/api/modules/control_plane/`

Recommended split:

- `neon_client.py`
- `callback_urls.py`
- `signup_flow.py`
- `verification_flow.py`
- `password_reset_flow.py`
- `session_exchange.py`
- `responses.py`

Suggested interface direction:

```python
class NeonAuthClient:
    async def sign_up_email(self, *, email: str, password: str, name: str) -> dict: ...
    async def sign_in_email(self, *, email: str, password: str) -> dict: ...
    async def send_verification_email(self, *, email: str, origin: str, callback_url: str) -> dict: ...
```

Work rules:

- keep the router as a thin wiring layer
- move origin/callback logic into a dedicated helper module
- add tests around each extracted boundary instead of relying on one giant file

Done when:

- the auth router mainly composes smaller units
- callback/origin logic is independently testable
- signup, resend, reset, and callback-completion flows have crisp ownership

Why this matters:

- auth correctness changes are currently too expensive because too much context lives in one file

---

### Phase 4: Decompose Stream Runtime Paths

Target:

- split large stream/runtime files using the same approach as hosted auth

Tracked bead:

- `bd-rm17p`

Files likely involved:

- `src/back/boring_ui/api/stream_bridge.py`
- stream-related backend modules

Recommended split:

- transport/session lifecycle
- message normalization
- tool-event translation
- provider-facing bridge logic

Done when:

- stream runtime changes no longer require loading one large backend file into working memory

Why later:

- auth has more immediate correctness/deploy impact than stream cleanup

---

### Phase 5: Move Server-Rendered Auth UI Out of Python String Templates

Target:

- stop editing large HTML/JS string blobs inside Python

Tracked bead:

- `bd-il78w`

Files likely involved:

- `src/back/boring_ui/api/modules/control_plane/auth_router_neon.py`
- new template/static asset files

Work:

- move auth HTML/JS into a template or static asset
- keep Python responsible for routing plus runtime config injection only

Done when:

- auth UI changes no longer require editing long embedded string templates

Why last:

- first stabilize behavior and backend boundaries, then improve presentation packaging

---

## Success Criteria

The roadmap is succeeding if the repo reaches this state:

- `npm run lint` is a real gate
- hosted-auth smoke tests protect the new deploy-sensitive paths
- `src/front/App.jsx` is no longer the primary frontend complexity sink
- hosted auth and stream logic are broken into smaller contract-tested modules
- auth page delivery is easier to change without touching large Python string blobs

---

## Risks And Mitigations

### Risk: frontend refactor creates subtle boot regressions

Mitigation:

- extract one concern at a time
- keep tests green after each extraction
- avoid behavioral changes during mechanical moves

### Risk: backend auth decomposition expands scope

Mitigation:

- split by concrete flows, not abstract architecture
- keep the router surface unchanged while moving logic inward

### Risk: smoke coverage becomes too environment-specific

Mitigation:

- keep assertions focused on contract behavior
- avoid coupling tests to one deploy provider beyond what the app contract actually exposes

---

## Recommended First Move

If work starts immediately, the next best sequence is:

1. fix the lint gate
2. land `bd-3bs4j`
3. start `bd-om29`

That path improves correctness, safety, and maintainability in the right order.
