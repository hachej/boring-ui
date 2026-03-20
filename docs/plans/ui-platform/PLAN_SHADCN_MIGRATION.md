# PLAN_SHADCN_MIGRATION.md

## Status

Revised execution plan for migrating boring-ui's generic primitive surface to shadcn/ui,
publishing that surface as real workspace packages `@boring/ui` and `@boring/sdk`, and
replacing the Vite-only workspace panel loader with a production-safe backend-bundled
runtime panel pipeline.

This document intentionally merges the strongest parts of earlier drafts:

- the migration-first concreteness, file-by-file mapping, and visual QA discipline
- the architecture-first contract work, package/import strategy, runtime status model,
  and rollout safety work
- additional fixes for real-world issues those drafts only partially covered, especially:
  - Tailwind v4 browser-support and migration-risk gating
  - runtime-panel utility-class generation
  - visible compile/runtime error handling
- security/trust-boundary clarity
- phased rollout with a temporary fallback path
- CI guardrails to prevent legacy generic classes from creeping back in

Execution strategy:

- Track A: create real workspace package boundaries first, then migrate the host app onto them
- Track B: runtime panel pipeline and `@boring/sdk`

Tracks are independently releasable, keep separate feature flags, and may soak on different
timelines.

---

## Why This Work Exists

boring-ui currently has two related problems:

1. A large generic-UI surface lives in hand-written CSS and raw HTML elements rather than
   reusable React primitives.
2. Runtime workspace panels currently depend on a dev-oriented loading path that assumes the
   frontend build tool can see workspace source files directly.

That combination makes the codebase harder to maintain for humans and much harder for agents
to extend reliably. Agents are already fluent in shadcn/ui's component vocabulary. If the
host app and runtime panels share that vocabulary, agent-authored panels become much more
predictable, child apps gain a stable SDK, and the host app loses a large amount of duplicated
generic CSS and repeated primitive implementations.

---

## Goals

1. Replace the generic primitive layer (buttons, menus, dialogs, inputs, badges, tabs,
   avatars, tooltips, alerts, simple cards, separators) with shadcn/ui-backed primitives.
2. Keep boring-ui's design tokens as the visual source of truth. This is a migration, not a redesign.
3. Expose the shared primitive surface as a real workspace package `@boring/ui` with its own
   source tree, build pipeline, explicit stylesheet contract, and semver policy for the host app,
   child apps, and runtime panels.
4. Expose the runtime authoring contract as a companion workspace package `@boring/sdk` whose
   public API is versioned independently from host-private frontend code.
5. Replace the current Vite-only runtime panel loading path with a backend-bundled ESM pipeline
   that works the same way in development and production.
6. Ensure runtime panel failures are isolated, visible, and diagnosable instead of becoming
   silent broken imports or blank tabs.
7. Preserve accessibility, keyboard navigation, theming, and existing user flows.
8. Remove dead generic CSS only after the new primitives are proven by visual and functional QA.
9. Publish a public theme/CSS contract so child apps do not depend on host-private token files or
   source-scanning setup just to render shared primitives correctly.
10. Define and enforce performance budgets for package size, CSS size, panel cold-build time, warm
    rebuild time, and first-activation latency.

---

## Target End State

By the end of this project:

- common primitives come from `@boring/ui`
- the host app uses those primitives instead of ad hoc class bundles
- boring-ui tokens still define color, typography, radii, spacing semantics, and dark mode
- the token + semantic-theme bridge is imported from public `@boring/ui` CSS entrypoints, not only
  from `src/front` private styles
- child apps can import `@boring/ui` directly
- child apps and the host app import `@boring/ui` and `@boring/sdk` through the same public
  package boundaries
- runtime workspace panels can import:
  - `react`
  - `react/jsx-runtime`
  - `@boring/ui`
  - `@boring/sdk`
- the backend discovers, validates, bundles, caches, and serves runtime panels as ESM
- the frontend hot-loads those ESM bundles into DockView
- compile failures surface as explicit panel errors
- runtime render failures are caught by per-panel error boundaries
- the old `@workspace` alias path can be removed after the new path soaks safely

---

## Non-Goals

- Re-skin DockView tab chrome or other domain-specific layout surfaces.
- Replace xterm, TipTap, diff-viewer, or chat transcript rendering with shadcn primitives.
- Allow arbitrary npm imports in runtime panels in v1.
- Treat runtime panels as a hardened sandbox. They are an extensibility mechanism, not a
  security boundary.
- Introduce arbitrary CSS theming for runtime panels in v1.
- Collapse all CSS into Tailwind utilities. Domain-specific CSS remains where it is the best tool.

---

## Decisions To Lock Before Code Churn

### 1. Visual system: boring-ui tokens remain the source of truth

Adopt shadcn/ui as the component vocabulary, not as a new visual brand. The host app keeps
existing CSS tokens and maps shadcn semantic variables to those tokens.

### 1A. Public theme and CSS contract

`@boring/ui` must ship public CSS entrypoints:

- `@boring/ui/tokens.css` for boring design tokens
- `@boring/ui/theme.css` for the shadcn semantic-variable bridge
- `@boring/ui/styles.css` for compiled primitive styles
- `@boring/ui/runtime-panel.css` for `.bui-runtime-panel-root` defaults and the runtime utility subset

Default consumer rule:

- child apps import the public CSS entrypoints and do not need to scan `@boring/ui` source files
- advanced consumers may optionally opt into `@source`-based package scanning, but that is not the
  default requirement

### 2. Canonical package/import strategy

Use real workspace packages:

- `@boring/ui`
- `@boring/sdk`

Keep the current import story only as a temporary compatibility alias during migration so existing
consumers do not break all at once.

Practical rule:

- new code uses `@boring/ui`
- existing imports remain supported for at least one release cycle or one full internal soak
- runtime panels document only `@boring/ui` and `@boring/sdk`, never internal source paths

### 3. Runtime import contract for v1

Version 1 of runtime panels supports only:

- `react`
- `react/jsx-runtime`
- `@boring/ui`
- `@boring/sdk`

Additionally:

- relative local ESM code imports (`./**/*.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`) are allowed as long
  as the resolved path stays inside the panel directory
- local `./*.json`, `./*.svg`, `./*.png`, `./*.jpg`, and `./*.webp` imports from the panel
  directory are allowed under documented size limits
- asset imports resolve to URL strings only in v1; SVG is not transformed into executable React
  components in runtime panels
- CSS imports remain unsupported in v1
- Node built-ins, `http(s):` imports, non-literal dynamic imports, Web Workers, `eval`, and
  `new Function` are rejected
- bundles that exceed documented size/time budgets fail with a visible policy error

No host-private imports. No `@workspace` filesystem alias. No arbitrary third-party packages.

### 4. Stable host-module mapping

Do not couple runtime panels to Vite chunk names or hashed application artifacts.

Use stable shim modules such as:

- `/__bui/runtime/react.js`
- `/__bui/runtime/jsx-runtime.js`
- `/__bui/runtime/boring-ui.js`
- `/__bui/runtime/boring-sdk.js`

Those modules may be backed by a boot-time runtime registry, but the public contract should expose
versioned ESM modules and a host transport/provider boundary rather than raw host-private hooks.

### 5. Runtime panel manifest/status contract and compatibility negotiation

Every discovered panel gets manifest metadata and a status:

- `queued`
- `ready`
- `building`
- `error`
- `disabled` (optional, if discovery/validation chooses to suppress a panel)

Capabilities and/or a dedicated panel endpoint must expose:

- `id`
- `name`
- `entry`
- `module_url`
- `source_map_url`
- `hash`
- `status`
- `error`
- `diagnostics`
- `warnings`
- `build_ms`
- `queue_ms`
- `artifact_bytes`
- `sdk_api_hash`
- `ui_api_hash`
- `last_successful_hash`
- `last_successful_module_url`
- `updated_at`
- `placement`
- `icon`
- `sdk_range`
- `ui_range`
- `host_range`
- `requested_capabilities`
- `effective_capabilities`
- `denied_capabilities`
- `policy_source`
- `compatibility`
- optional manifest-derived metadata

### 6. Tailwind v4 migration safety

Do **not** delete `tailwind.config.js` immediately. Keep it as a compatibility bridge until the
existing Tailwind usage audit is complete and the CSS-driven theme mapping is proven. Remove it
only in the cleanup phase, not on day one.

### 7. Runtime-panel styling contract

This is a critical real-world fix:

Backend-served runtime panel files are not part of the normal host-app Tailwind source scan, so
arbitrary utility classes typed into a runtime `Panel.jsx` will not reliably exist in the final
CSS bundle unless they are already present somewhere in scanned host sources.

Therefore v1 must explicitly choose one of these paths and document it:

1. support only `@boring/ui` plus a curated allowlisted utility subset that is always generated, or
2. add a separate runtime CSS compilation story

Recommendation for v1: choose option 1. Ship a small, curated runtime utility subset for common
layout and spacing classes, and treat arbitrary Tailwind utilities as unsupported in runtime panels.

### 8. Trust boundary

Runtime panels run in the same browser realm as the host app. Import restrictions reduce accidental
coupling, but they do not create a true security sandbox. Only trusted local/agent-authored panels
should run in this system until a stronger isolation model exists.

---

## Pre-Flight Gate: Browser / Platform Support

Before committing to Tailwind v4 migration, confirm boring-ui's browser support matrix is compatible
with Tailwind v4's platform requirements. Tailwind v4 is designed for Safari 16.4+, Chrome 111+,
and Firefox 128+, and the Tailwind team recommends staying on v3.4 if older browsers must be
supported. Also verify Node/tooling versions before migration work begins.

Because this plan relies on Tailwind v4 CSS-first directives and generated shadcn code, pin exact
toolchain versions during the migration window instead of open-ended `v4` / `@latest` ranges.

Required pins:

- `tailwindcss`, `@tailwindcss/vite`, and any Tailwind CLI tooling
- `shadcn` CLI
- `tailwind-merge`, `tw-animate-css`, and `lucide-react`

Because this plan relies on `@source inline()` for the runtime utility allowlist, pin the minimum
Tailwind version to `4.1.x` or later instead of a generic `v4`.

Encode the browser floor, Node floor, and approved Tailwind version in CI before migration begins.

Also lock a Preflight strategy before migration begins. Importing `tailwindcss` injects Preflight
into the base layer automatically, so decide explicitly whether the host keeps a global Preflight or
splits theme / preflight / utilities imports to constrain reset blast radius.

If boring-ui must support older browsers, stop here and either:

- postpone Tailwind v4-specific work, or
- split the project into:
  - shadcn adoption on the current supported Tailwind path, and
  - a later v4 upgrade after browser requirements are renegotiated

---

## Phase 0: Baseline, Inventory, And Contract Lock

### 0.1 Capture deterministic visual baselines

Before any code changes, capture pixel-level baselines of every important view using Playwright.

Also capture initial performance baselines:

- host CSS bytes and JS bytes
- `@boring/ui` CSS bytes
- representative panel cold-build p50 / p95
- representative panel warm-rebuild p50 / p95
- first-activation load time for a representative panel

Use stable fixtures and deterministic rendering rules:

- fixed viewport(s)
- fixed test data / seeded workspace state
- reduced motion
- stable theme toggle state
- stable date/time where practical
- stable font-loading and async waits
- baseline images committed to the repo

### Screenshot Script: `tests/visual/capture-baseline.spec.ts`

```ts
import { test, expect } from '@playwright/test'

const VIEWS = [
  { name: '01-app-empty',     url: '/',              wait: '[data-testid="dockview"]' },
  { name: '02-app-with-file', url: '/',              action: 'open-file' },
  { name: '03-app-dark-mode', url: '/',              action: 'toggle-dark' },
  { name: '10-auth-login',    url: '/auth/login' },
  { name: '11-auth-signup',   url: '/auth/signup' },
  { name: '20-user-settings', url: '/auth/settings' },
  { name: '21-ws-settings',   url: '/w/test/settings' },
  { name: '22-ws-setup',      url: '/w/test/setup' },
]

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  // seed app state here so screenshots are deterministic
})

for (const view of VIEWS) {
  test(`baseline: ${view.name}`, async ({ page }) => {
    await page.goto(view.url)
    if (view.wait) await page.waitForSelector(view.wait, { timeout: 15000 })
    // action helpers implemented separately
    await expect(page).toHaveScreenshot(`${view.name}.png`, { fullPage: true })
  })
}
```

Capture interactive states separately:

- user menu open
- file-tree context menu open
- create-workspace dialog open
- tooltip visible
- editor mode dropdown open
- destructive confirm dialog open (if present)

### 0.2 Inventory the migration surface

Produce a concrete inventory of all generic primitive usage and keep it machine-generated until the
migration closes.

Automate the inventory with an AST-based scan so the migration dashboard stays current as code moves.

Inventory categories:

- buttons
- icon buttons
- badges
- menus / dropdowns / context menus
- dialogs / modals / confirms
- inputs / textareas / selects
- tabs / toggles / segmented controls
- avatar / tooltip / separator / alert / card

Also explicitly mark what is **not** part of the migration:

- DockView shell geometry and tab layout
- terminal/xterm surface
- editor/TipTap content surface
- diff viewer overrides
- chat transcript/tool rendering
- file-tree domain styling
- custom auth/layout page CSS that is not a generic primitive

### 0.3 Lock the runtime panel authoring contract

Document the v1 authoring contract before implementing the pipeline.

Recommended directory shape:

```text
kurt/panels/<panel-name>/
  Panel.jsx
  components/
  lib/
  data/
  panel.json
```

Recommended runtime-panel authoring shape:

```jsx
import { Card, CardContent, CardHeader, CardTitle, Button } from '@boring/ui'
import { useFileContent } from '@boring/sdk'

export default function ExamplePanel() {
  const file = useFileContent?.('README.md')

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Example</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="text-sm">{file?.slice?.(0, 80) ?? 'No file loaded'}</div>
        <Button size="sm">Action</Button>
      </CardContent>
    </Card>
  )
}
```

Rules:

- default export must be a React component
- `panel.json` is the canonical discovery metadata source in v1
- module-exported metadata is intentionally not used for discovery in v1
- allowed imports are limited to the runtime contract above
- no host-private imports
- no arbitrary npm imports
- no arbitrary CSS imports in v1
- supported Tailwind utilities are limited to the documented allowlist
- the entire non-host import graph must remain inside the panel directory; symlink or path-escape
  attempts fail validation

Also define a first-party preview/testing path so panels can be authored without booting the full
workspace runtime every time.

Critical rule: the preview path must exercise the same backend bundler, import-policy plugins,
runtime shim modules, and diagnostics normalization as production. Only the SDK transport is swapped
for `@boring/sdk/testing`.

### 0.4 Define manifest schema and defaults

Add a real shared contract package and JSON Schemas up front so discovery, metadata, diagnostics,
and docs are generated from the same source of truth.

Suggested v1 fields:

```json
{
  "schemaVersion": 1,
  "id": "git-insights",
  "title": "Git Insights",
  "entry": "Panel.jsx",
  "placement": "right",
  "icon": "git-branch",
  "description": "Workspace git metrics and status",
  "minSize": { "width": 320, "height": 220 },
  "runtimeApiVersion": 1,
  "sdkRange": "^1.0.0",
  "uiRange": "^1.0.0",
  "hostRange": ">=1.0.0 <2",
  "activationEvents": ["onVisible"],
  "prefetch": "idle",
  "suspendWhenHidden": true,
  "disposeOnClose": false,
  "requestedCapabilities": ["file.read", "git.read", "panel.storage", "theme.read"]
}
```

Validation rules:

- unknown unprefixed fields fail validation
- incompatible `runtimeApiVersion`, `sdkRange`, `uiRange`, or `hostRange` fail fast with a
  dedicated compatibility diagnostic before build
- unknown requested capabilities fail validation
- unknown activation events or prefetch policies fail validation
- compatibility/capability checks are contract enforcement and UX, not a security boundary
- `x-*` fields are allowed for forward-compatible panel-local extensions
- invalid `entry` paths fail that panel only
- path traversal is rejected
- missing file -> `error` status
- omitted fields get sane defaults

Store schemas in `schemas/` and generate:

- backend validators / model code
- `@boring/sdk` types and JSDoc
- `.d.ts` declarations for public packages
- `docs/agent-runtime-contract.json`
- `docs/panel-diagnostic-codes.json`
- contract snapshot tests

### 0.5 Exit criteria

- baseline screenshots exist
- migration surface inventory is written down
- runtime import contract is approved
- manifest schema is approved
- browser support decision is explicitly made

---

## Phase 1: Create The Real Package Boundaries First, Then Build The shadcn / `@boring/ui` Foundation

### 1.0 Create `packages/ui` and `packages/sdk` before any generated component code lands

Do not initialize shadcn inside `src/front` and move the results later.
Create the real workspace packages first, wire the host app to consume them immediately, and
generate shadcn components directly into `packages/ui`.

This makes the public package boundary real from day one and removes one full round of file moves,
import churn, and CSS rewiring.

### 1.1 Move the host app onto the approved Tailwind baseline

Before running `shadcn init`:

- adopt the dedicated `@tailwindcss/vite` plugin
- confirm Node 20+ in local dev and CI
- confirm the approved browser matrix in automated smoke tests

### 1.2 Initialize shadcn against the monorepo/package layout

shadcn's CLI supports initialization for Vite, supports Tailwind v4 projects, and uses
`components.json` to control output paths, aliases, CSS variables, and whether generated
components are `.tsx` or `.jsx`. For Tailwind v4 projects, the Tailwind config path is left
blank, `new-york` is the preferred style, and `tsx: false` allows JavaScript `.jsx` output.
For workspace packages, keep separate `components.json` files where package-local output paths and
ownership boundaries matter.

Do not rely on a single interactive init run as the canonical setup. Check in explicit
`components.json` files for both the app workspace and `packages/ui`, and validate them in CI.

Suggested command:

```bash
pnpm dlx shadcn@<PINNED_VERSION> init -t vite --monorepo
```

Host-app `components.json`:

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": false,
  "tailwind": {
    "config": "",
    "css": "src/front/styles.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@workspace/ui/components",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "iconLibrary": "lucide"
}
```

Package `packages/ui/components.json`:

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": false,
  "tailwind": {
    "config": "",
    "css": "src/styles.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@workspace/ui/components",
    "utils": "@workspace/ui/lib/utils",
    "ui": "@workspace/ui/components/ui",
    "lib": "@workspace/ui/lib",
    "hooks": "@workspace/ui/hooks"
  },
  "iconLibrary": "lucide"
}
```

### 1.3 Add `cn()` utility

**File**: `packages/ui/src/lib/utils.js`

```js
import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}
```

### 1.4 Publish boring-ui tokens and the shadcn semantic bridge as package CSS

Tailwind v4 supports CSS-driven theme variables with `@theme`, and shadcn supports Tailwind v4
and `@theme inline`. Keep boring-ui tokens as the source of truth, but move the token layer and the
shadcn semantic bridge into public package entrypoints instead of leaving them host-private.

Target ownership:

- `packages/ui/src/tokens.css` owns boring design tokens
- `packages/ui/src/theme.css` owns the shadcn semantic-variable bridge
- `packages/ui/src/styles.css` owns shared primitive styles
- `src/front/styles.css` becomes a thin host composition layer plus domain-specific app CSS

Tailwind v4 also supports `@custom-variant` for custom dark-mode selectors. If the host keeps the
authoritative dark-mode selector, expose that contract explicitly through the public theme layer
rather than requiring child apps to copy host-private CSS.

```css
@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));

@theme inline {
  --color-background: var(--color-background-primary);
  --color-foreground: var(--color-text-primary);
  --color-card: var(--color-background-elevated);
  --color-card-foreground: var(--color-text-primary);
  --color-popover: var(--color-background-elevated);
  --color-popover-foreground: var(--color-text-primary);
  --color-primary: var(--color-accent-default);
  --color-primary-foreground: var(--color-text-on-accent);
  --color-secondary: var(--color-background-tertiary);
  --color-secondary-foreground: var(--color-text-primary);
  --color-muted: var(--color-background-secondary);
  --color-muted-foreground: var(--color-text-secondary);
  --color-accent: var(--color-background-tertiary);
  --color-accent-foreground: var(--color-text-primary);
  --color-destructive: var(--color-error);
  --color-destructive-foreground: #ffffff;
  --color-border: var(--color-border-primary);
  --color-input: var(--color-border-primary);
  --color-ring: var(--color-focus-ring);
  --radius-sm: var(--radius-sm);
  --radius-md: var(--radius-md);
  --radius-lg: var(--radius-lg);
  --font-sans: var(--font-sans);
  --font-mono: var(--font-mono);
}
```

### 1.5 Keep `tailwind.config.js` as a transition bridge

Do **not** delete `tailwind.config.js` in the first foundation commit.

Tailwind v4 supports CSS-first configuration with `@theme`, but it also supports incrementally
bridging legacy JavaScript config via `@config` during migration. Safelisting is no longer handled
by the JS config in v4, so if a safelist is needed it must move to `@source inline()`.

Plan:

1. keep the existing JS config while auditing current Tailwind usage
2. move design-token mappings and custom utilities into CSS deliberately
3. only delete `tailwind.config.js` after:
   - the host app builds cleanly
   - screenshot diffs are acceptable
   - the runtime utility allowlist is in place
   - no remaining dependency on JS-only config behavior exists

### 1.6 Add a separate runtime-panel stylesheet and utility allowlist policy with generated CSS and build-time enforcement

Because Tailwind generates CSS by scanning project sources, backend-served runtime panel files are
not automatically part of that scan. Tailwind v4 provides `@source` and `@source inline()` for
explicit source registration and safelisting.

To keep runtime panels practical without adding a full second Tailwind compiler in v1:

- create `packages/ui/src/runtime-panel.css`
- import it only where runtime panels are mounted
- explicitly register package source paths with `@source` / `source()` so monorepo scanning is deterministic
- define the allowlist once in `packages/ui/src/runtime-utilities.allowlist.json`
- generate the runtime utility CSS from that source of truth using `@source inline()`
- validate runtime-panel `className` usage against the same allowlist during build

Recommended v1 allowlist:

- layout: `flex`, `grid`, `block`, `hidden`, `contents`
- sizing: `w-full`, `h-full`, `min-w-0`, `min-h-0`, `max-w-full`
- spacing: `gap-1`..`gap-6`, `p-1`..`p-6`, `px-*`, `py-*`, `m-*`, `space-y-*`
- alignment: `items-center`, `items-start`, `justify-between`, `justify-center`
- overflow: `overflow-hidden`, `overflow-auto`
- typography: `text-xs`, `text-sm`, `text-base`, `font-medium`, `font-semibold`, `truncate`
- borders/background helpers that map to semantic tokens only if truly needed

Important rule:

- runtime panels may use `@boring/ui` freely
- runtime panels may use only the documented utility subset outside `@boring/ui`
- arbitrary values and runtime-generated utilities are unsupported in v1
- static-analyzable composition is allowed, for example `cn("p-2", isCompact && "gap-2")`, as long
  as every candidate class is a complete string literal visible to the build step
- template-string-generated utilities and other runtime-computed class tokens remain unsupported

Also add a standard runtime panel root contract:

- every panel mounts inside `.bui-runtime-panel-root`
- the root provides inherited typography, colors, and overflow defaults
- the root applies scoped isolation/containment defaults where safe to reduce style bleed and
  expensive relayout
- panel authors should prefer `@boring/ui` layout primitives over raw utility composition

### 1.7 Install initial shadcn component set

Install components in batches.

**Batch 1 — Primitives**

```bash
pnpm dlx shadcn@<PINNED_VERSION> add button badge separator input textarea label switch avatar kbd
```

**Batch 2 — Composite / form**

```bash
pnpm dlx shadcn@<PINNED_VERSION> add card alert tabs toggle toggle-group select field native-select
```

**Batch 3 — Overlay**

```bash
pnpm dlx shadcn@<PINNED_VERSION> add dialog alert-dialog dropdown-menu context-menu tooltip popover
```

**Batch 4 — Data / panel-friendly**

```bash
pnpm dlx shadcn@<PINNED_VERSION> add table scroll-area skeleton progress empty spinner sonner
```

### 1.7A Generated-code ownership policy

Track each adopted shadcn component in `docs/UPSTREAM_SHADCN.md` with:

- original source/reference
- local modifications
- last intentional sync date

### 1.8 Add thin boring-specific wrappers only where justified

Default rule: export the shadcn components directly.

Exception rule: if boring-ui needs consistent boring-specific behavior that will otherwise be
re-implemented over and over (for example a menu-content offset, standard icon-button defaults,
or a destructive-confirm dialog composition), create a thin wrapper in `@boring/ui` instead of
re-creating local CSS or one-off component forks.

For runtime panels, explicitly add:

- `PanelScaffold`
- `PanelHeader`
- `PanelSection`
- `Stack`
- `Inline`
- `EmptyState`
- `LoadingState`
- `ErrorState`
- `Icon` (curated icon surface for runtime panels)

### 1.9 Verify foundation before migration

Checklist:

- app builds
- no CSS errors
- light/dark mode still work
- baseline visual diff is either zero-change or intentionally documented
- `@boring/ui` can be imported from local consumers
- runtime utility allowlist stylesheet is present and documented

---

## Phase 2: Migrate The Host App To The Shared Vocabulary

### 2A. CSS contract and cascade layering

`@boring/ui` must ship explicit public CSS entrypoints:

- `@boring/ui/tokens.css` for boring design tokens
- `@boring/ui/theme.css` for the semantic-variable bridge
- `@boring/ui/styles.css` for shared primitives
- `@boring/ui/runtime-panel.css` for `.bui-runtime-panel-root` defaults and the runtime utility subset

The host app remains the owner of:

- domain/layout CSS
- any host-only theme composition wrapper that is not part of the public package contract

Required import/layer order:

1. `@boring/ui/tokens.css`
2. `@boring/ui/theme.css`
3. `@boring/ui/styles.css`
4. `@boring/ui/runtime-panel.css` (workspace surfaces only)
5. domain-specific app CSS

Use explicit cascade layers to prevent import-order drift, for example:
`@layer theme, boring-ui, runtime-panels, app;`

Default consumer rule:

- child apps import the public CSS entrypoints directly and do not need `@source` package scanning
  just to consume shared primitives
- explicit `@source` package scanning remains an advanced opt-in for consumers that need to
  generate additional utilities from package source

Migration principle: move generic primitives first, leave domain/layout CSS alone.

### 2.1 Buttons and icon buttons

Mapping:

| Old Pattern | New Pattern |
|---|---|
| `<button className="btn btn-primary">` | `<Button>` |
| `<button className="btn btn-secondary">` | `<Button variant="secondary">` |
| `<button className="btn btn-ghost">` | `<Button variant="ghost">` |
| `<button className="btn btn-icon">` | `<Button variant="ghost" size="icon">` |
| `<button className="settings-btn-danger">` | `<Button variant="destructive">` |

Targets:

- `src/front/components/SyncStatusFooter.jsx`
- `src/front/components/UserMenu.jsx`
- `src/front/components/FileTree.jsx`
- `src/front/components/GitHubConnect.jsx`
- `src/front/panels/EditorPanel.jsx`
- `src/front/panels/TerminalPanel.jsx`
- `src/front/pages/UserSettingsPage.jsx`
- `src/front/pages/WorkspaceSettingsPage.jsx`
- `src/front/pages/AuthPage.jsx`

After migration:

- remove `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-ghost`, `.btn-icon`,
  and settings-button generic classes
- re-run visual + interaction QA

### 2.2 Menus and context menus

Current duplicated menu surfaces:

1. file-tree context menu
2. sync-status menu
3. editor-mode menu
4. user menu dropdown
5. workspace switcher dropdown

All migrate to Radix-backed shadcn menu primitives.

Targets:

- `src/front/components/FileTree.jsx` → `ContextMenu`
- `src/front/components/SyncStatusFooter.jsx` → `DropdownMenu`
- `src/front/components/UserMenu.jsx` → `DropdownMenu`
- `src/front/panels/EditorPanel.jsx` → `DropdownMenu`
- `src/front/pages/WorkspaceSettingsPage.jsx` → `DropdownMenu`

Requirements:

- preserve keyboard navigation
- preserve focus return
- preserve portal behavior
- preserve submenu behavior if present
- preserve all aria labels and command semantics

### 2.3 Dialogs / modals / confirms

Mapping:

| Old | New |
|---|---|
| `.modal-overlay` + `.modal-dialog` | `<Dialog>` + `<DialogContent>` |
| `.modal-header` / `.modal-title` | `<DialogHeader>` / `<DialogTitle>` |
| `.modal-body` | content area or `<DialogDescription>` |
| `.modal-footer` | `<DialogFooter>` |
| `.modal-close` | shadcn/Radix close controls |

Targets:

- `src/front/pages/CreateWorkspaceModal.jsx`
- settings-page confirmations
- destructive confirm surfaces, if any

Requirements:

- focus trap
- Escape closes when appropriate
- destructive actions remain clearly signposted
- any async submit state remains intact

### 2.4 Inputs, textareas, selects, and small form primitives

Mapping:

| Old | New |
|---|---|
| `settings-input` / `auth-input` | `<Input>` |
| `pi-backend-input` | `<Textarea>` |
| search input + icon wrapper | `<Input>` plus wrapper |
| settings/native select | `<Select>` where custom behavior is needed |
| terminal select | `<Select>` if behavior is compatible; keep native if required for edge cases |

Targets:

- `src/front/pages/AuthPage.jsx`
- `src/front/pages/UserSettingsPage.jsx`
- `src/front/pages/WorkspaceSettingsPage.jsx`
- `src/front/components/FileTree.jsx`
- `src/front/panels/TerminalPanel.jsx`

Caution:

Do not replace a native `<select>` with Radix `Select` where browser-native behavior is materially
better or where implementation complexity outweighs the benefit. Use the shared vocabulary, but not
dogmatically.

### 2.5 Cards, badges, alerts, tabs, tooltip, switch, avatar, separator

Priority order:

1. `Badge`
2. `Card`
3. `Tooltip`
4. `Tabs`
5. `Switch`
6. `Alert`
7. `Avatar`
8. `Separator`

Rules:

- replace only the generic primitive layer
- preserve layout wrappers
- preserve keyboard shortcuts and focus behavior
- if behavior differs, solve it in `@boring/ui`, not by reintroducing page-local primitive CSS

### 2.6 CSS cleanup and guardrails

After each category lands:

- delete the replaced CSS blocks
- screenshot diff the affected views
- run targeted interaction tests

After all categories land:

- remove the replaced generic CSS from `styles.css`
- keep domain-specific CSS unchanged
- keep `tokens.css`, `scrollbars.css`, chat CSS, and other domain overrides

Add a CI guardrail:

- add codemods for the highest-confidence replacements
- add ESLint/AST rules that ban:
  - imports from host-private UI paths after public packages exist
  - retired generic primitive classes
  - new page-local primitive wrappers when an equivalent `@boring/ui` export exists
  - runtime-panel dynamic class construction
- keep `scripts/check-no-legacy-generic-ui.mjs` as a fast backstop scan
- fail CI if banned legacy generic classes reappear in JSX or CSS:
  - `btn`
  - `btn-primary`
  - `btn-secondary`
  - `btn-ghost`
  - `modal-*`
  - old menu classnames
  - other explicitly retired generic primitive classes

### 2.7 Exit criteria

- host app generic primitives use `@boring/ui`
- the host app and at least one child app can consume the public `@boring/ui` CSS entrypoints
  without depending on host-private token files
- legacy generic primitive CSS is mostly gone
- screenshot and interaction regressions are understood and acceptable
- no one is adding new legacy primitive classes

---

## Phase 3: Harden, Version, And Publish `@boring/ui` And `@boring/sdk`

### 3.1 Add release tooling, semver policy enforcement, and child-app verification for the packages created in Phase 1

Add Changesets or equivalent before these packages are treated as public contracts.

### 3.2 Public package entrypoints

**File**: `packages/ui/src/index.js`

Export:

- primitives
- panel-oriented layout primitives
- `cn`
- any approved thin boring wrappers
- no host-private components by default

`src/front` should consume `@boring/ui`; it should no longer define the public UI package surface.

### 3.3 Package exports and compatibility aliases

Document only these styles for new consumers:

```js
import { Button, Card, Badge } from '@boring/ui'
```

Public CSS entrypoints should also be first-class exports:

```js
import '@boring/ui/tokens.css'
import '@boring/ui/theme.css'
import '@boring/ui/styles.css'
```

Import `@boring/ui/runtime-panel.css` only where runtime panels are mounted.

If compatibility aliases remain during migration, document them as temporary compatibility only.

### 3.4 Public API stability tiers

- `@boring/ui` root exports are stable once documented
- `@boring/sdk` root exports are stable once documented
- `@boring/sdk/testing` is dev-only and provides mock transports/providers for preview and CI
- `@boring/sdk/host` is host-only and not part of the runtime panel import contract
- `@boring/sdk/experimental` may evolve faster and is never used by runtime panels in v1

### 3.5 Verify in at least one child app

Use `boring-macro` as the canary child app.

Verification:

- it builds against the new exports
- panels render correctly
- no consumer must import from boring-ui internal source paths
- CSS import expectations are documented and actually work

### 3.6 Documentation updates

Update:

- `README.md`
- `docs/EXTENSION_GUIDE.md`
- any child-app integration notes

Document:

- allowed SDK imports
- CSS import expectations
- migration path from compatibility imports to `@boring/ui`

### 3.6A Optional: publish a private shadcn-compatible registry for boring-specific blocks

Use the registry for copy/paste compositions and agent-facing recipes that are too high-level or
too fast-moving for the semver-stable `@boring/ui` package surface.

Examples:

- `PanelScaffold`
- authenticated settings forms
- diagnostics drawers
- file-tree action bars

Keep `@boring/ui` for stable runtime imports; use the private registry for accelerators.

---

## Phase 4: Build The Runtime Panel Pipeline

## Current Path

1. backend reports relative source paths
2. frontend receives `workspace_panes`
3. frontend imports via `@workspace/<path>`
4. it works only when the frontend build tool can see workspace files directly

## Target Path

1. backend discovers panel directories and manifests
2. backend validates and compiles each panel to ESM
3. backend reports content-addressed artifact URLs, hashes, statuses, and diagnostics
4. frontend imports `module_url`
5. file-watch invalidation updates manifest state and refreshes affected panels

### 4.1 Host runtime bridge

**File**: `src/front/workspace/hostBridge.jsx`

```js
import * as React from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import * as boringUI from '@boring/ui'
import {
  RuntimeHostBridgeProvider,
  createHostSdkTransport,
} from '@boring/sdk/host'
import { useFileService, useGitService } from '../providers/data'
import { buildApiUrl } from '../utils/apiBase'
import { apiFetch } from '../utils/transport'

export function BoringRuntimeBridge({ children }) {
  const file = useFileService()
  const git = useGitService()

  const transport = React.useMemo(
    () => createHostSdkTransport({ file, git, buildApiUrl, apiFetch }),
    [file, git],
  )

  return (
    <RuntimeHostBridgeProvider transport={transport}>
      {children}
    </RuntimeHostBridgeProvider>
  )
}

globalThis.__BORING_RUNTIME__ = Object.freeze({
  version: 'v1',
  React,
  jsxRuntime,
  ui: boringUI,
})
```

Mount `BoringRuntimeBridge` above the runtime-panel subtree before workspace panel loading.

### 4A. SDK architecture: transport-backed and future-isolation-ready

`@boring/sdk` must be a real runtime package, not a plain bag of host hook references exposed on
`globalThis`.

Design it with four layers:

1. stable panel-facing exports from `@boring/sdk`
2. a host-only adapter implementation (`@boring/sdk/host`)
3. a provider that scopes `panelId`, negotiated capabilities, theme, and storage
4. a capability gate that rejects ungranted operations with stable error codes

This keeps the v1 same-realm implementation simple while preserving a clean path to iframe/worker
isolation later without rewriting panel code.

### 4.2 Stable runtime shim modules

Serve stable modules from predictable URLs.

Suggested files or generated responses:

- `/__bui/runtime/react.js`
- `/__bui/runtime/jsx-runtime.js`
- `/__bui/runtime/boring-ui.js`
- `/__bui/runtime/boring-sdk.js`

Each shim re-exports from `globalThis.__BORING_RUNTIME__`.

Why this design:

- stable import contract
- no dependency on Vite chunk filenames
- no browser import-map dependency in v1
- easier debugging and backward compatibility

### 4.3 Define `@boring/sdk`

Keep the runtime SDK intentionally small in v1.

Initial recommended exports:

- `useFileContent`
- `writeFile`
- `useGitStatus`
- `openFile`
- `usePanelStorage`
- `useTheme`
- `useCapabilities`
- `toast`
- `RuntimePanelProvider`

`toast` should be implemented through Sonner, not the deprecated shadcn toast surface.

The frontend hot-loads those ESM bundles into DockView and wraps each runtime panel in
`RuntimePanelProvider` with `panelId`, negotiated capabilities, and storage scope.

Do not expose raw `buildApiUrl` or `apiFetch` from the stable runtime surface in v1.
If a generic escape hatch is required, place it in `@boring/sdk/experimental` behind an explicit
capability such as `host.request`.

`usePanelStorage` must define quota, per-panel namespace, optional schema versioning, and
clear-on-uninstall semantics.

Do not expose host internals casually. Every addition increases long-term compatibility burden.

### 4.4 Backend compiler service

**New module**: `src/back/boring_ui/api/panel_bundler.py` (or similarly named service module)

Responsibilities:

- discover panels
- validate manifest + entry
- compile panels
- cache outputs
- serve bundles and source maps
- track status/error metadata
- invalidate on changes
- cancel superseded builds
- write artifacts atomically
- supervise Node worker health

Recommended implementation details:

- keep Python responsible for discovery and HTTP APIs
- delegate compilation to a long-lived Node worker that uses esbuild's JavaScript API
- use a bounded fair queue with per-workspace concurrency limits, back-pressure, and debounced rebuilds
- keep a bounded LRU of warm `esbuild.context()` objects for recently active panels/workspaces and
  use `rebuild()` for incremental builds
- never block artifact/status requests on a synchronous cold build; expose `queued` / `building`
  and serve last-known-good when available
- garbage-collect stale artifacts and idle contexts on a retention policy while preserving current
  and last-known-good artifacts
- cancel or coalesce superseded builds for the same panel so rapid saves do not burn CPU on stale artifacts
- emit an artifact metadata record containing build inputs, public API hashes, bytes, timings, and
  diagnostics
- publish new artifacts via atomic rename/promote only after a successful build
- heartbeat and auto-restart the long-lived Node worker on crash or version mismatch
- use esbuild plugins for import-policy validation, local-asset rules, runtime utility policy
  enforcement, diagnostics normalization, and robust watch dependency tracking
- use the project-local `esbuild` install, not a global binary
- bundle as ESM
- emit source maps
- platform: browser
- externalization/aliasing only for the approved runtime imports
- reject unsupported bare imports explicitly
- store build artifacts outside tracked source paths, e.g. `.boring/panel-builds/`
- use content-hash invalidation based on:
  - entry source
  - relative local module graph inside the panel directory
  - manifest
  - relevant SDK/UI version marker

esbuild supports long-lived JavaScript `context()` objects with incremental `rebuild()`, and its
plugin API is available from JavaScript and Go rather than the CLI. That makes a small Node worker
the better long-term fit for policy enforcement and fast rebuilds.

Recommended Node worker direction:

```js
import * as esbuild from 'esbuild'

const ctx = await esbuild.context({
  entryPoints: [entryFile],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  jsx: 'automatic',
  sourcemap: 'external',
  loader: {
    '.jsx': 'jsx',
    '.tsx': 'tsx',
    '.json': 'json',
  },
  alias: {
    react: '/__bui/runtime/react.js',
    'react/jsx-runtime': '/__bui/runtime/jsx-runtime.js',
    '@boring/ui': '/__bui/runtime/boring-ui.js',
    '@boring/sdk': '/__bui/runtime/boring-sdk.js',
  },
  plugins: [
    runtimeImportPolicyPlugin(),
    runtimeUtilityPolicyPlugin(),
    runtimeDiagnosticsPlugin(),
  ],
})

const result = await ctx.rebuild()
```

Important v1 restriction:

- do **not** enable arbitrary CSS importing for runtime panels yet
- reject `.css` imports in v1 to avoid global style injection and styling inconsistency
- reject `node:` and browser-remote URL imports entirely
- reject dynamic import specifiers that are not string literals
- allow only local static assets within the panel directory and enforce per-asset size caps
- fail validation if any non-host import resolves outside the panel directory, including symlink
  escape attempts

### 4.5 Manifest state and validation

Per panel, track:

- `id`
- `name`
- `source_path`
- `entry_path`
- `module_url`
- `source_map_url`
- `hash`
- `status`
- `error`
- `queue_ms`
- `build_ms`
- `artifact_bytes`
- `sdk_api_hash`
- `ui_api_hash`
- `last_successful_hash`
- `last_successful_module_url`
- `requested_capabilities`
- `effective_capabilities`
- `denied_capabilities`
- `policy_source`
- `compatibility`
- `updated_at`
- `placement`
- `icon`
- optional manifest metadata

Validation behavior:

- one broken panel must not break discovery for other panels
- compile failure -> panel status `error`
- validation error -> panel status `error`
- unchanged panels reuse cached build output
- rebuilds are debounced on rapid saves
- diagnostics are normalized to `{ code, severity, message, file, line, column, hint }`
- compatibility includes explicit denied-capability reasons and API-hash mismatch detection
- source maps are served only to authenticated/dev users by default

### 4.6 Update workspace discovery

**File**: `src/back/boring_ui/api/workspace_plugins.py`

Discovery should:

- find panel directories
- locate default entry (`Panel.jsx`, `index.jsx`, `index.tsx`, or manifest entry)
- read `panel.json`
- validate safe paths
- attach status/build metadata
- return loader-friendly `module_url` instead of raw relative source paths
- return immutable content-addressed artifact URLs and cache hints

Suggested response shape:

```python
{
    "id": "ws-git-insights",
    "name": "Git Insights",
    "placement": "right",
    "icon": "git-branch",
    "module_url": "/api/panel-artifacts/ws-git-insights/<hash>/module.js",
    "source_map_url": "/api/panel-artifacts/ws-git-insights/<hash>/module.js.map",
    "hash": "<hash>",
    "status": "ready",
    "error": None,
    "sdk_api_hash": "<hash>",
    "ui_api_hash": "<hash>",
    "requested_capabilities": ["file.read", "git.read", "panel.storage", "theme.read"],
    "effective_capabilities": ["file.read", "git.read", "panel.storage", "theme.read"],
    "denied_capabilities": [],
    "policy_source": "panel-manifest-v1",
    "compatibility": {"ok": True},
    "last_successful_hash": "<hash>",
    "last_successful_module_url": "/api/panel-artifacts/ws-git-insights/<hash>/module.js",
    "activation_events": ["onVisible"],
    "prefetch": "idle",
    "suspend_when_hidden": True,
    "dispose_on_close": False,
    "updated_at": "...",
}
```

Artifact-serving rules:

- manifest/status endpoints use `Cache-Control: no-store`
- content-addressed artifact URLs use strong `ETag` plus long-lived `immutable` caching
- source maps follow stricter auth/debug rules than module artifacts

### 4.7 Update capabilities and app bootstrap

Make `workspace_panes` include runtime bundle metadata:

- `module_url`
- `hash`
- `status`
- `error`
- `diagnostics`
- `requested_capabilities`
- `denied_capabilities`
- `last_successful_hash`
- `last_successful_module_url`
- `sdk_api_hash`
- `ui_api_hash`
- `policy_source`
- `compatibility`
- `effective_capabilities`

The frontend should not have to reverse-engineer source paths anymore.

### 4.8 Replace the frontend loader

**File**: `src/front/workspace/loader.js`

New behavior:

- if `status === "ready"`, import `module_url`
- import ready panels in parallel via `Promise.allSettled`
- lazy-load panels on first activation when possible instead of eagerly importing every discovered panel
- honor manifest-driven activation and prefetch policy:
  - `onVisible` => load when tab becomes visible
  - `idle` => prefetch after the shell settles
  - `hover` => prefetch when the user is likely to open the panel
- allow hidden panels to suspend or fully dispose based on manifest policy
- if `status === "building"` and `last_successful_module_url` exists, keep rendering the last good
  panel with a rebuilding badge instead of blanking the tab
- if `status === "error"` and `last_successful_module_url` exists, keep rendering the last good
  panel with an error badge and diagnostics drawer
- if semver ranges pass but public API hashes do not, suppress execution and render a dedicated
  compatibility error instead of attempting to mount a stale artifact
- if no last successful artifact exists, render visible building/error placeholder panels
- if dynamic import itself fails, render a visible load error

Do not assume Vite will automatically module-preload these backend-served artifacts. If preload is
desired, own it explicitly (`fetch` / `modulepreload`) rather than relying on HTML-entry behavior
or library-mode defaults.

Example direction:

```js
export async function loadWorkspacePanes(workspacePanes) {
  const loaded = {}

  for (const pane of workspacePanes) {
    if (pane.status === 'building') {
      loaded[pane.id] = () => <PanelBuildPending pane={pane} />
      continue
    }

    if (pane.status === 'error') {
      loaded[pane.id] = () => <PanelBuildError pane={pane} />
      continue
    }

    try {
      const mod = await import(/* @vite-ignore */ pane.module_url)
      loaded[pane.id] = mod.default
    } catch (error) {
      loaded[pane.id] = () => <PanelLoadError pane={pane} error={error} />
    }
  }

  return loaded
}
```

### 4.9 Add per-panel React error boundaries

Compile success is not the same as runtime success.

Wrap runtime panels in a small error boundary so a bad render/effect does not take down DockView
or break sibling panels.

### 4.10 Preserve websocket invalidation

When a panel file changes:

- backend invalidates cached artifact
- capabilities/panel manifest refresh occurs
- frontend updates that panel
- unaffected panels remain untouched

### 4.11 Temporary rollout flag

For safe rollout, keep the old loader path behind a temporary feature flag or capability switch:

- `runtime_panel_mode: "vite-alias" | "backend-esm"`

Rollout sequence:

1. implement backend ESM path
2. verify it in dev
3. verify it in production-like env
4. switch default to backend ESM
5. remove the old alias path only after soak

---

## Phase 5: Tests, QA, And Rollout

### 5.1 Automated visual regression

Re-run the same screenshot suite after each major migration category.

Expected intentional changes may include:

- button heights / padding
- native select -> Radix select
- menu animation / portal behavior
- tooltip rendering strategy

Unexpected changes in spacing, typography, or color must be investigated because the visual tokens
should still come from the same boring-ui variables.

### 5.2 Accessibility regression checks

Add focused checks for:

- menu keyboard navigation
- dialog focus trap and escape behavior
- tab order on settings/auth pages
- tooltip labeling
- switch labels
- context menu keyboard operability where applicable

Where practical, add automated accessibility assertions on the highest-risk screens.

### 5.3 Backend tests

Add tests for:

- panel discovery
- manifest defaulting
- path traversal rejection
- compile success
- compile failure
- unsupported import rejection
- cache invalidation
- source map serving
- one bad panel not poisoning all panels
- local relative module imports that stay inside the panel directory
- panel-directory escape rejection for relative imports and symlinks

### 5.4 Frontend tests

Add tests for:

- shared wrapper rendering
- loader behavior for `ready`, `building`, and `error`
- panel error boundary behavior
- websocket-driven refresh
- runtime-panel error UI
- public API contract snapshots for `@boring/ui` and `@boring/sdk`
- agent-contract artifact generation and drift detection

### 5.5 End-to-end runtime panel tests

Create fixture panels:

1. `hello-panel` -> valid panel that imports `@boring/ui`
2. `build-error-panel` -> invalid JSX/import to exercise compile error state
3. `runtime-error-panel` -> throws during render to exercise error boundary
4. `utility-allowlist-panel` -> uses supported runtime utility subset
5. `unsupported-utility-panel` -> uses disallowed classes and fails with a clear policy diagnostic

Verify:

- discovery works
- compilation happens
- DockView renders the panel
- editing the file updates the panel
- bad panels fail visibly and locally

### 5.5B Panel preview harness and doctor CLI

Add a lightweight local preview route/app and a CLI (`panel:doctor`) that can:

- validate `panel.json`
- check import/capability/style policy
- render the panel against mocked SDK data
- display normalized diagnostics without booting a full workspace

The preview route must load the compiled backend ESM artifact for the panel under test rather than
a separate Vite-only source import path.
The preview and doctor flows must reuse the same bundler worker, shim modules, import-policy
plugins, runtime utility policy, and diagnostics normalization as production.

### 5.5A Observability and inspector

Add:

- structured logs keyed by `panel_id`, `hash`, and workspace
- metrics for discovery, build, load, and render-failure rates
- queue depth, canceled-build count, worker restarts, compatibility failures, denied-capability
  counts, and last-known-good fallback rate
- performance budget checks that fail CI or require explicit approval when:
  - `@boring/ui/styles.css` grows beyond the agreed threshold
  - cold-build or warm-rebuild regressions exceed the agreed threshold
  - first-activation latency regresses beyond the agreed threshold
- a small developer inspector route or drawer showing current panel status, hashes, artifacts,
  and diagnostics

### 5.6 Child-app verification

Use `boring-macro` as the canary consumer.

Verify:

- build succeeds
- imports come from `@boring/ui`
- panels/components render correctly
- no consumer relies on internal source paths

### 5.7 Manual QA checklist

- light mode works
- dark mode works
- auth pages function
- settings pages function
- file tree rename/create/context menu work
- editor mode toggle works
- terminal session controls work
- user menu works
- create workspace dialog works
- sync footer menu works
- DockView drag/resize/tab close still work
- runtime panel load/build/error states are understandable

### 5.8 Documentation rollout

Update docs so runtime panel authors know exactly what is supported.

Must document:

- allowed imports
- example `Panel.jsx`
- example `panel.json`
- supported runtime utility subset
- unsupported patterns
- error-debugging workflow
- compatibility alias deprecation plan
- generated machine-readable contract artifacts:
  - `docs/agent-ui-catalog.json`
  - `docs/agent-runtime-contract.json`
  - `docs/panel-diagnostic-codes.json`

Generate those artifacts from the shared schemas instead of maintaining them by hand.

---

## Risks And Mitigations

### Risk: visual churn during migration

Mitigation:

- deterministic baselines
- migrate by primitive category
- token bridge keeps existing visual language
- no redesign work mixed into this project

### Risk: Tailwind v4 breaks older browser support

Mitigation:

- explicit pre-flight browser gate
- do not start the migration without agreeing on support matrix
- keep old path or postpone v4 if required

### Risk: runtime panels render without expected utility classes

Mitigation:

- explicitly ship a runtime utility allowlist
- document the supported subset
- reject unsupported styling patterns in v1

### Risk: runtime bundles accidentally couple to internal app chunks

Mitigation:

- stable shim modules
- no references to hashed frontend assets
- no import-map dependency in v1

### Risk: compile failures create blank tabs or silent no-ops

Mitigation:

- expose build status in capabilities
- render explicit build and load error panels
- store source maps and normalized diagnostics

### Risk: one bad panel breaks all panel discovery

Mitigation:

- per-panel validation and compile isolation
- status/error tracked per panel
- continue serving healthy panels

### Risk: package rename / import migration breaks consumers

Mitigation:

- compatibility alias during migration
- canary child-app verification
- documented deprecation path

### Risk: runtime panels are mistaken for a security sandbox

Mitigation:

- document the trust boundary explicitly
- keep the import surface small
- treat panels as trusted extensions until a real isolation model exists

---

## File Inventory

### New Files

- `schemas/panel-manifest.schema.json`
- `schemas/panel-status.schema.json`
- `schemas/panel-diagnostic.schema.json`
- `packages/ui/src/*`
- `packages/ui/components.json`
- `packages/ui/package.json`
- `packages/sdk/src/*`
- `packages/sdk/package.json`
- package-level `components.json` files where needed
- `packages/ui/src/styles.css`
- `packages/ui/src/tokens.css`
- `packages/ui/src/theme.css`
- `packages/ui/src/runtime-panel.css`
- `packages/ui/src/runtime-utilities.allowlist.json`
- `src/front/workspace/hostBridge.jsx`
- runtime placeholder/error components for panel states
- `src/back/boring_ui/api/panel_bundler.py`
- Node build worker files for esbuild contexts/plugins
- runtime style-policy validation plugin / rule
- runtime shim module files or route handlers
- `tests/visual/capture-baseline.spec.ts`
- backend and frontend tests for runtime panels
- `scripts/check-no-legacy-generic-ui.mjs`
- `packages/sdk/src/testing/*`
- `scripts/panel-doctor.mjs`
- preview route/app files
- codemods for legacy generic UI replacements
- ESLint rules / config for public-package boundary enforcement
- `docs/UPSTREAM_SHADCN.md`
- `docs/agent-ui-catalog.json`
- `docs/agent-runtime-contract.json`
- `docs/panel-diagnostic-codes.json`

### Modified Files

- `src/front/styles.css`
- `src/front/index.js`
- `src/front/App.jsx`
- `src/front/workspace/loader.js`
- migrated host components/pages/panels
- `src/back/boring_ui/api/workspace_plugins.py`
- `src/back/boring_ui/api/capabilities.py`
- `src/back/boring_ui/api/app.py`
- `package.json`
- `vite.config.ts`
- docs files (`README.md`, `docs/EXTENSION_GUIDE.md`, migration docs)

### Deleted Files (late cleanup only)

- `tailwind.config.js` (only after transition audit is complete)
- dead generic primitive CSS blocks
- dead Vite-only runtime panel loading path

### Explicitly Untouched / Mostly Untouched

- `src/front/styles/tokens.css` becomes a thin compatibility wrapper or is deleted after the public
  theme contract lands
- `src/front/styles/scrollbars.css`
- domain-specific chat CSS
- DockView-specific layout/theme CSS
- terminal/xterm overrides
- editor/TipTap overrides
- diff-viewer overrides
- file-tree domain styling
- other domain-specific surfaces with no shadcn equivalent

---

## Suggested Commit Sequence

```text
1. chore: add deterministic visual baselines and migration inventory
2. chore: pin the approved Tailwind/shadcn/tooling versions and Node baseline
3. feat: create `packages/ui` and `packages/sdk` before generated code lands
4. chore: initialize shadcn against the monorepo/package layout
5. feat: define CSS contract, runtime-panel stylesheet, and utility allowlist policy
6. chore: add shadcn component primitives and Sonner
7. refactor: migrate buttons and badges to `@boring/ui`
8. refactor: migrate menus and context menus to `@boring/ui`
9. refactor: migrate dialogs to `@boring/ui`
10. refactor: migrate inputs, textareas, and selects to `@boring/ui`
11. refactor: migrate tooltip, tabs, switch, avatar, alert, card, separator
12. chore: add codemods, AST/ESLint guardrails, and remove retired generic primitive CSS
13. feat: add release tooling and publish `@boring/ui` compatibility alias
14. release: soak Track A independently
15. feat: add transport-backed `@boring/sdk`, host adapter, and testing package
16. feat: add schemas, generated contracts, and runtime host bridge
17. feat: add queue-based Node-worker panel compiler, diagnostics, and cache/GC policy
18. feat: switch frontend loader to backend ESM with last-known-good and prefetch behavior
19. feat: add preview harness, `panel:doctor`, observability, lifecycle policies, and inspector
20. test: add runtime panel integration fixtures, policy tests, and contract snapshots
21. docs: update extension guide, SDK docs, and generated contract outputs
22. chore: remove old `@workspace` loader path after Track B soak
23. chore: delete transition-only tailwind config if no longer needed
```

---

## Definition Of Done

This project is done when all of the following are true:

- boring-ui's generic primitive layer is implemented through `@boring/ui`
- the host app uses the shared vocabulary instead of local generic primitive CSS
- boring-ui tokens still control the visual system
- child apps can render shared primitives through the public `@boring/ui` CSS entrypoints without
  depending on host-private theme files or package source scanning
- at least one child app imports `@boring/ui` without reaching into internal source paths
- runtime panels load from backend-served ESM instead of the Vite filesystem alias
- runtime panels can import only the approved v1 SDK surface
- runtime panels can use local relative code modules as long as the import graph stays inside the
  panel directory
- panel compile failures are visible in the UI
- panel runtime failures are isolated by error boundaries
- a valid panel hot-reloads within the agreed warm-rebuild budget without restarting the app
- agreed CSS-size, cold-build, warm-rebuild, and first-activation budgets are met or explicitly
  accepted as intentional exceptions
- dead generic primitive CSS and the old loader path are removed after soak
- documentation accurately describes the supported authoring contract

---

## Final Execution Summary

```text
Track A  package-first `@boring/ui` extraction + host primitive migration
Track B  transport-backed `@boring/sdk` + runtime panel pipeline

Phase 0  Baseline + inventory + contract lock
Phase 1  package-first boundaries + Tailwind baseline + shadcn foundation
Phase 2  host app migration by primitive category + CSS cleanup + CI guardrail
Phase 3  publish/verify real workspace packages for child apps
Phase 4  backend-bundled runtime panel pipeline + stable shim modules + visible statuses/errors
Phase 5  test, soak, document, and remove old paths
```
