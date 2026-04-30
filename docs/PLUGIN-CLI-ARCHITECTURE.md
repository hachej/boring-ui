# Plugin-Provided CLIs Architecture

## Yes! Each Plugin Can Bring Its Own CLI

This is the **ideal design** - each plugin declares what CLIs it provides, and the workspace bootstrap makes them available.

---

## Architecture Overview

```
plugins/
├── macro-plugin/
│   ├── plugin.mjs              # Agent tools (LLM)
│   ├── python-deps.json        # Python SDK requirements
│   └── sdk/
│       └── boring_macro/
│           └── _cli.py         # CLI implementation
│
├── ml-plugin/
│   ├── plugin.mjs
│   ├── python-deps.json
│   └── sdk/
│       └── ml_toolkit/
│           └── _cli.py         # Different CLI
│
└── git-plugin/
    ├── plugin.mjs
    └── python-deps.json        # Maybe no Python, just config
```

**Result:** Agent can run `bm ...` (from macro-plugin) AND `ml-train ...` (from ml-plugin)

---

## Plugin Declaration Format

### python-deps.json (per plugin)

```json
{
  "name": "macro-plugin",
  "pythonVersion": "3.12",
  "dependencies": [
    "pandas>=2.0.0",
    "boring-macro-sdk>=0.2.0"
  ],
  "cliCommands": [
    {
      "name": "bm",
      "module": "boring_macro._cli:main",
      "description": "Macro SDK - run transforms, list series, etc."
    }
  ]
}
```

```json
{
  "name": "ml-plugin",
  "pythonVersion": "3.12",
  "dependencies": [
    "scikit-learn>=1.4.0",
    "xgboost>=2.0.0",
    "boring-ml-sdk>=0.1.0"
  ],
  "cliCommands": [
    {
      "name": "ml-train",
      "module": "ml_toolkit.train:main",
      "description": "Train ML models"
    },
    {
      "name": "ml-predict",
      "module": "ml_toolkit.predict:main",
      "description": "Run predictions"
    }
  ]
}
```

---

## Central Bootstrap (Aggregates All Plugins)

### setup-python.sh

```bash
#!/bin/bash
set -e

WORKSPACE_ROOT="${WORKSPACE_ROOT:-$(pwd)}"
PLUGINS_DIR="$WORKSPACE_ROOT/plugins"

echo "=== Setting up Python environment ==="

# 1. Install uv if not present
if ! command -v uv &> /dev/null; then
    echo "Installing uv..."
    curl -LsSf https://astral.sh/uv/install.sh | sh
    export PATH="$HOME/.local/bin:$PATH"
fi

# 2. Collect all plugin python-deps.json files
echo "Scanning plugins for Python dependencies..."

ALL_DEPS=()
ALL_CLI_COMMANDS=()
MAX_PYTHON_VERSION="3.10"  # Default minimum

for plugin_dir in "$PLUGINS_DIR"/*/; do
    if [ -d "$plugin_dir" ]; then
        plugin_name=$(basename "$plugin_dir")
        deps_file="$plugin_dir/python-deps.json"
        
        if [ -f "$deps_file" ]; then
            echo "  ✓ Found plugin: $plugin_name"
            
            # Extract dependencies
            deps=$(jq -r '.dependencies[]' "$deps_file" 2>/dev/null)
            for dep in $deps; do
                ALL_DEPS+=("$dep")
            done
            
            # Extract CLI commands
            cli_names=$(jq -r '.cliCommands[].name' "$deps_file" 2>/dev/null)
            for cli in $cli_names; do
                ALL_CLI_COMMANDS+=("$cli")
            done
            
            # Track max Python version requirement
            plugin_python_ver=$(jq -r '.pythonVersion // "3.10"' "$deps_file")
            if [[ "$(printf '%s\n' "$MAX_PYTHON_VERSION" "$plugin_python_ver" | sort -V | tail -n1)" != "$MAX_PYTHON_VERSION" ]]; then
                MAX_PYTHON_VERSION="$plugin_python_ver"
            fi
        fi
    fi
done

if [ ${#ALL_DEPS[@]} -eq 0 ]; then
    echo "  No Python dependencies found. Skipping setup."
    exit 0
fi

# 3. Generate pyproject.toml
echo "Generating pyproject.toml..."
DEPS_JSON=$(printf '%s\n' "${ALL_DEPS[@]}" | jq -R . | jq -s .)

cat > "$WORKSPACE_ROOT/pyproject.toml" << EOF
[project]
name = "workspace-python"
version = "0.1.0"
requires-python = ">=$MAX_PYTHON_VERSION"
dependencies = ${DEPS_JSON}
EOF

# 4. Run uv sync (installs ALL plugin deps in one .venv)
echo "Running uv sync (this may take a moment)..."
cd "$WORKSPACE_ROOT"
uv sync

# 5. Export PATH so all CLIs are available
echo "export PATH=\"\$PWD/.venv/bin:\$PATH\"" >> ~/.bashrc
export PATH="$WORKSPACE_ROOT/.venv/bin:$PATH"

# 6. Report available CLIs
echo ""
echo "=== Python environment ready ==="
echo "Available CLI commands from plugins:"
for cli in "${ALL_CLI_COMMANDS[@]}"; do
    echo "  - $cli"
done
echo ""
echo "Test: $(echo "${ALL_CLI_COMMANDS[0]}" | cut -d' ' -f1) --help"
```

---

## Example: Agent Can Use All Plugin CLIs

```bash
# From macro-plugin
bm run --tool custom:ma12 --input CPIAUCSL --output CPIAUCSL_YOY --title "CPI YoY"

# From ml-plugin
ml-train --model xgboost --data training.csv --output model.pkl

# From git-plugin (if it has Python CLI)
git-analyze --repo . --branch main

# All work because they're in the same .venv/bin/PATH
```

---

## Plugin SDK Distribution Options

### Option A: SDK Inside Plugin Directory

```
plugins/macro-plugin/
├── plugin.mjs
├── python-deps.json
└── sdk/
    └── boring_macro/
        ├── __init__.py
        └── _cli.py
```

**pyproject.toml (generated):**
```toml
[project]
dependencies = [
    "pandas>=2.0.0",
]

# Plugin SDK is local, not from PyPI
# Need to add as editable install
```

**setup-python.sh modification:**
```bash
# After uv sync, install plugin SDKs as editable
for plugin_dir in "$PLUGINS_DIR"/*/; do
    sdk_dir="$plugin_dir/sdk"
    if [ -d "$sdk_dir" ]; then
        echo "Installing plugin SDK: $(basename "$plugin_dir")"
        uv pip install -e "$sdk_dir"
    fi
done
```

---

### Option B: SDK as PyPI Package (Recommended)

```
plugins/macro-plugin/
├── plugin.mjs
└── python-deps.json  # References PyPI package
```

**python-deps.json:**
```json
{
  "dependencies": [
    "pandas>=2.0.0",
    "boring-macro-sdk>=0.2.0"  # Published to PyPI
  ],
  "cliCommands": [
    {
      "name": "bm",
      "module": "boring_macro._cli:main"
    }
  ]
}
```

**No local SDK needed** - PyPI package ships with CLI entry point.

---

### Option C: Hybrid (Plugin SDK + PyPI)

```
plugins/macro-plugin/
├── plugin.mjs
├── python-deps.json
└── sdk/  # Custom transforms, not the CLI itself
    └── transforms/
        └── custom/
```

**python-deps.json:**
```json
{
  "dependencies": [
    "pandas>=2.0.0",
    "boring-macro-sdk>=0.2.0"  # Core SDK from PyPI
  ],
  "cliCommands": [
    {
      "name": "bm",
      "module": "boring_macro._cli:main"
    }
  ]
}
```

**Setup:**
```bash
# Install core SDK from PyPI
uv sync

# Install custom transforms as editable
cd "$WORKSPACE_ROOT/plugins/macro-plugin/sdk"
uv pip install -e .
```

---

## Complete Example: Three Plugins

### Plugin 1: Macro Plugin

```json
// plugins/macro-plugin/python-deps.json
{
  "name": "macro-plugin",
  "pythonVersion": "3.12",
  "dependencies": [
    "pandas>=2.0.0",
    "boring-macro-sdk>=0.2.0"
  ],
  "cliCommands": [
    {
      "name": "bm",
      "module": "boring_macro._cli:main",
      "description": "Macro timeseries SDK"
    }
  ]
}
```

### Plugin 2: ML Plugin

```json
// plugins/ml-plugin/python-deps.json
{
  "name": "ml-plugin",
  "pythonVersion": "3.12",
  "dependencies": [
    "scikit-learn>=1.4.0",
    "xgboost>=2.0.0",
    "boring-ml-sdk>=0.1.0"
  ],
  "cliCommands": [
    {
      "name": "ml-train",
      "module": "ml_toolkit.train:main",
      "description": "Train ML models"
    },
    {
      "name": "ml-predict",
      "module": "ml_toolkit.predict:main",
      "description": "Run predictions"
    }
  ]
}
```

### Plugin 3: Data Plugin (No Python CLI)

```json
// plugins/data-plugin/python-deps.json
{
  "name": "data-plugin",
  "pythonVersion": null,
  "dependencies": [],
  "cliCommands": []
}
```

Or just **omit the file** - bootstrap skips plugins without python-deps.json.

---

## Generated pyproject.toml (After Aggregation)

```toml
[project]
name = "workspace-python"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
    "pandas>=2.0.0",
    "boring-macro-sdk>=0.2.0",
    "scikit-learn>=1.4.0",
    "xgboost>=2.0.0",
    "boring-ml-sdk>=0.1.0",
]

# Entry points auto-created by uv from PyPI packages
# bm -> boring_macro._cli:main
# ml-train -> ml_toolkit.train:main
# ml-predict -> ml_toolkit.predict:main
```

---

## Dependency Conflict Resolution

### Scenario: Two Plugins Need Different Versions

```json
// macro-plugin/python-deps.json
{
  "dependencies": ["pandas>=2.0.0"]
}

// ml-plugin/python-deps.json
{
  "dependencies": ["pandas>=2.2.0"]  // Stricter requirement
}
```

**Result:** `uv sync` finds compatible version (pandas>=2.2.0 satisfies both)

### Scenario: Incompatible Versions

```json
// plugin-a/python-deps.json
{
  "dependencies": ["pandas<2.0.0"]
}

// plugin-b/python-deps.json
{
  "dependencies": ["pandas>=2.0.0"]
}
```

**Result:** `uv sync` fails with clear error:
```
error: No solution found when resolving dependencies:
  Because plugin-a requires pandas<2.0.0
  and plugin-b requires pandas>=2.0.0,
  there is no valid solution.
```

**Fix:** Update one plugin to use compatible version.

---

## Version Control: What to Commit

```
workspace-template/
├── package.json              # ✅ Commit
├── pyproject.toml            # ✅ Commit (template, will be regenerated)
├── uv.lock                   # ✅ Commit (locked deps)
├── setup-python.sh           # ✅ Commit
├── .gitignore                # ✅ Commit
│   └── .venv/                # ✅ Ignore virtual env
└── .pi/
    └── extensions.json       # ✅ Commit
```

**Do NOT commit:**
- `.venv/` (regenerated by `uv sync`)
- `__pycache__/`
- `*.pyc`

---

## Summary

### Each Plugin Brings:
1. **plugin.mjs** - Agent tools (LLM-callable)
2. **python-deps.json** - Python SDK requirements + CLI declarations
3. **sdk/** (optional) - Custom Python code/transformation logic

### Workspace Bootstrap Does:
1. Scans all plugins for `python-deps.json`
2. Aggregates dependencies into single `pyproject.toml`
3. Runs `uv sync` (one `.venv` for all plugins)
4. Exposes all CLIs in PATH

### Result:
```bash
# Agent can run any CLI from any plugin
bm run ...          # From macro-plugin
ml-train ...        # From ml-plugin
git-analyze ...     # From git-plugin
```

**Clean, modular, scalable!**
