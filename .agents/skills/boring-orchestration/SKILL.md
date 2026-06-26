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

Pi/Codex session ids are structured comments, never labels and never a fixed
schema. When a session matters, comment the session id, purpose, scope, and
replacement reason in the issue/PR or Kanzen card.

Before starting a gate action, reuse a relevant session when it still belongs to
the same repo, item, and branch. Create a new session only when missing,
inaccessible, archived/stale, or wrong scope; comment the replacement and
reason. When a loop graduates in the same Pi thread, say so in the comment.

## Worker Rule

One lane means one Codex/Kanzen thread/run, one branch/worktree, one GitHub
item. Stop for missing owner input, missing access, destructive actions,
release/publish work, or merge without policy permission.

The parent lane owns the implementation context. Bounded subagents or review
sessions are allowed, but they return findings to the parent lane and get
recorded in the session comment.

## Trunk Rule

Golden rule: keep `boring-ui-v2` on local `main` as the live review bench, with
`full-app`, `workspace-playground`, and `agent-playground` Docker review
surfaces running/reloadable.

Plan-only work may edit local `main` directly. Store plans at
`docs/issues/<issue-number>/plan.md` or
`docs/issues/<issue-number>/plan-<short-slice>.md`. Every plan must belong to a
GitHub issue; keep state in frontmatter instead of moving files between state
folders.

## Commit Prefix

Every commit subject starts with the primary issue number, for example
`#123 fix(workspace): keep pending review visible`. If no issue exists, create or
choose one before planning, coding, or committing. Mention secondary issues in
the commit body.

Code defaults to local trunk plus feature flag, then a tiny PR. If the work
cannot be flagged, prefer branch-by-abstraction or keystone interface last. Use
a short-lived worktree/branch only for risky, transversal, parallel, or
not-trunk-safe work. Plans and PR cards must record `flag: not-needed`,
`flag: <name>`, or `flag: not-flaggable + reason`.

## Review Budget

Plans and PRs should decompose work into reviewable slices of about 1,500 added
production-code lines max. Exclude tests, docs, generated output, and snapshots
from the count. If a slice is larger, split or stack it before coding; otherwise
record the explicit owner-approved exception in the plan and PR.

## Review Rule

For non-trivial work, run review/fix/re-review plus thermo-nuclear
implementation review. Proof and review must match the current head SHA.

## Visual Handoff

For non-trivial owner review, use `visual-explainer` when available and already
installed from an owner-approved commit SHA. Generate a visual plan/diff/proof
artifact, then create a session-scoped `visual-review` pending item modeled on
`ask-user`: pending state, session badge/blocker, and best-effort artifact
`openSurface`.

Record `visualReviewId`, artifact path/URL, `visualReviewStatus`, and
missing-tool reason if a Markdown/HTML fallback was used. Do not install or
approve a new external tool during the loop unless Julien approved the exact
commit. The pending review item is the merge source of truth; owner comments
must be copied into it before merge. If the
`visual-review` surface is unavailable, use `ask-user` with the artifact link as
a compatibility fallback, comment the fallback ask-user session id, then copy
the answer into `visualReviewStatus` for the current artifact.

## Merge Rule

Auto-merge only when:

- labels include `state:ready phase:merge track:fast`;
- author/agent is trusted by repo policy;
- PR is non-draft on a worker-owned branch;
- CI, tests, review, thermo check, and proof are current;
- no visual handoff is required, or Julien recorded `visualReviewStatus: approve`
  for the current artifact;
- no restricted area is touched;
- proof comment is posted.

Otherwise set `track:owner`. If visual handoff is required, prepare the
visual-review item for Julien; otherwise prepare the appropriate owner/PR review
brief.
