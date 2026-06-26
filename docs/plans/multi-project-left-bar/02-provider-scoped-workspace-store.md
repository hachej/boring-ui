# 02 — Provider-Scoped Workspace Store

## Purpose

Make the workspace front-end store safe for multiple mounted workspace UIs.

A mounted workspace cache means multiple `WorkspaceProvider` / `WorkspaceAgentFront` instances can exist at the same time. The current store selector pattern is module-global enough that the last provider can win. That must be fixed before a multi-workspace mounted cache ships.

## Current problem

Thermo review identified the hazard:

- `packages/workspace/src/front/store/selectors.ts` keeps a module-level store reference.
- `WorkspaceProvider` calls `bindStore(store)` on mount/initialization.
- Existing selectors/hooks read from that module reference.

With two mounted providers:

- provider B can overwrite the store reference used by provider A's descendants;
- hidden workspace A could read or mutate B's layout state;
- tests may pass in single-provider mode but multi-mount cache is unsafe.

## Desired behavior

- Workspace store access is provider-scoped.
- Hooks/selectors under provider A read provider A's store.
- Hooks/selectors under provider B read provider B's store.
- Existing public APIs remain compatible where possible.
- Single-provider consumers should not need changes.
- Tests prove two providers can be mounted at once without shared/corrupted panel/layout state. Theme/preferences are covered only if they are workspace-scoped in the current store semantics.

## Suggested architecture

Introduce a `WorkspaceStoreContext` in the workspace front store/provider layer:

```ts
const WorkspaceStoreContext = createContext<WorkspaceStoreApi | null>(null)

export function useWorkspaceStoreApi(): WorkspaceStoreApi {
  const store = useContext(WorkspaceStoreContext)
  if (!store) throw new Error('useWorkspaceStoreApi must be used within WorkspaceProvider')
  return store
}
```

Then convert selector hooks from module-bound store to context-bound store:

```ts
export function useWorkspaceSelector<T>(selector: (state: WorkspaceState) => T): T {
  const store = useWorkspaceStoreApi()
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()), ...)
}
```

`WorkspaceProvider` provides its own `store` value. Avoid rebinding a process-wide store for provider descendants.

## Compatibility strategy

Some non-React imperative code may currently use exported `bindStore` / singleton access. Do not rip it out blindly.

Options:

1. Keep `bindStore` only for legacy/singleton compatibility, but stop using it for provider-scoped hooks.
2. Mark singleton access as legacy and avoid it in any multi-mounted path.
3. Add tests ensuring multi-provider hooks use context even if `bindStore` points elsewhere.

## Code locations

- `packages/workspace/src/front/store/selectors.ts`
- `packages/workspace/src/front/store/index.ts`
- `packages/workspace/src/front/provider/WorkspaceProvider.tsx`
- callers of store selector hooks under `packages/workspace/src/front/**`
- tests under `packages/workspace/src/__tests__/WorkspaceProvider.test.tsx` or a new focused store/provider test.

## Tests / acceptance

Create a test mounting two provider trees simultaneously:

```tsx
<WorkspaceProvider workspaceId="a"> <Probe id="a" /> </WorkspaceProvider>
<WorkspaceProvider workspaceId="b"> <Probe id="b" /> </WorkspaceProvider>
```

The probes should:

- use provider-local selector hooks/actions to observe existing state such as panels, active panel, sidebar, panel sizes, or other layout state;
- mutate panel/layout state in A and assert B does not change;
- mutate panel/layout state in B and assert A does not change;
- cover theme/preferences only if they are currently workspace-scoped rather than global user preferences;
- verify selector hooks under A keep reading A even after B mounts later.

Also run existing workspace tests to catch singleton regressions.

## Out of scope

- Mounted workspace cache.
- Router/persistent shell.
- Runtime preboot.
- UI-command bus targeting.

## Risks

- Some existing utility may depend on `getWorkspaceStore()` outside React. If so, do not convert it to context blindly; either keep singleton as explicit legacy or pass store explicitly.
- Theme preference may intentionally be global in some contexts. Distinguish provider-local layout state from global user preference. The test should focus on layout/panels and only cover theme if current store treats it as workspace-scoped.
- This is a prerequisite PR because it can affect many hooks. Keep it behavior-preserving in single-provider mode.


## Thermo review fixes

### Provider self-consumption

`WorkspaceProvider` and `ThemeProvider` currently read store-backed hooks inside the same component that creates/provides the store. A naive context-only selector conversion would throw before the provider exists. Implementation must either:

1. split provider internals into an inner component rendered under `WorkspaceStoreContext.Provider`, or
2. read provider-owned state directly from the local `store` object for provider setup (for example via a local `useStore(store, selector)` helper) before exposing context to descendants.

Acceptance: existing provider boot/theme/document-title tests still pass after selector hooks require context.

### Other module-global mutable state

Store isolation is not only `storeRef`. Audit and either convert or explicitly document/test module globals in `packages/workspace/src/front/store/index.ts`, including:

- `persistenceDisabled`;
- `onQuotaExhausted`;
- any other process-wide mutable state tied to a specific created store.

Quota failure in one workspace must not accidentally notify the most recently created store unless that behavior is intentionally global and tested.

### Test through observable store state

Do not add public `workspaceId`/`layoutKey` state only for tests. Prove isolation through existing observable state/actions: panels, active panel, sidebar, panel sizes, preferences if appropriate.

### Public API compatibility

Selector hooks and legacy store exports are public. The plan must preserve package-root exports and update public API tests rather than deleting them. If `bindStore` remains for legacy imperative paths, document it as singleton/legacy and ensure provider-scoped hooks do not depend on it.
