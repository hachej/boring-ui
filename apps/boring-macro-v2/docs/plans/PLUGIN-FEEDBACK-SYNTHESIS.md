# Plugin Architecture Feedback Synthesis

## Analysis Based on Plugin Spec Review

This document synthesizes feedback based on analysis of:
- `packages/agent/docs/PLUGINS.md`
- `packages/agent/docs/plans/agent-package-spec.md`
- `apps/boring-macro-v2/docs/plans/PLUGIN-DOCK-IMPLEMENTATION.md`

---

## 1. Architecture: Server/Frontend Plugin Separation

### ✅ **Correct Pattern**

The separation aligns with the plugin spec:

**Server Plugin** (matches spec):
```typescript
// packages/agent/docs/PLUGINS.md: "register additional tools into the catalog"
export function makeMacroServerPlugin(macroConfig) {
  return {
    id: 'boring-macro',
    agentTools: createMacroTools(macroConfig), // ← This is the correct seam
    systemPrompt: '...'
  }
}
```

**Frontend Plugin** (extension of spec):
```typescript
// @boring/workspace defines defineFrontPlugin for UI contributions
export const macroFrontendPlugin = defineFrontPlugin({
  id: 'boring-macro',
  panels: [...],
  commands: [...],
  catalogs: [...]
})
```

### ⚠️ **Issue: Plugin Loading in vercel-sandbox**

From `PLUGINS.md`:
> `createAgentApp` disables automatic plugin loading when runtime mode is `vercel-sandbox`.

**Current Plan Problem**:
```typescript
// This won't work in vercel-sandbox:
const app = await createWorkspaceAgentServer({
  mode: 'vercel-sandbox',
  plugins: [makeMacroServerPlugin(macroConfig)] // ← Auto-discovery disabled
})
```

**Fix**: Use `extraTools` for vercel-sandbox:
```typescript
const app = await createWorkspaceAgentServer({
  mode: 'vercel-sandbox',
  extraTools: createMacroTools(macroConfig) // ← Explicit registration
})
```

**Recommendation**: Support both modes:
```typescript
const isVercelSandbox = mode === 'vercel-sandbox'

const app = await createWorkspaceAgentServer({
  mode,
  plugins: isVercelSandbox ? [] : [makeMacroServerPlugin(macroConfig)],
  extraTools: isVercelSandbox ? createMacroTools(macroConfig) : []
})
```

---

## 2. Vercel Sandbox Compatibility

### ⚠️ **Major Gap Identified**

From `PLUGINS.md`:
> Plugin files are discovered via host Node filesystem access, while sandbox workspace/exec are remote.

**Required Changes**:

1. **Template Seeding** (for vercel-sandbox):
```bash
# Include in workspace template:
template/
├── .pi/
│   └── extensions/
│       └── macro-plugin.mjs  # Pre-seeded plugin
```

2. **Manual Registration** (alternative):
```typescript
// App shell explicitly registers tools:
const tools = [
  ...buildFilesystemAgentTools(runtimeBundle),
  ...createMacroTools(macroConfig) // ← Explicit
]
```

3. **Environment Checks**:
```typescript
// In CLI wrapper
if (process.env.SANDBOX_MODE === 'vercel') {
  // Use vercel-specific paths
  WORKSPACE_ROOT = '/vercel/sandbox'
}
```

**Recommendation**: Add a `SANDBOX_MODE` check to the plan.

---

## 3. CLI Distribution Pattern

### ✅ **NPM Packaging is Correct**

From spec analysis, NPM packaging works for both modes:

**For local/direct mode**:
```bash
# NPM auto-links to .bin/
npm install @boring/macro-sdk
# → ~/.npm/.bin/bm or workspace/.bin/bm
```

**For vercel-sandbox mode**:
```bash
# Include in template snapshot
template/
├── node_modules/
│   └── @boring/macro-sdk/
└── .bin/
    └── bm → ../node_modules/@boring/macro-sdk/bin/bm.js
```

### ⚠️ **Python Runtime Requirement**

**Issue**: Sandboxes may not have Python installed.

**Fix**: Document in `README.md`:
```markdown
## Requirements

- Python 3.10+ (pre-installed in sandbox template)
- Or use Node-only fallback: `npx @boring/macro-sdk bm` (slower)
```

**Recommendation**: Add Python runtime check to CLI wrapper:
```javascript
// bin/bm.js
import { spawnSync } from 'node:child_process'
const python = spawnSync('python3', ['--version'])
if (python.error) {
  console.error('Python 3.10+ required. Install via: uv python install 3.12')
  process.exit(1)
}
```

---

## 4. Panel Communication Pattern

### ⚠️ **Event System Should Be Used**

From `packages/workspace/src/front/events/index.ts`:
```typescript
export const events = {
  on: (channel: string, handler: Handler) => void
  emit: (channel: string, data: unknown) => void
}
```

**Current Plan Problem**:
```typescript
// Using raw CustomEvent (not recommended)
window.dispatchEvent(new CustomEvent('macro:open-series', { ... }))
```

**Fix**: Use workspace events:
```typescript
import { events } from '@boring/workspace'

// In MacroCatalogPane
events.emit('macro:open-series', { seriesId: series.series_id })

// In SeriesViewerPane
const off = events.on('macro:open-series', (data) => {
  api.setTitle(data.seriesId)
})
return () => off() // Cleanup
```

### ✅ **Alternative: exec_ui Tool**

For agent-controlled panel opening:
```typescript
// Agent calls:
exec_ui({ type: 'openPanel', panelId: 'series-viewer', params: { seriesId } })
```

**Recommendation**: Use `events` for UI-to-UI, `exec_ui` for agent-to-UI.

---

## 5. Data Flow Architecture

### ⚠️ **Direct API Calls Are Problematic**

**Current Plan**:
```typescript
// In panel
const resp = await fetch(`/api/v1/macro/search?q=${query}`)
```

**Issues**:
1. **Tight coupling** to API endpoints
2. **No agent visibility** into data fetching
3. **Harder to test** (mock fetch vs mock tool)

**Fix**: Use agent tools via `useChat` or similar:
```typescript
// In panel
const { sendMessage } = useChat()
const result = await sendMessage({
  tool_call: {
    name: 'macro_search',
    arguments: { query, limit }
  }
})
```

**Alternative**: Shared data layer:
```typescript
// src/shared/macroData.ts
export const macroData = {
  async search(query: string) {
    // Calls agent tool internally
    const result = await agentClient.callTool('macro_search', { query })
    return result
  }
}

// In panel
const results = await macroData.search(query)
```

**Recommendation**: Use shared data layer that wraps agent tools.

---

## 6. Type Safety

### ✅ **Typed Params Are Correct**

```typescript
definePanel<{ seriesId: string }>({
  id: 'series-viewer',
  component: SeriesViewerPane,
})
```

### ⚠️ **Runtime Validation Missing**

**Issue**: JSON-persisted layouts lose type info:
```typescript
// Restored from JSON:
const params = { seriesId: 123 } // ← Number, not string!

// Panel crashes:
const seriesId = params.seriesId.toUpperCase() // TypeError
```

**Fix**: Add runtime validation:
```typescript
import { z } from 'zod'

const SeriesViewerParams = z.object({
  seriesId: z.string()
})

function SeriesViewerPane({ params }: PaneProps) {
  const validated = SeriesViewerParams.parse(params) // ← Throws if invalid
  // ...
}
```

**Recommendation**: Add zod validation to plan.

---

## 7. Testing Strategy

### ⚠️ **Missing Test Cases**

**Current Plan**:
- Unit tests: `src/plugin/__tests__/server.test.ts`
- E2E tests: `e2e/macro-plugin.spec.ts`

**Missing**:

1. **Mode-specific tests**:
```typescript
// src/plugin/__tests__/vercel-compatibility.test.ts
describe('vercel-sandbox mode', () => {
  it('registers tools via extraTools, not plugins', async () => {
    // Test explicit registration path
  })
})
```

2. **CLI sandbox tests**:
```typescript
// e2e/cli-in-sandbox.spec.ts
test('bm command works in sandbox', async () => {
  const { stdout } = await exec('bm list', { cwd: sandboxPath })
  expect(stdout).toContain('builtin:yoy')
})
```

3. **Panel persistence tests**:
```typescript
// src/front/panes/__tests__/SeriesViewerPane.test.tsx
test('restores from persisted layout', async () => {
  const layout = { groups: [{ panel: 'series-viewer', params: { seriesId: 'CPIAUCSL' } }] }
  // Test panel renders correctly
})
```

4. **Collision tests**:
```typescript
// src/plugin/__tests__/collision-handling.test.ts
test('macro_search tool overrides built-in', async () => {
  // Test last-registered-wins behavior
})
```

**Recommendation**: Add these test files to the plan.

---

## 8. Collision Handling

### ✅ **Spec Defines Precedence**

From `PLUGINS.md`:
> Collision precedence is explicit: last-registered wins.
> Built-in catalog tools → app extraTools → plugin tools

**Implication**:
```typescript
// Plugin tools override built-ins (expected)
tools: [
  { name: 'bash', ... } // ← Overrides built-in bash tool
]

// Later plugins override earlier plugins (warning logged)
plugins: [
  { id: 'plugin-a', tools: [{ name: 'macro_search', ... }] },
  { id: 'plugin-b', tools: [{ name: 'macro_search', ... }] } // ← Wins
]
```

### ⚠️ **Should Namespace Contributions**

**Recommendation**: Prefix tool/panel names:
```typescript
// Instead of:
{ name: 'search', ... }
{ id: 'catalog', ... }

// Use:
{ name: 'macro_search', ... }
{ id: 'macro-catalog', ... }
```

**Collision Detection**:
```typescript
// In plugin loader
if (catalog.has(tool.name)) {
  app.log.warn(`[plugin] Tool "${tool.name}" overridden by plugin ${plugin.id}`)
}
```

**Recommendation**: Enforce naming convention in `defineFrontPlugin` validation.

---

## Summary of Required Changes

| Issue | Severity | Fix |
|-------|----------|-----|
| Vercel sandbox plugin loading | 🔴 Critical | Use `extraTools` for vercel-sandbox |
| Panel communication pattern | 🟡 Medium | Use `events` system, not CustomEvent |
| Data flow architecture | 🟡 Medium | Use shared data layer wrapping agent tools |
| Runtime validation | 🟡 Medium | Add zod validation for panel params |
| Test coverage | 🟡 Medium | Add mode-specific, collision, persistence tests |
| Collision handling | 🟢 Low | Namespace tool/panel names with prefix |
| Python runtime check | 🟢 Low | Add version check to CLI wrapper |

---

## Updated Plan Recommendations

### 1. Add Vercel Compatibility Section

```markdown
## Vercel Sandbox Compatibility

For `vercel-sandbox` mode, plugin auto-discovery is disabled. Use:

```typescript
const app = await createWorkspaceAgentServer({
  mode,
  plugins: mode === 'vercel-sandbox' ? [] : [makeMacroServerPlugin(macroConfig)],
  extraTools: mode === 'vercel-sandbox' ? createMacroTools(macroConfig) : []
})
```

Alternatively, seed plugin files in workspace template.
```

### 2. Update Panel Communication

```typescript
// Use workspace events
import { events } from '@boring/workspace'

events.emit('macro:open-series', { seriesId })
const off = events.on('macro:open-series', handler)
```

### 3. Add Runtime Validation

```typescript
import { z } from 'zod'

const SeriesViewerParams = z.object({
  seriesId: z.string()
})

function SeriesViewerPane({ params }: PaneProps) {
  const validated = SeriesViewerParams.parse(params)
  // ...
}
```

### 4. Add Test Files

```
src/plugin/__tests__/
├── server.test.ts
├── front.test.ts
├── vercel-compatibility.test.ts  # NEW
└── collision-handling.test.ts    # NEW

e2e/
├── macro-plugin.spec.ts
└── cli-in-sandbox.spec.ts        # NEW
```

---

## Next Steps

1. [ ] Update plan with vercel-sandbox compatibility section
2. [ ] Replace CustomEvent with workspace `events` system
3. [ ] Add zod validation for panel params
4. [ ] Add missing test files to plan
5. [ ] Enforce naming convention (macro_ prefix)
6. [ ] Add Python runtime check to CLI wrapper
