# Plugin Front Factory-Only Migration Plan Review

Read-only review of `docs/plugin-front-factory-only-migration-plan.md`.

Note: requested `plan.md` and `progress.md` were not present in the repo root, so this review used the migration plan plus inspected code.

## Findings

### P0

None found.

### P1 — Plan does not explicitly convert the built-in filesystem plugin away from the legacy adapter

Evidence:
- Plan says defaults should be factories (`docs/plugin-front-factory-only-migration-plan.md:69-73`) and lists the filesystem **test** (`:130`), but not the filesystem plugin implementation.
- Current code still imports and calls `boringFrontFactoryToPlugin` in `packages/workspace/src/plugins/filesystemPlugin/front/index.ts:4-7` and exports `filesystemPlugin = createFilesystemPlugin()` at `:195-201`, which is a `WorkspaceFrontPlugin`/`outputs[]` object.
- `WorkspaceProvider` default plugin path currently depends on that legacy object (`packages/workspace/src/front/provider/WorkspaceProvider.tsx:487-490`).

Recommendation:
- Add an explicit implementation step: make `filesystemPlugin` a branded `BoringFrontFactoryWithId` (likely by wrapping `filesystemFront` with `definePlugin({ id: FILESYSTEM_PLUGIN_ID, label: "Filesystem", setup: filesystemFront })`, or by exporting a branded helper), and remove `createFilesystemPlugin()` / `boringFrontFactoryToPlugin` from the normal default path.

### P1 — Captured registrations still include `outputs`, so the legacy path remains easy to keep using

Evidence:
- Plan goal says tests/code should use captured registrations, not `outputs[]` (`docs/plugin-front-factory-only-migration-plan.md:21-25`, `:136-138`).
- Current `CapturedBoringFrontRegistrations` still exposes `outputs: PluginOutput[]` (`packages/workspace/src/shared/plugins/frontFactory.ts:250-257`), capture mutates it on every register call (`:299-333`), and `boringFrontFactoryToPlugin` returns `defineFrontPlugin({ outputs: captured.outputs })` (`:412-428`).

Recommendation:
- Add an explicit phase to remove `outputs` from `CapturedBoringFrontRegistrations` after all callers move off it, or at minimum mark it `@internal @deprecated` and add a `rg '\.outputs\b|outputs\s*:' packages/workspace/src plugins` acceptance check excluding archived/legacy files.
- If file deletion is deferred, leave `defineFrontPlugin.ts` present but unreachable from public/current code.

### P1 — Bootstrap replacement needs a precise registration contract, not just “replace or adapt”

Evidence:
- Plan says to “replace `bootstrap({ plugins, defaults })` usage or adapt it to captured registrations” (`docs/plugin-front-factory-only-migration-plan.md:107-110`).
- Current `bootstrap` does more than loop outputs: it validates `chatPanel`, applies `excludeDefaults`, rejects duplicate plugin ids, stamps owner `pluginId`, and maps left tabs/panels/commands/catalogs/surface resolvers into separate registries (`packages/workspace/src/shared/plugins/bootstrap.ts:24-127`).

Risk:
- A naive rewrite could lose duplicate-plugin-id validation, source plugin ownership, `excludeDefaults`, catalog ownership, or left-tab placement semantics.

Recommendation:
- Add a concrete helper contract such as `captureFrontPlugin(factory)` + `registerCapturedFrontPlugin(captured, registries)` and require parity tests for:
  - duplicate plugin ids throw;
  - `excludeDefaults` still excludes filesystem;
  - owner `pluginId` is set on panels/commands/catalogs/resolvers;
  - left tabs register as panels with `placement: "left-tab"`;
  - provider/binding mounting order matches current behavior.

### P1 — WorkspaceAgentFront depends on plugin outputs for layout decisions; plan under-specifies the replacement

Evidence:
- Plan only says “extract provider/binding metadata from captured plugin registrations if needed” (`docs/plugin-front-factory-only-migration-plan.md:117-122`).
- Current `WorkspaceAgentFront` normalizes plugins and reads `outputs[]` to compute whether left tabs exist and which plugin panels should be included in `shellExtraPanels` (`packages/workspace/src/app/front/WorkspaceAgentFront.tsx:379-395`).

Recommendation:
- Update Step 3 to explicitly compute `hasLeftTabs` from `captured.leftTabs.length > 0` and `pluginPanelIds` from both `captured.panels.map(p => p.id)` and left-tab/panel conventions as needed.
- Add tests covering plugin panels/left-tabs still affect `WorkspaceAgentFront` layout after removing `outputs[]`.

### P2 — Missed test files and API assertions in the implementation checklist

Evidence:
- Plan lists several output-style tests (`docs/plugin-front-factory-only-migration-plan.md:128-134`) but omits `packages/workspace/src/shared/plugins/__tests__/defineFrontPlugin.test.ts`, which directly tests `defineFrontPlugin({ outputs })`.
- `public-api.test.ts` currently expects `pluginApi.toWorkspacePlugin` to exist (`packages/workspace/src/__tests__/public-api.test.ts` from grep result), while acceptance says it should not be exported (`docs/...:168`). Step 5 mentions it, but Step 4 test checklist misses the legacy test file.

Recommendation:
- Add `packages/workspace/src/shared/plugins/__tests__/defineFrontPlugin.test.ts` to the conversion/delete-or-internalize list.
- Add an acceptance check that `@hachej/boring-workspace/plugin` exports `definePlugin` and `createCapturingBoringFrontAPI`, but not `toWorkspacePlugin` or `WorkspaceFrontPluginInput`.

### P2 — PluginError is coupled to the legacy `defineFrontPlugin` module

Evidence:
- `frontFactory.ts` imports `PluginError` from `./defineFrontPlugin` (`packages/workspace/src/shared/plugins/frontFactory.ts:4`).
- `shared/plugins/index.ts` re-exports `PluginError` from the same legacy module (grep result), even though the plan intends `defineFrontPlugin`/`WorkspaceFrontPlugin` to stop being a current convention.

Recommendation:
- Add a small cleanup step to move `PluginError` / `PluginErrorKind` to a neutral module (for example `shared/plugins/errors.ts`) before fully internalizing legacy `defineFrontPlugin.ts`.

### P2 — Provider/binding order needs explicit acceptance coverage

Evidence:
- Current provider nesting is based on flattened plugin `outputs` order and `reduceRight` (`packages/workspace/src/front/provider/WorkspaceProvider.tsx:293-327`). Bindings render by plugin/output order (`:278-288`).
- Plan mentions ordering risk only generally (`docs/plugin-front-factory-only-migration-plan.md:172-175`).

Recommendation:
- Add acceptance tests for provider nesting and binding render order after switching to captured `providers`/`bindings`, especially because filesystem has a provider plus multiple bindings (`packages/workspace/src/plugins/filesystemPlugin/front/index.ts:105-190`).

### P2 — Avoid re-capturing factories in multiple components if possible

Evidence:
- Today both `WorkspaceAgentFront` and `WorkspaceProvider` normalize/capture factories (`WorkspaceAgentFront.tsx:379-387`; `WorkspaceProvider.tsx:491-503`).
- The plan can preserve that accidental double execution if both components independently capture factories.

Recommendation:
- Prefer a shared `useMemo` helper or captured-plugin list passed downward where practical, or document that front factories must be pure registration functions and add a test that side-effectful setup is not run more times than before. At minimum, do not increase capture count beyond current behavior.

### P3 — Wording says “register captured outputs” while the goal is no `outputs[]`

Evidence:
- Plan bootstrap flow says “register captured outputs into registries” (`docs/plugin-front-factory-only-migration-plan.md:72`).

Recommendation:
- Reword to “register captured panels/commands/catalogs/surface resolvers into registries” to avoid carrying the old vocabulary forward.

## Concrete additions to the plan before implementation

1. Add filesystem plugin implementation conversion (`filesystemPlugin` becomes `BoringFrontFactoryWithId`; remove normal use of `boringFrontFactoryToPlugin`).
2. Define `captureFrontPlugin` and `registerCapturedFrontPlugin` helper contracts with bootstrap parity tests.
3. Add `defineFrontPlugin.test.ts` and public API export assertions to the migration checklist.
4. Add an explicit removal/deprecation step for `CapturedBoringFrontRegistrations.outputs` and `boringFrontFactoryToPlugin` normal use.
5. Add `WorkspaceAgentFront` left-tab/panel-id replacement details and tests.
6. Move `PluginError` out of `defineFrontPlugin.ts` or call out why that legacy module remains internal.
7. Add provider/binding order acceptance tests.
