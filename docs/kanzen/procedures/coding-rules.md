# Coding Rules

Project-wide engineering rules for boring-ui v2.

## Safety

- No destructive git/filesystem ops without explicit instruction (`rm -rf`,
  `git reset --hard`, `git clean -fd`, `git push --force`). Prefer
  non-destructive alternatives first.
- No secrets in git. Do not paste tokens into commits or logs.
- No broad rewrite scripts/codemods without approval.
- No file variants (`*_v2.*`, `*_improved.*`) - edit in place.
- Never work directly on `main` unless explicitly authorized. Use a short-lived
  branch or worktree.
- Run relevant lint/typecheck/tests before considering work done.
- Never stash, revert, or overwrite another agent's uncommitted work.
  Investigate unexpected changes first.

## Thinking Before Coding

- State assumptions. If uncertain, ask.
- If multiple interpretations exist, present them.
- Prefer the simplest approach that solves the requested problem.
- Push back when a request would make the code worse.
- Stop and ask when requirements are unclear.

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

## Goal-Driven Execution

Convert tasks into verifiable goals:

```text
1. [Step] -> verify: [check]
2. [Step] -> verify: [check]
3. [Step] -> verify: [check]
```

Examples:

- "Add validation" -> write invalid-input tests, then make them pass.
- "Fix the bug" -> reproduce it with a test or documented manual step, then fix.
- "Refactor X" -> verify tests pass before and after.

## Commit Issue Prefix

Every commit subject must start with the primary GitHub issue number:

```text
#123 fix(workspace): keep pending review visible
```

If no issue exists, create or choose one before planning or coding. Use one
primary issue number per commit; mention secondary issues in the body.

## Build Principles

- **Composable** - user-facing features should offer default component,
  primitives, and headless hook when appropriate. Do not force a shell.
- **Modular + short** - small interfaces, single-responsibility files,
  load-bearing seams (`Harness`, `Catalog`, `Workspace`, `Sandbox`,
  `SessionStore`, `UiBridge`).
- **Maintainable shared code** - platform-agnostic contracts in `src/shared/**`;
  no `node:*`, no `Buffer` there.
- **Ship fast, accept known risk** - do not pre-engineer mitigations for risks
  already accepted in specs.
- **Port over re-research** - old boring-ui (`/home/ubuntu/projects/boring-ui/`)
  has battle-tested validators, bwrap flags, and file routes; port/adapt where
  possible.
