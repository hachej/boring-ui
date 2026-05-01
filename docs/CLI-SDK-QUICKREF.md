# CLI/SDK Injection Quick Reference

## Summary

To make custom CLIs/SDKs available to agents in sandboxes:

1. **Package as NPM** - Ship SDKs as NPM packages with `bin/` entries
2. **Install via workspace** - Dependencies go in workspace `package.json`
3. **PATH convention** - Binaries auto-link to `.bin/` which is in sandbox PATH

## For SDK Authors

### Step 1: Create NPM Package Structure

```
my-sdk/
├── package.json
├── bin/
│   └── my-cli.js      # Shebang: #!/usr/bin/env node
├── sdk/
│   └── implementation/
└── README.md
```

### Step 2: package.json

```json
{
  "name": "@boring/my-sdk",
  "version": "1.0.0",
  "bin": {
    "my-cli": "./bin/my-cli.js"
  },
  "files": ["bin", "sdk"]
}
```

### Step 3: CLI Wrapper (Node)

```javascript
#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const cliPath = join(__dirname, '../sdk/implementation/cli.py');
const args = process.argv.slice(2);

spawn('python3', [cliPath, ...args], {
  stdio: 'inherit',
  env: { ...process.env, WORKSPACE_ROOT: process.cwd() }
}).on('exit', code => process.exit(code));
```

### Step 4: Publish

```bash
npm publish  # or pnpm publish
```

## For App Shells (boring-macro, etc.)

### Update Workspace Template

```json
{
  "dependencies": {
    "@boring/macro-sdk": "0.2.0"
  }
}
```

### Keep LLM Tools Separate

```typescript
// Still expose as LLM tools for convenience
import { macroSearch } from '@boring/macro-sdk/sdk/boring_macro/tools';

const macroTools: AgentTool[] = [
  {
    name: 'macro_search',
    description: 'Search macro series (wrapper around `bm search`)',
    async execute(params) {
      return macroSearch(params.query, params.limit);
    }
  }
];
```

## For Users (Agents)

### Using the CLI

```bash
# Available after npm install @boring/macro-sdk
bm run --tool builtin:yoy --input CPIAUCSL --output CPIAUCSL_YOY --title "CPI YoY"

# Or via npx (if not installed)
npx @boring/macro-sdk bm list

# Or full path
./node_modules/.bin/bm scaffold --name my_transform
```

### Using LLM Tools

```
Use tool: macro_search(query="consumer price index", limit=10)
```

## Architecture

```
Host Process                    Sandbox
────────────                    ───────

Plugin Loader                   Workspace Root
  ├─ .pi/extensions/*.js          ├─ node_modules/
  └─ Extract AgentTool[]          │  └─ @boring/macro-sdk/
                                      │  └─ bin/bm.js
                                      └─ .bin/
                                         └─ bm -> ../@boring/macro-sdk/bin/bm.js

Agent calls:                    Agent runs:
  macro_search() → LLM tool       bm run --tool ... → shell command
```

## Key Points

| Concern | Solution |
|---------|----------|
| **Works in all sandbox modes?** | Yes, NPM is universal |
| **Python runtime required?** | Document in README, use Node wrapper |
| **Version control?** | Pin in workspace `package.json` |
| **Multiple SDKs?** | All coexist in `node_modules/` |
| **LLM tools vs CLI?** | Both from same SDK, different interfaces |

## Migration Checklist (boring-macro)

- [ ] Move `sdk/boring_macro/` to proper NPM package structure
- [ ] Add `bin/bm.js` wrapper
- [ ] Update `package.json` with `bin` field
- [ ] Publish to registry (private or public)
- [ ] Update `apps/boring-macro-v2/` to depend on `@boring/macro-sdk`
- [ ] Update `workspace-template/package.json` to include SDK
- [ ] Document `bm` CLI usage in app docs
- [ ] Keep `createMacroTools()` for LLM tool interface
