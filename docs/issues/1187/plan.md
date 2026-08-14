---
github: https://github.com/hachej/boring-ui/issues/1187
issue: 1187
state: ready-for-human
updated: 2026-08-10
flag: not-flaggable
track: owner
---

# gh-1187 migrate the Boring Factory onto the boring-ui CLI workspace

> **Historical plan:** this document records the owner-ratified S0 migration
> baseline, including its then-current three-seat roster. The later approved
> `docs/factory/orchestrator-loop-plan.md` supersedes that roster: the live
> fleet is now `orchestrator` + `worker`, with triage run as a worker automation
> slot. Historical acceptance and proof below are intentionally preserved.

Plan revision **r1** — owner gate. Nothing here is implemented; the gate decides
the target operating model, the gap dispositions, and the slice order.

## Problem

The Boring Factory (`.agents/factory/`, `docs/factory/VISION.md`, ratified
2026-08-05, landed via #1075) is **specified as a boring-ui workspace app but
executed as a Claude Code app.** Every ratified moving part maps to a boring-ui
primitive on paper (VISION, "Factory runs on boring-ui primitives"), yet in
practice the loop runs from Claude Code sessions driving `br`, `gh`, `git`, and
shell-dispatched codex runs. The control plane is a human reading transcripts.

Three costs follow:

1. **We do not dogfood our own control plane.** The 2026-08-08 state report
   (`docs/direction/state/2026-08-08.md`, VISION row 6) names it: "Missing:
   cross-surface session observability, unified approval inbox across surfaces."
   We are the only user who would find that daily, and we do not.
2. **Owner attention is the real concurrency ceiling.** Watching N transcripts is
   O(N) owner time — not `beadle.worker_cap`.
3. **Feedback has to travel through the orchestrator.** Owner, ratified:

   > *"if I want to give feedback to a worker, I just jump into the worker
   > session instead of feeding it through the orchestrator."*

   That is impossible today: a Claude Code subagent has no addressable session
   the owner can open. Correcting a worker means telling the orchestrator to
   tell the worker — lossy, slow, and the reason bad work runs to completion.
   **Direct-to-worker steering is the point of this migration**, not a bonus.

## Today

Brutally: **the factory is authored, not running.** `.agents/factory/` is a
complete stage contract with almost no executing code behind it.

### What actually executes today

| Factory part | Ratified home | What actually runs today |
| --- | --- | --- |
| Work graph | Beads `br` CLI | **Real.** `br` v0.2.16; canonical graph is the primary checkout's `.beads/` (committed). Worktree sessions must pass `--db <canonical>/.beads/beads.db` or they write a stale branch snapshot (gh-1051, found the hard way). |
| Seats (concierge/triage/steward/worker/reviewer) | AgentHost fleet + `.agents/personas/*` | **Config only, product-side.** `loadConfiguredAgentFleet()` reads `fleet.yaml` seats + `policy.yaml` `models.seats` tiers, resolves a model per seat from `MODEL_TIER_CANDIDATES` (first candidate whose API key env var is present), pulls instructions from `.agents/personas/<seat>/package.json#boring.agent.instructionsRef`, and verifies pinned skill digests (mismatch = that seat is dropped, fleet survives). Gated on `BORING_AGENT_FLEET=1`; wired into the CLI hub (`packages/cli/src/server/modeApps.ts:954`), workspace, core, and playground. **No factory work has ever been done by one of these seats.** |
| Dispatch | pull-based worker + Beadle supervisor | **Neither exists.** No Beadle, no policy parser beyond `models.seats`. Dispatch today = the owner, or an orchestrating Claude Code session, spawning subagents and `codex exec` shells by hand. `docs/factory/TODO.md` step 4: "Beadle missing". |
| Worker execution | pi sessions, 1 bead = 1 session | Claude Code sessions in `.worktrees/<lane>`. Durable sessions, lease heartbeats, handoff-before-compaction are **procedure text obeyed by convention**; nothing enforces them. Workers are not addressable — the owner cannot open one. |
| Human gates (plan approval, merge approval) | Inbox Human Intentions via `ask_user` | **Chat and GitHub comments.** The machinery is real and complete — `ask_user` blocks the agent turn on a persisted question and resolves it from the answer route, surfaced both inline in the transcript (#1090) and in the Inbox overlay — but the factory does not run inside a workspace that could raise into it. |
| Model routing | MODEL-CARD tiers, seat→tier in `policy.yaml` | **A human picking a CLI.** Claude Code `model:` override for Fable/Opus/Sonnet; `codex exec` shell for Sol/Terra/Luna. `policy.yaml models.seats` is read only by the fleet loader, which nothing in the factory path invokes. |
| Trust ladder / class-A auto-merge | policy gate | **Not built.** All merges owner-reviewed ad hoc (factory TODO step 5). |
| Review handover | present-pr artifact | **Landing, and out-of-band.** `scripts/present-pr.mjs` on PR #1180 (OPEN); #1184 (OPEN) makes it *every* implementation's deliverable. Delivered as a claude.ai artifact or a local file. |
| Live demo for owner validation | — | **Ad hoc.** A dev server on some port plus "go look at localhost:xxxx" in chat. `visual-review.md` requires keeping the playground running; the owner has to leave the workspace to see it. |
| Board rendering | `plugins/tasks` Beads adapter | Read-only Beads + GitHub sources merged (#1075). Nobody works from the board. |
| Loops (CI watch, lane heartbeat) | `plugins/boring-automation` | Plugin is real: cron + timezone + `model` + `agentTypeId` + prompt → dispatches an agent turn into a session. **Zero factory automations defined.** |

### The one-sentence Today

*The factory's authority files are correct and unexecuted; its actual runtime is
Claude Code plus three CLIs, and the owner's terminal is the console.*

### Product substrate available to receive it

Merged on `main`: CLI hub with a multi-workspace registry (`~/.boring-ui/workspaces.yaml`,
one shared agent host, per-request workspace scoping); `BORING_AGENT_FLEET`
fleet loader (#1114); multi-agent addressed UI (#1102) and per-agent cards
(#1149); per-automation agent selection **server-side** (#1143 — the UI still
has no agent picker); Tasks (Beads + GitHub adapters, kanban, `epic` grouping,
task↔session links); Automations (cron/manual, durable stores); ask-user with
inline questions (#1090) and the Inbox overlay (#1088); durable event store
behind `BORING_CHAT_DURABLE_STREAM`; `BORING_AGENT_SESSION_ROOT` for file-backed
session dirs; sandboxed-iframe HTML viewer in the filesystem plugin.

Queued: persona packages #1107 (#1150 discovery / #1168 `knowledge/` fs / #1175
workspace install via `.pi/settings.json#packages`) — **none on main**; BYOK
(#1145, #1151); durable-stream readiness (#1142); runtime identity (#1147);
present-pr (#1180/#1184).

## Delta — the prerequisite

**PR #1176 (`feat/left-pane-polish`, "nested left-pane polish + Agent details
capability inventory") is a hard prerequisite for slice S1.** It is the
multi-agent *view* — the post-#1102 surface where agent rows aggregate
liveliness (pulsing accent count for working chats, amber count for chats
waiting on the user), placement shortcuts open sessions side by side, and the
Agent details overlay inventories what a seat actually is (instructions,
knowledge, skills, tools, MCP grants, resolved model) via
`GET /api/v1/agents/:agentTypeId/describe`.

That surface is the control-plane replacement for reading Claude Code
transcripts: **one glance answers "which seats are working, which are blocked on
me"** — the two facts the owner reconstructs by hand today. Without it, moving
work into the workspace makes observability *worse* than the terminal, and the
migration deserves to fail its first lane.

Consumers of #1176 in this plan:

- **S1** (first lane as a workspace session) — liveliness counts are the proof a
  running lane is visible without opening a transcript.
- **S2** (direct-to-worker steering) — side-by-side placement is how the owner
  drops into a worker session next to the orchestrator instead of switching context.
- **S4** (owner gates) — the amber "waiting on user" aggregate is the pull signal
  into the Inbox.
- **S6** (seats become real) — the Agent details overlay is how we verify a seat
  composed from `fleet.yaml` + `policy.yaml` resolved the tier we intended.
  That fact is invisible today.

This plan does not block on the merge. Slices are written against the merged
shape; S1 does not start until #1176 is on `main`. If #1176 slips, the sequence
holds and the start date moves — we do not reorder around it, because the
observability surface *is* the point.

## Solution — the target operating model

One rule decides every mapping: **an activity moves to the workspace when the
workspace can be its authority, not merely its viewer.**

### Session topology (ratified)

**One pinned orchestrator session + one worker session per lane/bead** (plus a background `triage` seat that holds no lane).

- **The orchestrator session is persistent and pinned** — the owner's standing
  counterpart, held by the `steward` seat. It is never recycled per epic; its
  durable state lives in beads and notes, never in accumulated context
  (VISION decision 17). It is where conversation, planning, and re-planning
  happen.
- **Worker sessions are per lane/bead**, one durable session per bead
  (VISION decision 5), each with a lane worktree as its cwd, each addressable
  and openable by the owner.
- **The owner may steer any worker directly.** This is the ratified feedback
  model, quoted above. The orchestrator is **outcome-oriented** and does not observe
  those conversations: see "Steering and the outcome-oriented orchestrator" below.

Compared with today — one Claude Code session that both plans and spawns opaque
subagents — the topology change is that *the worker becomes a first-class
addressable thing* rather than a subprocess of the orchestrator.

### Worker handoff = always two artifacts (ratified)

Every implementation ends with **both**, and the Inbox intention links both:

1. **The present-pr review artifact** (#1180 PoC, #1184 convention) — the
   context-first mermaid seam diagram plus filterable diffs. It **must be
   openable in the workspace UI**, not only on claude.ai.
2. **A live demo the owner can inspect directly in the UI** — the running
   surface, in a workspace pane, not a "go to localhost:5xxx" line in chat.

Artifact (1) is close to free: the filesystem plugin's HTML viewer renders
sanitized HTML in a sandboxed iframe (`srcDoc`, `allow-scripts`), so a
self-contained present-pr page written into the lane worktree opens as a pane
today. Artifact (2) is a real gap — see **G5**.

### Moves

| Factory activity | Workspace surface | What "moved" means |
| --- | --- | --- |
| Dispatch, planning, owner conversation | **Pinned orchestrator session** | The standing counterpart replaces the orchestrating Claude Code session. |
| Lane = one epic worktree worked by a session | **Worker session per lane/bead**, seat-addressed | `.worktrees/<lane>` stays the cwd; the transcript lives under `BORING_AGENT_SESSION_ROOT`. |
| Watching lanes | **Fleet view** (#1102 + #1176) | Liveliness counts replace tailing terminals. |
| Correcting a worker | **Open that worker's session** | Direct steering; no orchestrator relay. |
| Beads work state | **Tasks surface**, Beads source, epic→bead drill-down | Read-only. `br` stays the sole write path (`.agents/factory/tools.md`). |
| Owner gates: plan approval (1), merge approval (2), escalations | **Inbox Human Intentions** via `ask_user` | The intention is the decision record, carrying the `owner-review-card.md` payload and `[br-###]` subject. GitHub comments demote to fallback-only. |
| Review handover | **present-pr artifact as a workspace pane** + **live demo pane** | Both linked from the intention. |
| Beadle; CI watch; epic-branch rebase sweep; lane heartbeat | **Automations** (cron, per-automation `agentTypeId` + model) | "Crons watch, models act", literally. |
| Model routing (seat → tier → model) | **Per-seat fleet composition** + **per-automation agent selection** (#1143) | Routing stops being a human choosing a CLI. |

### The seat list — minimal roster, grow on demand (owner-ratified 2026-08-10)

An earlier revision proposed nine seats. The owner rejected it — **"why 9 seats?
this is too much."** — and then rejected the four-seat compromise too. The final
ruling is **three**, and the reasoning is sharper than "fewer is better":

**A seat must be justified by capability posture, not by model choice.** A
roster sized for an imagined factory is process porn (AGENTS.md hard rule 8),
and a seat that differs from its neighbour only in which model it calls is not a
seat at all — it is a dispatch parameter wearing a persona.

**S0 boots three seats: `triage` · `orchestrator` · `worker`.**

| Seat | `agentTypeId` | Posture | Role |
| --- | --- | --- | --- |
| `triage` | `boring-triage` | Continuous, background, non-interactive | Classification of incoming work: category, state, first blocker, route. Runs on a cadence, not in conversation. |
| `orchestrator` | `boring-orchestrator` | Full authority; conversational; **pinned** | The owner's standing counterpart. Dispatches work, reads bead end-states, holds the conversation. Planning is one activity within it, not its identity. |
| `worker` | `boring-worker` | Full write: edits, commits, pushes | **One** implementation seat. Claims a bead, works it in a lane worktree, spawns its own review subagents at gate time, hands off. |

#### Why `orchestrator`, not `planner` (owner-ratified 2026-08-10)

The seat dispatches work, reads bead end-states, and holds the owner
conversation. Planning is one activity inside that, not the whole of it — naming
the seat `planner` would have described a fraction of its job and clashed with
the factory's existing vocabulary, where the orchestrator role is already the
one that decides what gets worked (`docs/procedures/boring-loop.md`). The name
follows the authority, not the favourite activity.

#### Why `triage` is its own seat again

Earlier revisions folded triage into the pinned seat. It comes back out, and the
justification is posture, not convenience: triage is **continuous background
classification of incoming work**, while the orchestrator is **interactive**.
Those are different operating modes — one runs on a cadence with no human in the
loop, the other exists to be talked to. A background sweep competing for the
pinned conversational session is exactly how the owner's counterpart becomes
unresponsive.

#### Why `worker` is one seat

The previous drafts split the worker into `worker-taste` (Opus, UI/taste beads),
`worker-exec` (Sol), and `worker-bulk` (Terra/Luna). **That split was only ever
model routing.** All three had identical tools, identical authority, identical
skills, and identical procedures; the sole difference was which model answered.

Model routing already has a home: **dispatch time**. A session picks its model
when it is opened, and #1143 gives automations per-run `model` + `agentTypeId`.
Encoding the same fact a second time as a persona duplicates it in a place that
then has to be kept in sync — three personas, three digest sets, three ways to
drift, to express one dropdown.

So the taste/exec/bulk distinction moves to dispatch: **one `worker` seat, whose
model is chosen per session or per automation.** A taste-heavy UI bead opens a
`worker` session on Opus; a mechanical batch opens one on a cheap lane. The
fleet view still shows which model each running session is using — that fact
comes from the session, which is where it belongs.

#### No `reviewer` seat — review is a rule, not a chair (owner-ratified 2026-08-10)

An earlier revision kept `reviewer` as a seat on the grounds that its read-only
posture justified it. Overruled: **reviews are fresh-context subagents the
worker spawns at gate time.**

The property that makes a review worth anything is **independence of context**,
not a separate chair in the fleet. A standing reviewer seat gives the appearance
of independence while the real risk — a reviewer primed by the author's
framing — is untouched by whether it has its own `agentTypeId`. So the property
is encoded directly, as a rule:

- **Clean context.** A review subagent starts from a fresh context. It never
  inherits or continues the authoring session.
- **Adversarial mandate.** Its instruction is to *refute*, not to bless. It
  reports findings; it does not rewrite the work (MODEL-CARD review ladder).
- **Provenance is recorded.** The present-pr artifact's review-history section
  records who ran each review — model, mandate, target SHA — so independence is
  **auditable after the fact** rather than assumed. This is a direct consumer of
  #1184's convention that every implementation ends with that artifact.

This is also cheaper and more honest than a seat: a subagent per review means
each gate gets a genuinely new reader, where one long-lived reviewer seat
accumulates exactly the context we were trying to exclude.

**Deferral trigger — promote `reviewer` to a seat if review provenance shows
self-grading drift.** The provenance record is what makes that trigger
measurable: if the history shows reviews clustering on the author's own model,
inheriting context, or returning blessings without findings, the rule has failed
and the boundary moves into the runtime as a seat with enforced read-only tools.

#### Grow-on-demand list

Everything else is deferred. Each is added only when a real lane pulls it:

| Deferred seat | Added when |
| --- | --- |
| `concierge` | external intake volume exceeds what the orchestrator can front-door conversationally |
| `reviewer` | review provenance shows self-grading drift — see the trigger above |
| `auditor` (Sol xhigh adversarial) | the cross-model adversarial pass needs authority a review subagent cannot hold, not merely a different model |
| `beadle` (T4 supervisor) | **S7** — the supervisor slice; it has no reason to exist before the automations do |
| any `worker-*` variant | a real lane needs different **tools or authority** from `worker`. A different model is not a trigger. |

**Adding a seat is cheap, and that is the point.** A seat is a `fleet.yaml`
entry plus a `.agents/personas/<seat>` package; the loader composes it at boot,
resolves its tier through the model card, and verifies its pinned skill digests.
Once the #1107 chain lands (#1150 discovery / #1168 knowledge / #1175 workspace
install), a seat is an installable package rather than a repo edit. Because
seat-addition is a config change and not an architecture change, **starting
minimal costs nothing later** — which is exactly why starting at nine would have
bought nothing now.

### Steering and the outcome-oriented orchestrator (owner-ratified 2026-08-10)

**The orchestrator reads bead END-STATES only.** Owner↔worker conversations are
invisible to it by design.

> *"the planner does not need to know I chatted with the worker — he must just
> know about the end state."*

Any scope change produced by steering manifests where the orchestrator already
looks: the bead's final state — status, results, PR links. That is the whole
contract.

Explicitly **not** built, and not wanted:

- No intervention or steering events.
- No orchestrator reads of worker transcripts.
- No mandatory mid-flight annotations, and no Beadle flag for "session moved
  without notes".

This is a simplification of r1's earlier "steering lands on the bead" rule,
which required the worker to annotate mid-flight. It does not. The end state is
the annotation, and it is written when the work is done like any other bead
closure. Task↔session links (`taskSessionLinkStore.ts`, on main) remain
available for a human who wants to trace a bead to its session; the orchestrator does
not need them.

The benefit is not only less machinery — it removes the failure mode where a
orchestrator acts on a half-finished steering exchange it partially observed.

### Cross-repo lanes: the factory-wide workspace (owner-ratified 2026-08-10)

> **Owner amendment 2026-08-10 (supersedes this whole section):** the
> projects-root interim is **rescinded**. The factory workspace is
> **boring-ui-only** — one hub workspace rooted at a `boring-ui-v2` worktree,
> and no `/home/ubuntu/projects/`-rooted workspace is registered. Cross-repo
> lanes (seneca, boring-content, constellation) **remain in Claude Code as the
> escape hatch, full stop** — escape-hatch item 2 widens from "per-repo
> authority work" to all cross-repo work. The deferred true-multi-repo trigger
> below stands unchanged. The text that follows is retained as the rescinded
> proposal, not as policy.

Interim shape, owner's own proposal: **register one additional hub workspace
rooted at `/home/ubuntu/projects/`.** Cross-repo lanes — seneca, boring-content,
constellation — run there, and agents `cd` into the target repo. Nothing about
the per-repo factory changes; boring-ui keeps its own workspace, its own
`.beads/`, its own `fleet.yaml`.

Accepted caveats, named so nobody rediscovers them:

- **File-tree and search performance** over a root that wide needs ignore
  configuration up front. A projects-root workspace that indexes every
  `node_modules` in every repo is unusable on the first open, and that reads as
  "the product is slow" rather than "the root was misconfigured".
- **#1146 readonly-paths policy is the guardrail.** It is what protects
  unrelated repos from a lane that wanders. At minimum, protect the **primary
  `boring-ui-v2` checkout** (the coordination anchor, AGENTS.md hard rule 6) and
  **every repo's `.git` internals**, per the policy's capability model.
- **Coarse session and task scoping is accepted.** Sessions and tasks in that
  workspace are scoped to the root, not the repo, so a seneca lane and a
  boring-content lane share a namespace. That is the price of the interim.

**Deferred: true multi-repo workspaces** — per-repo authority and multi-root
bindings via #1123. **Trigger:** when the projects-root workspace's coarseness
causes a real incident, or blocks a per-repo policy we actually need.

### Seat funding (owner-ratified 2026-08-10)

**Seats are funded by instance env keys** — the host-configured provider
credentials the CLI hub already uses today. The fleet loader picks the first
tier candidate whose API key env var is present in the hub process, so the key
set the hub can see *is* the funding model. Nothing per-seat, nothing per-user.

**BYOK slices C–E formalize per-seat credentials later.** The dependency
direction matters and only runs one way: **this epic does not block on BYOK, and
BYOK does not block on this epic.** Per-seat credentials are an upgrade to how a
seat is funded, not a precondition for a seat existing. If BYOK lands
mid-migration, seats adopt it without any slice here being recut.

The cost of the interim model is honest and is tracked as a risk: with one
shared key set, per-seat spend is not separable, and a mis-tiered seat or
automation spends the instance's budget silently.

### Stays in Claude Code — the escape hatch list

Explicit, so nobody quietly re-migrates them and nobody quietly keeps everything:

1. **Bootstrapping and repair of the factory itself** — any change to
   `.agents/factory/**`, `AGENTS.md`, `.github/workflows/**` (permanently
   trust-class B). A workspace editing its own authority files is the exact
   failure the trust ladder exists to prevent.
2. **All cross-repo work** — amended 2026-08-10. The projects-root workspace
   is rescinded, so cross-repo lanes (seneca, boring-content, constellation)
   stay in Claude Code entirely, alongside anything needing per-repo policy or
   multi-root bindings.
3. **Ad-hoc exploration and grilling** — `grill-me`, `grill-for-unknowns`,
   conversational thermo passes.
4. **Anything while the product is broken.** The migration must never make the
   repo un-workable; fall back without asking.

Note what is *not* on this list: codex model runs. They stay `codex exec`
shells, but invoked *by* a seat inside the workspace, not by a human in a
terminal.

## Gap analysis

Each gap gets one disposition: **adopt-now** (accepted workaround), **pull**
(product feature this epic pulls forward), **external** (stays outside, by
decision).

| # | Gap | Detail (verified against `main`) | Disposition |
| --- | --- | --- | --- |
| **G1** | **Ad-hoc worktree worker spawning** | The unit of work is "create `.worktrees/<lane>`, run a session with that cwd". Verified: no worktree-creation capability exists in any package — it is a bash procedure only; the bash tool is a synchronous `exec` fenced to one `workspaceRoot` with no background/detach; a session's fs root is fixed at composition. The Beadle's core job (spawn workers while ready > active) is unbuildable as specified. | **pull** — the largest gap. Interim **adopt-now**: a **fixed lane pool** — pre-create N lane worktrees, register each as a workspace in the hub registry (`workspaces add`), and have the Beadle *wake* an idle lane rather than spawn one. `worker_cap: 3` plus the bugfix lane means the pool is ~4; bounded concurrency was already policy, so this is not a real loss at this stage. |
| **G2** | **Cross-repo lanes** | Procedures assume one repo. Each agent turn is fenced to one `workspaceRoot` — there is no cross-workspace turn — and `fleet.yaml`/`policy.yaml`/`.beads/` are repo-local by design. | **external** (owner amendment 2026-08-10, superseding the earlier adopt-now) — the projects-root "factory-wide" workspace is **rescinded**. The factory workspace is boring-ui-only; cross-repo lanes stay in Claude Code as the escape hatch. True multi-repo workspaces remain **deferred** — see "Cross-repo lanes" below. |
| **G3** | **GitHub PR orchestration** | `gh` is a CLI a session shells out to; the tasks plugin already does exactly this (`createGhCliGitHubIssueExecutor`). No first-party PR surface. | **adopt-now** — seats keep shelling `gh`. It works, it is auditable, GitHub is already the declared authority for human intake. Not on this epic's path. |
| **G4** | **Long CI polls** | Automation triggers are `manual \| scheduled` only — no event/webhook trigger. A session waiting on CI stops heartbeating and gets its lease broken (the documented stall failure). | **pull (small)** — a cron automation polling `gh pr checks` for open factory PRs and raising results, so no session ever blocks on CI. Sessions keep the standing rule: poll synchronously, never end a turn on a wait you did not schedule. Webhook triggers: **external**. |
| **G5** | **Live demo as a workspace pane** | Half of the ratified two-artifact handover. Verified: the filesystem plugin's HTML viewer renders sanitized HTML via sandboxed-iframe `srcDoc` — so a **self-contained present-pr page opens as a pane today, no product change** (this downgrades the present-pr half of the gap to adopt-now). But there is **no URL/preview pane**: `generated-pane` is a declarative element-spec renderer, not a URL embed, and no pane type points an iframe at a running dev server. | **pull**, built in **S3** (owner-ratified 2026-08-10) — a bounded local-URL preview pane (localhost + port allowlist) so a worker can expose its running demo. UI-loop-sized. This is the one new UI surface the epic needs. |
| **G6** | **Tasks two-level hierarchy: epics → beads** | Owner believes it does not exist. **Partly wrong, and worth knowing**: `BoringTaskCard.epic?: BoringTaskEpicRef` exists, the Beads adapter *does* map a bead's parent to `epic` (`beadsSource.ts:178`), and `TaskKanbanBoard` has an epic **filter** dropdown. What is missing is the requested shape: an **epics-first view** listing all active epics with drill-down into their beads. Today it is one flat board you narrow by filter. | **pull (small)** — an epic-level grouping/drill-down over data that already exists. Cheap because no adapter or schema work is needed. |
| **G7** | **Per-automation agent picker in the UI** | #1143 landed the server half; `AutomationForm.tsx` still reads a single ambient `agentTypeId` and has no selector. With nine seats, the Beadle automations cannot be configured to the right seat from the UI. | **pull (small)** — finish #1143's UI half. Blocks S7. |
| **G8** | **Trust-ladder merge gate** | class-A predicate (allowlist ∧ reviewer-pass ∧ size-cap) unimplemented; every merge manual. | **external to this epic** — factory TODO step 5, orthogonal to *where* the factory runs. Migrating and building it at once conflates two failures. |
| **G9** | **Seat-level session/lease enforcement** | "1 bead = 1 durable session", lease heartbeats, handoff-before-compaction are conventions with no runtime. Moving into the workspace adds no enforcement by itself. Note ask-user pendings are *abandoned* across a server restart, not resumed — a restart mid-gate loses the question. | **adopt-now** — conventions stay conventions; the Beadle's stale-lease sweep (S7) is the only enforcement, exactly as ratified. Restart-abandoned intentions are re-raised by the same sweep. |

**Top five, ranked by daily pain:** G1 (worktree spawning) ≫ G5 (live demo pane —
#1184 makes the two-artifact handover every-PR) > G4 (CI polls, the documented
stall) > G6 (epic→bead drill-down, the daily navigation surface) > G7 (automation
agent picker, blocks the Beadle).

## Decisions

1. **Prove per lane, not per capability.** Each slice runs one *real* piece of
   factory work end-to-end before the next starts. No slice ships on tests alone.
2. **The old path keeps working until its replacement is proven.** Every slice is
   additive; nothing is removed from `.agents/` or `docs/procedures/` until the
   workspace path has done the same job for real.
3. **Beads stays the canonical work-item truth, with single-writer discipline**
   (owner-ratified 2026-08-10). The Tasks panel is a **read-only mirror until
   S8**; write authority flips only at exit, and only once the loop has closed
   once. Until then there is exactly one way a work item changes: `br`.
4. **Escape hatches are a list, not a mood.** The four items above are the whole
   list; adding to it requires an owner decision recorded here.
5. **Fixed lane pool, not dynamic spawning.** Accept G1's workaround for this
   epic rather than blocking on a product feature.
6. **Minimal 3-seat roster, grown on demand** (owner-ratified 2026-08-10):
   `triage`, `orchestrator`, `worker`. A seat is justified by capability
   posture, never by model choice — model routing lives at dispatch time
   (#1143). Seat-addition is a config change, so starting small costs nothing
   later.
6b. **Review is a rule, not a seat** (owner-ratified 2026-08-10) — fresh-context
   subagents with an adversarial mandate, spawned by the worker at gate time,
   with provenance recorded in the present-pr artifact.
7. **The orchestrator is outcome-oriented** (owner-ratified 2026-08-10) — it reads
   bead end-states only; owner↔worker steering is invisible to it by design.
8. **Seats are funded by instance env keys** (owner-ratified 2026-08-10) — the
   host-configured provider credentials the CLI hub already uses. Per-seat
   credentials are a later BYOK concern; see "Seat funding" below.
9. **#1176 gates S1's start, and only that.** Planning proceeds now.

## Slices

Each slice is one PR. "Proof" is the real lane it must run, not a test suite.

### S0: factory workspace boots the 3-seat roster
**Delivers:** the CLI hub on this repo with `BORING_AGENT_FLEET=1` and
`BORING_AGENT_SESSION_ROOT=/home/ubuntu/factory-sessions`; `fleet.yaml`
+ `policy.yaml` + `.agents/personas/*` recut from today's five seats to the three
ratified above (`triage`, `orchestrator`, `worker`); a documented, repeatable start
command. No factory work moves yet.
**Blocked by:** None — can run before #1176.
**Proof:** **three** seats visible in the hub (`triage`, `orchestrator`,
`worker`); the describe endpoint reports each seat's resolved model; a `worker`
session opens on a chosen model, proving model selection lives at dispatch
rather than in the roster; a review subagent spawned from that worker session
starts from clean context and its provenance line is recorded; the
grow-on-demand seats are absent and nothing degrades. Screenshot.
**Why first:** everything downstream assumes seats exist as addressable agents,
and nothing has ever verified the composed fleet is correct.
**Review budget:** inside (config + personas + docs).

### S1: the UI-polish lane (epic #1110) runs as a workspace worker session
**Delivers:** **epic #1110 — the UI polish loop — is the ratified guinea-pig
lane** (owner-ratified 2026-08-10). It is the right first subject: a standing,
genuinely recurring loop with the lowest blast radius in the queue, and its
in-flight work (e.g. #1172, #1173) is small and independently revertible.
Executed by a `worker` session opened on a taste-capable model (dispatch-time
selection, per decision 6), whose cwd is a pre-created lane
worktree, with the pinned `orchestrator` session open alongside. Claude Code path
untouched.
**Blocked by:** **#1176 merged**, and S0.
**Proof:** one real #1110 polish change goes automation-free from orchestrator →
worker session → commit → PR with the owner never opening a terminal; the fleet
view shows the lane's liveliness throughout; a hub restart leaves the transcript
intact.
**Review budget:** inside.

### S2: direct-to-worker steering
**Delivers:** the ratified feedback model proven on the #1110 lane — the owner
opens S1's worker session and corrects it directly, with no orchestrator relay.
Procedure text in `.agents/skills/exec/` and the factory README recording that
the orchestrator is outcome-oriented: it consumes bead end-states, and steering
conversations are deliberately invisible to it.
**Blocked by:** S1.
**Proof:** a real mid-flight correction that changes what the bead delivers,
after which the orchestrator — told nothing about the exchange — plans correctly from
the bead's end state alone.
**Review budget:** inside (docs/skills; class B, owner-merged).
**Note:** this slice got *smaller* under the 2026-08-10 ruling. There is no
intervention event, no transcript read, and no mandatory mid-flight annotation
to build — the end state was always the interface.

### S3: the two-artifact handover
**Delivers:** G5's pull — a bounded local-URL preview pane (localhost + port
allowlist) so a worker can expose its running demo as a workspace pane; plus the
present-pr page written into the lane worktree and opened via the existing HTML
viewer. Both referenced from the worker's handoff.
**Blocked by:** S1, and #1180 landing.
**Proof:** the owner validates S1's change entirely inside the workspace —
review artifact in one pane, live demo in another. No claude.ai link, no
localhost URL pasted into chat.
**Review budget:** **exceeds** — new UI surface plus a security boundary
(what a pane may point at). Expect a sub-plan; the preview pane is the only
genuinely new product surface in this epic.

### S4: owner gates through the Inbox
**Delivers:** gate 2 (merge approval) for S1's lane raised as an `ask_user`
Human Intention carrying the `owner-review-card.md` payload, the `[br-###]`
subject, and links to both S3 artifacts; owner decides in the Inbox. Gate 1
(plan approval) follows in the same slice only if gate 2 proves clean.
**Blocked by:** S3 (the intention is only useful once it can link real
artifacts).
**Proof:** one merge decision made entirely in the Inbox, durable and linked to
bead + PR + SHA. The GitHub-comment fallback exercised once, deliberately.
**Review budget:** inside.

### S5: Tasks as the work surface — epics → beads
**Delivers:** G6's pull — an epics-first view over the existing `epic` grouping
with drill-down to beads and an easy filter, pointed at the canonical
`.beads/beads.db` (the `--db` trap made explicit in config, not folklore).
**Blocked by:** S0 (needs a live graph with real leases to be worth looking at).
**Proof:** the owner navigates active epics → beads and finds S1's lane and its
lease state without opening a terminal; the ready list matches
`br ready --json` from the canonical checkout during an active lease.
**Review budget:** inside.
**Note:** read-only mirror, per decision 3. Board-side writes are an S8 exit
question, not a slice here.

### S6: seats carry their own definitions
**Delivers:** the three seats as `.agents/personas` packages installed through
the #1107 path rather than repo-scanned, with skills and knowledge travelling
with the seat. This is also what makes the grow-on-demand list cheap: after S6,
adding a deferred seat is installing a package.
**Blocked by:** S0, and #1150/#1168/#1175 landing.
**Proof:** a seat's skill set changes by updating its package; the Agent details
overlay reflects it without a repo edit.
**Review budget:** inside — but **entirely dependent on an external chain**. If
#1107 stalls, this slice waits; nothing downstream depends on it.

> **Owner amendment 2026-08-10 — S6 is sequenced, not deferred.** S0's roster is
> **interim: config-composed**, read out of `.agents/personas` + `fleet.yaml` by
> `loadConfiguredAgentFleet` under `BORING_AGENT_FLEET=1`. That is accepted as
> the interim host, and it is explicitly *not* the target: the roster converts to
> **discovered persona packages** the moment the #1107 chain
> (#1150 discovery / #1168 `knowledge/` fs / #1175 workspace install via
> `.pi/settings.json#packages`) merges. **S6 therefore runs immediately after
> that chain lands, ahead of whatever slice is otherwise next — it is not
> deferred to the end of the queue.** The reason is that every slice between
> here and there accrues seats and skill pins against a repo-edit roster, and the
> longer that runs the more there is to convert. The earlier "nothing downstream
> depends on it" line describes correctness, not cost.
>
> Corollary, ratified with it: **no seat roster may be hardcoded in source.**
> A seat list written as a TypeScript literal is a second copy of the config that
> drifts on the next seat change. Seats come from configuration now and from
> discovery after S6 — never from a union type or an array in a server file.

### S7: the Beadle, as automations, over the fixed lane pool
**Delivers:** G7's pull (the automation agent picker) plus the supervisor as
cron automations on `beadle.tick_minutes` running as the `beadle` seat — **this
is the slice that pulls `beadle` off the grow-on-demand list**: wake idle lanes
while ready > active (up to `worker_cap`), break stale leases past
`stale_lease_minutes` when handoff notes exist, flag proof-less closures,
re-raise restart-abandoned intentions (G9), and G4's CI-poll sweep. It never
picks beads — workers still pull. Per the 2026-08-10 steering ruling it does
**not** police mid-flight annotations.
**Blocked by:** S1, S4, S5.
**Proof:** unattended across one full epic's worth of beads; one stale lease
broken correctly; one CI result reported with no session blocked.
**Review budget:** **exceeds** — expect a sub-plan.
**Note:** last on purpose. A supervisor over an unproven lane is a machine for
producing unattended damage.

### S8: retire the old path, per activity
**Delivers:** for each activity proven in S1–S7, `docs/procedures/` and
`.agents/factory/README.md` name the workspace surface as primary and Claude
Code as the escape hatch; the escape-hatch list becomes canonical text.
**Blocked by:** all of the above.

**Exit bar (owner-ratified 2026-08-10): one full epic, end to end, in the
workspace.** A complete epic — plan → exec → review → merge — carried through
workspace sessions, with owner gates in the Inbox and the two-artifact handover.
Not a calendar criterion: an earlier draft proposed "two weeks of running", and
elapsed time proves nothing about whether the loop closes. One finished epic
does.

**Claude Code remains a named escape hatch after exit** — the four-item list
stays canonical. Exiting the migration means the workspace is the default path,
not that the hatch is welded shut.

**Exit also flips work-item write authority** (decision 3): the Tasks panel is a
read-only mirror for the whole migration, and board-side writes become
admissible only once the loop has closed one full epic. Adding a second writer
to the work graph before then would mean debugging the migration and a
split-brain graph at the same time.

**Proof:** the named epic, closed, with its gate decisions traceable in the
Inbox; plus a fresh session, primed only from `AGENTS.md` + the factory README,
running a lane the new way without being told how.
**Review budget:** inside (docs) — class B, owner-merged.

## Risks

**Shared-VM realities.** The hub competes for ports (5200 default, 5210 is
routinely taken; `AGENT_API_PORT`/`--port` overrides are standard) and
**refuses to start without a built front bundle under `packages/cli/public/`**,
which is gitignored and goes stale after merges — a hub can serve last week's UI
and make a proven slice look broken. Building from source needs
`build:full`, not `build`. The shared `ubuntu` Postgres role has been reset by
other sessions, 500-ing long-running hubs. *Mitigation:* S0 documents a start
command with a pinned port, a mandatory `build:full`, and a dedicated database
role owning the factory hub's data. A hub that has been up for days is suspect
before its logs are.

**Session-history durability.** AGENTS.md hard rule 9: Pi transcripts and
session lists are host-app user data, stored on the host's durable volume via
`BORING_AGENT_SESSION_ROOT` (typically `/data/pi-sessions`), not container home.
**On this VM the factory hub uses a dedicated directory:
`BORING_AGENT_SESSION_ROOT=/home/ubuntu/factory-sessions`** (owner-ratified
2026-08-10), revisited if the hub containerizes — at which point it moves to a
mounted volume per the hard rule.
Once lanes are workspace sessions, **the transcript is the only record of an
unattended worker's reasoning** — losing it on restart is worse than the
terminal we left. Related: ask-user pendings are abandoned across restart, so a
restart mid-gate silently drops the question. *Mitigation:* S0 sets and verifies
the session root before any lane moves; S1's proof includes a hub restart with
history intact; S7 re-raises abandoned intentions. Durable streams are flagged
(`BORING_CHAT_DURABLE_STREAM`), so restart-stable event offsets are not assumed.

**Token and credit routing.** Today the orchestrator picks the runtime and
therefore the wallet. Once seats resolve models from `policy.yaml` and
automations carry their own model, spend moves into config — funded by one
shared instance key set (ratified above) and with no spend caps (VISION
decision 18: "none yet; the worker cap bounds concurrency"). A mis-tiered cron
automation bills a T1 model every ten minutes, unattended, against a budget
nobody can attribute per seat. Note the loader picks the first tier candidate
**whose API key env var is present**, so which keys the hub process can see
silently determines spend. Codex passes stay on the shared 5h OpenAI window,
capped at 2 tracks. *Mitigation:* S0's proof records the resolved model per seat
and the key set visible to the hub; S7 pins `automation: T4` and runs its first
week with `worker_cap: 1`. Per-seat attribution waits for BYOK slices C–E and is
accepted as absent until then.

**Silent seat loss.** A pinned skill-digest mismatch drops that seat and keeps
the fleet — the hub starts looking healthy with a seat missing. The 3-seat
roster reduces the surface but does not remove the failure. *Mitigation:* S0's
proof is an explicit three-seat roll call, not "the hub started".

**Migration-eats-the-factory.** This epic rebuilds the thing that ships the
product, while it ships. *Mitigation:* decision 2 — additive slices, nothing
retired before S8 — and escape hatch 4.

**Prerequisite slip.** #1176 is being merged in parallel by the owner; S1 waits
on it. #1180 gates S3, and the #1107 chain gates S6. *Mitigation:* S0 and S5's
groundwork are independent and absorb the wait; S6 is deliberately off the
critical path.

## Acceptance

- The Today table is accepted as accurate, or corrected.
- The session topology (pinned orchestrator + per-lane workers + background
  triage) is ratified.
- Each of G1–G9 has an owner-ratified disposition.
- Slice order S0→S8 is ratified, or recut.
- The escape-hatch list is ratified as complete.

Ratified 2026-08-10 and no longer open: the 3-seat roster and grow-on-demand
list, instance-env-key seat funding, the outcome-oriented orchestrator, epic #1110 as
S1's lane, and S8's one-full-epic exit bar.

## Proof

- **This plan:** review only; no code, no commands.
- **Per slice:** the named real lane, run end-to-end, with a screenshot or
  transcript link. From S3 onward, the proof *is* the two-artifact handover —
  the plan's own convention applied to itself.

## Out of scope

- True multi-repo workspaces: per-repo authority and multi-root bindings via
  #1123 (G2). **Trigger to build:** when the projects-root workspace's
  coarseness causes a real incident, or blocks per-repo policy.
- Trust-ladder merge gate and class-A auto-merge (G8, factory TODO step 5).
- Webhook/event automation triggers (G4's second half).
- Swarm Console, dashboards, metrics (VISION: deferred until the loop runs
  across ten real issues).
- Post-merge/release automation (VISION decision 13).
- Agent-to-agent messaging (`tools.md`, "Not in the factory").
- Spend caps (VISION decision 18) — a named risk, not built here.

## Open questions

1. **Lane pool size.** G1's workaround needs a fixed number of pre-created lane
   worktrees. `worker_cap: 3` plus the bugfix lane suggests 4. Confirm?
2. **Does `triage` need its own cadence in S0**, or does it stay dormant until
   a real intake stream exists? It is the one seat S0 boots that no early slice
   exercises.
3. **Does the factory hub run long-lived or per-session?** Materially changes
   the Postgres/port mitigations and whether the Beadle can tick unattended.
4. **What records review provenance before present-pr lands?** The
   independence rule is only auditable once #1180's review-history section
   exists. Until then the provenance line has no home — a bead comment is the
   obvious interim, and it should be named as such or explicitly deferred.
5. **How far does the preview pane go?** Localhost-only with a port allowlist is
   the proposed bound. Anything wider is an SSRF-shaped surface and needs its
   own gate.
6. **Gate 1 in S4 or its own slice?** Plan approval carries a plan review doc
   (`visual-review-doc.md`), which may pull more artifact work forward.
