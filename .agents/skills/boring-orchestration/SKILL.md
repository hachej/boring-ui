---
name: boring-orchestration
description: "Use this skill to run the boring-ui maintainer loop on a scheduled cadence: refresh repo state, call triage, route work to workers, coordinate stacked PRs, enforce review/proof gates, prepare owner decisions, and perform narrow auto-merge only when policy allows."
---

# Boring Orchestration

Run the loop. Do not do the worker's job.

## Lineage

This sweep is Steinberger-inspired:

- refresh repo state before acting;
- read newest owner intent first;
- triage into decision-ready routes;
- delegate implementation to bounded workers;
- keep proof, permission, and owner-decision accounting;
- record meaningful state changes, not diary noise.

The stacked PR section is Theo-inspired: ask the agent to design a workflow that
creates implementation/review subloops for complex work, then wrap that workflow
in Kanzen proof and merge gates.

## Inputs

- Repos/projects under maintenance.
- Current owner instructions.
- GitHub issues, PRs, labels, CI, reviews, and merge state.
- Kanzen triage records, worker runs, proof records, and permission policy.

## Sweep

Triage runs here on queued or stale work. The orchestrator does not care where
an item came from.

On each scheduled wakeup:

1. Refresh issues, PRs, CI, reviews, merge state, proof, and worker state.
2. Read newest owner comments/instructions before touching any item.
3. Pick queued or stale items that need classification or routing.
4. Run `boring-triage` on those items.
5. Route each item by status:
   - `status:needs-grill`: leave in refinement queue; do not start a worker.
   - `status:needs-owner`: prepare one decision brief.
   - `status:to-plan`: create a plan or stacked PR proposal.
   - `status:to-implement`: assign or reuse one worker lane.
   - `status:to-review`: run review/fix/re-review loop.
   - `status:to-merge`: evaluate merge gates.
6. Record only meaningful state changes.

## Worker Lanes

Use one GitHub item in one repository per worker lane. A worker lane is a
Codex/Kanzen execution context: one thread/run plus its branch, worktree, and
state for that item. It is not a GitHub concept.

Workers do not spawn other workers.

Default branch/worktree:

```text
branch: codex/issue-<issue-number>-<short-slug>
worktree: <project>/.worktrees/kanzen-issue-<issue-number>
```

Every worker prompt must include:

- issue/PR URL;
- repo path;
- branch/worktree rule;
- exact permissions;
- acceptance criteria;
- proof requirement;
- quality gates;
- review requirement;
- stop conditions.

Stop the worker for missing owner decisions, missing access, failed checks
without CI-fix permission, stale/conflicted branches, destructive actions,
release/publish work, or merge without explicit permission.

## Stacked PRs

Use stacks for work that is too large for one reviewable PR. Prefer a
Theo-style workflow prompt over a static PR list: ask the agent to design the
sub-loop, then enforce Kanzen gates around the result.

Stack workflow prompt:

```text
Given this parent issue/plan, create a workflow that:

1. breaks the work into reviewable PRs;
2. decides whether the PRs are parallel, stacked, or mixed;
3. creates/uses one implementation lane per active PR;
4. opens draft PRs when each layer is ready;
5. starts a fresh review lane whenever a PR head SHA changes;
6. sends actionable review findings back to the owning implementation lane;
7. repeats review/fix/re-review until clean or capped;
8. runs required tests and demo proof for each layer;
9. merges only when Kanzen merge gates allow it;
10. pulls/rebases the next base before starting the next layer.

Return:
- proposed PR order, base branch, purpose, acceptance criteria, proof, and
  review focus for each layer;
- required permissions;
- stop conditions;
- first next action.
```

Start with plan-only output. Create draft stacked PRs only when repo policy
allows it. Review and prove each layer independently. Auto-merge applies per PR,
never to the whole stack at once.

## Review And Proof

Review loop:

1. Build context from PR diff, issue, invariants, and proof.
2. Run a fresh reviewer thread/model.
3. Classify findings: accepted, rejected, needs-owner, trivial.
4. Fix accepted findings.
5. Re-run affected tests/proof.
6. Re-review until clean or capped.

Caps: max 3 rounds per PR, max 1 hour unless owner grants more.

Proof must match the final head SHA. Workspace UI, plugin, and agent-visible
changes need demo workspace proof unless explicitly waived.

## Auto-Merge

Auto-merge only when all gates pass:

- repo and item allow auto-merge;
- item has `status:to-merge`;
- PR is non-draft and branch is worker-owned;
- required CI is green for current head SHA;
- review is clean for current head SHA;
- proof is current for current head SHA;
- no owner-gated blocker remains;
- public proof comment is posted.

Never auto-merge auth, billing, permissions, secrets, migrations, public API
changes, releases, broad refactors, deletion-heavy changes, or missing required
live proof.

## Owner Brief

Owner communication has one canonical destination: the Kanzen decision inbox.
The orchestrator writes owner briefs there when an item needs a decision.

During manual testing, print the same brief in the Codex session. In production,
store it as a `kanzen_decision` record and show it in boring-ui. Post to GitHub
only when the information should be durable/public on the issue or PR.

Do not DM, comment, or notify the owner for every triage result. Write an owner
brief only when the route is `status:needs-owner`, a stack plan needs approval,
or a proved PR is ready for an owner merge decision.

Brief format:

```text
URL:
What changed / what is proposed:
Proof:
Risk:
Recommendation:
Choices:
```

Owner replies update routing:

- approve implementation -> `status:to-implement`;
- approve plan/stack -> continue from `status:to-plan`;
- request changes -> send back to worker or review loop;
- waive proof -> record waiver and reason;
- close/defer -> close/defer;
- merge -> merge path;
- deny auto-merge -> `mergeMode: owner` or `mergeMode: never-auto`.
