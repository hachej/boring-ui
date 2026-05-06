# boring-ui

<p align="center">
  <a href="https://github.com/hachej/boring-ui/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="MIT License" /></a>
  <a href="https://www.npmjs.com/package/@boring/core"><img src="https://img.shields.io/npm/v/@boring/core?style=flat-square&label=npm" alt="npm version" /></a>
  <a href="https://github.com/hachej/boring-ui/stargazers"><img src="https://img.shields.io/github/stars/hachej/boring-ui?style=flat-square" alt="GitHub Stars" /></a>
  <a href="https://github.com/hachej/boring-ui/actions"><img src="https://img.shields.io/github/actions/workflow/status/hachej/boring-ui/ci.yml?style=flat-square" alt="CI" /></a>
</p>

**Turn an agent into an app.**

Most agents ship behind a bare chat window — outputs arrive as text, users copy-paste results, nothing persists. boring-ui gives your agent a real app: a dynamic workspace that opens the right view for whatever it produces — a chart, a document, a data explorer, a code file — alongside the full backend you'd have to build anyway.

The frontend gives the agent a persistent chat and a workspace where outputs appear as purpose-built views, not walls of text. The backend gives it auth with workspaces, a database, and a runtime that executes real tools. You extend everything through plugins — add your views, your commands, your data sources — and ship something that feels built for your users, not borrowed from a general-purpose tool.

One decision it makes easy: **local vs. remote execution**. Tools like Claude Code run the agent on the user's machine — fine for a solo developer, a security and collaboration nightmare the moment you're shipping to a team or to customers. boring-ui's sandbox mode gives every user an isolated remote environment: no local setup, no shared state, no blast radius. Auth and workspaces are built in, so collaboration is first-class from day one. Same codebase as local mode, config change only.

Skip the scaffolding. Build something worth using.

---

## boring-ui is right for you if

- ✅ You have an agent and want to give it a real interface — not just a chat box
- ✅ You're building something domain-specific: a research tool, an internal tool, a data app, a coding assistant
- ✅ You want auth, workspaces, and a database without building them from scratch
- ✅ You want users to see charts, documents, or data explorers — not walls of text
- ✅ You're shipping to a team or customers and need sandboxed remote execution, not local installs
- ✅ You want to stay on the core and extend through plugins, without maintaining a framework fork

**boring-ui is not right for you if:**
- ❌ You just need a chat widget to embed in an existing app
- ❌ You already have auth, a backend, and just want a UI component
- ❌ You need Next.js, Remix, or a specific stack — boring-ui is opinionated (Fastify, Postgres, React)

---

```
Without boring-ui                       With boring-ui

┌──────────────────────────┐            ┌──────────────────────────┐
│       your domain        │            │       your domain        │
├──────────────────────────┤            ├──────────────────────────┤
│  auth + workspaces       │            │                          │
│  agent runtime           │            │        boring-ui         │
│  chat interface          │            │                          │
│  dynamic workspace UI    │            │                          │
│  command palette         │            │                          │
│  database schema         │            │                          │
├──────────────────────────┤            ├──────────────────────────┤
│    Postgres · React      │            │    Postgres · React      │
└──────────────────────────┘            └──────────────────────────┘

       weeks of setup                        ship day one
```

---

## What it is

boring-ui is not a library you drop into an existing app. It's an opinionated full-stack foundation you build on — start from the reference app, add plugins for your domain, and ship without ever touching the core.

boring-ui is aggressively extensible so it doesn't have to dictate your domain. The core owns the bare minimum: a chat, a workspace shell, auth, a database, an agent runtime. Nothing domain-specific, nothing you'd want to swap out. All customization lives in plugins — your panels, your commands, your data catalogs, your sidebar tabs. The core never changes; you extend it.

**The core has no opinions about your domain:**

- No domain logic
- No opinionated views or layouts beyond the shell
- No AI chrome — no model badges, no thinking spinners, nothing that makes your product look like a generic AI tool
- No hardcoded data sources, APIs, or integrations

Everything that makes your product yours lives in plugins. The example domain app (`boring-macro-v2`) shows what that looks like — a macro research tool that talks to FRED's 87k economic series, renders charts and data catalogs, and lets the agent generate briefing decks, all in ~400 lines of plugin code on top of an untouched core.

The reference app (`full-app`) is a working app you can start from today.

---

## Packages

| Package | What it does |
|---|---|
| `@boring/core` | Postgres + Drizzle schema, better-auth with workspace support, Fastify app factory, React app shell |
| `@boring/workspace` | Chat layout, panel registry, plugin system, file tree, IDE-style dockview shell |
| `@boring/agent` | Agent runtime with three execution modes — `direct` (in-process), `local` (full filesystem access), `vercel-sandbox` (isolated per-user sandbox) — plus a tool catalog (`bash`, `read`, `write`, `edit`, `grep`, …) |
| `@boring/ui` | Shared shadcn-style UI primitives |

---

## Plugin system

Plugins are the primary way to extend the workspace. A plugin contributes panels, commands, catalogs, and sidebar tabs. Everything is opt-in and composable.

```ts
import { defineFrontPlugin, definePanel } from "@boring/workspace"

export const myPlugin = defineFrontPlugin({
  id: "my-plugin",
  label: "My Plugin",
  systemPrompt: "You can open widgets with the 'open-widget' tool.",
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
    {
      type: "left-tab",
      // persistent sidebar tab
    },
    {
      type: "command",
      // command palette entry
    },
    {
      type: "catalog",
      // searchable data explorer with row selection
    },
  ],
})
```

Panels are auto-lazy: a zero-arg factory `() => import(...)` is code-split automatically. No `lazy: true` needed.

Pass the plugin to the shell:

```tsx
<WorkspaceAgentFront
  plugins={[myPlugin]}
  chatPanel={ChatPanel}
  workspaceId="my-app"
  appTitle="My App"
  apiBaseUrl=""
/>
```

---

## Quickstart

```bash
pnpm install
cp apps/full-app/.env.example apps/full-app/.env
pnpm --filter @boring/core drizzle:migrate
pnpm --filter full-app dev
```

Open `http://localhost:3000`.

---

## Server setup

```ts
import { createCoreApp, loadConfig } from '@boring/core/server'
import { registerAgentRoutes } from '@boring/agent/server'

const config = await loadConfig()
const app = await createCoreApp(config)
await app.register(registerAgentRoutes)
await app.listen({ port: config.port })
```

## Frontend setup

```tsx
import { BoringApp } from '@boring/core/front'
import { WorkspaceProvider, IdeLayout } from '@boring/workspace'

<BoringApp>
  <Route path="/" element={<WorkspaceProvider><IdeLayout /></WorkspaceProvider>} />
</BoringApp>
```

---

## Repo structure

```
packages/
  core/        → DB, auth, app factory, frontend shell
  workspace/   → Chat layout, panel registry, plugin system
  agent/       → Agent runtime + tool catalog
  ui/          → Shared UI primitives

apps/
  full-app/          → Reference app (start here, extend with plugins)
  boring-macro-v2/   → Domain example: macro research tool on FRED data
  agent-playground/  → Isolated agent runtime testbed
```

---

Built with TypeScript, React 19, Tailwind v4, Fastify, Drizzle, better-auth.
