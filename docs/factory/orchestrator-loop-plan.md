# Orchestrator loop — plan

One cron wakes one orchestrator. It checks the fleet, janitors the graph, starts
work, and exits. Workers pull their own beads and outlive the tick that started
them.

## Goal

Make the factory run unattended without a human dispatching work, without an
agent babysitting other agents, and without a stuck bead disappearing silently.

**Division of labour, stated once:** workers own `/plan` and `/exec` — the
whole of the work, planning included; a planning task is just another bead a
worker claims, and **triage is just work too** — a worker slot with a triage
standing prompt, not a seat. The orchestrator owns none of the work. It only
keeps things on track: are the slots healthy, are leases moving, is ready work
being started, did anything stall or need the owner. When in doubt about
whether something is the orchestrator's job: if it produces work product, it
is not.

**The whole factory is two personas and two plugins.**

| | |
| --- | --- |
| `orchestrator` persona | keeps it on track |
| `worker` persona | does the work — exec, plan, triage, review via fresh-eyes subagents |
| `boring-automation` plugin | when things run and how they are started, watched, nudged, cancelled |
| `ask-user` plugin | how anything reaches the owner |

Those four are the complete primitive set. The `boring-triage` seat is retired
from the roster (`fleet.yaml`) — its skill survives as the triage slot's
standing prompt. Anything the factory later needs should be expressible in
these four before a new primitive is considered.

## Today

The pre-change factory baseline booted for real on 2026-08-14 (folder mode,
`:5300`, published CLI 0.1.98, clean worktree). At that baseline, all three
then-configured seats composed with pinned digests and carried `ask_user` +
`boring_automation`; this plan retires the triage seat in favor of the worker
automation slot described above.

One supervised tick ran. It did real work: broke **23 stale leases** with
evidence and returned them to ready, **refused** an underspecified bead
(`…nfgt.1` → deferred, `plan-defect`, `steward-review`), held the UI-collision
lane when a second worker tried to claim UI work, rebased a 644-commit-stale
epic branch without conflict, and flagged 30 proof-less closures. It merged
nothing and pushed nothing.

It failed in one way, and that failure defines this plan: **it spawned workers
with the harness `subagent` tool**, the only spawn primitive a seat can reach.
Subagents are children of the spawner's turn, so the workers died when the tick
ended, leaving `wt-391-forward-pmz.1` leased with nobody serving it. The
supervisor also began steering and interrupting those workers — the
supervisor→dispatcher drift ratified decision 3 forbids.

Verified by inspection, not assumed:

| Fact | Evidence |
| --- | --- |
| Automation runs are host-owned and outlive their trigger | `startRunHeartbeat`, `reconcileOrphanedRuns` |
| The scheduler refuses to start an already-active run | `RUN_ALREADY_ACTIVE` skip in `dueRunService` |
| An agent inside a run can trigger another run | `probe-nest` → `probe-noop`, both succeeded, 16.7s |
| Nudging a **streaming** session is rejected | `409 AGENT_COMMAND_INVALID_STATE`; only idle sessions accept a prompt |
| Two packages claiming one `definitionId` both fail closed | `agentPackageDiscoveryConflict` test |
| `WorkspaceAgentDispatcher` is the sanctioned in-process primitive | `packages/agent/docs/API.md`; automation already uses it |
| `ask_user` blocks its session until the owner answers | gate session observed holding at `input-available` for hours |

## The loop

```
cron */10 → orchestrator run
  │
  ├─ 1. FLEET HEALTH FIRST
  │       for each active worker: alive, and progressing?
  │         lease fresh          → leave alone
  │         idle past heartbeat  → nudge, and unblock if the blocker is mechanical
  │         still stuck          → cancel, reclaim the bead, free the slot
  │
  ├─ 2. JANITOR — stale leases, proof hygiene, epic-branch drift
  │
  ├─ 3. START triage slot   (when untriaged issues exist)
  ├─ 4. START worker slots  (while ready > active)
  │         └─ worker claims its OWN bead via br, works, hands off
  │
  └─ 5. REPORT and EXIT — within minutes, always. Nothing in a tick ever
        blocks on a human.
```

**Session continuity is an automation field, not a hardcoded rule** — see
Change 1. The orchestrator ships with `sessionMode: "new"`: each tick is a fresh
session and the cron never resumes the previous tick's session. A standing supervisor session would accumulate every tick's chatter,
compact mid-tick, and re-send a growing prompt forever. A fresh session forces
the persona's own rule — *durable state lives in beads and notes, never in
accumulated context* — and makes every tick idempotent: it re-derives leases,
runs and the ready queue from the graph, so a tick after a host restart behaves
exactly like any other. This is already how automation runs behave, so it costs
nothing.

*Consequence, and it is load-bearing:* the ladder's memory cannot live in the
orchestrator's head. "Nudged last tick, so cancel this tick" only works because
the nudge was written to the bead. **A nudge that is not recorded did not
happen** — an unrecorded nudge makes the next tick nudge again, forever.

*Not to be confused with:* the orchestrator's **standing** session — the owner's
pinned counterpart, which is never recycled. Same seat, two lifetimes: one
durable conversation with the owner, one disposable session per tick. They must
not be the same session, or the owner's conversation ends up buried under
hundreds of janitor ticks.

Two rules carry the whole design:

**Health before dispatch.** If slots are filled before zombies are cleared, the
orchestrator dispatches into a fleet it believes is emptier than it is, and
capacity drains while every report reads clean.

**Trigger and exit — never await a worker.** Worker runs are host-owned. If the
orchestrator waits, it holds its own slot for hours and we are back to the
failure above in a nicer wrapper.

The orchestrator starts a **slot**, never a bead. Workers claim by priority then
age, and stamp their session id on the bead at claim — one atomic act. Decision
3 intact.

### Slots are automation records

A slot is not a new concept: it **is** a pre-created automation with no cron.
`boring_automation run` against its id is the dispatch; the existing
`RUN_ALREADY_ACTIVE` check is the occupancy rejection — zero new enforcement
code, which is the point.

| Automation | Cron | Standing prompt |
| --- | --- | --- |
| `orchestrator-tick` | `*/10` | orchestrator persona · the tick loop (this plan) |
| `worker-slot-1..3` | none (dispatch-only) | worker persona · claim the top ready bead you are allowed to take, work it, hand off |
| `triage` | none (dispatch-only) | worker persona · triage untriaged GitHub issues per the triage skill — classification is work, so a worker does it |

A dispatch run may carry an optional per-dispatch brief; worker slots normally
run on their standing prompt alone. The **UI-collision lane is enforced by the
claimer**, not the orchestrator: at claim time a worker seeing another live
UI-surface lease takes the next non-UI bead instead — the behaviour the first
tick's worker already showed unprompted, now written down. Lane enforcement at
claim time is atomic with the claim; tick-time knowledge is stale by definition.

## Where each concern lives

Nothing here requires a redeploy to change how the factory behaves.

The seat has two lifetimes — the owner's standing pinned session and a
disposable session per tick — and both read the persona. So the **tick loop does
not go in the persona**: it lives in the automation's own prompt file, or every
conversation with the orchestrator would carry janitor instructions it does not
need. The persona holds who it is and what it may never do; the automation
prompt holds what this particular tick does.

| Concern | Home | Changed by |
| --- | --- | --- |
| Capability — the verbs | `plugins/boring-automation` | code + release |
| Behaviour — the tick loop, the ladder | `.agents/automation/<orchestrator-id>.md` (the automation prompt) | prompt edit |
| Posture — seat identity and hard limits | `.agents/personas/orchestrator/instructions.md` | config edit, class B |
| Tuning — caps, limits, cadences | `.agents/factory/policy.yaml` | config edit, git-audited, class B |
| Identity — the seats | `.agents/personas/*` (repo config) | config edit, class B |

## Change 1 — `plugins/boring-automation`

Stays generic. No factory concept enters it: no slots, no beads, no ladder.

- Add `"dispatch"` to the run trigger union (`"manual" | "scheduled"` today). A
  dispatched worker session and a cron run are the same object with a different
  origin.
- Add three operations to the `boring_automation` tool:
  - `list` — join what already exists: runs, `sessionId`, session status and
    age, and the `[br-###]` session-title convention. This is the fleet view;
    without it the orchestrator supervises blind.
  - `nudge(sessionId, message)` — `dispatcher.send()` on an existing session.
    Must surface `409 AGENT_COMMAND_INVALID_STATE` rather than swallow it:
    steering a **busy** session requires interrupt-then-prompt, and pretending
    otherwise hides a stuck worker.
  - `cancel(sessionId)` — `interrupt()` / `stop()`.
    (For `nudge`, the invariant is *fail loudly on a non-idle session*; verify
    the dispatcher-level equivalent of the HTTP 409 during implementation —
    the in-process error shape may differ.)
- Starting a run in an **occupied slot is rejected by the tool**, reusing the
  existing active-run check. `worker_cap` becomes structural rather than the
  orchestrator's judgment — the defect from the first tick made impossible
  instead of merely forbidden.
- Rename the internal concept *automation run* → **dispatch run**. Cron becomes
  one trigger among three, not the identity of the thing.
- Add a `sessionMode` field to an automation: `"new" | "continue"`.
  - `"new"` (default, and today's behaviour) — every run gets a fresh session.
    Idempotent, bounded context, safe for anything mechanical.
  - `"continue"` — every run prompts the **same** session, preserving continuity
    across runs. Safe by construction: `RUN_ALREADY_ACTIVE` guarantees the
    previous run has finished, so the session is idle when the next run prompts
    it — precisely the state a prompt requires (a streaming session returns
    409). If the stored session is gone or unusable, fall back to `"new"` and
    say so in the run record rather than failing the tick.
  - Default `"new"`, because `"continue"` grows context without bound (a
    10-minute tick is ~4,300 turns a month in one session, so it *will* compact)
    and carries a confused state forward instead of recovering from it.
    Continuity is worth choosing deliberately, per automation.

**The existing suite must stay green.** It is the blast radius of the rename and
the highest-probability regression in this work. No assertion may be weakened to
get green; a behaviour change must be argued, not absorbed.

## Change 2 — `.agents/factory/policy.yaml`

```yaml
beadle:
  nudges_per_attempt: 1        # nudges before the ladder escalates to cancel
  nudge_cooldown_minutes: 15   # one full lease heartbeat before a repeat nudge
```

(Cooldown deliberately exceeds the 10-minute tick so a boundary-timed tick can
never double-nudge, and matches `lease_heartbeat_minutes` — a nudged worker
gets one full heartbeat to respond before the ladder moves.)

`worker_cap: 3`, `stale_lease_minutes: 90`, `lease_heartbeat_minutes: 15` and
`bounce.worker_attempts_per_bead: 2` already exist and are unchanged. Limits are
parameters, never constants in code or prompts — a constant in a prompt cannot
be reviewed, diffed, or changed without editing an agent's instructions.

## Change 3 — non-blocking intentions (`ask_user` `wait: false`)

`ask_user` today bundles two different things: **filing** a durable inbox item
(fast, safe anywhere) and **blocking until answered** (tolerable only in a
session whose whole job is to wait). Unbundled, because the bundle freezes the
factory:

> Tick calls `ask_user` → the turn cannot end → the run stays active →
> `RUN_ALREADY_ACTIVE` skips every subsequent tick → **one raised question
> halts all health checks, janitoring and dispatch** until the owner happens to
> open the inbox. The alarm would stop the factory more thoroughly than any
> stuck bead ever could.

- Add `wait: false` to `ask_user` (or a sibling `raise_intention` operation):
  file the intention, return its id immediately, turn ends, run completes.
- The intention is already durable in the workspace — the blocking wait is only
  a delivery mechanism for the answer, not what keeps the item alive.
- The **answer lands on the intention record**. Delivery is poll-on-read: the
  tick's first step reads decisions on intentions it previously raised (ids are
  on the beads) and acts on them. ≤1 tick of latency, no push machinery. Push
  delivery to a session can come later if a consumer needs it.
- Blocking mode stays for conversational gates — sessions dedicated to waiting.
  **Nothing that runs on a cron ever blocks on a human.**
- Side benefit: no orphaned waiters. Every blocked `ask_user` session is a turn
  pinned until answered, and a host restart loses it (#1238). An async
  intention has no waiting session to lose.

## Change 4 — standing prompts are deliverables

The tick loop, worker-slot, and triage standing prompts ship in this PR as
files (seeded into `.agents/automation/`), so the proof path tests what the PR
actually contains. They are config-class and reviewed in the same diff.

## Liveness — nobody watches a worker, something watches the slot

The lease is the heartbeat. There is exactly one definition of alive, and idle
looks the same whether the cause is a crash, compaction, or a wait that never
wakes.

| State | Action |
| --- | --- |
| lease fresh | leave alone, however slow. A slow bead is not a stuck bead. |
| lease stale, session **streaming** | leave alone — presumed working. Only the 90-min `stale_lease_minutes` backstop may reclaim from a live-but-silent worker. |
| lease stale, session **idle** | **nudge once**, recorded on the bead with evidence |
| still idle next tick | cancel the run, break the lease, bead → ready, attempt +1 |
| `worker_attempts_per_bead` exhausted | Steward as spec defect **and** an owner intention (`wait: false`) |
| live slots < `worker_cap` for 2 ticks | owner intention (`wait: false`) — silent capacity drain |

**Two reclaim clocks, disjoint jurisdictions:** the ladder owns sessions the
orchestrator can observe *and prompt* (idle ones). `stale_lease_minutes` is the
backstop for everything it cannot — streaming, unreachable, or on a dead host.
The ladder never cancels a streaming session.

**Every ladder action writes a structured bead comment *before* acting** —
`nudge #1 <ts>`, `intention-raised <condition> <id> <ts>`,
`cancelled <ts> attempt=N`. Fresh-session ticks have no memory; the bead is the
ladder's state machine, and an action without its comment is a bug (proof 1).
This is also what enforces "one intention per bead per condition".

Crashed runs are already reconciled by the store. The gap this closes is the
**zombie**: a run alive and heartbeating while its worker is hung, which today
holds a slot forever because no timeout exists anywhere.

### Nudging keeps things on track, nothing more

A stalled worker is usually waiting on something rather than broken, and a
reclaim throws away up to 90 minutes while a nudge costs one turn. So the nudge
should be **informed** — the orchestrator knows the bead, the handoff, PR and
CI state, and what the last tick recorded, and says the useful thing:
"your branch is 14 behind main and CI failed on invariants; rebase, and the
lease is your heartbeat." Judgment comes **from durable state only** — bead,
handoff, diff, CI. Worker transcripts stay invisible (persona rule: read work
back from bead end-states; if an end state surprises you, re-plan from it).

It **may never do or judge the work**: not claim a bead, not edit files, not
plan, not evaluate an approach. Quality is judged at review and the gates.
Anything needing owner judgment — scope, design, external access, a merge —
raises one intention and moves on.

## Escalation — a stuck bead always reaches a human

| Condition | Action |
| --- | --- |
| blocker is mechanical | orchestrator unblocks; owner never sees it |
| blocker needs judgment | **one intention immediately** (`wait: false`) — do not burn the second attempt first |
| both attempts exhausted | **one intention** with evidence from both, plus the Steward route |
| slots drained 2 ticks | **one intention** |

One intention per bead per condition; never re-raised each tick. An unanswered
intention is unanswered — never consent.

## Proof path

1. Unit: trigger union; occupied-slot rejection; `nudge` surfacing 409; ladder
   transitions.
2. `boring-automation` suite green — paste the counts.
3. Live tick against the real ready queue: workers start, **survive the tick
   that started them**, claim their own beads, and still appear running in
   `list` after the orchestrator is idle.
4. Kill a worker mid-bead → next tick nudges; the one after cancels and
   reclaims. Graduation criterion 3 under its real failure mode.
5. Zombie: hang a worker without killing it → slot reclaimed, drain intention
   raised.
6. Unblock: stall a worker on a never-waking wait → nudged to completion with
   **no** reclaim. This is what earns the nudge its place ahead of cancel.
7. Non-blocking escalation: a tick that raises an intention **completes its run
   within minutes**, the next cron tick fires normally, and a decision recorded
   on the intention is read and acted on by a later tick.
8. Ladder state on the bead: every nudge/intention/cancel is preceded by its
   structured comment; a second tick never re-raises the same condition.

## Not in scope

- **A new plugin.** These verbs are generic; they belong in `boring-automation`.
  Factory specifics live in `policy.yaml` and the persona prompt.
- **Moving, renaming or deleting persona packages**, or declaring
  `boring.agent` anywhere else. Two packages claiming one `definitionId` both
  fail closed, which would take the orchestrator seat down on merge. Seats stay
  repo config; packaging them into a factory plugin is a post-graduation step
  (Decision 1). *Editing* `instructions.md` is allowed — it is class B, so it is
  owner-reviewed at merge, which is the right friction rather than a ban.
- **Extracting the run service into `packages/agent`.** One consumer; revisit
  when there is a second.
- **A2A.** Decision 22 makes this the native in-process binding; A2A is an
  external binding only, and internal loopback is explicitly rejected.
- **Durable task/events** (Decision 30 Step 3). The bead lease is our
  durability today. The factory is the named consumer that would justify Step 3
  — worth filing separately.

## Risks

| Risk | Mitigation |
| --- | --- |
| The rename touches a working scheduler | existing suite is the gate; no weakened assertions |
| Idle ticks cost tokens | orchestrator must exit fast on an empty queue |
| Claim races between simultaneous starts | `br` leasing is atomic; stagger starts within the tick |
| Nudging becomes babysitting | bounded by `nudges_per_attempt`, then reclaim |
| Prompt drift as the loop is tuned | behaviour lives in one prompt, versioned in git |

## Owner rulings already recorded

- `worker_cap: 3`
- `nudges_per_attempt: 1`, then cancel and reclaim; two attempts then Steward
  **and** an owner intention
- Triage runs automatically from the first tick, including issue comments — the
  plan gate is the safety net
- The orchestrator prompt will be tuned after the first live runs
