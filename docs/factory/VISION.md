# Boring Factory — Vision

Boring-ui is the chassis; the factory is the first serious app composed on it.
Goal: a factory that is not overly complex but ships software much faster than
today, where the core is solid enough that plugins are near-fully vibe-coded.

Inspiration: Yegge (shape-of-things-to-come, model-welfare), agent-flywheel,
Agent Mail — adopted selectively; deviations are deliberate and listed below.

## Operating principle

- Work graph (Beads) is the only authority on work state.
- Durable named seats above ephemeral sessions; identity lives in the seat.
- Human attention is reserved for the protected boundaries in
  [risk-based delivery](../procedures/boring-loop.md), at plan-time when a
  decision is needed and before merge for the actual protected diff. Use inbox
  Human Intentions; routine eligible changes do not wait for owner review.
- "Crons watch, models act": mechanical transitions are automations, thinking
  is seats.
- Rework escalation law: plan space 1x, bead space 5x, code space 25x — spend
  intelligence upstream.

## The six layers

| Layer | What | Status (2026-08) |
| --- | --- | --- |
| L0 Chassis | AgentHost fleet spec, identity/authority split, plugin system, sandboxed tool admission | exists (#1075) |
| L1 Work graph | Beads via plain `br` CLI; GH issues = human intake, 1 epic = 1 GH issue | br live; UI read-only provider in #1075 |
| L2 Seats | orchestrator / worker / triage in `.agents/factory/fleet.yaml`; triage has its own scheduled automation | three-seat production loader live; historical persona material remains authored |
| L3 Loops | /triage /plan /exec skills + Beadle supervisor automation (workers pull) | skills exist; Beadle missing |
| L4 Human plane | Concierge front door, inbox intentions, (later) Swarm Console | intentions exist; edges landing (session↔task, artifact handover) |
| L5 Comms | thread=bead convention only; Agent Mail/Buzz deferred | convention adoptable now |

## Ratified decisions (grill session 2026-08-05)

1. **Ownership**: primitives in boring-ui core; factory instance = repo config
   now, trusted statically-composed plugin after graduation. Workflow first,
   plugin second.
2. **Beads**: plain `br` for all agents. Git history of `.beads/issues.jsonl`
   is the audit trail. Beadle flags beads closed without linked proof/handoff.
   No verb ACLs.
3. **Beadle** (amended 2026-08-06): a supervisor, never a dispatcher. Dispatch
   is pull-based, flywheel-style: a worker session starts with `br ready
   --json`, leases exactly one bead, and stamps its own session id on the bead
   at claim — claim and binding are one atomic act by the worker. The Beadle
   only guarantees pullers exist and janitors the graph: spawns workers while
   ready > active (up to the cap), breaks stale leases, flags proof-less
   closures, sweeps epic-branch drift. It never chooses which bead. Tick
   cadence and worker cap live in policy.yaml.
4. **Trust ladder (amended by owner, 2026-09-07)**: eligibility and protected
   boundaries now follow [boring-loop](../procedures/boring-loop.md), including
   the >500 changed package production-line trigger. Plugins/peripheral work,
   including plugin UI with before/after video, may use automatic delivery only
   after independent proof and the mandatory cross-package abstraction gate.
   No agent can widen its own authority; policy/CI/gate changes need the owner.
   The older path-allowlist/300-line predicate in `.agents/factory/policy.yaml`
   has not yet been migrated; this amendment does not flip a runtime switch.
5. **Sessions**: 1 bead = 1 durable session. Handoff ritual fires *before*
   compaction (notes onto the bead + commit WIP); post-compaction re-prime =
   read AGENTS.md + bead + own notes. Beadle stale-lease is the safety net.
6. **Intake (refine; amended 2026-09-07)**: raw ideas → agreed objective →
   ready plan/Beads. Obtain owner plan decisions only for protected boundaries
   or unresolved intent; preserve existing pending/host-required gates during
   rollout. Plan approval never authorizes an unseen implementation. Triage
   automation routes external intake into the same funnel.
7. **Branching** (amended 2026-09-02): one shared worktree per epic (in
   `.worktrees/`); commit/branch mechanics owned by
   `docs/procedures/worktree-agent.md`. Beads need not declare file scope.
   Workers edit the shared worktree, commit frequently to its epic branch, and
   resolve visible conflicts in place without overwriting peer work. Dedicated
   remote sandboxes test or serve exact committed SHAs; they are not editing
   authorities. Beadle auto-rebases epic branches on main (thresholds in
   policy.yaml); unresolved conflicts become blocking beads. 1 epic = 1 GH
   issue = 1 shared worktree = 1 PR.
8. **Bugfix lane**: one standing rolling worktree (`fix/rolling`). 1 fix =
   1 bead = 1 inbox intention, reviewed individually (surface by surface).
   Fixes accumulate; owner review flushes approved fixes to main (cherry-pick
   mixed batches). Auto-merge graduation = policy flip, later.
9. **Models**: priority-ordered tier table in
   `docs/procedures/MODEL-CARD.md`. Fleet policy references tiers,
   never model IDs. Quota is an availability gate: fall to next model in-tier
   on rate limit; defer (never silently downgrade) shippable work when a tier
   is exhausted. Seats need Anthropic runtimes; Sol runs via codex as
   ephemeral adversarial passes only, track cap per the T1 row in
   `docs/procedures/MODEL-CARD.md`.
10. **Comms** (reaffirmed 2026-09-02): thread=bead everywhere — commit
    messages, session titles, intention subjects, artifact names. Start shared-
    worktree execution without Agent Mail, file reservations, or a second
    coordination plane; conflicts are visible and resolved in the workspace.
    Add Agent Mail only if observed collisions justify it, and then behind the
    Agent Communications adapter. Buzz pilot deferred.

## Factory runs on boring-ui primitives

The factory adds no new runtime. Every moving part is an existing primitive:

| Factory part | Primitive |
| --- | --- |
| Beadle supervisor | `plugins/boring-automation` scheduled automation |
| Task board (GH + Beads) | `plugins/tasks` sources — `githubSource` (main) + Beads adapter (read-only, on PR #1075; merge + registry seam = TODO 3) |
| Seats | AgentHost fleet spec + `.agents/personas/*` identities |
| Worker execution | pi sessions (1 bead = 1 session) + pi-subagents for ephemeral roles |
| Human gates | Human Intentions / inbox (`ask-user` surface) |
| Policy | repo files: `.agents/factory/policy.yaml`, MODEL-CARD, AGENTS.md |

Beads adapter contract and extension points: `.agents/factory/tools.md`.

## Dynamics decisions (grill session 2026-08-05, round 2)

11. **Learning loop (amended 2026-09-07)**: friction notes on every bead;
    Steward retro pass at epic close emits corrective beads. Classify each by
    boring-loop; being docs/skills work is not automatic permission to change
    safety rules, review requirements or authority.
12. **Failure paths**: bounce upstream with capped rounds — round caps are
    `bounce.worker_attempts_per_bead` and `bounce.review_rounds_max` in
    policy.yaml; owner attention only at gates and genuine dead ends. Detail:
    `.agents/factory/README.md` (Dynamics).
13. **Post-merge/release**: out of scope for now. Releases stay a manual owner
    action; revisit after graduation.
14. **Backlog order**: Steward sets bead priority at plan time; claim =
    priority then age; optional reserved bugfix slot in policy.yaml.
15. **Bead definition-of-ready**: a procedure
    (`docs/procedures/bead-ready.md`), Steward-enforced; Beadle
    enforcement only if sloppy beads show up in practice.
16. **Bootstrap**: clean the decks manually first — land/kill the in-flight
    branches (1060, 786, 1075, worktree pruning) the old way; the factory
    starts fresh on new issues afterward.
17. **Concierge context**: same handoff-before-compaction ritual as every
    seat; durable state in beads/notes, never in session context.
18. **Spend bounds**: none yet; the worker cap bounds concurrency. Revisit
    after the 10-issue run.

## Deliberate deviations from the inspirations

- No repo-wide shared editing branch (flywheel): keep epic worktree ownership
  and integrate small verified changes frequently. Under the 2026-09-07
  amendment, owner attention follows protected boundaries, not every routine
  PR; existing epic/rolling topology and pending decisions are preserved.
- No 38-seat roster (Yegge): a seat exists only where a standing
  responsibility must accumulate context across sessions. Two seats now
  (`orchestrator`, `worker`); triage is worker automation, and production-ops
  seats (Sheriff/Gargoyle) wait until production traffic exists.
- No Agent Mail / native comms now: every worker message type already has a
  home (claim→br, handoff→bead notes+artifact, escalate→intention,
  review→dispatcher transition).
- Welfare mechanics adopted where structural: handoff-over-kill, seats vs
  sessions, blameless postmortems-as-beads. Laurels/recognition: later.

## Graduation bar (10-issue manual run)

Run the loop manually/scheduled across ~10 real issues (epics + bugfix-lane
fixes) before building the factory plugin or Swarm Console. Graduate when:

1. ≥8/10 flowed refine→plan→exec→review→flush with zero out-of-band
   coordination (all human touch via inbox intentions).
2. Every merge traceable bead→session→PR→proof and review, plus an owner
   intention for the human route or an enforced policy admission for the
   automatic route (2026-09-07 amendment; broader automatic route not yet enabled).
3. Stale-lease/handoff recovery fired at least once and worked.
4. Owner hands-on time trended down issue-over-issue.

Miss any → fix the workflow, stay manual.

## Standing rituals

- Post-compaction, every session re-reads AGENTS.md + its bead.
- Strategic checkpoint (Concierge, recurring): "if we close every open bead,
  do we reach the goal?"
- Execution friction feeds back upstream: spec fix > AGENTS.md rule > skill.
