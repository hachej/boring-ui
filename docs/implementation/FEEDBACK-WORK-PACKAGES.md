# Feedback: implementation sequence and work packages

This document is the delivery breakdown of
[FEEDBACK.md](../architecture/FEEDBACK.md), which owns the design and laws
FEEDBACK-1..8. Nothing here restates a decision.

- **Release 1 (WP0–WP9): application pages.** Fully specified.
- **Release 1b (HTML artifacts) and later work (WP10–WP18)** are outlines.
  Each says what must be answered, and by which spike, before it is specified.
- **WP19** is consumer work in other repositories.
- **Base revision:** `main` at `82d410c`. A package that starts on a later
  `main` names its own base.

Every package follows `AGENTS.md`:

- an isolated worktree;
- the owned files and allowed `ARCHITECTURE.json` edges named below, and only
  those;
- behavior lands with tests, a driven control or journey, and a
  [FEATURES.md](FEATURES.md) row;
- evidence stays under `.cache/evidence/`, with fictional fixtures only;
- `npm run check`, `npm test` and `npm run verify` pass before and after;
- runtime proofs a package does not discharge stay pending. Structural
  evidence is never relabelled as runtime proof, and the six root deferrals
  are untouched.

## Spike results so far (2026-10-05, throwaway prototypes, re-checked)

**WP3 masking, on the fictional Northwind Console** (independent count in Chromium):

| Marked visible | Text hidden | Buttons and links with a readable name |
| --- | --- | --- |
| Nothing (default) | 100% | 0 of 14 |
| Headings, labels, buttons, nav | 74% | 8 of 14 |
| The whole `main` region | 11% | 5 of 14 |

- No unexpected canary leaks.
- Guidance: applications mark **whole regions that hold no personal data**
  (application chrome, settings areas) visible, and leave data regions
  masked. Marking individual widgets is not enough.
- Suggestions to show textarea, contenteditable or placeholder text inside
  visible regions are rejected: they stay masked.
- WP3 still runs its own spike and the canary kit, including the document
  title.

**WP8 source locations:**

- esbuild with `jsxDev: true` passes project-relative `fileName` and line to
  the JSX dev runtime. A small wrapper runtime that adds `data-source` to
  intrinsic elements works with no added dependency. Rows from `.map` share
  one location, and production builds carry none.
- The wrapper must not use `process` (it runs in the browser) and must refuse
  absolute paths.
- For Vite with the React plugin, a small Babel plugin is the equivalent
  (verified in Node, not yet in Vite).
- Both were checked by server rendering only. WP8 adds the browser check.

## Release 1 sequence

**Release 1 status (2026-10-05, WP9):**

- **Landed:** WP0–WP9. The `examples/feedback` builder agent runs the feedback
  capability on a keyless scripted model; the Chromium journey
  `npm run feedback:journey:e2e` passes twice in a row.
- **Runtime slots discharged:** FEEDBACK-3, 5 and 7, by
  `test/contracts/feedback-3.test.mjs`, `feedback-5.test.mjs` and
  `feedback-7.test.mjs` on the composed example.
- **Still pending:** FEEDBACK-1 (shell, Git and alias protection),
  FEEDBACK-2 (model-judged readability, not run), FEEDBACK-4 (other kinds),
  FEEDBACK-6 (late completions, resource observations) and FEEDBACK-8
  (recorder channels, retention). Each reason in `VERIFY.json` names what WP9
  proved. The journey is manual evidence, not a gate.
- **UX revised (after Release 1):** one entry point, **Feedback** in the chat
  composer, replaces Point, the annotate sheet, the Feedback list and Show
  ([FEEDBACK.md, "UX"](../architecture/FEEDBACK.md#ux-one-entry-point-feedback)).
  `feedback@1` gained optional `## Notes` and `## Steps`. The Chromium journey
  is `npm run feedback:journey` (`journey-composer.mjs`); the Release 1
  journeys run the classic surfaces with `?ui=classic`
  (`feedback:journey:picker`, `feedback:journey:e2e`). Voice capture is a stub
  until the voice package merges.
- **Adoption step A:** `npm run feedback:scenario` checks annotation only
  (point, note, Copy report) in an application outside the monorepo, installed
  from packed tarballs. It also runs against a real app. See
  [FEEDBACK-SCENARIO.md](FEEDBACK-SCENARIO.md).

```
WP0 contracts + verifier ─┬─ WP1 format ── WP4 store ─────────────────────────────┐
                          ├─ WP2 anchor kit ─────────────┐                        │
                          ├─ WP3 privacy policy + serializer ─ WP5 app.element pins ─ WP6 picker + annotate UI ─ WP7 agent tool ─ WP9 qualification
                          └─ WP8 source-location transform (optional signal) ──────────────────────────────────────────┘
```

| Package | Starts after | Notes |
| --- | --- | --- |
| WP1, WP2, WP3, WP8 | WP0 | Run in parallel |
| WP4 | WP1 | — |
| WP5 | WP2 and WP3 | — |
| WP6 | WP5; WP4 for Save | — |
| WP7 | WP4 and WP6 | — |
| WP9 | WP7 | Uses WP8 if it has landed; Release 1 does not wait for WP8 |

**One integrating owner per cross-package contract:**

| Contract | Owner |
| --- | --- |
| Anchor types and package-owned laws in the verifier | WP0 |
| `feedback@1` | WP1 |
| The privacy policy and `app.dom@1` | WP3 |
| Store interface (one file per report) | WP4 |

Later packages propose changes to an owner's contract; they never edit it in
place.

---

## WP0 · Contracts, package and verifier

**Goal:** shapes, edges and law registration, with no feedback behavior.

**Owns:**

- package-law support in `scripts/check-pi-boundary.mjs` and
  `scripts/pi-policy.mjs`, with their tests;
- `VERIFY.json`, `ARCHITECTURE.json` and `docs/LAWS.md`;
- `packages/feedback/` (`package.json`, `INVARIANTS.md`, typed entry points
  `./format`, `./store`, `./agent`, `./page`, `./ui` and `./source`);
- the anchor section of `packages/ui/src/contracts.ts`;
- the `@hachej/boring-ui-kit/anchor-conformance` entry declaration;
- `scripts/test-feedback-consumer.mjs`.

**Spec:**

1. **Package-owned laws in the verifier.** Today `loadBoundary` recognizes
   only `## BORING-PI-n —` headings in the root `INVARIANTS.md` and requires
   exact agreement with `VERIFY.json` and `ARCHITECTURE.json.runtimeProofs`.
   - Add `VERIFY.json.packageLaws`: `[{ "owner": "packages/feedback/INVARIANTS.md", "prefix": "FEEDBACK", "package": "feedback" }]`.
   - Collect `## <PREFIX>-n —` headings from each owner and apply the same
     rules: an index row, valid applicability, exactly one runtime slot equal
     to `runtimeProofs[ID]`, and well-formed verifiers.
   - The duplicate-definition scan covers every registered prefix.
   - The root rule is unchanged. The mechanism is written once, so EXPERIENCE
     and CELL laws can use it later.
2. **The laws.** `packages/feedback/INVARIANTS.md` defines FEEDBACK-1..8 with
   FEEDBACK.md's wording, and FEEDBACK.md then links to it.
   - Each law gets structural verifiers where WP0 can run them, and one
     runtime slot, `test/contracts/feedback-<n>.test.mjs`, registered
     `pending` with a reason naming the discharging package.
   - `docs/LAWS.md` gets eight rows.
3. **`ARCHITECTURE.json` `packages.feedback`.**
   - `dependsOn`: `ui`, `files` and `agent`, with `runtimePackageImports`
     limited per subpath (`@hachej/boring-files/platform` for `./store` and `./page`;
     `@hachej/boring-agent` entries for `./agent` only).
   - `typeOnlyDependsOn`: `ui` and `files`.
   - Exact pins for the Pi peers.
   - `./source` is declared development-only: excluded from every browser
     bundle, with its build dependency added only by WP8.
4. **In `@hachej/boring-ui-kit/contracts`:** the type-only `Anchor`, `Placement<Range>`,
   `AnchorResolution`, `AnchorCapture` and `ViewerAnchors`.
   - Function members are `readonly` properties.
   - `ViewerFeature` gains no required member.
5. **Entry points export types only** in WP0. No runtime placeholders.

**Invariants:**

- The six root deferrals are byte-identical before and after.
- No existing package depends on `feedback`.
- The `./page`, `./ui` and `./format` browser bundles contain no `node:`
  module, no Pi runtime, and no `./store`, `./agent` or `./source` code.

**Tests:**

- verifier mutants, each of which must fail:
  - a FEEDBACK law missing its index row;
  - a missing runtime slot;
  - a law defined twice across owners;
  - an unknown prefix owner;
  - a changed root entry;
- the existing verifier tests still pass;
- an isolated tarball consumer type-checks each entry;
- bundle checks;
- a boundary mutant: `packages/ui` importing `@hachej/boring-feedback` must fail.

**Done when:** check, test and verify pass, with eight FEEDBACK runtime slots
pending and the root deferrals unchanged.

## WP1 · `feedback@1`

- **Depends on:** WP0.
- **Owns:** `packages/feedback/src/format/*`, and
  `test/packages/feedback.test.mjs` (the package's required test entry,
  importing `@hachej/boring-feedback/format`).

**Spec:**

- **Parse and serialize.**
  - `parseFeedback(bytes) → { ok: true, report } | { ok: false, problems }`.
  - `serializeFeedback(report) → Uint8Array`, canonical: fixed key order,
    two-space JSON, LF.
- **The parser:**
  - a strict JSON scanner that refuses duplicate keys;
  - the limits and depth 8 of FEEDBACK.md;
  - `format === "feedback@1"`;
  - the preface, then `## Said` and `## Resolution`.
- **Types:**
  - `observed` is a discriminated union. `host` has `subject` (type, app,
    route, build?), `snapshot`, `digest` and `policy`. `resource` has
    `locator` (the real shape), `base`, `dirty`, `snapshot` and `digest`.
  - Unknown observed kinds are preserved as JSON values.
  - Anchors are `{ kind, fallback, ...data }`. `kind` matches
    `^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*@[1-9][0-9]*$`, and `fallback` is
    non-empty.
  - Unknown kinds and `x-` fields are preserved.
- **Rendering.**
  - `renderReport({ said, resolutions })` escapes captured strings: a leading
    `#`, `---`, backticks, link and image syntax, and HTML.
  - `titleOf` returns the first line of `## Said`, at most 80 characters.
- **Builders.** `createRequest` and `resolveRequest` return a single-file
  `PublicationRequest` (`packages/files/src/contracts.ts`) for the report.
  Report creation uses `expected: absent`. There is no index (revised
  2026-10-06: one place for files); `listItemOf` derives a list item from a
  report, with its subject key from `subjectKeyOf(observed)`.

**Invariants:** FEEDBACK-1 (the only serializer), FEEDBACK-2 (sections and
fallbacks), FEEDBACK-3 (semantic preservation), FEEDBACK-7 (escaping and the
preface).

**Tests:**

- round-trip property tests and canonical bytes;
- refusals: duplicate keys, limits, depth, missing sections, empty fallbacks,
  a forged author;
- injection fixtures (heading, fence, link);
- unknown anchor and observed kinds preserved;
- builder shapes checked against the files contracts.

**Done when:** the FEEDBACK-1, 2, 3 and 7 structural verifiers point here and
pass.

## WP2 · Anchor conformance kit

- **Depends on:** WP0.
- **Owns:**
  - `packages/ui/src/anchor-conformance.ts`;
  - `test/fixtures/anchors/synthetic/`;
  - `test/packages/ui-anchor-conformance.test.mjs`.

**Spec:**

- `runAnchorConformance({ resolution, cases }) → { results, wrongSpots, rates }`.
  It imports no test runner.
- **A case** is `{ name, capture: { snapshot, anchor }, steps: [{ name, snapshot, evaluated, expect }] }`.
  - Every step carries its own full snapshot.
  - `expect` is one of:
    - `exact` or `moved` with a required `range`;
    - `ambiguous` with the complete candidate set;
    - `missing`;
    - `unsupported`.
- **A wrong spot is:**
  - an `exact` or `moved` result with a different range;
  - an `exact` or `moved` result where `ambiguous` or `missing` was expected;
  - a candidate outside the expected set.

  Any wrong spot fails the case.
- **Other checks:**
  - determinism: three calls must deep-equal;
  - trapped `fetch`, timers, `Date.now`, `Math.random` and `performance.now`.
    This bounds the purity claim; it does not prove it;
  - schema round-trip;
  - a non-empty fallback.
- **Rates** are reported per case group without a threshold. The verdict is
  "zero wrong spots for the named corpus".
- **A synthetic adapter,** `test.line@1`.
- **Required groups:** move, duplicate, delete, a deletion followed by similar
  content, reused identity, and an unknown kind.

**Tests:**

- the synthetic adapter passes;
- mutants: a nearest-candidate guesser and a `Date.now()` reader must fail.

**Done when:** both mutants fail readably and the synthetic adapter passes.

## WP3 · Privacy policy, `app.dom@1` serializer and canary kit — spike first

**Goal:** nothing private leaves the page by default, and that is proven
before any picker ships.

- **Depends on:** WP0.
- **Owns:**
  - `packages/feedback/src/page/privacy/*` (the policy and serializer);
  - `packages/feedback/src/page/canaries.ts` (`runPrivacyCanaries`);
  - `test/fixtures/privacy/` (fictional pages);
  - `test/packages/feedback-privacy.test.mjs`.

**Spike (time-boxed):**

- Apply the default policy of FEEDBACK.md to the fictional Northwind Console
  screens (`examples/ambient`) and to a fixture page dense with canaries.
- Record the false-mask rate (useful text hidden) per screen and confirm zero
  canary leaks.
- Decide which elements the example marks `data-feedback-visible` (labels,
  buttons, headings).
- The result goes to `.cache/evidence/feedback-privacy/`.

**Spec:**

- **`createPrivacyPolicy({ allowAttributes?, visibleSelector?, routeOf?, label? })`**
  returns a frozen policy with `version: 1` and a `widened` list recording
  every option that loosens the default.
- **`serializeElement(element, policy, { subtreeLimit = 50 })`** and
  **`serializePage(root, policy)`** return `app.dom@1` data. Each node is
  `{ tag, attrs (allowed only), text (masked unless visible), children, index }`.
  - Nodes marked `data-feedback-ignore`, and the picker overlay, are omitted.
  - Shadow roots are omitted unless the policy names them.
  - Form controls' values are never read.
- **`accessibleNameOf(element, policy)`** computes a name only from allowed
  sources: visible text, and `aria-label` only inside a visible region. It
  returns `masked` otherwise.
- **`routeFor(location, policy)`** uses `routeOf` when supplied. Otherwise it
  masks each path segment and never includes the query or fragment.
- **`runPrivacyCanaries({ page, canaries, run })`.**
  - It plants canaries in text, `id`, `class`, `title`, `alt`, `aria-label`,
    `aria-description`, other `data-*`, `href` path, query and fragment, form
    values and placeholders, the document title and route segments, plus
    HTML-entity and percent-encoded variants.
  - It runs the caller's real path (WP6 passes the picker, sheet and Copy).
  - It scans every output string, case-insensitively after decoding.
  - A hit fails, naming the channel.
- The overlay label text comes from the same policy.

**Invariants:** FEEDBACK-8 (allowlist in the browser; widenings recorded).

**Tests:**

- unit tests per channel;
- mutants: an attribute missing from the allowlist must stay dropped; an
  element outside a visible region must stay masked; a deliberately widened
  canary must fail the kit, and the widening must appear in `widened`;
- serializer determinism.

**Done when:** the spike is recorded, the kit and its mutants behave, and the
policy is frozen at version 1.

## WP4 · Store

- **Depends on:** WP1.
- **Owns:**
  - `packages/feedback/src/store/*`;
  - `test/packages/feedback-store.test.mjs`;
  - `test/contracts/feedback-store-crash.test.mjs`.

**Spec:**

- **Construction:**
  `createFeedbackStore({ providerId, view, reader, publisher, lookup, listFolder, capabilities, root, operationNamespace, resolveAccess, authorizeSubject, displayName, protection })`,
  with the resource contracts injected as they are defined in
  `packages/files/src/contracts.ts` (in practice the workspace provider of
  `@hachej/boring-files/workspace`) and `listFolder` listing the root folder.
  It refuses to start without `conditionalPublication`, `operationLookup` and
  `atomicMutationAndReceipt`, or without an explicit `protection`.
- **Methods.** Each takes `access`; `create` and `resolve` take an
  `operation: { id, key }`. Deletion is a host file operation (the workspace
  provider does not delete through publication).

  | Method | Behavior |
  | --- | --- |
  | `create({ observed, anchors, said }, access, operation)` | Checks `authorizeSubject(access, { key, observed }, 'annotate')`, derives the author, generates an id through `@hachej/boring-files/platform`, and publishes the report file |
  | `read(id, access)` | Read authorization from the report's subject |
  | `list({ status?, subject?, cursor? }, access)` | Reads every report in the root folder; filtered by read; pages of 50, newest first |
  | `resolve(id, { expectedRevision, note }, access, operation)` | Checks `annotate`; conditional replace of the report file |

- **Conflicts:** creators never contend (one file each). A report conflict
  returns `conflict` with the current revision.
- **Uncertain outcomes:** look up `operation.id`. A match returns the original
  result, a mismatch returns `conflict`, and `not-found` returns `unknown`. It
  never retries as fresh.
- **Listing limits:** a folder with more than 5,000 reports makes `list`
  return `unavailable`; a file that is not a valid report is not listed.
- **`feedbackMentionReader(store, resolveAccess)`** applies read authorization
  to paths under `root`.
- **`guarantees()`** returns `{ protection }`.

**Invariants:** FEEDBACK-1 (store layer), FEEDBACK-3, FEEDBACK-7 (derived
author), FEEDBACK-8 (read filtering and revocation).

**Tests:**

- concurrent creators;
- competing resolutions;
- a lost reply after commit, reconciled without a duplicate note;
- `not-found` after uncertainty returns `unknown`;
- a hard kill between commit and acknowledgement (SQLite workspace provider,
  existing crash pattern);
- the store refuses to start without capabilities or protection;
- a forged author is refused;
- a cross-scope subject is denied;
- after revocation, `list` hides the item and `read` is denied;
- the mention reader is denied for an unreadable subject;
- a native file-tool write to a protected root is refused on a fixture
  provider (shell, Git and aliases stay pending under BORING-PI-6);
- unknown kinds survive every method.

**Done when:** these tests pass on the SQLite workspace provider.

## WP5 · `app.element@1` pins

**Goal:** element anchors that are found again, or honestly not found, with
zero wrong spots.

- **Depends on:** WP2, WP3.
- **Owns:**
  - `packages/feedback/src/page/app-element.ts` (resolution: pure over
    `app.dom@1`; capture: from a picked element through the WP3 serializer);
  - `test/fixtures/anchors/app/`;
  - `test/packages/feedback-app-element.test.mjs`.

**Corpus:** fictional pages, each step a full `app.dom@1` snapshot:
reordered identical rows, duplicated buttons, removed and added ids,
wrapper elements inserted and removed, and an element replaced by a
look-alike.

**Spec:**

- **`anchorOf(element)`:**
  - collects the signals through the policy: `feedbackId`, `source` (with
    its occurrence index among same-source elements in the page), `testId`,
    `role`, `name` if allowed, and `path` from the nearest `main`, landmark
    or `feedbackId` ancestor;
  - serializes the element snapshot (at most 2 KiB);
  - records the box;
  - builds the fallback from allowed parts only, for example
    `the «Save» button (SaveBar.tsx:42)` or `a masked button in main › form`;
  - refuses elements inside `data-feedback-ignore`.
- **`resolve(anchor, pageSnapshot, evaluated)`** follows FEEDBACK.md: automatic
  placement only through a unique `data-feedback-id` or `data-testid`;
  otherwise candidates for the person to confirm. It returns node paths as
  ranges.
- **`reveal`** finds the live element for an `exact` or `moved` range. It
  checks the node still matches the snapshot at reveal time, or else returns
  `stale`. It scrolls the element into view and asks the overlay (WP6) to
  highlight it.
- **The `evaluated` string** is the page snapshot's digest.

**Invariants:**

- FEEDBACK-4 (zero wrong spots on the named corpus);
- FEEDBACK-8 (signals come only through the policy).

**Tests:**

- the WP2 kit on the corpus;
- capture refusals;
- reveal returns `stale` when the DOM changed between resolve and reveal;
- canaries via WP3 on the anchor and fallback.

**Done when:** the kit reports zero wrong spots on the corpus.

## WP6 · Picker, annotate UI and the `feedback` registry item

**Goal:** a person points at an element in an application page, types a note,
and copies or saves it, with no agent.

- **Depends on:** WP5; WP4 for Save.
- **Owns:**
  - `packages/feedback/src/page/picker/*` (overlay, pick mode, keys, touch,
    keyboard);
  - `packages/feedback/src/ui/*` (annotate state, Copy, draft operation ids,
    list and report data);
  - `registry/feedback/*` (`PointButton`, `PickerOverlay`, `AnnotateSheet`,
    `FeedbackList`, `FeedbackReport`);
  - the `registry.json` item and the registry policy updates for its
    `@hachej/boring-feedback@0.0.0` dependency;
  - `examples/feedback/`, a small standalone fictional application with
    AmbientChat, the store route, the picker and the visibility marks.
  - `test/packages/feedback-picker.test.mjs` and
    `test/packages/feedback-ui.test.mjs`.

**Spec:**

- **Pick mode**, as in FEEDBACK.md (events captured and stopped while picking;
  only the application's own DOM is pickable):
  - `elementsFromPoint` skipping the overlay and `data-feedback-ignore`;
  - ↑/↓, Shift, Esc, Tab, Enter;
  - touch with parent and child buttons;
  - the overlay in a shadow root with `pointer-events: none`;
  - labels from the WP3 policy.
- **Annotate** builds anchors with WP5's `anchorOf` and the observation from
  WP3:
  - `host` kind;
  - subject `{ type: 'app-page', app, route: routeFor(...), build }`, where
    the host supplies `app` and `build`;
  - the page snapshot digest and the policy.
- **Copy report** renders through `./format` and calls `copyToClipboard`
  from `@hachej/boring-files/platform`. No store or route is involved.
- **Save** appears only with a host save endpoint. It keeps one operation id
  per draft across retries. The route admits it with the request's access and
  calls `store.create`. A refusal is shown and nothing is stored.
- **`FeedbackList` and `FeedbackReport`** show stored items:
  - Show resolves against the live page and reveals only `exact` or `moved`;
  - `ambiguous` numbers the candidates for the person to choose;
  - an unprotected store is stated.
- **The registry item** imports `./format`, `./page` and `./ui` directly. Its
  CSS is scoped to `[data-boring="feedback"]`.

**Invariants:**

- FEEDBACK-2 (Copy with annotation only);
- FEEDBACK-5;
- FEEDBACK-7 (never auto-reveal uncertain placements);
- FEEDBACK-8, with the WP3 canary kit run over the picker, sheet and Copy.

**Tests:**

- picker DOM tests (skipping the overlay and ignored regions, keys, touch,
  keyboard), including that picking a button never activates it;
- Copy and Save retry with the same operation id;
- the canary kit on the real paths;
- an installed-recipe consumer test;
- an annotation-only consumer;
- a Chromium journey on `examples/feedback`: point, refine to the parent,
  annotate, copy, save, reload, show, and choose a candidate when a duplicated
  button makes the anchor `ambiguous`.

**Done when:** the journey, the consumer tests and the canary kit pass.

## WP7 · Agent capability and the pi-chat feedback card

**Goal:** the builder agent lists, offers to show and resolves; Show works in
the same page.

- **Depends on:** WP4, WP6.
- **Owns:**
  - `packages/feedback/src/agent/*`;
  - `registry/pi-chat/feedback-card.tsx` and its wiring;
  - `test/packages/feedback-agent.test.mjs`;
  - the builder agent in `examples/feedback/`.

**Spec:**

- `createFeedbackCapability({ store, resolutions, snapshots, resolveAccess, operationNamespace, actions? })`
  returns `{ extension }`.
- **The prompt section** covers the root, untrusted content, that `source`
  points into the application's code, when to use each action, and the store's
  protection.
- **The tool `feedback`** has `replay: 'safe'` and a flat schema:
  - `action: 'list' | 'read' | 'show' | 'resolve'` (`read` returns the full
    report and its revision, so list → read → resolve works headless);
  - optional `status`, `subject`, `cursor`, `id`, `anchor`, `note` and
    `expectedRevision`.

  Fields are checked per action. A missing field returns an error naming it.
  A disabled action returns its reason.
- **Admission** follows `artifacts.ts`: `api.memo` records the key (namespace,
  root, provider, the access fields, action, arguments) and the operation id
  `[namespace, api.taskId]`. A different key on replay returns `unknown`.
- **`list`:**
  - for page subjects, `snapshots` returns `browser-only`, so each anchor
    reports `placement: "checked in the page"` with its signals and
    fallback;
  - kinds without a resolution are `unsupported`.
- **`show`** returns `{ kind: 'offered', id, anchor, note }`, or `denied` or
  `unsupported`.
- **The feedback card** renders mentions, `list` results and offers.
  - Its Show button calls WP6's resolve-and-reveal when the card is mounted in
    the subject's application page (AmbientChat in that page).
  - Otherwise it is `unavailable` with "open the application page".
  - It displays the honest result.

**Invariants:**

- FEEDBACK-5: an agent without the extension has a byte-identical tool list
  and prompt;
- BORING-PI-3;
- FEEDBACK-7: `show` never claims a reveal.

**Tests:**

- native ToolTask execution of each action;
- a same-call replay does not write twice;
- a changed binding returns `unknown`;
- the same model call id in another task is a distinct operation;
- crash before the native acknowledgement, then replay;
- missing-field and disabled-action errors;
- card DOM tests, including `unavailable` outside the page;
- the agent-without-extension snapshot.

**Done when:** native tool tests pass and the example's builder agent lists,
offers and resolves against the SQLite reference store.

## WP8 · Source-location transform — spike first, optional for Release 1

**Goal:** `data-source="file:line"` on elements in development builds, so pins
name the code.

- **Depends on:** WP0.
- **Owns:**
  - `packages/feedback/src/source/*`;
  - its `ARCHITECTURE.json` external dependency entry;
  - `test/packages/feedback-source.test.mjs`.

**Spike:**

- Compare three ways of stamping JSX host elements with `data-source`:
  - a Babel plugin passed to the React Vite plugin;
  - an SWC plugin;
  - an esbuild transform step.

  The repository's own examples build with esbuild.
- Measure correctness (file and line on host elements; components forward
  through their root element), build cost, source-map agreement, and how each
  composes with a typical Vite application setup.
- Record the dependency decision.

**Spec:**

- The chosen transform stamps only intrinsic elements, with project-relative
  paths and never absolute ones.
- It is enabled only when the mode is development or preview. A production
  build that enables it fails the build.
- It ships as a development helper; it is not part of any browser runtime
  entry.

**Invariants:** BORING-PI-5 (not in browser bundles); FEEDBACK-8 (paths are
project-relative).

**Tests:**

- transform fixtures;
- a production-mode refusal;
- an `examples/feedback` build where picked elements carry `source`.

**Done when:** the decision is recorded and the example shows source
locations. If the spike finds no acceptable option, Release 1 ships without
`source`, and this package returns to the later list.

## WP9 · Release 1 qualification

- **Depends on:** WP7 (and WP8 if it has landed).
- **Owns:**
  - `examples/feedback/journey.mjs`;
  - the `test/contracts/feedback-<n>.test.mjs` files it discharges;
  - `FEATURES.md` rows;
  - `VERIFY.json` updates.

**Spec:** one driven Chromium journey on `examples/feedback` (Northwind
Console with AmbientChat and the builder agent), with a fake model.

1. Point at the Save button and refine to its parent and back.
2. Annotate, Copy, then Save.
3. Reload.
4. Attach the report through a mention.
5. The agent lists it (with `source` if WP8 landed), offers to show it, and
   the person presses Show (`applied`).
6. The agent changes the fictional page, then resolves the item.

Then the failure cases:

- a duplicated button gives `ambiguous`, and the person chooses;
- the element is removed, so Show reports `missing`;
- Show from a chat outside the page is `unavailable`;
- a lost reply on resolve is reconciled;
- two browser contexts create and resolve at once (one `conflict`);
- revocation hides the item from the other person;
- the canary kit runs over the whole journey's outputs.

Separately, a model-judged check gives a plain agent only the `.md` and asks
what and where. It is recorded as evaluated behavior.

**Runtime slots discharged:** exactly the parts in FEEDBACK.md's evidence
table. Partly discharged laws keep their slot pending with the discharged part
named.

**Done when:** the journey passes twice in a row; its evidence is under
`.cache/evidence/feedback-app/`; the records match what ran.

---

## Release 1b and later work: outlines

Each package is specified (as Release 1 is) only after its spike answers its
questions. Until then it promises nothing.

| Package | Goal | Must be answered first (and by what) |
| --- | --- | --- |
| **WP10 HTML artifacts (Release 1b)** | `html.node@1` and the picker in model-written HTML | A source-location parser spike and dependency decision (the preview rebuild keeps no positions), with outcomes for implicit, repaired and unmapped nodes, and retained source for dirty buffers. An **opt-in instrumented frame mode** with host-composed injection of the WP6 picker and a browser security qualification (A12 is unqualified today). Interactive-mode stamps are untrusted until checked against the host's map. A per-frame `MessageChannel` bridge |
| **WP11 Markdown** | `markdown.quote@1` | The canonical source text; a rich-to-source projection spike (refuse rather than guess); exact-only matching |
| **WP12 `ask`** | The agent asks the person to point at something | Reserve the id before admission and use it as the single choice, or extend the question contract as its owner. The publish/answer binding persisted first; recovery without the browser; cancellation and expiry; subject identity |
| **WP13 recorder privacy** | Allowlists for console, requests and run ids | Extends WP3's policy as its owner. Console excluded by default; canaries in mutations and console |
| **WP14 evidence and retention** | Audio and replays kept and deleted honestly | A state machine with a private cleanup intent; idempotent transitions; sweep and commit races; authorized reads; recovery after every boundary |
| **WP15 dictation** | Speech as the note, with or without storage | A transient, authorized transcription path into a local draft; Copy never hangs; microphone access through a host-injected platform; transcription is the host's callback (not a library port) |
| **WP16 sync spike** | A measured voice-to-replay bound per browser | Recording delivery is buffered, so the clock mapping is the spike's result. Beeps against observed clicks with delays, seeking and pauses, in three browsers; behavior when 200 ms is missed |
| **WP17 recordings** | The recorder, timeline and replay player in application pages | WP13 to WP16 answered; the earlier prototype's recording checks adapted |
| **WP18 canvas, image, PDF** | The remaining subjects | Canvas coordinates and separate inspection tools; pure image resolution; PDF feasibility first |

## WP19 · Consumer work (other repositories)

These are separate issues and PRs under each repository's own instructions.

- **An application template:**
  - adopt WP8's development transform when it lands;
  - add the default `data-feedback-visible` marks and `routeOf`;
  - run the canary kit in CI.
- **A host with an earlier recording prototype:**
  - stop extending it;
  - remove its record button per application once that application ships
    feedback;
  - decide whether a cross-application builder queue reads feedback.
