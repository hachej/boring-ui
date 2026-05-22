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

- **`@hachej/boring-core`** — canonical app shell: DB (Postgres/Drizzle), auth (better-auth), config, HTTP app factory (Fastify), and frontend provider stack (`<BoringApp>`). Every child app imports core first. See [`packages/core/docs/CORE.md`](packages/core/docs/CORE.md) for the full spec.
- **`@hachej/boring-agent`** — pane-embeddable coding agent. Ships 3 execution modes behind one mental model: `direct` (no isolation, macOS/Windows dev) / `local` (bwrap on Linux) / `vercel-sandbox` (Firecracker microVM). Also ships as a first-class CLI (`npx @hachej/boring-agent`), zero setup, zero deploy.
- **`@hachej/boring-workspace`** — workspace UI and bridge package. Front code composes injected chat, plugin-owned left tabs/editors/catalogs, DockView layouts, and the UI bridge client. Server/app code exports workspace bridge routes/tools and `createWorkspaceAgentApp()` for shells that compose `@hachej/boring-agent/server`.

**Dependency graph (inverted — core at the bottom):**
```
  apps/*  →  @hachej/boring-workspace  →  @hachej/boring-core
    │              ↑
    └──────→  @hachej/boring-agent  (standalone OK — zero core imports at runtime)
```
`@hachej/boring-core` owns persistence and identity. `@hachej/boring-agent` and `@hachej/boring-workspace` stay DB-free; core injects stores via `createCoreApp` options. Agent can also boot standalone (`createAgentApp`) with zero core dependency.

The three packages are designed to be composed by a final **app shell** (the end user's app). See `packages/agent/docs/plans/agent-package-spec.md`, `packages/workspace/docs/INTERFACES.md`, and `packages/core/docs/CORE.md` for current package boundaries.

### Why two packages (and how we build)

v1 boring-ui tangled chat, layout, sandboxing, and deploy concerns into a single repo. v2 untangles them on purpose:

- **`@hachej/boring-agent` is a product by itself** — `npx @hachej/boring-agent` is a legitimate standalone tool. Users who want "Claude Code in a browser against my repo" don't need layouts or panels or git UI.
- **`@hachej/boring-workspace` owns workspace UI contracts** — layouts, plugin registries, catalogs, surface resolvers, and the UI bridge. Base front/shared code stays agent-free; `@hachej/boring-workspace/app/*` may provide batteries-included composition with `@hachej/boring-agent`.

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

Packages live in `packages/`. App fixtures and demos live in `apps/`. Do not add
`src/` at repo root, and do not add the old v1 CLI Go tool (`bui`).

## Where to Find What

| What | Where |
|---|---|
| Agent package spec (canonical design) | `packages/agent/docs/plans/agent-package-spec.md` |
| Workspace package interfaces | `packages/workspace/docs/INTERFACES.md` |
| Workspace package history | `packages/workspace/docs/plans/archive/WORKSPACE_V2_PLAN.md` |
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

### Plugin system — code patterns

The user-facing intro is in [`README.md#plugin-system`](README.md#plugin-system). Canonical structure for new plugins is in [`packages/workspace/docs/PLUGIN_STRUCTURE.md`](packages/workspace/docs/PLUGIN_STRUCTURE.md). The code patterns you'll write most often:

**Minimal plugin:**

```ts
import { defineFrontPlugin, definePanel } from "@hachej/boring-workspace"

export const myPlugin = defineFrontPlugin({
  id: "my-plugin",
  label: "My Plugin",
  systemPrompt: "You can open widgets with the 'open-widget' tool.",  // injected into agent context
  outputs: [
    {
      type: "panel",
      panel: definePanel({
        id: "my-widget",
        title: "Widget",
        placement: "center",
        component: () => import("./WidgetPane").then(m => ({ default: m.WidgetPane })),
      }),
    },
  ],
})
```

**Panel components** receive `PaneProps<T>`:

```ts
import type { PaneProps } from "@hachej/boring-workspace"

interface Params { id?: string }

export function WidgetPane({ params, api, containerApi }: PaneProps<Params>) {
  // params       — data passed when the panel is opened
  // api          — DockviewPanelApi (close, setTitle, onDidParametersChange, …)
  // containerApi — DockviewApi (addPanel, fromJSON, …)
}
```

**Do NOT set `lazy: true`.** The registry auto-detects it: a zero-arg function `() => import(...)` is a lazy factory; a component `(props) => JSX` is eager. Plugin panels are code-split automatically.

**Output types:**

| type | contributes |
|---|---|
| `panel` | center/right/bottom pane opened programmatically |
| `left-tab` | persistent tab in the left sidebar |
| `command` | command palette entry |
| `catalog` | searchable, faceted data-explorer tab |
| `surface-resolver` | maps `SurfaceOpenRequest` kind → panel id |
| `binding` | React component mounted in the provider tree |
| `provider` | binding that also receives `apiBaseUrl`, `authHeaders`, etc. |

**Composing plugins (imperative API via `definePlugin`):**

See `packages/workspace/docs/PLUGIN_SYSTEM.md` for the `@hachej/boring-plugin/plugin`
imperative `api.register*` API. Plugin outputs are now declared through
`definePlugin({ id, ... })` instead of `composePlugins()`, which was removed.

**Registering with the shell:**

```tsx
<WorkspaceProvider plugins={[myPlugin]} {...shellOptions}>
  <IdeLayout />
</WorkspaceProvider>
```

### Key architectural flows

**How panels render:**

1. `WorkspaceProvider` creates a `PanelRegistry` and calls `bootstrap()` with all plugins.
2. `bootstrap()` calls `registry.register()` for every panel output.
3. `PanelRegistry.register()` auto-detects lazy vs eager from `component.length`.
4. `DockviewShell` calls `registry.getComponents()` which wraps lazy panels in `React.lazy + Suspense + PluginErrorBoundary`.
5. When dockview opens a panel by id it renders the wrapped component.

**Bridge / UI commands:**

The workspace has a typed pubsub bus (`events`, `postUiCommand`) for communication between the agent backend and the frontend. Use `events.on(workspaceEvents.xxx, handler)` on the front, and `postUiCommand(...)` from the server-side plugin to trigger panel opens, file navigation, etc.

**Surface resolver:**

A surface resolver maps an agent-emitted `SurfaceOpenRequest` (e.g. `{ kind: "open-series", seriesId: "GDPC1" }`) to a panel-open call. Register via a `type: "surface-resolver"` output with a `resolve(req) → SurfacePanelResolution | null` function.

### Vite alias convention

Apps that consume `@hachej/boring-workspace` from source for HMR (e.g. `apps/workspace-playground`) gate the source alias on a `BORING_USE_LOCAL_PACKAGES=1` env var. If you add a new `@hachej/boring-workspace/*` subpath import, add it to **both**:

- the app's `vite.config.ts` → `resolve.alias`
- `packages/workspace/package.json` → `exports` map (and rebuild workspace)

### TypeScript

Each package has its own `tsconfig.json`. Workspace has separate `tsconfig.front.json` and `tsconfig.server.json`. Run `pnpm typecheck` from root to check all. `moduleResolution: Bundler` is used throughout — subpath imports follow `package.json` exports.

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
