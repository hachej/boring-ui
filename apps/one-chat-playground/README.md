# one-chat-playground

**One Chat, One Screen.** One chat on the left, the user's app on the right.
Built for a non-technical user: the transcript shows messages only — no tool
calls, no reasoning — and the agent talks about the app, never about files.

Run: `pnpm -C apps/one-chat-playground dev` (builds deps, then boots everything).

Ports: front `5320` (`ONE_CHAT_PORT`), sample app `5321` (`SAMPLE_APP_PORT`);
the agent API binds an ephemeral port behind the front's `/api` proxy.

Remote viewing: set `HOST=0.0.0.0` and `ONE_CHAT_PUBLIC_HOST=<ip or hostname the browser uses>`
plus `ONE_CHAT_ALLOWED_ORIGINS=http://<that host>:*` so the app iframe and the
`show_on_screen` allowlist both use an address the viewer can reach.

Env: a model must be configured — `BORING_AGENT_DEFAULT_MODEL` (e.g.
`anthropic:claude-sonnet-4-5`) plus that provider's key (`ANTHROPIC_API_KEY`, …).
`ONE_CHAT_ALLOWED_ORIGINS` extends the `show_on_screen` allowlist beyond
loopback (comma separated origins; `https://host:*` wildcards the port only).
`BORING_AGENT_SESSION_ROOT` moves the chat transcripts off the app directory.
`ONE_CHAT_WORKSPACE_ROOT` points the agent at another copy of the app, so a
second instance can run without touching the one a live session is using.

The agent works in `sample-app/` (a tiny Vite + React "Clients" page) and its
edits appear live in the right-hand iframe via HMR. Two extra tools drive the
screen: `show_on_screen({url, title})` raises one sheet over the app,
`back_to_app()` drops it. On phones the app is full screen behind a floating
colleague button; chat snaps to half or full height, and browser Back closes it.

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
(agreed). Last kept: members-list (2026-09-15).` — recomputed only when one of
them changes, never per turn.

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
reuses the ask-user plugin's tool, runtime and file store by deep import; the
plugin's published entry point is bound to the Workspace shell, which this app
does not have. The card is opted in through `messagesOnlyVisibleTools` on
`PiChatPanel`, which is empty for every other host. This app also opts out of
message copy actions and replaces the generic composer working pill with its
user-waiting activity strip; both package defaults remain unchanged.

## Agent packages and skills

Each seat is a package under `agents/<seat>/`: `package.json#boring.agent`
owns its identity and `instructionsRef`, while the package's top-level `tools`
array names trusted host capability groups. Startup rejects unknown groups.
The colleague receives `intents`, `instructions`, `stage`, `ask_user`,
`run_agents`, `reload`, and `compact`; the builder receives none; the
documenter receives only the two `instructions` tools.

Platform skills live under the owning package's `skills/`. The colleague also
sees skills shipped in the user's workspace; ambient discovery stays off.
Check what loaded with `GET /api/v1/agents/default/skills`.

The desktop chat includes a 40px sun/moon control. An explicit choice is kept
in local storage; with no choice, the page leaves `data-theme` unset and follows
the system palette. Phones follow the system theme without showing the control.

Out of scope in this cut: sandboxing (the agent runs in `direct` mode on the
host), the Keep loop, git hiding, auth, and any workspace/Dockview shell.

The standard app a user's agent builds on lives in `template-app/` (TanStack Start + SQLite/Drizzle + shadcn; `bash template-app/verify.sh`).

## On-demand behavior eval

`pnpm -C apps/one-chat-playground eval` runs the cases in `eval/cases.yaml` against the real host through its HTTP API. The runner restarts the host on ports 5360/5361 for each fresh workspace, prints pass/fail results, and writes a JSON report under `eval/reports/`. Use `--case <name>` for one case or `--keep` to retain its `.eval-workspaces/` copy. This spends model tokens and is intentionally not part of CI.
