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
`back_to_app()` drops it.

## What the agent remembers

Three plain Markdown files in the user's app, and nothing else:

- `agent/intents/<slug>.md` — one track of work. First line `status:
  proposed|agreed|building|kept|undone`, then timestamped entries, then a
  `## What we agreed` section once the user has said yes.
- `docs/CHANGES.md` — append-only, one line per kept change or undo.
- `docs/PRODUCT.md` — what the app is today, rewritten in place.

Five tools write them: `open_intent`, `note_intent`, `agree_intent`,
`set_intent_status`, `record_change`. The dynamic prompt carries one generated
line built from those files — `Where we are: active intent track-invoices
(agreed). Last kept: members-list (2026-09-15).` — recomputed only when one of
them changes, never per turn.

## Asking the user

`ask_user` blocks the turn until the user answers. The question appears inline
in the transcript as a card (buttons for a choice, a small input otherwise) and
the composer is blocked until it is answered — no pane, no inbox. The server
reuses the ask-user plugin's tool, runtime and file store by deep import; the
plugin's published entry point is bound to the Workspace shell, which this app
does not have. The card is opted in through `messagesOnlyVisibleTools` on
`PiChatPanel`, which is empty for every other host.

## Skills

`sample-app/.pi/skills/` ships with the app and is the only skill root the
agent sees (ambient discovery stays off). It holds the Boring PM interview
skill plus `ONE-CHAT.md`, which adapts the method to one chat. Check what
loaded with `GET /api/v1/agents/default/skills`.

Out of scope in this cut: sandboxing (the agent runs in `direct` mode on the
host), the Keep loop, git hiding, auth, and any workspace/Dockview shell.

The standard app a user's agent builds on lives in `template-app/` (TanStack Start + SQLite/Drizzle + shadcn; `bash template-app/verify.sh`).
