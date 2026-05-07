# boring-ui

![MIT License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)
![npm version](https://img.shields.io/npm/v/@boring/core?style=flat-square&label=npm)

Your workflow. Your agent. Your UI.

Build agent-centric apps without reinventing the shell.

Think Claude Code — agent + workbench, deeply integrated. boring-ui is how you build that for your domain.

Give non-technical users the power to run agent workflows — without writing code.
﻿
<p align="center"><img width="400" alt="grafik" src="https://github.com/user-attachments/assets/382084d1-a78c-4374-b51c-fb33b25243e2" /></p>

## Features

<table>
<tr>
<td align="center" width="33%">
<h3>🧩 Plugin system</h3>
Panels, catalogs, commands, agent tools. One plugin wires your domain into the shell.
</td>
<td align="center" width="33%">
<h3>🤖 Agent-controlled UI</h3>
The agent opens panels and renders data — not just replies in chat.
</td>
<td align="center" width="33%">
<h3>🔒 Sandboxed execution</h3>
Bash and code run in isolation. bwrap locally, Firecracker in production.
</td>
</tr>
<tr>
<td align="center">
<h3>🏢 Multi-tenant workspaces</h3>
Auth, roles, invites — built in. Teams get isolated workspaces out of the box.
</td>
<td align="center">
<h3>⚡ Command palette</h3>
Every panel, command, and catalog entry is searchable from one place.
</td>
<td align="center">
<h3>🚀 Full-stack included</h3>
Fastify · Postgres · React · Drizzle. No glue code, no config. Just extend.
</td>
</tr>
</table>

---

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

<p align="center"><img width="537" alt="grafik" src="https://github.com/user-attachments/assets/29dfbee6-1f4e-448d-8eb5-d90b55bceb49" /></p>

Enough to map any workflow.

## Quickstart

```bash
npx @hachej/boring-ui-cli
```
Full workspace — chat, panels, agent runtime running on your local files.

## How to use it

**Run it locally.** Your own agent app, on your own machine. No server, no deploy. Point it at your files and go.

**Ship a SaaS.** Deploy it, add your domain logic via plugins, charge users. Auth, workspaces, and multi-tenancy are already there.

**Deploy inside a company.** Let non-technical users build and run their own agent workflows — without writing code. You manage the stack, they own their workspaces.

---

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
