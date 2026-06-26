---
name: boring-orchestration
description: "Use to run /triage for boring-ui: refresh GitHub state, apply triage gates, run grill/plan/implement subloops, collect proof, and merge only fast-track-safe PRs."
---

# Boring Orchestration

Run `/triage`. One issue, one next action. Do not invent extra states.

## Sweep

1. Refresh issues, PRs, comments, labels, CI, reviews, proof, head SHA, and recorded Pi sessions.
2. Read newest Julien/owner instruction first.
3. Run `boring-triage` on queued or stale items.
4. Execute the first unmet gate only.
5. Record labels, gate, proof, reviewed SHA, next action, and any session id used.

## Gate Actions

| Gate | Action |
| --- | --- |
| `clarity` | `/loop-grill`: grill-me plus ask-user; stay `state:blocked phase:grill` |
| `risk` | keep `track:owner`; upgrade to `track:fast` only when all fast-track rules pass |
| `flag` | require `not-needed`, safe feature flag, or abstraction path before code starts |
| `plan` | `/loop-plan`: smallest useful plan; issue-linked plan file for risky or multi-PR work |
| `implementation` | `/loop-implement`: one worker lane for one issue/PR |
| `proof` | tests, CI, screenshots, demo workspace proof when useful |
| `merge` | fast-track merge or owner review |

## Session Continuity

Pi/Codex session ids are structured metadata, never labels. Record them in the
issue/PR Kanzen card, review hook, or body:

`feedbackSession`, `grillSession`, `planSession`, `planReviewSession`,
`implementSession`, `codeReviewSession`, `proofSession`, `visualReviewSession`,
`ownerAskSession`.

Before starting a gate action, reuse the matching session when it still belongs
to the same repo, item, and branch. Create a new session only when missing,
inaccessible, archived/stale, or wrong scope; record the replacement and reason.
When a loop graduates in the same Pi thread, carry the id forward, such as
`implementSession: <same id as planSession>`.

## Worker Rule

One lane means one Codex/Kanzen thread/run, one branch/worktree, one GitHub
item. Stop for missing owner input, missing access, destructive actions,
release/publish work, or merge without policy permission.

The parent lane owns `implementSession`. Bounded subagents or review sessions
are allowed, but they return findings to the parent lane and get recorded in the
session ledger.

## Trunk Rule

Golden rule: keep `boring-ui-v2` on local `main` as the live review bench, with
`full-app`, `workspace-playground`, and `agent-playground` Docker review
surfaces running/reloadable.

Plan-only work may edit local `main` directly. Store plans at
`docs/kanzen/plans/<state>/gh-<number>-<slug>.md`.

Code defaults to local trunk plus feature flag, then a tiny PR. If the work
cannot be flagged, prefer branch-by-abstraction or keystone interface last. Use
a short-lived worktree/branch only for risky, transversal, parallel, or
not-trunk-safe work. Plans and PR cards must record `flag: not-needed`,
`flag: <name>`, or `flag: not-flaggable + reason`.

## Review Rule

For non-trivial work, run review/fix/re-review plus thermo-nuclear
implementation review. Proof and review must match the current head SHA.

## Visual Handoff

For non-trivial owner review, use `visual-explainer` when available and already
installed from an owner-approved commit SHA. Generate a visual plan/diff/proof
artifact, link it in the Kanzen card, and create an ask-user blocker with exact
choices: approve, request changes, defer, reject/remove.

Record `visualReviewSession`, artifact path/URL, `ownerAskSession`, ask status,
and missing-tool reason if a Markdown/HTML fallback was used. Do not install or
approve a new external tool during the loop unless Julien approved the exact
commit. The ask-user record is the merge source of truth; owner comments must be
copied into the card before merge. Do not build a custom review plugin yet; add
a future `kanzen-review` plugin only after artifact links plus ask-user blockers
are not enough.

## Merge Rule

Auto-merge only when:

- labels include `state:ready phase:merge track:fast`;
- author/agent is trusted by repo policy;
- PR is non-draft on a worker-owned branch;
- CI, tests, review, thermo check, and proof are current;
- no visual handoff is required, or Julien recorded `ownerAskStatus: approve`
  in ask-user for the current artifact;
- no restricted area is touched;
- proof comment is posted.

Otherwise set `track:owner` and prepare a short ask-user/PR review brief for
Julien.
