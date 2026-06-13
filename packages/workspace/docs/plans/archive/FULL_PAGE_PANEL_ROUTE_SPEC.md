# Dedicated Full-Page Pane Route Spec

Last updated: 2026-05-27

## Summary

Add one dedicated generic Workspace route for rendering an existing panel in a
new browser tab as a full-page surface.

This is intentionally the same simple mental model boring-macro used for decks
with `/present`, but generalized so any opted-in plugin panel can use it.

Primary use case now:

- `@hachej/boring-deck` should open the same deck panel in a new tab and let
that panel default into present/full-page behavior.

Secondary use cases this should unlock without feature-specific routes:

- HTML viewer open-in-new-tab
- report/artifact panels that benefit from more screen real estate
- future custom plugin panels that want a permalink/full-page view

The key design points are:

- one dedicated generic route
- reuse the same panel component
- avoid feature-specific page routes
- let the panel detect that it is being rendered full-page

## Problem

Today there is no generic Workspace concept of:

- “open this registered panel in another browser tab”
- “render this panel full-page outside Dockview”
- “let a panel know it is in full-page mode”

`boring-macro` previously solved this for decks with an app-owned route:

- `/present?path=...`

That worked because macro owned a dedicated app route and the deck feature was
special-cased. It is not a good generic answer for Workspace because:

- generic plugins should not hardcode app routes
- every new artifact type would otherwise add its own custom route
- the Workspace package does not own the host app’s router/pathnames

## Goals

- Reuse an existing registered panel component full-page in a new tab.
- Keep the capability generic across deck/html/report/custom artifact panels.
- Avoid feature-specific `/present`, `/html`, `/report`, etc. routes by
standardizing on one dedicated generic pane route.
- Let opted-in panels know they are being rendered full-page.
- Keep host apps in control of the actual route path they mount.
- Keep the v1 design small and reviewable.

## Non-goals

- Making every panel full-page capable by default.
- Replacing Dockview or normal pane rendering.
- Adding server persistence/permalinks/history in v1.
- Solving cross-session/shareable public URLs in v1.
- Requiring Workspace core/shared layers to depend on a specific router.
- Inventing a deck-only route once the generic path exists.

## Core decision

Use one dedicated generic full-page pane route.

Not:

- a deck-only route
- an HTML-only route
- a different route shape per artifact type

Yes:

- one Workspace-level full-page pane route
- panel id + params decide what renders there

This is deliberately the boring-macro `/present` idea transported upward into a
single reusable Workspace capability.

The generic capability should be split across two Workspace boundaries:

- **root package exports (`@hachej/boring-workspace`)** for plugin-safe front
helpers/hooks
- **app/front composition exports** for route/page helpers

Why this split:

- the Workspace package does not own the host router
- full-page rendering is app composition behavior
- plugin panels still need a safe place to read `dock` vs `full-page`
- base/shared code should stay router-agnostic

So Workspace should provide:

1. a **full-page panel page component** in `app/front`
2. a **root-exported href builder/hook** plus an `app/front` route parser
3. an **opt-in panel capability flag** on the normal panel contract
4. a **render-mode context/hook** on the root package export surface
5. a small **provider-level route-base config seam** so plugins do not hardcode
pp paths

The host app still mounts the dedicated route wherever it wants, e.g.:

- `/full-page`
- `/panel`
- `/artifact`

## Proposed API

## 1) Plugin-facing panel contract change

The opt-in belongs on the existing plugin-facing panel contract:

- `PanelConfig`
- `definePanel(...)`
- declarative `definePlugin({ panels: [...] })`
- imperative `setup(api => api.registerPanel(...))`
- `BoringFrontPanelRegistration`
- captured/registered front panel metadata

Proposed addition:

```ts
interface PanelConfig<T = unknown> {
  id: string
  title: string
  component: ComponentType<PaneProps<T>> | LazyFactory<PaneProps<T>>
  // ...existing fields...
  supportsFullPage?: boolean
}
```

And the mirrored front registration shape should carry the same field after
capture/bootstrap.

Rules:

- default `false`
- only `true` panels can be rendered by the dedicated generic full-page route
- if omitted, panel continues to work exactly as today

Opt-in usage:

```ts
const deckPanel = definePanel<{ path?: string }>({
  id: "deck",
  title: "Deck",
  component: DeckPane,
  placement: "center",
  supportsFullPage: true,
})
```

Equivalent declarative plugin example:

```ts
definePlugin({
  id: "deck-plugin",
  panels: [
    {
      id: "deck",
      label: "Deck",
      component: DeckPane,
      placement: "center",
      supportsFullPage: true,
    },
  ],
})
```

Equivalent imperative plugin example:

```ts
definePlugin({
  id: "deck-plugin",
  setup(api) {
    api.registerPanel({
      id: "deck",
      label: "Deck",
      component: DeckPane,
      placement: "center",
      supportsFullPage: true,
    })
  },
})
```

Runtime behavior:

1. route parses `component=<id>`
2. full-page renderer resolves that registered panel component from the registry
3. renderer checks `supportsFullPage`
4. `true` => render panel full-page
5. `false`/missing => show a not-supported error state

Why opt-in:

- many panels assume Dockview chrome/group/container behavior
- some panels are meaningless outside the workspace shell
- some panels may depend on `api`/`containerApi` methods that do not make
sense full-page
- plugin authors should opt in at the same place they already define panels,
not through an app-only API

## 2) Full-page route params

Keep params tiny and explicit.

```ts
interface FullPagePanelRouteState {
  componentId: string
  params?: Record<string, unknown>
}
```

URL shape in v1:

- `?component=<panel-component-id>&params=<urlencoded-json>`

Examples:

- `/full-page?component=deck&params=%7B%22path%22%3A%22deck%2Fintro.md%22%7D`
- `/full-page?component=html-viewer&params=%7B%22path%22%3A%22reports%2Fplan.html%22%7D`

The path `/full-page` is just an example. The important part is that there is
one dedicated generic route, not one route per feature.

Why JSON-in-query for v1:

- generic across panel types
- avoids route-per-feature explosion
- easy to build and parse
- does not require every panel to flatten params into query keys

Guardrails:

- reject invalid JSON
- reject non-object params
- parser does **not** validate panel existence/capability; that belongs in the
renderer where the registry is available
- show a simple full-page error state instead of crashing

## 3) URL helpers

Split the helpers by who needs them.

### Provider-level route-base config

Host apps configure the mounted route path once at the provider/app-shell level.

```ts
interface WorkspaceProviderProps {
  fullPageBasePath?: string // e.g. "/full-page"
}
```

This replaces feature-specific seams like deck's current `getPresentHref(path)`.
Plugins do not invent paths; the app declares one generic full-page route base.

### Root-package helpers

Expose both a pure builder and a context-backed hook from the root package
export surface (`@hachej/boring-workspace`).

```ts
interface BuildFullPagePanelHrefInput {
  componentId: string
  params?: Record<string, unknown>
  basePath: string
}

function buildFullPagePanelHref(input: BuildFullPagePanelHrefInput): string

function useFullPagePanelHref(input: {
  componentId: string
  params?: Record<string, unknown>
}): string | null
```

Behavior:

- `buildFullPagePanelHref(...)` is pure and explicit
- `useFullPagePanelHref(...)` reads `fullPageBasePath` from provider context
- if the host did not configure a full-page route, the hook returns `null`

### App/front helper

Route parser exported from `@hachej/boring-workspace/app/front` for host route
handling.

```ts
// Add one canonical app/front error-code module, e.g.
// packages/workspace/src/app/front/fullPageRouteErrors.ts
// exported from @hachej/boring-workspace/app/front as:
// - type WorkspaceFullPageRouteErrorCode = ...
// - FULL_PAGE_PANEL_MISSING_COMPONENT
// - FULL_PAGE_PANEL_INVALID_PARAMS_JSON
// - FULL_PAGE_PANEL_PARAMS_NOT_OBJECT
// - FULL_PAGE_PANEL_UNKNOWN_COMPONENT
// - FULL_PAGE_PANEL_NOT_SUPPORTED
// - FULL_PAGE_PANEL_RENDER_FAILED

function parseFullPagePanelLocation(search: string): {
  componentId: string | null
  params: Record<string, unknown>
  error?: {
    code: WorkspaceFullPageRouteErrorCode
    message: string
  }
}
```

Host app still decides the pathname. Workspace only standardizes the query
payload.

## 4) Full-page page component

Expose a route/page component from `@hachej/boring-workspace/app/front`.

This is an **app-shell-facing** API, distinct from the plugin-facing panel
contract above.

```ts
interface WorkspaceFullPagePanelProps {
  componentId: string
  params?: Record<string, unknown>
  notFoundFallback?: ReactNode
  invalidRequestFallback?: ReactNode
}

function WorkspaceFullPagePanel(props: WorkspaceFullPagePanelProps): JSX.Element
```

Responsibilities:

- consume existing `WorkspaceProvider` context already mounted by the host app
- resolve the registered panel from the panel registry
- verify `supportsFullPage === true`
- validate that `params` is URL-serializable object data already parsed from
the route
- preserve normal plugin safety expectations (lazy loading, suspense, and panel
error isolation equivalent to normal panel rendering)
- supply a full-page render-mode context
- render the panel outside Dockview with lightweight shims for `api` and
`containerApi`

Non-responsibilities:

- mounting `WorkspaceProvider`
- choosing the browser pathname
- owning a router implementation
- inventing feature-specific chrome

## 5) Render-mode context

Do **not** widen every panel prop shape just to add `fullPage: boolean`.

`PaneProps` is currently the Dockview-owned contract. Changing that ripples into
many existing panels and tests. The smaller approach is a context hook.

This hook belongs on the **root package export surface**, not in `app/front`,
because plugin panels themselves need to consume it.

```ts
type PanelRenderMode = "dock" | "full-page"

interface PanelRenderContextValue {
  mode: PanelRenderMode
}

function usePanelRenderMode(): PanelRenderMode
function useIsFullPagePanel(): boolean
```

Default outside the provider:

- `mode = "dock"`

Why context over prop in v1:

- no mass prop signature churn
- same panel component can opt in incrementally
- easy to use in deck/html without forcing all panels to care

## 6) Full-page panel shims

A full-page render will not have real Dockview APIs. Provide narrow no-op/
minimal adapters.

Because `PaneProps` currently exposes raw `DockviewPanelApi` / `DockviewApi`
types, this will likely require a typed shim object plus a narrow cast/proxy at
the render boundary. Call that out explicitly so the implementation stays honest
about the cost.

```ts
function createFullPagePanelApi(panelId: string): PaneProps["api"]
function createFullPageContainerApi(): PaneProps["containerApi"]
```

Required minimum:

- `api.id`
- `api.setTitle()` should update document title or local page chrome title
- `api.close()` can call `window.close()` best-effort, or no-op if blocked
- other methods should be safe no-ops unless a better behavior is obvious

Important constraint:

- panels that truly require rich Dockview behavior should not opt in to
`supportsFullPage`

## Deck behavior on top of this

Once the Workspace full-page capability exists, workspace-hosted deck panels
should use `useFullPagePanelHref(...)` against the host-configured generic
route.

Important scope note:

- this generic route primarily replaces the current workspace/plugin path
- standalone `DeckPane` / `StandaloneDeckRoute` consumers may still need an
explicit present-link seam temporarily until a separate standalone story is
finalized
- so v1 should remove `getPresentHref` from `CreateDeckPluginOptions` and stop
routing workspace-hosted deck links through that plugin option
- if standalone deck consumers still need a custom present link after that,
move the seam to standalone-only deck props instead of leaving it on the
workspace plugin builder

Deck panel behavior:

- dock mode:
  - normal read/edit/present toggle
- full-page mode:
  - default to present mode
  - keep keyboard slide navigation
  - keep the same parser/widgets/content logic
  - optionally reduce non-essential chrome

This preserves the user’s original macro UX goal while keeping the solution
fully generic.

## HTML viewer behavior on top of this

HTML viewer can opt into the same route later.

Expected behavior:

- same `HtmlViewerPane`
- same file/path params
- rendered full-page via the generic route
- no HTML-specific new-tab system needed

This is the main proof that the abstraction is not actually deck-specific.

## Route ownership model

Workspace should provide the page component and helpers, but the host app should
still mount the dedicated route.

Important constraint: `WorkspaceAgentFront` is the **full shell** today. It does
not accept arbitrary children and always renders the normal top bar + chat +
dock layout. So the full-page route cannot simply nest `WorkspaceFullPagePanel`
inside `WorkspaceAgentFront`.

For v1, keep this simple: mount the dedicated full-page pane route under the
already-public `WorkspaceProvider` directly.

Example host wiring:

```tsx
function App() {
  if (window.location.pathname === "/full-page") {
    const parsed = parseFullPagePanelLocation(window.location.search)
    if (!parsed.componentId) return <InvalidRequest />

    return (
      <WorkspaceProvider {...sharedWorkspaceProviderProps}>
        <WorkspaceFullPagePanel componentId={parsed.componentId} params={parsed.params} />
      </WorkspaceProvider>
    )
  }

  return <WorkspaceAgentFront {...sharedWorkspaceAgentFrontProps} />
}
```

This keeps routing decisions in the app, keeps the first version small, and
reuses the existing provider/registry bootstrap that already exists.

## Error handling

The full-page panel route must fail softly.

Cases:

- missing `component`
- malformed `params`
- unknown component id
- panel not opted into `supportsFullPage`
- panel render crash

Expected behavior:

- show a simple full-page `ErrorState`
- never crash the whole app shell
- route parser returns stable coded failure data instead of throwing raw JSON
parse errors into React

## Security / trust boundaries

This route should not expand trust boundaries beyond what normal Workspace panes
already have.

Notes:

- params come from the URL, so panel code must still validate/normalize them
- file-backed panes should continue using existing path validation/storage APIs
- this route should not add a new arbitrary code-loading mechanism
- only already-registered panels can render

## Implementation plan

### Phase 1 — Workspace route contract

- add `supportsFullPage?: boolean` to `PanelConfig` / `definePanel` / captured
panel registrations
- add `fullPageBasePath?: string` to `WorkspaceProviderProps` (and pass-through
from `WorkspaceAgentFront`)
- add root-exported href builder + `useFullPagePanelHref(...)`
- add `app/front/fullPageRouteErrors.ts` and export stable full-page route
  error codes
- add route parser in `app/front`
- add full-page render-mode context/hooks on the root package export surface
- add full-page panel component with panel lookup + shims + error states

### Phase 2 — Deck migration

- mark deck panel as `supportsFullPage: true`
- switch workspace-hosted deck panel links to `useFullPagePanelHref({ componentId, params })`
- remove `getPresentHref` from `CreateDeckPluginOptions`
- if needed, add a standalone-only present-link prop on `DeckPane` /
`StandaloneDeckRoute` instead of keeping that seam on the plugin builder
- deck uses render-mode hook to default to present mode when full-page

### Phase 3 — Playground proof

- mount one dedicated generic host route in `apps/workspace-playground`
- add “open in new tab” using that route
- verify real browser-tab behavior

### Phase 4 — Optional second consumer

- opt HTML viewer into `supportsFullPage`
- prove the abstraction is not deck-only

## Testing

### Unit

- URL builder/parser round-trips
- invalid query shapes fail cleanly
- panel opt-in enforcement
- full-page render-mode hook defaults/overrides
- `api.setTitle()` updates page title in full-page mode

### Integration

- `WorkspaceFullPagePanel` renders a registered opted-in test panel
- non-opted-in panel is rejected with a stable code
- unknown component is rejected with a stable code
- panel receives params intact
- render-mode hook reports `full-page`
- lazy panel rendering still works
- full-page panel crash is isolated to the page error state, not an app crash

### Deck-specific

- deck defaults to present mode in full-page render mode
- keyboard nav still works in full-page deck mode
- edit mode remains normal in dock mode

### Playground / e2e

- open deck in workspace
- click open-in-new-tab
- new tab opens generic full-page route
- same deck content renders there
- keyboard navigation works there
- original workspace tab remains stable

## Migration / compatibility

This should be additive.

- existing panels continue unchanged
- existing app routes continue unchanged
- macro can keep `/present` temporarily until migrated
- deck can support both old seam and generic route briefly if needed, but the
desired end state is to remove the deck-specific route seam once the generic
route is proven

## Locked decisions / follow-ups

1. Public export ownership
  - export `buildFullPagePanelHref`, `useFullPagePanelHref`,
   `usePanelRenderMode`, and `useIsFullPagePanel` from the root package
   (`@hachej/boring-workspace`)
  - keep the route parser/page in `@hachej/boring-workspace/app/front`
  - follow-up: update docs/examples to show the new imports clearly
2. Should params be JSON-in-query or flat query keys?
  - Recommendation: JSON-in-query in v1 for simplicity and genericity.
  - Constraint: full-page-capable panels must treat params as URL-serializable
  data, not callbacks/classes/functions.
3. Should deck keep a custom label like “Present” in full-page mode?
  - Recommendation: yes in its own panel UI, but the route stays generic.
4. Do we need shareable/stable URLs across sessions right now?
  - Recommendation: no. Keep this local/full-page only in v1.

## Recommendation

Build the generic Workspace full-page panel route.

It is small, matches the desired UX, avoids deck-specific routing, and creates a
reusable capability for deck, HTML viewer, and future artifact panes without
pushing router ownership into the base Workspace package.