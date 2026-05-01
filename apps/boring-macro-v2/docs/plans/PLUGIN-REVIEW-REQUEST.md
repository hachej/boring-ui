# Plugin Architecture Review Request

## Context

This plan proposes a **self-contained macro plugin** for the boring-macro-v2 application that provides:
- **CLI**: `bm` command for transform execution
- **Tools**: LLM-callable functions (`execute_sql`, `macro_search`, etc.)
- **Panels**: UI components (MacroCatalog, SeriesViewer)
- **Integration**: Works with both `local` and `vercel-sandbox` modes

## Files to Review

1. **Main Plan**: `apps/boring-macro-v2/docs/plans/PLUGIN-DOCK-IMPLEMENTATION.md`
2. **Plugin Spec**: `packages/agent/docs/PLUGINS.md`
3. **Agent Package Spec**: `packages/agent/docs/plans/agent-package-spec.md`

## Key Questions for Review

### 1. Architecture Alignment

**Question**: Does the separation of server plugin (agent tools) and frontend plugin (panels) align with the plugin architecture in `packages/agent/docs/PLUGINS.md`?

**Current Plan**:
- Server plugin: `makeMacroServerPlugin()` returns `{ id, agentTools, systemPrompt }`
- Frontend plugin: `definePlugin({ panels, commands, catalogs })`

**Concern**: The plugin spec mentions "register additional tools into the catalog" but doesn't clearly define the frontend plugin pattern. Is this the right approach?

---

### 2. Vercel Sandbox Compatibility

**Question**: Does the plan properly account for the vercel-sandbox caveats documented in `PLUGINS.md`?

**From PLUGINS.md**:
> `createAgentApp` disables automatic plugin loading when runtime mode is `vercel-sandbox`. This is intentional: plugin files are discovered via host Node filesystem access, while sandbox workspace/exec are remote.

**Current Plan**:
- Relies on `plugins: [...]` option in `createWorkspaceAgentApp`
- Assumes plugin auto-discovery works

**Concern**: Should we use `extraTools` instead for vercel-sandbox compatibility?

---

### 3. CLI Distribution Pattern

**Question**: Is packaging Python CLI as NPM package with `.bin` entry the right pattern for making CLIs available in sandboxes?

**Current Plan**:
- Package Python code in NPM structure
- Node wrapper (`bin/bm.js`) invokes Python
- Install via `package.json` dependencies
- Expose via `.bin/bm` in sandbox PATH

**Concern**: 
- Does this work in vercel-sandbox mode?
- Should we use `uv` for Python dependency management instead?
- Should the CLI be distributed as a separate PyPI package?

---

### 4. Panel Communication Pattern

**Question**: Is event-based communication (`macro:open-series`) the right pattern for panel-to-panel communication?

**Current Plan**:
```typescript
// In MacroCatalogPane
window.dispatchEvent(new CustomEvent('macro:open-series', {
  detail: { seriesId: series.series_id }
}))

// In SeriesViewerPane
window.addEventListener('macro:open-series', handler)
```

**Concern**: 
- Should we use the workspace `events` system instead? (`packages/workspace/src/front/events`)
- Should we use the `exec_ui` tool for programmatic panel control?
- Is there a better pattern for panel communication?

---

### 5. Data Flow Architecture

**Question**: Should data fetching go through the agent harness instead of direct API calls?

**Current Plan**:
```typescript
// In panels
const resp = await fetch(`/api/v1/macro/search?q=${query}`)
```

**Concern**:
- Should we use agent tools (`macro_search`) instead?
- Should there be a shared data layer?
- How does this work in vercel-sandbox where API endpoints may differ?

---

### 6. Type Safety

**Question**: Is `definePanel<{ seriesId: string }>` sufficient for type safety?

**Current Plan**:
```typescript
definePanel<{ seriesId: string }>({
  id: 'series-viewer',
  component: SeriesViewerPane,
  placement: 'right-tab',
})
```

**Concern**:
- Are params validated at runtime?
- What happens if panel is restored from persisted layout (JSON)?
- Should we use a schema validation library (zod)?

---

### 7. Testing Strategy

**Question**: What's missing from the testing strategy?

**Current Plan**:
- Unit tests: `src/plugin/__tests__/server.test.ts`, `src/plugin/__tests__/front.test.ts`
- E2E tests: `e2e/macro-plugin.spec.ts`

**Concern**:
- Should we test plugin loading in both `local` and `vercel-sandbox` modes?
- Should we test CLI execution in sandbox?
- Should we test panel registration and rendering?

---

### 8. Plugin Collision Handling

**Question**: How do we handle tool/panel name collisions?

**From PLUGINS.md**:
> Collision precedence is explicit: last-registered wins. Built-in catalog tools are registered first, then app `extraTools`, then plugin tools.

**Current Plan**:
- No explicit collision handling

**Concern**:
- What if another plugin registers `macro_search`?
- What if another plugin registers `macro-catalog` panel?
- Should we namespace our contributions?

---

## Review Instructions

**For Claude Code**: Run `cc -p "Review plugin architecture..."` with the review prompt below

**For Codex**: Run `cod exec "Review plugin architecture..."` with the review prompt below

**Review Prompt**:
```
Review this plugin architecture implementation plan for a macro-economic data analysis application. 

Files:
- apps/boring-macro-v2/docs/plans/PLUGIN-DOCK-IMPLEMENTATION.md
- packages/agent/docs/PLUGINS.md
- packages/agent/docs/plans/agent-package-spec.md

Provide critical feedback on:

1. **Architecture**: Does the server/frontend plugin separation align with the plugin spec?
2. **Vercel Compatibility**: Does this properly handle vercel-sandbox caveats?
3. **CLI Distribution**: Is NPM packaging the right pattern for Python CLIs in sandboxes?
4. **Panel Communication**: Is event-based communication the right pattern?
5. **Data Flow**: Should data fetching go through agent tools instead of direct API calls?
6. **Type Safety**: Is the typed params approach sufficient?
7. **Testing**: What's missing from the test strategy?
8. **Collision Handling**: How should we handle tool/panel name collisions?

Be critical and specific. Point out concrete improvements and reference the plugin spec where relevant.
```

---

## Decision Log

After review, document decisions here:

| Decision | Rationale | Source |
|----------|-----------|--------|
| | | |

---

## Action Items

- [ ] Get Claude Code review
- [ ] Get Codex review
- [ ] Address feedback in plan
- [ ] Update implementation accordingly
