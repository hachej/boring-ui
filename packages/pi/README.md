# @hachej/boring-pi

Agent-facing knowledge for boring-ui: the Pi skills and reference docs that teach
coding agents how to author, extend, and install boring-ui workspace plugins.

This package ships **no runtime code** — only Markdown. It is consumed by the Pi
agent harness (the agent runtime behind boring-ui workspaces), which loads the
`skills/` folder as Pi skills and lets agents read the `references/` docs on
demand. The `pi.skills` field in `package.json` registers the skill root.

```jsonc
// package.json
{
  "files": ["skills", "references"],
  "pi": { "skills": ["skills"] }
}
```

## What it ships

```
skills/boring-plugin-authoring/SKILL.md   # the skill agents load to build/extend/install plugins
references/workspace/plugins.md           # full plugin package shape + hot-reload model
references/workspace/panels.md            # PaneProps, placement, panel registration, opening panels
references/workspace/bridge.md            # agent → UI bridge (exec_ui, /reload, future iframe bridge)
```

- **`skills/boring-plugin-authoring/SKILL.md`** — the primary entry point. Covers
  the scaffold-first workflow (`boring-ui-plugin scaffold`), `definePlugin` config
  shape, the `.pi/extensions/<name>/` vs `plugins/<name>/` layout decision, navigation
  surfaces (command palette vs workspace pages vs surface resolvers vs agent slash commands),
  design-system defaults, Pi extensions/tools, and the `/reload` + `plugin_diagnostics`
  verification loop. It links into the three reference docs for deeper detail.
- **`references/workspace/*.md`** — the deep-dive references. These document the real
  `@hachej/boring-workspace` API (`definePlugin`, `registerPanel` /
  `registerPanelCommand` / `registerSurfaceResolver`,
  `WORKSPACE_OPEN_PATH_SURFACE_KIND`, `openPanel` / `notify`, `WorkspaceLink`) and are
  read by runtime agents while authoring plugins, so their accuracy is load-bearing.

## Keeping references accurate

These docs describe the public surface of `@hachej/boring-workspace`
(`packages/workspace/src/plugin.ts`, `.../server.ts`, and the front exports in
`.../index.ts`). When that API changes, update the matching reference doc — agents
treat these files as ground truth, so drift produces broken generated plugins.

## License

MIT
