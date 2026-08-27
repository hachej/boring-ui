# Spike: Boring UI vs BuilderIO Agent-Native

Date: 2026-07-15

## Executive summary

BuilderIO `agent-native` and Boring UI are aiming at the same category: applications where humans and agents operate through shared product primitives instead of a chatbot bolted onto a traditional SaaS UI.

The biggest difference is the primary abstraction:

- **Agent-Native:** `defineAction()` is the center. One typed action fans out to UI hooks, agent tools, HTTP, MCP, A2A, and CLI over SQL-backed application state.
- **Boring UI:** the **agent-controlled workbench + plugin/bridge model** is the center. Pi provides the agent harness; Boring adds chat, workspace UI, files, panels, surface resolvers, tools, local/hosted runtime, and hot-loadable UI/agent plugins.

Agent-Native is stronger as a single-app, action-first product framework. Boring UI is stronger as a local-first extensible agent workbench and plugin shell, especially for agent-driven UI surfaces, files, sandboxes, and Pi ecosystem reuse.

## What Agent-Native is

From the public repo/docs, BuilderIO/agent-native is a TypeScript/React framework for building agent-first apps. Its core idea is: define operations once as typed actions, then expose those same operations to humans, agents, protocols, and automation.

Key pieces:

- **Shared SQL state** via Drizzle; local SQLite by default, production SQL via `DATABASE_URL`.
- **`defineAction()`** as the core unit with schemas, runtime validation, approval/audit options, and execution context.
- **Cross-surface action exposure:** React hooks, imperative calls, HTTP endpoints, agent tools, MCP, A2A, and CLI.
- **Agent UI components:** sidebars, panels, chat surfaces, prompt composer, conversation components, native result widgets.
- **BYO runtime connectors:** OpenAI, Claude Agent SDK, Vercel AI SDK, AG-UI, normalized HTTP.
- **Deployment assumptions:** Node 22+, pnpm, Nitro, React, SQL, Drizzle.

Signals: active, popular, but young/pre-1.0. Research found `@agent-native/core@0.101.5`, repo created 2026-03-12, \~3.7k stars, active releases/pushes as of 2026-07-15.

## What Boring UI is

Boring UI is an opinionated framework for agent-centric apps built on Pi. Its public framing is that agent apps collapse into two surfaces:

- **Chat** — tell the agent what to do.
- **Workbench** — inspect, steer, and refine results.

Relevant repo points:

- `README.md` positions the framework around a web frontend, web backend, Pi harness, and sandbox.
- `docs/README.md` maps packages including `@hachej/boring-core`, `@hachej/boring-agent`, `@hachej/boring-workspace`, CLI, and plugin tooling.
- `docs/WORKSPACE_CONTRACT.md` defines how agent and workspace compose without importing each other directly.
- `packages/workspace/docs/PLUGIN_SYSTEM.md` defines the two-tier trusted/internal and runtime/generated plugin model.
- `packages/agent/docs/README.md` defines direct/local/microVM runtime modes, workspace and sandbox abstractions.

Core abstractions:

- `AgentTool` with JSON-schema parameters and execution context.
- `Workspace` filesystem abstraction shared by frontend and agent tools.
- `Sandbox` abstraction for direct/local/microVM execution.
- `UiBridge.postCommand()` for opening files, panels, surfaces, notifications, and navigation.
- Front plugins: panels, commands, catalogs, providers, surface resolvers.
- Server plugins: Pi resources, skills, prompts, agent tools, bridge handlers, routes, provisioning.

## Comparison matrix


| Dimension            | Agent-Native                                                 | Boring UI                                                                               | Takeaway                                                                                                  |
| -------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Primary abstraction  | Typed `defineAction()`                                       | Chat + workbench + plugin/UI bridge                                                     | Agent-Native has a clearer single primitive for business operations. Boring has a richer workspace shell. |
| State model          | SQL-first app state                                          | Workspace/files + optional core Postgres/full app state                                 | Agent-Native wins durable app-data convergence; Boring wins file/workspace-native workflows.              |
| Agent/runtime        | Built-in agent framework with runtime connectors             | Pi harness with direct/local/sandbox/microVM modes                                      | Boring benefits from Pi extensibility and coding-agent maturity.                                          |
| UI model             | React agent components and generated/native widgets          | Dock/workbench panels, files, surfaces, catalogs, UI commands                           | Boring is more IDE/workbench-oriented; Agent-Native is more app/action-oriented.                          |
| Tool/action parity   | Strong: one action exposes UI/agent/HTTP/MCP/A2A/CLI         | Partial: shared APIs/tools/bridge, but no single universal action primitive             | This is the main gap Boring should study.                                                                 |
| Protocols            | MCP and A2A are first-class                                  | Pi tools/skills/extensions; MCP/A2A not identified as first-class framework surfaces    | Agent-Native is ahead for external-agent interoperability.                                                |
| Plugins/extensions   | Framework/app templates and extension surfaces               | Strong Pi-compatible plugin system plus Boring UI panels/catalogs/surface resolvers     | Boring is ahead for local/generated plugin UX.                                                            |
| Local-first adoption | Has local dev, SQL-backed                                    | Very strong: `npx @hachej/boring-ui-cli`, no DB/auth local mode                         | Boring has lower-friction local workspace start.                                                          |
| Governance           | Approval/audit on actions; production code execution guarded | Plugin trust boundaries documented; runtime plugins trusted local; sandbox abstractions | Agent-Native has stronger operation-level governance; Boring has clearer plugin/runtime boundaries.       |
| Maturity risk        | Active but pre-1.0 and fast-moving                           | Also early (`0.1.86`) but with repo-local normative docs/tests                          | Both are young. Agent-Native has public momentum; Boring has deeper internal quality gates.               |


## Where Agent-Native is better

1. **Unified operation contract.** `defineAction()` is a compelling primitive: one operation powers UI, agent, HTTP, CLI, MCP, and A2A. Boring currently has tools, bridge commands, plugins, routes, and workspace APIs, but not one obvious business-action source of truth.
2. **SQL-backed product state as first-class context.** Agent-Native's default is durable app data that both humans and agents mutate. Boring is excellent for files/workspaces, but the product-data story is less central in the framework surface.
3. **External agent/protocol readiness.** MCP/A2A being first-class makes Agent-Native attractive for interoperability.
4. **Operation governance.** Approval/audit metadata lives next to the action definition. Boring has sandbox/plugin trust choices, but not the same action-level audit/approval primitive.
5. **Clear conceptual pitch.** “Define an action once, use it everywhere” is easier to explain than Boring's richer but more distributed shell/plugin/bridge model.

## Where Boring UI is better

1. **Workbench-first interaction.** Boring already treats the UI as something the agent can inspect and control via bridge commands, files, panels, and surfaces. That is a stronger IDE/workspace metaphor than a generic sidebar.
2. **Pi ecosystem reuse.** Pi prompts, skills, tools, slash commands, and packages work naturally inside Boring UI.
3. **Local-first CLI.** Boring's no-auth/no-DB local mode is a major adoption advantage for workspace/coding/data apps.
4. **Plugin development model.** Runtime/generated `.pi/extensions` plus trusted internal plugins give Boring a strong customization story.
5. **Execution/sandbox abstraction.** Direct, local sandbox, and microVM modes are explicit and aligned with agent work on files and commands.
6. **Package separation.** Agent and workspace compose through the app shell instead of importing each other, which is good for embedding and reuse.

## Strategic recommendations

### 1. Add a Boring “Action” primitive, but do not clone Agent-Native wholesale

Boring should consider a small typed operation primitive that can back:

- agent tools,
- UI forms/buttons,
- command palette actions,
- HTTP routes,
- audit/approval metadata,
- maybe MCP later.

This should complement, not replace, Pi tools and the UI bridge. The goal is to make business/product operations first-class while keeping the workbench/plugin model intact.

### 2. Make action parity part of the public pitch

Boring already says the agent and frontend share primitives. Make that more concrete:

- shared file API,
- shared UI surface API,
- shared plugin catalog,
- proposed shared action API.

Agent-Native's pitch is easier to understand today; Boring can close that gap with docs and examples.

### 3. Treat SQL product state as an optional track, not the foundation

Agent-Native's SQL-first stance is powerful, but Boring's local-first file/workspace stance is a differentiator. The existing `full-app` already provides the optional hosted/Postgres track for auth, users, multi-workspace membership, invites, settings, runtime handles, durable Pi sessions, and production deployment. The #391 plan goes further: workspace-first agent runs, content-addressed `AgentDefinition`/`AgentDeployment`, multi-agent Docker delivery, managed MCP ingress, shareable artifacts, and a future one-contract task/transport model.

So the “optional durable hosted state” gap is mostly covered by `full-app` + #391. The remaining Agent-Native gap is narrower and sharper: Boring still lacks a single `defineAction()`-style business-operation primitive that can be declared once and projected consistently into UI controls, agent tools, HTTP/API, CLI, MCP/A2A, audit, and approval metadata.

### 4. Investigate MCP/A2A exposure from Boring plugins/tools

If Boring can expose selected Pi tools, Boring actions, and surface resolvers through MCP/A2A, it would get Agent-Native's interoperability advantage without abandoning Pi.

### 5. Strengthen governance around plugin/action execution

Current plugin docs are clear that generated/runtime plugins are trusted local code and not marketplace-safe. Next useful steps:

- operation-level `needsApproval`, `readOnly`, `parallelSafe`, `audit` metadata,
- per-tool/plugin permission manifests,
- visible audit trail for agent-triggered UI/tool actions,
- clearer production defaults for code execution and external calls.

## Suggested follow-up experiments

1. **Prototype `defineBoringAction()`** in one plugin: expose it as a Pi tool, command palette action, HTTP route, and UI form.
2. **Map a real Boring plugin** to Agent-Native's action model and identify duplicated route/tool/UI code.
3. **Add an MCP export spike** for a small set of Boring/Pi tools.
4. **Write a public comparison/positioning doc**: “Boring UI is the agent workbench; Agent-Native is the action-first app framework.”
5. **Run Agent-Native locally** and build the same tiny app in both frameworks to compare ergonomics, generated code, and runtime behavior.

## Bottom line

Agent-Native should be treated as a serious reference architecture, especially for its unified action model and SQL-backed human/agent state convergence. Boring should not pivot to become Agent-Native. Its strongest differentiation is the Pi-powered workbench, plugin system, local-first CLI, and sandboxed workspace runtime.

The best path is to borrow the **single typed operation** idea and protocol/governance surfaces while preserving Boring's workbench-first, plugin-first identity.

## Sources consulted

Internal repo:

- `README.md`
- `docs/README.md`
- `docs/WORKSPACE_CONTRACT.md`
- `packages/agent/docs/README.md`
- `packages/agent/docs/KNOWN_LIMITATIONS.md`
- `packages/workspace/docs/README.md`
- `packages/workspace/docs/PLUGIN_SYSTEM.md`
- `packages/agent/src/shared/tool.ts`
- `packages/agent/src/shared/workspace.ts`
- `packages/agent/src/shared/sandbox.ts`
- `packages/workspace/src/shared/ui-bridge.ts`
- `packages/workspace/src/server/plugins/defineServerPlugin.ts`

External:

- [https://github.com/BuilderIO/agent-native](https://github.com/BuilderIO/agent-native)
- [https://www.agent-native.com/docs/key-concepts](https://www.agent-native.com/docs/key-concepts)
- [https://www.agent-native.com/docs/actions](https://www.agent-native.com/docs/actions)
- [https://www.agent-native.com/docs/components](https://www.agent-native.com/docs/components)
- [https://www.agent-native.com/docs/agent-surfaces](https://www.agent-native.com/docs/agent-surfaces)
- [https://www.agent-native.com/docs/database](https://www.agent-native.com/docs/database)
- [https://www.agent-native.com/docs/deployment](https://www.agent-native.com/docs/deployment)
- [https://www.builder.io/blog/agent-native-architecture](https://www.builder.io/blog/agent-native-architecture)

