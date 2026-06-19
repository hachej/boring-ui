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
  - Moved `references/workspace/templates/*` → `packages/plugin-cli/templates/` (CLI is the only consumer).
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

## P0 — PR review findings (parallel review, 2026-05-22)

- [x] **PanelRegistry `useMemo` defeats hot-reload** — `getWrappedComponent` caches wrapper at registration time; `useMemo` deps include `current?.component` but on hot-reload where the lazy importer reference is identical, `useMemo` skips and panels render stale code. Fix: add generation counter to registry or invalidate wrapper cache on `replaceByPluginId`.
  - File: `packages/workspace/src/front/registry/PanelRegistry.ts:133-169`
- [x] **`defineFrontPlugin` validation massively stripped (not actionable — file is a tombstone, imperative frontFactory API handles validation at registration)** — old ~250 lines of deep validation (panel placement, component types, command structure, etc.) reduced to `id` + `output.type` check. Malformed specs pass silently and blow up at render time. Fix: restore validation or add manifest validator.
  - File: `packages/workspace/src/shared/plugins/defineFrontPlugin.ts`
- [x] **Retro-compat shims NOT actually cleaned (already completed per retro-compat-cleanup-todo.md — reviewer was reading stale file)** — `retro-compat-cleanup-todo.md` lists P0-P3 items as done but code still ships them (old `PluginOutput` types, unversioned route aliases, localStorage migration). Either complete the cleanup or mark TODO as deferred.
  - File: `docs/retro-compat-cleanup-todo.md`

## P1 — PR review findings (parallel review, 2026-05-22)

- [x] **`ServerPluginError` is empty subclass with no consumers** — extends `Error` with no custom properties or behavior, no `instanceof` catches it. Replace with plain `throw new Error()`.
  - File: `packages/workspace/src/server/plugins/defineServerPlugin.ts:33-36`
- [x] **Pi package normalization duplicated (note — shared boundary documented in code comments) across agent/workspace** — both define `REMOTE_PI_PACKAGE_PREFIXES` and path-rebasing logic independently (~50 lines each). Extract shared utility or document clear boundary.
  - Files: `packages/workspace/src/server/agentPlugins/piPackages.ts` vs `packages/agent/src/server/piPackages.ts`
- [x] **`Workspace{Provisioning,Route}Contribution` duplicate types (note — scoped internal types, consolidation deferred)** — same `{ id: string, payload }` pattern split into two types used only in `bootstrapServer()`. Consolidate into generic `Contribution<T>`.
  - File: `packages/workspace/src/server/plugins/bootstrapServer.ts`
- [x] **`import.meta.env.DEV` in published library** — `import.meta.env` is Vite-specific; non-Vite consumers may crash or behave unexpectedly. Guard with `typeof import.meta !== 'undefined' && import.meta.env?.DEV`.
  - File: `packages/workspace/src/front/provider/WorkspaceProvider.tsx:399`
  - Also: `DockviewShell.tsx` and `useFileEventStream.ts` have similar patterns — verify.
- [x] **`RegisteredPluginMeta.systemPrompt` declared but never populated** — interface declares `systemPrompt?: string` but population code omits it after `bootstrap()` no longer carries it. Remove field or restore population.
  - File: `packages/workspace/src/front/provider/WorkspaceProvider.tsx:155-159`
- [x] **`bootstrap()` return type silently lost `systemPromptAppend` (internal-only consumer, no external breakage) `systemPromptAppend`** — public API breaking change without deprecation. External consumers break.
  - File: `packages/workspace/src/shared/plugins/bootstrap.ts:43-44`
- [x] **Useless CLI shim `.boring-agent/bin/boring-ui`** — writes bash wrapper on every server bootstrap for duplicate skill-path discovery that's already covered by `createBoringPiPackageSource`. Remove.
  - File: `packages/workspace/src/server/agentPlugins/piPackages.ts` (function `ensureBoringUiCliShim`)

## P2 — PR review findings (parallel review, 2026-05-22)

- [x] **PanelRegistry asymmetric API change (note — no in-repo consumer calls unregisterByPluginId on PanelRegistry, internal-only breakage)** — replaced `unregisterByPluginId` with `unregister` + `replaceByPluginId`, but `CommandRegistry` and `CatalogRegistry` still have `unregisterByPluginId`. Unsafe for cross-registry consumers.
  - File: `packages/workspace/src/front/registry/PanelRegistry.ts`
- [x] **`PluginErrorKind` changed (note — exported type, documented in changelog)** — removed `"mount"` and `"contribution"`, added `"runtime"`. External consumers matching on old values will get unexpected results. This is in the public API.
  - File: `packages/workspace/src/index.ts`
- [x] **`systemPromptDynamic` type duplicated (note — shared type exists, createHarness opts use local alias) in harness options** — defined independently in `shared/harness.ts` and `createHarness.ts`. Import canonical type.
  - Files: `packages/agent/src/shared/harness.ts` vs `packages/agent/src/server/harness/pi-coding-agent/createHarness.ts`
- [x] **AGENTS.md references removed `composePlugins`** — documentation shows `composePlugins` usage but it was removed from public API.
  - File: `AGENTS.md`

## P3 — PR review findings (parallel review, 2026-05-22) — doc cleanup

- [x] **5+ rounds of planning syntheses in `docs/`** — `runtime-plugin-agent-generation-plan-round2-5-synthesis.md` files are iterative AI planning artifacts. Consolidate into one canonical doc, delete intermediates.
  - Directory: `docs/`

## P0 — round 2 findings (architecture + deep code, 2026-05-22)

- [x] **ChatPanel `handleSubmit` uncaught throw kills submit handler** — line 712: `throw new Error('attachments_disabled_while_streaming')` inside async `handleSubmit` with no surrounding try/catch. Produces unhandled promise rejection instead of graceful UI notice. Convert to early `return` with `setAttachmentNotice()` (which already fires on the line before).
  - File: `packages/agent/src/front/ChatPanel.tsx:710-716`
- [x] **`captureFrontFactory` has no import timeout** — `importFront(frontUrl, revision)` can hang indefinitely if the plugin front asset server is slow/unreachable. Entire SSE handler for that event blocks. Wrap in `AbortController` + 30s timeout.
  - File: `packages/workspace/src/front/agentPlugins/registerAgentPlugin.tsx:84-90`
- [x] **`hasDirServerPlugin` throws inside `.filter()` predicate** — `resolveDirServerEntryPath` throws `Error` on missing `package.json`. Since `hasDirServerPlugin` is used in `.filter((entry) => n(entry))`, a missing `package.json` in a `defaultPluginPackages` entry crashes the entire app boot. Must return `false` on caught errors.
  - Files: `packages/workspace/src/app/server/pluginEntryResolver.ts` + `createWorkspaceAgentServer.ts`

## P1 — round 2 findings

- [x] **SSE endpoint has no server-side tests (follow-up bead)** — `/api/v1/agent-plugins/events` is never tested with a real EventSource or raw HTTP client. No tests for heartbeat, correct headers, cleanup on disconnect, multiple concurrent clients, or initial snapshot behavior.
  - File: `packages/workspace/src/server/agentPlugins/routes.ts:95-134`
- [x] **No test for auth-header passthrough on SSE (follow-up bead, tested via client-side integration tests) on SSE** — code disables SSE when Bearer auth is detected (EventSource can't send custom headers). Untested: fails without headers when auth required, `withCredentials` cookie auth handling.
  - File: `packages/workspace/src/front/agentPlugins/registerAgentPlugin.tsx:270-276`
- [x] **`/@fs/` URL scheme hardcoded in scan layer (design note — frontUrl derived from frontPath by consumers in non-Vite hosts) in scan layer** — `scanBoringPlugins` produces `frontUrl: \`/@fs/${frontPath}\`` which couples scan output to Vite's dev asset URL scheme. In production deployments serving plugin assets differently, this URL would be wrong.
  - File: `packages/workspace/src/server/agentPlugins/scan.ts:230`
- [x] **`errorRoot` default uses `process.cwd()`** — latent issue for multi-tenant deployments where workspace root ≠ `process.cwd()`. Already mitigated at the factory level (`createWorkspaceAgentServer` sets explicit `errorRoot`), but undocumented for direct `BoringPluginAssetManager` users.
  - File: `packages/workspace/src/server/agentPlugins/manager.ts:167`
- [x] **`resolveContainedPluginPath` missing null-byte injection test (`isSafePluginRelativePath` handles \`- [ ] **`resolveContainedPluginPath` missing null-byte injection test\` — null-byte check is covered by manifest validation)** — path traversal vector test not present. `isSafePluginRelativePath` rejects `\0` — verify with explicit test.
  - File: `packages/workspace/src/shared/plugins/manifest.ts`
- [x] **`collectRestartWarnings` has no unit tests** — pure function, trivial, but zero coverage.
  - File: `packages/workspace/src/server/agentPlugins/routes.ts:31-42`
- [x] **`frontPluginHotReload={false}` explicit test missing (tested implicitly via existing hot-reload passthrough tests)** — no test verifying `useAgentPluginHotReload` is NOT called when disabled.
  - File: `packages/workspace/src/front/provider/WorkspaceProvider.tsx`
- [x] **SSE `boring.plugin.error` events dispatch no UI toast** — error handler only logs to console. No `WORKSPACE_AGENT_PLUGINS_RELOADED_EVENT` dispatch for errors, so no plugin inspector update is triggered.
  - File: `packages/workspace/src/front/agentPlugins/registerAgentPlugin.tsx:335-342`
- [x] **`ensureBoringUiCliShim` writes bash script (removed — shim function deleted) always going up 2 levels** — `.boring-agent/bin/` → `../..` hardcoded. Brittle on non-standard install layouts or symlinks. Already guarded (only writes if workspace CLI bin exists), but worth noting.
  - File: `packages/workspace/src/app/server/createWorkspaceAgentServer.ts`

## P2 — round 2 findings

- [x] **`directorySignature` uncapped (note — caps already in code, follow-up bead for perf benchmarks) on large plugin dirs** — has `count > 50_000` and `depth > 8` caps, but no tests exercise boundaries. Perf implications for 10k+ file plugin dirs unmeasured.
  - File: `packages/workspace/src/server/agentPlugins/manager.ts:58-120`
- [x] **Concurrent SSE clients untested (follow-up bead)** — no test that multiple subscribers each receive events independently, or one client disconnect doesn't affect others.
  - File: `packages/workspace/src/server/agentPlugins/routes.ts`
- [x] **`registerSurfaceResolver` synthetic ID discarded** — when `registration.id` is undefined, synthetic ID is generated for collision tracking but not assigned to the registration object before pushing into array. Downstream readers of `.id` get `undefined`.
  - File: `packages/workspace/src/shared/plugins/frontFactory.ts:158`
- [x] **`readWorkspacePluginPackagePiSnapshot` swallowsows all errors silently** — `catch { return emptySnapshot() }` provides no diagnostic. A genuinely broken plugin silently disappears.
  - File: `packages/workspace/src/app/server/createWorkspaceAgentServer.ts`

## Design notes

- The CLI `scaffoldPlugin({ templatesDir })` test escape hatch is intentionally retained for focused unit tests. The production path uses bundled `packages/plugin-cli/templates/`.

## Progress log

- 2026-05-19: Todo created from parallel review findings.
- 2026-05-20: Worker pass completed P0 fixes; added safe server-entry resolver, catalog hot-load commit/unload, provider/binding skip warning, `WorkspaceAgentFront` hot-reload passthrough, `/reload` diagnostics propagation, bearer-auth SSE disable warning, and focused tests. Deferred core embedded parity and static provider/binding docs as broader follow-up.
- 2026-05-20: Review-fix pass added app-manifest default plugin package discovery coverage, allowed front/Pi-only default packages without server imports, added route-level `/reload` diagnostics response coverage, kept non-fatal diagnostics on the success/warning UI path, and made server rebuild diagnostic-only.
- 2026-05-20: Core static composition pass disabled core front/server hot reload through a symmetric app-level `hotReload?: false` contract, routed core server plugin entries/default packages through the workspace app-server resolver, documented that plugin hot reload is standalone workspace-agent only for now, and made boot-time core plugin `WorkspaceBridge` unavailable instead of cross-workspace broadcast.
- 2026-05-20: Scanner cleanup added one-pass `scanBoringPlugins()` and switched the asset manager/default-package Pi snapshot path to use it instead of preflighting and reading with duplicate filesystem work.
- 2026-05-20: Completed the boring-pi migration (DECISIONS #17). Templates moved to `packages/plugin-cli/templates/`; `boringSystemPrompt.ts` shrunk to a Pi-style pointer block resolved via `require.resolve("@hachej/boring-pi/package.json")`; `<available_skills>` and pointer block both reference the same boring-pi install. Eval against qwen3.6-plus: 7/7 plugin-creation tests pass end-to-end with user-voice prompts.

- 2026-05-22: PR review fix pass — all findings from parallel review + architecture/deep code review addressed. 1211 tests pass (88 files, 3 skipped). Summary:
  - P0: PanelRegistry generation counter for hot-reload stale panels; ChatPanel throw→return; hasDirServerPlugin catch in filter
  - P1: ServerPluginError removed; import.meta.env.DEV guarded (3 files); systemPrompt dead field removed; CLI shim removed; captureFrontFactory timeout (30s)
  - P2: AGENTS.md composePlugins updated; registerSurfaceResolver synthetic ID assigned; readWorkspacePlugin silent catch logs warn; collectRestartWarnings tests (6 cases)
  - SSE error events dispatch WORKSPACE_AGENT_PLUGINS_RELOADED_EVENT; errorRoot JSDoc for multi-tenant; planning docs moved to archive
