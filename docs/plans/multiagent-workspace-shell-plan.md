# Multi-agent workspace shell — vision + implementation route

Status: **plan, pre-gate.** Owner gate required before any bead dispatch.
Tracking: #1399 (north-star ruling ledger). Author session: 2026-08-26.

## 0. What this plan is, and what it is not

This plan **composes** three existing artifacts. It does not restate them.

| Artifact | Owns | Where |
|---|---|---|
| **Job Thread v0 plan** | The thread *engine*: `JobProjectionV0`, relay, handoff tool, receipts, seat boundary | `docs/plans/job-thread-v0-plan.md` on PR #1403 (branch `weekend/jobthread-v0-plan`) — its own gate + bead epic `wt-391-forward-jfxd` (per the PR body; the doc itself uses bare `S1`–`S6`) |
| **#1355 Console plan** | The console *substrate*: session/project console rows, collections | `docs/issues/1355/plan.md` (branch `plan/1355-persistent-console`) |
| **Ratified long-term pack** | Frozen ontology, invariants, decision register | `docs/plans/long-term/ratified/*` |

**What THIS plan owns:** the **new workspace shell layout** — the IA, the
mounts, the center modes, the Library — and the **integration route** that
assembles engine + substrate + shell into one product surface.

Anything already ruled elsewhere is cited, never re-decided. Where this plan
needs something from another plan it says so as an explicit dependency (§5).

---

## 1. Vision (owner's words, distilled)

**Transparent multi-agent.** A thread looks like today's chat, with several
agents inside it. **One composer.** Workers are hidden behind the
orchestrator: what the user sees is a *voice*, not a *seat*. Staffing — which
agents, how many sessions, the handoffs — collapses behind one merged
transcript; per-agent work logs are drill-down provenance, like CI logs behind
a PR check (#1399, owner sharpening 2026-08-24).

**1 Thread = 1 job.** The thread is the unit of WORK, not the unit of agent.
The user talks to the job. Ratified as an amendment: *"A Thread may span
multiple Seats, projected as one timeline; one Thread per job."*
(PR #1401 → `RECONCILIATION.md` §7; `VISION.md` R-c untouched at
`docs/plans/long-term/ratified/VISION.md:112-115`.) Naming is settled:
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

No change to frozen ontology/invariants/DAG. No relay, handoff or receipt
design (#1403's). No console row/collection semantics (#1355's). No A2A
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
| Nav is **plugin-contributed**, not a fixed IA | `usePluginAppLeftActions` merged with host actions — `WorkspaceAgentFront.tsx:2474-2498`; Inbox arrives as `appLeftActions: [{ id: "inbox", … overlay: AskUserInboxOverlay, order: 10 }]` — `plugins/ask-user/src/front/index.tsx:245` |
| SurfaceShell / ArtifactSurfacePane / FileTree(View) / WorkbenchLeftPane are public API | `packages/workspace/src/index.ts:215,221,300,315,316` |
| The spike ran the **real** file tree against the real filesystem | `FileTreeView` mount `SaasSpike.tsx:1009-1011`; autosave `POST /api/v1/files` `SaasSpike.tsx:450-451` |
| `InboxOverlay` and `AutomationPanel` render as pages unchanged | `SaasSpike.tsx:352`, `:367`; newly re-exported at `plugins/ask-user/src/front/index.tsx:286-287` and `plugins/boring-automation/src/front/index.tsx:60` |
| `ArtifactSurfacePane` nests safely — dock **and** thread canvas | centre dock `SaasSpike.tsx:1433-1438`; thread canvas `SaasSpike.tsx:513-518`; nesting rules (distinct `storageKey`, disjoint panel-id prefixes) `SaasSpike.tsx:410-418` |
| `DataExplorer` renders Companies and Funds from one component, two adapters | `SaasSpike.tsx:1021-1030`; adapters `SaasSpikeFixtures.ts:851,857` |
| The activity rail was extracted to a reusable component | new `packages/workspace/src/front/chrome/workbench-left/WorkbenchActivityRail.tsx` (116 lines, commit `e027c90d4`); exported `packages/workspace/src/index.ts:317-318`; `WorkbenchLeftPane.tsx:137-151` now consumes it (+17/−56, pure extraction) |
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

## 3. The route — a new workspace layout, not a rewrite

**Framing (owner):** this is *a new workspace layout*. Concretely: a third
value on the existing layout switch, composed inside `packages/workspace` as a
**sibling** to the `plugin-tabs` composition, feature-flagged, reusing the exact
components the spike proved. `WorkspaceAgentFront`'s `classic`/`plugin-tabs`
branches are untouched.

The seam already exists and is small:

```
WorkspaceAgentLayout = "classic" | "plugin-tabs"        // :174, today
                     → + "workspace-shell"              // the delta
isPluginTabsLayout   = workspaceLayout === "plugin-tabs" // :781, today
```

Two rules the route must not break. **(a) No new renderer nouns** — Library
rows are `ViewDescriptor`s, Dockview stays a renderer (`VISION.md:38`,
invariant 4 at `:134`). **(b) Additive exports only** — everything the shell
needs must leave `packages/workspace/src/index.ts` as public API; no host may
reach into source the way the spike does (`SaasSpike.tsx:73-82`).

### Slices

Bead-ready. One session each. Anchor prefix suggested: `wt-391-forward-shell`.

**L1 — extract the shell layout into `packages/workspace` as an opt-in composition.**
- *WHAT:* add `"workspace-shell"` to `WorkspaceAgentLayout`; new
  `front/layout/workspace-shell/WorkspaceShell.tsx` composing the frame the
  spike proved (nav | explorer | content | chat column). Export the five
  currently-source-only pieces (`PluginTabsWorkspaceShell`, `AppSessionRow`,
  `AppLeftPaneAgentCard`, `RailAction`, `PaneCollapseButton`). Replace the
  module-global `shellRef` (`SaasSpike.tsx:165-177`) with a provider + reducer.
  Replace local `panelForPath` (`SaasSpike.tsx:206-218`) with the real
  `filesystemSurfaceResolver`.
- *Scope:* `packages/workspace/src/front/layout/workspace-shell/*`,
  `src/index.ts`, one branch in `WorkspaceAgentFront.tsx` (~5 lines).
- *Proof:* `pnpm --filter @hachej/boring-workspace test -- src/front/layout/workspace-shell/__tests__/`;
  `pnpm --filter @hachej/boring-workspace typecheck`;
  `src/__tests__/public-api.test.ts` updated.
- *Negative proof:* with the flag off, `classic` and `plugin-tabs` render
  byte-identical trees (existing `AppLeftPane.test.tsx` unchanged and green);
  `grep -rn "@/front/layout" apps/ packages/` returns nothing outside the
  playground alias.

**L2 — nav IA + collapse/flyouts.**
- *WHAT:* the ruled fixed order (Inbox · Work[Threads · Automations · Archived·N]
  · Agents · Library · Search) as a **declared IA**, with plugin-contributed
  actions slotting into named sections rather than a flat merged list
  (today: `WorkspaceAgentFront.tsx:2474-2498`). Collapsed rail gains a
  **flyout** mirroring Work incl. `Archived · N` — absent from the spike
  (`SaasSpike.tsx:1298-1313`). Amber Inbox badge. Section-collapsed rollup rule
  as spiked (`SaasSpike.tsx:1143`).
- *WHY THIS PLAN OWNS IT:* neither other plan does. The Job Thread plan
  explicitly **disowns** the nav reframe — *"Deferred follow-on (not v0) —
  Console nav reframe. Jobs primary, Agents as a directory … It does not
  depend on S4"* (`job-thread-v0-plan.md:718-721`) — and #1355 builds a shell
  with no multi-participant row and no jobs-primary IA
  (`docs/issues/1355/plan.md:409-413`).
- *Known gap this slice inherits:* the left-pane row model
  `AppLeftPaneSession` is session-shaped with **no `kind` discriminator**, and
  PR #1393 does not add one (`job-thread-v0-plan.md:546-552`;
  `AppLeftPane.tsx:17-27`). Work's Threads list needs that discriminator plus
  the `ConsoleThreadRefV1` repair (§4) before a job renders as one row.
- *Scope:* `workspace-shell/{ShellNav,ShellNavSections,ShellRail}.tsx`, plus a
  section id on the app-left action contract.
- *Proof:* `pnpm --filter @hachej/boring-workspace test -- src/front/layout/workspace-shell/__tests__/shellNav.test.tsx`.
- *Negative proof:* a plugin registering an unknown section id is a typed
  error, not a silently dropped nav row; every nav destination reachable
  expanded is reachable collapsed.

**L3 — centre modes (page/dock) + Library.**
- *WHAT:* the `CenterState = {mode:"dock"} | {mode:"page"; page}` machine
  (`SaasSpike.tsx:149`, `:1447`, `:1536-1540`) with the dock genuinely
  unmounted in page mode; **Library** as the standalone workbench mount, rows
  = files + saved `ViewDescriptor` views + agent outputs; collection views
  rendered by `DataExplorer` via adapters (`SaasSpike.tsx:1021-1030`).
- *Scope:* `workspace-shell/{CenterHost,LibraryPage}.tsx`; a saved-view
  descriptor type in `src/shared/`.
- *Proof:* `pnpm --filter @hachej/boring-workspace test -- src/front/layout/workspace-shell/__tests__/centerHost.test.tsx`;
  playground e2e asserting dock layout survives a page round-trip.
- *Negative proof:* no Dockview type crosses the Library's public props; a
  saved view round-trips through the descriptor without renderer fields.

**L4 — thread view = chat + inset canvas.**
- *WHAT:* the thread page renders the **real** chat, with an inset
  `ArtifactSurfacePane` canvas summoned from a message artifact card, and
  `WorkbenchActivityRail side="right"` on the canvas
  (`SaasSpike.tsx:513-544`). This slice **consumes** jfxd **S4** — the
  message-source adapter feeding the existing `PiChatPanel` a merged
  `(turnOrdinal, seq, markerOrdinal)` stream plus agent chips and system lines
  (`job-thread-v0-plan.md:687-697`). This plan does **not** design that
  adapter; it mounts it.
- *Blocked by:* **jfxd S4** (and therefore the #1403 owner gate, S1–S3).
- *Scope:* `workspace-shell/ThreadPage.tsx` + canvas mount/teardown guards.
- *Proof:* `pnpm --filter @hachej/boring-workspace test -- .../threadPage.test.tsx`.
- *Negative proof:* nested `ArtifactSurfacePane`s never share a `storageKey`
  and never share a panel-id prefix (`SaasSpike.tsx:410-418`); a single-seat
  thread renders through the unmodified `PiChatPanel` path (jfxd S4's own
  negative proof, asserted again at the mount).

**L5 — inbox evidence mount.**
- *WHAT:* Inbox as a first-class page (not an overlay used as one — today
  `onClose={() => {}}` at `SaasSpike.tsx:352`), with the workbench mounted
  *inside* the item as the evidence viewer for the artifact under an approval.
- *Blocked by:* L3.
- *Scope:* `workspace-shell/InboxPage.tsx`; `InboxOverlayProps` gains a page
  mode (re-export already added, `plugins/ask-user/src/front/index.tsx:286-287`).
- *Proof:* extend `apps/workspace-playground/e2e/inbox-demo.spec.ts`.
- *Negative proof:* the evidence viewer opens read-only and cannot write a file
  the approving user could not otherwise write.

**L6 — popover file access.**
- *WHAT:* the full-tree popover mount — `FileTreeView` in a dismissible
  popover from the thread, so file access never costs a page switch.
- *Blocked by:* L1.
- *Scope:* `workspace-shell/FileTreePopover.tsx`.
- *Proof:* component test + playground e2e.
- *Negative proof:* opening the popover does not mutate centre state.

**L7 — playground/full-app adoption behind the flag + e2e.**
- *WHAT:* flip hosts onto `workspace-shell` behind an **off-by-default** flag
  (inverting the spike's default-on route, `saasSpikeRoute.ts:7-13`); wire the
  Search entry to the real `CommandPalette` (`index.ts:206`) — dead in the
  spike (`SaasSpike.tsx:1472-1474`); delete the playground `@` alias reach-in.
- *Blocked by:* L1–L6.
- *Scope:* `apps/workspace-playground/src/front/App.tsx`,
  `apps/full-app/src/front/main.tsx`, `apps/workspace-playground/tsconfig.json`.
- *Proof:* `pnpm test:e2e` incl. a new `workspace-shell.spec.ts`;
  `release-candidate-golden-route.spec.ts` still green with the flag off.
- *Negative proof:* with the flag off, zero pixel diff on the golden route.

---

## 4. Gates & sequencing

```
#1401 (amendment, OPEN) ──┐
                          ├─→ #1403 owner gate ─→ jfxd S1→S2→S3→S4 ─→ L4
#1382 (objectives, OPEN) ─┘                                    └→ jfxd S5

L1 ─→ L2 ─→ L3 ─→ L5, L6 ─→ L7          (no dependency on jfxd)
                    └── L4 ──────────────┘

#1355 Gate 1 (architecture approval, UNANSWERED) ─→ Console collections
        (`docs/issues/1355/plan.md:372-376`: "No implementation bead is
         ready before it") ─→ Library saved-collection persistence
```

Three independent gates; only one blocks most of this plan. **#1401 merge**
(naming/ontology amendment) blocks jfxd S1 and therefore L4 — not L1–L3, L5–L7.
**#1403's owner gate** (8 rulings, `job-thread-v0-plan.md:743-766`) blocks the
whole jfxd chain, therefore L4 only. **#1355 Gate 1**
(`docs/issues/1355/plan.md:372-376`) blocks Console collections, therefore only
the *persistence* of Library saved collections — L3 can ship the Library with
descriptor-local saved views and adopt the Console store later.

**Consequence: L1, L2, L3, L5, L6 are unblocked today.** They are the honest
first tranche. L4 waits on two other gates; L7 waits on everything.

**Two repairs owned elsewhere that L2 depends on.** #1355's
`ConsoleThreadRefV1` and its session-tuple unique key are single-seat by
construction and cannot hold a multi-participant job as one row
(`job-thread-v0-plan.md:723-725`). And `JobProjectionV0` has no lifecycle
field, so `Archived · N` has nothing to read — the owner asked for this to be
folded at jfxd S1 or filed as gate errata (#1399, 2026-08-26); session-level
archive is separately in flight as PR #1376.

---

## 5. Open questions

1. **Flag shape.** One `workspaceLayout="workspace-shell"` value, or a layout
   value plus per-surface sub-flags so L2–L6 land dark independently? The spike
   is all-or-nothing; a real rollout probably is not.
2. **Nav extensibility.** The ruled IA is fixed and ordered; today's nav is an
   open plugin contribution point (`WorkspaceAgentFront.tsx:2474-2498`). Named
   section slots (proposed in L2), a tools rail only, or IA closed to plugins?
3. **Library persistence.** Where do saved views live before #1355 Gate 1
   answers — workspace settings, a new plugin store, or descriptor-local?
4. **The chat column is unproven.** The spike explicitly refused to wire it:
   `PiChatComposerSurface` needs ~45 props whose state machine lives inside
   `PiChatPanel`, and `ChatPanelHost` needs a live workspace/session
   (`SaasSpike.tsx:1315-1324`). Contextual chat beside a *view* (not a thread)
   has no session to attach to. Does a view-scoped chat mint an ephemeral
   thread, attach to the last thread, or is it deferred past L7?
5. **One component, four mounts — is it really one?** L3–L6 each mount
   `ArtifactSurfacePane` with different chrome; the spike proved two coexist
   safely, four is untested.
6. **Kanban.** `SAAS_VIEWS` carries kanban descriptors and no kanban renderer
   exists (`SaasSpike.tsx:688-700`). In scope for Library, or deferred?
7. **`WorkbenchLeftPane` vs Library.** If the workbench is re-homed, what
   happens to today's `WorkbenchLeftPane`/`WorkbenchOverlayFrame` mounts
   (`ChatLayout.tsx:647-655`) — kept for `classic`, or migrated?
8. **Mobile.** The spike never passes `mobileShellEnabled`, so the `Sheet` path
   (`PluginTabsWorkspaceShell.tsx:138-163`) is unexercised by every §2 claim.
   Four columns on a phone is unanswered.

---

## 6. Honest status

The IA, the mounts and the centre modes are **proven by recomposition** — the
spike's real contribution, and a strong result. But the **chat**, which is what
the whole vision is about, is a **visual fixture in both places it appears**
(`SaasSpike.tsx:1380-1381`, `JobThreadView.tsx:608`). Nothing in the spike
proves a live multi-agent transcript renders in this shell; that proof belongs
to jfxd S4 + L4 and is the highest-risk item here. All entity data is fixture
(`SaasSpikeFixtures.ts`, 1064 lines) and the shell has **no component tests**.

This plan has not been reviewed. It goes to fresh-eyes + cross-model review
before the owner gate.
