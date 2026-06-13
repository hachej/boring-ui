# Plugin Front Factory-Only Migration Plan

## Goal

Make the front plugin API use one convention everywhere:

```ts
export default definePlugin({
  id: "my-plugin",
  label: "My Plugin",
  panels: [],
  commands: [],
  leftTabs: [],
  catalogs: [],
  surfaceResolvers: [],
  providers: [],
  bindings: [],
})
```

The old `WorkspaceFrontPlugin { outputs: [...] }` / `defineFrontPlugin(...)`
shape should stop being an authoring, app, and test convention. Runtime code may
still use an internal captured-registration representation, but public app/plugin
code and tests should speak in factories and captured registrations, not
`outputs[]`.

## Non-goals

- Do not remove files outright in this pass. Repo rule forbids deletion without
  explicit approval; we can stop exporting/using legacy modules first.
- Do not rewrite archived plan docs except for obvious banners if needed.
- Do not change server plugin APIs.
- Do not change the runtime `.pi/extensions` manifest shape.

## Current legacy seams to remove from normal use

- `toWorkspacePlugin(...)` in public `/plugin` exports.
- `WorkspaceFrontPluginInput` in provider/app props.
- Public acceptance of `WorkspaceFrontPlugin` objects in `WorkspaceProvider` and
  `WorkspaceAgentFront`.
- Test assertions against `.outputs`.
- Authoring docs/examples that mention `outputs[]` or `defineFrontPlugin` as a
  valid current pattern.

## Target architecture

### Canonical public type

`BoringFrontFactoryWithId` is the public plugin entry type for front plugins.
It is produced by `definePlugin({ ... })`.

### Internal capture type

`CapturedBoringFrontRegistrations` remains the internal/test representation:

```ts
const api = createCapturingBoringFrontAPI({ pluginId: plugin.pluginId })
plugin(api)
const captured = api.flush()
```

Consumers then read `captured.panels`, `captured.providers`,
`captured.surfaceResolvers`, etc.

### Bootstrap flow

`WorkspaceProvider` should:

1. accept `plugins?: BoringFrontFactoryWithId[]`;
2. include default plugins as factories;
3. capture factories directly;
4. register captured outputs into registries;
5. mount captured providers/bindings from captured arrays.

No `toWorkspacePlugin` normalization at the provider boundary.

## Implementation steps

### Step 1 — Add a factory capture/bootstrap helper

Create or expose a small helper near `frontFactory.ts` that takes a branded
factory and returns:

```ts
interface CapturedFrontPlugin {
  id: string
  label?: string
  registrations: CapturedBoringFrontRegistrations
}
```

It should:

- require `plugin.pluginId`;
- call `createCapturingBoringFrontAPI({ pluginId })`;
- run the factory;
- return `api.flush()`;
- preserve collision detection from the capture API.

If async factories exist, keep the existing runtime hot-load path async, but
static `WorkspaceProvider` bootstrap should continue requiring sync factories.

### Step 2 — Rewrite WorkspaceProvider internals

In `packages/workspace/src/front/provider/WorkspaceProvider.tsx`:

- replace `WorkspaceFrontPluginInput[]` prop with `BoringFrontFactoryWithId[]`;
- capture default/user factories directly;
- replace `bootstrap({ plugins, defaults })` usage or adapt it to captured
  registrations;
- mount providers from `captured.providers`;
- mount bindings from `captured.bindings`;
- build plugin metadata from `plugin.pluginId` / `plugin.pluginLabel`.

### Step 3 — Rewrite WorkspaceAgentFront internals

In `packages/workspace/src/app/front/WorkspaceAgentFront.tsx`:

- remove `toWorkspacePlugin` normalization;
- keep prop type as factory-only;
- extract provider/binding metadata from captured plugin registrations if needed;
- keep hot-loaded agent plugin path unchanged (it already captures factories).

### Step 4 — Convert built-in plugins and tests

Convert tests to direct factory capture:

- `plugins/ask-user/src/front/__tests__/askUserPlugin.test.tsx`
- `plugins/data-catalog/...` if it has output-style tests
- `packages/workspace/src/plugins/filesystemPlugin/front/__tests__/filesystemPlugin.test.ts`
- `packages/workspace/src/__tests__/plugin-integration.test.tsx`
- `packages/workspace/src/front/components/__tests__/CommandPalette.test.tsx`
- `packages/workspace/src/shared/plugins/__tests__/frontFactory.test.tsx`
- `packages/workspace/src/shared/plugins/__tests__/bootstrap.test.ts`

Tests should inspect `captured.providers`, `captured.panels`,
`captured.panelCommands`, `captured.catalogs`, `captured.surfaceResolvers`, and
`captured.bindings` instead of `.outputs`.

### Step 5 — Public API cleanup

In public exports:

- stop exporting `toWorkspacePlugin` from `@hachej/boring-workspace/plugin`;
- stop exporting `WorkspaceFrontPluginInput` publicly;
- keep `defineFrontPlugin` and `WorkspaceFrontPlugin` unexported/internal only
  if legacy bootstrap code still needs them during the transition;
- update `public-api.test.ts` to assert the old API is not public.

### Step 6 — Docs cleanup

Update current docs to say only:

- use `definePlugin({ ... })`;
- generated plugins use `boring-ui-plugin scaffold`;
- `outputs[]` / `defineFrontPlugin` are legacy/internal and not authoring API.

Do not change archived docs except optional historical banners.

## Acceptance criteria

- No non-archive docs teach `defineFrontPlugin(...)` or `outputs[]` as a current
  authoring style.
- `WorkspaceProvider.plugins` and `WorkspaceAgentFront.plugins` accept only
  `BoringFrontFactoryWithId[]`.
- Ask-user tests no longer call `toWorkspacePlugin(askUserPlugin)`.
- Built-in/front tests assert captured registrations, not `.outputs`.
- `toWorkspacePlugin` is not exported from `@hachej/boring-workspace/plugin`.
- Existing runtime `.pi/extensions` hot reload still passes tests.
- Relevant package tests/typechecks pass.

## Risks

- `WorkspaceProvider` currently uses `bootstrap(...)` over `WorkspaceFrontPlugin`
  objects. Replacing it can affect default provider/binding mounting order.
- Some tests use `WorkspaceFrontPlugin` fixtures only as convenient command or
  catalog registration helpers; rewrite them carefully to avoid hiding behavior
  changes.
- Removing public export may break consumers if they already used
  `toWorkspacePlugin`. This is a greenfield repo and current docs already say
  `definePlugin({ ... })` is canonical, so this is acceptable before release.
