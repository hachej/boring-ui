# Coding Rules

## Safety

- No destructive ops without explicit instruction: `rm -rf`,
  `git reset --hard`, `git clean -fd`, `git push --force`.
- No secrets in git, commits, or logs.
- No broad rewrite scripts/codemods without approval.
- No file variants (`*_v2.*`, `*_improved.*`) - edit in place.
- Never push directly to remote `main`. Use a short-lived branch/worktree unless
  the owner or Kanzen trunk procedure explicitly authorizes local-main work;
  keep local `main` green.
- Run relevant lint/typecheck/tests before considering work done.
- Never stash, revert, or overwrite another agent's uncommitted work.
  Investigate unexpected changes first.

## Thinking

- State assumptions. If uncertainty blocks safe progress, ask; otherwise proceed
  with the smallest reasonable interpretation.
- If multiple risky interpretations exist, present them.
- Prefer the simplest approach that solves the requested problem.
- Push back when a request would make the code worse.
- Stop and ask only when requirements are unclear enough to make execution
  unsafe or wasteful.

## Simplicity First

- No features beyond what was asked.
- No abstraction for a single use.
- No speculative configurability.
- No error handling for impossible scenarios.
- If the implementation feels overbuilt, shrink it.

## Surgical Changes

- Touch only what the task requires.
- Match existing style, even if you would choose another style.
- Do not refactor adjacent code unless the task needs it.
- Remove imports/variables/functions made unused by your changes.
- Mention unrelated dead code; do not delete it unless asked.
- Keep review slices small: plans and PRs should target about 1,500 added
  production-code lines max, excluding tests, docs, generated output, and
  snapshots. If the work is larger, decompose it into slices or stacked PRs
  before coding, or record an explicit owner-approved exception.

## Verifiable Goals

```text
1. [Step] -> verify: [check]
2. [Step] -> verify: [check]
3. [Step] -> verify: [check]
```

- "Add validation" -> write invalid-input tests, then make them pass.
- "Fix the bug" -> reproduce it with a test or documented manual step, then fix.
- "Refactor X" -> verify tests pass before and after.

## Commit Issue Prefix

```text
#123 fix(workspace): keep pending review visible
```

- Subject starts with primary GitHub issue number.
- No issue: create or choose one before planning/coding.
- One primary issue per commit; secondary issues in body.

## Build Principles

- **Composable** - default component, primitives, headless hook when useful.
- **Modular + short** - small interfaces, single-responsibility files.
- **Shared code** - `src/shared/**` has no `node:*`, no `Buffer`.
- **Ship fast** - do not pre-engineer accepted risks.
- **Port first** - adapt proven old boring-ui validators, bwrap flags, routes.
