# @hachej/boring-workspace Changelog

## [Unreleased] - Plugin Model + Declarative Layout merger

Reference epic: `boring-ui-v2-j9p7`.

This release locks the package/plugin split used by the v2 workspace:

- Front plugin authoring uses `definePlugin({ ... })` from
  `@hachej/boring-workspace/plugin`.
- Server plugins use `defineServerPlugin({ ... })` from
  `@hachej/boring-workspace/server`.
- Package manifests use `package.json#boring.front` for workbench UI,
  `package.json#boring.server` for boot-time/static server integration, and
  `package.json#pi` for hot-reloadable Pi resources (extensions, skills,
  prompts, system prompt text).
- Runtime hosts can discover packages from `.pi/extensions/*`,
  `defaultPluginPackages`, or `appPackageJsonPath` +
  `package.json#boring.defaultPluginPackages`. Provider/binding front plugins
  must still be composed statically by the app shell.

### Breaking Changes

#### Legacy explorer exports removed

`DataCatalog`, `DataCatalogPane`, `DataExplorer`, `useExplorerState`,
`createSourcesAdapter`, and the generic explorer plugin helpers are no longer
exported from `@hachej/boring-workspace`. Use
`@hachej/boring-data-catalog` for catalog plugins and
`@hachej/boring-data-explorer` for explorer primitives.

#### `<CommandPalette>` no longer accepts file-search props

`fileSearchFn` and `onOpenFile` are removed. File search is now a catalog
contribution in the registry. `WorkspaceProvider` owns the stock command
palette mount.

```tsx
import { definePlugin } from "@hachej/boring-workspace/plugin"
import { WorkspaceProvider } from "@hachej/boring-workspace"

const filesPlugin = definePlugin({
  id: "my-files",
  label: "Files",
  catalogs: [
    {
      id: "files",
      label: "Files",
      adapter: {
        async search({ query, limit, offset, filters, group, signal }) {
          const paths = await myFileSearch(query, { limit, offset, filters, group, signal })
          return {
            items: paths.map((path) => ({
              id: path,
              title: path.split("/").pop() ?? path,
              subtitle: path,
            })),
            total: paths.length,
            hasMore: false,
          }
        },
      },
      onSelect: (row) => mySurface.openFile(row.id),
    },
  ],
})

<WorkspaceProvider plugins={[filesPlugin]}>
  <AppLayout />
</WorkspaceProvider>
```

Migration recipe:

1. Delete `fileSearchFn` and `onOpenFile` from custom `<CommandPalette>` mounts.
2. Move search logic into `CatalogConfig.adapter.search` and adapt results into `SearchResult`.
3. Move open-file behavior into `catalog.onSelect`.
4. Register the catalog from a `definePlugin({ catalogs: [...] })` front plugin.
5. Prefer the provider-mounted command palette; only custom-mount `<CommandPalette>` inside the same registry tree.

#### `<ChatCenteredShell>` is replaced by declarative layouts

`ChatCenteredShell`, `ChatShellContext`, `useChatShell`, and `useChatSurface`
are retired. Hosts migrate to Tier 1 `<ChatLayout>` or Tier 2
`<ResponsiveDockviewShell>` plus `<TopBar>`.

```tsx
import { ChatLayout, TopBar, WorkspaceProvider } from "@hachej/boring-workspace"
import { ChatPanel } from "@hachej/boring-agent/front"
import { macroPlugin, macroChatParams } from "./plugin"

<WorkspaceProvider chatPanel={ChatPanel} plugins={[macroPlugin]}>
  <TopBar appTitle="Macro" />
  <ChatLayout
    nav="session-list"
    center="chat"
    centerParams={macroChatParams}
    sidebar="workbench-left"
    surface="artifact-surface"
    surfaceParams={{ allowedPanels: ["chart-canvas", "deck"] }}
  />
</WorkspaceProvider>
```

Migration recipe:

1. Replace `ChatCenteredShell` with `ChatLayout` for stock chat/workbench chrome, or `ResponsiveDockviewShell` for custom group layouts.
2. Pass `chatPanel={ChatPanel}` to `WorkspaceProvider`; workspace base UI stays agent-injected.
3. Move catalog tabs to plugin outputs.
4. Move extra panel gates to layout/surface params.
5. Delete `withCommandPalette`; `WorkspaceProvider` mounts the registry-backed command palette.

#### `WorkbenchLeftPane` source extension moves to workspace sources

New left source content must be registered through `workspaceSources`.
Removed legacy panel placements such as `placement: "left-tab"` now fail fast
with a migration error instead of being adapted.

```tsx
import { definePlugin } from "@hachej/boring-workspace/plugin"

export const macroPlugin = definePlugin({
  id: "boring-macro",
  label: "Macro",
  workspaceSources: [
    {
      id: "macro-series",
      label: "Series",
      component: () => import("./SeriesSource").then((m) => ({ default: m.SeriesSource })),
    },
  ],
})
```

#### `excludeDefaults` now controls workspace UI only

`excludeDefaults: ["filesystem"]` removes default workspace UI
contributions: the Files tab, file catalog, and editor panels. It does not
remove LLM file tools. Use `createAgentApp({ disableDefaultFileTools: true })`
for the standalone agent layer when tool removal is required.

#### Workspace internals moved under `front/`, `server/`, `shared/`, and `plugins/`

Use package barrels and documented subpaths:

- `@hachej/boring-workspace`
- `@hachej/boring-workspace/plugin`
- `@hachej/boring-workspace/server`
- `@hachej/boring-workspace/shared`
- `@hachej/boring-workspace/events`
- `@hachej/boring-workspace/app/front`
- `@hachej/boring-workspace/app/server`

Do not import from `src/front/**`, `src/server/**`, or `src/shared/**` from
outside the package.

#### Plugin entrypoints are split between front, server, and Pi

A package plugin may declare any combination of:

```json
{
  "name": "my-plugin",
  "keywords": ["pi-package"],
  "pi": {
    "extensions": ["agent/index.ts"],
    "skills": ["agent/skills"],
    "prompts": ["agent/prompts"],
    "systemPrompt": "Short hot-reloadable guidance."
  },
  "boring": {
    "label": "My Plugin",
    "front": "front/index.tsx",
    "server": "server/index.ts"
  }
}
```

Front entry:

```tsx
import { definePlugin } from "@hachej/boring-workspace/plugin"

export default definePlugin({
  id: "my-plugin",
  label: "My Plugin",
  panels: [
    {
      id: "my-plugin.panel",
      label: "My Panel",
      placement: "center",
      component: () => import("./Panel").then((m) => ({ default: m.Panel })),
    },
  ],
  commands: [{ id: "my-plugin.open", title: "Open My Panel", panelId: "my-plugin.panel" }],
})
```

Server entry:

```ts
import { defineServerPlugin } from "@hachej/boring-workspace/server"

export default defineServerPlugin({
  id: "my-plugin",
  label: "My Plugin",
  systemPrompt: "Use my_tool when the user asks to process an item.",
  agentTools: [
    {
      name: "my_tool",
      description: "Does something useful",
      parameters: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
        additionalProperties: false,
      },
      async execute(params) {
        return { content: [{ type: "text", text: `processed ${String(params.id)}` }] }
      },
    },
  ],
})
```

`boring.server` is static/boot-time integration for app hosts. Changes to
server plugins require a process restart to update route/tool registration.
Hot-reloadable chat behavior should live in `pi.extensions`, `pi.skills`,
`pi.prompts`, or `pi.systemPrompt`.

### Additive Plugin Contract Change

`definePlugin({ ... })` accepts declarative front contributions:

- `panels`
- `workspaceSources`
- `commands`
- `catalogs`
- `surfaceResolvers`
- `bindings`
- `providers`
- optional synchronous `setup(api)`

`defineServerPlugin({ ... })` accepts server contributions:

- `systemPrompt`
- `agentTools`
- `routes`
- `provisioning`
- `preservedUiStateKeys`
- Pi package/resource declarations for static host composition

### Added

- `definePlugin({ ... })` from `@hachej/boring-workspace/plugin` for public front plugin authoring.
- `defineServerPlugin({ ... })` from `@hachej/boring-workspace/server` for server-side composition.
- `WorkspaceProvider` support for `plugins` and `excludeDefaults`.
- `createWorkspaceAgentServer({ plugins, defaultPluginPackages, appPackageJsonPath })` for server-side composition and package discovery.
- Tier 1 layouts: `ChatLayout`, `IdeLayout`, `buildChatLayout`, and `buildIdeLayout`.
- Tier 2 shell primitives: `TopBar` and `ResponsiveDockviewShell`.
- Registry-driven workbench sources via explicit `workspaceSources` plugin outputs.
- `@hachej/boring-data-catalog` catalog helpers and `@hachej/boring-data-explorer` explorer primitives.
- Polymorphic Recent entries for catalogs and commands.
- Plugin-owned surface resolvers for path and domain-target routing.
- `@hachej/boring-workspace/events` typed workspace UI events.
- DEV-only plugin diagnostics through `PluginInspector` and plugin error boundaries.
- **Hot-reload restart warnings.** `BoringPluginEvent.boring.plugin.load` now carries `requiresRestart?: ("routes" | "agentTools")[]` when a server file changed between revisions. `POST /api/v1/agent/reload` includes `restart_warnings` when static server surfaces need a process restart. New helper `collectRestartWarnings(events)` and type `PluginRestartWarning` exported from `@hachej/boring-workspace/server`.
- **`.boring-signature.json` sidecar cache.** `BoringPluginAssetManager` persists each plugin's load-time server-file signature next to its source so `boring-ui-plugin verify` can detect drift between what the workspace loaded and what's currently on disk. Verify-plugin emits a `⚠ WARN:` line + suffix block when restart is needed (not just `/reload`). New exports from `/server`: `pluginFileSignature`, `readPluginSignatureCache`, `writePluginSignatureCache`. The sidecar is in `.gitignore` and shipped automatically by `boring-ui-plugin scaffold`.
- **Pi-style docs pointer block in the system prompt.** `buildBoringSystemPrompt()` now emits a `## boring-ui plugin authoring documentation` block listing absolute paths into the installed `@hachej/boring-pi` (resolved via `require.resolve("@hachej/boring-pi/package.json")`): the SKILL.md plus the `panels.md` / `bridge.md` / `plugins.md` references. Graceful fallback points at `<available_skills>` when boring-pi is unresolvable. Per-turn token cost shrunk to ~250 vs the previous ~600 of inlined guidance; SKILL.md content is read on demand. See `docs/DECISIONS.md` #17.

### Changed

- `BuildBoringSystemPromptOptions.verifyCommand` narrowed from `string | false` to required `string`. No production caller passed `false`; the conditional branch and its test were dead.
- Layer-agnostic registries `CatalogRegistry`, `CommandRegistry`, and `SurfaceResolverRegistry` moved from `src/front/` to `src/shared/plugins/`. Public exports from `@hachej/boring-workspace` (top-level + `/server`) unchanged. `PanelRegistry` stays in `front/registry/` (it depends on React `lazy` / `Suspense`).

### Removed

- `PanelRegistry.unregisterByPluginId(pluginId)` and `SurfaceResolverRegistry.unregisterByPluginId(pluginId)` — no production callers in this repo (the workspace uses `replaceByPluginId(pluginId, [])` for the same effect). `CommandRegistry` and `CatalogRegistry` keep their `unregisterByPluginId` methods (4 production call sites each).
- `/server` re-exports of `clearPluginSignatureCache`, `PluginSignatureCachePayload`, and `PLUGIN_SIGNATURE_CACHE_FILE`. These were workspace-internal; the asset manager owns the writer/clearer, and cli `verify-plugin` only needs `readPluginSignatureCache` + `pluginFileSignature`.
- `verifyPlugin.ts` un-exports `VerifyPluginOptions`, `RecognizedMistake`, and `COMMON_MISTAKE_HINTS` from the `@hachej/boring-ui-cli` server entry (no external consumer used them).

### Migration Checklist

1. Replace direct `CommandPalette` file-search props with catalog contributions.
2. Replace `ChatCenteredShell` with `ChatLayout` or `ResponsiveDockviewShell`.
3. Convert left-pane tabs to explicit plugin `workspaceSources`.
4. Split front and server entrypoints when tools, routes, credentials, or Node-only code are involved.
5. Put hot-reloadable agent behavior in Pi resources; use `boring.server` only for static app/server composition.
6. Prefer explicit `package.json#boring.server` for server integration; restart the workspace process after server plugin edits.
7. Use `defaultPluginPackages` or `appPackageJsonPath` for app-default package discovery.
8. Statically compose provider/binding plugins in the shell until dynamic mounting support exists.
9. Audit `excludeDefaults` call sites and add `disableDefaultFileTools` where tool removal is required.
10. Remove undocumented deep imports into workspace internals.
11. Run package typecheck and the host app e2e suite after migration.

### Versioning Note

This should ship as a pre-1.0 minor bump unless maintainers decide this is the
compatibility baseline for `1.0`. The release is breaking for hosts that use
removed props, retired layouts, or undocumented deep imports.
