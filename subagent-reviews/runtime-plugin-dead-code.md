# Runtime Plugin Dead Code / Stale Docs Review

Scope inspected: `README.md`, `docs/runtime-plugin*.md`, `packages/workspace/docs`, `packages/cli/templates`, `apps/workspace-playground/workspace/.pi/extensions`, `plugins/_template-full`.

## Findings

### P1 — `packages/workspace/docs/PLUGIN_SYSTEM.md` is materially stale against current plugin API

- **Path:** `packages/workspace/docs/PLUGIN_SYSTEM.md`
- **Evidence:**
  - Lines around §2 say `/reload` “jiti re-imports server entries” and atomically replaces plugin modules. Current plan/README says generated/runtime server is not hot-reloaded and app/internal routes are boot-only.
  - §4.3 still documents `definePlugin(id, factory, options?)` and `BoringFrontFactory` as primary API, while current code and templates use `definePlugin({ id, panels, commands, ... })`.
  - §4.5 references `WorkspaceServerPlugin.extensionFactories` and `requiresRestart`; current code removed plugin-level `extensionFactories` and newer docs distinguish app/internal routes from generated runtime plugins.
- **Action:** Update or split into “current implementation spec” + archive old historical parts. This file is called normative by `packages/workspace/docs/README.md`, so stale content can mislead contributors and agents.
- **Delete/move/update:** Update, or move stale sections to `packages/workspace/docs/plans/archive/` and keep a concise current doc.
- **No-file-deletion risk:** Medium if moving/removing sections; do not delete without explicit approval. Safe path is update-in-place.

### P1 — Missing `PLUGIN_STRUCTURE.md` referenced by repo guidance/archive docs

- **Path(s):**
  - `AGENTS.md` references `packages/workspace/docs/PLUGIN_STRUCTURE.md` as canonical.
  - `packages/workspace/docs/plans/archive/PLUGIN_MODEL.md` and `WORKSPACE_V2_PLAN.md` also point to `../../PLUGIN_STRUCTURE.md`.
- **Evidence:** `packages/workspace/docs/PLUGIN_STRUCTURE.md` does not exist.
- **Action:** Either create a short `PLUGIN_STRUCTURE.md` that points to `runtime-plugin-v2-hot-reload-plan.md`, CLI scaffold, and `_template-full` app/internal template; or update references to existing docs.
- **Delete/move/update:** Add missing doc or update references.
- **No-file-deletion risk:** None if adding/updating references.

### P1 — README still calls `_template-full` the canonical scaffold for new plugins

- **Path:** `README.md`
- **Evidence:**
  - “Start from `plugins/_template-full`” near the plugin-system intro.
  - Plugins table labels “Plugin template” as “Canonical scaffold for new plugins”.
  - Later text clarifies `_template-full` is for publishable packages and CLI is for hot-reload local plugins, but the earlier wording still conflicts with the new plan.
- **Action:** Reword to: `_template-full` is an app/internal or publishable package example; generated/runtime plugins should use `boring-ui scaffold-plugin <name>`.
- **Delete/move/update:** Update docs only.
- **No-file-deletion risk:** None.

### P1 — Runtime scratch plugin `yaml-viewer` violates “no default left tabs” guidance

- **Path:** `apps/workspace-playground/workspace/.pi/extensions/yaml-viewer/front/index.tsx`
- **Evidence:** The plugin defines a live `leftTabs` entry at lines near the bottom. Current README/CLI template says left tabs are opt-in persistent navigation and file visualizers should use surface resolvers.
- **Action:** Remove the left-tab contribution if this scratch plugin remains in the running playground, or reset the playground workspace. Since `apps/workspace-playground/workspace/` is ignored runtime scratch, prefer reset/regenerate rather than committing this plugin.
- **Delete/move/update:** Runtime scratch update/reset. Do not commit as fixture.
- **No-file-deletion risk:** Medium: directory is ignored mutable workspace. Deleting/resetting needs explicit user approval despite being scratch.

### P2 — Runtime scratch plugins contain stale/generated sidecars and examples

- **Path:** `apps/workspace-playground/workspace/.pi/extensions/*`
- **Evidence:**
  - `.boring-signature.json` exists under several runtime plugin dirs; these are machine-managed sidecars.
  - `smoke-cli-fix/front/index.tsx` still comments `import WORKSPACE_OPEN_PATH_SURFACE_KIND from "@hachej/boring-workspace"`, but current correct import is `@hachej/boring-workspace/plugin`.
  - `smoke-cli-fix` is a smoke-test generated plugin with placeholder text, not a curated fixture.
- **Action:** Keep `workspace/` ignored; if used for demos, reset it from real fixtures or regenerate with current CLI after approval. Add/ensure `.boring-signature.json` ignored in any runtime plugin dirs if not covered by workspace ignore.
- **Delete/move/update:** Update/reset scratch workspace; do not promote to committed examples.
- **No-file-deletion risk:** Medium for deleting ignored runtime workspace; ask first.

### P2 — `plugins/_template-full` is useful but confusingly named/positioned

- **Path:** `plugins/_template-full/README.md`, `plugins/_template-full/package.json`
- **Evidence:**
  - README correctly says hot-reload user plugins should use CLI, but also suggests `npx @hachej/boring-ui-cli scaffold-plugin <name>`, which conflicts with the current runtime guidance to use the workspace-local `boring-ui` binary.
  - `package.json` description says “Canonical boring-ui plugin template: imperative BoringFrontFactory demonstrating registerPanel...” while current front uses declarative `definePlugin({ ... })`.
  - README references `plugins/_template/src/test-setup.ts`, which does not exist; should be `_template-full`.
- **Action:** Reword as “app/internal publishable plugin example”; remove `npx` from local generated-plugin guidance; fix description and bad `_template` path.
- **Delete/move/update:** Update docs/package metadata. Longer term move to `plugins/examples/app-plugin-template` or docs examples if desired.
- **No-file-deletion risk:** Low for edits; medium if renaming/moving template.

### P2 — CLI `server-canonical.ts` may still teach generated plugins server shape

- **Path:** `packages/cli/templates/server-canonical.ts`
- **Evidence:** File is explicitly “advanced boot-time/static server integration,” but keeping it in CLI templates beside generated-plugin templates makes it easy for agents/users to discover and copy into `.pi/extensions`.
- **Action:** Consider moving this to an `advanced/` or `app-internal/` template namespace, or ensure scaffold never emits it unless an explicit `--internal-server`/`--app-plugin` flag is provided.
- **Delete/move/update:** Move or rename later; short-term add stronger comment and verifier tests.
- **No-file-deletion risk:** Medium if moving; no deletion needed.

### P2 — Multiple “final/canonical” runtime plan docs can confuse future readers

- **Path:** `docs/runtime-plugin-agent-generation-plan.md`, `docs/runtime-plugin-trust-modes-plan.md`, `docs/runtime-plugin-v2-hot-reload-plan.md`, round synthesis docs.
- **Evidence:** Several docs use status language like “Canonical plan”, “Ready for bead conversion”, and “Final consolidated planning note”. The new `runtime-plugin-v2-hot-reload-plan.md` says it is the final operating plan, but older docs still look authoritative.
- **Action:** Add a one-line banner to older detailed docs: “Detailed review trail; see `runtime-plugin-v2-hot-reload-plan.md` for current operating plan.”
- **Delete/move/update:** Update headers or move review syntheses under `docs/progress/`/archive later.
- **No-file-deletion risk:** Low for header updates; medium if moving files.

### P2 — Package docs README overstates `PLUGIN_SYSTEM.md` currentness

- **Path:** `packages/workspace/docs/README.md`
- **Evidence:** It describes `PLUGIN_SYSTEM.md` as current normative spec and says it contains “implementation-phase history”, while `PLUGIN_SYSTEM.md` itself says implementation phases were retired. This worsens the stale-doc problem above.
- **Action:** Update `README.md` after `PLUGIN_SYSTEM.md` is corrected: mark `PLUGIN_SYSTEM.md` as current only if refreshed; otherwise mark it historical and point to the current runtime plan/CLI docs.
- **Delete/move/update:** Update doc index only.
- **No-file-deletion risk:** None.

## Things inspected that looked OK

- `packages/cli/templates/front-canonical.tsx` now imports from `@hachej/boring-workspace/plugin`, avoids default `leftTabs`, and documents the file visualizer pattern.
- `packages/cli/templates/package-canonical.json` clearly warns that `boring.server` is advanced/static and should be omitted by default.
- `docs/runtime-plugin-v2-hot-reload-plan.md` captures the important app/internal vs runtime/generated plugin distinction and says `_template-full` is not the canonical generated-plugin path.

## Notes

- I did not edit source/docs/templates; only this requested review artifact was written.
- I did not delete ignored runtime workspace files or sidecars because the repository rules require explicit deletion approval.
