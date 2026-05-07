# boring-ui

![MIT License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)
![npm version](https://img.shields.io/npm/v/@boring/core?style=flat-square&label=npm)

Your workflow. Your agent. Your UI.

Think Claude Code — but for your domain. boring-ui is the full-stack foundation for agent-powered apps: chat, workbench, plugins, auth, database, sandboxed execution. Pre-wired. Just extend.

<p align="center"><img width="400" alt="grafik" src="https://github.com/user-attachments/assets/382084d1-a78c-4374-b51c-fb33b25243e2" /></p>

## Problems it solves

| Without boring-ui | With boring-ui |
|---|---|
| ❌ Wire up auth, DB, workspaces, and agent runtime from scratch — every time. | ✅ All included. Add plugins for your domain and ship. |
| ❌ Agent replies in chat. Users read walls of text instead of seeing data. | ✅ Agent opens panels. Charts, tables, viewers — rendered directly. |
| ❌ Non-technical teammates can't run your agent tools without asking you. | ✅ Deploy once, give them a workspace. They run workflows themselves. |

## Features

<table>
<tr>
<td align="center" width="33%">
<h3>🧩 Plugin system</h3>
Panels, catalogs, commands, agent tools. One plugin wires your domain in.
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
Auth, roles, invites built in. Teams get isolated workspaces out of the box.
</td>
<td align="center">
<h3>⚡ Command palette</h3>
Every panel, command, and catalog entry searchable from one place.
</td>
<td align="center">
<h3>🚀 Full-stack included</h3>
Fastify · Postgres · React · Drizzle. No glue code. Just extend.
</td>
</tr>
</table>

## What people build

**Data exploration tools** — agent searches a catalog, plots results, drafts a briefing deck. All from chat.

**Internal ops tools** — agent runs bash in a sandbox. Panels show logs, metrics, status.

**Research assistants** — agent fetches and summarizes. Panels show full content. Markdown editor for notes.

<p align="center"><img width="537" alt="grafik" src="https://github.com/user-attachments/assets/29dfbee6-1f4e-448d-8eb5-d90b55bceb49" /></p>

## Right for you if

- ✅ You want the agent to open panels and render data — not just chat
- ✅ You're building domain-specific: research tool, internal tool, data app
- ✅ You need sandboxed execution and multi-tenant workspaces

Not right for you if:

- ❌ You just need a chat widget to embed somewhere
- ❌ You need to drop an agent into an existing app or custom frontend

## Quickstart

```bash
npx @hachej/boring-ui-cli
```

Full workspace — chat, panels, agent runtime — no clone, no config.
