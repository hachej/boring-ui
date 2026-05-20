# PR Review Fix Todo

Tracks fixes for the branch review against `main`.

## P0 — correctness blockers

- [x] Reuse one safe plugin-entry path resolver for `boring.server` imports.
  - Reject unsafe relative paths, absolute paths, null bytes, backslashes, `..`, and symlink escapes.
  - Add tests for unsafe explicit and conventional server entry paths.
- [x] Make hot-loaded plugin contribution semantics correct.
  - Commit catalog contributions with `CatalogRegistry.replaceByPluginId`.
  - Warn and skip provider/binding contributions until dynamic provider mounting is implemented, so partial loads are visible.
  - Add hot-load catalog tests and unsupported provider/binding warning tests.
- [x] Forward `frontPluginHotReload` through `WorkspaceAgentFront`.

## P1 — reload/runtime parity

- [x] Surface `/reload` rebuild diagnostics and caller `beforeReload` warnings.
  - Merge asset-manager restart warnings, rebuild diagnostics, and caller warnings.
  - Return visible warnings when server plugin rebuild fails.
- [x] Fix authenticated hot-reload SSE behavior.
  - Thread `authHeaders` into hot-reload bridge.
  - Use an EventSource URL token fallback for bearer-auth dev hosts or disable with a clear warning when auth cannot be represented.
- [x] Make core embedded hot-reload behavior explicit.
  - Core exposes a symmetric app-level `hotReload?: false` contract on front/server.
  - Core front forces `frontPluginHotReload={false}` and `hotReloadEnabled={false}`; front plugins are passed statically through props.
  - Core server consumes standard workspace plugin entries/packages statically for server/Pi contributions and fails fast if either app-level `hotReload: true` or directory-entry `hotReload: true` is requested. It does not wire plugin hot-reload SSE or asset-manager reload routes.

## P1 — tests

- [x] Integration test for `package.json#boring.defaultPluginPackages` discovery.
- [x] Tests for hot-loaded catalogs add/update/unload.
- [x] Tests for reload restart warnings/diagnostics in route/UI.
- [x] Tests for `frontPluginHotReload` prop passthrough.

## P2 — remove complexity smells

- [x] Remove duplicate manifest/server-entry resolution by using one helper.
- [x] Make server rebuild diagnostic-only unless rebuilt graph becomes live.
- [x] Avoid duplicate scan/preflight work in asset manager/read path.
- [x] Document static-only provider/binding hot-load limitation.
  - Runtime warning documents skipped dynamic providers/bindings; `packages/core/docs/PLUGIN_INTEGRATION.md` documents core static-only plugin integration and hot-reload limits.

## P2 — boring-pi architecture migration (per DECISIONS.md #17)

Locks in the "two entrances, one source of truth" model for plugin-authoring guidance.

- [x] Slim `@hachej/boring-pi` to skills + reference docs only.
  - Moved `references/workspace/templates/*` → `packages/cli/templates/` (CLI is the only consumer).
  - Replaced `resolveCanonicalTemplatesDir`'s walk-up resolver in `scaffoldPlugin.ts` with a 5-line `resolveBundledTemplatesDir` that reads from the CLI's own bundled dir. Kept `templatesDir` as a test escape hatch.
  - `packages/cli/package.json` `files` now includes `"templates/"` so they ship in the tarball; the integration test that installs CLI from pack + scaffolds via `npx` passes.
- [x] Make `@hachej/boring-pi` an explicit runtime dep of `@hachej/boring-workspace`.
  - Already present in `packages/workspace/package.json` as `"@hachej/boring-pi": "workspace:*"`. Verified Pi auto-discovers via the transitive install (`<workspace>/node_modules/@hachej/boring-pi/skills/...`).
- [x] Shrink `boringSystemPrompt.ts` to a pi-style pointer block.
  - Resolves boring-pi's install via `createRequire(import.meta.url).resolve("@hachej/boring-pi/package.json")`.
  - Emits a "## boring-ui plugin authoring documentation" block with 4 absolute-path entries (SKILL.md + `panels.md` / `bridge.md` / `plugins.md`).
  - Graceful fallback when resolve fails: docs block points the agent at `<available_skills>` instead, skill stays discoverable by name.
  - Per-turn prompt size now ~250 tokens of pointer block (was ~600 of inlined guidance); SKILL.md content is only loaded on demand.
- [x] Update DECISIONS.md #17 if the migration reveals constraints that change the rationale.
  - No rationale changes needed. The two-entrance design holds: external Pi agents (npx-only flows) can install `@hachej/boring-pi` standalone; workspace installs get it transitively.

## Design notes

- The CLI `scaffoldPlugin({ templatesDir })` test escape hatch is intentionally retained for focused unit tests. The production path uses bundled `packages/cli/templates/`.

## Progress log

- 2026-05-19: Todo created from parallel review findings.
- 2026-05-20: Worker pass completed P0 fixes; added safe server-entry resolver, catalog hot-load commit/unload, provider/binding skip warning, `WorkspaceAgentFront` hot-reload passthrough, `/reload` diagnostics propagation, bearer-auth SSE disable warning, and focused tests. Deferred core embedded parity and static provider/binding docs as broader follow-up.
- 2026-05-20: Review-fix pass added app-manifest default plugin package discovery coverage, allowed front/Pi-only default packages without server imports, added route-level `/reload` diagnostics response coverage, kept non-fatal diagnostics on the success/warning UI path, and made server rebuild diagnostic-only.
- 2026-05-20: Core static composition pass disabled core front/server hot reload through a symmetric app-level `hotReload?: false` contract, routed core server plugin entries/default packages through the workspace app-server resolver, documented that plugin hot reload is standalone workspace-agent only for now, and made boot-time core plugin `UiBridge` unavailable instead of cross-workspace broadcast.
- 2026-05-20: Scanner cleanup added one-pass `scanBoringPlugins()` and switched the asset manager/default-package Pi snapshot path to use it instead of preflighting and reading with duplicate filesystem work.
- 2026-05-20: Completed the boring-pi migration (DECISIONS #17). Templates moved to `packages/cli/templates/`; `boringSystemPrompt.ts` shrunk to a Pi-style pointer block resolved via `require.resolve("@hachej/boring-pi/package.json")`; `<available_skills>` and pointer block both reference the same boring-pi install. Eval against qwen3.6-plus: 7/7 plugin-creation tests pass end-to-end with user-voice prompts.
