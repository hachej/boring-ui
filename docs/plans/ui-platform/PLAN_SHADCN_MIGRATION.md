# Plan: Shadcn-Native Host Migration, Then Runtime Panels

## Status

Authoritative execution plan for the UI-platform work.

This replaces the earlier track-first framing with a phased plan. Only Phase 1 is
active right now. Later phases exist to preserve the route to runtime panels, not to
authorize building that machinery now.

`docs/plans/ui-platform/PLAN_BORING_UI_SDK_RUNTIME_PANELS.md` is no longer the active
execution plan. It is a deferred follow-on note for later phases only.

---

## Why The Plan Changed

The earlier plan tried to do too much at once:

- host style-system cleanup
- workspace/package extraction
- runtime SDK design
- backend runtime compilation
- loader lifecycle UX
- preview, doctor, observability, and rollout hardening

That made the plan harder to execute and harder to review. The immediate value is in
making boring-ui's current host app genuinely shadcn-native while keeping boring-ui's
existing visual tokens and package shape intact.

The runtime-panel pipeline remains valuable, but it should follow a cleaner host
component system instead of being developed in parallel with it.

---

## Locked Decisions

1. Phase 1 stays in the current repo/package shape.
2. Phase 1 uses the repo's existing npm workflow, not pnpm-specific commands.
3. Phase 1 does not introduce `packages/ui` or `packages/sdk`.
4. Phase 1 does not introduce a backend panel compiler, queue worker, preview harness,
   panel doctor, or runtime manifest engine.
5. boring-ui design tokens remain the visual source of truth.
6. shadcn/ui becomes the host app's primitive vocabulary.
7. Later runtime work should assume `react`, `react/jsx-runtime`, `react-dom`, and
   `@boring/ui` are the intended host-provided imports. The implementation for that
   comes later, but the direction is fixed now so the host migration does not paint us
   into a corner.

---

## Phase Overview

### Phase 1: Make The Current Host App Truly Shadcn-Native

Mission:

- clean up the current host style system
- migrate generic primitives onto shadcn-native components
- preserve boring-ui tokens and user flows
- publish a root-package CSS/import contract that later phases can build on

This is the only active phase.

### Phase 2: Prepare Runtime Seams Without Building The Compiler

Mission:

- define the minimal runtime import and metadata contract
- add stable host shim boundaries
- make the runtime styling assumptions explicit
- keep the route open for backend-served panel bundles

This phase is design and seam work, not infrastructure work.

### Phase 3: Ship The Smallest Viable Runtime Compilation Path

Mission:

- discover panel entries
- compile them to ESM on the backend
- cache artifacts by content hash
- serve visible compile/load errors

This phase deliberately starts without the queue-based long-lived worker architecture.

### Phase 4: Runtime Hardening And Externalization

Mission:

- richer SDK surface
- compatibility negotiation and diagnostics hardening
- preview/doctor tooling
- observability and performance gates
- child-app consumption hardening
- optional package extraction if Phase 1 and Phase 3 prove the need

---

## Phase 1 Scope

### Goals

1. Replace the current host app's generic primitive layer with shadcn-native components.
2. Keep boring-ui's design tokens, theme semantics, and visual identity.
3. Keep the current single-package repo and current root library build intact.
4. Publish a stable root-package CSS contract that later runtime and child-app work can
   consume without depending on host-private styling accidents.
5. Reduce generic CSS entropy without redesigning DockView, editor, terminal, chat, or
   other domain-specific surfaces.

### Non-Goals

- no workspace split
- no `@boring/sdk`
- no backend panel bundler
- no queue-based Node worker
- no runtime manifest/status compatibility engine
- no child-app canary or release hardening yet
- no attempt to flatten every custom surface into shadcn

### Workstreams

#### 1. Inventory And Baselines

- capture the existing generic primitive surface
- record visual baselines for the important host flows
- keep the migration grounded in before/after evidence instead of taste

#### 2. Tooling And Bootstrap Cleanup

- pin the approved Tailwind, shadcn, and adjacent tooling versions
- use npm-compatible commands and checked-in config
- keep initialization deterministic and non-interactive

#### 3. Root-Package CSS Contract

- define the public CSS entrypoints from the current package shape
- keep token ownership explicit
- make the host's compiled shared UI CSS load path clear

Minimum contract for Phase 1:

- `boring-ui/style.css` remains valid
- shared primitive styles are imported once by the host
- later runtime panels are expected to rely on host-loaded shared UI CSS rather than
  self-importing arbitrary CSS

#### 4. Shadcn Foundation In The Current Source Tree

- add `cn()`
- add shadcn component primitives under the existing frontend source tree
- bridge shadcn semantic variables to boring-ui tokens
- prefer thin boring-specific wrappers only where repeated boring-ui behavior justifies
  them

#### 5. Host Primitive Migration

Migration order:

1. buttons and badges
2. dialogs, dropdowns, and menus
3. inputs, textareas, and related form primitives
4. tooltips, avatars, tabs, separators, and low-risk ergonomics

Rules:

- preserve accessibility and current user flows
- leave DockView shell, TipTap, xterm, diff viewer, and chat surfaces alone unless a
  generic primitive is being swapped underneath them
- retire legacy CSS gradually after the new primitive path is proven

#### 6. Guardrails And Regression Coverage

- add focused unit and integration coverage around migrated primitives
- keep visual regression coverage for the most important host flows
- add simple lint or search-based guardrails to stop obvious retired primitive patterns
  from creeping back in

### Phase 1 Exit Criteria

- the host app builds and runs with the current root package shape
- generic host primitives are primarily shadcn-native
- boring-ui tokens still drive the visual system
- shared primitive styling is available through a documented root-package CSS contract
- legacy primitive CSS has been reduced and any remaining pieces are intentional
- runtime follow-on work has an explicit documented seam instead of needing to infer one

---

## Phase 2 Scope

Phase 2 exists to prepare runtime panels without dragging compiler complexity into Phase 1.

### Deliverables

- minimal runtime metadata contract:
  - `id`
  - `title`
  - `entry`
  - `placement`
  - `icon`
- stable host runtime shim plan for:
  - `react`
  - `react/jsx-runtime`
  - `react-dom`
  - `@boring/ui`
- explicit runtime styling rule:
  - runtime panels rely on host-loaded shared UI CSS
  - arbitrary CSS imports remain unsupported initially
- loader boundary update from raw `@workspace` source-path assumptions to backend-owned
  metadata and module URLs

### Non-Goals

- no compiler worker
- no preview harness
- no compatibility engine
- no large manifest schema

---

## Phase 3 Scope

Build the smallest viable backend runtime compilation path.

### Deliverables

- backend discovery of panel entrypoints
- backend compilation to browser-loadable ESM
- content-hash cache for artifacts
- visible compile diagnostics
- visible load failure states
- dev/prod parity for the basic runtime path

### Explicitly Deferred

- queue-based fair scheduling
- warm-context pooling
- worker heartbeat and auto-restart
- full artifact lifecycle and observability program
- advanced lifecycle policies such as prefetch, suspend, and dispose semantics

---

## Phase 4 Scope

Only after the earlier phases prove out:

- richer runtime SDK
- generated schemas and compatibility negotiation
- preview/doctor tooling
- observability and performance budgets
- child-app canary adoption
- package extraction only if the simpler root-package strategy is no longer enough

---

## Bead Alignment

The bead set should mirror this phased plan.

Active now:

- Phase 1 baselines, tooling, CSS contract, host migration, and Phase 1 regression work

Deferred until later:

- runtime compiler/worker
- runtime contracts beyond the minimal seam
- runtime SDK/provider work
- preview/doctor/observability rollout work
- child-app canary and external package hardening

---

## Suggested Commit Strategy

Do not treat this as one long mixed branch. Land it in small Phase 1 slices:

1. baselines and migration inventory
2. tooling and checked-in shadcn bootstrap
3. root-package CSS contract
4. shadcn primitives in the current source tree
5. host primitive migration in batches
6. legacy CSS retirement and guardrails

Later phases should get their own planning and review sequence after Phase 1 is stable.
