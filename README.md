# boring-ui

<div align="center">
  <img src="https://github.com/hachej/boring-ui/raw/main/docs/banner.png" alt="boring-ui banner" width="800" />
</div>

<div align="center">

![MIT License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)
![npm version](https://img.shields.io/npm/v/@boring/core?style=flat-square&label=npm)

/>

**Your workflow. Your agent. Your UI.**

An agentic UI fully customizable for your workflow.

## Why boring?

The UI is exactly three things:

- one agent
- one workbench that the agent can control
- one command palette.

<img width="781" height="417" alt="grafik" src="https://github.com/user-attachments/assets/31ba4b15-21db-468f-862d-52538fb0dc7e" 

That's it. Make it fit your workflow by extending it: plug in custom agent skills and build your own workbench panes.

<img width="726" height="645" alt="grafik" src="https://github.com/user-attachments/assets/5d1475e6-2235-4b7d-99b6-d4f9eca1cfe9" />

## Quickstart

```bash
npx @hachej/boring-ui-cli
```

Starts the full workspace — chat, panels, agent runtime — pointed at your current directory. No clone, no install, no config.

---

## boring-ui is right for you if

- ✅ You have an agent and want to give it a real interface — not just a chat box
- ✅ You're building something domain-specific: a research tool, an internal tool, a data app, a coding assistant
- ✅ You want users to see charts, documents, or data explorers — not walls of text
- ✅ You're shipping to a team or customers and need sandboxed remote execution, not local installs

**boring-ui is not right for you if:**

- ❌ You just need a chat widget to embed in an existing app
- ❌ You already have auth, a backend, and just want a UI component
- ❌ You need Next.js, Remix, or a specific stack — boring-ui is opinionated (Fastify, Postgres, React)

---

## What it is

boring-ui is not a library you drop into an existing app. It's an opinionated full-stack foundation you build on — start from the reference app, add plugins for your domain, and ship without ever touching the core.

boring-ui is aggressively extensible so it doesn't have to dictate your domain.

The core owns the bare minimum: a chat, a workspace shell, auth, a database, an agent runtime.
