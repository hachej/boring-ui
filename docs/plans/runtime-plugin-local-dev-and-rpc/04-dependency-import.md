# Runtime Plugin Dependency Import Plan

## Problem

Runtime plugin fronts can currently import only host singletons. That blocked useful UI packages
like `@hachej/boring-data-explorer` and caused workarounds.

## Goal

Let runtime plugins import frontend dependencies installed in the plugin's own package folder while preserving exactly one React/workspace instance.

## Pi-aligned simplification

Follow Pi's local extension dependency model:

```txt
.pi/extensions/my-plugin/
  package.json
  node_modules/        # created by npm/pnpm install run in this directory
  front/index.tsx
```

If a plugin needs `recharts`, the user/agent adds it to that plugin package and runs install in the plugin directory:

```bash
cd .pi/extensions/my-plugin
npm install recharts
# pnpm add recharts is also fine when the plugin author chooses pnpm
```

This deliberately matches Pi's behavior for local extensions:

- local extension/plugin folders may have their own `package.json`;
- the user/agent runs `npm install` in that folder;
- imports resolve from that folder's `node_modules`;
- `/reload` reloads resources but does **not** install missing packages.

Missing dependencies fail with clear diagnostics, ideally through `boring-ui-plugin verify <name>`:

```txt
Missing dependency: recharts
Run: cd .pi/extensions/my-plugin && npm install
```

This keeps local plugin authoring as simple as Pi: a trusted local dev machine, package-local dependencies, no hidden package-manager work during reload.

## Non-goals

- No auto-install during `/reload`.
- No package-manager detection in the loader.
- No host/root lockfile mutation by the loader.
- No install cache.
- No `boring-ui-plugin install` helper in this phase; the install command is just `npm install` in the plugin directory.
- No arbitrary backend imports from front code.

## Singleton contract

These remain host-provided and must never be bundled into a runtime plugin:

```txt
react
react-dom
react-dom/client
react/jsx-runtime
react/jsx-dev-runtime
@hachej/boring-workspace
@hachej/boring-workspace/plugin
@hachej/boring-workspace/events
```

Everything else may resolve only if installed under the plugin package (or otherwise resolvable from that plugin package root) and browser-safe.

## Code-quality requirement

Do not add more one-off branches inside `pluginFrontRuntime.ts`.

Current import rejection is spread across validation, Vite resolution, source loading, and support
URL rewriting. Add a dedicated import-policy/resolution module and make all paths use it.

## Tasks

- **D1.** Add singleton/dedupe tests that fail on duplicate React or workspace instance.
- **D2.** Extract runtime import policy from `pluginFrontRuntime.ts`.
- **D3.** Resolve plugin-local bare imports through Vite while externalizing singletons.
- **D4.** Add verify diagnostics for declared-but-missing plugin dependencies and forbidden singleton dependencies.
- **D5.** Prove a runtime plugin can import a package installed in `.pi/extensions/<plugin>/node_modules` without dual React.

## Acceptance

- A plugin importing a non-singleton package installed in its own package folder renders.
- React hooks still use the host React instance.
- Workspace singleton identity is preserved.
- Node built-ins remain rejected from front code.
- Declared-but-missing dependencies fail with clear diagnostics and an install hint.
- `react`, `react-dom`, and `@hachej/boring-workspace*` declared as plugin dependencies are rejected or warned as forbidden singleton deps.
- `/reload` never runs package install.
