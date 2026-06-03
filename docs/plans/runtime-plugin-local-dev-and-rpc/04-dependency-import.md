# Runtime Plugin Dependency Import Plan

## Problem

Runtime plugin fronts can currently import only host singletons. That blocked useful UI packages
like `@hachej/boring-data-explorer` and caused workarounds.

## Goal

Let runtime plugins import **already-installed** frontend dependencies while preserving exactly one
React/workspace instance.

## Important simplification

V1 does **not** run `npm install` for plugin manifests.

First prove resolution + singleton correctness with dependencies already present in the workspace
or repo install. Package installation is a separate later feature.

## Non-goals

- No package-manager detection.
- No lockfile mutation.
- No install cache.
- No lifecycle-script policy.
- No arbitrary backend imports.

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

Everything else may resolve only if already installed and browser-safe.

## Code-quality requirement

Do not add more one-off branches inside `pluginFrontRuntime.ts`.

Current import rejection is spread across validation, Vite resolution, source loading, and support
URL rewriting. Add a dedicated import-policy/resolution module and make all paths use it.

## Tasks

- **D1.** Add singleton/dedupe tests that fail on duplicate React or workspace instance.
- **D2.** Extract runtime import policy from `pluginFrontRuntime.ts`.
- **D3.** Resolve already-installed bare imports through Vite while externalizing singletons.
- **D4.** Prove a runtime plugin can import `@hachej/boring-data-explorer` without dual React.

## Acceptance

- A plugin importing a non-singleton installed package renders.
- A plugin importing `@hachej/boring-data-explorer` renders.
- React hooks still use the host React instance.
- Workspace singleton identity is preserved.
- Node built-ins remain rejected.
- Uninstalled dependencies fail as normal missing dependency errors.
- No package install is attempted in this phase.
