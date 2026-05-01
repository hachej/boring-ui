# Full Plugin Architecture: CLI + Panel + Tools + Skills

Each plugin owns **everything** - CLI, UI panels, agent tools, and skills. This is a **self-contained, composable** architecture.

---

## Plugin Structure

```
plugins/macro-plugin/
├── plugin.mjs                    # Main entry point
├── python-deps.json              # Python SDK requirements
├── sdk/
│   └── boring_macro/
│       ├── _cli.py               # CLI implementation
│       ├── transforms.py         # Transform logic
│       └── __init__.py
├── transforms/
│   ├── builtins/
│   │   └── yoy.py               # Built-in transforms
│   └── templates/
│       └── transform_template.py
├── front/
│   ├── MacroCatalogPane.tsx      # UI panel component
│   ├── MacroSeriesViewer.tsx     # Another panel
│   └── macroAdapter.ts           # Frontend data adapter
├── prompts/
│   ├── system-prompt.md          # Plugin-specific system prompt
│   └── skills/
│       ├── run-transform.md      # Skill: run transforms
│       └── search-series.md      # Skill: search catalog
└── package.json                  # NPM deps (if any)
```

---

## plugin.mjs - The Manifest

```javascript
// plugins/macro-plugin/plugin.mjs

/**
 * Macro Plugin - Full-stack plugin for macro-economic timeseries
 * 
 * Provides:
 * - CLI: `bm` command for agent to execute
 * - Tools: execute_sql, macro_search, get_series_data
 * - Panels: MacroCatalog, SeriesViewer
 * - Skills: run-transform, search-series, persist-data
 */

// ============================================================================
// AGENT TOOLS (LLM-callable)
// ============================================================================

export const tools = [
  {
    name: 'execute_sql',
    description: 'Execute read-only SQL against ClickHouse macro database',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'SELECT query only' }
      },
      required: ['query']
    },
    async execute(params, context) {
      // Implementation using ClickHouse client
      return executeSql(params.query);
    }
  },
  {
    name: 'macro_search',
    description: 'Search 87k+ FRED macro series',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'number', default: 20 }
      },
      required: ['query']
    },
    async execute(params) {
      return searchSeries(params.query, params.limit);
    }
  },
  {
    name: 'persist_derived_series',
    description: 'Save derived timeseries output',
    parameters: { /* ... */ },
    async execute(params) {
      return persistSeries(params);
    }
  }
];

// ============================================================================
// PYTHON SDK METADATA (for CLI)
// ============================================================================

export const pythonDeps = {
  pythonVersion: '3.12',
  dependencies: [
    'pandas>=2.0.0',
    'clickhouse-connect>=0.7.0',
    'boring-macro-sdk>=0.2.0'
  ],
  cliCommands: [
    {
      name: 'bm',
      module: 'boring_macro._cli:main',
      description: 'Macro SDK CLI - run transforms, list series, scaffold'
    }
  ]
};

// ============================================================================
// FRONTEND PANELS (UI components)
// ============================================================================

export const panels = [
  {
    id: 'macro-catalog',
    title: 'Macro Catalog',
    component: () => import('./front/MacroCatalogPane.js'),
    placement: 'left-tab',
    icon: 'chart-bar'
  },
  {
    id: 'series-viewer',
    title: 'Series Viewer',
    component: () => import('./front/SeriesViewer.js'),
    placement: 'right-tab',
    icon: 'chart-line'
  }
];

// ============================================================================
// SKILLS (Prompt templates / capabilities)
// ============================================================================

export const skills = [
  {
    id: 'run-transform',
    name: 'Run Transform',
    description: 'Execute a transform on timeseries data',
    promptFile: './prompts/skills/run-transform.md',
    tools: ['execute_sql', 'persist_derived_series', 'exec_ui']
  },
  {
    id: 'search-series',
    name: 'Search Series',
    description: 'Find macro series by keyword',
    promptFile: './prompts/skills/search-series.md',
    tools: ['macro_search', 'get_series_data']
  },
  {
    id: 'create-dashboard',
    name: 'Create Dashboard',
    description: 'Build a chart dashboard from series',
    promptFile: './prompts/skills/create-dashboard.md',
    tools: ['macro_search', 'execute_sql', 'exec_ui']
  }
];

// ============================================================================
// SYSTEM PROMPT
// ============================================================================

export const systemPrompt = `
You are a macro-economic data analyst. You have access to:

## Tools
- execute_sql: Run read-only SQL queries
- macro_search: Search 87k+ FRED series
- get_series_data: Fetch observations for a series
- persist_derived_series: Save derived series

## CLI Commands
- \`bm run --tool <builtin|custom>:<name> --input <ids> --output <id> --title <title>\`
  Run a transform (e.g., builtin:yoy for year-over-year)
- \`bm list\` - List available transforms
- \`bm scaffold --name <name>\` - Create new custom transform

## Panels
- Macro Catalog: Browse and search series
- Series Viewer: View charts and data

## Skills
- run-transform: Execute transforms on data
- search-series: Find series by keyword
- create-dashboard: Build dashboards

## Best Practices
1. Always search for series before using them
2. Use \`builtin:yoy\` for year-over-year changes
3. Persist derived series with meaningful IDs
4. Open panels with \`exec_ui\` tool
`;

// ============================================================================
// EXPORT
// ============================================================================

export default {
  id: 'macro-plugin',
  name: 'Macro Plugin',
  version: '0.2.0',
  description: 'Macro-economic timeseries analysis',
  
  // Agent tools
  tools,
  
  // Python SDK for CLI
  pythonDeps,
  
  // UI panels
  panels,
  
  // Skills (prompt templates)
  skills,
  
  // System prompt
  systemPrompt
};
```

---

## Frontend Panel Component

```typescript
// plugins/macro-plugin/front/MacroCatalogPane.tsx

import { useQuery } from '@tanstack/react-query';
import { fetchClient } from '@boring/workspace/shared';

export function MacroCatalogPane() {
  const { data: series, isLoading } = useQuery({
    queryKey: ['macro-catalog'],
    queryFn: async () => {
      const resp = await fetchClient.get('/api/v1/macro/catalog');
      return resp.data;
    }
  });

  if (isLoading) return <div>Loading catalog...</div>;

  return (
    <div className="p-4">
      <h2 className="text-lg font-semibold mb-4">Macro Series Catalog</h2>
      <SearchBar onSearch={handleSearch} />
      <SeriesList items={series} onSelect={handleSelect} />
    </div>
  );
}

function handleSelect(series: SeriesItem) {
  // Open series viewer panel
  dispatchUiCommand({
    type: 'openPanel',
    panelId: 'series-viewer',
    data: { seriesId: series.series_id }
  });
}
```

---

## Python CLI Implementation

```python
# plugins/macro-plugin/sdk/boring_macro/_cli.py

"""CLI entry point: bm run/list/scaffold"""

import argparse
import json
import sys
from pathlib import Path

_BUILTINS_ROOT = Path(__file__).parent.parent / 'transforms/builtins'
_CUSTOM_ROOT = Path(__file__).parent.parent.parent / 'transforms/custom'

def main(argv=None):
    parser = argparse.ArgumentParser(prog='bm')
    subparsers = parser.add_subparsers(dest='command')
    
    # bm run
    run_parser = subparsers.add_parser('run')
    run_parser.add_argument('--tool', required=True)
    run_parser.add_argument('--input', required=True)
    run_parser.add_argument('--output', required=True)
    run_parser.add_argument('--title', required=True)
    
    # bm list
    subparsers.add_parser('list')
    
    # bm scaffold
    scaffold_parser = subparsers.add_parser('scaffold')
    scaffold_parser.add_argument('--name', required=True)
    
    args = parser.parse_args(argv)
    
    if args.command == 'run':
        return run_transform(args)
    elif args.command == 'list':
        return list_transforms()
    elif args.command == 'scaffold':
        return scaffold_transform(args.name)
    else:
        parser.print_help()
        return 1

def run_transform(args):
    # Load transform, execute, persist result
    transform = resolve_transform(args.tool)
    input_ids = args.input.split(',')
    
    # Execute transform
    frames = load_frames(input_ids)
    output = transform.transform(frames, input_ids)
    
    # Persist
    result = persist_series(
        output_id=args.output,
        title=args.title,
        data=output
    )
    
    print(json.dumps(result))
    return 0

# ... list_transforms, scaffold_transform, etc.

if __name__ == '__main__':
    sys.exit(main())
```

---

## Skill Prompt Template

```markdown
<!-- plugins/macro-plugin/prompts/skills/run-transform.md -->

# Skill: Run Transform

Use this skill to compute derived timeseries from existing data.

## When to Use

- User asks for year-over-year change, moving average, etc.
- User wants to create a new derived series
- User mentions "calculate", "compute", "derive"

## Steps

1. **Identify the transform type**
   - Built-in: `builtin:yoy`, `builtin:ma12`, `builtin:diff`
   - Custom: `custom:<name>` (check with `bm list`)

2. **Identify input series**
   - Ask user which series to use if not specified
   - Use `macro_search` to find series IDs

3. **Run the transform**
   ```bash
   bm run --tool <builtin|custom>:<name> \
          --input <series1,series2> \
          --output <output_id> \
          --title "<Human readable title>"
   ```

4. **Persist the result**
   - The `bm run` command auto-persists
   - Confirm output_id with user

5. **Display the result**
   - Open series viewer: `exec_ui { "type": "openPanel", "panelId": "series-viewer", "data": { "seriesId": "<output_id>" } }`
   - Show chart or data table

## Example

User: "Show me the year-over-year change in CPI"

Assistant:
1. Search for CPI series: `macro_search(query="consumer price index")`
2. Run YoY transform: `bm run --tool builtin:yoy --input CPIAUCSL --output CPIAUCSL_YOY --title "CPI Year-over-Year"`
3. Open viewer: `exec_ui { "type": "openPanel", "panelId": "series-viewer", "data": { "seriesId": "CPIAUCSL_YOY" } }`

## Available Built-in Transforms

- `builtin:yoy` - Year-over-year percentage change (INPUTS=1)
- `builtin:ma12` - 12-month moving average (INPUTS=1)
- `builtin:diff` - Month-over-month difference (INPUTS=1)
- `builtin:ratio` - Ratio of two series (INPUTS=2)

## Custom Transforms

Custom transforms live in `transforms/custom/`. List them with:
```bash
bm list
```

Create new ones with:
```bash
bm scaffold --name my_transform
```
```

---

## System Prompt Append

```markdown
<!-- plugins/macro-plugin/prompts/system-prompt.md -->

## Macro Plugin Capabilities

You have access to macro-economic timeseries tools and data.

### Available Tools

- `execute_sql(query)` - Run read-only SQL on ClickHouse
- `macro_search(query, limit)` - Search 87k+ FRED series
- `get_series_data(series_id, from, to, limit)` - Fetch observations
- `persist_derived_series(output_id, title, input_ids, observations)` - Save derived data

### CLI Commands

Use the `bm` CLI for transform operations:

```bash
bm run --tool builtin:yoy --input <series_id> --output <output_id> --title "<title>"
bm list                          # List available transforms
bm scaffold --name <name>        # Create custom transform
```

### Panels

- **Macro Catalog** (`macro-catalog`): Browse and search series
- **Series Viewer** (`series-viewer`): View charts and data

### Best Practices

1. Search for series before using them
2. Use built-in transforms when possible (`builtin:yoy`, `builtin:ma12`)
3. Always persist derived series with meaningful IDs
4. Open panels to display results to the user
5. Use `exec_ui` to control the UI programmatically

### Data Model

Series have these fields:
- `series_id`: Unique identifier (e.g., "CPIAUCSL")
- `title`: Human-readable name
- `frequency`: "monthly", "quarterly", "annual"
- `units`: "percent", "billions", "index"
- `observations`: Array of {date, value}

### Common Workflows

**Year-over-year change:**
```bash
bm run --tool builtin:yoy --input CPIAUCSL --output CPIAUCSL_YOY --title "CPI YoY"
```

**12-month moving average:**
```bash
bm run --tool builtin:ma12 --input GDP --output GDP_MA12 --title "GDP 12-Month MA"
```

**Custom transform:**
```bash
bm scaffold --name my_custom_transform  # Create template
# Edit transforms/custom/my_custom_transform.py
bm run --tool custom:my_custom_transform --input series1 --output derived1 --title "My Output"
```
```

---

## Plugin Loader Integration

```typescript
// packages/workspace/src/server/pluginLoader.ts

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  
  // Agent tools
  tools: AgentTool[];
  
  // Python SDK (for CLI)
  pythonDeps?: {
    pythonVersion: string;
    dependencies: string[];
    cliCommands: Array<{
      name: string;
      module: string;
      description?: string;
    }>;
  };
  
  // UI panels
  panels: Array<{
    id: string;
    title: string;
    component: () => Promise<any>;
    placement: PanelPlacement;
    icon?: string;
  }>;
  
  // Skills (prompt templates)
  skills: Array<{
    id: string;
    name: string;
    description: string;
    promptFile: string;
    tools: string[];
  }>;
  
  // System prompt
  systemPrompt: string;
}

export async function loadPlugin(pluginPath: string): Promise<PluginManifest> {
  const mod = await import(pathToFileURL(pluginPath).href);
  const manifest = mod.default || mod;
  
  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    tools: manifest.tools || [],
    pythonDeps: manifest.pythonDeps,
    panels: manifest.panels || [],
    skills: manifest.skills || [],
    systemPrompt: manifest.systemPrompt || ''
  };
}
```

---

## Workspace Bootstrap

```bash
#!/bin/bash
# workspace-template/bootstrap.sh

set -e

echo "=== Bootstrapping workspace ==="

# 1. Install NPM deps
echo "Installing NPM dependencies..."
npm install

# 2. Install Python deps (from all plugins)
echo "Installing Python dependencies..."
./setup-python.sh

# 3. Load plugin manifests
echo "Loading plugins..."
for plugin in plugins/*/plugin.mjs; do
    echo "  - $(basename $(dirname "$plugin"))"
done

# 4. Verify CLIs
echo ""
echo "Available CLI commands:"
for cli in $(jq -r '.pythonDeps.cliCommands[].name' plugins/*/python-deps.json 2>/dev/null); do
    echo "  - $cli"
done

echo ""
echo "=== Workspace ready ==="
```

---

## Summary: What Each Plugin Owns

| Component | Location | Purpose |
|-----------|----------|---------|
| **CLI** | `sdk/`, `python-deps.json` | Shell commands for agent (`bm`, `ml-train`) |
| **Tools** | `plugin.mjs#tools` | LLM-callable functions (`execute_sql`, `macro_search`) |
| **Panels** | `front/`, `plugin.mjs#panels` | UI components (catalog, viewer) |
| **Skills** | `prompts/skills/`, `plugin.mjs#skills` | Prompt templates (run-transform, search-series) |
| **System Prompt** | `prompts/system-prompt.md` | Plugin capabilities documentation |

**Each plugin is a self-contained, composable unit!**
