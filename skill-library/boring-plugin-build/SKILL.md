---
name: boring-plugin-build
description: Build or shape a boring-ui plugin for a shipped app or playground. Covers choosing runtime vs app/internal plugin shape, where files live, how to register plugins, and when to use static composition vs defaultPluginPackages. Use when the user asks for plugin shape, new panels/tabs/catalogs/tools, or app-specific workspace extensions.
---

# Boring Plugin Build

## Companion files in this skill bundle

Read these companion docs when needed:

- `DECISION_TREE.md` — choose the plugin shape first
- `REGISTRATION_MATRIX.md` — map plugin surfaces to the right load path
- `PROGRESS_DISCLOSURE.md` — how to report plugin progress clearly
- `CHECKLISTS.md` — shape, registration, and verification checklists
- `SNIPPETS.md` — copy-paste commands for runtime plugins, app plugins, core boot, and Vercel entry wiring

## The one rule

**Decide plugin trust level before you write files.**

There are two valid plugin shapes in this repo:

1. **runtime/generated plugin** under `.pi/extensions/<name>/`
2. **app/internal trusted plugin package** declared through `package.json#boring.defaultPluginPackages`

If the plugin is part of a real shipped app, default to **app/internal trusted package**.
If the plugin is for fast local iteration or agent-authored experimentation, default to **runtime/generated plugin**.

---

## Read these first

1. `packages/pi/skills/boring-plugin-authoring/SKILL.md`
2. `packages/workspace/docs/PLUGIN_STRUCTURE.md`
3. `packages/workspace/docs/PLUGIN_SYSTEM.md`
4. `packages/core/docs/PLUGIN_INTEGRATION.md` when the plugin is for a core-based shipped app
5. `apps/workspace-playground/README.md`
6. `apps/workspace-playground/src/front/App.tsx`
7. `apps/workspace-playground/package.json`
8. `apps/workspace-playground/src/plugins/playgroundDataCatalog/package.json`

Treat `packages/pi/skills/boring-plugin-authoring/SKILL.md` as the deep canonical authoring manual. This local skill is the repo-specific dispatcher that tells you which path to use.

Also follow `PROGRESS_DISCLOSURE.md` while implementing so the user always knows the current plugin shape, load path, and restart/reload requirement.

---

Use `DECISION_TREE.md` before writing files.

## Decision table

| Need | Choose |
|---|---|
| live local experimentation, `/reload`, no trusted backend routes | `.pi/extensions/<name>/` |
| app-owned domain logic, trusted routes/tools, production app package | app/internal plugin package |
| provider/binding plugin that wraps React tree | app/internal plugin package + static front composition |
| panel/command/catalog/surface-resolver only | either, but shipped apps usually use app/internal packages |

---

## Runtime/generated plugin path

Use when:

- iterating inside a workspace
- authoring with the `boring-ui-plugin` CLI
- relying on `/reload` for front/Pi resources
- avoiding custom backend routes

Workflow:

1. run the scaffold command from the canonical skill
2. edit the generated files in place
3. run `boring-ui-plugin verify <name> "$BORING_AGENT_WORKSPACE_ROOT"`
4. tell the user to run `/reload`

Use `SNIPPETS.md` if you want copy-paste commands instead of rebuilding them by hand.

Read and follow:

- `packages/pi/skills/boring-plugin-authoring/SKILL.md`

Do not invent a custom layout for this path.

---

## App/internal trusted plugin path

Use when:

- the plugin ships with the app
- you need trusted server routes or agent tools
- the plugin is part of the app’s deployable identity
- you want the plugin discovered at boot from the app manifest

Two common homes:

- `apps/<app>/src/plugins/<name>/package.json` for app-local direct-source plugins
- `plugins/<name>/` for shared publishable repo plugins

Concrete in-repo app-local example:

- `apps/workspace-playground/src/plugins/playgroundDataCatalog/package.json`

Important:

- `plugins/<name>/` is the repo-level packaged plugin home; create it with `boring-ui-plugin create <name> --path plugins`
- `apps/<app>/src/plugins/<name>/` follows the direct-source app-local pattern shown in the playground example, not the built `dist/*` CLI template shape

Use the same manifest principles as the canonical skill:

```json
{
  "name": "my-plugin",
  "version": "0.0.0",
  "private": true,
  "boring": {
    "label": "My Plugin",
    "front": "front/index.tsx",
    "server": "server/index.ts"
  },
  "pi": {
    "systemPrompt": "Short agent guidance for when this plugin matters."
  }
}
```

---

## Registration rules

Use `REGISTRATION_MATRIX.md` when in doubt about how a plugin surface should load.

### Package-discovered defaults

For package plugins, register through the app’s `package.json`:

```json
{
  "boring": {
    "defaultPluginPackages": [
      "@hachej/boring-ask-user",
      "./src/plugins/my-plugin"
    ]
  }
}
```

Use this for server/Pi/static package discovery and, outside core, some package-driven plugin loading paths.

For core-based shipped apps, make sure the server boot path actually passes
`appPackageJsonPath` or `defaultPluginPackages`; otherwise the manifest entry can
exist and nothing will load. See `packages/core/docs/PLUGIN_INTEGRATION.md` and
`.agents/skills/boring-app-setup/SKILL.md`.

Also: for core-based shipped apps, do **not** assume `defaultPluginPackages`
alone makes front panel/command/catalog/surface-resolver UI appear. Front plugin
surfaces should be statically composed in the app shell when the shipped UI must
render them.

### Static front composition still needed for providers/bindings

If the plugin contributes providers or bindings, compose it explicitly in the front app shell:

```tsx
<WorkspaceAgentFront plugins={[myProviderPlugin]} ... />
```

Do not assume provider/binding plugins can be safely hot-mounted through the dynamic package path.

---

## For shipped apps, prefer this build order

1. prove the UX in `apps/workspace-playground`
2. harden the plugin into an app/internal package
3. register it with `defaultPluginPackages`
4. for core-based shipped apps, statically compose front plugin surfaces in the app shell when the shipped UI must render them
5. restart/redeploy when `boring.server` changes

This is the shortest path from idea to production-safe plugin.

---

## Guardrails

- use `definePlugin({ ... })`, not legacy API names
- use `defineServerPlugin({ ... })` for trusted server-side contributions
- keep `src/shared/**` browser-safe if you add shared code
- do not add `boring.server` to runtime `.pi/extensions` plugins
- do not promise `/reload` will apply trusted server-route changes
- do not deep-import undocumented workspace internals

---

## Verification

For runtime plugins:

```bash
boring-ui-plugin verify <name> "$BORING_AGENT_WORKSPACE_ROOT"
```

For app/internal plugins:

```bash
pnpm typecheck
pnpm lint:invariants
```

Also verify the integration point:

- manifest entry present in `package.json#boring.defaultPluginPackages`
- front plugin composed where needed
- server restart/redeploy done when `boring.server` changed

---

## When to stop and ask

Stop and ask if any of these are unclear:

- should this plugin be runtime or app/internal?
- does it need trusted backend routes/tools?
- is it part of one app only or a shared plugin?
- does it need a permanent left tab, or just a panel/command?
- does it need provider/binding behavior?

Do not pick silently. Plugin shape drives everything else.

---

## References

- `DECISION_TREE.md`
- `REGISTRATION_MATRIX.md`
- `PROGRESS_DISCLOSURE.md`
- `CHECKLISTS.md`
- `SNIPPETS.md`
- `packages/pi/skills/boring-plugin-authoring/SKILL.md`
- `packages/workspace/docs/PLUGIN_STRUCTURE.md`
- `packages/workspace/docs/PLUGIN_SYSTEM.md`
- `packages/core/docs/PLUGIN_INTEGRATION.md`
- `apps/workspace-playground/README.md`
- `apps/workspace-playground/src/front/App.tsx`
- `apps/workspace-playground/package.json`
- `apps/workspace-playground/src/plugins/playgroundDataCatalog/package.json`
