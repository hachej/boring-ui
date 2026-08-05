# Boring Factory — Vision

Boring-ui is the chassis; the factory is the first serious app composed on it.
Goal: a factory that is not overly complex but ships software much faster than
today, where the core is solid enough that plugins are near-fully vibe-coded.

Inspiration: Yegge (shape-of-things-to-come, model-welfare), agent-flywheel,
Agent Mail — adopted selectively; deviations are deliberate and listed below.

## Operating principle

- Work graph (Beads) is the only authority on work state.
- Durable named seats above ephemeral sessions; identity lives in the seat.
- Human attention is concentrated at plan-time and merge gates, always via
  inbox Human Intentions — never out-of-band chat.
- "Crons watch, models act": mechanical transitions are automations, thinking
  is seats.
- Rework escalation law: plan space 1x, bead space 5x, code space 25x — spend
  intelligence upstream.

## The six layers

| Layer | What | Status (2026-08) |
| --- | --- | --- |
| L0 Chassis | AgentHost fleet spec, identity/authority split, plugin system, sandboxed tool admission | exists (#1075) |
| L1 Work graph | Beads via plain `br` CLI; GH issues = human intake, 1 epic = 1 GH issue | br live; UI read-only provider in #1075 |
| L2 Seats | concierge / triage / steward / worker / reviewer under `.agents/personas/` | authored in #1075; no production loader |
| L3 Loops | /triage /plan /exec skills + Beadle dispatcher automation | skills exist; Beadle missing |
| L4 Human plane | Concierge front door, inbox intentions, (later) Swarm Console | intentions exist; edges landing (session↔task, artifact handover) |
| L5 Comms | thread=bead convention only; Agent Mail/Buzz deferred | convention adoptable now |

## Ratified decisions (grill session 2026-08-05)

1. **Ownership**: primitives in boring-ui core; factory instance = repo config
   now, trusted statically-composed plugin after graduation. Workflow first,
   plugin second.
2. **Beads**: plain `br` for all agents. Git history of `.beads/issues.jsonl`
   is the audit trail. Beadle flags beads closed without linked proof/handoff.
   No verb ACLs.
3. **Beadle**: a boring-ui automation. ~10 min tick; workers self-claim via
   `br` lease; cap 2 concurrent workers; breaks stale leases; spawns workers
   while ready > active; sweeps epic-branch drift.
4. **Trust ladder**: class A = path-allowlist AND reviewer-pass AND size-cap.
   Ladder/config/workflow/fleet-policy files are permanently class B (no agent
   can widen its own permissions). Config: `.agents/factory/policy.yaml`,
   workspace-editable, git-audited.
5. **Sessions**: 1 bead = 1 durable session. Handoff ritual fires *before*
   compaction (notes onto the bead + commit WIP); post-compaction re-prime =
   read AGENTS.md + bead + own notes. Beadle stale-lease is the safety net.
6. **Intake (refine)**: raw ideas → Concierge conversation → Steward
   materializes beads → one plan-approval intention → autonomous until merge
   gates. Triage automation routes external intake into the same funnel.
7. **Branching**: one worktree per epic (in `.worktrees/`), flywheel rules
   inside it — direct commits to the epic branch, `[br-###] desc` messages,
   push always, no per-bead sub-branches. Beadle auto-rebases epic branches on
   main (thresholds in policy.yaml); conflicts become blocking beads.
   1 epic = 1 GH issue = 1 worktree = 1 PR.
8. **Bugfix lane**: one standing rolling worktree (`fix/rolling`). 1 fix =
   1 bead = 1 inbox intention, reviewed individually (surface by surface).
   Fixes accumulate; owner review flushes approved fixes to main (cherry-pick
   mixed batches). Auto-merge graduation = policy flip, later.
9. **Models**: priority-ordered tier table in
   `docs/kanzen/MODEL-CARD.md`. Fleet policy references tiers,
   never model IDs. Quota is an availability gate: fall to next model in-tier
   on rate limit; defer (never silently downgrade) shippable work when a tier
   is exhausted. Seats need Anthropic runtimes; Sol runs via codex as
   ephemeral adversarial passes only (cap 2 tracks).
10. **Comms**: thread=bead everywhere — commit messages, session titles,
    intention subjects, artifact names. Agent Mail only if >5 concurrent
    workers collide in practice, and then as a provider behind the Agent
    Communications adapter, never a peer control plane. Buzz pilot deferred.

## Factory runs on boring-ui primitives

The factory adds no new runtime. Every moving part is an existing primitive:

| Factory part | Primitive |
| --- | --- |
| Beadle dispatcher | `plugins/boring-automation` scheduled automation |
| Task board (GH + Beads) | `plugins/tasks` sources — `githubSource` (main) + Beads adapter (read-only, on PR #1075; merge + registry seam = TODO 3) |
| Seats | AgentHost fleet spec + `.agents/personas/*` identities |
| Worker execution | pi sessions (1 bead = 1 session) + pi-subagents for ephemeral roles |
| Human gates | Human Intentions / inbox (`ask-user` surface) |
| Policy | repo files: `.agents/factory/policy.yaml`, MODEL-CARD, AGENTS.md |

Agents mutate beads via plain `br` in their worktrees (decision 2); the tasks
plugin adapter is the *read/UI* path. If board-side mutations (drag to move,
close from detail) are wanted later, extend the adapter's optional
`moveTask`/`deleteTask` runtime methods — do not invent a second write path.

## Dynamics decisions (grill session 2026-08-05, round 2)

11. **Learning loop**: friction notes on every bead; Steward retro pass at
    epic close emits corrective beads (class A — merge without owner).
12. **Failure paths**: bounce upstream with capped rounds — 2 worker attempts
    then spec defect to Steward; 3 review rounds then owner intention; owner
    attention only at gates and genuine dead ends. Detail:
    `.agents/factory/README.md` (Dynamics).
13. **Post-merge/release**: out of scope for now. Releases stay a manual owner
    action; revisit after graduation.
14. **Backlog order**: Steward sets bead priority at plan time; claim =
    priority then age; optional reserved bugfix slot in policy.yaml.
15. **Bead definition-of-ready**: a procedure
    (`docs/kanzen/procedures/bead-ready.md`), Steward-enforced; Beadle
    enforcement only if sloppy beads show up in practice.
16. **Bootstrap**: clean the decks manually first — land/kill the in-flight
    branches (1060, 786, 1075, worktree pruning) the old way; the factory
    starts fresh on new issues afterward.
17. **Concierge context**: same handoff-before-compaction ritual as every
    seat; durable state in beads/notes, never in session context.
18. **Spend bounds**: none yet; the worker cap bounds concurrency. Revisit
    after the 10-issue run.

## Deliberate deviations from the inspirations

- No repo-wide single-branch (flywheel): single-branch applies *inside* an
  epic worktree; owner gate at the epic boundary. Review capacity is 1-2h/day,
  not 13 rotating accounts.
- No 38-seat roster (Yegge): a seat exists only where a standing
  responsibility must accumulate context across sessions. 5 seats now;
  production-ops seats (Sheriff/Gargoyle) only when production traffic exists.
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
2. Every merge traceable bead→session→PR→intention via thread=bead alone.
3. Stale-lease/handoff recovery fired at least once and worked.
4. Owner hands-on time trended down issue-over-issue.

Miss any → fix the workflow, stay manual.

## Standing rituals

- Post-compaction, every session re-reads AGENTS.md + its bead.
- Strategic checkpoint (Concierge, recurring): "if we close every open bead,
  do we reach the goal?"
- Execution friction feeds back upstream: spec fix > AGENTS.md rule > skill.
