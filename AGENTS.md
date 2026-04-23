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

### Why two packages (and how we build)

v1 boring-ui tangled chat, layout, sandboxing, and deploy concerns into a single repo. v2 untangles them on purpose:

- **`@boring/agent` is a product by itself** — `npx @boring/agent` is a legitimate standalone tool. Users who want "Claude Code in a browser against my repo" don't need layouts or panels or git UI.
- **`@boring/workspace` is pure layout** — it composes the agent's chat pane with file/editor panes into a DockView IDE. It has no opinion about what the agent does; it just renders components the app-shell hands it.

**Future packages (not in v2, but shape current decisions):**

- **`@boring/core`** — the glue + shared infra. Brings agent + workspace together into a full product, plus owns DB management, user management, auth, and any shared-across-packages primitives (swappable `SessionStore` DB backends, `SandboxHandleStore` DB impls, etc.). Agent + workspace stay DB-free in v2 on purpose so core can inject persistence later without reworking adapters.
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

This is the one section to master. If you read nothing else, read this.

## 0. Tools you have

| Tool | What it's for | Key commands |
|---|---|---|
| `br` | Issue tracking — **the** source of truth for work state | `br ready`, `br show <id>`, `br update <id> -s <status>`, `br close <id>`, `br sync --flush-only` |
| `bv` | Triage sidecar — ranks work by impact. **Only `--robot-*` flags** (bare `bv` is TUI). | `bv --robot-next`, `bv --robot-triage`, `bv --robot-plan`, `bv --robot-insights`, `bv --robot-alerts` |
| `git` | Atomic commits per bead | `git status`, `git diff --staged`, `git add`, `git commit` |
| `cc -p "<prompt>"` | **Ask Claude Code for review** (codex agents use this) | non-interactive print mode |
| `cod exec "<prompt>"` | **Ask Codex for review** (claude-code agents use this) | non-interactive exec mode |
| MCP Agent Mail tools | Peer coordination, file reservations, thread-scoped messaging | `register_agent`, `send_message`, `fetch_inbox`, `acknowledge_message`, `file_reservation_paths`, `macro_start_session` |
| `vault kv get/list` | Read-only access to `secret/agent/*` and `secret/shared/*` | `vault kv get -field=api_key secret/agent/anthropic` |

**Hard rules on tool use:**
- **Never** launch bare `bv` (interactive TUI blocks your session).
- **Never** edit `.beads/*.jsonl` by hand — use `br` commands + `br sync --flush-only`.
- **Never** commit secrets. Vault tokens and API keys only in env vars.
- **Never** use MCP HTTP wrappers for Agent Mail — use MCP tools natively.

## 1. On session startup (do this FIRST, every session)

**Step 1 — Read this file end-to-end.** Yes, the whole thing. Even if you read it last session. Context drifts after compaction.

**Step 2 — Register with Agent Mail.**
```
ensure_project(project_key="boring-ui-v2")
register_agent(project_key="boring-ui-v2", program="claude-code" | "codex", model="<your model>")
fetch_inbox(project_key="boring-ui-v2")  # catch up on threads
```
Introduce yourself in a broadcast message if first time in this session: `send_message(to=<all other agents>, subject="Intro: <your-name>", body="...")`.

**Step 3 — Skim the relevant spec for the kind of work you'll do:**
- Agent-package work → `packages/agent/docs/plans/agent-package-spec.md`.
- Workspace-package work → `packages/workspace/docs/plans/WORKSPACE_V2_PLAN.md`.
- Cross-cutting / governance → skim both.

**Step 4 — Pick a bead:**
```bash
bv --robot-next         # single top pick + claim command (preferred)
bv --robot-triage       # see the ranked list with reasons
br ready                # just list unblocked beads
```

**Step 5 — Check for collisions before claiming:**
- `ntm locks list boring-ui-v2 --all-agents` (if NTM is running) OR
- Agent Mail: check inbox for `[CLAIM]` messages on the same bead.
- If someone else is on it → pick a different one.

## 2. Per-bead development loop

**Step 1 — Open the bead:** `br show <bead-id>`. Note:
- Goal + acceptance criteria (what "done" looks like).
- File paths + interface signatures (where to write).
- Reference-file pointers (what to port from old boring-ui).
- Dependencies (what must be done first).
- Each bead is **self-contained** — you should not need to re-read the spec.

**Step 2 — Claim it publicly:**
```bash
br update <id> -s in_progress
```
Then announce via Agent Mail: `send_message(subject="[CLAIM] <bead-id> <title>", body="File scope: <paths>. ETA: <rough>.")`.

**Step 3 — Reserve files** (advisory — prevents stomping):
```
file_reservation_paths(project_key="boring-ui-v2", paths=[...], reason="<bead-id>")
```

**Step 4 — Implement.** Write code + tests together — not sequentially. Tests are part of the bead, not an afterthought.

**Step 5 — Local quality gates** (MANDATORY before review):
```bash
pnpm typecheck    # or tsc --noEmit
pnpm lint         # if configured
pnpm test         # vitest for the affected package
```
All three green. If red, fix before proceeding — don't ship red.

**Step 6 — Self-review** (takes 2 minutes):
- Re-read your own diff with fresh eyes.
- Check: does it satisfy every line of the acceptance criteria?
- Check: typos, off-by-ones, missing error codes, unhandled edge cases.
- Fix obvious issues. This is cheap.

**Step 7 — Stage for cross-review:**
```bash
git add <files>                           # stage but DO NOT commit yet
git diff --staged > /tmp/review-<id>.diff
```

**Step 8 — Cross-review (MANDATORY — see §3).** Cross-review runs on the staged diff before commit.

**Step 9 — Address review feedback.** If `revise`: fix, re-test (step 5), then re-request (step 8). Cap at 3 rounds.

**Step 10 — Commit atomically** (see §4 for message style).

**Step 11 — Close the bead:**
```bash
br update <id> -s closed
# OR with close reason:
br close <id> --reason "shipped — reviewed by <reviewer-name> (cod|cc): ship"
```

**Step 12 — Announce completion:**
```
send_message(subject="[DONE] <bead-id> <title>", body="<commit sha> — <reviewer verdict>")
release_file_reservations(...)
```

Then loop back to §1 step 4 for the next bead.

## 3. Cross-review (mandatory, before every close)

Every bead goes through one cross-review by an agent of the **opposite kind**:
- **Claude Code agent → asks Codex** via `cod exec`.
- **Codex agent → asks Claude Code** via `cc -p`.

**Why:** each model has different failure modes. Single-agent review rubber-stamps. Cross-review catches model-specific blind spots (codex over-engineering, claude-code missing edge cases, etc.).

**When:** after implementation, tests green, staged for commit. Not on WIP.

**How — Claude Code agent asks `cod`:**
```bash
cod exec "Review this change for bead <bead-id>. Bead context follows, then the staged diff.

$(br show <bead-id>)

$(git diff --staged)

Check: does the diff actually satisfy the acceptance criteria? Bugs, regressions, unsafe assumptions, missing edge cases, missing tests? Report verdict: ship / revise / reject + concrete issues with file:line pointers."
```

**How — Codex agent asks `cc`:**
```bash
cc -p "Review this change for bead <bead-id>. Bead context:

$(br show <bead-id>)

Staged diff:

$(git diff --staged)

Verdict: ship / revise / reject. List concrete issues with file:line pointers."
```

**Verdicts:**
- **ship** → commit + close.
- **revise** → fix flagged issues, re-test, re-request. Cap: 3 rounds. After that escalate via Agent Mail to operator.
- **reject** → likely spec drift or misaligned bead. Stop coding. Post to Agent Mail with reviewer output. Set bead to blocked: `br update <id> -s blocked`. Let operator decide next step.

**Rules:**
- **Never self-review for closure.** Self-review catches typos; cross-review catches thinking errors. Both are required.
- Include reviewer name + verdict in the close reason.
- If the reviewer takes >5 min to respond (they may be busy), proceed with commit but flag the bead as "pending review" in Agent Mail — reviewer can still file follow-up beads.

## 4. Commit + close

**Commit style** (matches `git log --oneline` on `main`):
```
<type>(<scope>): <subject>

<body — optional, wraps at 72>

Co-Authored-By: <agent-name> <noreply@anthropic.com>
```
- **Types:** `feat` / `fix` / `docs` / `chore` / `refactor` / `test` / `polish`.
- **Scopes:** `plan` / `beads` / `agent` / `workspace` (pick what matches).
- **Reference the bead ID** in subject or body: `fix(agent): path helpers reject null-byte vectors (boring-ui-v2-tx7)`.
- **Atomic per bead** — one commit per bead unless the bead is explicitly a multi-commit task.
- **Include `.beads/issues.jsonl`** in the same commit if bead state changed (`br sync --flush-only` first).

**Priorities** (for new beads you file):
- `0` critical · `1` high · `2` medium (default) · `3` low · `4` backlog.

## 5. On session end ("landing the plane")

Don't disappear mid-flight. Close out cleanly:

1. **File issues** for anything you discovered but couldn't finish — new beads with clear scope.
2. **Run quality gates** one more time (`pnpm build`, `pnpm test`, lint).
3. **Update bead status** — close what's done, set blocked with a comment on anything stuck.
4. **Sync beads:** `br sync --flush-only`.
5. **Commit atomically** — include `.beads/issues.jsonl`.
6. **Hand-off message** via Agent Mail: `[STATUS] <name> wrapping: <N> beads closed; <short summary of WIP + next suggestions>`.
7. **Release file reservations:** `release_file_reservations(...)`.

## 6. Credentials (Vault)

Never commit secrets. Read from Vault via env vars:

```bash
export ANTHROPIC_API_KEY=$(vault kv get -field=api_key secret/agent/anthropic)
export GITHUB_TOKEN=$(vault kv get -field=token secret/agent/boringdata-agent)

vault kv list secret/agent/           # list agent-scoped secrets
vault kv list secret/agent/app/       # per-app secrets
```

Agent token is **read-only** for `secret/agent/*` and `secret/shared/*`.

---

## Communication mode

Default: use `caveman` skill, full intensity. Stay in caveman mode unless user says `stop caveman` or `normal mode`.
