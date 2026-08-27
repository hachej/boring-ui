# Task System Cleanup Proposal

## r4 — owner steer: Beads is the source of truth

Owner reviewed the r3b presentation and clarified the governing model,
verbatim: *"source of truth = beads... gh is just a source... every gh issue
-> open an epic and all associated beads are there"*.

This supersedes any r1–r3 language that treats GitHub as authoritative for
work, state, or structure:

1. **Beads is the sole task source of truth.** Status, priority, ownership,
   dependencies, execution slices, session binding, and completion live only
   in Beads.
2. **GitHub is an intake/public source, not a task store.** An issue may remain
   open as part of the public product story, but its labels and open/closed
   state never drive work.
3. **Every GitHub issue maps 1:1 to one epic bead.** Triage creates or selects
   exactly one `epic` bead with `external_ref: gh-<n>` and posts `epic:
   <bead-id>` back to GitHub. This applies even when the issue is immediately
   closed as internal or parked.
4. **All work for that issue lives beneath its epic.** Existing and future
   implementation beads are attached through strict parent/child ancestry; dependencies alone do not count as descendants. The issue epic itself may be nested beneath a broader epic; all issue-specific work remains parented to its own epic;
   child beads do not create parallel GitHub issues and do not become separate
   sources of truth.
5. **The Tasks board reads Beads only.** Fresh GitHub issues appear only in an
   intake tray until their epic exists; after conversion, the epic and its
   descendants are navigated in Beads.

Live drift check on 2026-08-20 found **348 total repository issues** (67 open,
281 closed). Of the historical 71-item cleanup cohort, 67 remain open:
#1191, #1199, #1206, and #1304 closed independently; no new open issue exists
outside the 71-row table. They still require epic mapping under the owner's
"every GH issue" rule, but no close action. With #1254 still merge-gated, the
cleanup reaches 16 open first and 15 only after its PR prerequisite is met.

The r3 public-window cleanup still governs which GitHub issues remain visible,
but M1 must create/verify the epic root and attach associated beads *before*
closing or relabeling any issue. Because r4 changes the graph topology, approval
of this plan **does not execute M1**. M1 first compiles an exact machine-readable
all-issue manifest (348 issues at the 2026-08-20 refresh, not merely the 71 open
cleanup cohort) plus the issue→epic/child actions, dry-runs it,
and returns that immutable manifest through a separate destructive-action owner
gate. The existing shell below is design pseudocode only and must never be run.

## r3 — owner steer

Owner reviewed r2 and answered "changes", verbatim: *"please do a deeper pass
on all the opened issues and classify better... I don't want a github project
with 100s issues.. gives bad image..."* and *"please include in the PR an
exact overview of all the opened issues across gh and beads... and propose a
cleanup plan..."*

What changed in r3 (details in Part 5; r1 diagnosis and r2 decisions intact):

1. **The GH issue list is the project's public face.** r2 demoted GH to a
   "window"; r3 makes the window *small*: a deeper per-issue classification of
   all 71 open issues (post-audit) into GH-PUBLIC / BEADS-ONLY / PARKED-IDEAS,
   with a **≤25 open-issue target** (r3 lands at **16**).
2. **Exact cross-system inventory (5.1–5.2).** Every open item across GH (71)
   and beads (254 non-closed) in one table, with its home(s), lane, and r3
   disposition. Builds on `docs/factory/issue-audit-2026-08-19.md` (its 26
   closes are assumed executed; its 53 KEEPs are reclassified deeper here).
3. **Cleanup command manifest (5.5)** to reach the target state — listed, not
   executed — plus the surviving-issue label taxonomy and the one-sentence
   public-window test that governs all future issue creation.
4. **Migration renumbered (5.6).** The visible GH cleanup becomes the new
   first migration step M1; r2's M1–M11 shift to M2–M12.

## r2 — owner steer

Owner reviewed r1 and answered "changes", verbatim: *"the task view has
different columns for both task systems.. this needs to be unified??? in tasks
should we actually show only beads??? if beads == gh => no need for gh no???"*

What changed in r2 (details in Part 4; Parts 1–2 measured diagnosis untouched):

1. **Unified columns (4.1).** Confirmed the divergence in code: beads adapter
   emits 7 columns, github adapter emits 5 disjoint ones, and the board UNIONS
   them (~11 columns, only `ready-for-human` shared). r2 specifies ONE unified
   column model (the boring-loop states) with a concrete mapping table per
   adapter.
2. **Beads-only default board (4.2).** Position taken: yes — the Tasks pane
   defaults to a beads-only board; GH linkage appears as an `external_ref`
   badge on the bead card. Unbeaded GH items (dependabot, other-session
   issues) surface in a compact "External intake" tray fed by the github
   adapter, not a second parallel board.
3. **GH demoted, not deleted (4.3).** r1's bidirectional mechanical sync
   (option a) is superseded by **option (b): beads-primary + one-way opt-in
   mirror beads→GH**. GH keeps only what beads cannot do: PRs/review,
   dependabot, mobile notifications, collaborator visibility, and inbound
   intake. GH boring-loop state labels stop being authoritative; bead status
   is the only work state. r1 sections 3.1 (bidirectional mirror rules) and
   the 3.6 M-bead table are superseded by 4.3/4.4.

Status: proposal (2026-08-19). Owner complaint, verbatim: "we need a cleanup of
the task management system.. not clean to have tasks in the gh issues, in the
beads graph and in the gh project.... too scattered... + no task is actually
bounded to an agent session."

All numbers below were measured on 2026-08-19 against live state
(`gh issue list`, `br list --limit 0 --json`, `gh project item-list 7`).

---

## Part 1 — Today (measured inventory)

### 1. GitHub issues

- **97 open issues.**
- State labels per boring-loop.md exist on only ~22: `ready-for-agent` 10,
  `ready-for-human` 9, `needs-triage` 2, `needs-info` 1. The other ~75 open
  issues carry **no state at all** — the state model is applied to a minority.
- **0 issue titles contain a bead id** (`wt-*`/`br-*`). Spot-checks of 6 issue
  bodies across the range (#1338, #1306, #1253, #1191, #1093, #786): **zero
  bead references**. From GitHub you cannot discover whether a bead exists for
  an issue.

### 2. Beads

- **250 non-closed beads (earlier 2026-08-19 snapshot)**: 142 open, 90 deferred,
  17 in_progress, 1 ready_for_human. This was superseded later the same day by
  the 254/21-in-progress family snapshot in §5.2. The four-bead historical delta
  was not reconstructed and neither snapshot is authorized for execution; M1
  must use and preserve a fresh exact snapshot (259 non-closed on 2026-08-20). Types: 148 task, 51 feature, 22 epic, 20 bug, 9 chore.
  `br ready` reports **83 ready** items.
- **100/250 beads reference a GH issue number**; **150 are orphans** with no GH
  ref (many legitimately internal slices, but there is no marker
  distinguishing "internal slice of GH-linked epic" from "work that exists
  nowhere the owner can see").
- Cross-reference: beads mention 97 distinct GH numbers, but only **37 of the
  97 currently-open issues** are referenced by any bead. **60 open issues have
  no bead** — they are invisible to `br ready` and thus to the factory.
- Naming: **all 250 bead ids begin `wt-391-forward-`** (133 direct, then
  `wt-391-forward-step1a-current-*` 64, `wt-391-forward-vertical-agents-epic-*`
  16, `wt-391-forward-1127-channels-plan-*` 9, …). Everything ever created
  inherits the prefix of the original epic-391 planning bead. The prefix
  carries zero information and makes ids unreadable and grep-hostile.

### 3. GitHub Project #7 ("Boring Roadmap")

- 74 items: **55 Backlog, 1 Doing, 18 Done.**
- Reality check: **17 beads are in_progress while the Project shows 1 Doing.**
  The Project is a third, hand-maintained, stale mirror. Nothing in
  `.agents/factory/` or the skills writes to it.

### 4. Session binding

- Machinery exists and is tested: `plugins/tasks/src/server/`
  (`manageTasksTool.ts` with `bind_session`, `taskSessionLinkStore.ts`,
  `taskSessionLinkEvents.ts`, `taskSessionRoutes.ts`). Store path:
  `STORE_DIR = ".pi/tasks"` inside the workspace.
- **No `.pi/tasks` store exists anywhere on this machine.** `bind_session` has
  never been used in anger. The Tasks pane can show links; there are none.
- The exec skill mandates "stamp your session id on it in the same act", but
  only via free-text bead comments. Of the first 8 in_progress beads:
  **3 have no claim comment at all**; the 5 that do use inconsistent formats
  ("Claimed by exact session…", "CLAIM: session_id=…", "session binding: …"),
  one recorded `session_id=unknown`, and several distinct beads all stamp the
  **same** `CLAUDE_CODE_SESSION_ID` (an env var inherited from the
  orchestrator, not the worker's own session). The stamps are unparseable and
  frequently wrong. "Who is working on this" is not answerable from any UI.

### 5. Ratified intent (governing docs)

- `docs/factory/VISION.md` L1: *Beads via plain `br`; GH issues = human
  intake; 1 epic = 1 GH issue = 1 worktree = 1 PR.*
- `.agents/skills/plan/SKILL.md`: *GitHub owns issues/PRs; Beads own local
  dependencies; Work Queue owns runs.*
- `docs/procedures/boring-loop.md`: state model lives as GH labels
  (`needs-triage` … `ready-for-human`), detail in comments.
- `.agents/skills/triage/SKILL.md`: "Thread equals bead: include the bead ID."

The ratified split is sound. It is simply **not enforced in either
direction**, and the GH Project was never part of it.

---

## Part 2 — Diagnosis (Delta between ratified intent and today)

1. **Three stores, no linking discipline.** The split "GH = intake, beads =
   graph" only works if every bead born from an issue back-links it *and* the
   issue forward-links the bead. Today linkage is one-directional (bead→GH,
   40% of beads), and 0% GH→bead. Result: 60 open issues the factory cannot
   see, 150 beads the owner cannot see.
2. **The GH Project is a dead mirror.** 1 Doing vs 17 in_progress beads. It is
   hand-maintained, off-spec (no doc mentions it), and actively misleading.
3. **State drift.** GH labels apply the boring-loop state model to ~22/97
   issues; bead statuses (open/deferred/in_progress) evolve independently.
   Truth about "is this being worked" lives in neither place reliably.
4. **Session binding is folklore, not mechanism.** The typed store
   (`taskSessionLinkStore`) is dead code in production; the comment convention
   is inconsistently followed and stamps env-leaked wrong ids. 3/8 in_progress
   beads are anonymous — exactly the invisibility the owner complains about.
5. **Id scheme is degenerate.** One universal `wt-391-forward-` prefix (a 2026
   epic-391 legacy) means ids convey nothing, and hierarchical suffixes
   (`…-step1a-current-xn9.5`) compound unreadably.

---

## Part 3 — The clean fix (r1 — 3.1 mirror rules and 3.6 migration superseded by Part 4)

Keep two interfaces but only one task system: **GitHub supplies intake/public
context; Beads owns all work truth**. GitHub is not a second state machine.
Every GitHub issue is converted into exactly one epic bead, and all associated
work beads live beneath that epic. The fix is **mandatory issue→epic
conversion + one-way projection + hard session binding**, not synchronization
between peer task stores.

### 3.1 One source of truth per concern

| Concern | Owner | Sync direction |
| --- | --- | --- |
| Human/external intake and public discussion | GitHub issue | source only; triage converts it to one epic bead |
| Task state, priority, ownership, dependency graph, slices, leases | Beads | sole authority; GH may receive a read-only projection |
| "What is being worked, by whom" | Bead lease + session link store | projected to Tasks pane and optionally GH |
| Roadmap / Tasks view | **Beads projection only** | epic roots with their descendant beads |

Mirror rules (mechanical, enforced by `br lint` extension + triage/plan skills):

- **Issue-born work:** triage creates or selects exactly one **epic** bead with
  `external_ref: gh-<n>` (a structured field, not prose) and posts one GH
  comment `epic: <id>`. Conversion is complete only after every already-known
  associated bead is attached beneath that epic.
- **Bead-born work:** stays GitHub-invisible by default. If a public GitHub
  issue is later opened, that issue points to the existing epic rather than
  creating a second work root.
- **Status projection:** optional, one-way, and derived from the epic bead.
  GitHub labels and issue state never overwrite bead state.
- **Child slices:** never get their own issue for the same scope. They inherit
  public context through their epic and remain navigable as its descendants.
- **Invariant:** zero repository GitHub issues (open or closed) without exactly
  one epic bead; zero issue-associated implementation beads outside that epic's
  descendant graph. At the 2026-08-20 refresh this means 348 issue→epic roots;
  future intake preserves the invariant at creation.

### 3.2 Retire the hand-maintained GH Project

Retire Project #7 as a write surface. Either archive it outright, or keep a
read-only auto-projection generated by a beadle tick (`gh project item-add` /
field-set from bead status). **No human or agent ever hand-edits it.** Given
the Tasks pane already merges githubSource + beadsSource, the recommendation
is: archive #7; the Tasks pane is the roadmap view.

### 3.3 Session binding as a hard invariant

Claim = bind, atomically, both channels:

1. `br update <id> --status in_progress --assignee <agent>` **plus**
   `br comments add <id> -m "CLAIM session=<session_id> agent=<name> model=<m> worktree=<w>"`
   in one act (single fixed format — the `CLAIM ` prefix becomes the parseable
   contract).
2. `manage_tasks bind_session` on the same bead so `taskSessionLinkStore`
   (`.pi/tasks`) has the typed link and `TaskSessionLinkEvents` fires — the
   Tasks pane then shows the session chip natively (the UI path already
   exists; this is activation, not construction).

Enforcement, smallest changes that make it real:

- **Exec skill:** replace "stamp your session id" prose with the exact
  two-command claim block, and require the worker to read its **own** session
  id from the harness (`PI_SESSION_ID` / bridge session), never inherited
  `CLAUDE_CODE_SESSION_ID` — that env leak produced today's wrong stamps.
- **Beadle tick check:** any in_progress bead with no parseable `CLAIM`
  comment and no link-store entry → auto-demote to open + corrective comment.
  This makes anonymous in_progress (3/8 today) structurally impossible.
- **UI:** Tasks pane row shows session id + agent name from the link store,
  click-through to the session. Store, events, and routes exist
  (`taskSessionRoutes.ts`); the delta is wiring bind_session into the claim
  path and a small front rendering change.

### 3.4 Naming: kill `wt-391-forward-`

New scheme: **`bd-<seq>`** (or `bd-<seq>.<child>` for slices), e.g. `bd-1412`,
`bd-1412.3`. Flat, short, greppable, no semantic prefix to go stale. Epic
membership lives in the dependency graph and `external_ref`, not the id.

Migration: `br` supports id aliasing via rename; do **not** mass-rename 250
live beads (comments, branches `exec/wt-391-forward-*`, and docs reference
them). Instead: (a) new beads get `bd-*` from a configured prefix, (b) closed
beads keep legacy ids forever, (c) the ~17 in_progress + 83 ready beads are
renamed opportunistically at claim time by the claiming worker (rename + alias
+ one comment), so the active surface converges within weeks with zero
big-bang risk.

### 3.5 Factory automation changes

- **triage:** must create/verify exactly one epic bead + `epic: <id>` GH
  comment, then attach known associated beads beneath it. GH workflow labels do
  not make work ready; readiness is a bead property.
- **plan:** slices must be descendants of the issue epic. A second epic with
  the same `external_ref` or an issue-associated orphan fails bead-ready lint.
- **exec:** claim block of 3.3; status-projection comment on close.
- **beadle:** orphan-in_progress demotion (3.3), optional Project projection
  (3.2), weekly link-integrity report (open issues with `ready-for-agent` but
  no bead → triage bead).
- **Nothing writes to Project #7.**

### 3.6 Migration plan (r1 — superseded by 4.4)

| # | Slice | Proof |
| --- | --- | --- |
| M1 | Exec-skill claim contract (fixed `CLAIM` format, own-session-id rule) + docs | next 3 claimed beads show parseable CLAIM with distinct correct ids |
| M2 | Wire `bind_session` into claim path; Tasks pane session chip | `.pi/tasks` store non-empty; screenshot of pane showing session on an in_progress bead |
| M3 | Beadle anonymous-in_progress demotion check | seeded anonymous bead auto-demoted in tick log |
| M4 | Structured `external_ref` field + `br lint` rule (epic without GH ref fails) | lint run: 0 false positives on GH-linked beads, flags seeded violator |
| M5 | Triage/plan skill updates (`bead: <id>` comment gate) | one real issue triaged end-to-end; issue shows bead comment, bead shows gh ref |
| M6 | Backfill sweep: 60 unlinked open issues → triage (bead or close-as-stale); 10 `ready-for-agent` issues linked first | `comm` recount: 0 `ready-for-agent` issues without beads |
| M7 | Archive Project #7 (or stand up read-only projection) + note in VISION | project closed/read-only; VISION delta committed |
| M8 | `bd-*` prefix config + opportunistic-rename procedure | first newly created bead is `bd-*`; one legacy bead renamed at claim with alias resolving |

Order: M1→M3 (binding, the owner's sharpest pain) can land this week; M4→M6
(linking) next; M7/M8 are cheap tails. Total: 8 beads, each one-session sized.

---

## Part 4 — r2: unified columns, beads-only view, and whether GH is needed

### 4.1 Unified column model

**The divergence, as coded today.** Each adapter ships its own
`BoringTaskBoardConfig`, and `mergeColumns` in
`plugins/tasks/src/front/TaskKanbanBoard.tsx` takes the **union** across
selected sources:

- Beads adapter (`plugins/tasks/src/server/beadsSource.ts`, `BOARD_CONFIG`
  L22–31, `statusId()` L95–105): 7 columns — `open`, `in-progress`, `blocked`,
  `deferred`, `ready-for-human`, `closed`, `other` — a 1:1 dump of native
  `br` statuses.
- GitHub adapter (`plugins/tasks/src/server/githubSource.ts`,
  `GITHUB_COLUMNS` L70–74, `issueStatus()` L163–165): 5 columns —
  `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `done` —
  derived from `WORKFLOW_LABELS`, defaulting unlabeled issues to
  `needs-triage`; `closed` ⇒ `done`.

Only `ready-for-human` overlaps, so with both sources enabled the owner sees
**~11 columns**, with semantic duplicates side by side (`open` vs
`ready-for-agent`, `closed` vs `done`). That is the "different columns for
both task systems" complaint, and it is structural, not cosmetic: neither
adapter maps into a shared model.

**The unified model: boring-loop states as the single column vocabulary.**
Both adapters map into these 7 canonical column ids (plus the existing
`unmapped` overflow from `taskBoardModel.ts`):

| Canonical column | Meaning |
| --- | --- |
| `needs-triage` | Untriaged inbound |
| `needs-info` | Blocked on a human answer |
| `ready` | Triaged, unblocked, claimable (what `br ready` returns) |
| `in-progress` | Claimed; session chip shows who |
| `blocked` | Blocked on a dependency (not a human) |
| `ready-for-human` | Agent done, awaiting owner review |
| `done` | Closed |

`deferred` beads map to a `parked` pseudo-column that is **hidden by
default** (90 deferred beads must not occupy screen space; the column picker
already supports visibility toggles).

**Mapping table — beads adapter** (`statusId()` change):

| Native `br` status | Canonical column |
| --- | --- |
| `open` | `ready` |
| `in_progress` | `in-progress` |
| `blocked` | `blocked` |
| `deferred` | `parked` (hidden by default) |
| `ready_for_human` | `ready-for-human` |
| `closed` | `done` |
| anything else | `unmapped` |

Beads have no native `needs-triage`/`needs-info`; after M5 triage is the act
of creating the bead, so a bead's existence implies triaged. `needs-info` on
a bead is expressed as `blocked` + a question comment (or `ready_for_human`),
which is already how the factory behaves.

**Mapping table — github adapter:**

| GH state/label | Canonical column |
| --- | --- |
| open + `needs-triage` or no workflow label | `needs-triage` |
| open + `needs-info` | `needs-info` |
| open + `ready-for-agent` | `ready` |
| open + `ready-for-human` | `ready-for-human` |
| closed | `done` |

GH cannot natively express `in-progress`/`blocked`; a GH issue whose linked
bead (via `external_ref`, M4) is in_progress is deduplicated out of the GH
lane anyway under 4.2, so no lossy label is invented for it.

Delta: rename/remap in both adapters' `statusId`/`issueStatus` + column
configs; `mergeColumns` then converges to one set automatically. Small,
test-covered change (`beadsSource.test.ts`, `githubSource` tests,
`TaskKanbanBoard.test.tsx`).

### 4.2 Beads-only default view — position: yes

Because Beads is the sole task source of truth (r4), a merged two-source board
is a contradiction: every converted GitHub issue would appear twice, once as
intake and once as its epic. Position:

- **Default board = Beads source only**, unified columns of 4.1, grouped or
  expandable by epic. GH linkage renders as a compact `#1234` badge on the
  epic card (from `external_ref`), click-through to GitHub. Descendant cards
  remain under the epic; there is one canonical work graph.
- **What is lost** by hiding the github adapter: (1) dependabot PRs/issues,
  (2) issues filed by collaborators or other sessions that no one has triaged
  into a bead yet, (3) anything the owner files from mobile. These are
  exactly the 60-open-issues blind spot of Part 1 — they must stay visible,
  but they are *intake*, not work-in-progress.
- **How it surfaces: an "External intake" tray**, not a second board. A
  collapsible section (pattern already exists: `TaskAttentionDisclosure`) fed
  by the github adapter, showing **only unbeaded** open items — i.e. GH items
  whose number appears in no bead's `external_ref` (the board already loads
  both sources, so the anti-join is a front-side filter; no new backend).
  Each row offers one action: **"convert to epic"** (or dismiss/close). The
  conversion creates/selects one epic, writes `epic: <id>` to GH, attaches
  known associated beads, and only then removes the item from intake. Steady
  state: the tray holds only fresh inbound + dependabot, which is what an
  inbox should hold.
- The github source stays selectable in the source menu for the rare "show
  me raw GH" audit; it is simply no longer part of the default merged view.

### 4.3 Is GH needed at all — honest answer

"If beads == gh, no need for gh" is half right: **as a task database, GH is
redundant the moment beads are enforced as primary.** But GH is not only a
task database. Roles beads cannot replace today:

- **PRs and code review.** Non-negotiable; the entire merge loop
  (boring-loop, CI, UI Review gates) is GH-native. This alone keeps the repo
  on GH regardless of where tasks live.
- **Dependabot / automated inbound.** Files issues and PRs on GH; cannot be
  told to write beads.
- **Mobile + notifications.** The owner triages from the GH app today. Beads
  have no mobile surface; the Tasks pane is desktop-hub-only.
- **Collaborator/external visibility.** Anyone without the hub (clients,
  contributors) can only see GH.

Beads' irreplaceable roles: dependency graph, `br ready` dispatch, agent
statuses/leases, offline speed. Neither tool covers the other's list — so
"delete GH" and "delete beads" are both wrong; the question is the sync
topology. Three options:

**(a) Full dual-home with bidirectional mechanical sync (r1, 3.1).**
Every GH-linked bead mirrors status both ways; GH labels stay an
authoritative *human* state model.
Cost: two authoritative state machines forever, conflict rules, projection
comments on every transition, `br lint` + beadle policing both directions.
Highest ongoing complexity; Part 1 shows even one-directional discipline was
never achieved (0% GH→bead links). Sync you must police is sync that drifts.

**(b) Beads-authoritative + mandatory issue→epic conversion + optional
one-way projection to GH.** Epic status is the *only* work state. Every inbound
GitHub issue converts to exactly one epic bead, whether the issue remains
public, closes as internal, or parks. A public epic may be flagged `mirror:gh`;
beadle/exec then posts a derived status comment and closes the issue when the
epic closes. Nothing on GH is authoritative for work. Boring-loop state labels
are retired as a state machine (at most a cosmetic `tracked-in-beads` label +
projected status).
Cost: one projection path (write-only, idempotent, can lag harmlessly);
mobile *edits* by the owner on mirrored issues don't flow back — a GH
comment saying "state lives in bead X" plus the intake tray covers the gap
(an owner comment on the issue is itself intake the triage loop sees).

**(c) Beads-only; GH = pure inbox.**
Triage converts every inbound issue to a bead and **closes the issue
immediately** ("tracked as bead X").
Cost: external filers watch an issue that closes minutes after filing with
no visible progress — hostile to collaborators and to the owner's own mobile
review habit; epic-level visibility ("1 epic = 1 GH issue = 1 PR",
VISION L1) disappears; PRs lose a meaningful issue to link. Saves only the
projection path that (b) already makes trivial.

**Decision: (b), sharpened by r4.** GH is a source/window, never a task
system. Every GH issue has one epic bead; all associated beads sit beneath it.
Only public epics receive optional one-way projection. This keeps the four
GH-only roles while preserving one state machine and one navigable work graph.

### 4.4 Revised migration beads (supersedes 3.6)

M1–M4 unchanged from r1. M5–M7 amended for one-way mirroring; M9–M11 new
for the unified board. M8 unchanged.

| # | Slice | Δ vs r1 | Proof |
| --- | --- | --- | --- |
| M1 | Exec-skill claim contract (fixed `CLAIM` format, own-session-id rule) | unchanged | next 3 claimed beads show parseable CLAIM with distinct correct ids |
| M2 | Wire `bind_session` into claim path; Tasks pane session chip | unchanged | `.pi/tasks` store non-empty; pane shows session on an in_progress bead |
| M3 | Beadle anonymous-in_progress demotion check | unchanged | seeded anonymous bead auto-demoted in tick log |
| M4 | Structured `external_ref` field + `br lint` rule + `mirror:gh` flag | +mirror flag | lint flags seeded violator; flag round-trips in `br list --json` |
| M5 | Triage skill: issue → bead + `bead: <id>` GH comment; **retire boring-loop labels as authoritative** (cosmetic `tracked-in-beads` only) | amended: labels demoted, no GH-side state machine | one real issue triaged end-to-end; bead exists, issue commented, no state label added |
| M6 | Backfill sweep: 60 unlinked open issues → bead or close-as-stale | unchanged | recount: 0 open `ready-for-agent` issues without beads |
| M7 | Archive Project #7 | unchanged (projection variant dropped — the beads board is the view) | project closed; VISION delta committed |
| M8 | `bd-*` prefix config + opportunistic-rename procedure | unchanged | first new bead is `bd-*`; one legacy bead renamed at claim with alias |
| M9 | **Unified column model (4.1)**: remap `statusId()`/`issueStatus()` + both `BOARD_CONFIG`s to canonical columns; `parked` hidden by default | new | both-sources board shows 7 columns, zero duplicates; adapter tests updated |
| M10 | **Beads-only default board + External intake tray (4.2)**: default source = beads; unbeaded-GH anti-join tray with "triage → bead" action | new | screenshot: single board, GH badge on a linked bead, dependabot item in tray |
| M11 | **One-way mirror beads→GH (4.3b)**: beadle/exec project status comment + close for `mirror:gh` beads; drop r1's bidirectional rules | replaces r1 3.1 sync | close a mirrored bead → issue auto-comments and closes; re-run is idempotent |

Order: M1→M3 this week (binding pain, unchanged); M9 next (pure UI fix, the
owner's most visible complaint, independent of everything else); M4→M6 then
M10→M11 (linking, then the beads-primary view and mirror); M7/M8 cheap
tails. Total: 11 beads, each one-session sized.

---

## Part 5 — r3: the public window made small (deep classification + cleanup plan)

### 5.0 The public-window test (the rule going forward)

> **A GitHub issue stays open only if an outside reader — prospect,
> collaborator, or contributor — should see it as part of the product's
> public story (a real epic, a user-facing defect worth acknowledging, or
> something an outsider can act on); everything else is born and lives as a
> bead.**

Every GitHub issue is intake and triage *always* creates or selects exactly one
epic bead for it, then attaches all associated beads beneath that epic. The
public-window test decides only whether the GitHub issue stays open; it never
decides whether an epic exists. Owner review happens through the epic's
`ready_for_human` state and the Inbox, not through a GH workflow label.

### 5.1 Cross-system inventory — all 71 open GH issues (post-audit)

Baseline: `docs/factory/issue-audit-2026-08-19.md` closes 26 of 97; this
table classifies the remaining **71** (audit KEEP + PARK). Measured live
2026-08-19 (`gh issue list --state open`: 71). Dispositions:

- **GH-PUBLIC** — stays open, clean title + labels (5.3 taxonomy).
- **BEADS-ONLY** — closed on GH with a "tracked internally" comment; a bead
  carries the full content with `external_ref: gh-<n>` back-link. Nothing is
  lost; it leaves the public window.
- **PARKED** — closed on GH; parked bead with label `idea` (deferred status).

| GH # | Title (short) | Lane | Bead today | r3 disposition |
| --- | --- | --- | --- | --- |
| 371 | Codex context-overflow crash | bugs | `bug-371-context-overflow-n0z` | BEADS-ONLY |
| 391 | Program: domain-routed agent workspaces | 391 | `xn9`/`2md` families | **GH-PUBLIC** (program anchor) |
| 601 | provisionWorkspace=false kills remote chat | bugs | `bug-601-provision-remote-eal` | BEADS-ONLY |
| 790 | Layout state per session | backlog | — → new parked bead | PARKED |
| 819 | Observability / usage metering | backlog | `fwh` (OB0) exists → add `idea` | PARKED |
| 848 | Retire boring-pi | backlog | — → new parked bead | PARKED |
| 857 | Concurrent playground rebuild races | backlog | — → new parked bead | PARKED |
| 873 | ask_user refresh bug | A | `bug-873-askuser-refresh-0dg` | BEADS-ONLY |
| 877 | Fly/Neon decommission | owner | — → new bead (`ready_for_human`) | BEADS-ONLY (internal ops; not public-facing) |
| 882 | tldraw alternative | backlog | — → new parked bead | PARKED |
| 883 | Stale app-left indicator | owner | `bug-883-stale-indicator-9th` | BEADS-ONLY |
| 900 | Composio full-catalog mode | C | `rjkl.2` | BEADS-ONLY (slice of 1129; child slices get no issue) |
| 905 | AgentHost/Gateway extraction | 391 | `0jpy` family | **GH-PUBLIC** (architecture epic) |
| 1009 | Streaming durability B→D | 391 | `0jpy.8`, `1009-*-ek2/204` | BEADS-ONLY (internal lane of 905) |
| 1011 | User-registered MCP lane | C | `1011-*` family (6 beads) | BEADS-ONLY (lane of 1129) |
| 1028 | Remove dead MessageTimeline | mech | — → new bead | BEADS-ONLY |
| 1060 | Post-AgentHost Wave-1 guarantees | owner | — → new bead (`ready_for_human`) | BEADS-ONLY |
| 1081 | Epic: sandbox worker runtime | 391 | `6gd` family | **GH-PUBLIC** |
| 1082 | Epic: BYOK tenant keys | 391 | `16f` family | **GH-PUBLIC** |
| 1083 | Playground-on-worktree pane | backlog | — → new parked bead | PARKED |
| 1084 | Outreach links idea | backlog | — → new parked bead | PARKED |
| 1094 | Questionnaire UX for ask_user | backlog | — → new parked bead | PARKED |
| 1106 | Epic: production fleet loader | 391 | `xp3s` family | **GH-PUBLIC** |
| 1107 | Epic: agent as plugin package | 391 | `xp3s.4`, `sl7` | **GH-PUBLIC** |
| 1110 | Epic: UI surface optimization loop | A | `gb0o` (epic) | **GH-PUBLIC** |
| 1123 | Epic: executable environments | 391 | `1123-exec-env-plan-45l` | **GH-PUBLIC** |
| 1125 | Epic: automation run leases | 391 | new #1125 epic nested under #905 epic; issue-specific children under #1125 | **GH-PUBLIC** |
| 1127 | Epic: external channels (WhatsApp…) | vert | `4fv` family | **GH-PUBLIC** |
| 1129 | Epic: MCP ingress | C | `rjkl` family | **GH-PUBLIC** |
| 1167 | Nonce-store sub-budget (LOW) | backlog | — → new parked bead | PARKED |
| 1171 | Reload-agent affordance | A | new #1171 epic nested under #1110 epic; work child under #1171 | BEADS-ONLY |
| 1177 | Epic: visual project documentation | docs | — → new bead | **GH-PUBLIC** |
| 1185 | Remove runtime-identity v1 seam | 391 | — → new bead (near `nnn`) | BEADS-ONLY |
| 1187 | Epic: factory-on-CLI dogfood | B | `d5nj` (epic) | **GH-PUBLIC** |
| 1189 | Instruction refs in CLI hub | B | new #1189 epic nested under #1187 epic; work child under #1189 | BEADS-ONLY |
| 1190 | Pane-resizer unification | A | new #1190 epic nested under #1110 epic; work child under #1190 | BEADS-ONLY |
| 1191 | Local hosts read AGENTS.md | B | `d5nj.2` | BEADS-ONLY |
| 1196 | Ambient-skill symlink 500s | B | `d5nj.3` | BEADS-ONLY |
| 1199 | Flaky insufficient-credit test | B | `d5nj.1` | BEADS-ONLY |
| 1206 | HTML viewer mermaid render | B | `7dw1` | BEADS-ONLY |
| 1210 | Epic: CH trades vertical | vert | `nfgt` family | PARKED (business strategy; not for public window) |
| 1213 | Idea: Swiss admin agent | vert | `nfgt.11` | PARKED |
| 1214 | Idea: Swiss tax agent | vert | `nfgt.12` | PARKED |
| 1215 | Idea: health-insurance broker | vert | `nfgt.13` | PARKED |
| 1216 | Idea: commercial-register agent | vert | `nfgt.14` | PARKED |
| 1217 | Idea: Swiss case-law agent | vert | `nfgt.15` | PARKED |
| 1223 | Retire BORING_AGENT_FLEET flag | B | new #1223 epic nested under #1187 epic; work child under #1223 | BEADS-ONLY |
| 1224 | Epic: batch transcription | backlog | — → new parked bead | PARKED |
| 1226 | Epic (REWRITE NEEDED): bounded tool catalog | backlog | — → new parked bead | PARKED |
| 1233 | DX onboarding 6→2 concepts | B | new #1233 epic nested under #1187 epic; work child under #1233 | BEADS-ONLY |
| 1240 | Sandbox provider registry refactor | backlog | — → new parked bead | PARKED |
| 1253 | ui-review mktemp leak | B | `d5nj.4` | BEADS-ONLY |
| 1254 | /tmp aging + pnpm-store rule | B | `d5nj.5` (PR #1320 open) | BEADS-ONLY (close after #1320 merges) |
| 1261 | Epic: hosted external plugins (Seneca) | D | — (epic; children beaded) | **GH-PUBLIC** |
| 1274 | delegate_task plugin | D | new #1274 epic nested under #1261 epic; work child under #1274 | BEADS-ONLY |
| 1275 | Governed search/fetch plugin | D | new #1275 epic nested under #1261 epic; work child under #1275 | BEADS-ONLY |
| 1276 | Orchestrator agent plugin | D | `rctz` | BEADS-ONLY |
| 1290 | Composer shows stale model | A | `9jxj` | BEADS-ONLY |
| 1295 | Stop deletes queued messages | A | `wul5` | BEADS-ONLY |
| 1296 | Generic Agent seat in factory ws | A | `yqvu` | BEADS-ONLY |
| 1297 | No tabs for file surfaces | A | `n9bd` | BEADS-ONLY |
| 1298 | Archive-session context menu | A | `kjz8` | BEADS-ONLY |
| 1300 | Automation session missing | A | `gb0o.1` | BEADS-ONLY |
| 1303 | Mobile: 4.3MB eager bundle | A | `ybkr` (in_progress) | **GH-PUBLIC** (user-facing perf commitment) |
| 1304 | Inline artifact list (PR #1312 open) | A | `gb0o.2` | BEADS-ONLY (close when #1312 merges) |
| 1306 | ask_user stale-intention supersede | A | — → new bead | BEADS-ONLY |
| 1307 | Session rename reverts | A | `4yi6` | BEADS-ONLY |
| 1314 | Ledger outside user workspace | 391 | `0jpy.14` | BEADS-ONLY |
| 1323 | No optimistic echo on send | A | new #1323 epic nested under #1110 epic; work child under #1323 | BEADS-ONLY |
| 1337 | Inbox placeholder titles | A | `p820` | BEADS-ONLY |
| 1338 | Session-inventory 16s scan | A | `s4wq` | BEADS-ONLY |

**Executable per-row split: GH-PUBLIC 15 · BEADS-ONLY 38 · PARKED 18**
(15+38+18 = 71). r4 resolves the earlier 16/37 headline discrepancy in
favor of the per-row table, which is the manifest's execution source. Target
≤25 remains met with headroom.

New child beads required by the per-row table: 13 work children (877, 1028,
1060, 1171, 1185, 1189, 1190, 1223, 1233, 1274, 1275, 1306, 1323) + **11**
parked-idea children (790, 848, 857, 882, 1083, 1084, 1094, 1167, 1224,
1226, 1240) = **24 new children**. #819 reuses existing `fwh` and only adds
`idea`; it is not counted as a new bead. 1210/1213–1217 are already covered by the `nfgt` family (add
`idea` label). Every close comment names its bead; every bead carries
`external_ref: gh-<n>`.

### 5.2 Beads family summary — measured 254 snapshot (not the executable inventory)

Beads are internal, so no bead is closed for image reasons. The table below is
a family summary of the 2026-08-19 measurement (`br list --json`: 142 open,
90 deferred, 21 in_progress, 1 ready_for_human); approximate rows and ellipses
make it unsuitable for execution. M1 must capture every current non-closed bead
ID exactly once in its machine-readable snapshot and report drift from this
historical 254 baseline before the destructive-action gate.

| Bead family | Count | GH home | r3 disposition |
| --- | --- | --- | --- |
| `xn9*` (D28 Step-1A foundation) | 65 | #391 | keep; 40 deferred stay `parked` (hidden column, 4.1) |
| `0jpy*` (909 AgentGateway) | 15 | #905 | keep |
| `xp3s*` (fleet loader / agent pkg) | 9 | #1106/#1107 | keep |
| `16f*` (BYOK) + `byok-*` | 10 | #1082 | keep |
| `6gd*` (SBX1 sandbox) | 10 | #1081 | keep |
| `rjkl*` (MCP ingress) + `1011-*` + `x35`/`c2z` | 13 | #1129 | keep; 1011 children back-link closed #1011 |
| `4fv*` (WhatsApp channels) | 9 | #1127 | keep |
| `nfgt*` (Swiss verticals) | 12 | closed #1210/#1213–17 | keep, add `idea` label to backlog entries |
| `gb0o*` + Lane-A singles (`9jxj wul5 yqvu n9bd kjz8 4yi6 p820 s4wq ybkr` …) | 14 | #1110 + closed children | keep |
| `d5nj*` (factory-on-CLI) + `7dw1 tm49` | 9 | #1187 + closed children | keep |
| `2md*` (391 story index) | 6 | #391 | keep |
| `pmz*` (task-session binding MVP) | 7 | #775 (closed) | keep — this proposal's own execution lane |
| Deferred marketplace/identity/transport (`ID1/T1/T2/AC1/AR1/MK1/BL1/CH1/X1/P2` singles) | ~35 | #391 | keep `parked` (hidden by default) |
| Bug singles (`n0z eal 0dg 9th itk xqj`) | 6 | closed GH bugs | keep |
| Chores/follow-ups (`nnn 0zq pke 9sr do3 hxi m46 za5 ld9` …) | 9 | — | keep, beads-only by design |
| Factory/meta (`4u4r c6zh g5em 95nr ca3b rn4m ez6 t4g yeh sl7` + seneca competitor 2) | 12 | — | keep |
| + 13 new work children + 11 new parked children from 5.1 | 24 | closed GH refs | future post-migration additions; excluded from the measured 254 |

The M1 dry-run must predict that, after the separately approved destructive
migration, **all repository issues** have exactly one epic bead (348 at the
2026-08-20 refresh), including the 71-item cleanup cohort, older closed issues,
and the 15 public survivors. It must also predict every associated implementation
bead beneath the corresponding epic. No graph state is claimed achieved by M1.

### 5.3 Label taxonomy for the surviving 15

Retire boring-loop state labels from GH (per 4.3b; state lives in beads).
Surviving issues carry exactly: one **type** — `epic` (13) or `bug` (#1303) /
`program` (#391) — plus at most one **area**: `platform` (905, 1081, 1082,
1106, 1107, 1123, 1125), `ui` (1110, 1303), `mcp` (1129), `channels` (1127),
`plugins` (1261), `devx` (1187), `docs` (1177). Titles: strip `[epic #n]` /
`Epic:` prefixes into the `epic` label; each title states the capability, not
internal jargon.

### 5.4 Steady state

- **GH open ≈ 15–25**: program anchor, product epics, and the rare
  user-facing bug worth public acknowledgment. Curated, labeled, current.
- **Beads = everything**: all engineering truth, graph, states, session
  bindings. Each GH issue has one epic root; all associated work is below it.
- Fresh inbound (mobile-filed, collaborator, dependabot) lands on GH, hits the
  External-intake tray (4.2), and is converted to exactly one epic before any
  work starts. The public-window test then decides whether GH remains open or
  closes with the `epic: <id>` pointer.

### 5.5 Migration design pseudocode (NOT executable; exact manifest is M1 output)

Prereq: the audit's 26 closes (`issue-audit-2026-08-19.md`) executed first.
This block documents ordering only. It contains placeholders and must not be
run. M1 generates a separate immutable JSON manifest with every repository issue
(348 at refresh), a tagged 71-row public-cleanup cohort, refreshed GH state,
every exact associated bead ID, canonical epic action,
strict parent action, labels/titles, and expected counts. A dry-run validates
that manifest before a separate owner gate can authorize mutation. No executor
may infer a wildcard/family membership or choose a parent at run time.

```bash
# --- 0) issue -> epic conversion for ALL repository issues (348 at refresh) ---
# For each GH number in the 5.1 table, create/select exactly one epic:
epic=$(br create --silent --type epic --slug "gh-${n}" \
  --title "GH #${n}: ${title}" --external-ref "gh-${n}")
# If a canonical epic already exists, use it instead; never create a second one.
# Attach every bead named in that row's "Bead today" cell beneath $epic:
br update "$child" --parent "$epic"
# Record the canonical pointer on GitHub:
gh issue comment "$n" --body "epic: ${epic}\nWork state and all associated beads live in Beads."

# Hard stop before phase 1 unless the generated all-issue report proves:
# - every repository GH issue (348/348 at refresh) has exactly one epic ref
# - every bead named by 5.1 is a descendant of that epic
# - no duplicate epic external_ref and no associated orphan

# --- 1) create the 13 missing work beads as CHILDREN of their issue epics ---
# pattern; repeat only for these issue rows, with full GH body copied:
br create --type task --parent "$epic" --title "<gh title>" --external-ref gh-877  # + 1028 1060 1171 1185 1189 1190 1223 1233 1274 1275 1306 1323
# Each work child is parented to its OWN issue epic. The issue epic may itself
# be nested beneath a broader epic (for example #1171 epic under #1110 epic),
# preserving both strict issue ancestry and the broader product hierarchy.

# --- 2) create the 11 parked-idea CHILD beads beneath deferred issue epics ---
br create --type task --parent "$epic" --status deferred --label idea --external-ref gh-790 --title "Layout state per session"   # + 848 857 882 1083 1084 1094 1167 1224 1226 1240
br label add fwh idea            # 819 already beaded
br label add nfgt idea           # vertical batch already beaded (nfgt, nfgt.6-15)

# --- 3) close the 38 BEADS-ONLY issues (epic pointer required) ---
for n in 371 601 873 877 883 900 1009 1011 1028 1060 1171 1185 1189 1190 \
  1191 1196 1199 1206 1223 1233 1253 1274 1275 1276 1290 1295 1296 1297 \
  1298 1300 1306 1307 1314 1323 1337 1338; do
  epic=$(br list --limit 0 --json | jq -r --arg ref "gh-$n" \
    '.issues[] | select(.issue_type=="epic" and .external_ref==$ref) | .id')
  test "$(printf '%s\n' "$epic" | grep -c .)" -eq 1 || exit 1
  gh issue close "$n" -c "Cleanup 2026-08-19: work source of truth is epic ${epic} in Beads; all associated work lives beneath it."
done
# 1254 and 1304: same lookup/comment, but only after PR #1320 / #1312 merge.

# --- 4) close the 18 PARKED issues ---
for n in 790 819 848 857 882 1083 1084 1094 1167 1210 1213 1214 1215 1216 1217 1224 1226 1240; do
  epic=$(br list --limit 0 --json | jq -r --arg ref "gh-$n" \
    '.issues[] | select(.issue_type=="epic" and .external_ref==$ref) | .id')
  test "$(printf '%s\n' "$epic" | grep -c .)" -eq 1 || exit 1
  gh issue close "$n" -c "Cleanup 2026-08-19: parked as epic ${epic} in Beads (deferred/idea); all associated work remains beneath it."
done

# --- 5) relabel + retitle the surviving 15 per 5.3 ---
gh label create epic --color 5319E7 -d "Product epic" 2>/dev/null || true
for n in 905 1081 1082 1106 1107 1110 1123 1125 1127 1129 1177 1187 1261; do gh issue edit "$n" --add-label epic; done
gh issue edit 391 --add-label program; gh issue edit 1303 --add-label bug
# strip "Epic:" prefixes: gh issue edit <n> --title "<clean capability title>"

# --- 6) verify target state ---
gh issue list --state open | wc -l    # expect 16 while #1254 is merge-gated
# after #1254 prerequisite + close: expect 15 (+ any fresh inbound)
```

### 5.6 Migration table (r4 adds a gated M1a/M1b pair)

M1a compiles and proves the immutable manifest. A separate owner gate names its
exact SHA. M1b is the only slice allowed to apply it, and must abort on any live
state drift; it creates/links epic roots and performs the 71-cohort cleanup.

| # | Slice | Proof |
| --- | --- | --- |
| **M1a (r4)** | **Compile + dry-run immutable migration manifest; no mutation.** Refresh all repository GH issues (open + closed) and Beads, tag the historical 71-row cleanup cohort, enumerate every current non-closed bead exactly once, resolve each exact epic/parent action, and produce expected intermediate/final counts. Then raise a destructive-action owner gate naming the manifest SHA. | schema-valid manifest; all issues mapped (348/348 at refresh); every live bead appears once in snapshot; zero wildcard/prose IDs; dry-run proves uniqueness/ancestry and reports drift |
| **M1b (r4, separately gated)** | **Apply exactly the approved immutable manifest.** Verify its SHA and expected GH/Beads snapshot still match; abort on drift. Create/select all canonical epics, attach exact children, post pointers, then apply the 71-cohort closes/labels/titles. | all repository issues have exactly one epic; all associated beads are strict descendants; 71-cohort reaches 16 open while #1254 is gated and 15 after its prerequisite; rerun is idempotent |
| M2 | Exec-skill claim contract (r2 M1) | unchanged |
| M3 | bind_session wiring + session chip (r2 M2) | unchanged |
| M4 | Beadle anonymous-in_progress demotion (r2 M3) | unchanged |
| M5 | Structured `external_ref` + lint: exactly one epic per GH ref; associated beads must be descendants; optional `mirror:gh` | seeded duplicate epic and associated orphan both fail lint |
| M6 | Triage skill: GH source → one epic + attach descendants + public-window decision; retire GH state labels | issue triaged end-to-end: epic pointer posted, descendants attached, work state only in Beads |
| M7 | Post-M1b integrity sweep (r2 M6): verify **every** current open GH issue has exactly one epic and every associated bead is a descendant | all current open issues mapped; zero duplicate epic refs; zero associated orphans |
| M8 | Archive Project #7 (r2 M7) | unchanged |
| M9 | `bd-*` prefix + opportunistic rename (r2 M8) | unchanged |
| M10 | Unified column model (r2 M9) | unchanged |
| M11 | Beads-only default board + intake tray; action is `convert to epic` and board navigates epic descendants | converted issue leaves intake; one epic tree appears |
| M12 | Optional one-way epic→GH projection for public issues only (r2 M11) | derived status is idempotent; GH never mutates bead state |

Order: **M1a → destructive-action owner gate → M1b**; then M2→M4 (binding), M10 (columns), M5→M7, M11→M12, M8/M9 tails.
