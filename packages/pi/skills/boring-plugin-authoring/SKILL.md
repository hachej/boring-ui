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
