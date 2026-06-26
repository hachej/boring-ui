# AGENTS.md

Read this first. Re-read after compaction.

This file is intentionally lean: it contains only hard rules and routing pointers.
Detailed coding practices, workflow, architecture, and package docs live under `docs/`.

## Hard rules

1. **Human override:** if the user tells you to do something, listen. The user is in charge.
2. **No file deletion without explicit written permission.**
3. **No destructive git/filesystem ops without explicit instruction:** no `rm -rf`, `git reset --hard`, `git clean -fd`, `git push --force`.
4. **No secrets in git/logs.** Never paste tokens into commits, comments, or logs.
5. **Never work directly on `main`** unless explicitly authorized. Use a branch/worktree.
6. **Do not overwrite other agents' work.** Investigate unexpected changes before editing.
7. **Run relevant quality gates** before calling work done.
8. **Default communication mode:** caveman skill, full intensity, unless user says `stop caveman` or `normal mode`.

## Start here

| Need | Read |
| --- | --- |
| Project/package map | [`docs/README.md`](docs/README.md) |
| Coding rules | [`docs/kanzen/procedures/coding-rules.md`](docs/kanzen/procedures/coding-rules.md) |
| Coding invariants | [`docs/kanzen/procedures/coding-invariants.md`](docs/kanzen/procedures/coding-invariants.md) |
| Repo commands | [`docs/kanzen/procedures/repo-commands.md`](docs/kanzen/procedures/repo-commands.md) |
| Kanzen agent loop, review, commit, GitHub labels | [`docs/kanzen/boring-loop.md`](docs/kanzen/boring-loop.md) |
| Architecture decisions | [`docs/DECISIONS.md`](docs/DECISIONS.md) |
| Agent ↔ workspace contract | [`docs/WORKSPACE_CONTRACT.md`](docs/WORKSPACE_CONTRACT.md) |
| Proof-of-work comments | [`docs/procedures/proof-of-work.md`](docs/procedures/proof-of-work.md) |
| Troubleshooting map | [`docs/web/reference/troubleshooting.md`](docs/web/reference/troubleshooting.md) |
| Design FAQ | [`docs/web/reference/design-faq.md`](docs/web/reference/design-faq.md) |

## Package docs

- Core: `packages/core/docs/README.md`
- Agent: `packages/agent/docs/README.md`
- Workspace: `packages/workspace/docs/README.md`
- CLI: `packages/cli/docs/README.md`
- UI kit: `packages/ui/README.md`
- Pi references: `packages/pi/README.md`
- Plugin CLI: `packages/plugin-cli/README.md`

## Plugin docs

- Plugin system spec: `packages/workspace/docs/PLUGIN_SYSTEM.md`
- Plugin layout/code patterns: `packages/workspace/docs/PLUGIN_STRUCTURE.md`
- First-party plugins: `plugins/<name>/README.md`

## Non-negotiable architectural invariants

See [`docs/kanzen/procedures/coding-invariants.md`](docs/kanzen/procedures/coding-invariants.md) for detail. Short version:

1. No `node:*` imports in `src/shared/**`.
2. No `Buffer` in `src/shared/**`; use `Uint8Array`.
3. Routes/tools receive `Workspace`, not raw paths.
4. Path validation belongs to adapters.
5. Workspace + Sandbox swap as one runtime-mode pair.
6. `UiBridge.postCommand` is the single UI dispatch source.
7. Workspace base front/shared code has zero value imports from `@hachej/boring-agent`.
8. Every error has a stable code.
9. Pi file/shell tools flow through pi factories plus Operations adapters.

## When coding

1. State assumptions if the task is ambiguous.
2. Make surgical, minimal changes.
3. Add/update tests for behavior changes.
4. Run relevant checks.
5. For Kanzen issue/PR work, follow [`docs/kanzen/boring-loop.md`](docs/kanzen/boring-loop.md).
