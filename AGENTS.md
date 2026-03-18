# AGENTS.md

Read this first. Re-read after compaction.

## Safety (non-negotiable)

- No destructive ops without explicit instruction (no `rm -rf`, `reset --hard`, `clean -fd`, force-push).
- No secrets in git. Do not paste tokens into commits or logs.
- No broad rewrite scripts (codemods, "fix everything") without approval.
- No file variants (`*_v2.*`) — edit in place.
- Never delete files unless you have explicit written permission.

## Shared Conventions

These docs define the boring-coding workflow. Read local copy if available; fall back to GitHub.

| Doc | Local | GitHub |
| --- | --- | --- |
| Workflow | `/home/ubuntu/projects/boring-coding/docs/workflow/` | [workflow/](https://github.com/boringdata/boring-coding/blob/main/docs/workflow/) |

## Where to Find What

| Topic | Doc |
| --- | --- |
| Project context | `docs/PROJECT_CONTEXT.md` |
| Architecture map | `docs/ARCHITECTURE.md` |
| Core beliefs | `docs/design-docs/core-beliefs.md` |
| Hard constraints | `docs/design-docs/boundaries.md` |
| Design decisions (ADRs) | `docs/design-docs/decisions/` |
| Domain deep-dives | `docs/domains/` |
| Beads reference | `docs/workflow-symlinked/beads.md` |
| Evidence conventions | `docs/workflow-symlinked/EVIDENCE.md` |
| Session lifecycle | `docs/workflow-symlinked/OPERATIONS.md` |
| Agent tools | `docs/workflow-symlinked/tools/` |
| Role prompts | `/home/ubuntu/projects/boring-coding/prompts/` |
| Execution plans | `docs/exec-plans/` |
| Product specs | `docs/product-specs/` |
| References | `docs/references/` |
| Quality grades | `docs/QUALITY.md` |
| Runbooks | `docs/runbooks/` |
| Gates | `scripts/gates/` |

## Session Startup

1. Read `AGENTS.md` end-to-end.
2. Read `docs/PROJECT_CONTEXT.md`.
3. Find how to run tests, lint, dev server (see Project Commands below).
4. Pick next bead: `bv --robot-next` or `br list --status=open`.

For full session lifecycle (compaction, blocked, end-of-session): see `docs/workflow-symlinked/OPERATIONS.md`.

## Bead Startup (per bead)

1. `br show <bead-id>` — goal, scope, gates, checklist, latest comments.
2. Find latest `EVIDENCE:` path in bead comments.
3. Inspect `.agent-evidence/beads/<bead-id>/...` for prior work.
4. Confirm STATE + NEXT match your role.

## Project Commands

- Install: `npm install && uv sync`
- Tests: `npm run test:run` (unit), `npm run test:e2e` (e2e), `pytest tests/ -v` (backend)
- Lint: `npm run lint`
- Dev server: `npm run dev`
- Verify: `python3 scripts/bd_3g1g_verify.py`

## Credentials

Fetch from Vault:
- Supabase: `secret/agent/boring-ui-supabase-*`
- Sprites: `secret/agent/sprites`

Never commit secrets. Use env vars or `.env` (gitignored).
