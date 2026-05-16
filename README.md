

# Boring UI

Bring your agent skills. Get a UI.



<img src="https://github.com/user-attachments/assets/6bb196de-1518-4f20-a603-6a5809552cf7" alt="Boring UI banner" width="350" />

![MIT License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)

Boring UI is a framework for building apps around an agent.

Traditional SaaS is built around workflows users drive by hand: buttons, forms, pages, and dashboards.

Agents change that.

When software can understand intent and do the work, the UI can collapse into two core surfaces:

- **chat** to tell the agent what to do
- **a workbench** to inspect, steer, and refine the result

Boring UI gives you that structure out of the box. See [Boring UI Core](#boring-ui-core).

Everything else comes through the [Plugin System](#plugin-system): skills, tools, and domain-specific panels.

You bring the intelligence. Boring UI brings the workspace.

## Quickstart

```bash
npx @hachej/boring-ui-cli
```

This starts a full agent workspace in your current directory: chat, panels, file tree, and command palette.

No clone. No database. No app setup.

For agent authentication options, see Pi's [Quick Start](https://github.com/badlogic/pi-mono/tree/main/packages/pi-coding-agent#quick-start) and [Providers docs](https://github.com/badlogic/pi-mono/blob/main/packages/pi-coding-agent/docs/providers.md).

## Boring UI Core

Boring UI is opinionated at the center.

Its default shape is simple:

- chat is the control surface
- the workspace is the output surface and is controllable by the agent

Boring UI ships as five packages:


| Package                    | Role                                                   | Demo app                    |
| -------------------------- | ------------------------------------------------------ | --------------------------- |
| `@hachej/boring-agent`     | Agent runtime, chat UI, tools, and sandboxed execution | `apps/agent-playground`     |
| `@hachej/boring-workspace` | Workbench UI, plugins, layouts, and UI bridge          | `apps/workspace-playground` |
| `@hachej/boring-core`      | App shell, auth, config, and persistence               | `apps/full-app`             |
| `@hachej/boring-ui-cli`    | Zero-setup way to run a full agent workspace locally   | `npx @hachej/boring-ui-cli` |
| `@hachej/boring-ui-kit`    | Shared UI kit and reusable interface primitives        | -                           |


## Built on Pi

Boring UI uses [Pi](https://github.com/earendil-works/pi/tree/main) as its agent harness.

Pi provides the core agent runtime: the agent loop, tool calling, sessions, skills, and prompt system.

Boring UI turns that runtime into an app:

- a web chat and workbench UI
- sandboxed agent execution, locally with `bwrap` or remotely with Vercel Sandboxes

## Plugin System

Boring UI relies on Pi's plugin infrastructure.

Plugins are standard Node packages, distributed through npm, and loaded by Pi.

Pi handles the agent-side customization: skills, prompts, tools, and system-prompt extensions.

Boring UI adds the workbench layer on top: panels, commands, catalogs, and other UI surfaces the agent can control.

Package plugin shape is:

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "type": "module",
  "keywords": ["pi-package"],
  "pi": {
    "extensions": ["agent/index.ts"],
    "skills": ["agent/skills"],
    "prompts": ["agent/prompts"]
  },
  "boring": {
    "label": "My Plugin",
    "front": "front/index.tsx",
    "server": "server/index.ts",
    "derivesFrom": ["optional-parent-plugin"]
  }
}
```

`pi` is the standard Pi package manifest, so any Pi package can be loaded as-is. `boring` adds the UI and workspace layer on top.

Common use cases:

- Need agent skills? Add them under `pi.skills`.
- Need agent prompts ? Add them under `pi.prompts`.
- Need agent-side tools ? Add them under `pi.extensions`.
- Need workbench panels ? Point `boring.front` to your front plugin.
- Need server-side tools or routes? Point `boring.server` to your server plugin.
- Need to layer on top of another plugin? Use `boring.derivesFrom`.

Boring UI gives you the structure. Plugins make it yours.

## Architecture

Boring UI core is built around a small set of swappable interfaces.

The key abstractions are:

| Interface | Package | Responsibility |
| --- | --- | --- |
| `Workspace` | `@hachej/boring-agent` | Filesystem operations |
| `Sandbox` | `@hachej/boring-agent` | Shell execution |
| `AgentHarness` | `@hachej/boring-agent` | Agent runtime |
| `UiBridge` | `@hachej/boring-workspace` | Agent-to-UI control |


Those interfaces fit together like this:

```text
chat UI
  -> AgentHarness
  -> ToolCatalog
  -> Workspace + Sandbox

agent/server actions
  -> UiBridge
  -> workbench UI

session history
  -> SessionStore
```

A few important rules follow from that design:

- `Workspace` is the single filesystem interface. Agent tools and frontend file routes both use it.
- `Sandbox` is only for execution. `Workspace` is for file operations.
- `AgentHarness` does not know about files or shells directly. It only sees tools.
- Runtime modes (`direct`, `local`, `vercel-sandbox`) swap the `Workspace` + `Sandbox` pair, not the rest of the system.
- `UiBridge` is how the agent opens files, panels, surfaces, and other workbench UI.

At a package level:

- `@hachej/boring-agent` owns the harness, tools, workspace, and sandbox contracts
- `@hachej/boring-workspace` owns the workbench UI, plugin outputs, and UI bridge
- `@hachej/boring-core` owns auth, config, persistence, and app-shell concerns
- `@hachej/boring-ui-kit` provides shared UI primitives across the stack
- `@hachej/boring-ui-cli` packages the whole thing into a zero-setup entrypoint

## Reference apps

The repo ships three reference apps:

- `apps/full-app`
- `apps/agent-playground`
- `apps/workspace-playground`

Useful commands for the full reference app:

```bash
pnpm --filter full-app dev
pnpm --filter full-app build
pnpm --filter full-app start
pnpm --filter full-app e2e:smoke
```

More: `apps/full-app/README.md`

## License

MIT