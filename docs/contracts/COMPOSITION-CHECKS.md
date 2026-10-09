# Composition checks after a618424f4b9e

Review record for the initial type-only scaffold; not another invariant owner or evidence registry. [CONTRACTS.md](CONTRACTS.md), [SCAFFOLD.md](SCAFFOLD.md), the project laws and acceptance plan own the requirements. Provider, browser, delivery and authorization behavior remain unimplemented.

## Concrete gaps

| Baseline problem | Correction | Evidence scope |
| --- | --- | --- |
| ViewerFeature reconstructed ViewerController<State,Actions,Tools>, hiding EditableViewerController.flush and any additional host methods. | Carry the complete concrete Controller as the feature's generic return type. | Built-declaration consumer compile plus negative-control mutation; not editor behavior. |
| WorkspaceLease constrained all acquisitions to FileSystem even though native Pi exports Shell independently. | Permit FileSystem or Shell; CodingWorkspaceLease/native env still require ExecutionEnv. | Real upstream type fixtures; no sandbox acquisition claimed. |
| A disposal callback typed void can hide an asynchronous cleanup; the interface also omitted external-store snapshot semantics. | Explicit void-or-Promise owner teardown; synchronous unsubscription, immutable cached snapshots and change notification contract. | Type contract and required future controller/React tests; no new lifecycle or state engine. |
| Same namespace was liable to be confused with a shared mutable cwd facade. Earlier smoke only tested sequential changes. | Share acquisition/backing, with stable compatible cwd bindings; do not mutate a shared facade across incompatible concurrent calls. | Concurrent actual NodeExecutionEnv reads with barriers, including safe same-cwd reuse; no vendor confinement/reattachment claim. |
| Any implementation activated global proofs for unrelated unfinished capabilities. | Per-package public-output tests for development; unchanged global release qualification. | Real test subprocess positive/failure/skip controls; import wiring is not coverage proof. |
| tsc --build --force can leave output belonging to deleted source, so local packs can differ from clean CI. | Clean only validated declared dist roots before building; stop on invalid/symlink paths. | Reproduce old behavior with real TypeScript, then prove obsolete output is removed and failed builds leave no previous successful module. |

## Keep the runtime small

No new agent, schema engine, store, plugin manager, scheduler, distributed transaction coordinator or copied native file/shell API is introduced. Preserve the optional headless/resource/native UI entry points and use native tool/watch/environment types unchanged. Resource publication is the selected authority's operation; a generic file module must not invent distributed atomicity across providers.

The package evidence convention uses the existing Node test runner: test/packages/<package>.test.mjs. It imports public output, has real tests, and must pass with no skips/todos. Static checks cannot tell whether assertions are sufficient; code review, real fault cases and eventual global qualification remain necessary. Type-only packages introduce no runtime proof claim. A failed package test fails verify; passing it never turns a pending global slot into a pass. No actual runtime slot is discharged by fixture tests.

## Native and UI source anchors

Pi's public environment at commit 0495646a8322ff99ce40ac2f9e15f1f49f56bb11 exports FileSystem, Shell and ExecutionEnv separately. Its FileSystem.cwd is mutable; id denotes namespace, not one shared current directory. Native types remain aliases of the installed exact package.

Environment reuse is encouraged when the namespace/view/scope/policy/cwd binding is compatible and stable. Fresh allocation on every invocation is not required. The pinned [native coding-agent example](https://github.com/earendil-works/pi/blob/0495646a8322ff99ce40ac2f9e15f1f49f56bb11/packages/coding-agent/src/experimental/durable/harness-setup.ts) caches NodeExecutionEnv per directory and cleans up at owner shutdown. This is a reuse pattern, not a private module to import or a reason to use cwd alone as a multi-tenant authorization key. Our actual native test proves compatible concurrent reuse and demonstrates the incompatible shared-mutation failure separately.

Controller observations follow the [React external-store contract](https://react.dev/reference/react/useSyncExternalStore): stable immutable snapshots until change, synchronous subscribe/unsubscribe, optional host-owned SSR snapshot or a declared client-only boundary. This is a semantic compatibility obligation, not a new React dependency for the headless package. Returning a new object on every getSnapshot or mutating old snapshots is invalid even when it typechecks.

V2's pairing/shared-watcher/dirty-editor lessons remain in the legacy ledger. This pass preserves extra editor methods instead of inventing another flush helper, and separates owner teardown from observer cleanup. Do not replace those behavioral ports with a generic chat demo.

## Limits

The type scaffold is not a robust running product yet. Real cross-process identity, caller authorization, cleanup reference ownership, publication preconditions, idempotent lookup, async save races and browser interactions still need implementations and tests. Main's private packages remain interface scaffolds. Native assumption tests and tooling fixtures do not certify the full three reference applications or Hub M1.
