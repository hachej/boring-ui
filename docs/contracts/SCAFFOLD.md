# TypeScript interface scaffold

Status: draft contracts plus partial runtime implementation. The [implementation checkpoint](../implementation/PARTIAL.md) records the implemented providers, native adapters, controllers, renderers and their executed evidence. Full product and release qualification remains incomplete. Private `0.0.0` workspaces are not published packages. The abstraction audit against baseline `e96d256fd126` is recorded in [ABSTRACTION-REVIEW.md](ABSTRACTION-REVIEW.md); current owning specifications and actual exports govern new implementation.

## Public composition points

| Surface | Meaning | Independent of |
| --- | --- | --- |
| `@hachej/boring-ui-kit` | Generic headless controller, descriptor, feature, typed presentation command and separately composed renderer | Files, Pi, agent package, React and a mandatory source format |
| `@hachej/boring-ui-kit/resources` | Resource-backed descriptor and exact new/existing-buffer save contracts | Pi and chat; optional `@hachej/boring-files` peer must be installed when selected |
| `@hachej/boring-ui-kit/pi` | ChatSource returning the exact native ConversationWatch | Boring agent wrapper; optional native Pi peer must be installed when selected |
| `@hachej/boring-files` | Resource reads, conditional publication, optional reconciliation and qualified capability metadata | Native execution or an agent |
| `@hachej/boring-agent/native` | Exact native handles, configuration, tool APIs/results/hooks, task IDs and views | A Boring alternative to those native types |
| `@hachej/boring-agent` | Borrowed attachment and original-question/delivery references in addition to native aliases | A file package, second registry, host-tool framework or required setup factory |
| `@hachej/boring-execution/native` | Exact native FileSystem/Shell/ExecutionEnv plus EnvironmentFactory derived from HarnessOptions.env | Copied methods or a narrowed env callback |
| `@hachej/boring-execution` | Provider-chosen acquisition input, workspace lease and optionally recoverable provider | Boring ResourceRef input, dummy reattach, publication or an agent instance |

Contract exports use `import type`. Runtime additions are the workspace provider (`@hachej/boring-files/workspace`, `@hachej/boring-files/journal`, the SQLite backend `@hachej/boring-files/sqlite-filesystem` and its `@hachej/boring-files/sqlite` connection), browser-safe `@hachej/boring-files/publication`, `attachHarness` from `@hachej/boring-agent`, `@hachej/boring-agent/definitions`, `@hachej/boring-agent/file-guard`, `@hachej/boring-agent/questions`, `@hachej/boring-agent/validation`, `@hachej/boring-agent/delivery` and `@hachej/boring-ui-kit/markdown`. The optional Markdown subpath imports the browser-safe publication helpers; the UI root stays independent. Questions and document delivery install native tasks explicitly. Upstream runtime values such as Harness, defineTool, CodingTools and NodeExecutionEnv are imported directly from Pi. No throwing provider stub or fake renderer implements a missing feature.

## Decisions made concrete

**Do not duplicate native APIs.** Native ToolRegistration/ToolExecutionApi/ToolExecutionResult are the tool surface; host domain services keep their own signatures. The initial Boring HostOperation and RuntimeSchema-in-agent are removed. Presentation schema metadata has a small local ValueSchema contract, including an actual parser, not a new model-tool engine. Exact aliases preserve tool controls, diagnostics, usage, hooks and generics.

**Borrow the handle, not another registry.** AttachmentInput accepts only the native Harness (including a host's subtype). A passive attachment has no reason to receive an unrelated writable Registry. Feature installation is an explicit host action; a future installer uses the host's own native registry directly, separately from attachment.

**Compose rather than require dependencies.** ViewerFeature takes the consumer's typed descriptor and supplies headless behavior. ViewerRenderer is a separate function. Needed services are bound by the host's feature factory closure; inline and record viewers do not manufacture filesystem clients. Native chat and document helpers are optional subpaths, not re-exported from the headless root. Optional peers and real isolated-install tests make this separation more than a monorepo claim.

**Keep variance safe.** Boring's generic callback surfaces use readonly function properties, not TypeScript's bivariant method syntax. Narrow command inputs, target subjects, feature descriptors and acquisition inputs cannot be widened into unsupported registrations. Upstream native definitions are not rewritten to impose this choice. Runtime boundaries still parse untrusted data; casts, JavaScript and dishonest providers cannot be secured by TypeScript alone.

**Preserve native observation and environment resolution.** ChatSource.open returns ConversationWatch unchanged: value, asynchronous start with operations/Context, closed result and stop reason. There is no reduced SnapshotSubscription. EnvironmentFactory is exactly NonNullable<HarnessOptions['env']>, preserving per-conversation target, cwd, committed reads, Context, async resolution and undefined. Resolve an existing workspace through that callback, not a fresh VM per call or a singleton that ignores native cwd.

**Keep capabilities independent.** ResourceReader, ResourcePublisher and PublicationLookup are separate; the aggregate provider installs only supported capabilities. Recovery-sensitive code requires lookup explicitly. WorkspaceProvider only acquires; RecoverableWorkspaceProvider adds reattachment. Generic input can be a pinned Git commit, image, directory or resource snapshot chosen by the host. These facts are not implied by similarly named methods.

## Preserve specialized capabilities

ViewerFeature<Descriptor, Controller> preserves the concrete controller, including EditableViewerController.flush and custom/SSR methods. ViewerController.dispose is explicitly void-or-Promise; owner cleanup handles it while unsubscribe remains synchronous. Immutable cached snapshots and post-update notifications are semantic obligations for actual controllers, not behavior implemented by the interface.

WorkspaceLease can hold native FileSystem, Shell or both. A shell-only provider cannot be passed to native env, which still requires ExecutionEnv. The generic provider does not force optional filesystem APIs merely to issue commands. No new runtime helper or engine is added.

## Native interface scope versus remote delivery

ChatSource remains the exact trusted in-process ConversationWatch binding. The [remote contract](CONTRACTS.md#remote-projections-and-connection-state) requires an authorized serializable projection/version boundary; its implementation must not send native Context/Error objects or private raw docs to a browser. No remote protocol/client is claimed by this type alias, and this plan revision changes no public interface signature. Runtime source and conformance tests must land before any new guarantee is exported as implemented.

## Resource intent and evidence

PublicationRequest contains a stable request ID, a nonempty change list, explicit all-or-nothing/per-change intent, and optional exact revision/absence preconditions. The authenticated boundary snapshots mutable bytes and computes/checks the canonical argument digest. The caller supplies neither trusted digest nor approval authority. ResourceAccess carries host-resolved identity/policy separately; ResourceClient cannot accept it as browser authority.

An atomic request must be refused before effects when the provider cannot meet it; never silently downgrade it. Per-change partial results retain operation ID, input index, full target/view and each observed outcome. Runtime validation checks complete/unique index coverage, digest and target/receipt agreement. A committed change is create/replace/delete with valid before/after references, not two null values.

Lookup is independently optional. Not-found means no retained receipt, not proof of no effect; an interrupted client must not blindly retry. Unknown/partial save outcomes remain visible. Byte arrays are mutable despite readonly property declarations; copy/capture before hashing or committing. Type-level nonempty lists and outcome unions do not implement atomicity, authorization or crash recovery.

Resource views have provider-scoped opaque view IDs. The provider binds them to backing/instance lifetime and must not reuse an ID for a different view. Resources need not expose workspace internals; native namespace identity is read from the acquired environment rather than duplicated in an independently assignable lease field.

New documents save against explicit absence. SaveSelection binds viewer instance/epoch, scope, buffer version and existing revision or absent target; a save result reports the resulting ResourceRef and receipt. The Markdown controller also binds expected receipt principal and initiator. Those values are comparison metadata and never browser authority. A controller must check that the acknowledgement identifies the selected buffer. Generic inline/record presentation targets remain usable without any resource revision.

## Build and evidence

```bash
npm ci
npm run build
npm run typecheck
npm test
npm run verify
# Still refuses qualification while required runtime proofs are pending:
npm run verify:release
```

TypeScript project references build declarations and empty ESM exports. Consumer fixtures resolve built packages, not invented Pi declarations or source-path aliases. Strict/exact-optional checks apply; isolated UI consumers use skipLibCheck:false and no ambient types. Root skipLibCheck avoids checking all upstream internals, not checking our API use.

New checks cover exact native type equality; invalid callback widening; inline/headless/custom descriptors; writer-only and ephemeral acquisition; new-file save bases; publication authority/atomicity/outcomes; actual packed UI and UI+files installations with no Pi/agent; and a variance negative control that mutates a disposable declaration and must make the same consumer fail. A real native watch test checks async backpressure, close reasons and independent cleanup. A real native task test exercises conversation-specific environment resolution, cwd changes and no-environment operation without any model request.

Those scaffold tests establish only their bounded assumptions. New package and crash tests establish the narrower implementation claims recorded in the checkpoint. They do not qualify cloud isolation, shared provider leases, external revocation fencing, browser UX or Hub M1. The six runtime proof slots remain pending. No source checker or package test is relabelled as one of those proofs. Runtime source requires a package-local implementation test entry; the existing global proofs remain independent qualification obligations. Both the direct test suite and registered verifier execute real package tests. A structural public-import check is bounded wiring evidence, not coverage proof. Release still fails on the six pending runtime slots.
