# Agent Workflow Procedure

Operational workflow for agents working in boring-ui v2.

## Tools

| Tool | Purpose | Key commands |
| --- | --- | --- |
| GitHub | Issue/PR source of truth | `gh issue view`, `gh issue edit`, `gh pr view`, `gh pr edit`, `gh pr merge` |
| Kanzen labels/comments | State, phase, track, gates, session continuity | `state:*`, `phase:*`, `track:*`, proof and decision comments |
| `git` | Atomic commits per issue slice | `git status`, `git diff --staged`, `git add`, `git commit` |
| `cc -p` | Claude review for Codex agents | non-interactive print mode |
| `cod exec` | Codex review for Claude agents | non-interactive exec mode |
| MCP Agent Mail | Peer coordination, claims, reservations | register, fetch inbox, send `[CLAIM]` / `[DONE]` |
| `vault kv get/list` | Read-only secrets for agent/shared paths | never commit or log secrets |

Hard rules:

- Never commit secrets.
- Use MCP tools natively; do not wrap them with ad hoc HTTP clients.

## Session startup

1. Read `AGENTS.md`, then this file for Kanzen issue/PR work.
2. Register with Agent Mail and fetch inbox when coordinating with other agents.
3. Skim relevant package docs (`packages/<pkg>/docs/README.md`).
4. Pick work from owner instruction or GitHub items with Kanzen labels.
5. Read the newest owner comments before touching the issue or PR.
6. Check for collisions: issue/PR session comments, inbox `[CLAIM]` messages,
   and file reservations.

## Per-Issue Loop

1. Read the GitHub issue/PR, linked plan under `docs/issues/<issue-number>/`,
   acceptance criteria, proof requirement, and relevant package docs.
2. Claim with a short issue/PR comment when needed; include session id, scope,
   branch/worktree, and files you expect to touch.
3. Move only the first unmet gate: grill, plan, implement, review, proof, owner
   decision, or merge.
4. Implement code and tests together for implementation work.
5. Verify locally with relevant quality gates and demo proof when UI/workspace
   behavior changes.
6. Cross-review non-trivial changes, fix accepted findings, and re-review until
   clean or blocked.
7. Update the issue/PR with proof, known gaps, next gate, and handoff material.

## Cross-review

Mandatory before close:

- Claude Code agent asks Codex: `cod exec "..."`
- Codex agent asks Claude: `cc -p "..."`

Verdicts:

- `ship` → commit + close.
- `revise` → fix, re-verify, re-request (cap 3 rounds).
- `reject` → mark blocked and escalate via Agent Mail.

Never self-review for closure.

## Commit style

```text
#<issue-number> <type>(<scope>): <subject>

<body optional, wrap at 72>

Co-Authored-By: <agent-name> <noreply@anthropic.com>
```

Types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `polish`.

Common scopes: `plan`, `agent`, `workspace`, `core`, `cli`, `plugin`.

Use the primary GitHub issue number as the subject prefix. If no issue exists,
create or choose one before planning, coding, or committing. Mention secondary
issues in the body. Keep commits atomic per issue/slice.

## Session end

1. File or update GitHub issues for unfinished discoveries.
2. Run relevant quality gates.
3. Update Kanzen labels/comments with the next state, phase, track, gate, and
   owner decision needed.
4. Commit atomically if needed.
5. Send Agent Mail `[STATUS]` handoff when coordinating with other agents.
6. Release file reservations.

## Credentials

```bash
export ANTHROPIC_API_KEY=$(vault kv get -field=api_key secret/agent/anthropic)
export GITHUB_TOKEN=$(vault kv get -field=token secret/agent/boringdata-agent)

vault kv list secret/agent/
vault kv list secret/agent/app/
```

The agent token is read-only for `secret/agent/*` and `secret/shared/*`.

## GitHub labels

Kanzen labels are routing state only. Every issue or PR should have exactly one
`state:*`, one `phase:*`, and one `track:*` label.

Allowed values:

```text
state:queued | state:blocked | state:active | state:ready | state:done
phase:triage | phase:grill | phase:plan | phase:implement | phase:review | phase:merge
track:owner | track:fast
```

Optional source label: `source:feedback`.

Do not add `bug`, `ui`, `accessibility`, `package:*`, `plugin:*`, or `gate:*`
labels for Kanzen flow. Put area, kind, gate, proof, and next action in the
issue/PR body or Kanzen comment.

## Pi session continuity

Session ids are structured comments, not labels and not a fixed schema. When a
session matters, add or update an issue/PR or Kanzen comment with the session
id, purpose, scope, and replacement reason if it changed.

Before starting plan, review, implementation, proof, or owner ask work, reuse a
relevant session when it still belongs to the same repo, issue/PR, and branch.
Create a new session only when the prior one is missing, inaccessible,
archived/stale, or wrong scope; comment the replacement and reason. If planning
naturally becomes implementation in the same Pi thread, say so in the comment.

## Trunk, flags, and plans

Golden rule: keep the `boring-ui-v2` checkout on local `main` as the live review
bench, with the three Docker review surfaces running/reloadable:
`full-app`, `workspace-playground`, and `agent-playground`.

Plan-only work may happen on local `main`; it does not need a branch or
worktree. Every plan belongs to a GitHub issue. Store issue-linked plans under
`docs/issues/<issue-number>/`, using `plan.md` for the main plan and
`plan-<short-slice>.md` for additional slices or stacked PR layers. Keep Kanzen
state in frontmatter; do not move plan files between state folders.

For code, prefer local trunk plus a safe feature flag and publish as a tiny PR.
If the change cannot be feature-flagged, use branch-by-abstraction, keystone
interface last, shadow mode, or expand/contract migration. Use a short-lived
worktree/branch only when the work is still risky, transversal, parallel, or
cannot keep trunk green.

Review budget: plan slices and PRs should stay around 1,500 added production
code lines max. Do not count tests, docs, generated output, or snapshots. If the
work is larger, split it into smaller PRs or a stack before coding; otherwise
record the explicit owner-approved exception in the plan and PR.

## GitHub proof of work

For issue/PR implementations, follow
[`docs/procedures/proof-of-work.md`](../../procedures/proof-of-work.md).

A PR is not ready for human review until the final proof comment includes tests, manual validation, artifacts/screenshots where relevant, workspace-playground details for UI/workspace behavior, and known gaps. Never post host/IP addresses in the public repo.

## Visual owner handoff

When owner review is needed and the plan, diff, stack, or proof is non-trivial,
prepare visual review material with `visual-explainer` when the Pi tool is
available:

```bash
pi install -l git:github.com/nicobailon/visual-explainer#<reviewed-commit-sha>
```

Install only from an owner-approved commit SHA. Use `--approve` only when
Julien has approved that exact commit; otherwise use the fallback below.

Then create a session-scoped `visual-review` pending item, using the same
pattern as `ask-user`: pending store, UI-state hint, `WorkspaceAttentionBlocker`
session badge, and best-effort `openSurface` for the artifact. The surface must
show the issue/PR, visual artifact, demo surface, flag state, proof, risk, and
exact choices: approve, request changes, defer, reject/remove.

The pending review record is the merge source of truth. If Julien approves in a
comment, copy that decision into `visualReviewStatus` before merging.

If `visual_explainer` is not available, write the same review card as Markdown
or HTML and record the missing-tool reason. If the `visual-review` surface is
not available yet, use `ask-user` as a compatibility fallback with the artifact
link in the question context, comment the fallback ask-user session id, then copy
the answer into `visualReviewStatus` for the current artifact.
