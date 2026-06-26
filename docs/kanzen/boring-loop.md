# Boring Loop

Boring Loop is the smallest useful maintainer system:

```text
/feedback -> enriched GitHub issue
/triage   -> route the issue through gates
```

Autonomy is not a mood. It is a label plus passed gates.

## One Screen

Every issue card should be understandable from these columns:

| Column | Meaning | Example |
| --- | --- | --- |
| State | Can work move? | `queued`, `blocked`, `active`, `ready`, `done` |
| Phase | What is next? | `triage`, `grill`, `plan`, `implement`, `review`, `merge` |
| Track | Who merges? | `fast` or `owner` |
| Gate | Why stopped? | `intake`, `clarity`, `risk`, `flag`, `plan`, `implementation`, `proof`, `merge` |
| Flag | How is runtime exposure controlled? | `not-needed`, `flag:<name>` |
| Proof | Is it verified? | tests, CI, proof comment, demo, screenshot, waiver |
| Session comments | Which Pi threads continue it? | id, purpose, scope, reason |
| Next | One action | `/loop-grill`, `/loop-plan`, `/loop-implement` |

The UI should show this as chips plus one sentence, not a wall of text.

## Skills

- [`boring-feedback`](../../.agents/skills/boring-feedback/SKILL.md):
  create the enriched issue.
- [`boring-triage`](../../.agents/skills/boring-triage/SKILL.md):
  classify state, track, and next gate.
- [`boring-orchestration`](../../.agents/skills/boring-orchestration/SKILL.md):
  run `/triage`, workers, review, proof, and merge decisions.
- [`sources/theo_loop.md`](sources/theo_loop.md): source transcript.
- [`sources/steinberger_loop.md`](sources/steinberger_loop.md): source notes.

## Labels

Use labels for routing, not judgment essays.

| Kind | Rule | Values |
| --- | --- | --- |
| `state:*` | exactly one | `queued`, `blocked`, `active`, `ready`, `done` |
| `phase:*` | exactly one | `triage`, `grill`, `plan`, `implement`, `review`, `merge` |
| `track:*` | exactly one | `owner` by default, `fast` only after risk gate |
| source | optional | `source:feedback` |

Do not add labels for `bug`, `ui`, `accessibility`, `package:*`, `plugin:*`,
or `gate:*`. Structured fields carry the details: `area`, `kind`, `gate`,
`risk`, `flag`, `proofRequired`, `proofState`, `reviewState`, `reviewedSha`,
`mergeMode`, `nextAction`, plus session comments.

## Session Continuity

Pi/Codex session ids are continuity handles, not labels and not a fixed schema.
When a session matters, add or update a short issue/PR or Kanzen comment with
the session id, purpose, scope, and replacement reason if it changed.

Before a loop starts, reuse the relevant session if it still belongs to the same
repo, issue/PR, and branch. Create a new session only when the old one is
missing, inaccessible, archived/stale, or wrong scope, then comment the new id
and reason. If planning naturally becomes implementation in the same Pi thread,
say so in the comment instead of inventing another field.

## Gates

Evaluate gates top to bottom and stop at the first failing row.

| Gate | Passes When | If It Fails |
| --- | --- | --- |
| `intake` | issue has context, redaction note, first plan | fix issue body |
| `clarity` | issue is clear enough | `/loop-grill` |
| `risk` | `track:owner` is confirmed or upgraded to `track:fast` | keep owner track |
| `flag` | no flag needed, or safe flag/abstraction path exists | choose flag/abstraction |
| `plan` | inline plan is enough, or plan file passed thermo review | `/loop-plan` |
| `implementation` | PR exists and review loop is clean | `/loop-implement` |
| `proof` | tests, CI, GitHub proof comment, demo, screenshots, or waiver are current | run proof |
| `merge` | fast-track merge or Julien review is allowed | merge or ask owner |

```mermaid
flowchart LR
  Feedback["/feedback"] --> Issue["GitHub issue\nstate:queued phase:triage"]
  Issue --> Triage["/triage"]
  Triage -->|"unclear"| Grill["/loop-grill\nstate:blocked phase:grill"]
  Grill --> Triage
  Triage -->|"needs design"| Plan["/loop-plan\nstate:active phase:plan"]
  Triage -->|"clear small work"| Implement["/loop-implement\nstate:active phase:implement"]
  Plan --> Implement
  Implement --> Review["review + proof\nstate:active phase:review"]
  Review --> Ready["state:ready phase:merge"]
  Ready -->|"track:fast"| AutoMerge["auto-merge to main"]
  Ready -->|"track:owner"| Owner["wait for Julien"]
  AutoMerge --> Done["state:done"]
  Owner --> Done
```

## Fast Track

New work starts `track:owner`. `track:fast` is an upgrade that means "merge
automatically once every gate passes."

Allowed only when all are true:

- author/agent is trusted by repo policy;
- PR is non-draft on a worker-owned branch;
- small low-risk diff with reduced blast radius;
- no auth, billing, permissions, secrets, migrations, public API, release,
  deletion-heavy, or broad refactor work;
- acceptance criteria and proof path are obvious;
- review, thermo check, tests, CI, GitHub proof comment, and demo proof are
  current for the head SHA.

Everything else is `track:owner`: agents may prepare the PR, but Julien reviews
before merge.

## Procedures

- [Trunk, flags, and review budget](procedures/trunk-flags-review-budget.md):
  local-main review bench, feature flags, worktree escalation, and the 1,500
  added production-code line budget.
- [Issue plans](procedures/issue-plans.md): `docs/issues/<issue-number>/`,
  plan shape, issue mapping, and issue-prefixed commits.
- [Visual review](procedures/visual-review.md): `visual-explainer`,
  session-scoped `visual-review` blocker, ask-user fallback, and approval
  states.

## Loop Commands

`/feedback`: create a GitHub issue directly, enriched with safe context, lean
routing labels, a session comment, and a first plan. If the report is unclear,
create the issue as `state:blocked phase:grill`.

`/loop-grill`: use the grill-me skill and ask-user pane. This can run now or
wait asynchronously in the pending session list. Exit when the issue is clear.
Reuse or comment the relevant session id.

`/loop-plan`: produce the smallest useful plan. Use an inline plan for small
work. Use a plan file plus thermo-nuclear review for important, risky, or
multi-PR work. Reuse or comment the relevant planning/review session ids.

`/loop-implement`: implement the plan, open/update the PR, run review/fix
rounds, run thermo-nuclear implementation review when non-trivial, and collect
proof. Reuse or comment the relevant implementation, review, and proof session
ids.

`/triage`: orchestrate the queue. It should perform one next action per issue,
then record the new state/gate.

## Product Shape

- Feedback form creates GitHub issues with context and first plan.
- Triage board shows state, phase, track, gate, PR, proof, session comments,
  and next action.
- Ask-user pane holds blocked grill questions and fallback owner asks per
  session.
- Visual-review surface holds blocked review handoffs per session and opens the
  artifact ready to inspect.
- PR review pane focuses one PR: diff, findings, fixes, reviewed SHA, proof.
- Demo proof pane starts the app when useful and tells Julien exactly what to
  verify.

## Maintenance

- Add a gate row before adding a new phase.
- Add a structured field before adding a label.
- Add a session comment before creating an unlinked follow-up thread.
- Keep each skill under one screen.
- Keep `/feedback` write-only: it creates the issue and stops.
- Keep `/triage` action-light: one issue gets one next action per sweep.
