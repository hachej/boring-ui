# Plugin Architecture Summary

## Each Plugin Owns Everything

A plugin is a **self-contained, composable unit** that owns:

```
plugins/<plugin-name>/
├── plugin.mjs              # Main entry point (manifest)
├── python-deps.json        # Python SDK + CLI declarations
├── sdk/                    # Python implementation
│   └── <package>/
│       └── _cli.py
├── front/                  # UI panels
│   └── <Component>.tsx
├── prompts/                # Skills + system prompt
│   ├── system-prompt.md
│   └── skills/
│       └── <skill>.md
└── transforms/             # Custom transform code
    └── custom/
```

---

## What Plugin Declares (in plugin.mjs)

```javascript
export default {
  id: 'macro-plugin',
  name: 'Macro Plugin',
  
  // 1. CLI - Shell commands for agent
  pythonDeps: {
    dependencies: ['pandas>=2.0.0', 'boring-macro-sdk>=0.2.0'],
    cliCommands: [{ name: 'bm', module: 'boring_macro._cli:main' }]
  },
  
  // 2. Tools - LLM-callable functions
  tools: [
    { name: 'execute_sql', ... },
    { name: 'macro_search', ... }
  ],
  
  // 3. Panels - UI components
  panels: [
    { id: 'macro-catalog', component: MacroCatalogPane, placement: 'left-tab' }
  ],
  
  // 4. Skills - Prompt templates
  skills: [
    { id: 'run-transform', promptFile: './prompts/skills/run-transform.md' }
  ],
  
  // 5. System Prompt - Plugin capabilities
  systemPrompt: `You are a macro analyst...`
};
```

---

## Bootstrap Aggregates All Plugins

```bash
# setup-python.sh
for plugin in plugins/*/python-deps.json; do
    # Collect Python deps
    # Collect CLI commands
done

# Single uv sync (one .venv for all plugins)
uv sync

# All CLIs available
bm run ...      # From macro-plugin
ml-train ...    # From ml-plugin
```

---

## Agent Can Use Everything

```bash
# CLI commands (from pythonDeps)
bm run --tool builtin:yoy --input CPIAUCSL --output CPIAUCSL_YOY

# LLM tools (from tools[])
execute_sql(query="SELECT * FROM series_catalog LIMIT 10")
macro_search(query="GDP", limit=10)

# UI panels (from panels[])
# Agent opens panels via exec_ui tool
exec_ui({ type: 'openPanel', panelId: 'macro-catalog' })

# Skills (from skills[])
# Agent uses skill prompts for guidance
```

---

## Key Principles

| Principle | Why |
|-----------|-----|
| **Each plugin owns CLI** | No conflicts, clear ownership |
| **Each plugin owns tools** | Tools are plugin-specific logic |
| **Each plugin owns panels** | UI is plugin-specific |
| **Each plugin owns skills** | Prompt templates are plugin-specific |
| **Central bootstrap** | Single `uv sync`, one `.venv` |
| **Aggregated deps** | `uv` resolves version conflicts |

---

## Documentation

- `docs/FULL-PLUGIN-ARCHITECTURE.md` - Complete architecture with examples
- `docs/PLUGIN-CLI-ARCHITECTURE.md` - CLI distribution details
- `docs/PYTHON-SDK-UV-INTEGRATION.md` - Python SDK + uv setup
- `docs/CLI-SDK-INJECTION-PROPOSAL.md` - Original proposal
- `docs/CLI-SDK-QUICKREF.md` - Quick reference

---

## Quick Start

### 1. Create Plugin Directory

```bash
mkdir -p plugins/my-plugin/{sdk,front,prompts/skills,transforms/custom}
```

### 2. Add plugin.mjs

```javascript
export default {
  id: 'my-plugin',
  name: 'My Plugin',
  tools: [/* ... */],
  pythonDeps: { /* ... */ },
  panels: [/* ... */],
  skills: [/* ... */],
  systemPrompt: '...'
};
```

### 3. Add python-deps.json

```json
{
  "dependencies": ["pandas>=2.0.0"],
  "cliCommands": [{ "name": "my-cli", "module": "my_package._cli:main" }]
}
```

### 4. Implement

- `sdk/my_package/_cli.py` - CLI logic
- `front/MyPane.tsx` - UI component
- `prompts/skills/my-skill.md` - Skill template

### 5. Test

```bash
./bootstrap.sh
my-cli --help
```

**Done! Plugin is loaded and ready.**
