# AGENTS.md

Read this first. Re-read after compaction.

## Rules

**Rule 0 — Human Override:** If the user tells you to do something, even if it contradicts what follows, you must listen. The user is in charge.

**Rule 1 — No File Deletion:** Never delete a file without explicit written permission.

## Safety (non-negotiable)

- No destructive git/filesystem ops without explicit instruction (`rm -rf`, `git reset --hard`, `git clean -fd`, `git push --force`). Prefer non-destructive alternatives first.
- No secrets in git. Do not paste tokens into commits or logs.
- No broad rewrite scripts (codemods, "fix everything") without approval.
- No file variants (`*_v2.*`, `*_improved.*`) — edit in place.
- Branch policy: work on `main`. Never create feature branches unless instructed.
- Quality gates: run relevant lint/type-check/tests before considering work done.
- Multi-agent awareness: never stash, revert, or overwrite another agent's uncommitted work. If you encounter unexpected changes, investigate before acting.

## What This Is

**boring-ui-v2** is a greenfield monorepo building **two publishable packages**:

- **`@boring/agent`** — pane-embeddable coding agent. Ships 3 execution modes behind one mental model: `direct` (no isolation, macOS/Windows dev) / `local` (bwrap on Linux) / `vercel-sandbox` (Firecracker microVM). Also ships as a first-class CLI (`npx @boring/agent`), zero setup, zero deploy.
- **`@boring/workspace`** — frontend-only layout package. Composes `ChatPanel` (from `@boring/agent`) + FileTree + Editor into IDE / Chat layouts. Consumes agent's HTTP routes; ZERO backend code. ZERO imports from `@boring/agent` (app shell wires them together).

The two packages are designed to be composed by a final **app shell** (the end user's app). See `packages/agent/docs/plans/agent-package-spec.md` and `packages/workspace/docs/plans/WORKSPACE_V2_PLAN.md` for full designs.

**Current state: pre-M0.** Specs are locked; interface + implementation beads are queued in `.beads/` under label `agent-v1`. Most `packages/` subdirs are empty shells awaiting M0 scaffold work.

### Target stack (per spec — not yet installed)

- Frontend: React + Vite + Tailwind v4, `@ai-sdk/react` `useChat`, ai-elements copied into `src/front/primitives/` (shadcn-style).
- Backend: TypeScript, Fastify, `@mariozechner/pi-coding-agent` as harness runtime.
- Sandboxing: `child_process.exec` (direct) / `bwrap` (local) / `@vercel/sandbox` (remote).
- Testing: Vitest (unit) + Playwright (e2e).
- Package mgmt: pnpm workspace.

## Repo Layout

```
boring-ui-v2/
├── AGENTS.md                         (this file)
├── .beads/                           (br issue tracking — agent-v1 label = this project)
├── packages/
│   ├── agent/
│   │   ├── package.json              (exists; minimal shell)
│   │   ├── tsconfig.json             (exists)
│   │   ├── docs/plans/
│   │   │   └── agent-package-spec.md (LOCKED design — ~1,700 lines)
│   │   └── src/                      (empty — M0 scaffolds shared/ + server/ + front/)
│   └── workspace/
│       ├── docs/plans/
│       │   └── WORKSPACE_V2_PLAN.md  (LOCKED design)
│       └── src/                      (empty — v2 workspace package; not in agent v1 scope)
```

No `apps/`, no `src/` at repo root, no CLI Go tool (`bui` is a v1 concept). Everything lives inside `packages/`.

## Where to Find What

| What | Where |
|---|---|
| Agent package spec | `packages/agent/docs/plans/agent-package-spec.md` |
| Workspace package plan | `packages/workspace/docs/plans/WORKSPACE_V2_PLAN.md` |
| Locked architectural decisions (23 items) | Bead `m0.decisions-registry` (future `docs/DECISIONS.md`) |
| Review decisions (24 findings) | Bead `gov.review-decisions` (future `docs/REVIEW_DECISIONS.md`) |
| Error code registry | Bead `gov.error-codes` (future `src/shared/error-codes.ts` + `docs/ERROR_CODES.md`) |
| Cross-plan contracts with workspace | Bead `coord.workspace-plan-contract` (future `docs/WORKSPACE_CONTRACT.md`) |
| Old boring-ui (reference — port/adapt code, don't re-research) | `/home/ubuntu/projects/boring-ui/` |

The agent spec has a "Reference files from the old boring-ui" section (§Reference files) that maps each M1 port task → the exact file to port from. **Port and adapt — no blind research.**

## Critical architectural invariants

These are enforced in bead `infra.invariant-lint` + must hold in all code:

1. **No `node:*` imports in `src/shared/**`** — the shared layer is platform-agnostic (future browser impls). Server code stays in `src/server/**`.
2. **No `Buffer` in `src/shared/**`** — use `Uint8Array`. Buffer is Node-only.
3. **Routes + tools receive `Workspace` as a parameter** — never a path or root-dir. Centralized adapter resolution via `resolveMode()`.
4. **Path validation is the adapter's job** — consumers pass user paths; adapters reject `../` / absolute / symlink-escape.
5. **Workspace + Sandbox swap as a paired `RuntimeModeAdapter`** — they must share a filesystem substrate. Mixed pairings = split-brain.
6. **`UiBridge.postCommand` is the single dispatch source** — chat-stream `data-ui-command` parts are display-only derivatives.
7. **Workspace package has ZERO imports from `@boring/agent`** — app shell wires `ChatPanel` via `WorkspaceProvider panels` prop.
8. **Every error has a stable code** from `src/shared/error-codes.ts` (see `gov.error-codes`).

## Session Startup

1. Read `AGENTS.md` end-to-end (this file).
2. Skim the relevant spec: `packages/agent/docs/plans/agent-package-spec.md` for agent work, or the workspace plan.
3. Pick next bead: `bv --robot-next` or `br ready` (filter by label `agent-v1`).
4. If starting M0: the 8 interface beads and scaffold bead are all unblocked + P1.

## Bead Startup (per bead)

1. `br show <bead-id>` — goal, spec-level signatures, file paths, reference-file pointers, success criteria.
2. Each agent-v1 bead is **self-contained** — you should NOT need to re-read the spec to implement.
3. Update status: `br update <id> -s in_progress` when claiming; `-s closed` when the acceptance criteria are met + tests pass + code reviewed.

## Commit style

Match existing pattern (from `git log --oneline`):

```
<type>(<scope>): <subject>

<body — optional, wraps at 72>

Co-Authored-By: <agent name> <noreply@anthropic.com>
```

Types: `feat` / `fix` / `docs` / `chore` / `refactor` / `test` / `polish`.
Scopes so far: `plan` / `beads` / `agent` / `workspace` — pick one that matches your bead.

Commit atomically per bead. Reference the bead ID in the subject OR body: `fix(agent): path helpers reject null-byte vectors (boring-ui-v2-tx7)`.

## Issue Tracking (br)

All tracking via **br**. No markdown TODOs, no other trackers.

```bash
br ready                      # Unblocked work
br show <id>                  # Full detail + acceptance criteria
br create "Title" -t task -p 1 -d "..." -l agent-v1
br update <id> --status in_progress
br close <id> --reason "<why>"
br sync --flush-only          # Export to .beads/issues.jsonl
```

`.beads/` is authoritative — commit `issues.jsonl` with code. Never edit it by hand.

The agent-v1 plan has **126 beads** across 9 epics (project / m0–m5 / infra) — filter with `-l agent-v1`.

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

Agent Mail project key: `boring-ui-v2`.

## Credentials & Vault

All secrets in HashiCorp Vault. Never commit secrets.

```bash
# Common patterns
export ANTHROPIC_API_KEY=$(vault kv get -field=api_key secret/agent/anthropic)
export GITHUB_TOKEN=$(vault kv get -field=token secret/agent/boringdata-agent)

vault kv list secret/agent/           # List agent-scoped secrets
vault kv list secret/agent/app/       # Per-app secrets
```

Agent token is **read-only** for `secret/agent/*` and `secret/shared/*`.

## Landing the Plane

When ending a work session:

1. File issues for remaining work (new beads) — especially if you discovered gaps.
2. Run quality gates if code changed (`pnpm build`, `pnpm test`, lint).
3. Update bead status (close completed, move blocked ones to `blocked` with a reason in the bead comments).
4. Sync beads: `br sync --flush-only`.
5. Commit atomically; include `.beads/issues.jsonl` in the commit.
6. Hand off context in a brief agent-mail message for next session.

## Communication mode

Default: use `caveman` skill, full intensity. Stay in caveman mode unless user says `stop caveman` or `normal mode`.
