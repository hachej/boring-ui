# Steinberger Loop

This note analyzes Peter Steinberger's maintainer skills as reusable operating
system patterns for agent-maintained repos.

Sources:

- [`maintainer-orchestrator`](https://github.com/steipete/agent-scripts/blob/main/skills/maintainer-orchestrator/SKILL.md)
- [`github-project-triage`](https://github.com/steipete/agent-scripts/blob/main/skills/github-project-triage/SKILL.md)
- Theo's loop transcript in [`theo_loop.md`](theo_loop.md)

## Thesis

The Steinberger pattern is not "an agent writes code on a timer." It is a
control plane that continuously converts repo noise into decision-ready work.

The control plane does four jobs:

1. Classify work by autonomy and risk.
2. Delegate bounded work to repo-specific worker threads.
3. Keep proof, review, CI, live validation, and permissions explicit.
4. Ask the owner only when the next step is truly a decision.

The worker does implementation. The orchestrator does routing, proof accounting,
permission accounting, and owner-interface quality.

## Important Primitives

### URL-First Triage

Every issue or PR needs a card, not just a number:

- canonical URL and title;
- what changes and who benefits;
- fit, risk, blast radius, and author trust;
- proof state: repro, tests, CI, live/browser proof, visual artifact;
- blocker and exact next action.

This makes triage useful because the owner can say "do this", "close this", or
"land this" without rereading the whole thread.

### Autonomy Is A Classification

The triage skill treats autonomy as earned, not assumed.

Good autonomous candidates:

- narrow bug fixes with a repro or obvious failing test;
- docs, tests, or internal cleanup with low blast radius;
- low-risk CI/dependency work with a clear verification path;
- small UI polish with real browser proof;
- contributor PR repairs where the intended behavior is clear.

Owner-gated items:

- product direction;
- security or privacy judgment;
- auth, billing, identity, data loss, or permissions;
- broad refactors or public API changes;
- unavailable credentials or live proof;
- merge, close, publish, release, or destructive operations without explicit
  current permission.

### Decision-Ready Boundary

The orchestrator should not ask the owner about rough work.

Before asking, the worker should push as far as authorized:

- inspect the issue/PR discussion;
- reproduce or root-cause the problem;
- implement the bounded candidate;
- run focused and full tests where relevant;
- run live proof when runtime behavior changed;
- run autoreview until accepted findings are fixed;
- get CI green when push/CI authority exists;
- present the remaining decision with exact choices.

Owner asks become simple:

- land this prepared PR;
- close/delete this prepared PR;
- choose between documented alternatives;
- provide one credential/account action;
- grant an explicit proof waiver.

### Control-Plane Only

The maintainer-orchestrator skill is strict that the coordinator should stay
lightweight. It should inspect, delegate, monitor, ask, and report. It should
not become the implementation thread.

That matters because one coordinator can manage many lanes only if each lane is
independent:

- one repo worker per repo lane;
- one current task per worker;
- workers do not create subworkers;
- only the root coordinator creates, names, reuses, steers, or retires workers.

### Five-Minute Wakeups

The five-minute timer is a heartbeat, not a metronome for nagging.

On wakeup the coordinator should:

- read latest owner instructions;
- read worker state before touching it;
- refresh queue, CI, PR, release, and local dirty-state signals;
- do nothing when a worker is coherent and making progress;
- intervene only on blocker, completion, repeated failure, safety issue, or
  wrong assignment.

The strongest feature is restraint. Silence is the right action for active work.

### Proof As Currency

The skills make proof the unit of trust:

- tests and commands;
- CI state;
- live proof for real affected boundaries;
- screenshots or browser assertions for UI work;
- model identifier audits where public artifacts may reveal internal model IDs;
- explicit known gaps.

The orchestrator should not merge confidence. It should merge evidence.

### Granular Authorization

Peter's skill separates permissions that are usually blurred:

- triage;
- monitoring;
- local implementation;
- push / PR update;
- CI rerun;
- CI fix;
- merge / close;
- release / tag / publish.

This is the unlock for safe autonomy. The same worker can be trusted to prepare
a PR but not land it. A push permission does not imply CI-fix permission. A
merge permission does not imply release permission.

### Idle Closeout

Completed workers are not trophies. The orchestrator should inspect current
queue state and either:

- assign the next autonomous item;
- prepare remaining decision items;
- run an authorized release gate;
- audit dependency freshness;
- mark the lane idle with a reason.

Idle means "no useful next action exists", not "poll forever."

## What Theo Adds

Theo's transcript adds the human-practice lesson:

- Stop prompting one step at a time.
- Watch what you do after an agent finishes.
- Move those repeated human steps into the loop.
- Let the loop create implementation, review, fix, re-review, merge, and next
  task subloops.

The concrete loop he describes:

1. Create a PR in one thread.
2. Create a review thread when the PR exists.
3. Feed review findings back to the implementation thread.
4. Re-review after fixes.
5. Merge when approvals and gates pass.
6. Trigger the next stacked PR.

The warning is equally important: loops multiply spend and multiply wrong-path
work. They need budgets, stop conditions, and blast-radius controls.

## What To Copy

- Coordinator as control plane.
- URL-first triage cards.
- Decision-ready owner asks.
- Granular permissions.
- Five-minute monitor with restraint.
- Autoreview and live proof before land.
- Persistent ledger of meaningful state.
- Idle-lane closeout.

## What Not To Copy Blindly

- A clean-main local gate for every repo. boring-ui's local rule is branch or
  worktree, never direct `main` unless explicitly authorized.
- Release authority as default.
- Broad auto-merge.
- Organization-specific exclusions or credential paths.
- Infinite loops without budget, max attempts, and stop reasons.

## Boring-Ui Translation

For boring-ui, Steinberger's loop should become:

- a visible queue board;
- an issue/PR classifier;
- a worker-thread launcher;
- an autoreview loop;
- a proof collector;
- a permissioned auto-merge gate;
- an owner decision inbox.

The product should make the state legible before it makes the autonomy stronger.
