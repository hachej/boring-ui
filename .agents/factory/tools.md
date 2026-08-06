# Factory tool contract

Which tool owns which fact, and who may use it. The rule behind the table: every
fact has exactly one authority, and no stage invents a second path to it.

| Concern | Authority | Tool | Who |
| --- | --- | --- | --- |
| work state (tasks, deps, claims) | Beads graph | `br` CLI | every seat |
| human intake, epics, PRs, labels | GitHub | `gh` CLI | triage, steward, reviewer |
| code and history | git worktrees | `git` | worker (write), reviewer (read) |
| human decisions | inbox Human Intentions | `ask_user` | every seat |
| supervisor spawns and sweeps | `plugins/boring-automation` | scheduled automation | beadle only |
| task board rendering | `plugins/tasks` sources | GitHub + Beads adapters | UI, read-only |
| seat runtime | AgentHost fleet | authored persona + trusted policy | host |
| parallel fan-out | `pi-subagents` (runtime plugin skill) | ephemeral subagents | steward, reviewer, worker |

## Beads (`br`)

The graph is the only authority on work state. All seats run `br` directly;
there are no verb ACLs and no second write path. `.beads/` is committed, so
git history is the audit trail.

**One graph, not per-branch copies**: the live DB is the canonical checkout's
`.beads/`. Sessions running in a `.worktrees/` worktree must pass
`--db <canonical-checkout>/.beads/beads.db` on every `br` call — the worktree's
own `.beads/` is a stale branch snapshot, and a bead created in the canonical
graph is invisible without the flag (found the hard way, first factory run,
gh-1051).

- Claim work by lease off the ready list; never work an unclaimed bead.
- Record handoff notes on the bead before compaction or release.
- The bead ID is the correlation key everywhere: commit subjects
  `[br-###] description`, session titles, intention subjects, artifact names.
  This is the whole reason no agent-messaging system is needed yet.
- The tasks plugin's Beads adapter is the **read/UI** path only. If board-side
  mutation is wanted later, extend that adapter's optional `moveTask`/
  `deleteTask` runtime methods — do not add a second write path.

## GitHub (`gh`)

Human-facing intake and delivery, not the granular tracker. One epic = one issue
= one PR. Labels follow the Boring Loop state model (`docs/procedures/boring-loop.md`):
exactly one state, detail in comments, no revived gate taxonomies.

## Git and worktrees

Follow `docs/procedures/worktree-agent.md` in full. Factory specifics:

- All worktrees under `.worktrees/`. Never push to remote `main`.
- Inside an epic worktree, workers commit directly to the epic branch; no
  per-bead sub-branches, push after every commit.
- Setup runs from the canonical checkout, never from inside another worktree.
- Before editing, inspect branch and dirty state — other sessions are live.
- Stop before destructive operations, force pushes, releases, or file deletion
  unless explicitly authorized.

## Human Intentions (`ask_user`)

The only human surface. Plan approval, merge approval, escalations, and
"this needs the owner" all become inbox items; GitHub comments are the fallback
only when `ask_user` is unavailable. Merge approval must name the exact SHA and
expected target head. A seat may never approve its own request.

## Models

Seats bind to tiers, never to model IDs; tiers resolve through the model card
(`docs/procedures/MODEL-CARD.md`). Quota is an availability gate: on a rate limit,
fall to the next model in the same tier; if a whole tier is exhausted, defer
shippable work rather than silently downgrading it.

Runtime constraint: durable seats need a pi-native model. Codex-hosted models
(Sol, Terra, Luna) run as ephemeral delegated passes — cross-model review,
mechanical bulk work — and cannot hold a seat.

## Not in the factory

Deliberately absent, with the trigger that would change it:

- **Agent-to-agent messaging** (Agent Mail, Buzz, native mail) — every message
  type already has a home above. Revisit only if more than five concurrent
  workers actually collide, and then as a provider behind an adapter, never as
  a second control plane.
- **Autonomous merge to `main`** beyond the class A trust ladder.
- **Self-certified completion** — a seat declaring its own work done.
- **Dashboards and metrics** — deferred until the loop runs manually across ten
  real issues (`docs/factory/VISION.md`, graduation bar).
