# AGENTS.md

Read this first. Re-read after compaction.

This file is intentionally lean: it contains only hard rules and routing pointers.
Detailed coding practices, workflow, architecture, and package docs live under `docs/`.

## Hard rules

1. **Human override:** if the user tells you to do something, listen. The user is in charge.
2. **No file deletion without explicit written permission.**
3. **No destructive git/filesystem ops without explicit instruction:** no `rm -rf`, `git reset --hard`, `git clean -fd`, `git push --force`.
4. **No secrets in git/logs.** Never paste tokens into commits, comments, or logs.
5. **Never push directly to remote `main`.** Use a branch/worktree unless the
   owner or Kanzen trunk procedure explicitly authorizes local-main work; keep
   local `main` green.
6. **Keep the canonical project checkout on `main`.** The primary
   `boring-ui-v2` checkout is the coordination anchor and should track
   `origin/main`, not an agent feature branch. Agents must do coding in
   isolated branch worktrees (which must always be created inside the `.worktrees/`
   directory) and leave the anchor clean/current for handoffs.
7. **Do not overwrite other agents' work.** Investigate unexpected changes before editing.
8. **Tangible progress, anti-ceremony, and honest credit.**
   - No process porn: a process artifact exists only when it hard-gates a
     named feature or capability.
   - Feature-first ratio: process/ops beads capped at ~5% of open beads; each
     must name the feature work it gates.
   - Honesty is absolute: no fake tests, no weakened assertions, no false
     closes. A false close is reopened with an incident comment.
   - Refusal-only implementations earn partial credit, labeled
     (`refusal-only`), and never close a feature work item.
9. **Session history is host app user data:** Pi chat transcripts/session lists
   are owned by the deployed core app host, not by the sandbox/workspace
   runtime. Store them on the host app's durable volume via
   `BORING_AGENT_SESSION_ROOT` (typically `/data/pi-sessions`), not in
   container home/root. If host-side `BORING_AGENT_WORKSPACE_ROOT=/data/workspaces`,
   keep the host session root as sibling `/data/pi-sessions` unless the user
   explicitly chooses another mounted volume.
10. **Default communication style:** concise, direct, high-signal. Honor user
   requests for `stop caveman`, `normal mode`, or any other explicit tone
   change.
11. **Reconcile architecture proposals with the ratified long-term plan:** before
   proposing cross-package architecture, ontology changes, or new durable
   primitives, read the ratified long-term vision, architecture plan, and owner
   rulings linked below. State how the proposal aligns and name every conflict.
   Never silently supersede a frozen ruling; a conflict requires an explicit
   owner decision and an update to the ratified plan.

## Start here

| Need | Read |
| --- | --- |
| Project/package map | [`docs/README.md`](docs/README.md) |
| Coding rules | [`docs/procedures/coding-rules.md`](docs/procedures/coding-rules.md) |
| Coding invariants | [`docs/procedures/coding-invariants.md`](docs/procedures/coding-invariants.md) |
| Repo commands | [`docs/procedures/repo-commands.md`](docs/procedures/repo-commands.md) |
| Kanzen agent loop, review, commit, GitHub labels | [`docs/procedures/boring-loop.md`](docs/procedures/boring-loop.md) |
| Model Card & delegation model | [`docs/procedures/MODEL-CARD.md`](docs/procedures/MODEL-CARD.md) |
| Worktree agent coordination | [`docs/procedures/worktree-agent.md`](docs/procedures/worktree-agent.md) |
| Architecture decisions | [`docs/DECISIONS.md`](docs/DECISIONS.md) |
| Architecture proposals and durable primitives | [`VISION.md`](docs/plans/long-term/ratified/VISION.md), [`ARCHITECTURE-PLAN.md`](docs/plans/long-term/ratified/ARCHITECTURE-PLAN.md), and [`RECONCILIATION.md`](docs/plans/long-term/ratified/RECONCILIATION.md) |
| Agent ↔ workspace contract | [`docs/WORKSPACE_CONTRACT.md`](docs/WORKSPACE_CONTRACT.md) |
| Proof-of-work comments | [`docs/procedures/proof-of-work.md`](docs/procedures/proof-of-work.md) |
| Troubleshooting map | [`docs/web/reference/troubleshooting.md`](docs/web/reference/troubleshooting.md) |
| Design FAQ | [`docs/web/reference/design-faq.md`](docs/web/reference/design-faq.md) |
| Factory stage contract (seats, gates, lanes, dynamics) | `.agents/factory/README.md` |
| Full kanzen doc + procedure index | `docs/procedures/README.md` |

## The Delegation Model

When executing, planning, or reviewing complex tasks, utilize the **Delegation Model** detailed in the [Model Card](docs/procedures/MODEL-CARD.md). This establishes a clear hierarchy:
- Align intelligence, taste, and cost bounds with task complexity.
- Delegate to specialized background subagents using the `pi-subagents` skill (runtime plugin skill — provided by the plugin system, not `.agents/skills/`) for parallel pipelines, independent audits, or thermonuclear codebase reviews.
- Close the loop by converting output questions and approvals into **Inbox Human Intention** items, keeping the workspace as the unified control plane.

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

See [`docs/procedures/coding-invariants.md`](docs/procedures/coding-invariants.md).

## When coding

1. State assumptions if the task is ambiguous.
2. Make surgical, minimal changes.
3. Add/update tests for behavior changes.
4. Run relevant checks.
5. For Kanzen issue/PR work, follow [`docs/procedures/boring-loop.md`](docs/procedures/boring-loop.md).
