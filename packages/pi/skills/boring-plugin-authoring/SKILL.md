---
name: boring-plugin-authoring
description: Create or update boring-ui workspace plugins, including hot-reloadable package plugins, React panels, file visualizers, surface resolvers, and Pi/agent contributions. Use when the user asks to build or modify a boring-ui plugin.
---

# Boring Plugin Authoring

Read these references before writing plugin code:

- [Plugin authoring](../../references/workspace/plugins.md) — package shape, `.pi/extensions/<plugin-name>/`, `package.json#boring`, `package.json#pi`, `/reload`, and discovery.
- [Panel/front APIs](../../references/workspace/panels.md) — `BoringFrontFactory`, panels, panel commands, left tabs, and surface resolvers.
- [Agent/UI bridge](../../references/workspace/bridge.md) — UI bridge commands and state.

Key contract:

- Hot-reloadable live plugins go under `.pi/extensions/<plugin-name>/`.
- Front UI registration happens only through the default `BoringFrontFactory` export.
- Front panels may be normal React function components with hooks.
- File visualizers should use `WORKSPACE_OPEN_PATH_SURFACE_KIND` and fetch raw file content from `/api/v1/files/raw?path=<path>`.
- Keep generated plugins dependency-light unless the user asks for extra packages.

## Manifest contract — `package.json#boring`

Directory-source plugins (`.pi/extensions/<name>/` or any dir registered
explicitly via `{ spec: { dir }, hotReload: true }`) follow Pi's
manifest-first + convention-fallback resolution
(`@mariozechner/pi-coding-agent core/package-manager.js
resolveExtensionEntries`):

1. **Explicit field wins.** `package.json#boring.front` and
   `package.json#boring.server` point at the entry files. Declared-
   but-missing files throw loudly — no silent fallback.
2. **Conventions only when no explicit field.** Resolver tries:
   - front: `src/front/index.tsx` → `src/front/index.ts` → `dist/front/index.js`
   - server: `src/server/index.ts` → `dist/server/index.js`

Plugins that follow the template's layout skip the manifest fields
entirely. Plugins with a non-standard layout declare them.

Pi-side resources stay in `package.json#pi` (extensions, skills,
packages, systemPrompt) — that contract belongs to Pi and is
independent of `boring.*`.
