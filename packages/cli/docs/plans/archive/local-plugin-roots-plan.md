# CLI Plugin Discovery Roots Plan

## Goal

Make `boring-ui` CLI mode discover plugins from the same two Pi-shaped roots users already understand:

1. **Global root** — `~/.pi/agent/extensions/*`
2. **Workspace root** — `<workspace>/.pi/extensions/*`

This plan is about **discovery roots and CLI wiring**. It is not a redesign of plugin authoring, hot reload, or runtime trust modes.

## Why this shape

The repo already treats `.pi/extensions` as the canonical workspace-local plugin authoring location, and the agent runtime already has a global/home-level Pi extension concept under `~/.pi/agent/extensions`.

So the cleanest CLI story is:

- keep using `<workspace>/.pi/extensions/*` for workspace-local plugins
- add/align `~/.pi/agent/extensions/*` as the global discovery root for boring-ui CLI mode
- do **not** invent a second user plugin root under `~/.boring-ui/` or a third workspace-local root under `.agent/`

This keeps the mental model small:

- **Pi roots are where user plugins live**
- **`.boring-ui/` stays CLI app state/config**
- **`.boring-agent/` stays runtime-owned workspace internals**

## Scope boundary

This plan answers only:

- where CLI mode should look for plugins
- how folder mode resolves global + workspace plugin roots
- how workspaces mode resolves global + per-workspace plugin roots
- how those roots feed the existing boring-ui plugin discovery pipeline
- how collisions and malformed entries are diagnosed

Everything else should keep using current boring-ui infrastructure.

## Product goals

### User goals

- I can install a plugin once globally and have it show up in every CLI workspace.
- I can install a plugin only in one workspace.
- I do not need to learn a new root layout beyond Pi’s extension roots.
- Global and local plugin locations are predictable.

### Engineering goals

- Reuse Pi/boring’s existing plugin-shaped filesystem conventions.
- Reuse the current boring-ui plugin pipeline instead of creating a CLI-only one.
- Keep the implementation mostly about root discovery and wiring.
- Make plugin origin and collisions visible.

### Non-goals

- Redesigning hot reload
- Adding file watching
- New plugin manifest shapes
- Dynamic provider/binding mounting
- Auto-build pipelines
- A separate `~/.boring-ui/plugins` root
- Using `.boring-agent/` for user-authored plugins

## Core product decisions

### Decision 1 — use Pi roots for both global and local plugin discovery

CLI plugin discovery roots should be:

- `~/.pi/agent/extensions/*`
- `<workspace>/.pi/extensions/*`

Rationale:

- these are the current Pi-oriented extension concepts already present in the stack
- workspace-local `.pi/extensions` is already the documented boring-ui plugin authoring path
- using the same root family globally and locally is simpler than mixing `.pi` with `~/.boring-ui/plugins`

### Decision 2 — `.boring-ui/` remains CLI state, not plugin storage

Keep:

```txt
~/.boring-ui/workspaces.yaml
```

for CLI-managed app state such as the workspace registry.

Do not turn `~/.boring-ui/` into the canonical plugin root.

### Decision 3 — `.boring-agent/` remains runtime-owned

Do not use:

```txt
<workspace>/.boring-agent/plugins
```

for user-authored plugins.

Latest runtime/provisioning work makes `.boring-agent/` runtime-owned. User plugins belong in `.pi/extensions`, not there.

### Decision 4 — new roots, same plugin pipeline

This feature should not invent a separate CLI plugin runtime.

Instead, CLI mode should feed these global/workspace Pi roots into the existing boring-ui discovery/listing/loading path.

## Filesystem contract

## Global root

```txt
~/.pi/agent/extensions/
  my-plugin/
    package.json
    front/index.tsx
    agent/index.ts
```

## Workspace root

```txt
<workspace>/.pi/extensions/
  my-plugin/
    package.json
    front/index.tsx
    agent/index.ts
```

These are examples only. The accepted layout is whatever the current boring-ui + Pi plugin pipeline already accepts for extension directories.

## Manifest shape

Use the current package shape:

```json
{
  "name": "my-plugin",
  "boring": {
    "label": "My Plugin",
    "front": "front/index.tsx"
  },
  "pi": {
    "systemPrompt": "Use this plugin when relevant.",
    "extensions": ["agent/index.ts"]
  }
}
```

Rules remain whatever current manifest validation already enforces:

- paths must stay inside the plugin dir
- `name` remains plugin identity
- `boring.id` remains invalid

## Discovery model

For a given workspace root, CLI mode should discover plugins from:

1. app/default plugin packages already supported by the host
2. global Pi extension root: `~/.pi/agent/extensions/*`
3. workspace-local Pi extension root: `<workspace>/.pi/extensions/*`

The latter two should be treated as additional discovery roots for the same boring-ui plugin collection pipeline.

## Collision rules

### Decision 5 — duplicate plugin ids are loud, not silent

If the same plugin id appears in more than one discovery root:

- do not silently choose one
- emit a clear diagnostic naming both locations
- skip conflicting entries
- continue loading healthy plugins

This plan does not define override precedence.

## Folder mode behavior

For:

```bash
boring-ui /path/to/project
```

discover from:

- `~/.pi/agent/extensions/*`
- `/path/to/project/.pi/extensions/*`

## Workspaces mode behavior

For:

```bash
boring-ui workspaces
```

discover from:

- `~/.pi/agent/extensions/*` for every workspace
- `<active-workspace-root>/.pi/extensions/*` for the selected workspace

Switching workspaces should change the effective workspace-local discovery root.

## Server architecture

### Shared root resolver

Introduce or reuse a small resolver that, given a concrete workspace root, returns:

```ts
interface CliPluginRoots {
  globalExtensionsRoot: string
  workspaceExtensionsRoot: string
  pluginDirs: string[]
}
```

Responsibilities:

- resolve `~/.pi/agent/extensions`
- resolve `<workspace>/.pi/extensions`
- ignore missing roots
- enumerate candidate plugin directories
- preserve origin metadata for diagnostics

### Origin metadata

The discovery layer should be able to label plugin origin at least as:

- `app-package`
- `pi-global-extension`
- `pi-workspace-extension`

This is mainly for diagnostics and debugging.

## Boot wiring

### Folder mode

Folder mode already uses `createWorkspaceAgentServer()`. The likely work is to ensure the boring plugin discovery layer also sees:

- `~/.pi/agent/extensions`
- `<workspace>/.pi/extensions`

not just the roots it currently scans.

### Workspaces mode

Workspaces mode is more manual today. It needs explicit wiring so that, for each resolved workspace root, the same plugin discovery path can see:

- the shared global Pi root
- that workspace’s `.pi/extensions`

## API / diagnostics changes

## `/api/v1/agent-plugins`

Expose enough metadata to explain where a plugin came from:

- plugin id
- version
- boring metadata
- origin kind
- path/root when safe to expose
- warnings/errors if relevant

## Error reporting

Add targeted diagnostics for:

- duplicate ids across global/local roots
- malformed plugin entries
- invalid path escape
- missing declared files

## Relationship to current CLI/workspace state

Keep these separate:

### Plugin discovery

```txt
~/.pi/agent/extensions/*
<workspace>/.pi/extensions/*
```

### CLI workspace registry

```txt
~/.boring-ui/workspaces.yaml
```

### Runtime-owned workspace internals

```txt
<workspace>/.boring-agent/
```

That separation is the core architectural simplification.

## Implementation phases

## Phase 1 — root resolution + diagnostics

Deliver:

- shared global/workspace Pi root resolver
- plugin directory enumeration
- origin metadata
- duplicate-id diagnostics

Verify:

- unit tests for missing roots, malformed manifests, duplicate ids, and path safety

## Phase 2 — folder mode integration

Deliver:

- folder mode discovery includes `~/.pi/agent/extensions` and `<workspace>/.pi/extensions`
- discovered plugins feed the existing boring-ui plugin pipeline

Verify:

- tests for global-only, workspace-only, and combined discovery

## Phase 3 — workspaces mode integration

Deliver:

- per-workspace `.pi/extensions` discovery
- shared global root discovery
- workspace switching changes the effective workspace-local discovery set

Verify:

- workspace A local plugin is absent in workspace B
- global plugin appears in both

## Phase 4 — docs + diagnostics polish

Deliver:

- docs for global/local Pi roots in CLI mode
- origin metadata in `/api/v1/agent-plugins`
- clear collision diagnostics

Verify:

- docs/examples are coherent
- API/debugging clearly show plugin origin

## Test plan

### Unit

- global root path resolution
- workspace root path resolution
- duplicate id detection across roots
- root merging behavior
- path safety for discovered entries

### Integration

- folder mode server includes both Pi roots in discovery
- `/api/v1/agent-plugins` exposes origin metadata
- invalid plugin does not prevent healthy plugins from loading

### E2E

- start CLI with a plugin under `~/.pi/agent/extensions`
- start CLI with a plugin under `<workspace>/.pi/extensions`
- confirm both are discoverable
- in workspaces mode, switch between two workspaces with different local `.pi/extensions` sets and confirm the discovered set changes

## Open questions

1. Does the current boring-ui plugin asset pipeline already have an easy seam for adding `~/.pi/agent/extensions`, or does it only infer from workspace/plugin-package roots today?
2. In workspaces mode, should plugin origin metadata include workspace id/path context in API output for debugging?
3. Do we want helper CLI commands later for managing global Pi extensions, or is documentation enough?

## Recommended answers for v1

1. Add the smallest seam needed to feed extra discovery roots into the current pipeline.
2. Yes, enough metadata to debug origin cleanly.
3. Docs first, helper commands later.

## Success criteria

This plan is complete when all of the following are true:

1. `boring-ui` folder mode discovers plugins from `~/.pi/agent/extensions/*` and `<workspace>/.pi/extensions/*`.
2. `boring-ui workspaces` discovers global Pi extensions everywhere and workspace-local `.pi/extensions` per workspace.
3. These roots feed the existing boring-ui plugin pipeline rather than a bespoke CLI-only system.
4. Duplicate ids across roots are diagnosable and non-silent.
5. Plugin origin is visible enough to debug whether a plugin came from the global or workspace-local Pi root.

## Suggested next step after this plan

Break into tasks roughly as:

1. root resolution + diagnostics
2. folder mode integration
3. workspaces mode integration
4. docs + examples
