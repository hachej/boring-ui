# Boring Plugins — Agent Doc Embedding

**Last updated:** 2026-05-07  
**Status:** Draft — split from HOT_RELOADABLE_AGENT_PLUGINS_PLAN.md

---

## Problem

The agent that creates inside plugins needs to know boring-ui's plugin API: how to write `front/index.tsx`, what `BoringFrontAPI` methods exist, how `package.json["boring"]` is structured, how `/boring.reload` works, etc.

This knowledge must be available in three distinct scenarios:
1. **Local dev** — workspace running locally with full filesystem access
2. **Hosted/Vercel** — no local filesystem; only what's in the process
3. **Standalone pi** — user's own pi instance connecting to boring-ui via HTTP; no boring-ui source

---

## Two-layer strategy

### Layer 1 — File-based (preferred, all modes)

Docs are Markdown files seeded into `.boring/docs/` at workspace init. The agent reads them via the standard `read` tool — same as any other file in the workspace. No special infrastructure.

```
.boring/docs/
  plugins.md    ← plugin system: file layout, package.json schema, authoring guide, hot-reload, Path A
  panels.md     ← panel registration: BoringFrontAPI, AgentPluginPane, V1 vs V2
  bridge.md     ← V2 postMessage bridge API
```

**Advantages:**
- Agent can re-read at any time (even mid-session)
- Can be updated by the agent itself (via `write` tool) to customise for the project
- Discoverable: `ls .boring/docs/`
- Works in all modes including V2 (sandboxed agent can read files it can see)

**Seeding:** provisioning writes these files at workspace init. They are versioned with boring-ui — when the API changes, the seeded docs update on next workspace init.

### Layer 2 — Inline system prompt (fallback for hosted/Vercel)

`boringSystemPrompt.ts` embeds the same docs as static strings. Used when no `.boring/docs/` directory exists (fresh Vercel deployment with no persistent filesystem).

```ts
// boringSystemPrompt.ts
export function buildBoringSystemPrompt(): string {
  const docsPath = resolveDocsPath()  // BORING_DOCS_PATH env var or auto-detect
  if (docsPath) {
    // Layer 1 — read from disk; inline into system prompt for Vercel sandboxes
    // that mount a read-only workspace image
    return buildFromDocs(docsPath)
  }
  // Layer 2 — static strings baked at build time
  return buildFromStaticStrings()
}
```

The Layer 2 strings are the same Markdown as the Layer 1 files — maintained in `packages/workspace/src/server/docs/` and bundled by tsup. When the API changes, both are updated together.

---

## System prompt structure

Docs are wrapped in XML tags for reliable extraction by the LLM:

```
<boring-ui-docs topic="plugin-system">
{plugins.md content}
</boring-ui-docs>

<boring-ui-docs topic="panel-components">
{panels.md content}
</boring-ui-docs>

<boring-ui-docs topic="ui-bridge">
{bridge.md content}
</boring-ui-docs>
```

The agent is instructed: *"Read the relevant `<boring-ui-docs>` section before writing any plugin code."*

---

## `plugins.md` — content spec

```
# Boring UI Plugin System

## File layout
  front/index.tsx   — BoringFrontFactory (browser only)
  agent/index.ts    — pi ExtensionFactory (Node.js only)   [optional]
  server/index.ts   — Node.js-only hooks                    [optional]
  shared/           — platform-neutral types                 [optional]

## package.json shape
  "boring" field: front, agent, server, label, derivesFrom, panels[], commands[], leftTabs[], surfaceResolvers[]
  "pi" field: { "extensions": ["./agent/index.ts"] }

## BoringFrontAPI
  registerPanel(reg)
  registerPanelCommand(reg)
  registerLeftTab(reg)
  registerSurfaceResolver(reg)

## Agent workflow
  write files → /boring.reload → SSE to browser

## Hot reload
  /boring.reload   — preflight + pi reload + browser SSE
  /reload          — full pi reload (also triggers boring plugin rescan)

## Path A — Derivation
  "derivesFrom": "<baseId>"
  extensionContract: { allowedContributions: [...] }

## Error handling
  .boring/plugins/<id>/.error — read this after a failed reload
  GET /api/agent-plugins/:id/error — same via HTTP

## Import paths (V1 local)
  @boring/workspace/plugin → BoringFrontFactory, BoringFrontAPI
  @mariozechner/pi-coding-agent → ExtensionAPI, defineTool, Type
```

---

## `panels.md` — content spec

```
# Panel Components

## definePanel / PaneProps
## AgentPluginPane
  mode="direct" (V1) — component renders in host tree
  mode="iframe" (V2) — component renders in sandboxed iframe
## Panel registration
  registerPanel({ id, component, label })
  Panel id must match package.json boring.panels[].id
## Surface resolvers
  registerSurfaceResolver({ kind, resolve })
  resolve(ctx) → { panelId } | null
```

---

## `bridge.md` — content spec

```
# V2 postMessage Bridge

Only needed for V2 (sandboxed/hosted mode).
In V1, panels run in host tree and call boring-ui directly.

## Bridge client API
  @boring/workspace/bridge-client  (aliased by esbuild in V2 builds)
  openPanel(panelId: string): void
  showNotification(message: string, level?: string): void
  onInit(cb: (data: { theme, pluginId, panelId, derivedFrom? }) => void): void

## Handshake
  iframe → boring.bridge.ready
  host  → boring.bridge.init { theme, pluginId, panelId, params, derivedFrom? }
  iframe → boring.bridge.rendered
```

---

## `BORING_DOCS_PATH` env var

Override the docs directory path. Used in local dev when the boring-ui source is available but the workspace hasn't been provisioned yet:

```bash
BORING_DOCS_PATH=/path/to/boring-ui/packages/workspace/docs pnpm dev
```

When set, `boringSystemPrompt.ts` reads from this path instead of auto-detecting.

---

## Provisioning flow

At workspace init (`provisionWorkspace()`):

```ts
async function provisionDocs(boringDir: string, docsSourceDir: string): Promise<void> {
  const docsDir = join(boringDir, "docs")
  await mkdir(docsDir, { recursive: true })
  for (const name of ["plugins.md", "panels.md", "bridge.md"]) {
    const src = join(docsSourceDir, name)
    const dst = join(docsDir, name)
    if (!existsSync(dst)) {
      // Seed on first init; never overwrite if user has customised
      await copyFile(src, dst)
    }
  }
}
```

Docs source: `packages/workspace/src/server/docs/` (bundled by tsup via `copy` option, lands in `dist/docs/`).

**Overwrite policy:** never overwrite if the file already exists. The user or agent may have customised the docs for their project. On version upgrade, new files are added but existing ones are not touched.

---

## Agent system prompt injection

`boring-pi-extension.ts` uses pi's `before_agent_start` event to inject dynamic context alongside the static docs:

```ts
api.on("before_agent_start", async (event, ctx) => {
  const activePlugins = [...loaded.values()].map(p => `- ${p.id} (v${p.version})`).join("\n")
  if (activePlugins) {
    return {
      systemPrompt: event.systemPrompt + `\n\nCurrently loaded inside plugins:\n${activePlugins}`
    }
  }
})
```

This means the agent always knows which plugins are currently loaded without needing to call `GET /api/agent-plugins` first.

---

## Doc update strategy

When boring-ui API changes:
1. Update `packages/workspace/src/server/docs/*.md` (source of truth)
2. tsup bundles them into `dist/docs/`
3. New workspaces get the new docs on first `provisionWorkspace()`
4. Existing workspaces: existing `.boring/docs/` files are not overwritten (user may have customised)

For breaking API changes, bump the docs with a migration note at the top.

---

## Implementation TODOs

### A — Docs source files

- [ ] `packages/workspace/src/server/docs/plugins.md` — complete authoring guide (file layout, API, workflow, Path A, errors, examples)
- [ ] `packages/workspace/src/server/docs/panels.md` — panel registration, `AgentPluginPane`, V1 vs V2
- [ ] `packages/workspace/src/server/docs/bridge.md` — postMessage bridge API (V2 only)
- [ ] tsup config: include `src/server/docs/` as static assets in `dist/docs/`

### B — `boringSystemPrompt.ts`

- [ ] `resolveDocsPath()` — check `BORING_DOCS_PATH` env, then `dist/docs/` (flat), then `src/server/docs/` (nested)
- [ ] `buildBoringSystemPrompt()` — reads from disk if available; falls back to static strings
- [ ] Static strings: same content as `*.md` files, inlined at build time (tsup `define` or string import)
- [ ] Wrap in `<boring-ui-docs topic="...">` tags
- [ ] Export from `@boring/workspace/server` subpath

### C — Provisioning

- [ ] `provisionDocs(boringDir, docsSourceDir)` — seeds `.boring/docs/` from `dist/docs/`
- [ ] Overwrite policy: seed only if file does not exist
- [ ] Called from `provisionWorkspace()` at workspace init
- [ ] Provisioning source path resolution: same logic as `resolveDocsPath()`

### D — Dynamic context injection

- [ ] `boring-pi-extension.ts`: `api.on("before_agent_start", ...)` — injects currently loaded plugin list into system prompt
- [ ] Format: simple Markdown list; only injected if `loaded.size > 0`

### E — Agent discoverability

- [ ] `GET /api/agent-plugins` response includes `docsAvailable: boolean` (whether `.boring/docs/` exists and is non-empty)
- [ ] System prompt instructs: "Before writing plugin code, read `.boring/docs/plugins.md` and `.boring/docs/panels.md`"
- [ ] Eval test: agent reads `plugins.md` when asked about plugin creation (already in `plugin-creation.test.ts`)

---

## Out of Scope

- Doc search / RAG — flat file reads are sufficient for current doc size
- Per-plugin docs contributed by the plugin itself — future extension
- i18n / translated docs
- Interactive doc browser panel — future workspace feature
- Automatic doc update on boring-ui package upgrade (only seeds, never overwrites)
