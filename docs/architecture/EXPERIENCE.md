# Experiences, cells and generated layout

Status: partial implementation. Reference layouts now have a native json-render catalog, strict validator, React renderer, conditional Keep document controller and bounded metadata-only composition through the upstream composer. Bounded generated regions and conditional Pin now reuse that controller. Live evaluator qualification, full application action routing and actual browser journeys remain pending. The [UI guide](../../packages/ui/README.md#optional-fixed-and-derived-experiences) defines the implemented subset and evidence limits. [SPEC.md](SPEC.md) owns authority, state ownership and packages; this document owns the experience model and its laws. Contract shapes are in [CONTRACTS.md](../contracts/CONTRACTS.md#experiences-cells-and-composition); journeys A25–A32 are in [ACCEPTANCE.md](../acceptance/ACCEPTANCE.md).

## Two nouns

- **Cell**, owned by the application: one registered kind at a version (a host-bundled React component with its props schema, slots and events) bound to the application's data and its named actions. It is a json-render-compatible element `{ type, props, on?, visible? }` whose props hold `$state`/`$bindState` bindings into the application's namespace, never values. For composition it is a *candidate*: `id`, `description`, `root?`, `maxUses?`, `resource?` and the enumerated metadata the application declares (for example `time-bound`, `needs-decision`). An application exposes cells through registration (shared descriptor, browser renderer, server reads and operations, as for any custom feature in SPEC).
- **Experience**, owned by whoever arranges it: a descriptor holding a json-render spec `{ root, elements }` over cell references and layout primitives. It holds no data and grants nothing. Three sources produce the same descriptor type and pass through one validator and one renderer:
  - **fixed**: a versioned resource of the application or of a host scope (for example `experience/<name>.json` in a folder application). Reads name their revision; saves are conditional writes.
  - **derived**: deterministic host rules select or adjust a fixed descriptor from a subject's phase or state (a consultation before, during and after the visit). No model call.
  - **generated**: composed live from candidates by an injected evaluator.

  "Keep this layout" saves a generated or derived descriptor as a fixed one: an admitted conditional write that creates a new revision with its receipt. A later composition never overwrites a kept descriptor; it proposes a new draft.

## Generated regions

An application can make only part of an experience generated. A fixed descriptor may contain `boring/generated` elements: everything outside them is fixed; their children are composed live.

| Prop | Meaning |
| --- | --- |
| `region` | Stable region name inside the descriptor. |
| `candidates` | Allowlist of cell ids or registered kinds the region may place. Nothing else is offered to the evaluator. |
| `maxElements`, `kinds`, `minWidth` | Bounds: element budget, permitted kinds, the narrowest width a placed cell may get. |
| `regenerate` | Triggers among `open` (the experience is opened), `phase` (the bound subject's phase changed), `request` (the person or the companion asked). No timer exists. |
| `prompt` | Static composition guidance written by the application (references, never record content). |
| children in the descriptor | The **default** arrangement: rendered at once, kept while composition runs, restored when it fails, is refused or is unavailable. |

Regeneration replaces the region's subtree only. A `phase` trigger while the region is on screen is offered ("a new arrangement is ready"), not applied, until the person accepts it or reopens the experience: a region never changes on its own while the person is reading. **Pin** saves the region's current result as its new default children through the same conditional write as keep-this-layout, against the descriptor revision that was read.

## Composition

Composition is a host operation on the server: authenticated, admitted for this person and scope, budgeted, cancellable, and never durable execution. It uses json-render's experimental composer (`experimental_composeSpec`) over the installed catalog and an evaluator the host injects:

| Evaluator | Meaning |
| --- | --- |
| `jev` | Jev over Vercel AI Gateway (`experimental_createEvaluator({ model: "typesafe-ai/jev", apiKey })`) or TypeSafe's own endpoint (the same `{ state, questions }` body plus `model`). The key is a host credential, server-only; usage is reported to the host. An external processor: allowed only where host policy allows sending composition metadata to it. |
| `local` | The host's own model through the fail-closed model adapter: each evaluation is an admitted provider attempt with scope/attempt identity and budget, like any generation. |
| `fake` | Deterministic choices for tests and driven journeys. |

All three answer json-render's choice-evaluation request (questions with offered criteria, answers that must be one of them); composeSpec refuses any other choice. Swapping evaluators changes latency and judgment, never validity rules or authority.

**Strip before compose.** The host builds candidates from cell metadata only: id, description, kind, `root`/`maxUses`/`resource` and enumerated metadata. Props, bindings, state paths, action parameters and state values never enter composition; each candidate carries an opaque marker instead of its props, and after composition the marker is rebound to a cell reference. Values are resolved after composition, per viewer, through the host's authorized reads when the descriptor is rendered. json-render already withholds raw props and state from the evaluator, but it copies `initialState` into the returned spec ([probe](../stress-tests/BASELINE.md#json-render-composition--executed-passed)): composing with values would put them in a descriptor that can be kept, shared or logged.

**Validation.** A composed, derived or loaded descriptor is accepted only if every element's type is an installed kind at a compatible version, every element's props validate against that kind's schema (json-render's spec `validate` checks types but not per-element props, so the host checks them), every action is a named installed action, depth and element bounds hold, and every cell reference is visible to this person now. Visibility is checked again at render; a reference the person cannot see renders as unavailable, never as substitute content.

**Streaming.** Detached partial specs are untrusted candidate data. Validate installed kinds, props, actions, visibility and bounds before any partial or final display. Valid partials may be shown in a separate provisional preview; keep the current/default live layout until safe adoption. Final validation remains mandatory. A sequence/cancellation result describes composition, not native execution termination. On disconnect or failure keep the default/current view and report the reason.

Preserving fixed JSON is not enough: adoption must preserve focused controls, selected text and dirty controller instances. Offer layout replacement at a safe interaction boundary or request acceptance; never remount an unsaved editor merely because the tree shape changed. Fixed/derived experiences ship before generated regions; optional model composition remains in full scope, not a prerequisite for basic viewers.


## State and actions

- **State is host resources and operations, not client state.** A binding path resolves to a host resource or read operation with its revision (per-application namespaces `/apps/<app>/…` where several applications meet; the application's own paths otherwise). json-render's in-page state store is a presentation cache filled from authorized snapshots. A `$bindState` edit is a dirty local buffer until saved through that resource's conditional write; a stale save is a conflict that keeps the buffer (SPEC, files and resources).
- **Actions go through the admitted operation dispatcher.** Durable actions (start a task, submit an application operation, save a bound value, send, accept) dispatch to the owning application's admitted operations, with permission checked at call time and the provider's receipt shown as the result. The owning application is the cell's, assigned by the host; an action parameter cannot name another application. Page-local actions (open, focus, scroll, expand, select, local presentation state) stay presentation commands and touch no backend.
- **A cell behaves identically in every experience**: the same kind and version renderer, the same bindings, the same actions and the same permission checks, whether it sits in its application's fixed page, a generated region or a mixed layout. The experience only positions it.

## Mixing applications is the host's concern

A host that serves several applications (the hub's workroom) may compose over cells from several applications the person can use. The host collects visible cells, namespaces ids and state per application, sends the evaluator references and metadata, never content, and routes each durable action to its own cell's application. The library offers composition and rendering; which applications meet, who may see the result and where a mixed layout is kept (the person's own scope, not one application's) are host decisions. This is not cross-application invocation: no application reads another's data or acts for it.

## Privacy rule

The evaluator receives counts, kinds, enumerated flags and application-authored static descriptions. It never receives record content: no names, bodies, subjects, diagnoses, values, dates of a person's events or free text derived from them. Metadata is enumerated by the application's registration (for example `acute`, `decision-today`, `above-target`, `up-to-date`) and computed by the host from validated records, not written by a model into the description. For clinical data a description names a structural slot ("problem card, acute, decision today"), not the condition; an external evaluator (`jev`) is used only where the host's processing policy covers composition metadata, and `local` is the default. Privacy checks cover every evaluator field, including user guidance, descriptions, URLs/identifiers, errors and cached prompts. Raw user request text is not an exception to metadata-only external processing: derive approved non-sensitive layout intent in the data-owning/trusted context or refuse that route. Even enumerated flags can be sensitive and require the host processing policy. Default local processing does not waive input authorization or retention rules.

## Package placement and dependencies

Inside optional @hachej/boring-ui-kit subpaths: experience renders trusted installed kinds using React/json-render; experience/compose performs server-safe stripping, rebinding, validation and optional composition without React. Neither imports an agent facade or puts provider credentials in browser code. The root headless package stays independent.

Prefer the upstream public choice-evaluator contract where available; otherwise keep the minimal required contract local to this optional composition feature. The host injects its evaluator/model adapter, including native Pi/provider admission as applicable. No mandatory evaluator export from @hachej/boring-agent and no UI-to-agent wire type dependency. jev/local/fake describe selectable host integrations, not three new engines. Use existing native tasks only when the host intentionally runs composition inside native work; the layout feature owns no execution scheduler.

Retained research pins: @json-render/core@0.21.0, @json-render/react@0.21.0 and zod@4.6.5; json-render source vercel-labs/json-render@fc2a696a50a30cb30c878ab1eb65e102487eea0f. These exact packages are now optional UI peers for fixed/derived validation and rendering. The experimental source pin remains required for later composition. Feasibility evidence does not qualify the complete runtime. Select exact tested versions through ARCHITECTURE.json and actual probes before implementation; no dependency changes are authorized by this document edit alone. Credentials and local-only/native integration code remain on the host side.

**Catalog and recipe.** The starting catalog is the v3 registry ([`hachej/boring-ui-v3` registry at `d1eaa2584d38e74c7dbce47ae6ae22b3436690d8`](https://github.com/hachej/boring-ui-v3/tree/d1eaa2584d38e74c7dbce47ae6ae22b3436690d8/registry)) restyled to the host's tokens, plus kinds it lacks: card, metric with trend, checklist, timeline, table, document (Markdown), form, chat, image, file list, button, and the layout primitives stack, columns and section, with the `boring/generated` region and the `boring/cell` reference. Each kind ships as a shadcn-compatible source recipe (host-owned renderer source, CSS variables, slots); validation, binding, dispatch and composition stay in the package. `@json-render/shadcn` is a design reference, not a runtime dependency (it brings Tailwind and Radix peers). An application adds its own components by registering kind, version, props schema, renderer and actions: registration makes them candidates, so the generated layer comes with no extra work. Registration still grants nothing.

## Reference examples

**The clinic preparation page** is the first consumer and the motivating example; [REDACTION.md](../stress-tests/REDACTION.md#preparation-page-as-the-first-experience-consumer) states its current state and what it needs. Fixed: the header, the synthesis, the notes editor, the action bar and the schedule. Generated: the clinical cards region, composed from the preparation task's typed cell output and its metadata (`acute`, `decision-today`, `above-target`, `up-to-date`).

**A generated morning todo.** "A job reads all my email, another reads my calendar; I start my day and get today's todo generated on the fly with the visuals needed."

- An email task emits typed cells: `needs-reply` (sender, deadline and a suggested reply bound to the draft resource), `waiting-on`, `fyi`, with metadata `time-bound`, `needs-decision`, `blocking-someone`, `low-priority`. A calendar task emits event cells (`travel`, `conflict`, `preparation`). A merge task emits a `todo` cell whose items link to their source cells. Tasks run on a schedule or when the experience opens; each publishes through durable delivery (SPEC, structured work).
- The `morning` experience is a fixed shell (header, companion) with one generated region over those cells. With metadata only (counts, kinds, flags) the evaluator arranges a day timeline, the todo checklist, a card with the draft reply and Send/Snooze for each urgent mail, and one conflict card with its options. A quiet day collapses to the timeline and a short list.
- Send is the email application's admitted send operation; accepting a slot is the calendar's; each checks the person's permission at call time and returns its receipt. Ticking a todo item is a conditional write to the todo resource. The companion acts on visible cells through the same operations ("move my 15:00 and tell the attendees" becomes a calendar operation and a send, each with its decision when the host requires one).
- The composer sees "4 needs-reply, 2 time-bound, 1 conflict", never a body, subject or attendee.
- Outside v4's scope: mail and calendar adapters, scheduled tasks and the host that runs them (the hub). v4 supplies cells, composition, rendering and the operation path.

## Laws

Proposed, owned here. Implementation moves them to the owning package's `INVARIANTS.md` with `VERIFY.json` entries, keeping these IDs. Until then each is a deferral naming its journey.

| ID | Law | Evidence (deferred) |
| --- | --- | --- |
| EXPERIENCE-1 | An experience never grants authority. Arranging, generating, keeping or pinning a descriptor changes what is shown, never what a person may read or do (SPEC: registration and UI never grant). | A26, A30 |
| EXPERIENCE-2 | Fixed, derived and generated experiences are one descriptor type through one validator and one renderer. A fixed experience renders the same embedded in a host as in its own application. | A25 |
| EXPERIENCE-3 | A descriptor is accepted only when every element is an installed kind at a compatible version with schema-valid props, every action is named and installed, bounds hold, and every cell reference is visible to the viewer, checked at composition and again at render. | A26 |
| EXPERIENCE-4 | Durable actions route to the owning application's admitted operations with permission checked at call time and a receipt as the result; only page-local presentation actions stay in the page. The owner is the cell's application, never an action parameter. | A30, A32 |
| EXPERIENCE-5 | Composition receives cell metadata only. Props, bindings, state paths, action parameters and values never reach an evaluator or a descriptor; bindings are resolved after composition, per viewer. | A27, A32 |
| EXPERIENCE-6 | Every displayed partial/final snapshot first passes kind/props/action/visibility/bounds checks, renders and never acts. Live adoption preserves focus/dirty controllers; composition ends in a validated descriptor or default/current view with its reason; disconnect cancels composition, not unrelated native work. | A26, A31 |
| EXPERIENCE-7 | A generated region places only its allowlisted cells within its bounds. Regeneration changes only the region's subtree: the fixed parts of the descriptor are byte-identical. It regenerates only on its declared triggers and never changes unasked while on screen; the default is shown before and instead of a failed composition. Strip-before-compose applies per region. | A29 |
| EXPERIENCE-8 | Keep-this-layout and pin are conditional writes of a fixed descriptor at the revision read, each a new revision with a receipt. A composition never overwrites a kept or pinned descriptor. | A28, A29 |
| CELL-1 | A cell is a registered kind at a version with a props schema, slots, events and named actions. Unknown kinds, incompatible versions and namespace collisions are refused. | A26 |
| CELL-2 | A cell behaves identically in every experience: same renderer, bindings, actions and permission checks. | A25, A30 |
| CELL-3 | A cell's state is host resources and operations with revisions. A bound edit is a local buffer until a conditional save; a stale save is a conflict that keeps the buffer. | A28, A30 |
| CELL-4 | Cell metadata is enumerated by registration and computed by the host from validated records; it carries no record content. External evaluators receive it only under host policy. | A27, redaction journey 11 |

## Upstream and status

json-render ([vercel-labs/json-render](https://github.com/vercel-labs/json-render), Apache-2.0; [docs](https://json-render.dev/docs), [Jev guide](https://json-render.dev/docs/jev)) supplies the catalog with Zod props, the flat spec, `$state`/`$bindState`/`visible`, named actions and `emit`, `<Renderer spec registry>` and streamed specs. `experimental_composeSpec` and `experimental_createEvaluator` are experimental: names and behavior may change in any release, and the package version alone does not identify the experimental revision, so the first implementation pins both the package version and the source commit above. The composer's batched strategy sends candidate ids and descriptions in the selection call and element types with descriptions in the layout call (`packages/core/src/experimental-composition-batch.ts` at the pinned commit). A practitioner walkthrough of composeSpec with Jev is [azukiazusa's article](https://azukiazusa.dev/en/blog/json-render-jev/).

Historical baseline evidence includes one deterministic probe of the published 0.21.0 build ([BASELINE.md](../stress-tests/BASELINE.md#json-render-composition--executed-passed)), and a live Jev run on invented metadata-only candidates, 3 runs of each reference example ([BASELINE.md](../stress-tests/BASELINE.md#jev-live-composition-a31-real-model-level--executed-passed)). In the live run every composed spec was valid, compositions took about 0.5 s, and membership was consistent; ordering and layout primitives were not, so hosts prune empty containers and order by metadata where order matters. At that baseline, the `local` evaluator and a Boring catalog, renderer or host had not been run. The current fixed/derived catalog and renderer now have public runtime, DOM and isolated consumer tests, recorded in the [implementation checkpoint](../implementation/PARTIAL.md). The current composer also has deterministic native-evaluator and fictional Gateway-transport tests. Live local/Jev evaluation, real host integration and browser qualification remain pending. Historical live-model evidence is not qualification of this implementation.
