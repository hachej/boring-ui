# Coding Practices

Project-wide engineering rules for boring-ui v2. `AGENTS.md` stays short and
points here. This file is not the coding workflow; the canonical workflow lives
in [`AGENT_WORKFLOW.md`](AGENT_WORKFLOW.md).

## Safety

- No destructive git/filesystem ops without explicit instruction (`rm -rf`, `git reset --hard`, `git clean -fd`, `git push --force`). Prefer non-destructive alternatives first.
- No secrets in git. Do not paste tokens into commits or logs.
- No broad rewrite scripts/codemods without approval.
- No file variants (`*_v2.*`, `*_improved.*`) — edit in place.
- Never work directly on `main` unless explicitly authorized. Use a short-lived
  branch or worktree; see
  [`docs/kanzen/procedures/branch-worktree.md`](procedures/branch-worktree.md).
- Run relevant lint/typecheck/tests before considering work done.
- Never stash, revert, or overwrite another agent's uncommitted work. Investigate unexpected changes first.

## Thinking before coding

- State assumptions. If uncertain, ask.
- If multiple interpretations exist, present them.
- Prefer the simplest approach that solves the requested problem.
- Push back when a request would make the code worse.
- Stop and ask when requirements are unclear.

## Simplicity first

- No features beyond what was asked.
- No abstraction for a single use.
- No speculative configurability.
- No error handling for impossible scenarios.
- If the implementation feels overbuilt, shrink it.

## Surgical changes

- Touch only what the task requires.
- Match existing style, even if you would choose another style.
- Do not refactor adjacent code unless the task needs it.
- Remove imports/variables/functions made unused by your changes.
- Mention unrelated dead code; do not delete it unless asked.

## Goal-driven execution

Convert tasks into verifiable goals:

```text
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Examples:

- "Add validation" → write invalid-input tests, then make them pass.
- "Fix the bug" → reproduce it with a test or documented manual step, then fix.
- "Refactor X" → verify tests pass before and after.

## Build principles

- **Composable** — user-facing features should offer default component + primitives + headless hook when appropriate. Do not force a shell.
- **Modular + short** — small interfaces, single-responsibility files, load-bearing seams (`Harness`, `Catalog`, `Workspace`, `Sandbox`, `SessionStore`, `UiBridge`).
- **Maintainable shared code** — platform-agnostic contracts in `src/shared/**`; no `node:*`, no `Buffer` there.
- **Ship fast, accept known risk** — do not pre-engineer mitigations for risks already accepted in specs.
- **Port over re-research** — old boring-ui (`/home/ubuntu/projects/boring-ui/`) has battle-tested validators, bwrap flags, and file routes; port/adapt where possible.

## Critical architectural invariants

1. No `node:*` imports in `src/shared/**`.
2. No `Buffer` in `src/shared/**`; use `Uint8Array`.
3. Routes and tools receive `Workspace`, not root paths.
4. Path validation is the adapter's job.
5. Workspace and Sandbox swap as a paired `RuntimeModeAdapter`.
6. `UiBridge.postCommand` is the single UI dispatch source; chat `data-ui-command` parts are display-only.
7. Workspace base front/shared code has zero value imports from `@hachej/boring-agent`.
8. Every error has a stable code from the canonical enum.
9. Pi-tools migration stays locked: shell/file tools flow through pi factories plus Operations adapters.

## Commands

Run from repo root unless stated otherwise.

```bash
pnpm install
pnpm dev
pnpm build
pnpm typecheck
pnpm lint
pnpm test
pnpm lint:invariants
pnpm ci
```

Scoped examples:

```bash
pnpm --filter @hachej/boring-workspace run test
pnpm --filter @hachej/boring-agent run test
pnpm --filter @hachej/boring-workspace run typecheck
pnpm --filter workspace-playground dev
pnpm --filter agent-playground dev
pnpm --filter full-app dev
```

Apps that consume `@hachej/boring-workspace` from source need workspace built once first:

```bash
pnpm --filter @hachej/boring-workspace build && pnpm --filter workspace-playground test
```

## Package-specific docs

Start at [`docs/README.md`](../README.md), then descend into the relevant package:

- Core: `packages/core/docs/README.md`
- Agent: `packages/agent/docs/README.md`
- Workspace: `packages/workspace/docs/README.md`
- Plugin system: `packages/workspace/docs/PLUGIN_SYSTEM.md`
- Plugin layout/code patterns: `packages/workspace/docs/PLUGIN_STRUCTURE.md`
