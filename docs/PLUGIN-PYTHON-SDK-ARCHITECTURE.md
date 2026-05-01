# Plugin + Python SDK Architecture

## The Question

Should each plugin bring its own Python SDK/`uv` setup, or should there be a central approach?

## Answer: **Plugin-Declared, Centrally Managed**

Each plugin **declares** its Python SDK requirements, but the **workspace manages** the `uv` setup centrally.

---

## Why Not "Each Plugin Brings Its Own"?

### Problem 1: Multiple `uv` Installs

```
Plugin A: installs uv, creates .venv with pandas
Plugin B: installs uv, creates .venv with numpy
Plugin C: installs uv, creates .venv with pandas + numpy

Result: 3 virtual environments, conflicts, bloat
```

### Problem 2: Plugin Isolation Breaks

Plugins load in the **host process** (Node.js), not the sandbox. They can't:
- Write to the sandbox filesystem
- Run `uv sync` inside the sandbox
- Modify the agent's execution environment

### Problem 3: Version Conflicts

```
Plugin A needs pandas>=2.0
Plugin B needs pandas<2.0

Without central management: conflicts, broken sandboxes
```

---

## Recommended Architecture: Plugin-Declared, Centrally Managed

### Concept

1. **Plugin declares** Python SDK requirements (metadata)
2. **Workspace template** has central `uv` setup
3. **Bootstrap script** reads all plugin requirements, runs `uv sync` once

### Directory Structure

```
workspace-template/
├── package.json              # NPM deps
├── pyproject.toml            # Python deps (aggregated from plugins)
├── uv.lock                   # Locked Python deps
├── setup-python.sh           # Central uv bootstrap
├── .pi/
│   └── extensions.json       # Plugin registry
└── plugins/
    ├── macro-plugin/
    │   ├── plugin.mjs        # Plugin definition
    │   └── python-deps.json  # Python SDK requirements
    ├── ml-plugin/
    │   ├── plugin.mjs
    │   └── python-deps.json
    └── data-plugin/
        ├── plugin.mjs
        └── python-deps.json
```

---

## Plugin Declaration Format

### python-deps.json (in each plugin directory)

```json
{
  "name": "macro-plugin",
  "pythonDependencies": [
    "pandas>=2.0.0",
    "clickhouse-connect>=0.7.0",
    "boring-macro-sdk>=0.2.0"
  ],
  "pythonVersion": "3.12",
  "cliCommands": [
    {
      "name": "bm",
      "module": "boring_macro._cli",
      "description": "Macro SDK CLI"
    }
  ]
}
```

### Plugin Definition (plugin.mjs)

```javascript
// plugins/macro-plugin/plugin.mjs
export const tools = [
  {
    name: 'macro_search',
    description: 'Search macro series',
    // ...
  }
];

// Declare Python SDK requirements
export const pythonDeps = {
  dependencies: ['pandas>=2.0.0', 'boring-macro-sdk>=0.2.0'],
  cliCommands: ['bm']
};
```

---

## Central Bootstrap Script

### setup-python.sh

```bash
#!/bin/bash
set -e

WORKSPACE_ROOT="${WORKSPACE_ROOT:-$(pwd)}"
PYTHON_DEPS_FILE="$WORKSPACE_ROOT/.pi/python-deps-aggregate.json"

echo "=== Setting up Python environment ==="

# 1. Install uv if not present
if ! command -v uv &> /dev/null; then
    echo "Installing uv..."
    curl -LsSf https://astral.sh/uv/install.sh | sh
    export PATH="$HOME/.local/bin:$PATH"
fi

# 2. Aggregate Python deps from all plugins
echo "Aggregating Python dependencies from plugins..."

# Find all python-deps.json files
PLUGIN_DEPS=()
for deps_file in "$WORKSPACE_ROOT"/plugins/*/python-deps.json; do
    if [ -f "$deps_file" ]; then
        PLUGIN_DEPS+=("$deps_file")
        echo "  - Found: $deps_file"
    fi
done

if [ ${#PLUGIN_DEPS[@]} -eq 0 ]; then
    echo "No plugin Python dependencies found. Skipping setup."
    exit 0
fi

# 3. Merge dependencies into aggregate file
echo "Merging dependencies..."
jq -s '{
    dependencies: [.[].pythonDependencies] | flatten | unique,
    pythonVersion: (.[].pythonVersion) | unique | first
}' "${PLUGIN_DEPS[@]}" > "$PYTHON_DEPS_FILE"

# 4. Generate pyproject.toml from aggregate
echo "Generating pyproject.toml..."
PYTHON_VERSION=$(jq -r '.pythonVersion' "$PYTHON_DEPS_FILE")
DEPS=$(jq -r '.dependencies | map("\"" + . + "\"") | join(", ")')

cat > "$WORKSPACE_ROOT/pyproject.toml" << EOF
[project]
name = "workspace-python"
version = "0.1.0"
requires-python = ">=${PYTHON_VERSION}"
dependencies = [
    ${DEPS}
]
EOF

# 5. Run uv sync
echo "Running uv sync..."
cd "$WORKSPACE_ROOT"
uv sync

# 6. Export PATH
echo "export PATH=\"\$PWD/.venv/bin:\$PATH\"" >> ~/.bashrc
export PATH="$WORKSPACE_ROOT/.venv/bin:$PATH"

echo "=== Python environment ready ==="
echo "Available CLIs:"
for cli in $(jq -r '.cliCommands[].name' "$PYTHON_DEPS_FILE" 2>/dev/null); do
    echo "  - $cli"
done
```

---

## Plugin Loader Integration

### Extension: Plugin Schema

```typescript
// packages/agent/src/server/harness/pi-coding-agent/pluginLoader.ts

export interface LoadedPlugin {
  source: 'global' | 'local' | 'npm' | 'git';
  path: string;
  tools: AgentTool[];
  // NEW: Python SDK metadata
  pythonDeps?: {
    dependencies: string[];
    pythonVersion?: string;
    cliCommands?: Array<{
      name: string;
      module: string;
      description?: string;
    }>;
  };
}
```

### Plugin Discovery Enhancement

```typescript
// In discoverFromDir or loadModule

async function loadPluginMetadata(pluginPath: string): Promise<{
  tools: AgentTool[];
  pythonDeps?: unknown;
}> {
  const mod = await import(pathToFileURL(pluginPath).href);
  
  // Extract tools
  const tools = extractTools(mod);
  
  // NEW: Extract Python deps if declared
  const pythonDeps = mod.pythonDeps || mod.pythonDependencies;
  
  return { tools, pythonDeps };
}

// Also check for python-deps.json file
async function loadPythonDepsFromFile(pluginPath: string): Promise<unknown> {
  const depsFile = join(pluginPath, 'python-deps.json');
  try {
    const content = await readFile(depsFile, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}
```

---

## Workspace Template Flow

### Step 1: User Creates Workspace

```bash
# Clone template
cp -r workspace-template my-workspace
cd my-workspace

# Install NPM deps
npm install
```

### Step 2: Bootstrap Detects Plugins

```bash
# Postinstall script runs
./setup-python.sh

# Output:
# === Setting up Python environment ===
# Installing uv...
# Aggregating Python dependencies from plugins...
#   - Found: /workspace/plugins/macro-plugin/python-deps.json
#   - Found: /workspace/plugins/ml-plugin/python-deps.json
# Merging dependencies...
# Generating pyproject.toml...
# Running uv sync...
# === Python environment ready ===
# Available CLIs:
#   - bm
#   - ml-train
```

### Step 3: Agent Can Use CLIs

```bash
# Agent runs:
bm run --tool custom:ma12 --input CPIAUCSL --output CPIAUCSL_YOY

# Or:
ml-train --model xgboost --data data.csv
```

---

## Plugin Registration (extensions.json)

### .pi/extensions.json

```json
{
  "plugins": [
    {
      "name": "macro-plugin",
      "path": "./plugins/macro-plugin/plugin.mjs",
      "pythonDeps": "./plugins/macro-plugin/python-deps.json"
    },
    {
      "name": "ml-plugin",
      "path": "./plugins/ml-plugin/plugin.mjs",
      "pythonDeps": "./plugins/ml-plugin/python-deps.json"
    }
  ]
}
```

### Bootstrap Reads This

```bash
# In setup-python.sh
EXTENSIONS_FILE="$WORKSPACE_ROOT/.pi/extensions.json"

if [ -f "$EXTENSIONS_FILE" ]; then
    # Parse extensions and find python-deps.json for each
    PLUGINS=$(jq -r '.plugins[].path' "$EXTENSIONS_FILE")
    for plugin_path in $PLUGINS; do
        deps_file="${plugin_path%/*}/python-deps.json"
        if [ -f "$deps_file" ]; then
            echo "Found plugin: $deps_file"
        fi
    done
fi
```

---

## Alternative: Plugin Ships Its Own SDK (Advanced)

For plugins that want **full control** over their Python SDK:

### Plugin Structure

```
plugins/macro-plugin/
├── plugin.mjs
├── python-deps.json
├── sdk/
│   └── boring_macro/
│       └── _cli.py
└── setup-sdk.sh  # Plugin-specific bootstrap
```

### setup-sdk.sh (in plugin)

```bash
#!/bin/bash
# Plugin-specific SDK setup

PLUGIN_ROOT="$(cd "$(dirname "$0")" && pwd)"

# Install uv if needed
if ! command -v uv &> /dev/null; then
    curl -LsSf https://astral.sh/uv/install.sh | sh
fi

# Create plugin-specific virtual environment
cd "$PLUGIN_ROOT"
uv venv .venv

# Install plugin's Python SDK
uv pip install -e ./sdk

# Export CLI
echo "export PATH=\"\$PLUGIN_ROOT/.venv/bin:\$PATH\"" >> ~/.bashrc
```

### Central Bootstrap Calls Plugin Scripts

```bash
# In setup-python.sh
for plugin_script in "$WORKSPACE_ROOT"/plugins/*/setup-sdk.sh; do
    if [ -f "$plugin_script" ]; then
        echo "Running plugin setup: $plugin_script"
        bash "$plugin_script"
    fi
done
```

**Downside:** Multiple virtual environments, potential conflicts.

---

## Comparison: Approaches

| Approach | Pros | Cons | Recommendation |
|----------|------|------|----------------|
| **Each plugin brings own** | Full isolation, no conflicts | Multiple venvs, bloat, complexity | ❌ Avoid |
| **Plugin-declared, central** | Single venv, fast, clean | Must resolve conflicts | ✅ **Best** |
| **Workspace-defined only** | Simplest | Plugins can't declare deps | ⚠️ Limited |
| **Hybrid (shared + isolated)** | Flexibility | Complex, hard to debug | ⚠️ Advanced |

---

## Migration Path

### Phase 1: Central `uv` Setup (No Plugin Changes)

```bash
# 1. Add setup-python.sh to workspace template
# 2. Create pyproject.toml manually
# 3. Run uv sync in bootstrap

# No plugin changes needed yet
```

### Phase 2: Plugin Declarations

```bash
# 1. Add python-deps.json to each plugin
# 2. Update setup-python.sh to aggregate
# 3. Test with one plugin

# Gradual migration
```

### Phase 3: Full Integration

```bash
# 1. Plugin loader reads pythonDeps
# 2. extensions.json includes pythonDeps path
# 3. Automated aggregation in bootstrap

# Complete workflow
```

---

## Key Takeaways

1. **Plugins declare, workspace manages** - Each plugin specifies Python deps, central bootstrap handles `uv`

2. **Single virtual environment** - All plugins share one `.venv` to avoid conflicts

3. **Extension to plugin schema** - Add `pythonDeps` field to plugin definition

4. **Aggregation in bootstrap** - `setup-python.sh` merges all plugin deps, runs `uv sync` once

5. **CLI commands exposed** - Plugins declare which CLIs they provide, bootstrap adds to PATH

### Recommended Structure

```
workspace-template/
├── setup-python.sh          # Central uv bootstrap
├── pyproject.toml           # Generated from plugins
├── uv.lock                  # Locked deps
├── .pi/
│   └── extensions.json      # Plugin registry
└── plugins/
    ├── macro-plugin/
    │   ├── plugin.mjs
    │   └── python-deps.json  # Declares: pandas, bm CLI
    └── ml-plugin/
        ├── plugin.mjs
        └── python-deps.json  # Declares: scikit-learn, ml-train CLI
```

This gives you **modularity** (each plugin declares its needs) + **simplicity** (one `uv sync`, one `.venv`).
