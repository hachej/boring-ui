# Agent Workflow

Operational workflow for agents working in boring-ui v2.

## Tools

| Tool | Purpose | Key commands |
| --- | --- | --- |
| `br` | Issue tracking / source of truth | `br ready`, `br show <id>`, `br update <id> -s <status>`, `br close <id>`, `br sync --flush-only` |
| `bv` | Triage sidecar | Use only `bv --robot-*`; never launch bare `bv` |
| `git` | Atomic commits per bead | `git status`, `git diff --staged`, `git add`, `git commit` |
| `cc -p` | Claude review for Codex agents | non-interactive print mode |
| `cod exec` | Codex review for Claude agents | non-interactive exec mode |
| MCP Agent Mail | Peer coordination, claims, reservations | register, fetch inbox, send `[CLAIM]` / `[DONE]` |
| `vault kv get/list` | Read-only secrets for agent/shared paths | never commit or log secrets |

Hard rules:

- Never launch bare `bv`.
- Never edit `.beads/*.jsonl` by hand.
- Never commit secrets.
- Use MCP tools natively; do not wrap them with ad hoc HTTP clients.

## Session startup

1. Read `AGENTS.md`, then this file if you are doing bead work.
2. Register with Agent Mail and fetch inbox.
3. Skim relevant package docs (`packages/<pkg>/docs/README.md`).
4. Pick work with `bv --robot-next` or `br ready`.
5. Check for collisions: inbox `[CLAIM]` messages and file reservations.

## Per-bead loop

1. `br show <id>` — note goal, acceptance, paths, deps, reference files.
2. Claim: `br update <id> -s in_progress`, broadcast `[CLAIM]`, reserve files.
3. Implement code + tests together.
4. Verify locally with relevant quality gates.
5. Cross-review with the opposite model.
6. Commit atomically.
7. Close bead, announce `[DONE]`, release reservations.

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

Common scopes: `plan`, `beads`, `agent`, `workspace`, `core`, `cli`, `plugin`.

Use the primary GitHub issue number as the subject prefix. If no issue exists,
create or choose one before committing. Mention secondary issues or legacy bead
IDs in the body. Keep commits atomic per issue/slice. If bead state changed, run
`br sync --flush-only` and include `.beads/issues.jsonl`.

## Session end

1. File beads for unfinished discoveries.
2. Run relevant quality gates.
3. Update bead status.
4. `br sync --flush-only`.
5. Commit atomically if needed.
6. Send Agent Mail `[STATUS]` handoff.
7. Release file reservations.

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

Session ids are structured metadata, not labels. Store them in the issue/PR
body, Kanzen card, review hook, or proof comment:

```text
feedbackSession:
grillSession:
planSession:
planReviewSession:
implementSession:
codeReviewSession:
proofSession:
visualReviewSession:
ownerAskSession:
```

Before starting plan, review, implementation, proof, or owner ask work, reuse
the matching session when it still belongs to the same repo, issue/PR, and
branch. Create a new session only when the prior one is missing, inaccessible,
archived/stale, or wrong scope; record the replacement and reason. If planning
naturally becomes implementation in the same Pi thread, carry the id forward,
for example `implementSession: <same id as planSession>`.

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

For issue/PR implementations, follow [`docs/procedures/proof-of-work.md`](procedures/proof-of-work.md).

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
link in the question context, record `ownerAskSession`, then copy the answer
into `visualReviewStatus` for the current artifact.
