---
github: https://github.com/hachej/boring-ui/issues/1187
issue: 1187
state: ready-for-human
updated: 2026-08-10
flag: not-flaggable
track: owner
---

# gh-1187 migrate the Boring Factory onto the boring-ui CLI workspace

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
  drops into a worker session next to the planner instead of switching context.
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

**One pinned planner session + one worker session per lane/bead.**

- **The planner session is persistent and pinned** — the owner's standing
  counterpart, held by the `steward` seat. It is never recycled per epic; its
  durable state lives in beads and notes, never in accumulated context
  (VISION decision 17). It is where conversation, planning, and re-planning
  happen.
- **Worker sessions are per lane/bead**, one durable session per bead
  (VISION decision 5), each with a lane worktree as its cwd, each addressable
  and openable by the owner.
- **The owner may steer any worker directly.** This is the ratified feedback
  model, quoted above. Direct steering must not blind the planner: see
  "Direct steering and planner awareness" below.

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
| Planning / owner conversation | **Pinned planner session** (`steward` seat) | The standing counterpart replaces the orchestrating Claude Code session. |
| Lane = one epic worktree worked by a session | **Worker session per lane/bead**, seat-addressed | `.worktrees/<lane>` stays the cwd; the transcript lives under `BORING_AGENT_SESSION_ROOT`. |
| Watching lanes | **Fleet view** (#1102 + #1176) | Liveliness counts replace tailing terminals. |
| Correcting a worker | **Open that worker's session** | Direct steering; no orchestrator relay. |
| Beads work state | **Tasks surface**, Beads source, epic→bead drill-down | Read-only. `br` stays the sole write path (`.agents/factory/tools.md`). |
| Owner gates: plan approval (1), merge approval (2), escalations | **Inbox Human Intentions** via `ask_user` | The intention is the decision record, carrying the `owner-review-card.md` payload and `[br-###]` subject. GitHub comments demote to fallback-only. |
| Review handover | **present-pr artifact as a workspace pane** + **live demo pane** | Both linked from the intention. |
| Beadle; CI watch; epic-branch rebase sweep; lane heartbeat | **Automations** (cron, per-automation `agentTypeId` + model) | "Crons watch, models act", literally. |
| Model routing (seat → tier → model) | **Per-seat fleet composition** + **per-automation agent selection** (#1143) | Routing stops being a human choosing a CLI. |

### The seat list (concrete)

Today's `fleet.yaml` has five seats bound to abstract tiers. The target fleet
names the **model lane** in the seat, so routing is legible in the fleet view
and selectable per automation. Each becomes a `.agents/personas/<seat>` package,
installable once the #1107 chain lands.

| Seat | `agentTypeId` | Tier / lane | Role | Exists today? |
| --- | --- | --- | --- | --- |
| `planner` | `boring-planner` | T1 (Fable) | The pinned session. Owner's counterpart; plan → bead graph; gate-1 intentions. | Rename/refit of `steward` |
| `concierge` | `boring-concierge` | T1 | Front door: raw idea → agreed epic scope. | Yes |
| `triage` | `boring-triage` | T3 | Issue/PR classification sweeps. | Yes |
| `worker-taste` | `boring-worker-taste` | T2 (Opus) | UI-surface and taste-driven beads. | New (splits `worker`) |
| `worker-exec` | `boring-worker-exec` | T3 (Sonnet, pi-native) | Default implementation worker. | Refit of `worker` |
| `worker-bulk` | `boring-worker-bulk` | T3/T4 (Terra/Luna via `codex exec`) | Mechanical bulk work. **Cannot hold a seat** per MODEL-CARD — modelled as a *delegating* pi-native seat that shells codex, never as a codex-hosted seat. | New |
| `reviewer` | `boring-reviewer` | T2 (Opus) | Fresh-eyes + thermo review, dispositions. | Yes |
| `auditor` | `boring-auditor` | T1 (Sol xhigh via `codex exec`) | Cross-model adversarial pass on plans and class-B PRs. Same delegating-seat shape as `worker-bulk`. | New |
| `beadle` | `boring-beadle` | T4 (Haiku) | Supervisor automations only; never picks beads. | New |

**Naming the lane in the seat is a decision, not cosmetics**: it is what makes
"which model is doing this" visible in the fleet view and selectable in the
automation form, replacing the human's CLI choice. Nine seats also stresses the
fleet view harder than five — which is the dogfooding point.

The two codex-backed seats (`worker-bulk`, `auditor`) are deliberately modelled
as pi-native seats that *delegate* to `codex exec`, because MODEL-CARD is
explicit that codex-hosted models cannot hold a seat. The seat is the
addressable, steerable thing; the codex run is its tool.

### Direct steering and planner awareness

If the owner corrects a worker directly, the planner must not keep planning
against a stale belief. Three mechanisms, cheapest first:

1. **The bead is the shared blackboard.** Direct steering that changes scope
   ends with the worker writing a `br comments add` note on its bead. This works
   today with zero product change and is the fallback that must always hold.
2. **Task↔session links** (`taskSessionLinkStore.ts`, on main) already bind a
   bead to its session, so the planner can find the steered session from the
   bead without being told.
3. **Session events.** The planner reads worker session state rather than being
   messaged. Deliberately *not* agent-to-agent messaging — `tools.md` forbids a
   second control plane until >5 concurrent workers actually collide.

**Rule:** direct steering is not silent. A steering exchange that changes WHAT a
bead delivers is not done until the bead carries it. That rule is a procedure,
enforced by the Beadle flagging beads whose sessions moved without notes.

### Stays in Claude Code — the escape hatch list

Explicit, so nobody quietly re-migrates them and nobody quietly keeps everything:

1. **Bootstrapping and repair of the factory itself** — any change to
   `.agents/factory/**`, `AGENTS.md`, `.github/workflows/**` (permanently
   trust-class B). A workspace editing its own authority files is the exact
   failure the trust ladder exists to prevent.
2. **Cross-repo work** (seneca, boring-content, infra) — see G2.
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
| **G2** | **Cross-repo work** | Procedures assume one repo. The hub serves N workspaces, but each agent turn is fenced to one `workspaceRoot` — there is no cross-workspace turn — and `fleet.yaml`/`policy.yaml`/`.beads/` are repo-local by design. | **external** for this epic. Do not generalize the factory to N repos before it works for one. |
| **G3** | **GitHub PR orchestration** | `gh` is a CLI a session shells out to; the tasks plugin already does exactly this (`createGhCliGitHubIssueExecutor`). No first-party PR surface. | **adopt-now** — seats keep shelling `gh`. It works, it is auditable, GitHub is already the declared authority for human intake. Not on this epic's path. |
| **G4** | **Long CI polls** | Automation triggers are `manual \| scheduled` only — no event/webhook trigger. A session waiting on CI stops heartbeating and gets its lease broken (the documented stall failure). | **pull (small)** — a cron automation polling `gh pr checks` for open factory PRs and raising results, so no session ever blocks on CI. Sessions keep the standing rule: poll synchronously, never end a turn on a wait you did not schedule. Webhook triggers: **external**. |
| **G5** | **Live demo as a workspace pane** | Half of the ratified two-artifact handover. Verified: the filesystem plugin's HTML viewer renders sanitized HTML via sandboxed-iframe `srcDoc` — so a **self-contained present-pr page opens as a pane today, no product change** (this downgrades the present-pr half of the gap to adopt-now). But there is **no URL/preview pane**: `generated-pane` is a declarative element-spec renderer, not a URL embed, and no pane type points an iframe at a running dev server. | **pull** — a bounded local-URL preview pane (localhost + port allowlist) so a worker can expose its running demo. This is the one new UI surface the epic needs. |
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
3. **Beads stays the single write authority for work state.** Tasks stays
   read-only for the whole epic.
4. **Escape hatches are a list, not a mood.** The four items above are the whole
   list; adding to it requires an owner decision recorded here.
5. **Fixed lane pool, not dynamic spawning.** Accept G1's workaround for this
   epic rather than blocking on a product feature.
6. **Nine named seats, with the model lane in the seat name**, so routing is
   visible and selectable rather than remembered.
7. **Direct steering is never silent** — it lands on the bead.
8. **#1176 gates S1's start, and only that.** Planning proceeds now.

## Slices

Each slice is one PR. "Proof" is the real lane it must run, not a test suite.

### S0: factory workspace boots with the full seat roster
**Delivers:** the CLI hub on this repo with `BORING_AGENT_FLEET=1`; `fleet.yaml`
+ `policy.yaml` + `.agents/personas/*` extended from five seats to the nine
above; a documented, repeatable start command. No factory work moves yet.
**Blocked by:** None — can run before #1176.
**Proof:** nine seats visible in the hub; the describe endpoint reports the
tier-resolved model per seat, matching MODEL-CARD; the two delegating seats
resolve a pi-native model and can shell `codex exec`. Screenshot.
**Why first:** everything downstream assumes seats exist as addressable agents,
and nothing has ever verified the composed fleet is correct.
**Review budget:** inside (config + personas + docs).

### S1: one real lane runs as a workspace worker session
**Delivers:** the standing UI-polish loop (named in the 08-08 report as a
"standing low-effort background loop" — lowest blast radius, genuinely
recurring) executed by `worker-taste` in a hub session whose cwd is a
pre-created lane worktree, with the pinned `planner` session open alongside.
Claude Code path untouched.
**Blocked by:** **#1176 merged**, and S0.
**Proof:** one UI-polish change goes automation-free from planner → worker
session → commit → PR with the owner never opening a terminal; the fleet view
shows the lane's liveliness throughout; a hub restart leaves the transcript
intact.
**Review budget:** inside.

### S2: direct-to-worker steering, with planner awareness
**Delivers:** the ratified feedback model proven — the owner opens S1's worker
session, corrects it directly, and the bead carries the correction. Procedure
text in `.agents/skills/exec/` and the factory README making "steering lands on
the bead" a hard rule.
**Blocked by:** S1.
**Proof:** a real mid-flight correction that changes what the bead delivers,
after which the planner — told nothing — re-plans correctly from the bead alone.
**Review budget:** inside (docs/skills; class B, owner-merged).

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

### S6: seats carry their own definitions
**Delivers:** the nine seats as `.agents/personas` packages installed through
the #1107 path rather than repo-scanned, with skills and knowledge travelling
with the seat.
**Blocked by:** S0, and #1150/#1168/#1175 landing.
**Proof:** a seat's skill set changes by updating its package; the Agent details
overlay reflects it without a repo edit.
**Review budget:** inside — but **entirely dependent on an external chain**. If
#1107 stalls, this slice waits; nothing downstream depends on it.

### S7: the Beadle, as automations, over the fixed lane pool
**Delivers:** G7's pull (the automation agent picker) plus the supervisor as
cron automations on `beadle.tick_minutes` running as the `beadle` seat: wake
idle lanes while ready > active (up to `worker_cap`), break stale leases past
`stale_lease_minutes` when handoff notes exist, flag proof-less closures, flag
beads whose sessions moved without notes (S2's rule), re-raise
restart-abandoned intentions (G9), and G4's CI-poll sweep. It never picks beads
— workers still pull.
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
**Proof:** a fresh session, primed only from `AGENTS.md` + the factory README,
runs a lane the new way without being told how.
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
Once lanes are workspace sessions, **the transcript is the only record of an
unattended worker's reasoning** — losing it on restart is worse than the
terminal we left. Related: ask-user pendings are abandoned across restart, so a
restart mid-gate silently drops the question. *Mitigation:* S0 sets and verifies
the session root before any lane moves; S1's proof includes a hub restart with
history intact; S7 re-raises abandoned intentions. Durable streams are flagged
(`BORING_CHAT_DURABLE_STREAM`), so restart-stable event offsets are not assumed.

**Token and credit routing.** Today the orchestrator picks the runtime and
therefore the wallet. Once nine seats resolve models from `policy.yaml` and
automations carry their own model, spend moves into config — with no spend caps
(VISION decision 18: "none yet; the worker cap bounds concurrency"). A
mis-tiered cron automation bills a T1 model every ten minutes, unattended.
Note the loader picks the first tier candidate **whose API key env var is
present**, so which keys the hub process can see silently determines spend.
Codex passes stay on the shared 5h OpenAI window, capped at 2 tracks.
*Mitigation:* S0's proof records the resolved model per seat and the key set
visible to the hub; S7 pins `automation: T4` and runs its first week with
`worker_cap: 1`.

**Nine seats is more surface than five.** More personas, more digests to keep
pinned, more ways for a seat to be silently dropped (a digest mismatch removes
one seat and keeps the fleet). *Mitigation:* S0's proof is an explicit
nine-seat roll call, not "the hub started".

**Direct steering fragments the record.** The feature that makes the migration
worth doing is also the one that can leave the planner planning against a stale
bead. *Mitigation:* S2's hard rule plus S7's flag; the bead-blackboard fallback
needs no product feature and must always hold.

**Migration-eats-the-factory.** This epic rebuilds the thing that ships the
product, while it ships. *Mitigation:* decision 2 — additive slices, nothing
retired before S8 — and escape hatch 4.

**Prerequisite slip.** #1176 is being merged in parallel by the owner; S1 waits
on it. #1180 gates S3, and the #1107 chain gates S6. *Mitigation:* S0 and S5's
groundwork are independent and absorb the wait; S6 is deliberately off the
critical path.

## Acceptance

- The Today table is accepted as accurate, or corrected.
- The session topology (pinned planner + per-lane workers) is ratified.
- The nine-seat roster and its naming convention are ratified, or recut.
- Each of G1–G9 has an owner-ratified disposition.
- Slice order S0→S8 is ratified, or recut.
- The escape-hatch list is ratified as complete.

## Proof

- **This plan:** review only; no code, no commands.
- **Per slice:** the named real lane, run end-to-end, with a screenshot or
  transcript link. From S3 onward, the proof *is* the two-artifact handover —
  the plan's own convention applied to itself.

## Out of scope

- Cross-repo factory operation (G2).
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
2. **Which lane for S1?** The plan picks the UI-polish loop for blast radius;
   `fix/rolling` is the alternative — more representative, more dangerous.
3. **Does the factory hub run long-lived or per-session?** Materially changes
   the Postgres/port mitigations and whether the Beadle can tick unattended.
4. **Is `worker-bulk` worth a seat at all**, or should codex bulk work stay a
   tool the `worker-exec` seat calls? The seat exists to make the model lane
   visible; the cost is a persona that never thinks for itself.
5. **How far does the preview pane go?** Localhost-only with a port allowlist is
   the proposed bound. Anything wider is an SSRF-shaped surface and needs its
   own gate.
6. **Gate 1 in S4 or its own slice?** Plan approval carries a plan review doc
   (`visual-review-doc.md`), which may pull more artifact work forward.
