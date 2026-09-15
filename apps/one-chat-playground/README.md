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

The agent works in `sample-app/` (a tiny Vite + React "Clients" page) and its
edits appear live in the right-hand iframe via HMR. Two extra tools drive the
screen: `show_on_screen({url, title})` raises one sheet over the app,
`back_to_app()` drops it.

Out of scope in this cut: sandboxing (the agent runs in `direct` mode on the
host), the Keep loop, git hiding, auth, and any workspace/Dockview shell.

The standard app a user's agent builds on lives in `template-app/` (TanStack Start + SQLite/Drizzle + shadcn; `bash template-app/verify.sh`).
