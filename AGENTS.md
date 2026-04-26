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

**boring-ui-v2** is a greenfield monorepo building **three publishable packages**:

- **`@boring/core`** — canonical app shell: DB (Postgres/Drizzle), auth (better-auth), config, HTTP app factory (Fastify), and frontend provider stack (`<BoringApp>`). Every child app imports core first. See [`packages/core/docs/CORE.md`](packages/core/docs/CORE.md) for the full spec.
- **`@boring/agent`** — pane-embeddable coding agent. Ships 3 execution modes behind one mental model: `direct` (no isolation, macOS/Windows dev) / `local` (bwrap on Linux) / `vercel-sandbox` (Firecracker microVM). Also ships as a first-class CLI (`npx @boring/agent`), zero setup, zero deploy.
- **`@boring/workspace`** — frontend-only layout package. Composes `ChatPanel` (from `@boring/agent`) + FileTree + Editor into IDE / Chat layouts. Consumes agent's HTTP routes; ZERO backend code. ZERO imports from `@boring/agent` (app shell wires them together).

**Dependency graph (inverted — core at the bottom):**
```
  apps/*  →  @boring/workspace  →  @boring/core
    │              ↑
    └──────→  @boring/agent  (standalone OK — zero core imports at runtime)
```
`@boring/core` owns persistence and identity. `@boring/agent` and `@boring/workspace` stay DB-free; core injects stores via `createCoreApp` options. Agent can also boot standalone (`createAgentApp`) with zero core dependency.

The three packages are designed to be composed by a final **app shell** (the end user's app). See `packages/agent/docs/plans/agent-package-spec.md`, `packages/workspace/docs/plans/WORKSPACE_V2_PLAN.md`, and `packages/core/docs/CORE.md` for full designs.

### Why two packages (and how we build)

v1 boring-ui tangled chat, layout, sandboxing, and deploy concerns into a single repo. v2 untangles them on purpose:

- **`@boring/agent` is a product by itself** — `npx @boring/agent` is a legitimate standalone tool. Users who want "Claude Code in a browser against my repo" don't need layouts or panels or git UI.
- **`@boring/workspace` is pure layout** — it composes the agent's chat pane with file/editor panes into a DockView IDE. It has no opinion about what the agent does; it just renders components the app-shell hands it.

**Future packages (not yet implemented, but shape current decisions):**

- **`@boring/cloud`** — deployment + multi-tenancy. Multi-workspace provisioning, per-user/per-tenant workspace lifecycle, Fly/Modal/Vercel orchestration, billing integration, multi-tenant auth. Kept OUT of agent + workspace so self-hosters don't carry cloud weight.

Design implication today: every interface that might need DB-backing in the future (`SessionStore`, `SandboxHandleStore`, etc.) ships with a file-based default in v2 + an injection seam (`createAgentApp({ sessionStore, sandboxHandleStore })`) so core/cloud can swap in DB impls without touching agent/workspace internals.

**Build principles — apply these to every bead:**

- **Composable** — every user-facing feature ships as a trio: default component + primitives + headless hook. Consumers pick the level they want; we never force a layout or a shell.
- **Modular + short** — small interfaces, single-responsibility files, load-bearing seams (Harness / Catalog / Workspace / Sandbox / SessionStore / UiBridge). 
- **Easy to maintain** — platform-agnostic shared contracts (`Uint8Array` not `Buffer`, no `node:*` in `src/shared/**`). Adapters own platform specifics. Swapping an adapter = swap one file.
- **Ship fast, accept known risk** — if a risk is enumerated in the spec's Risks section, we don't pre-engineer mitigations. We add them reactively when a user hits them.
- **Port over re-research** — the old boring-ui has battle-hardened path validators, bwrap flags, fileRoutes. Port verbatim where possible.


### Target stack (per spec — not yet installed)

- Frontend: React + Vite + Tailwind v4, `@ai-sdk/react` `useChat`, ai-elements copied into `src/front/primitives/` (shadcn-style).
- Backend: TypeScript, Fastify, `@mariozechner/pi-coding-agent` as harness runtime.
- Sandboxing: `child_process.exec` (direct) / `bwrap` (local) / `@vercel/sandbox` (remote).
- Testing: Vitest (unit) + Playwright (e2e).
- Package mgmt: pnpm workspace.

## Repo Layout

No `apps/`, no `src/` at repo root, no CLI Go tool (`bui` is a v1 concept). Everything lives inside `packages/`.

## Where to Find What

| What | Where |
|---|---|
| Agent package spec (canonical design) | `packages/agent/docs/plans/agent-package-spec.md` |
| Workspace package plan (canonical design) | `packages/workspace/docs/plans/WORKSPACE_V2_PLAN.md` |
| Execution plan (all tasks, decisions, risks, tests) | `.beads/` — `br ready`, `br show <id>` |
| Old boring-ui (reference for porting — don't re-research) | `/home/ubuntu/projects/boring-ui/` |

The agent spec has a "Reference files from the old boring-ui" section (§Reference files) mapping each port task → the exact file to port from. **Port and adapt — no blind research.**

Beads are the single source of truth for execution. Governance content (locked decisions, review outcomes, error codes, cross-plan contracts, invariant rules) lives in beads and gets published to `docs/` when its bead closes — check beads first, then `docs/` once they exist.

## Critical architectural invariants

These must hold in all code. Grep-enforced in CI (see beads tagged `invariant-lint`):

1. **No `node:*` imports in `src/shared/**`** — the shared layer is platform-agnostic (future browser impls). Server code stays in `src/server/**`.
2. **No `Buffer` in `src/shared/**`** — use `Uint8Array`. Buffer is Node-only.
3. **Routes + tools receive `Workspace` as a parameter** — never a path or root-dir. Centralized adapter resolution via `resolveMode()`.
4. **Path validation is the adapter's job** — consumers pass user paths; adapters reject `../` / absolute / symlink-escape.
5. **Workspace + Sandbox swap as a paired `RuntimeModeAdapter`** — they must share a filesystem substrate. Mixed pairings = split-brain.
6. **`UiBridge.postCommand` is the single dispatch source** — chat-stream `data-ui-command` parts are display-only derivatives.
7. **Workspace package has ZERO imports from `@boring/agent`** — app shell wires `ChatPanel` via `WorkspaceProvider panels` prop.
8. **Every error has a stable code** from the canonical error-codes enum (one import site, no raw string codes).

---

# Agent Workflow

## 0. Tools you have

| Tool | Purpose | Key commands |
|---|---|---|
| `br` | Issue tracking — source of truth for work state | `br ready`, `br show <id>`, `br update <id> -s <status>`, `br close <id>`, `br sync --flush-only` |
| `bv` | Triage sidecar. **Only `--robot-*` flags** (bare `bv` is TUI). | `bv --robot-next`, `bv --robot-triage`, `bv --robot-plan`, `bv --robot-alerts` |
| `git` | Atomic commits per bead | `git status`, `git diff --staged`, `git add`, `git commit` |
| `cc -p "<prompt>"` | Ask Claude Code for review (codex agents use this) | non-interactive print mode |
| `cod exec "<prompt>"` | Ask Codex for review (claude-code agents use this) | non-interactive exec mode |
| MCP Agent Mail | Peer coordination, file reservations | `register_agent`, `send_message`, `fetch_inbox`, `file_reservation_paths` |
| `vault kv get/list` | Read-only access to `secret/agent/*` + `secret/shared/*` | `vault kv get -field=api_key secret/agent/anthropic` |

**Hard rules:** never launch bare `bv`; never edit `.beads/*.jsonl` by hand; never commit secrets; use MCP tools natively (not HTTP wrappers).

## 1. On session startup

1. **Read this file end-to-end** (even if you read it last session — context drifts after compaction).
2. **Register with Agent Mail + catch up on inbox:**
   ```
   ensure_project(project_key="boring-ui-v2")
   register_agent(project_key="boring-ui-v2", program="claude-code" | "codex", model="<your model>")
   fetch_inbox(project_key="boring-ui-v2")
   ```
   If first time this session, broadcast an intro message.
3. **Skim the relevant spec** (agent or workspace).
4. **Pick a bead:** `bv --robot-next` (preferred) or `br ready`.
5. **Check for collisions** before claiming: inbox for `[CLAIM]` messages on the same bead; skip if taken.

## 2. Per-bead development loop

1. **Open the bead:** `br show <id>` — note goal, acceptance criteria, file paths, reference-file pointers, deps. Beads are self-contained; you shouldn't need to re-read the spec.
2. **Claim + reserve:** `br update <id> -s in_progress`; Agent Mail broadcast `[CLAIM] <id>` with file scope + ETA; `file_reservation_paths(...)`.
3. **Implement** — code + tests together.
4. **Verify locally:** `pnpm typecheck && pnpm lint && pnpm test` (all green), then self-review the diff.
5. **Cross-review (mandatory — see §3).** If `revise`: fix, re-verify, re-request (cap 3 rounds).
6. **Commit atomically** (see §4).
7. **Close + announce:** `br close <id> --reason "shipped — reviewed by <name>: ship"`; Agent Mail `[DONE] <id>` with commit sha; release file reservations.

Loop back to §1 step 4.

## 3. Cross-review (mandatory, before every close)

Ask an agent of the **opposite kind** to review your staged diff. Catches model-specific blind spots.

- **Claude Code agent → asks Codex via `cod exec "..."`**
- **Codex agent → asks Claude Code via `cc -p "..."`**

Isolate your changes to just this bead before sending them for review (best-effort — figure out the approach).

Verdicts: **ship** → commit + close. **revise** → fix + re-request (cap 3 rounds). **reject** → `br update <id> -s blocked`, escalate via Agent Mail. Never self-review for closure.

## 4. Commit + close

**Commit style** (matches `git log --oneline` on `main`):
```
<type>(<scope>): <subject>

<body — optional, wraps at 72>

Co-Authored-By: <agent-name> <noreply@anthropic.com>
```
- **Types:** `feat` / `fix` / `docs` / `chore` / `refactor` / `test` / `polish`.
- **Scopes:** `plan` / `beads` / `agent` / `workspace`.
- **Reference bead ID** in subject or body: `fix(agent): path helpers reject null-byte vectors (boring-ui-v2-tx7)`.
- **Atomic per bead.** Include `.beads/issues.jsonl` if bead state changed (`br sync --flush-only` first).

**Priorities for new beads:** `0` critical · `1` high · `2` medium (default) · `3` low · `4` backlog.

## 5. On session end ("landing the plane")

1. File new beads for anything you discovered but couldn't finish.
2. Run quality gates one more time.
3. Update bead status (close done, set `blocked` with comment on stuck).
4. `br sync --flush-only`.
5. Commit atomically — include `.beads/issues.jsonl`.
6. Agent Mail `[STATUS]` hand-off: `<N> beads closed; <short WIP + next suggestions>`.
7. `release_file_reservations(...)`.

## 6. Credentials (Vault)

```bash
export ANTHROPIC_API_KEY=$(vault kv get -field=api_key secret/agent/anthropic)
export GITHUB_TOKEN=$(vault kv get -field=token secret/agent/boringdata-agent)

vault kv list secret/agent/           # agent-scoped secrets
vault kv list secret/agent/app/       # per-app secrets
```
Agent token is read-only for `secret/agent/*` and `secret/shared/*`.

---

## Communication mode

Default: use `caveman` skill, full intensity. Stay in caveman mode unless user says `stop caveman` or `normal mode`.
