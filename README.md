# boring-ui

![MIT License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)
![npm version](https://img.shields.io/npm/v/@boring/core?style=flat-square&label=npm)

Your workflow. Your agent. Your UI.

Build agent-centric apps without reinventing the shell.
﻿
﻿<img width="509" height="469" alt="grafik" src="https://github.com/user-attachments/assets/382084d1-a78c-4374-b51c-fb33b25243e2" />

## What it is

Two primitives, pre-wired:

- one agent chat
- one workbench (panels + command palette) that the agent can control

Plus everything you don't want to build: auth, database, workspaces, multi-tenancy.

## Extend with plugins

Plugins are how you make it yours. A plugin contributes:

- **panels** — custom panes the agent or user can open (charts, tables, viewers, forms)
- **agent** skills and tools
- **catalogs** — searchable data explorers, usable from chat

<img width="537" height="307" alt="grafik" src="https://github.com/user-attachments/assets/29dfbee6-1f4e-448d-8eb5-d90b55bceb49" />

Enough to map any workflow.

## Quickstart

```bash
npx @hachej/boring-ui-cli
```
Full workspace — chat, panels, agent runtime running on your local files.

## What people build

**Data exploration tools** — agent searches a 87k-series catalog, plots results, drafts a briefing deck. All from chat.

**Internal ops tools** — agent runs bash in a sandbox. Panels show logs, metrics, status. Teams get isolated workspaces.

**Research assistants** — catalog of papers or data. Agent fetches and summarizes. Panels show the full content. Markdown editor for notes.

---

## Right for you if

- ✅ You want the agent to open panels and render data — not just chat
- ✅ You're building domain-specific: research tool, internal tool, data app
- ✅ You need sandboxed execution and multi-tenant workspaces

Not right for you if:

- ❌ You just need a chat widget to embed somewhere
- ❌ You need to drop an agent into an existing app or custom frontend

---

## Writing a plugin

Boring-ui ships with its documentation embedded.

Just ask the agent to build it for you.

Done.

---

MIT
