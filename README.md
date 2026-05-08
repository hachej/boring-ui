# boring-ui

---

![MIT License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)

<img width="1818" height="865" alt="grafik" src="https://github.com/user-attachments/assets/6bb196de-1518-4f20-a603-6a5809552cf7" />

Traditional SaaS apps assume workflows are fixed.

But agents make workflows dynamic.

Instead of hardcoding every screen and interaction, boring-ui gives you a flexible workspace that agents can customize in real time.

Start with the core: one chat + one workbench (mini IDE):

![Workbench](https://github.com/user-attachments/assets/382084d1-a78c-4374-b51c-fb33b25243e2)And let your agent customize panes and how to visualize reports, data, files.

Think **Claude Co-op** — but for your domain, your workflow, your visuals.

AI agents already know how to generate code — boring-ui gives them a place to live inside your product.

![Agent modifying UI](https://github.com/user-attachments/assets/29dfbee6-1f4e-448d-8eb5-d90b55bceb49)## Problems it solves

| Without boring-ui | With boring-ui |
| --- | --- |
| ❌ Wire up auth, DB, workspaces, and agent runtime from scratch — every time. | ✅ All included. Add plugins for your domain and ship. |
| ❌ Agent replies in chat. Users read walls of text instead of seeing data. | ✅ Agent opens panels. Charts, tables, viewers — rendered directly. |
| ❌ Non-technical teammates can't run your agent tools without asking you. | ✅ Deploy once, give them a workspace. They run workflows themselves and customize their UI as they wish. |

## Features

<table style="min-width: 75px;">
<colgroup><col style="min-width: 25px;"><col style="min-width: 25px;"><col style="min-width: 25px;"></colgroup><tbody><tr><td colspan="1" rowspan="1" style="text-align: center;"><h3>🧩 Plugin system</h3><p>Panels, catalogs, commands, agent tools. One plugin wires your domain in.</p></td><td colspan="1" rowspan="1" style="text-align: center;"><h3>🤖 Agent-controlled UI</h3><p>The agent opens panels and renders data — not just replies in chat.</p></td><td colspan="1" rowspan="1" style="text-align: center;"><h3>🔒 Sandboxed execution</h3><p>Bash and code run in isolation. bwrap locally, Firecracker in production.</p></td></tr><tr><td colspan="1" rowspan="1" style="text-align: center;"><h3>🏢 Multi-tenant workspaces</h3><p>Auth, roles, invites built in. Teams get isolated workspaces out of the box.</p></td><td colspan="1" rowspan="1" style="text-align: center;"><h3>⚡ Command palette</h3><p>Every panel, command, and catalog entry searchable from one place.</p></td><td colspan="1" rowspan="1" style="text-align: center;"><h3>🚀 Full-stack included</h3><p>Fastify · Postgres · React · Drizzle. No glue code. Just extend.</p></td></tr></tbody>
</table>

## What people build

**Data exploration tools** — agent searches a catalog, plots results, drafts a briefing deck. All from chat.

**Internal ops tools** — agent runs bash in a sandbox. Panels show logs, metrics, status.

**Research assistants** — agent fetches and summarizes. Panels show full content. Markdown editor for notes.

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
