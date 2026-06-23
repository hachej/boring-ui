# Agent Workflow

Canonical coding workflow for agents working in boring-ui v2.

This file is the single source of truth for how coding work moves from task
selection to implementation, review, proof, commit, and GitHub labeling. Keep
`AGENTS.md` and `CLAUDE.md` as routing files; do not duplicate coding workflow
steps there.

## Sources Of Truth

| Concern | Source |
| --- | --- |
| Hard rules and routing | [`AGENTS.md`](../../AGENTS.md) |
| Coding workflow | this file |
| Engineering invariants | [`docs/kanzen/CODING_PRACTICES.md`](CODING_PRACTICES.md) |
| Branch/worktree mechanics | [`docs/kanzen/procedures/branch-worktree.md`](procedures/branch-worktree.md) |
| Proof comments | [`docs/kanzen/procedures/proof-of-work.md`](procedures/proof-of-work.md) |
| Owner review handoff | [`docs/kanzen/procedures/owner-review-card.md`](procedures/owner-review-card.md) |
| Kanzen maintainer loop | [`docs/kanzen/boring-loop.md`](boring-loop.md) |

Kanzen routes GitHub work into this workflow; it does not replace it.

## Tools

| Tool | Purpose | Key commands |
| --- | --- | --- |
| GitHub issues/PRs | Work source of truth | read latest issue/PR state, labels, reviews, CI, and owner comments |
| `git` | Atomic commits | `git status`, `git diff --staged`, `git add`, `git commit` |
| `cc -p` | Claude review for Codex agents | non-interactive print mode |
| `cod exec` | Codex review for Claude agents | non-interactive exec mode |
| `vault kv get/list` | Read-only secrets for agent/shared paths | never commit or log secrets |

Workflow guardrails:

- Root hard rules live in [`AGENTS.md`](../../AGENTS.md) and always apply.
- Use GitHub issues, PRs, labels, and comments for tracked repo work.
- Never commit or log secrets.
- Use MCP tools natively; do not wrap them with ad hoc HTTP clients.

## Session startup

1. Read `AGENTS.md`, then this file before coding.
2. Skim relevant package docs (`packages/<pkg>/docs/README.md`).
3. Identify the active task from the user request, GitHub issue/PR, or Kanzen
   triage state.
4. Check branch, dirty state, latest owner comments, reviews, CI, and labels
   before touching files.

## Task Loop

1. Note the goal, acceptance criteria, paths, constraints, and proof required.
2. Keep GitHub labels/current state accurate before routing or implementing.
3. Implement code and tests together.
4. Verify locally with relevant quality gates.
5. Cross-review non-trivial work before marking the PR ready.
6. Commit atomically.
7. Update the issue/PR with proof, remaining gaps, and the next state.

## Cross-review

Mandatory before close:

- Claude Code agent asks Codex: `cod exec "..."`
- Codex agent asks Claude: `cc -p "..."`

Verdicts:

- `ship` → commit + close.
- `revise` → fix, re-verify, re-request (cap 3 rounds).
- `reject` → mark blocked and ask the owner for a decision.

Never self-review for closure.

## Commit style

```text
<type>(<scope>): <subject>

<body optional, wrap at 72>

Co-Authored-By: <agent-name> <noreply@anthropic.com>
```

Types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `polish`.

Common scopes: `plan`, `agent`, `workspace`, `core`, `cli`, `plugin`.

Reference GitHub issue/PR IDs in the subject or body when useful. Keep commits
atomic by task.

## Session end

1. File GitHub issues for unfinished discoveries that should not be lost.
2. Run relevant quality gates.
3. Update GitHub labels, issue/PR comments, and proof notes.
4. Commit and push atomically if needed.
5. Leave a handoff comment when work is blocked or needs owner review.

## Credentials

```bash
export ANTHROPIC_API_KEY=$(vault kv get -field=api_key secret/agent/anthropic)
export GITHUB_TOKEN=$(vault kv get -field=token secret/agent/boringdata-agent)

vault kv list secret/agent/
vault kv list secret/agent/app/
```

The agent token is read-only for `secret/agent/*` and `secret/shared/*`.

## GitHub Labels

Default repo issues should have exactly one `status:` label plus relevant
package/plugin labels.

Default status flow:

```text
status:to-plan → status:to-plan-review → status:to-code → status:to-code-review → closed
```

Kanzen-managed issues are the exception. When an issue is created or routed by
`/feedback` or `boring-triage`, use the Kanzen label set instead of `status:*`:

```text
one state:* + one phase:* + one track:*
```

Do not mix `status:*` and Kanzen state labels on the same issue. See
[`docs/kanzen/boring-loop.md`](boring-loop.md) for the Kanzen gates and
label values.

Package labels: `package:core`, `package:agent`, `package:workspace`, `package:ui`, `package:cli`, `package:pi`.

Plugin labels: `plugin:ask-user`, `plugin:data-catalog`, `plugin:data-explorer`, `plugin:deck`.

## GitHub proof of work

For issue/PR implementations, follow [`docs/kanzen/procedures/proof-of-work.md`](procedures/proof-of-work.md).

A PR is not ready for human review until the final proof comment includes tests, manual validation, artifacts/screenshots where relevant, workspace-playground details for UI/workspace behavior, and known gaps. Never post host/IP addresses in the public repo.

When owner review is needed, follow
[`docs/kanzen/procedures/owner-review-card.md`](procedures/owner-review-card.md) after
posting the proof comment.
