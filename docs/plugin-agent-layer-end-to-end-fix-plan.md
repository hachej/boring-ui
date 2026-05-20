# Plugin Agent Layer End-to-End Fix Plan

## Goal

Make agent-authored boring-ui plugins work end-to-end:

1. the agent can discover the authoring docs and scaffold command from inside its runtime;
2. generated plugins use the canonical package/front/agent shape;
3. `/reload` loads front + Pi resources;
4. newly loaded front panels become visible to Dockview/SurfaceShell without restart;
5. file visualizer plugins actually intercept file-tree opens;
6. tests/evals catch regressions in the full user flow, not just file existence.

## Diagnosis from live playground failure

The CSV viewer flow failed for several independent reasons:

- `boring-ui scaffold-plugin` was advertised, but no `boring-ui` shim existed in `.boring-agent/bin`, so the agent hit `command not found` and hand-wrote files.
- Prompt docs pointed at host paths that were not readable inside the local bwrap runtime. The agent could not read `boring-plugin-authoring/SKILL.md` and reverse-engineered from stale plugins.
- The generated plugin collided with built-in `csv-viewer`, which the filesystem plugin already uses for raw CSV display.
- Hot-loaded panels were registered in `PanelRegistry`, but some surface UI code used memoized/stale registry-derived lists, so new panel ids did not become openable after `/reload`.
- The final generated plugin registered only a panel. The workspace already supports the correct resolver contract; this was not a core runtime bug. It was an agent-output/eval gap: for the user's requested CSV file-tree behavior, the generated plugin did not add a `WORKSPACE_OPEN_PATH_SURFACE_KIND` resolver, fetch `/api/v1/files/raw`, or render the requested CSV table/chart.
- Existing evals were too shallow: they proved files and reload metadata, not the browser-visible interaction.

## Fix Plan

### Phase 1 — Runtime authoring substrate

**Fixes**

- Provision `@hachej/boring-ui-cli` into `<workspace>/node_modules/@hachej/boring-ui-cli` using the existing runtime provisioning path for plugin/SDK Node packages.
- Copy the CLI package assets needed by scaffold/verify (`package.json`, `dist/`, `templates/`, and other shipped static assets) into the runtime workspace.
- Install a `boring-ui` executable shim into `<workspace>/.boring-agent/bin/` during `createWorkspaceAgentServer()` boot. The shim must call the workspace-local CLI (`$WORKSPACE_ROOT/node_modules/@hachej/boring-ui-cli/dist/index.js`), not server-local `node_modules`.
- Ensure the shim works in direct, local bwrap, and remote sandbox modes wherever provisioning materializes workspace files.
- Keep using the short command in prompts: `boring-ui scaffold-plugin <name>` and `boring-ui verify-plugin`.
- Ensure the scaffold + verify commands operate against `$BORING_AGENT_WORKSPACE_ROOT` / current workspace root, not the repo root.

**Tests**

- Server unit/integration:
  - create a temp workspace through `createWorkspaceAgentServer({ mode: "direct" })`.
  - assert `<workspaceRoot>/node_modules/@hachej/boring-ui-cli/package.json` and `templates/front-canonical.tsx` exist.
  - assert `.boring-agent/bin/boring-ui` exists and is executable.
  - run the shim with `scaffold-plugin demo-plugin <workspaceRoot>` if cheap, or assert shim content points to `$WORKSPACE_ROOT/node_modules/@hachej/boring-ui-cli/dist/index.js`.
- Runtime PATH smoke:
  - through the same runtime path the agent bash tool uses, assert `command -v boring-ui` resolves to `.boring-agent/bin/boring-ui`.
  - assert `echo $PATH` contains `.boring-agent/bin` before generic system bins.
- Local-mode smoke where available:
  - run the same `command -v boring-ui` assertion inside local bwrap mode, not only direct mode.

**Acceptance**

- First agent attempt can run scaffold without searching for repo internals.

### Phase 2 — Sandbox-readable docs and prompts

**Fixes**

- Point `buildBoringSystemPrompt()` docs paths at provisioned workspace-visible package paths when provisioning is enabled:
  - direct: `<workspaceRoot>/node_modules/@hachej/boring-pi/...`
  - local bwrap: `/workspace/node_modules/@hachej/boring-pi/...`
- Keep host `require.resolve` fallback only for non-sandbox/static cases.
- Add prompt warning: file visualizers need `surfaceResolvers` for `WORKSPACE_OPEN_PATH_SURFACE_KIND`; a panel alone is not enough.
- Update `boring-plugin-authoring` skill to prefer `boring-ui scaffold-plugin`, with `npx @hachej/boring-ui-cli ...` only as outside-agent fallback.

**Tests**

- Prompt unit tests:
  - direct/provisioned prompt contains `<workspaceRoot>/node_modules/@hachej/boring-pi/skills/...`.
  - local/provisioned prompt contains `/workspace/node_modules/@hachej/boring-pi/skills/...`.
  - prompt contains the file-visualizer surface resolver warning.
- Existing skill discovery test remains: `/api/v1/agent/skills` includes `boring-plugin-authoring`.

**Acceptance**

- Agent can read the exact skill path it is shown.

### Phase 3 — Hot reload front registry reactivity

**Fixes**

- Audit all front components that derive panel/component lists from `PanelRegistry`.
- Ensure each one subscribes with `useSyncExternalStore(registry.subscribe, registry.getSnapshot, ...)`, not just `[registry]` memo deps.
- Known targets:
  - `SurfaceShell` allowed surface panels.
  - `ArtifactSurfacePane`/`DockviewShell` component allow-list path.
  - `ResponsiveDockviewShell` / `ChatLayout` if they still memoize `registry.getComponents()` on the stable registry object only.

**Tests**

- `SurfaceShell` test:
  - mount with empty/dynamic registry;
  - register a center panel after mount;
  - assert `allowedPanels` passed to `ArtifactSurfacePane` updates.
- `DockviewShell` late-component render test:
  - mount with `allowedPanels={["late-panel"]}` before panel is registered;
  - register `late-panel` after mount;
  - call `api.addPanel({ component: "late-panel" })`;
  - assert the late panel renders in DOM. This is a must-have because Dockview may keep its own internal component map; React registry reactivity alone is not enough unless this passes.
- Regression grep:
  - no `useMemo(() => registry.getComponents(), [registry])` in front code unless accompanied by registry snapshot dependency.

**Acceptance**

- After `/reload`, a new plugin panel can be opened without app restart.

### Phase 4 — Plugin ID collision and surface contract hardening

**Fixes**

- Strengthen docs/examples/scaffold guidance:
  - use namespaced panel ids: `<plugin-id>.panel`, not built-in ids like `csv-viewer`;
  - file visualizer plugins must add `surfaceResolvers` with a score above the default if they intentionally override built-ins;
  - resolver must return its own panel component id, not the built-in component id.
- Add a short reserved-id warning to the plugin authoring prompt/skill. Include common built-ins such as `files`, `code-editor`, `csv-viewer`, `markdown-editor`, `image-viewer`, `pdf-viewer`, `html-viewer`, and `empty-file-panel`.
- Enforce collisions at runtime, not only in docs:
  - if a hot-loaded plugin tries to register a panel/command/catalog/surface id already owned by another plugin or a built-in, reject that plugin contribution;
  - never let hot-loaded user plugins silently replace built-in workspace panels;
  - emit a stable diagnostic code such as `PANEL_ID_COLLISION` / `PLUGIN_OUTPUT_ID_COLLISION` with the conflicting id, existing owner, new plugin id, and a suggested namespaced id.
- `/reload` must not silently succeed when collisions occur:
  - valid plugins should continue to load (partial recovery);
  - the colliding plugin should remain inactive or only partially active if the system can make that atomic and explicit;
  - reload response should include `diagnostics`/`errors` describing the collision;
  - preferred HTTP behavior: `422 { ok:false, diagnostics, plugins }` when any hot plugin fails, while still returning the successfully loaded plugin list.
- Consider making scaffold comments explicit for file visualizer customization.

**Tests**

- Front factory tests:
  - `definePlugin({ surfaceResolvers: [...] })` emits a `surface-resolver` output.
  - duplicate ids within one plugin throw clear `PluginError`.
- Hot reload collision tests:
  - plugin trying to register built-in panel id `csv-viewer` is rejected/warned and does not replace the built-in panel;
  - reload response includes a collision diagnostic with plugin id, conflicting id, owner, and suggested fix such as `<plugin-id>.panel`;
  - other valid plugins still load after the collision;
  - built-in CSV open behavior still works after the failed plugin reload.
- Agent-facing diagnostic test:
  - `/api/v1/agent/reload` body includes enough detail for the agent to repair the plugin without reading server logs.

**Acceptance**

- Agent has clear instructions to avoid `csv-viewer` collision.
- Runtime catches collisions when the agent ignores instructions.
- `/reload` reports collision failures clearly and keeps unaffected plugins alive.

### Phase 5 — Server routes and reload observability

**Fixes**

- Align plugin list routes with the rest of the API:
  - canonical: `/api/v1/agent-plugins`
  - compatibility alias: `/api/agent-plugins`
- Keep/import cache-busting locked:
  - front hot reload import must include the plugin `revision` query parameter, e.g. `import(frontUrl + ?v=<revision>)`.
  - server may expose clean `frontUrl`; the client import path is the critical cache-busting point.
- Ensure reload diagnostics are visible:
  - `/api/v1/agent/reload` response includes plugin scan/rebuild diagnostics and restart warnings.
  - front/plugin inspector can show failed plugin errors from `/api/v1/agent-plugins/:id/error` (with `/api/agent-plugins/:id/error` kept as a compatibility alias).

**Tests**

- Route test:
  - `/api/v1/agent-plugins` and compatibility alias `/api/agent-plugins` return same loaded plugin list.
- Cache-busting regression test:
  - hot reload importer receives the same `frontUrl` with increasing `revision` values after edits.
  - default import path appends `?v=<revision>` / `&v=<revision>` so browser dynamic imports do not reuse stale modules.
- Failure test:
  - bad front path/plugin manifest reports diagnostic without preventing other plugins from loading.

**Acceptance**

- Agent no longer gets misleading `Route GET:/api/v1/agent-plugins not found` while debugging.

## Eval Plan

### Eval A — Authoring substrate eval

**Prompt**

> Create a plugin called `eval-hello-panel` using the scaffold. It should register a panel titled "Eval Hello". Verify it, then ask me to run `/reload`.

**Assertions**

- Transcript/tool calls include successful `boring-ui scaffold-plugin eval-hello-panel`.
- Transcript/tool calls include successful `boring-ui verify-plugin`.
- Plugin package exists under `.pi/extensions/eval-hello-panel`.
- `POST /api/v1/agent/reload` succeeds.
- `GET /api/v1/agent-plugins` includes `eval-hello-panel` with `frontUrl`.
- Browser can open `eval-hello-panel.panel` and render expected text.

### Eval B — CSV visualizer functional eval

**Prompt**

> Make a CSV viewer plugin called `eval-csv-viz`. When I open a `.csv` file from the file tree, it should open your plugin panel, fetch raw file contents, render a real HTML table, and render a small plain SVG chart. Do not use chart libraries. Verify it and ask me to run `/reload`.

**Static assertions**

- Uses scaffold command.
- `package.json#name === "eval-csv-viz"`.
- Front source contains:
  - `definePlugin` from `@hachej/boring-workspace/plugin`;
  - `surfaceResolvers` or `registerSurfaceResolver`;
  - `WORKSPACE_OPEN_PATH_SURFACE_KIND`;
  - `/api/v1/files/raw`;
  - table render (`<table` or `createElement("table")`);
  - SVG render (`<svg` or `createElement("svg")`);
  - no `recharts`, `chart.js`, or `d3` imports.
- Panel id is namespaced and not exactly `csv-viewer`.

**Server reload assertions**

- `/api/v1/agent/reload` returns 200.
- `/api/v1/agent-plugins` includes `eval-csv-viz`.
- Plugin revision bumps on front edit.

**Browser assertions**

- Start workspace playground/test app with a fixture `sample.csv`.
- Trigger file open through a real Playwright interaction with the file tree (for example clicking the tree row for `sample.csv`), not `openPanel` and not only a bridge shortcut.
- Assert active/open panel id or title corresponds to `eval-csv-viz`, not built-in `csv-viewer` raw pane.
- Assert DOM contains:
  - a `<table>` with sample CSV cells;
  - an `<svg>` chart;
  - no raw-only `<pre>` display as primary content.
- Iteration/cache assertion:
  - edit the plugin front source after first successful render, e.g. change a visible marker or SVG color;
  - run `/reload`;
  - assert the browser DOM updates without a full server restart. This catches stale dynamic-import cache and stale registry replacement.

### Eval C — Hot reload late panel eval

**Prompt**

> Create a plugin called `eval-late-panel` with a panel. After I run `/reload`, open the panel.

**Assertions**

- Before reload, panel is absent from `availablePanels`.
- After reload, panel is present.
- `exec_ui openPanel` for the new component results in an open tab and rendered DOM.
- This catches stale `allowedPanels` / Dockview component maps.

### Eval D — Bad plugin recovery eval

**Setup**

- One valid plugin and one invalid plugin under `.pi/extensions`.

**Assertions**

- `/reload` reports diagnostics for invalid plugin.
- Valid plugin remains loaded and openable.
- Error endpoint returns invalid plugin error text.

## Manual playground verification script

1. Start playground on clean ports.
2. Open browser.
3. Ask agent: `create a new CSV viewer plugin that opens .csv files as a table and SVG chart`.
4. Confirm first tool call uses `boring-ui scaffold-plugin` successfully.
5. Confirm it runs `boring-ui verify-plugin` successfully.
6. Run `/reload`.
7. Open `data.csv` from file tree.
8. Confirm custom plugin panel opens instead of built-in raw CSV panel.
9. Confirm table cells and SVG chart are visible.
10. Check server logs for plugin load errors.

## Quality Gates

Run before merge:

```sh
pnpm --filter @hachej/boring-workspace run typecheck
pnpm --filter @hachej/boring-workspace run test
pnpm --filter @hachej/boring-agent run test
pnpm lint:invariants
```

Run evals manually when API keys are available:

```sh
GEMINI_API_KEY=... pnpm --filter @hachej/boring-workspace test src/eval/__tests__/plugin-creation.test.ts
ANTHROPIC_API_KEY=... pnpm --filter @hachej/boring-workspace test src/eval/__tests__/plugin-creation.test.ts
```

## Merge Acceptance Checklist

- [ ] `boring-ui` shim exists and works inside agent runtime, with `.boring-agent/bin` on PATH.
- [ ] Prompt docs paths are runtime-readable.
- [ ] Agent uses scaffold and verify in eval transcript.
- [ ] `/reload` loads plugin metadata and front bundle.
- [ ] New panel is openable after reload without restart.
- [ ] CSV file-tree open routes to plugin resolver, not built-in raw CSV pane.
- [ ] Plugin output collisions with built-ins fail loudly in `/reload` diagnostics and do not replace built-ins.
- [ ] Browser eval proves table + SVG render from actual CSV file contents via real file-tree click.
- [ ] Browser eval proves edit → `/reload` → DOM update without restart.
- [ ] Cache-busted dynamic import is covered by regression test.
- [ ] Invalid plugin does not break valid plugin reload.
- [ ] Dirty playground artifacts are either intentionally ignored or cleaned by test setup.
