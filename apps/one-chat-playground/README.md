# one-chat-playground

**One Chat, One Screen.** Each app has one folder, one URL, and one pinned
conversation. A narrow host-owned rail switches apps; chat owns the workspace
until the colleague deliberately shows an app or page on screen. The transcript
shows messages only — no tool calls or reasoning.

Run: `pnpm -C apps/one-chat-playground dev` (builds deps, then boots everything).

Ports: front `5320` (`ONE_CHAT_PORT`); app servers use the inclusive
`ONE_CHAT_APP_PORT_RANGE` (default starts at `SAMPLE_APP_PORT=5321` and reserves
nine ports). The agent API binds an ephemeral port behind the front's `/api`
proxy.

Chat follows the same three-rung presence ladder on both screen sizes. On phones
it moves between button, half sheet, and full sheet. On desktop it moves between
a bottom composer bar, a draggable chat window, and the docked left column; each
app remembers its desktop rung, while replies and pending question cards may
only raise the chat when they need room.

Remote viewing: set `HOST=0.0.0.0` and `ONE_CHAT_PUBLIC_HOST=<ip or hostname the browser uses>`
plus `ONE_CHAT_ALLOWED_ORIGINS=http://<that host>:*` so the app iframe and the
`show_on_screen` allowlist both use an address the viewer can reach.

Env: a model must be configured through the standard Boring Agent model env.
`ONE_CHAT_APPS_ROOT` defaults to `.workspaces/` and contains `apps.json` plus one
folder per slug. `ONE_CHAT_APP_URL` may use `{slug}` and `{port}` placeholders,
for example `https://{slug}.apps.example.test:{port}/`; without placeholders its
port is replaced for compatibility. `ONE_CHAT_ALLOWED_ORIGINS` extends the
screen allowlist beyond loopback. Path-based deployments set
`ONE_CHAT_APP_BASE=/app/{slug}/` and an absolute `ONE_CHAT_APP_URL` with the same
slug placeholder; the deployment proxy resolves each slug through `apps.json`.
`BORING_AGENT_SESSION_ROOT` remains host data and must live outside app folders.

`POST /api/one-chat/apps` materializes `template-app/` through the selected
runtime adapter, then runs the frozen install, `db:push`, and the Vite server
through that adapter's sandbox. In direct mode those commands are ordinary
local child processes rooted in the app folder; swapping to local/bwrap keeps
the host code unchanged. The registry restarts failed servers and aborts them
with the host. `apps.json` alone remains explicit host control-plane state.

Legacy migration: `ONE_CHAT_WORKSPACE_ROOT=/path/to/old-app` is copied once to
`<ONE_CHAT_APPS_ROOT>/default` and recorded as the `default` app. If the legacy
variable points at the apps root itself (the owner's existing `.workspaces`
shape), valid child app folders such as `julien-app/` are discovered in place
instead of recursively copied. Keep `apps.json` after first boot; it owns stable
ports.

The frontend sends `x-one-chat-app: <slug>`. One Agent Host turns that header
into an `AuthorizedAgentScope`; its existing runtime-scope resolver binds the
workspace root, session namespace, tools, mtime-checked prompt cache, stage bus,
and builder lock for that app. This request-scoped seam avoids parallel gateway
implementations while preserving strict per-app runtime state. The app keeps a
separate browser-pinned session id per slug.

Screen tools are `show_on_screen({what: "app" | "page", url?, title?})`,
`back_to_app()` (show live app), and `clear_screen()` (return to full-width
chat); `show_previous_version()` is the explicit not-yet-available stub. On
phones chat is home; after a screen is shown, the existing
button/half/full chat sheet takes over and browser Back closes it. A narrow SSE
adapter subscribes to the public in-memory `UiBridge`; every stage effect enters
through `UiBridge.postCommand` without mounting the Workspace shell.

## What the agent remembers

Three plain Markdown files in the user's app, and nothing else:

- `agent/intents/<slug>.md` — one track of work. First line `status:
proposed|agreed|sketched|building|built|kept|undone`, then timestamped entries, then a
  `## What we agreed` section once the user has said yes.
- `docs/CHANGES.md` — append-only, one line per kept change or undo.
- `docs/PRODUCT.md` — what the app is today, rewritten in place.

Five memory tools write them: `open_intent`, `note_intent`, `agree_intent`,
`set_intent_status`, `record_change`. Two host tools start isolated work:
`run_builder` and `run_documenter`. The dynamic prompt carries one generated
line built from those files — `Where we are: active intent track-invoices
(agreed). Last kept: members-list (2026-09-15).` Before each turn, adapter
`stat` calls compare tracked mtimes; the prompt is rebuilt only after a change.

## Fresh builder and documenter

The user speaks only with the pinned `default` colleague. Once an intent is
agreed, the host compacts that conversation and `run_builder` starts a fresh
`builder` session in the same workspace. A `mockup` stage writes one static
page under `public/mockups/` and marks the intent `sketched`; after the user
keeps it, the `build` stage matches that sketch and marks the intent `built`.
Moment-sized tweaks are edited directly in the live workspace and never start a
builder. Work that needs real building is sketched first. Only one builder may
run at a time. At agent-end the host records the builder's final text and prompts the live
colleague. Completed builds start a fresh `documenter` to update
`docs/CHANGES.md` and `docs/PRODUCT.md`. Neither child's transcript is shown
to the user.

## Asking the user

`ask_user` blocks the turn until the user answers. The question appears inline
in the transcript as a card (buttons for a choice, a small input otherwise) and
the composer is blocked until it is answered — no pane, no inbox. The server
reuses the ask-user plugin's tool, runtime and file store through its public
`./server` and `./shared` package surfaces. The card is opted in through
`messagesOnlyVisibleTools` on
`PiChatPanel`, which is empty for every other host. This app also opts out of
message copy actions and replaces the generic composer working pill with its
user-waiting activity strip; both package defaults remain unchanged.

## Agent packages and skills

Each seat is a package under `agents/<seat>/`: `package.json#boring.agent`
owns its identity and `instructionsRef`, while the package's top-level `tools`
array names trusted host capability groups. Startup rejects unknown groups.
The colleague receives `intents`, `instructions`, `stage`, `ask_user`,
`run_agents`, `self_tools`, and `compact`; the builder receives none; the
documenter receives only the two `instructions` tools. User-made tools are a
validated `agent/tools/<name>.json` manifest plus a matching TypeScript script;
the host registers only the manifest while execution stays in the sandbox.
Platform skills live under the owning package's host-side `skills/` directory;
ambient workspace discovery stays off.

The desktop chat includes a 40px sun/moon control. An explicit choice is kept
in local storage; with no choice, the page leaves `data-theme` unset and follows
the system palette. Phones follow the system theme without showing the control.

The trusted host defaults to direct mode and keeps ambient executable
extensions disabled (`noExtensions: true`): app-authored code is never loaded
into the host process. Declarative workspace tools require an isolated provider
by default; set `BORING_AGENT_MODE=local` for bwrap. The eval runner alone opts
into unisolated direct-tool execution explicitly so the same contract can be
exercised in both modes. Out of scope in this cut: the Keep loop, git hiding,
auth, and any workspace/Dockview shell.

The standard app a user's agent builds on lives in `template-app/` (TanStack Start + SQLite/Drizzle + shadcn; `bash template-app/verify.sh`).

## On-demand behavior eval

`pnpm -C apps/one-chat-playground eval` runs the cases in `eval/cases.yaml` against the real direct-mode host through its HTTP API. `eval:bwrap` runs the same table with the local/bwrap adapter. The runner restarts the host on ports 5430/5431 for each fresh workspace, prints pass/fail results, and writes a JSON report under `eval/reports/`. Use `--case <name>` for one case or `--keep` to retain its `.eval-workspaces/` copy. This spends model tokens and is intentionally not part of CI.
