# AGENTS.md

Read this first. Re-read after compaction.

## Rules

**Rule 0 — Human Override:** If I tell you to do something, even if it contradicts what follows, you must listen. I am in charge.

**Rule 1 — No File Deletion:** Never delete a file without explicit written permission.

## Safety (non-negotiable)

- No destructive git/filesystem ops without explicit instruction (`rm -rf`, `git reset --hard`, `git clean -fd`, `git push --force`). Prefer non-destructive alternatives first.
- No secrets in git. Do not paste tokens into commits or logs.
- No broad rewrite scripts (codemods, "fix everything") without approval.
- No file variants (`*_v2.*`, `*_improved.*`) — edit in place.
- Branch policy: work on `main`. Never create feature branches unless instructed.
- Compiler checks after changes: run relevant quality gates (lint, type-check, tests) before considering work done.
- Multi-agent awareness: never stash, revert, or overwrite another agent's uncommitted work. If you encounter unexpected changes, investigate before acting.

## What This Is

boring-ui is a **composable, capability-gated web IDE framework**. Panel-based UI shell (React + DockView) backed by modular FastAPI routers. Panels declare backend requirements; the system degrades gracefully when features are absent. Ships as both a standalone app and a reusable base for child apps.

### Stack

- **Frontend**: React 18, Vite 5, TailwindCSS 4, DockView (panels), Zustand (state), xterm.js (terminal), TipTap (editor)
- **Backend**: Python 3, FastAPI, uvicorn, ptyprocess, websockets
- **Control Plane**: PostgreSQL (asyncpg), Neon Auth (Better Auth, EdDSA JWT)
- **CLI**: `bui` (Go) — dev orchestration, framework pinning, child app management
- **Tests**: Vitest (unit), Playwright (e2e), pytest (backend)

### Agent Modes — Three Deployment Variants

The three modes differ in **where the agent runs** and **what's included**.

| Mode | Fly app | Agent | Filesystem | Key traits |
|------|---------|-------|------------|------------|
| **agent-lite** | `boring-ui-lite` | PI (browser) | Server FS via HTTP API | Minimal footprint, bubblewrap sandbox for exec, no Node.js runtime |
| **agent-frontend** | `boring-ui-frontend-agent` | PI (browser) | Server FS via HTTP API | Full backend (FastAPI + Vite static), no server-side agent |
| **agent-backend** | `boring-ui-backend-agent` | Companion (server) | Server FS via HTTP API | Full stack + Node.js pi_service sidecar, server-side agent execution |

All three use `data.backend = "http"` (real filesystem) and Neon Auth. Deploy configs and smoke tests: see `deploy/README.md`.

**Local dev** uses `data.backend = "lightningfs"` (browser IndexedDB) by default. Set `LOCAL_PARITY_MODE=http` to exercise the deployed code path locally.

### Child Apps

boring-ui is a framework. Child apps are separate repos listed in `children.toml`:
- `boring-macro`, `boring-de-nl`, `boring-docs`, `boring-doctor`

Each child has its own `boring.app.toml` pinning a boring-ui commit. `bui` resolves the framework, overlays child config, runs dev/build/deploy. No submodules. Child apps add custom panels, routers, chat providers without forking.

### Control Plane Provider (`CONTROL_PLANE_PROVIDER`)

| Provider | Auth | Database | When |
|----------|------|----------|------|
| `local` | Dev login bypass | File-based JSON | Local dev |
| `neon` | Neon Auth (EdDSA JWT) | PostgreSQL via Neon | **Production** |
| `supabase` | Supabase GoTrue | Supabase PostgreSQL | Legacy |

Auto-detects: `NEON_AUTH_BASE_URL` set → upgrades to `neon`. Deep dive: `docs/runbooks/NEON_SETUP.md`.

## Shared Conventions

These docs define the boring-coding workflow. Read local copy if available; fall back to GitHub.

| Doc | Local | GitHub |
| --- | --- | --- |
| Workflow | `/home/ubuntu/projects/boring-coding/docs/workflow/` | [workflow/](https://github.com/boringdata/boring-coding/blob/main/docs/workflow/) |

## Repo Layout

```
src/front/              React frontend (App.jsx, components, panels, hooks, providers, registry)
src/back/boring_ui/api/ FastAPI backend (app.py factory, config.py, modules/)
  modules/files/        File CRUD
  modules/git/          Git operations
  modules/pty/          PTY terminal WebSocket
  modules/stream/       Claude chat streaming WebSocket
  modules/control_plane/ Auth, workspace, collaboration, membership
  modules/ui_state/     UI state persistence
  modules/github_auth/  GitHub OAuth
  modules/agent_normal/ Agent-normal runtime
src/control_plane/      Control plane service (DB, identity, provisioning, security)
tests/                  unit/, integration/, contract/, security/, smoke/
docs/                   Architecture, plans, runbooks, extension guide, design tokens
scripts/                Build, lint, E2E runner utilities
bui/                    Go CLI tool
personas/prompts/       Agent role prompts (orchestrator, reviewer, worker)
.beads/                 Issue tracking (br)
.agent-evidence/        Agent work artifacts
```

## Where to Find What

| Topic | Doc |
| --- | --- |
| Architecture + beliefs + boundaries + ownership | `docs/ARCHITECTURE.md` |
| Design tokens | `docs/design-tokens.md` |
| Extension guide (child apps) | `docs/EXTENSION_GUIDE.md` |
| Quality grades + tech debt | `docs/QUALITY.md` |
| Modes & profiles | `docs/runbooks/MODES_AND_PROFILES.md` |
| Neon setup | `docs/runbooks/NEON_SETUP.md` |
| GitHub integration | `docs/runbooks/GITHUB_INTEGRATION.md` |
| GitHub App creation | `docs/runbooks/GITHUB_APP_MANIFEST.md` |
| PI agent API keys | `docs/runbooks/PI_AGENT_API_KEYS.md` |
| Smoke tests | `docs/runbooks/SMOKE_TESTS.md` |
| Ownership cutover | `docs/runbooks/OWNERSHIP_CUTOVER.md` |
| Backend arch plan | `docs/plans/backend-architecture-plan-python.md` |
| Fly.io deploy plan | `docs/plans/flyio-two-mode-agent-plan.md` |
| BUI framework plan | `docs/plans/BUI-FRAMEWORK.md` |
| All plans | `docs/plans/` |
| Beads reference | `docs/workflow-symlinked/beads.md` |
| Evidence conventions | `docs/workflow-symlinked/EVIDENCE.md` |
| Session lifecycle | `docs/workflow-symlinked/OPERATIONS.md` |
| Agent tools | `docs/workflow-symlinked/tools/` |

## Session Startup

1. Read `AGENTS.md` end-to-end.
2. Read `docs/ARCHITECTURE.md`.
3. Find how to run tests, lint, dev server (see Project Commands below).
4. Pick next bead: `bv --robot-next` or `br list --status=open`.

For full session lifecycle (compaction, blocked, end-of-session): see `docs/workflow-symlinked/OPERATIONS.md`.

## Bead Startup (per bead)

1. `br show <bead-id>` — goal, scope, gates, checklist, latest comments.
2. Find latest `EVIDENCE:` path in bead comments.
3. Inspect `.agent-evidence/beads/<bead-id>/...` for prior work.
4. Confirm STATE + NEXT match your role.
5. After completing each bead, do a self-review before moving to the next one.

## Project Commands

```bash
# Install
npm install && uv sync

# Frontend
npm run dev                    # Vite dev server (port 5173)
npm run build                  # Production build
npm run lint                   # ESLint + stylelint + design token lint
npm run test:run               # Unit tests (vitest, single run)
npm run test:e2e               # E2E tests (Playwright)

# Backend
pip3 install -e . --break-system-packages   # Install backend
python3 -m pytest tests/unit/ -v            # Backend unit tests
python3 -m pytest tests/ -v                 # All backend tests

# Full stack
export ANTHROPIC_API_KEY=$(vault kv get -field=api_key secret/agent/anthropic)
python3 scripts/run_full_app.py             # Or see scripts/run_full_app.sh
```

## Credentials & Vault

All secrets in HashiCorp Vault. Never commit secrets.

```
secret/agent/
├── anthropic              # Claude API key (shared)
├── boringdata-agent       # GitHub token, username, email (shared)
├── openai, gemini, tavily # Other shared API keys
├── services/              # Shared infra
│   ├── boring-ui-app      # GitHub App (app_id, client_id, client_secret, pem, slug)
│   ├── resend             # Transactional email (verification emails via resend.com)
│   ├── hetzner, hetzner-s3, cloudflare, clickhouse, huggingface
│   └── ...
└── app/                   # App-specific per-env secrets
    ├── boring-ui/prod     # database_url, session_secret, settings_key, neon_auth_*, deploy_*
    ├── boring-macro/prod
    ├── boring-content/prod
    ├── boring-doctor/prod
    └── bdocs/prod
```

`boring.app.toml` `[deploy.secrets]` maps env vars to Vault paths. `bui` resolves them at deploy time.

```bash
# Common patterns
export ANTHROPIC_API_KEY=$(vault kv get -field=api_key secret/agent/anthropic)
export DATABASE_URL=$(vault kv get -field=database_url secret/agent/app/boring-ui/prod)
export RESEND_API_KEY=$(vault kv get -field=api_key secret/agent/services/resend)
vault kv list secret/agent/app/           # List all apps
vault kv get secret/agent/app/boring-ui/prod  # Show all fields
```

Agent token is **read-only** for `secret/agent/*` and `secret/shared/*`.

## Issue Tracking (br)

All tracking via **br**. No markdown TODOs, no other trackers.

```bash
br ready --json                          # Unblocked work
br create "Title" -t bug|feature|task -p 0-4 --json
br update br-42 --status in_progress --json
br close br-42 --reason "Done" --json
br sync --flush-only                     # Export to .beads/issues.jsonl
```

`.beads/` is authoritative — always commit with code changes. Never edit `.beads/*.jsonl` directly.

Priorities: `0` critical, `1` high, `2` medium (default), `3` low, `4` backlog.

## bv (triage sidecar)

**Only use `--robot-*` flags. Bare `bv` launches a TUI that blocks your session.**

```bash
bv --robot-triage        # Start here: ranked picks, quick wins, blockers, health
bv --robot-next          # Single top pick + claim command
bv --robot-plan          # Parallel execution tracks
bv --robot-insights      # PageRank, betweenness, cycles, critical path
bv --robot-alerts        # Stale issues, blocking cascades
```

## MCP Agent Mail

Agents access Agent Mail **natively via MCP tools** — no HTTP wrappers needed.

```
ensure_project → register_agent → set_contact_policy
send_message / fetch_inbox / acknowledge_message
file_reservation_paths (advisory file leases)
macro_start_session (fast setup)
```

If MCP tools unavailable, flag to user — Agent Mail server may need starting.

## Landing the Plane

When ending a work session:

1. File issues for remaining work (new beads).
2. Run quality gates if code changed.
3. Update bead status.
4. Sync beads: `br sync --flush-only`
5. Hand off context for next session.

