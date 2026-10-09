# Abstraction audit: baseline e96d256fd126

Historical review record, not a second architecture or invariant owner. Scope: all initial public interface modules, package manifests/consumer fixtures, selected invariant gates, and pinned Pi public contracts. No assertion that type declarations implement security or that legacy/runtime acceptance is complete. [SCAFFOLD.md](SCAFFOLD.md) describes the revised exports; [SPEC.md](../architecture/SPEC.md) and [CONTRACTS.md](CONTRACTS.md) own the design.

## Source-backed findings and corrections

| Finding in the baseline | Correction | Regression evidence |
| --- | --- | --- |
| ViewerFeature required both rendering and ResourceClient, including inline/headless use; its descriptor erased custom data into a fixed union. | Generic typed feature/controller; separate renderer; host closes over actual services. Root UI has no files/Pi/agent dependency. | Type fixtures plus clean packed UI install/typecheck with no files/Pi. |
| UI imported RuntimeSchema from agent and had required agent/Pi peers. Type-only runtime exports did not prevent installation/type-resolution coupling. | Local presentation schema; optional resource and Pi subpaths/peers, not root re-exports. | Actual offline tarball install and strict isolated declaration check, then UI+files without Pi. |
| Generic method signatures accepted unsafe input/target widening under TypeScript method bivariance. | Readonly function properties on Boring callbacks; native definitions unchanged. | Narrow-to-broad negative fixtures and disposable declaration mutation causing an unused expect-error failure. |
| SnapshotSubscription discarded native watch operations, async backpressure, close promise and terminal reason. | ChatSource returns exact native ConversationWatch. | Native type equality and actual native watch lifecycle/backpressure test. |
| remoteCodingBindings returned one fixed environment, ignoring the native target/cwd and no-environment case. | Reuse exact EnvironmentFactory alias and pass the host's factory without replacing it. | Native type equality and real native task/env test across conversations/cwd changes/undefined; no model call. |
| HostOperation recreated a name/schema/execute tool surface without native result controls/diagnostics/usage. AttachmentInput allowed a second unrelated Registry. | Remove the duplicate tool abstraction and registry argument. Reuse native ToolRegistration and keep direct handles/subtypes. | Native tool/API/result type equality; passive-attachment type check. |
| WorkspaceRequest required a Boring ResourceRef snapshot and every provider required reattachment. namespaceId duplicated environment.id. | Host-chosen generic input, acquisition-only plus optional recoverable provider; namespace from native environment. | Git-input/ephemeral provider and recovery-negative fixtures. |
| Every ResourcePublisher had to implement lookup while ResourceClient could not reconcile an unknown save. | Independent writer/lookup capabilities and optional client lookup. | Writer-only composition; required-reconciliation negative fixture. |
| Publication accepted a caller-supplied digest/approval reference, empty changes and implicit batch semantics; partial results lost view/index correlation and receipts admitted null/null changes. | Host-computed digest/authority, nonempty request/receipt, explicit atomicity, indexed full-target outcomes and discriminated committed changes. | Type negatives; runtime digest/index/authority/atomicity validation remains mandatory future provider work. |
| SaveSelection and ViewerTarget required an existing file revision for every viewer, including unsaved and record/inline views. | Generic presentation subjects; resource-save extension with absent or existing base and actual resulting revision. | Inline/record/new-document positive fixtures; backend-commit presentation negative. |

## What native Pi was checked for

Reference [Pi commit 0495646a8322](https://github.com/earendil-works/pi/tree/0495646a8322ff99ce40ac2f9e15f1f49f56bb11) and the installed exact 1.0.0 package are the contract sources. Read public environment and tool exports, HarnessOptions/EnvTarget, native registry/configuration, ToolExecutionApi/ToolExecutionResult, ToolHooks, ConversationWatch/WatchHandle and task runtime/ownership.

Native FileSystem/Shell/ExecutionEnv, native tool schema/results and native watch lifecycle are reused exactly. Native beforeTool explicitly has blocking semantics (including a throw); this differs from observational reporting hooks. Do not blanket-disable supported control hooks or assume every hook can fence a model request. Preserve public native semantics and test the particular guarantee. The native in-process edit/write queue is not a lock against shell/other processes, and NodeExecutionEnv cwd is not confinement.

No native upgrade, private import, provider patch, copied tool loop or new protocol/DI/plugin engine is part of this revision. No real provider/clinical data/model request is required for the interface audit. Native tests are deliberately not registered as completed Boring runtime proofs.

## Remaining limits

Provider authorization, immutable captures, same-view identity, safe cleanup, conditional mutation/receipts, concurrency against native shell, crash reconciliation and complete byte/resource/browser behavior cannot be enforced merely by these types. Keep their existing acceptance obligations. Search/listing dependency tokens and further resource/provider capabilities need their concrete qualified integration; the direct revision/absence scaffold does not claim Hub H02 is already complete.

A restricted adapter may safely refuse a required capability; a general-purpose native workflow must not lose supported behavior just to fit one application profile. Schemas and optional peers are not permission grants. Scope/target authentication remains at the real host boundary.

Learning from v2 means retaining coherent environment acquisition, correctly scoped watchers and mature chat/edit interaction tests. The generic interface changes remove constraints that would have made those ports awkward; they do not replace the legacy ledger or certify a rewritten chat demo as parity.
