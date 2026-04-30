# Generic CLI/SDK Injection for Agent Sandboxes

## Problem Statement

We need a **generic mechanism** to make custom CLIs and SDKs available to the agent inside sandboxes. This is distinct from:
- **Agent tools** (LLM-callable functions like `execute_sql`, `macro_search`)
- **Filesystem tools** (read/write/edit/find/grep/ls)

What we want: **shell-accessible commands** that the agent can invoke via `exec` (e.g., `bm run --tool custom:ma12 --input ...`).

## Current State Analysis

### 1. Boring Macro's Current Approach

**Location:** `/home/ubuntu/projects/boring-ui-v2-reorg/apps/boring-macro-v2/sdk/boring_macro/_cli.py`

The macro app ships a Python CLI (`bm`) that:
- Lives in `sdk/boring_macro/_cli.py`
- Discovers transforms from `transforms/builtins/*.py` and `transforms/custom/*.py`
- Provides `bm run`, `bm list`, `bm scaffold` commands
- Is **NOT** currently installed in the sandbox PATH

**How it's wired today:**
- The CLI exists as source code in the repo
- Transform tools are exposed as **LLM tools** via `createMacroTools()` → `agentTools` plugin
- The agent calls `execute_sql`, `macro_search`, etc. as tool invocations
- **The `bm` CLI itself is NOT available as a shell command**

### 2. The New Plugin System (v7.0)

**Location:** `/home/ubuntu/projects/boring-ui-v2-reorg/packages/agent/src/server/harness/pi-coding-agent/pluginLoader.ts`

The plugin system loads **agent tools** from:
- `~/.pi/agent/extensions/*.js` (global)
- `.pi/extensions/*.js` (local, per-workspace)
- `node_modules/pi-plugin-*` (npm packages)

**What plugins DO:**
- Contribute **LLM-callable tools** (`AgentTool[]`)
- Append to system prompt
- Loaded at **server startup** (host process)

**What plugins DON'T DO:**
- Install shell commands in the sandbox
- Modify the sandbox filesystem
- Run inside the sandbox environment

### 3. Sandbox Architecture

**Sandbox modes:**
- **direct** - `child_process.exec` (macOS/Windows dev, no isolation)
- **local** - `bwrap` (Linux, filesystem isolation)
- **vercel-sandbox** - Firecracker microVM (remote, fully isolated)

**Key insight:** The sandbox has its own filesystem substrate. Anything the agent runs via `exec` must exist **inside that filesystem**.

## Generic Solution: Two-Layer Injection

### Layer 1: SDK/CLI Packaging (NPM Package)

Create **installable NPM packages** that ship CLI executables:

```
@boring/macro-sdk/
├── package.json
├── bin/
│   └── bm.js          # Node wrapper or symlink to Python
├── sdk/
│   └── boring_macro/
│       ├── _cli.py    # Actual CLI implementation
│       ├── run_transform.py
│       └── __init__.py
├── transforms/
│   ├── builtins/
│   │   └── yoy.py
│   └── templates/
│       └── transform_template.py
└── README.md
```

**package.json:**
```json
{
  "name": "@boring/macro-sdk",
  "version": "0.2.0",
  "bin": {
    "bm": "./bin/bm.js"
  },
  "files": ["bin", "sdk", "transforms"],
  "engines": {
    "node": ">=18",
    "python": ">=3.10"
  }
}
```

**bin/bm.js:**
```javascript
#!/usr/bin/env node
const { spawn } = require('child_process');
const path = require('path');

const cliPath = path.join(__dirname, '../sdk/boring_macro/_cli.py');
const args = process.argv.slice(2);

spawn('python3', [cliPath, ...args], {
  stdio: 'inherit',
  env: { ...process.env }
}).on('exit', code => process.exit(code));
```

### Layer 2: Installation Mechanisms

#### Option A: Pre-wired Workspace Template (Recommended for v2)

**Concept:** Workspace templates include a `package.json` with SDK dependencies pre-listed.

**Workspace template structure:**
```
workspace-template/
├── package.json
├── .pi/
│   └── extensions.json
└── transforms/
    └── custom/
```

**workspace-template/package.json:**
```json
{
  "name": "macro-workspace",
  "version": "1.0.0",
  "dependencies": {
    "@boring/macro-sdk": "0.2.0"
  },
  "scripts": {
    "postinstall": "npm run link-clis"
  }
}
```

**Installation flow:**
1. User creates workspace from template
2. `pnpm install` runs (or `npm install`)
3. NPM installs `@boring/macro-sdk` to `node_modules/`
4. NPM auto-links binaries to `.bin/bm`
5. Agent's sandbox (which mounts workspace root) sees `bm` in PATH

**How it works:**
- Sandboxes (all modes) have workspace root as their working directory
- `.bin/` is typically in PATH or can be prepended
- Agent runs `bm run ...` → resolves to `workspace/.bin/bm`

#### Option B: Plugin-Driven Installation (Advanced)

**Concept:** A plugin that installs CLIs during sandbox bootstrap.

**Limitation:** Plugins load in the **host process**, not the sandbox. They cannot directly write to the sandbox filesystem.

**Workaround:** Plugin contributes a **tool** that installs the CLI:

```typescript
const installMacroCli: AgentTool = {
  name: 'install_macro_cli',
  description: 'Install the macro SDK CLI into the workspace',
  parameters: {
    type: 'object',
    properties: {
      version: { type: 'string', description: 'SDK version to install' }
    }
  },
  async execute(params) {
    // Use existing filesystem tools to:
    // 1. Write package.json entry
    // 2. Run `npm install` via exec
    // 3. Verify binary is available
    await exec('npm install @boring/macro-sdk@' + (params.version || 'latest'));
    return { content: [{ type: 'text', text: 'bm CLI installed' }] };
  }
};
```

**Downside:** Requires first-turn setup, adds friction.

#### Option C: Docker/Image-Based (For vercel-sandbox)

**Concept:** Custom sandbox images with pre-installed CLIs.

**For vercel-sandbox:**
- Vercel's sandbox runtime is configurable
- Create a custom runtime image with `bm` pre-installed
- Configure sandbox to use custom image

**Limitation:** Only works for remote sandboxes, not local/dev.

## Recommended Approach: Template + NPM

### Why This Works

1. **NPM is universal** - Works across all sandbox modes
2. **No sandbox modification** - Leverages existing package management
3. **Version control** - SDK versions pinned in workspace `package.json`
4. **Composable** - Multiple SDKs can coexist (`@boring/macro-sdk`, `@boring/ml-sdk`, etc.)
5. **Self-documenting** - `package.json` declares what's available

### Implementation Steps

#### Step 1: Publish SDK Packages

Convert existing SDKs to proper NPM packages:

```bash
# For macro SDK
cd /home/ubuntu/projects/boring-ui-v2-reorg/apps/boring-macro-v2/sdk
npm publish  # or pnpm publish, or private registry
```

#### Step 2: Update Workspace Template

```bash
# boring-macro-v2 workspace-template/package.json
{
  "dependencies": {
    "@boring/macro-sdk": "0.2.0"
  }
}
```

#### Step 3: Document PATH Convention

Agent documentation should specify:
- SDK binaries go in `package.json#bin`
- NPM auto-links to `.bin/`
- `.bin/` is in sandbox PATH
- Use commands like `bm`, `npx @boring/macro-sdk bm`, or `./node_modules/.bin/bm`

#### Step 4: Plugin System Enhancement (Optional)

Add a plugin hook for **SDK registration**:

```typescript
// Plugin interface extension
interface ServerPlugin {
  id: string;
  agentTools?: AgentTool[];
  systemPrompt?: string;
  /** SDKs to document in system prompt */
  sdks?: SdkDescriptor[];
}

interface SdkDescriptor {
  name: string;
  command: string;
  description: string;
  docsUrl?: string;
}

// In bootstrapServer.ts
const sdkDocs = finalPlugins
  .flatMap(p => p.sdks ?? [])
  .map(s => `- ${s.command}: ${s.description} (${s.name})`)
  .join('\n');

const systemPromptAppend = `
Available SDKs:
${sdkDocs}

Use these via shell exec:
  ${finalPlugins[0].sdks?.[0]?.command} --help
`;
```

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     Host Process (Node)                      │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  createAgentApp()                                    │   │
│  │  ┌────────────────────────────────────────────┐     │   │
│  │  │  Plugin Loader                             │     │   │
│  │  │  - Loads .pi/extensions/*.js               │     │   │
│  │  │  - Loads node_modules/pi-plugin-*          │     │   │
│  │  │  - Extracts AgentTool[]                    │     │   │
│  │  └────────────────────────────────────────────┘     │   │
│  │                                                      │   │
│  │  ┌────────────────────────────────────────────┐     │   │
│  │  │  createPiCodingAgentHarness()              │     │   │
│  │  │  - Adopts tools for pi-coding-agent        │     │   │
│  │  │  - Creates AgentSession                    │     │   │
│  │  └────────────────────────────────────────────┘     │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ tool calls (LLM → host)
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    Sandbox Environment                       │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Workspace Root (mounted)                            │   │
│  │  ├── node_modules/                                   │   │
│  │  │  ├── @boring/macro-sdk/                          │   │
│  │  │  │  ├── bin/bm.js                                │   │
│  │  │  │  └── sdk/boring_macro/_cli.py                │   │
│  │  │  └── .bin/                                       │   │
│  │  │     └── bm -> ../@boring/macro-sdk/bin/bm.js    │   │
│  │  ├── transforms/                                     │   │
│  │  └── package.json                                   │   │
│  │                                                     │   │
│  │  Agent runs: `bm run --tool custom:ma12`           │   │
│  │  → Resolves to: workspace/.bin/bm                  │   │
│  │  → Executes: node @boring/macro-sdk/bin/bm.js      │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Migration Path for Boring Macro

### Current State
- CLI code exists: `apps/boring-macro-v2/sdk/boring_macro/_cli.py`
- Tools exposed as LLM tools: `createMacroTools()`
- No shell command available

### Target State
1. **Package the CLI:**
   ```bash
   mkdir -p apps/boring-macro-v2/sdk/package
   # Copy files, add package.json, bin/bm.js
   ```

2. **Publish to registry** (private or public)

3. **Update boring-macro-v2 app:**
   - Remove duplicate CLI code
   - Depend on `@boring/macro-sdk`
   - Keep `createMacroTools()` for LLM tool interface

4. **Update workspace template:**
   ```json
   {
     "dependencies": {
       "@boring/macro-sdk": "0.2.0"
     }
   }
   ```

5. **Document for users:**
   - "Install SDK: `npm install @boring/macro-sdk`"
   - "Use CLI: `bm run --tool custom:ma12 ...`"
   - "Or use LLM tools: `execute_sql`, `macro_search`"

## Alternative: SDK-as-Plugin (Hybrid Approach)

For SDKs that want **both** shell commands AND LLM tools:

```typescript
// @boring/macro-sdk/plugin.mjs
import { macroSearch } from './sdk/boring_macro/cli.js';

export const tools = [
  {
    name: 'macro_search',
    description: 'Search macro series (wrapper around `bm search`)',
    parameters: { ... },
    async execute(params) {
      // Call the same logic as the CLI, but as a tool
      return macroSearch(params.query, params.limit);
    }
  }
];
```

**Benefits:**
- Single codebase for CLI and tools
- Plugin auto-discovers and registers tools
- CLI available for manual shell use

## Risks & Considerations

| Risk | Mitigation |
|------|-----------|
| SDK requires Python runtime | Document requirements, use Node wrappers |
| Sandbox has no npm/pnpm | Use pre-installed workspace template |
| Version conflicts | Pin versions in template, use semver |
| Security (arbitrary code exec) | Sandbox isolation, bwrap restrictions |
| Multi-tenancy (shared sandboxes) | Per-workspace node_modules |

## Conclusion

**Recommended pattern:**
1. Ship SDKs as NPM packages with `bin/` entries
2. Use workspace templates to pre-install common SDKs
3. Document `.bin/` PATH convention for agents
4. Keep plugin system for LLM tools only (separation of concerns)

This approach:
- ✅ Works across all sandbox modes
- ✅ Leverages existing NPM ecosystem
- ✅ No sandbox filesystem modification needed
- ✅ Composable and versionable
- ✅ Clear separation: SDKs for shell, plugins for LLM tools
