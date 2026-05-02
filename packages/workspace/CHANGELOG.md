# @boring/workspace Changelog

## [Unreleased] - Plugin Model + Declarative Layout merger

Reference epic: `boring-ui-v2-j9p7`.
Canonical migration example: `d26e1e7` (`refactor(macro): rewrite App.tsx + server/index.ts to use plugin model (j9p7.19)`) in `apps/boring-macro-v2/src/plugins/macro/`, `apps/boring-macro-v2/src/front/App.tsx`, and `apps/boring-macro-v2/src/server/index.ts`.

### Breaking Changes

#### Legacy `DataCatalog` components removed

`DataCatalog` and `DataCatalogPane` are no longer exported from `@boring/workspace`.
Data catalog UI now lives behind plugin outputs. Use `createDataCatalogPlugin()`
for standalone catalogs or `appendDataCatalogOutputs()` inside an app/domain
plugin. Use `DataExplorer` directly only for generic explorer UI.

#### `<CommandPalette>` no longer accepts file-search props

`fileSearchFn` and `onOpenFile` are removed. File search is now a catalog contribution in the registry. `WorkspaceProvider` owns the stock command palette mount.

Before:

```tsx
<CommandPalette
  open={open}
  onOpenChange={setOpen}
  fileSearchFn={(query) => myFileSearch(query)}
  onOpenFile={(path) => mySurface.openFile(path)}
/>
```

After:

```tsx
import { defineFrontPlugin, WorkspaceProvider } from "@boring/workspace"

const filesPlugin = defineFrontPlugin({
  id: "my-files",
  label: "Files",
  catalogs: [
    {
      id: "files",
      label: "Files",
      adapter: {
        async search({ query, limit, offset, filters, group, signal }) {
          const paths = await myFileSearch(query, {
            limit,
            offset,
            filters,
            group,
            signal,
          });
          return {
            items: paths.map((path) => ({
              id: path,
              title: path.split("/").pop() ?? path,
              subtitle: path,
            })),
            total: paths.length,
            hasMore: false,
          };
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
2. Move the old search function into `CatalogConfig.adapter.search` and adapt its result into `SearchResult`.
3. Move the old open-file behavior into `catalog.onSelect`.
4. Register the catalog from a `WorkspaceFrontPlugin` passed to `<WorkspaceProvider plugins={...}>`.
5. Prefer the provider-mounted command palette; only custom-mount `<CommandPalette>` inside the same registry tree.

#### `<ChatCenteredShell>` is replaced by declarative layouts

`ChatCenteredShell`, `ChatShellContext`, `useChatShell`, and `useChatSurface` are retired by Phase 1.5-G. Hosts migrate to Tier 1 `<ChatLayout>` or Tier 2 `<ResponsiveDockviewShell>` plus `<TopBar>`.

Before:

```tsx
<WorkspaceProvider>
  <ChatCenteredShell
    appTitle="Macro"
    data={dataPaneConfig}
    extraPanels={["chart-canvas", "deck"]}
    withCommandPalette={true}
    chatSuggestions={macroChatSuggestions}
  />
</WorkspaceProvider>
```

After:

```tsx
import { ChatLayout, TopBar, WorkspaceProvider } from "@boring/workspace";
import { ChatPanel } from "@boring/agent";
import { macroPlugin, macroChatParams } from "./plugin";

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
</WorkspaceProvider>;
```

Migration recipe:

1. Replace `ChatCenteredShell` with `ChatLayout` for stock chat/workbench chrome, or `ResponsiveDockviewShell` when you need custom group layout.
2. Pass `chatPanel={ChatPanel}` to `WorkspaceProvider`; do not import `@boring/agent` from inside `@boring/workspace`.
3. Move `data: DataPaneConfig` to a plugin-owned data catalog plugin, using `createDataCatalogPlugin({ adapter })` for standalone catalogs or `appendDataCatalogOutputs(...)` inside an app/domain plugin.
4. Move `extraPanels` to the declarative surface gate (`allowedPanels`) or omit it when every registered panel is allowed in that shell. In Tier 1 layouts this travels through `surfaceParams` to the surface panel that reads the gate.
5. Delete `withCommandPalette`; `WorkspaceProvider` mounts the registry-backed command palette.

`chatSuggestions` is now the chat panel's `suggestions` prop. Pass it through the host's chat panel params/plugin factory, or directly as `<ChatPanel suggestions={...} />` when you mount the panel yourself.

#### `WorkbenchLeftPane` tab extension moves to the registry

Direct `WorkbenchLeftPane` data props are no longer the extension target for app-specific tabs. The compatibility props may still compile during the transition, but new tab content must be registered as panels with `placement: "left-tab"` so defaults, plugins, and `excludeDefaults` all flow through one registry path.

Before:

```tsx
<WorkbenchLeftPane data={dataPaneConfig} dataSources={staticSources} />
```

After:

```tsx
import { defineFrontPlugin, DataExplorer } from "@boring/workspace";

const macroSeriesTab = {
  type: "left-tab",
  id: "macro-series",
  title: "Series",
  component: () => <DataExplorer adapter={macroAdapter} groupBy="frequency" />,
} as const;

export const macroPlugin = defineFrontPlugin({
  id: "boring-macro",
  label: "Macro",
  outputs: [macroSeriesTab],
});
```

Migration recipe:

1. Stop adding new tab content directly to `WorkbenchLeftPane` props.
2. Wrap each left-pane tab as a `left-tab` plugin output.
3. Register those outputs from a host/plugin passed to `WorkspaceProvider`.
4. Use `excludeDefaults: ["filesystem"]` to remove the default Files tab.
5. Keep tab-specific state inside the panel component or its adapter, not in `WorkbenchLeftPane` props.

#### `excludeDefaults` now controls workspace UI only

`excludeDefaults: ["filesystem"]` removes default workspace UI contributions: the Files tab, file catalog, and editor panels. It does not remove LLM file tools.

Before:

```tsx
<WorkspaceProvider excludeDefaults={["filesystem"]} />
```

After:

```tsx
<WorkspaceProvider excludeDefaults={["filesystem"]} />;

createAgentApp({
  disableDefaultFileTools: true,
});
```

`disableDefaultFileTools` is the standalone `createAgentApp` option for this layer. Route-level wrappers that embed agent internals should be audited separately before documenting the same opt-out there.

Migration recipe:

1. Use `excludeDefaults` only when you want to hide default workspace UI.
2. Use `disableDefaultFileTools: true` on `createAgentApp` when you want to remove LLM file operations.
3. Set both flags for a truly file-free host.
4. Audit embedded agent-route paths separately; route helpers may not expose the tool opt-out yet.
5. Keep plugin `agentTools` for host-specific tools, not default filesystem tools.

#### Workspace internals moved under `front/`, `server/`, `shared/`, and `plugins/`

The public barrel import stays stable. Deep imports into internal paths can break after the Step 0 source reorg.

Before:

```ts
import { Button } from "@boring/ui";
import { ChatCenteredShell } from "@boring/workspace/components/chat";
```

After:

```ts
import { ChatLayout, defineFrontPlugin, WorkspaceProvider } from "@boring/workspace";
import { Button } from "@boring/ui";
```

Migration recipe:

1. Replace deep imports with `@boring/workspace` barrel exports where possible.
2. Use documented package subpaths only, such as `@boring/workspace/events`, `@boring/workspace/shared`, and `@boring/ui`.
3. Do not import from `src/front/**`, `src/server/**`, or `src/shared/**` from outside the package.
4. Treat undocumented paths as private implementation details.
5. Add a package-level typecheck after import cleanup.

#### Plugin entrypoints are split between client and server

Distributed plugins and inline app plugins now follow the same shape: client
contributions in `index.tsx`; server-side tool composition in `server/index.ts`.

Before:

```ts
export const macroClientPlugin = defineFrontPlugin({
  id: "boring-macro",
  label: "Macro",
  outputs,
});
```

After:

```ts
// src/plugins/macro/front/index.tsx
export const macroClientPlugin = defineFrontPlugin({
  id: "boring-macro",
  label: "Macro",
  outputs,
});

// src/plugins/macro/server/index.ts
export function makeMacroServerPlugin(tools: AgentTool[]) {
  return defineServerPlugin({
    id: "boring-macro",
    label: "Macro",
    agentTools: tools,
  });
}
```

Migration recipe:

1. Keep React components, panels, commands, catalogs, and chat suggestions in the client entrypoint.
2. Keep `AgentTool[]`, credentials, route factories, and Node-only dependencies in the server entrypoint.
3. Reuse the same plugin `id` in both halves so prompts and diagnostics line up.
4. Pass client plugins to `<WorkspaceProvider plugins={...}>`.
5. Pass server plugins to `createWorkspaceAgentServer({ plugins })` or the app shell's server composition point.

### Additive Plugin Contract Change

The plugin contract is split into front and server halves:

```ts
type WorkspaceFrontPlugin = {
  id: string;
  label?: string;
  outputs?: PluginOutput[];
};

type WorkspaceServerPlugin = {
  id: string;
  label?: string;
  systemPrompt?: string;
  agentTools?: AgentTool[];
  provisioning?: RuntimeProvisioningContribution;
  routes?: FastifyPluginAsync;
};
```

`systemPrompt` is additive. Existing plugins continue to work without it. When present, bootstrap includes plugin prompts before app-level `createAgentApp` prompt additions.

### Added

- `defineFrontPlugin()` and `defineServerPlugin()` for explicit front/server plugin halves.
- `WorkspaceProvider` support for `plugins` and `excludeDefaults`.
- `createWorkspaceAgentServer({ plugins })` for server-side tool composition.
- Tier 1 layouts: `ChatLayout`, `IdeLayout`, `buildChatLayout`, and `buildIdeLayout`.
- Tier 2 shell primitives: `TopBar` and `ResponsiveDockviewShell`.
- Registry-driven workbench tabs via `placement: "left-tab"` panels.
- `createDataCatalogPlugin()` / `appendDataCatalogOutputs()` for reusable data catalog tabs backed by an `ExplorerAdapter`.
- Polymorphic Recent entries for catalogs and commands.
- Plugin-owned surface resolvers for path and domain-target routing.
- `@boring/workspace/events` package subpath for typed workspace UI events.
- DEV-only plugin diagnostics through `PluginInspector` and plugin error boundaries.

### Migration Checklist

1. Replace direct `CommandPalette` file-search props with catalog contributions.
2. Replace `ChatCenteredShell` with `ChatLayout` or `ResponsiveDockviewShell`.
3. Convert left-pane tabs to plugin panels with `placement: "left-tab"`.
4. Split plugin client/server entrypoints when tools or Node-only code are involved.
5. Audit `excludeDefaults` call sites and add `disableDefaultFileTools` where tool removal is required.
6. Remove undocumented deep imports into `@boring/workspace` internals.
7. Use the boring-macro migration in `d26e1e7` as the worked example for app-side plugin extraction.
8. Run package typecheck and the host app e2e suite after migration.

### Versioning Note

This should ship as a pre-1.0 minor bump unless maintainers decide this is the compatibility baseline for `1.0`. The release is breaking for hosts that use removed props, `ChatCenteredShell`, or undocumented deep imports.
