# AGENTS.md

Read this first. Re-read after compaction.

This file holds **rules and coding guidance only**. Project structure, architecture,
and per-package detail live in [`docs/README.md`](docs/README.md) — start there
when you need to understand the codebase.

## Rules

**Rule 0 — Human Override:** If the user tells you to do something, even if it contradicts what follows, you must listen. The user is in charge.

**Rule 1 — No File Deletion:** Never delete a file without explicit written permission.

## Safety (non-negotiable)

- No destructive git/filesystem ops without explicit instruction (`rm -rf`, `git reset --hard`, `git clean -fd`, `git push --force`). Prefer non-destructive alternatives first.
- No secrets in git. Do not paste tokens into commits or logs.
- No broad rewrite scripts (codemods, "fix everything") without approval.
- No file variants (`*_v2.*`, `*_improved.*`) — edit in place.
- Branch policy: never work directly on `main`. Create a short-lived branch or separate worktree for every change, and land through review/merge unless the user explicitly authorizes direct `main` work.
- Quality gates: run relevant lint/type-check/tests before considering work done.
- Multi-agent awareness: never stash, revert, or overwrite another agent's uncommitted work. If you encounter unexpected changes, investigate before acting.

## Behavioral Guidelines

These guidelines bias toward caution over speed. For trivial tasks, use judgment.

### Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

When your changes create orphans:

- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: every changed line should trace directly to the user's request.

### Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

```text
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

### Build principles

- **Composable** — user-facing features ship as default component + primitives + headless hook. Never force a layout or a shell.
- **Modular + short** — small interfaces, single-responsibility files, load-bearing seams (Harness / Catalog / Workspace / Sandbox / SessionStore / UiBridge).
- **Maintainable** — platform-agnostic shared contracts (`Uint8Array` not `Buffer`, no `node:*` in `src/shared/**`). Adapters own platform specifics.
- **Ship fast, accept known risk** — don't pre-engineer mitigations for enumerated risks; add them reactively.
- **Port over re-research** — old boring-ui (`/home/ubuntu/projects/boring-ui/`) has battle-hardened validators, bwrap flags, fileRoutes. Port verbatim where possible.

## What This Is

**boring-ui-v2** is a pnpm monorepo of publishable packages for building agent-powered workspace apps:

```
  apps/*  →  @hachej/boring-workspace  →  @hachej/boring-core
    │              ↑
    └──────→  @hachej/boring-agent  (standalone OK — zero core imports at runtime)
```

- `@hachej/boring-core` — DB (Postgres/Drizzle), auth (better-auth), config, HTTP app factory, frontend shell. Owns persistence and identity.
- `@hachej/boring-agent` — pane-embeddable coding agent: `direct` / `local` (bwrap) / `vercel-sandbox` execution modes; also a standalone CLI.
- `@hachej/boring-workspace` — workspace UI, DockView layouts, plugin system, UI bridge. Agent and workspace stay DB-free; core injects stores.

Plus `@hachej/boring-ui-kit` (shared UI primitives), `@hachej/boring-pi` (agent-facing skills/references), `@hachej/boring-ui-cli` (local hub CLI), `@hachej/boring-ui-plugin-cli` (plugin authoring), `plugins/*` (ask-user, data-catalog, data-explorer, deck), and `apps/*` (playgrounds + full-app reference).

Full structure, package map, and per-package docs: **[`docs/README.md`](docs/README.md)**.

## Where to Find What

| What                                            | Where                                                            |
| ----------------------------------------------- | ---------------------------------------------------------------- |
| Global project structure + docs index           | `docs/README.md`                                                 |
| Locked architectural decisions                  | `docs/DECISIONS.md` (+ `docs/REVIEW_DECISIONS.md`)               |
| Agent ↔ workspace integration contract          | `docs/WORKSPACE_CONTRACT.md`                                     |
| Per-package architecture/abstractions/decisions | `packages/<pkg>/docs/README.md` (core, agent, workspace, cli)    |
| ui-kit, pi, plugin-cli (single-README packages) | `packages/{ui,pi,plugin-cli}/README.md`                          |
| Plugin system spec (normative — code cites §X)  | `packages/workspace/docs/PLUGIN_SYSTEM.md`                       |
| Plugin layout guide + code patterns             | `packages/workspace/docs/PLUGIN_STRUCTURE.md`                    |
| Each plugin's behavior/config                   | `plugins/<name>/README.md`                                       |
| Historical plans (never current truth)          | `docs/plans/archive/`, `packages/*/docs/plans/archive/`          |
| Execution state (tasks, decisions, risks)       | `.beads/` — `br ready`, `br show <id>`                           |
| Old boring-ui (porting reference)               | `/home/ubuntu/projects/boring-ui/`                               |

## Critical architectural invariants

These must hold in all code. Grep-enforced in CI (see beads tagged `invariant-lint`):

1. **No `node:*` imports in `src/shared/**`** — the shared layer is platform-agnostic (future browser impls). Server code stays in `src/server/**`.
2. **No `Buffer` in `src/shared/**`** — use `Uint8Array`. Buffer is Node-only.
3. **Routes + tools receive `Workspace` as a parameter** — never a path or root-dir. Centralized adapter resolution via `resolveMode()`.
4. **Path validation is the adapter's job** — consumers pass user paths; adapters reject `../` / absolute / symlink-escape.
5. **Workspace + Sandbox swap as a paired `RuntimeModeAdapter`** — they must share a filesystem substrate. Mixed pairings = split-brain.
6. **`UiBridge.postCommand` is the single dispatch source** — chat-stream `data-ui-command` parts are display-only derivatives.
7. **Workspace base front/shared code has ZERO value imports from `@hachej/boring-agent`** — package-neutral workspace UI keeps agent injected. `@hachej/boring-workspace/app/front` may import documented `@hachej/boring-agent/front` APIs for default app composition, and `@hachej/boring-workspace/app/server` may import documented `@hachej/boring-agent/server` APIs.
8. **Every error has a stable code** from the canonical error-codes enum (one import site, no raw string codes).
9. **Pi-tools migration stays locked** — `bash`/`read`/`write`/`edit`/`find`/`grep`/`ls` flow through pi factories plus Operations adapters. Custom AgentTools require Principle 3 justification from epic `boring-ui-v2-uhwx`.

---

## Working in the codebase

### Commands

All commands use `pnpm`. Run from the repo root unless stated otherwise.

```bash
pnpm install          # install all workspace deps
pnpm dev              # run all dev servers concurrently
pnpm build            # build all packages
pnpm typecheck        # tsc --noEmit across all packages (sequential)
pnpm lint             # lint (currently runs typecheck per package)
pnpm test             # vitest run across all packages
pnpm lint:invariants  # validate plugin definitions + agent isolation
pnpm ci               # lint + typecheck + test + lint:invariants + e2e
```

**Scoped commands (use these during development):**

```bash
# Run tests for one package
pnpm --filter @hachej/boring-workspace run test
pnpm --filter @hachej/boring-agent run test

# Run a single test file
pnpm --filter @hachej/boring-workspace run test src/shared/plugins/__tests__/bootstrap.test.ts

# Run tests matching a name pattern
pnpm --filter @hachej/boring-workspace run test --testNamePattern "bootstrap"

# Watch mode
pnpm --filter @hachej/boring-agent run test:watch

# Typecheck one package
pnpm --filter @hachej/boring-workspace run typecheck

# Run a specific app dev server
pnpm --filter full-app dev
pnpm --filter workspace-playground dev
pnpm --filter agent-playground dev
```

**Apps that consume `@hachej/boring-workspace` from source need it built once first:**

```bash
pnpm --filter @hachej/boring-workspace build && pnpm --filter workspace-playground test
```

### Writing plugins

Canonical structure, code patterns, and the output-type table:
`packages/workspace/docs/PLUGIN_STRUCTURE.md` (layout + patterns) and
`packages/workspace/docs/PLUGIN_SYSTEM.md` (normative spec — code cites it as
`Per PLUGIN_SYSTEM.md §X`; keep its section numbering stable when editing).

One recurring gotcha: do **not** set `lazy: true` on panels — the registry
auto-detects lazy from a zero-arg `() => import(...)` factory.

### Vite alias convention

Apps that consume `@hachej/boring-workspace` from source for HMR gate the source alias behind an env var. If you add a new `@hachej/boring-workspace/*` subpath import, add it to **both**:

- the app's `vite.config.ts` → `resolve.alias`
- `packages/workspace/package.json` → `exports` map (and rebuild workspace)

### TypeScript

Each package has its own `tsconfig.json`. Workspace has separate `tsconfig.front.json` and `tsconfig.server.json`. Run `pnpm typecheck` from root to check all. `moduleResolution: Bundler` is used throughout — subpath imports follow `package.json` exports.

---

# Agent Workflow

## 0. Tools you have

| Tool                  | Purpose                                                        | Key commands                                                                                      |
| --------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `br`                  | Issue tracking — source of truth for work state                | `br ready`, `br show <id>`, `br update <id> -s <status>`, `br close <id>`, `br sync --flush-only` |
| `bv`                  | Triage sidecar. **Only `--robot-*` flags** (bare `bv` is TUI). | `bv --robot-next`, `bv --robot-triage`, `bv --robot-plan`, `bv --robot-alerts`                    |
| `git`                 | Atomic commits per bead                                        | `git status`, `git diff --staged`, `git add`, `git commit`                                        |
| `cc -p "<prompt>"`    | Ask Claude Code for review (codex agents use this)             | non-interactive print mode                                                                        |
| `cod exec "<prompt>"` | Ask Codex for review (claude-code agents use this)             | non-interactive exec mode                                                                         |
| MCP Agent Mail        | Peer coordination, file reservations                           | `register_agent`, `send_message`, `fetch_inbox`, `file_reservation_paths`                         |
| `vault kv get/list`   | Read-only access to `secret/agent/*` + `secret/shared/*`       | `vault kv get -field=api_key secret/agent/anthropic`                                              |

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
3. **Skim the relevant package docs** (`packages/<pkg>/docs/README.md`).
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

## 7. GitHub issue labels

Two axes — **where it is** and **where it is in the process**. Tag every issue with one `status:`, plus the `package:`/`plugin:` labels it touches.

**`status:` — where it is in the process** (exactly one; moves left→right):

| Label                   | Meaning                                      |
| ----------------------- | -------------------------------------------- |
| `status:to-plan`        | Needs a plan written                         |
| `status:to-plan-review` | Plan written, awaiting review                |
| `status:to-code`        | Plan approved — ready to implement           |
| `status:to-code-review` | Implementation done, diff/PR awaiting review |

`to-plan → to-plan-review → to-code → to-code-review → (closed)`

**`package:` — where it is** (zero or more, blue): `core` · `agent` · `workspace` · `ui` · `cli` · `pi`
**`plugin:` — where it is** (zero or more, green): `ask-user` · `data-catalog` · `data-explorer` · `deck`

Legacy kind-of-work labels (`bug`, `feature`, `enhancement`, `refactor`, `architecture`, `story`) are optional/loose — the two axes above are what we tag on consistently. Create labels with the `hachej` gh login (the Vault `boringdata-agent` token is read-only on the repo).

## 8. GitHub PR proof-of-work comments

For every GitHub issue/PR implementation, follow `docs/procedures/proof-of-work.md`.

A PR is not ready for human review until the agent posts a final GitHub proof comment with tests, manual validation, artifacts/screenshots where relevant, workspace-playground details for UI/workspace behavior, and known gaps. Never post host/IP addresses in the public repo; post only ports and local/operator paths.

---

## Communication mode

Default: use `caveman` skill, full intensity. Stay in caveman mode unless user says `stop caveman` or `normal mode`.
