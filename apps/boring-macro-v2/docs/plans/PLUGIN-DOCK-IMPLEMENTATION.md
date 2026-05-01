# Macro Plugin + Dock Implementation Plan

## Goal

Create a **self-contained macro plugin** that provides:
- **CLI**: `bm` command for agent to execute transforms
- **Tools**: LLM-callable tools (`execute_sql`, `macro_search`, etc.)
- **Panels**: UI components (MacroCatalog, SeriesViewer)
- **Skills**: Prompt templates for common workflows

---

## Architecture Overview

```
apps/boring-macro-v2/
├── src/
│   ├── plugin/
│   │   ├── server.ts           # Server plugin (agent tools)
│   │   ├── front.ts            # Frontend plugin (panels, commands)
│   │   └── types.ts            # Shared types
│   ├── front/
│   │   └── panes/
│   │       ├── MacroCatalogPane.tsx
│   │       └── SeriesViewerPane.tsx
│   └── server/
│       └── tools/
│           └── macroTools.ts   # Existing LLM tools
├── sdk/
│   └── boring_macro/
│       └── _cli.py             # CLI implementation
└── transforms/
    └── builtins/
        └── yoy.py              # Transform definitions
```

---

## Phase 1: Plugin Structure

### 1.1 Server Plugin (`src/plugin/server.ts`)

**Purpose**: Expose agent tools to the LLM harness.

**Implementation**:
```typescript
import type { AgentTool } from '@boring/agent/shared'
import { createMacroTools } from '../server/tools/macroTools'

export function makeMacroServerPlugin(macroConfig): {
  id: string
  label: string
  agentTools: AgentTool[]
  systemPrompt: string
} {
  const tools = createMacroTools(macroConfig.clickhouse)
  
  return {
    id: 'boring-macro',
    label: 'Macro',
    agentTools: tools,
    systemPrompt: `## Macro Plugin Capabilities\n...`,
  }
}
```

**Integration**: Already wired in `src/server/index.ts` via `createWorkspaceAgentApp({ plugins: [...] })`

---

### 1.2 Frontend Plugin (`src/plugin/front.ts`)

**Purpose**: Register UI panels, commands, and catalogs.

**Implementation**:
```typescript
import { definePlugin } from '@boring/workspace'
import { definePanel } from '@boring/workspace'
import { MacroCatalogPane } from '../front/panes/MacroCatalogPane'
import { SeriesViewerPane } from '../front/panes/SeriesViewerPane'

export const macroFrontendPlugin = definePlugin({
  id: 'boring-macro',
  label: 'Macro',
  panels: [
    definePanel({
      id: 'macro-catalog',
      title: 'Macro Catalog',
      component: MacroCatalogPane,
      placement: 'left-tab',
      source: 'app',
    }),
    definePanel<{ seriesId: string }>({
      id: 'series-viewer',
      title: 'Series Viewer',
      component: SeriesViewerPane,
      placement: 'right-tab',
      source: 'app',
    }),
  ],
  commands: [
    {
      id: 'macro:open-catalog',
      title: 'Open Macro Catalog',
      run: () => {
        // Open catalog panel
      },
    },
  ],
  catalogs: [
    {
      id: 'macro-series',
      label: 'Macro Series',
      adapter: {
        async search(query) {
          const resp = await fetch(`/api/v1/macro/search?q=${query}`)
          return resp.json()
        },
      },
      onSelect: (item) => {
        // Open series viewer
      },
    },
  ],
})
```

**Integration**: Register in `src/front/App.tsx` via `RegistryProvider`.

---

## Phase 2: Panel Components

### 2.1 MacroCatalogPane (`src/front/panes/MacroCatalogPane.tsx`)

**Purpose**: Browse and search macro series catalog.

**Features**:
- Search input with debounced queries
- Results list with series metadata
- Click to open series viewer
- Loading/error states

**Dependencies**:
- `@tanstack/react-query` for data fetching
- `recharts` for charts (optional)

---

### 2.2 SeriesViewerPane (`src/front/panes/SeriesViewerPane.tsx`)

**Purpose**: View chart and data for a series.

**Features**:
- Line chart with Recharts
- Data table (first 100 observations)
- Listen for `macro:open-series` events
- Dynamic title updates

**Dependencies**:
- `recharts` for visualization
- `@tanstack/react-query` for data fetching

---

## Phase 3: CLI Integration

### 3.1 Python SDK (`sdk/boring_macro/_cli.py`)

**Purpose**: Shell-accessible CLI for transforms.

**Commands**:
```bash
bm run --tool builtin:yoy --input CPIAUCSL --output CPIAUCSL_YOY --title "CPI YoY"
bm list                          # List available transforms
bm scaffold --name my_transform  # Create custom transform
```

**Integration**:
- Package as NPM package (`@boring/macro-sdk`)
- Install in workspace via `package.json` dependencies
- Expose via `.bin/bm` in sandbox PATH

---

## Phase 4: Wiring

### 4.1 Server Integration

**File**: `apps/boring-macro-v2/src/server/index.ts`

```typescript
import { createWorkspaceAgentApp } from '@boring/workspace/server'
import { makeMacroServerPlugin } from '../plugin/server'

export async function buildServer(opts) {
  const macroConfig = await loadMacroConfig()
  
  const app = await createWorkspaceAgentApp({
    workspaceRoot: opts.workspaceRoot,
    mode: 'local',
    plugins: [makeMacroServerPlugin(macroConfig)],
  })
  
  // ... routes
}
```

---

### 4.2 Frontend Integration

**File**: `apps/boring-macro-v2/src/front/App.tsx`

```typescript
import { RegistryProvider } from '@boring/workspace'
import { PanelRegistry } from '@boring/workspace'
import { macroFrontendPlugin } from '../plugin/front'

// Register plugin panels
const registry = new PanelRegistry()
registry.register(macroFrontendPlugin.panels)

function App() {
  return (
    <RegistryProvider 
      panelRegistry={registry}
      commandRegistry={new CommandRegistry()}
      catalogRegistry={new CatalogRegistry()}
    >
      <DockviewShell layout={...} />
    </RegistryProvider>
  )
}
```

---

## Phase 5: Plugin-Driven Dock Configuration

### 5.1 Default Layout

**File**: `apps/boring-macro-v2/src/front/layouts/macroLayout.ts`

```typescript
import type { LayoutConfig } from '@boring/workspace'

export const macroLayout: LayoutConfig = {
  version: '1.0',
  groups: [
    {
      id: 'left',
      position: 'left',
      panel: 'macro-catalog',
    },
    {
      id: 'center',
      position: 'center',
      panel: 'code-editor',
    },
    {
      id: 'right',
      position: 'right',
      panel: 'series-viewer',
    },
  ],
}
```

---

## Dependencies

### NPM Packages

```json
{
  "dependencies": {
    "@boring/agent": "workspace:*",
    "@boring/workspace": "workspace:*",
    "@tanstack/react-query": "^5.0.0",
    "recharts": "^2.15.0"
  }
}
```

### Python Dependencies (for CLI)

```toml
# pyproject.toml or python-deps.json
[project]
dependencies = [
    "pandas>=2.0.0",
    "clickhouse-connect>=0.7.0",
]
```

---

## Testing

### Unit Tests

- `src/plugin/__tests__/server.test.ts` - Tool registration
- `src/plugin/__tests__/front.test.ts` - Panel registration
- `src/front/panes/__tests__/MacroCatalogPane.test.tsx` - UI components

### E2E Tests

- `e2e/macro-plugin.spec.ts` - Full workflow (search → view → transform)

---

## Migration Checklist

- [ ] Create `src/plugin/types.ts` - Shared types
- [ ] Create `src/plugin/server.ts` - Server plugin (already exists)
- [ ] Create `src/plugin/front.ts` - Frontend plugin
- [ ] Create `src/front/panes/MacroCatalogPane.tsx`
- [ ] Create `src/front/panes/SeriesViewerPane.tsx`
- [ ] Register plugin in `src/front/App.tsx`
- [ ] Wire server plugin in `src/server/index.ts` (already exists)
- [ ] Add default layout configuration
- [ ] Write unit tests
- [ ] Write E2E tests
- [ ] Document plugin API
- [ ] Package CLI as NPM package

---

## Risks

| Risk | Mitigation |
|------|-----------|
| Panel registration conflicts | Use `definePlugin` validation |
| CLI not available in sandbox | Ensure `package.json` includes `bin` entry |
| Python dependencies missing | Document requirements, use `uv` for management |
| Plugin loading order | Document dependency graph |

---

## Acceptance Criteria

- [ ] Agent can use `macro_search` tool
- [ ] Agent can run `bm run --tool builtin:yoy ...`
- [ ] MacroCatalog pane opens and displays search results
- [ ] SeriesViewer pane displays chart and data
- [ ] Clicking series in catalog opens viewer
- [ ] Plugin system works with other plugins (no conflicts)

---

## Vercel Sandbox Considerations

**Important**: Plugin auto-discovery is **disabled** in `vercel-sandbox` mode per `docs/PLUGINS.md`.

### For vercel-sandbox compatibility:

1. **Manual packaging**: Include plugin files in workspace template/snapshot
   - Place `.pi/extensions/*` in template directory
   - Ensure files exist at `/vercel/sandbox/.pi/extensions/` in remote workspace
   
2. **Alternative**: Use `extraTools` option in `createAgentApp` to register tools programmatically
   
3. **Environment differences**:
   - Available binaries may differ from host machine
   - Root path is `/vercel/sandbox` not `cwd`
   - Process/network policies may differ

### Updated Architecture for vercel-sandbox:

```typescript
// Instead of relying on plugin auto-discovery:
const app = await createAgentApp({
  mode: 'vercel-sandbox',
  extraTools: createMacroTools(macroConfig), // Register programmatically
});
```

---

## Cross-Review Requirements

Per AGENTS.md, before closing this plan:

- **Claude Code agent → asks Codex via `cod exec "..."`**
- **Codex agent → asks Claude Code via `cc -p "..."`**

Review prompt:
```
Review this plugin architecture implementation plan for a macro-economic data analysis application. Provide critical feedback on:

1. **Architecture**: Is the separation of server plugin (agent tools) and frontend plugin (panels) appropriate?
2. **Plugin System**: Does this match the plugin spec in `packages/agent/docs/PLUGINS.md`?
3. **CLI Integration**: Is packaging Python CLI as NPM package the right pattern for sandboxes?
4. **Panel Design**: Is event-based communication (`macro:open-series`) the right pattern?
5. **Data Flow**: Should data fetching go through agent harness instead of direct API calls?
6. **Type Safety**: Is `definePanel<{ seriesId: string }>` sufficient?
7. **Testing Strategy**: What's missing from unit/E2E tests?
8. **Vercel Compatibility**: Does this account for vercel-sandbox caveats?

Be critical and specific. Point out concrete improvements.
```

---

## Future Enhancements

1. **Skill templates** - Prompt templates for common workflows
2. **Custom transforms** - `bm scaffold` + editor integration
3. **Dashboard builder** - Multi-series charts
4. **Export functionality** - CSV/JSON download
5. **Real-time updates** - WebSocket data streaming
6. **Plugin marketplace** - Discover and install community plugins
