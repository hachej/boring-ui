# AGENTS.md

Read this first; re-read after compaction.

Boring UI is a pnpm monorepo of publishable packages for agent-centric apps:
chat expresses intent, and a workbench lets users inspect and steer results.
Apps compose the packages; this repo does not own a production deployment.

## Code map

| Work | Location and guidance |
| --- | --- |
| Identity, Postgres/Drizzle stores, invites, app composition | `packages/core/` — [Core docs](packages/core/docs/README.md) |
| Agent Host, harness, tools, sessions, chat UI | `packages/agent/` — [Agent docs](packages/agent/docs/README.md) |
| Workbench, panels, plugins, UI command bridge | `packages/workspace/` — [Workspace docs](packages/workspace/docs/README.md) |
| Shared UI primitives | `packages/ui/` — [UI docs](packages/ui/README.md) |
| Local CLI and plugin authoring CLI | `packages/cli/`, `packages/plugin-cli/` — their READMEs |
| First-party capabilities and runnable compositions | `plugins/<name>/`, `apps/<name>/` — their READMEs |

See [docs/README.md](docs/README.md) for the full map, including sandbox,
Pi resources, reference apps, and Factory. Load the relevant package guidance
before editing; contracts live beside their types.

## Hard boundaries

- **The user is in charge.** Keep communication concise and follow explicit
  tone requests. Do not merge, deploy, or release without authorization.
- No file deletion without explicit written permission. No destructive
  git/filesystem operations without explicit instruction (`rm -rf`,
  `git reset --hard`, `git clean -fd`, `git push --force`). No secrets in
  git, commits, comments, or logs.
- Never push directly to remote `main`. Explicit owner/Kanzen trunk
  authorization applies only to local-main work. Keep the canonical checkout
  clean, current, and on `main`;
  code in isolated branch worktrees inside `.worktrees/`. Investigate
  unexpected changes; never overwrite another agent's or the user's work.
- Core owns application identity and Postgres stores. Keep standalone
  agent/workspace usable without Core and inject application stores at
  composition. Shared/browser code must not import Node APIs. Routes and
  tools receive `Workspace`, not root paths; adapters own path validation.
  `UiBridge.postCommand` owns UI dispatch. Follow the complete
  [coding invariants](docs/procedures/coding-invariants.md).
- Session history is host app user data, not sandbox data. Use the host's
  durable `BORING_AGENT_SESSION_ROOT` (typically `/data/pi-sessions`), never
  container home/root. With `BORING_AGENT_WORKSPACE_ROOT=/data/workspaces`,
  keep sessions in the sibling `/data/pi-sessions` unless the user chooses
  another mounted volume.
- Before cross-package architecture, ontology, or durable-primitive changes,
  read the ratified [vision](docs/plans/long-term/ratified/VISION.md),
  [architecture](docs/plans/long-term/ratified/ARCHITECTURE-PLAN.md), and
  [owner rulings](docs/plans/long-term/ratified/RECONCILIATION.md). State
  alignment/conflicts; changing a frozen ruling needs an explicit owner
  decision and a ratified-plan update.
- Make tangible progress: process artifacts must gate a named capability;
  process/ops beads stay within ~5% of open beads. Preserve useful regression
  coverage; remove checks only with evidence they are obsolete, redundant,
  or ineffective. No fake tests, weakened assertions, or false closes (reopen
  false closes with an incident comment). Refusal-only work gets partial
  credit, labeled `refusal-only`, and does not close a feature.

## Complete one outcome

Name the observable user outcome and the failure case before coding. Trace
only the necessary path through UI, backend, persistence, workers, and
external services. Reproduce the bug or establish the current behavior,
make the smallest justified change, and exercise that path again. Report
what passed, failed, or remains unverified; a passing mock is not evidence
that a real service worked.

One owner integrates and completes the change. Delegate bounded independent
work only when it reduces total effort; do not recursively delegate or repeat
reviews without new evidence. Match planning, testing, and review to risk,
distinguish blocking defects from optional improvements, and stop when the
agreed scope is complete. Existing review and approval gates still apply:
[coding rules](docs/procedures/coding-rules.md), [Boring loop](docs/procedures/boring-loop.md),
[Model Card](docs/procedures/MODEL-CARD.md), [worktree coordination](docs/procedures/worktree-agent.md).

## Verification and skills

Use [repo commands](docs/procedures/repo-commands.md) for the pinned toolchain,
setup, affected-package checks, test selection, and local/CI prerequisites.
Start with `pnpm typecheck:changed` and `pnpm test:changed`; include relevant
lint/invariants and boundary-specific proofs. A skipped or unavailable check
must be visible in the handoff. Do not weaken a gate to obtain a green result.

Load a skill's `SKILL.md` only when its purpose matches the current work:
`ask-boring` routes ambiguous workflow requests; `plan` defines unclear
outcomes; `handoff` transfers live work; `present-pr` prepares the owner review
artifact. These live in `.agents/skills/`. For Factory work, read
[.agents/factory/README.md](.agents/factory/README.md): `exec` implements a
Worker bead and `owner-gate` handles Orchestrator approval handoffs.
The runtime `pi-subagents` skill applies when available and delegation is
useful; report unavailable capabilities honestly. Deeper procedures and
specialized guidance live in [docs/procedures/README.md](docs/procedures/README.md).
