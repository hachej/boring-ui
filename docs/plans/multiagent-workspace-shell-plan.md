# Multi-agent workspace shell — vision + implementation route

Status: **plan, pre-gate.** Owner gate required before any bead dispatch.
Tracking: #1399 (north-star ruling ledger). Author session: 2026-08-26.

## 0. What this plan is, and what it is not

This plan **composes** three existing artifacts. It does not restate them.

| Artifact | Owns | Where |
|---|---|---|
| **Job Thread v0 plan** — engine chapter, *in this PR* | The thread *engine*: `JobProjectionV0`, relay, handoff tool, receipts, seat boundary | sibling doc [`job-thread-v0-plan.md`](job-thread-v0-plan.md) + [gate doc](job-thread-v0-plan-review.html); own owner gate + bead epic `wt-391-forward-jfxd` |
| **#1355 Console plan** | The console *substrate*: session/project console rows, collections | `docs/issues/1355/plan.md` (branch `plan/1355-persistent-console`) |
| **Ratified long-term pack** | Frozen ontology, invariants, decision register | `docs/plans/long-term/ratified/*` |

**What THIS plan owns:** the **new workspace shell layout** — the IA, the
mounts, the center modes, the Library — and the **integration route** that
assembles engine + substrate + shell into one product surface.

Anything already ruled elsewhere is cited, never re-decided. Where this plan
needs something from another plan it says so as an explicit dependency
(§5, §6).

**Canonical consolidation (owner, 2026-08-26).** PR #1409 is *the* canonical
multi-agent planning PR. The Job Thread v0 plan is its **engine chapter** and
now lives here as a sibling doc — [`job-thread-v0-plan.md`](job-thread-v0-plan.md),
with its gate doc [`job-thread-v0-plan-review.html`](job-thread-v0-plan-review.html).
PR #1403 is closed as superseded; its `jfxd` bead graph and owner gate are
unchanged. PR #1401 stays separate **by design** — it is the ratification
instrument, and the owner's merge *is* the ruling.

---

## 1. Vision (owner's words, distilled)

**Transparent multi-agent.** A thread looks like today's chat, with several
agents inside it. **One composer.** Workers are hidden behind the
orchestrator: what the user sees is a *voice*, not a *seat*. Staffing — which
agents, how many sessions, the handoffs — collapses behind one merged
transcript; per-agent work logs are drill-down provenance, like CI logs behind
a PR check (#1399, owner sharpening 2026-08-24).

**1 Thread = 1 job.** The thread is the unit of WORK, not the unit of agent.
The user talks to the job. **Proposed** as an amendment — *"A Thread may span
multiple Seats, projected as one timeline; one Thread per job."* — in PR #1401
(`RECONCILIATION.md` §7; `VISION.md` R-c untouched at
`docs/plans/long-term/ratified/VISION.md:112-115`). **Owner merge is pending;
a rejection voids this premise and most of this plan with it.** Naming is settled:
**multi-seat Thread / Job Thread**, never "channel" — *channel* stays reserved
for transport/ingress.

**Threads archive, they do not die.** Work carries an `Archived · N` drill-in.
Archive ≠ delete: history, attribution and refs are retained; archived threads
leave the default Work list and stay searchable (#1399, owner addition
2026-08-26). This is what closes the old "channel lifetime" question.

**The shell = Inbox / Work / Agents / Library / Search, over one workspace.**
Left-nav top level, in that order (#1399, owner rulings 2026-08-26).
**Inbox** first — the single triage surface, amber count badge. **Work** is
collapsible: Threads + Automations, plus a muted `Archived · N` below
Automations; automations are standing work that mints runs, filed under Work,
not top-level. **Agents** is a roster → agent page. **Library** is the ratified
name for the view library. **Search** is the palette.

**Nav = domains. The vertical plugin icon rail = tools** (data-catalog,
explorer, tasks, skills), opening as **columns**. Chat opens as a **contextual
column beside any view, never a page switch.**

**Library = the view library.** Today's workbench, re-homed: files + saved
views of any `ViewDescriptor` kind + agent outputs. It replaces the too-broad
"Artifacts" label. This is the product expression of a ratified P1 line:
*"View (semantic, renderer-independent) … Dockview demoted to renderer"*
(`docs/plans/long-term/ratified/VISION.md:38`) and of invariant 4, *"Agents
reason over semantic resources, views, artifacts — never renderer concepts"*
(`VISION.md:134`). Companies/Funds-style entities render through the
data-catalog/explorer plugin components and live as **saved collection views
in the Library**.

**The embedded workbench is ONE component with four mounts:** (1) **thread
canvas** — an inset card summoned from a message's artifact card; (2) **inbox
evidence viewer** — the artifact under an approval request; (3) **full-tree
popover** — file access without leaving the thread; (4) **standalone Library**.

**Two boundaries, deliberately different:**

- **Artifacts are shared via the workspace.** Seats on a job share one
  canonical workspace filesystem — no copy, no sync — with *distinct per-seat
  authority* (tools, grants, model capability; credentials never cross seats).
  Backing: Decision 25 (`docs/DECISIONS.md:410` — same-workspace agents
  "intentionally share filesystem/process/runtime authority while retaining
  distinct route, prompt, tool, session, readiness, receipt, log, and
  provenance identity") and Decision 28 (`docs/DECISIONS.md:463` — same-Workspace
  agents "share logical Workspace data through the canonical Environment API …
  without copying the authoritative filesystem"). Owner ruling 2026-08-25 in
  #1399 makes this explicit for Job Threads.
- **The conversation is posts-only.** Only settled posts and system markers
  cross a seat boundary; no prompt-crossing, no free-text @-parsing. This is
  the Job Thread plan's Q4 and is *safety, not style* — validated against Grok
  Bot's shared-VM implicit context, which xAI's own docs disclaim as not a
  security boundary (#1399, 2026-08-25).

**Real-SaaS and agent-SaaS, mixed.** Deterministic **Views** sit beside
agentic **Threads** in one shell. A user reading a collection can summon chat
as a column without losing the view. This is the hybrid the spike branch was
built to prove.

**Apps as recipes, composing into a company OS.** A vertical (K7 creator
growth, `VISION.md:174`) is a *recipe*: a fleet declared at workspace level, a
set of saved views, a set of automations, an objectives shape. Several recipes
over one workspace is the company OS.

### Non-goals

No change to frozen ontology/invariants/DAG. No relay, handoff or receipt design — the engine
chapter's. No console row/collection semantics (#1355's). No A2A
loopback and no shared-runtime room (excluded by #1401). No rewrite of
`WorkspaceAgentFront` — this is an **additive layout**.

---

## 2. Today → Delta

The spike branch **`weekend/saas-hybrid-spike`** (worktree
`.worktrees/weekend-saas-spike`, HEAD `e027c90d4`, 4 commits on `33e5f4671`)
is the Today for most shell claims: it proves the IA is a **recomposition of
components that already ship**, not new invention. It is 19 files, +3240/−65,
and only 5 of those files touch production packages.

### Today — real, already shipping

| Fact | Evidence |
|---|---|
| Layout is already a switch with two siblings | `WorkspaceAgentLayout = "classic" \| "plugin-tabs"` — `packages/workspace/src/app/front/WorkspaceAgentFront.tsx:174`; selected at `:781`; default `"classic"` at `:736` |
| The plugin-tabs shell is a thin frame (left pane + rail + children) | `PluginTabsWorkspaceShell.tsx:96-186`; left-pane swap at `:124`; floating collapse button `:166-181`; mobile `Sheet` `:138-163` |
| Nav is **plugin-contributed**, not a fixed IA | `usePluginAppLeftActions` at `WorkspaceAgentFront.tsx:2473`, merged with host actions at `:2474-2498`; Inbox arrives as `appLeftActions: [{ id: "inbox", … overlay: AskUserInboxOverlay, order: 10 }]` — `plugins/ask-user/src/front/index.tsx:245` |
| SurfaceShell / ArtifactSurfacePane / FileTree(View) / WorkbenchLeftPane are public API | `packages/workspace/src/index.ts:215,221,300,315,316` |
| The spike ran the **real** file tree against the real filesystem | `FileTreeView` mount `SaasSpike.tsx:1009-1011`; autosave `POST /api/v1/files` `SaasSpike.tsx:450-451` |
| `InboxOverlay` and `AutomationPanel` render as pages unchanged | `SaasSpike.tsx:352`, `:367`; newly re-exported at `plugins/ask-user/src/front/index.tsx:286-287` and `plugins/boring-automation/src/front/index.tsx:60` |
| `ArtifactSurfacePane` nests safely — dock **and** thread canvas | centre dock `SaasSpike.tsx:1433-1438`; thread canvas `SaasSpike.tsx:513-518`; nesting rules (distinct `storageKey`, disjoint panel-id prefixes) `SaasSpike.tsx:410-418` |
| `DataExplorer` renders Companies and Funds from one component, two adapters | `SaasSpike.tsx:1021-1030`; adapters `SaasSpikeFixtures.ts:851,857` |
| The activity rail was extracted to a reusable component | new `packages/workspace/src/front/chrome/workbench-left/WorkbenchActivityRail.tsx` (116 lines, commit `e027c90d4`); exported `packages/workspace/src/index.ts:325-326`; `WorkbenchLeftPane.tsx:137-151` now consumes it (+17/−56, pure extraction) |
| Page/dock centre modes work, with the dock genuinely unmounted in page mode | `CenterState` union `SaasSpike.tsx:149`; state `:1447`; switch `:1536-1540`; rationale `:124-140` |

### Delta — what does not exist yet

| Gap | Why it matters | Evidence |
|---|---|---|
| **The shell components are not exported.** The spike reaches into workspace *source* via a playground-only Vite alias | A real host **cannot** import `PluginTabsWorkspaceShell`, `AppSessionRow`, `AppLeftPaneAgentCard`, `RailAction`, `PaneCollapseButton` today | imports `SaasSpike.tsx:78-82`; rationale `:73-77`; alias `apps/workspace-playground/vite.config.ts:96` + `tsconfig.json` paths |
| **Fixed IA (Inbox/Work/Agents/Library/Search) vs plugin-contributed nav** | The ruled IA is hardcoded JSX in the spike (`SaasLeftNav` `SaasSpike.tsx:1163-1295`); production nav is an unordered merged action list | `WorkspaceAgentFront.tsx:2474-2498` vs `SaasSpike.tsx:1191-1281` |
| **No flyout.** Collapsed rail exposes only Inbox + Search; the rest of the nav is unreachable | Owner ruled a collapsed flyout mirroring Work incl. `Archived · N` | `SaasLeftRail` `SaasSpike.tsx:1298-1313`; no hover-peek anywhere |
| **Chat column is a visual fixture** — disabled send, "Fixture · composer visual only" | The single most load-bearing unproven claim of the spike | `ChatColumn` `SaasSpike.tsx:1326-1387`, disabled button `:1380-1381`; refusal documented `:1315-1324` (`PiChatComposerSurface` has ~45 required props; `ChatPanelHost` needs a live workspace/session) |
| **Thread transcript is a playground mock** | `JobThreadView` is not the shipped chat | `apps/workspace-playground/src/front/JobThreadView.tsx:608`; noted `SaasSpike.tsx:1320-1323` |
| **Search nav entry is dead** — it dispatches a synthetic ⌘K event and nothing mounts `CommandPalette` | | `SaasSpike.tsx:1472-1474`; the real export sits unused at `packages/workspace/src/index.ts:206` |
| **Module-global mutable `shellRef`** stands in for routing/state, never cleared | Not shippable | `SaasSpike.tsx:165-177` |
| **`panelForPath` duplicates `filesystemSurfaceResolver`** because bare `ArtifactSurfacePane` has no `openFile` | | `SaasSpike.tsx:206-218` |
| **Route defaults ON** — the bare playground URL opens the spike | Inverted for a real flag | `apps/workspace-playground/src/front/saasSpikeRoute.ts:7-13`; branch `App.tsx:574` |
| **Thread-level `archived` lifecycle absent from `JobProjectionV0`** | Owner asked to fold at S1 or as gate errata | #1399 owner addition 2026-08-26 |

---

## 3. Shell location — who owns the route

*Added at review: both reviewers named this the deepest gap. Sol: "the missing
decision most likely to bite hardest is: who owns the canonical shell
location and route lifecycle?"*

The package has **no router by contract** — an existing prop says so in as many
words: *"host wires routing — workspace pkg has no router"*
(`WorkspaceAgentFront.tsx:274`). The spike violated this with a module-global
mutable `shellRef` (`SaasSpike.tsx:165-177`). A reducer that silently absorbs
navigation would become a second router, and Search, active-nav highlighting,
deep links and restored center state would diverge.

**Recommendation (owner question Q1 below):** split it.

- **The package owns location STATE and a `navigate(next: ShellLocation)` API.**
  One serializable value, no `window`/`history` access anywhere in the package.
- **The host owns URL serialization** — parse on boot, push on change, feed
  back through a controlled prop. Consistent with `:274` and with how project
  settings and new-tab hrefs already work (`:275-277`).

```ts
type ShellLocation = {
  domain: "inbox" | "work" | "agents" | "library" | "search"
  target?: { kind: "thread" | "automation" | "agent" | "view" | "file"; id: string }
  center: { mode: "page" } | { mode: "dock"; activePanelId?: string }
  mount?: { kind: "canvas" | "evidence" | "popover"; ref: string }   // L4/L5/L6
  chat?: { attachedTo: string }                                      // post-v0, see Q4
}
```

Deep-link / refresh / back must be **stated, not discovered**: a URL round-trips
to the same `ShellLocation`; refresh restores domain + target + center mode
(dock tab state stays renderer-local per L3a); back/forward moves between
locations, never between dock tabs. Multi-workspace: `ShellLocation` is scoped
*inside* a workspace; switching workspace resets it.

This becomes slice **L1.5**, deliberately early — the reducer shape, the package
boundary, and whether any public API is justified all fall out of it.

---

## 4. The route — a new workspace layout, not a rewrite

**Framing (owner):** *a new workspace layout* — a third value on the existing
layout switch, composed inside `packages/workspace` as a **sibling** to the
`plugin-tabs` composition, feature-flagged, reusing the components the spike
proved. `WorkspaceAgentFront`'s `classic`/`plugin-tabs` behavior is untouched.

### 4.1 The layout-traits matrix

*Round-1 claimed this was "one branch … ~5 lines". That was wrong, and both
reviewers caught it as P0.* `isPluginTabsLayout` has **12 occurrences / 9
semantic decision sites** in `WorkspaceAgentFront.tsx`. A boolean cannot carry
a third layout: `"workspace-shell"` would silently inherit *classic* behavior
at every `isPluginTabsLayout ? … : …` site.

**L1 replaces the boolean with a traits object** resolved once per layout, so
every site reads a named trait and a new layout must fill the table in.

| # | Site | Trait | classic | plugin-tabs | **workspace-shell** |
|---|---|---|---|---|---|
| 1 | `:781` | *(predicate definition — deleted)* | — | — | → `resolveLayoutTraits()` |
| 2 | `:798` | `fleetMode` | off | on | **on** — Agents is a nav domain |
| 3 | `:1641-1642` | `pluginsOwnWorkspaceSources` | on | off | **off** — shell owns its explorer |
| 4 | `:2362`, `:2372` | `paletteSearchesChatPanes` | off | on | **on** (scope open — Q6) |
| 5 | `:2560` | `chatLayoutNav` | `"session-list"` | `null` | **`null`** — shell owns nav |
| 6 | `:2569` | `chatPaneSplitting` | on | off | **off** (v0; threads aren't split panes) |
| 7 | `:2578` | `chatOverlaySlot` | `null` | overlay node | **`null`** — overlays are pages (L5) |
| 8 | `:2595` | `openNavAffordance` | on | off | **off** |
| 9 | `:2614` | `shellComposition` | ChatLayout only | `PluginTabsWorkspaceShell` | **`WorkspaceShell`** |
| 10 | `:2725` | `publishedNavOpen` | `effectiveNavOpen` | `!collapsed` | **`!collapsed`** |

Rows 4 and 6 are **proposals, not rulings** — flagged in §7.

### 4.2 Two boundary rules

**(a) No new renderer nouns and no kernel-View squatting.** Dockview stays a
renderer (`VISION.md:38`; invariant 4 at `:134`). The shell mounts
**`SurfaceShell`**, which already owns a renderer-free API — `openFile`,
`openSurface`, `openPanel`, `expandToFile`, `closeWorkbenchLeftPane`,
`getSnapshot` (`SurfaceShell.tsx:69-87`). **The reducer stores
`SurfaceShellApi`, never `DockviewApi`.** That is what makes L3a's
no-Dockview-types negative proof achievable rather than aspirational.

**(b) Internal package layout, not new public API.** Round 1 proposed exporting
five visual internals. Withdrawn: the root entry states *"Every export here is
deliberate"* (`packages/workspace/src/index.ts:1-5`) and is the published `"."`
surface (`packages/workspace/package.json:16-19`). A layout selected *inside*
`WorkspaceAgentFront` needs **no** new public exports. The root index gains at
most **one** deliberate export — the layout entry itself — or **none**.

### 4.3 Slices

Bead-ready. Suggested anchor prefix `wt-391-forward-shell`.

**L1 — layout traits + internal shell composition.**
- *WHAT:* add `"workspace-shell"` to `WorkspaceAgentLayout`; replace the
  `isPluginTabsLayout` boolean with `resolveLayoutTraits(layout)` and convert
  all 9 semantic sites per §4.1; add
  `front/layout/workspace-shell/` (private chrome) composing the frame the
  spike proved. Reducer holds `SurfaceShellApi` (§4.2a). Replace the spike's
  module-global `shellRef` with a provider. Replace the spike-local
  `panelForPath` (`SaasSpike.tsx:206-218`) with the real
  `filesystemSurfaceResolver`. Delete the playground `@` alias.
- *Inherited prerequisites (spike-only, must land here — they are NOT on main):*
  (i) the `WorkbenchActivityRail` extraction and its export
  (`packages/workspace/src/index.ts:325-326` on `e027c90d4`); (ii) the
  `InboxOverlay`/`InboxOverlayProps` re-exports
  (`plugins/ask-user/src/front/index.tsx:286-287`); (iii) the `AutomationPanel`
  export (`plugins/boring-automation/src/front/index.tsx:60`).
- *Flag home:* `workspaceLayout` stays a **host prop** (unchanged contract).
  The adoption flag is host-read: playground = URL/env; full-app = env var;
  CLI = workspace setting. **Rollback is a prop flip**, no data migration.
- *Scope:* `packages/workspace/src/front/layout/workspace-shell/*`,
  `layoutTraits.ts`, the 9 sites in `WorkspaceAgentFront.tsx`, the three
  inherited changes, `apps/workspace-playground/{vite.config.ts,tsconfig.json}`.
- *Proof:* `pnpm --filter @hachej/boring-workspace test -- src/front/layout/workspace-shell/ src/app/front/__tests__/layoutTraits.test.ts`;
  `pnpm --filter @hachej/boring-workspace typecheck`; `pnpm lint:invariants`.
- *Negative proof:* `resolveLayoutTraits` is exhaustive — a new layout value
  fails typecheck until every trait is supplied; **traits regression suite runs
  all three layouts** and asserts classic/plugin-tabs trait vectors are
  unchanged from a recorded baseline; the shell composition imports only from
  the package's internal modules, enforced by a dependency-cruiser (or import)
  rule, not a grep; `packages/workspace/src/__tests__/public-api.test.ts` shows
  **at most one** added export.

**L1.5 — shell location contract.** *(new; §3)*
- *WHAT:* `ShellLocation` type, reducer, `navigate()`, and the host
  serialization seam. No new nav chrome.
- *Blocked by:* L1; owner answer to Q1.
- *Scope:* `workspace-shell/{shellLocation.ts,ShellLocationProvider.tsx}`.
- *Proof:* `pnpm --filter @hachej/boring-workspace test -- src/front/layout/workspace-shell/__tests__/shellLocation.test.ts`.
- *Negative proof:* every `ShellLocation` round-trips through serialize→parse
  unchanged; the package contains no `window.history`/`location` reference
  (import-boundary rule); an unknown serialized domain falls back to Inbox
  rather than throwing.

**L2a — nav chrome + flyouts (static).**
- *WHAT:* the ruled fixed order (Inbox · Work[Threads · Automations · Archived]
  · Agents · Library · Search) as a **declared IA** with plugin actions
  slotting into *named sections* rather than today's flat merged list
  (`WorkspaceAgentFront.tsx:2473-2498`). Collapsed rail gains the **flyout**
  mirroring Work — absent from the spike (`SaasSpike.tsx:1298-1313`). Counts
  render from whatever source exists; **zero/absent is a valid state**.
- *WHY THIS PLAN OWNS IT:* neither sibling does. The Job Thread plan explicitly
  disowns the nav reframe (`job-thread-v0-plan.md:718-721`), and #1355's
  Slice 3 shell is a *Console* organization, not this IA — see §5.
- *Blocked by:* L1, L1.5.
- *Scope:* `workspace-shell/{ShellNav,ShellNavSections,ShellRail}.tsx`; a
  section id on the app-left action contract.
- *Proof:* `pnpm --filter @hachej/boring-workspace test -- src/front/layout/workspace-shell/__tests__/shellNav.test.tsx`.
- *Negative proof:* a plugin registering an **unknown section id at runtime**
  (not just in types) is surfaced as a diagnostic and dropped deterministically,
  asserted by test; every destination reachable expanded is reachable collapsed;
  a nav with all counts absent renders without layout shift.

**L2b — live Work rows + `Archived · N`. BLOCKED.**
- *WHAT:* real job rows (one row per multi-participant job) and real archive
  counts.
- *Blocked by:* three items owned elsewhere — (i) the left-pane row model
  `AppLeftPaneSession` has **no `kind` discriminator** and PR #1393 does not add
  one (`job-thread-v0-plan.md:546-552`; `AppLeftPane.tsx:17-27`); (ii) #1355's
  `ConsoleThreadRefV1` session-tuple key is single-seat by construction and
  cannot hold a job as one row (`job-thread-v0-plan.md:723-725`); (iii)
  `JobProjectionV0` has no lifecycle field, so `Archived · N` has no source
  (#1399, 2026-08-26) — to be folded at jfxd S1 or filed as gate errata.
- *Proof / negative proof:* deferred until the prerequisites are ruled; writing
  them now would be fiction.

**L3a — center page/dock modes (renderer-local).**
- *WHAT:* the `CenterState = {mode:"dock"} | {mode:"page"; page}` machine
  (`SaasSpike.tsx:149`, `:1447`, `:1536-1540`) with the dock genuinely
  unmounted in page mode. Dock tab state is **renderer-local**, deliberately
  *not* in `ShellLocation` (§3).
- *Blocked by:* L1, L1.5.
- *Scope:* `workspace-shell/CenterHost.tsx`.
- *Proof:* `pnpm --filter @hachej/boring-workspace test -- src/front/layout/workspace-shell/__tests__/centerHost.test.tsx`;
  `pnpm --filter @hachej/boring-ui-playground test:e2e -- e2e/workspace-shell.spec.ts -g "dock survives page round-trip"`.
- *Negative proof:* no Dockview type appears in `CenterHost`'s props or in the
  reducer — the surface handle is `SurfaceShellApi` (§4.2a), asserted by a type
  test; entering page mode unmounts the dock (asserted by DOM absence, not
  visibility).

**L3b — Library over existing files and panels (noncanonical).**
- *WHAT:* Library as the standalone workbench mount, listing **files and open
  panels that already exist** plus agent outputs. Collection rendering via
  `DataExplorer` adapters (`SaasSpike.tsx:1021-1030`).
- *NAMING RULE (P0 from review):* the interim shell DTO is
  **`ShellLibraryEntryV0`**. It is **never** called `ViewDescriptor`. The
  ratified View layer is a *set* — `ViewDescriptor` + `ViewResolver` +
  `ViewHost` + `ViewContext` + `ViewRef`
  (`V2-IMPLEMENTATION-SPEC.md:144-149`), sequenced P1 alongside K2
  (`VISION.md:178-179`) — and no part of it exists in production today.
  Shipping a lookalike schema without resolver, context or host would create a
  second, wrong "ViewDescriptor".
- *Blocked by:* L3a.
- *Scope:* `workspace-shell/LibraryPage.tsx`, `shared/shellLibraryEntry.ts`.
- *Proof:* `pnpm --filter @hachej/boring-workspace test -- src/front/layout/workspace-shell/__tests__/libraryPage.test.tsx`.
- *Negative proof:* `grep -rn "ViewDescriptor" packages/workspace/src` returns
  nothing; an entry of unknown `kind` renders a labelled placeholder and never
  throws; `ShellLibraryEntryV0` carries no renderer field.

**Later, gated — canonical saved Views.** Consumes the ratified View contract
*as a set*, with a resolver and a migration from `ShellLibraryEntryV0`. Not a
v0 slice. Gated on the P1 View work landing, and on Q3's persistence ruling.

**L4 — thread view = chat + inset canvas.**
- *WHAT:* the thread page renders the **real** chat with an inset
  `ArtifactSurfacePane` canvas summoned from a message artifact card, plus
  `WorkbenchActivityRail side="right"` (`SaasSpike.tsx:513-544`). Consumes
  jfxd **S4** — the message-source adapter feeding the existing `PiChatPanel` a
  merged `(turnOrdinal, seq, markerOrdinal)` stream
  (`job-thread-v0-plan.md:687-697`). This plan mounts that adapter; it does not
  design it.
- *Blocked by:* jfxd S4 (→ the engine chapter's owner gate, S1–S3), therefore
  #1401.
- *Scope:* `workspace-shell/ThreadPage.tsx` + canvas mount/teardown guards.
- *Proof:* `pnpm --filter @hachej/boring-workspace test -- src/front/layout/workspace-shell/__tests__/threadPage.test.tsx`
  **and** `pnpm --filter @hachej/boring-ui-playground test:e2e -- e2e/workspace-shell-thread.spec.ts`
  driving a scripted two-participant fixture: assert merged transcript order,
  agent chips, and canvas opening from an artifact card. A component test alone
  does not prove this.
- *Negative proof:* nested `ArtifactSurfacePane`s never share a `storageKey` and
  never share a panel-id prefix (`SaasSpike.tsx:410-418`); a single-seat thread
  renders through the unmodified `PiChatPanel` path; closing the canvas leaves
  no orphan panel in `getSnapshot()`.

**L5 — evidence viewing on attention items.**
- *WHAT:* Inbox as a first-class page (not an overlay used as one — today
  `onClose={() => {}}`, `SaasSpike.tsx:352`), with the workbench mounted inside
  an item as a **read-only evidence viewer** for the artifact under it.
- *VOCABULARY RULE (P1 from review):* these are **attention items /
  Human Intentions**, never "approvals". #1355 is explicit: *"Approval remains
  absent until C5 supplies a durable approval source; the compatibility UI must
  not simulate it"* and *"Inbox cannot grant authority"*
  (`docs/issues/1355/plan.md:239-243`). Authority-grade approval is reserved
  for C5.
- *Blocked by:* L3a. See §5 for the #1355 relationship.
- *Scope:* `workspace-shell/AttentionPage.tsx`; `InboxOverlayProps` gains a page
  mode.
- *Proof:* `pnpm --filter @hachej/boring-ask-user test -- src/front/inbox/__tests__/`;
  `pnpm --filter @hachej/boring-ui-playground test:e2e -- e2e/inbox-demo.spec.ts`.
- *Negative proof:* the evidence viewer is mounted read-only and **an attempted
  write is rejected** — the test performs the write and asserts the rejection,
  it does not merely inspect the UI; no string "approve"/"approval" appears in
  the surface's copy (asserted by test).

**L6 — popover file access.**
- *WHAT:* `FileTreeView` in a dismissible popover from the thread.
- *WHERE IT OPENS (review gap):* `FileTreeView` activates a file through
  `bridge?.openFile(path, { mode: "edit", … })`
  (`FileTreeView.tsx:337-341`) — which routes to the **current center dock
  target**. So opening a file *does* change center state; the popover is a
  launcher, not an isolated surface. Round 1's negative proof said the opposite
  and was wrong.
- *Blocked by:* L1, L3a.
- *Scope:* `workspace-shell/FileTreePopover.tsx`.
- *Proof:* `pnpm --filter @hachej/boring-workspace test -- src/front/layout/workspace-shell/__tests__/fileTreePopover.test.tsx`.
- *Negative proof:* *browsing/expanding* in the popover changes no center state;
  only an explicit activation does, and it switches center to dock mode with the
  opened path active; dismissing the popover never closes the opened panel.

**L7a — playground adoption + e2e.** **L7b — full-app adoption.**
- *WHAT:* flip each host onto `workspace-shell` behind an **off-by-default**
  flag (inverting the spike's default-on route,
  `saasSpikeRoute.ts:7-13`); wire Search to the real `CommandPalette`
  (`index.ts:206`), dead in the spike (`SaasSpike.tsx:1472-1474`).
- *Blocked by:* L1–L6 (L7b additionally by L7a).
- *Proof:* `pnpm test:e2e` incl. `e2e/workspace-shell.spec.ts`.
- *Negative proof (named baseline):* with the flag off,
  `release-candidate-golden-route.spec.ts` visual comparison against the
  **pre-L1 `main` screenshots regenerated on this branch**, `maxDiffPixels: 0`
  at the project's existing viewport set. Not "looks the same".

**Explicit post-v0 non-goal:** contextual chat beside a *view* (as opposed to a
thread). It has no session to attach to, and the spike never proved a live
composer at all (§2). L7 may complete without it. Q4 stays open for the owner.

---

## 5. Relationship to #1355

Both plans touch a shell and an Inbox. Ruling, so the first implementation bead
does not discover a conflict:

1. **The shell CONSUMES #1355's providers and collections when they land.** It
   does not reimplement them. Until they land, the shell's Work rows are static
   chrome (L2a) and its live rows are blocked (L2b).
2. **The workspace-local Inbox mount (L5) is a compatibility surface**, matching
   #1355's own framing of the `ask-user` file records as *"a named compatibility
   adapter, not final C5 truth"* (`docs/issues/1355/plan.md:236-238`). The
   Console-global Inbox (#1355 Slice 5C, `:464-470`) is the eventual single
   surface; L5 must not present itself as a second one.
3. **Nav ownership: this plan's IA supersedes #1355 Slice 3's left-pane
   organization** (`docs/issues/1355/plan.md:409-413`) **for the
   `workspace-shell` layout only** — Slice 3 continues to own `plugin-tabs`.
   *This supersession needs the owner's explicit gate;* it is not self-declared.
4. **`ConsoleCollection` is not the Library's store.** It groups
   `ConsoleThreadRefV1` records as personal navigation metadata
   (`docs/issues/1355/plan.md:54-58`); it cannot hold saved data views. Q3
   asks where they live instead.

---

## 6. Gates & sequencing

```
#1401 (amendment, OPEN — a rejection voids the premise) ──┐
                                                          ├→ jfxd S1→S2→S3→S4 → L4
#1382 (objectives, OPEN) ─────────────────────────────────┘

L1 → L1.5 → L2a → (L3a → L3b, L5, L6) → L7a → L7b
                     └─ L2b BLOCKED: #1393 kind-discriminator
                        + ConsoleThreadRefV1 repair + jfxd lifecycle field
                     └─ canonical saved Views BLOCKED: ratified P1 View set + Q3

#1355 Gate 1 (architecture approval, UNANSWERED — "No implementation bead is
   ready before it", docs/issues/1355/plan.md:372-376)
      → Console collections/providers → L2b live rows, Library persistence
      → and the §5.3 nav-supersession gate
```

**The honest unblocked tranche: L1, L2a, L3a, and L6 in part** (the popover
itself; its center-routing behavior depends on L3a). L1.5 is unblocked *as
work* but wants Q1 answered first. Everything else waits on a gate owned by
someone else. Round 1 claimed "L1, L2, L3, L5, L6 are unblocked today" — that
was false, and both reviewers said so.

---

## 7. Open questions

1. **Routing/location ownership.** *Recommended: package owns `ShellLocation`
   state + `navigate()`; host owns URL serialization* (§3), consistent with
   `WorkspaceAgentFront.tsx:274`. Confirm, or make the host own location
   entirely?
2. **Nav extensibility, and the Inbox paradox.** The ruled IA is fixed and
   ordered, but Inbox itself *arrives today as a plugin contribution* —
   `appLeftActions: [{ id: "inbox", … order: 10 }]`
   (`plugins/ask-user/src/front/index.tsx:245`). A closed IA either hardcodes a
   destination the plugin owns, or keeps a contribution point the IA claims to
   have closed. Named section slots (L2a's proposal), tools-rail only, or IA
   fully closed with Inbox promoted into the shell?
3. **Library persistence.** `ConsoleCollection` cannot hold saved views (§5.4).
   Workspace settings, a new plugin store, or descriptor-local/unsaved for the
   first tranche?
4. **Contextual chat beside a view** — declared a post-v0 non-goal above.
   Confirm. When it returns: ephemeral thread, attach-to-last-thread, or
   view-scoped session?
5. **Export surface and semver posture.** Recommendation is zero-or-one new
   public export (§4.2b). Confirm the shell stays internal, or name the external
   consumer that justifies a public seam.
6. **Search/palette scoping.** Search is a nav domain *and* `⌘K` is an existing
   chat-pane palette (`WorkspaceAgentFront.tsx:2362`). One palette scoped across
   five domains, or a domain-scoped Search page plus the existing palette?
   Traits row 4 assumes the latter.
7. **Attention data source and polling cost.** Five domains with counts/badges
   implies five subscriptions. What feeds them, at what interval, and what is
   the cost with the workbench and a live thread already streaming?
8. **Classic-layout deprecation line.** Three layouts is a real maintenance tax
   (§4.1's matrix must be filled for all three, forever). Is `classic` on a
   deprecation path, and if so from when?
9. **Chat-pane splitting in the shell** (traits row 6) — confirm off for v0.
10. **`WorkbenchLeftPane` vs Library.** If the workbench re-homes as Library,
    what happens to today's mounts in `ChatLayout.tsx:647-655` — kept for
    `classic`, or migrated?
11. **Touch reachability.** Flyouts are hover-driven; the spike never passes
    `mobileShellEnabled`, so the `Sheet` path
    (`PluginTabsWorkspaceShell.tsx:138-163`) is unexercised by every §2 claim.
    Four columns and hover flyouts on a phone is unanswered.
12. **Kanban.** `SAAS_VIEWS` carries kanban descriptors with no kanban renderer
    in the repo (`SaasSpike.tsx:688-700`). In scope for Library, or deferred?

---

## 8. Honest status

The IA, the mounts and the center modes are **proven by recomposition** — the
spike's real contribution, and a strong result. But the **chat**, which is what
the whole vision is about, is a **visual fixture in both places it appears**
(`SaasSpike.tsx:1380-1381`, `JobThreadView.tsx:608`). Nothing in the spike
proves a live multi-agent transcript renders in this shell; that proof belongs
to jfxd S4 + L4 and is the highest-risk item here. All entity data is fixture
(`SaasSpikeFixtures.ts`, 1107 lines) and the shell has **no component tests**.

Round 1 of this plan was reviewed by fresh-eyes and by GPT-5 Codex; both
returned `revise`, and this revision folds every P0 and P1. Two round-1 claims
were **wrong and are retracted**: that a third layout is a ~5-line change
(§4.1), and that L1/L2/L3/L5/L6 were unblocked today (§6). It has not been
re-reviewed since.
