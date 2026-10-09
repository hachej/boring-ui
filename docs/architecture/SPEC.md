# Boring UI v4

Status: partial implementation. The [implementation checkpoint](../implementation/PARTIAL.md) records the tested native document and headless editor increments. [SCAFFOLD.md](../contracts/SCAFFOLD.md) maps concrete exports to this design. Full library, browser, provider and consumer qualification remains incomplete.

## Product

A composable application library around native Pi: mature chat and extensible, agent-manipulable viewers; versioned resources and trustworthy publication; authenticated application/page bindings; optional native questions, validation and result delivery; working-environment adapters. The application keeps its backend, database, authentication, deploy, permissions, budgets and credentials. Boring enhances the engine, not replaces it or reduces it to a smaller universal runtime API.

Composition is ordinary TypeScript over explicit public interfaces. A consumer can use one viewer, files without an agent, an agent without files/UI, or the complete combination. No base Boring application, workbench shell, mode hierarchy, dependency-injection container or alternate plugin engine is required. Preserve direct access to native Pi tools, extensions, configuration, task graphs, steering, forks, compaction and recovery. Independent presentation/resource contracts permit reuse outside Pi; that is not a mandate to build a multi-engine facade now.

Project laws are defined once in [INVARIANTS.md](../../INVARIANTS.md), indexed in [LAWS.md](../LAWS.md), and structurally checked by [ARCHITECTURE.json](../../ARCHITECTURE.json) and [VERIFY.json](../../VERIFY.json). [PI-COMPLEMENT.md](PI-COMPLEMENT.md) owns composition recipes and the three reference applications. [PRODUCT-REQUIREMENTS.md](PRODUCT-REQUIREMENTS.md) retains the full delivery scope.

Multiple conversations, specialist configurations and parallel structured work can use the same native Harness. A business job is not a replacement for a native task graph. Default authority is host-provided application operations; source-code work, native execution, publication and production deployment require their respective explicit grants. Adding a viewer or provider grants none of them implicitly.

## Packages and dependency direction

| Package | Owns |
| --- | --- |
| `@hachej/boring-files` | Versioned resource identities, conditional publication, confinement and qualified provider evidence; independent file/Git clients and adapters. Not a replacement for Pi's low-level FileSystem. |
| `@hachej/boring-agent` | Optional native Pi extensions, host/transport adapters and attachment helpers. No replacement runtime, tool loop or universal engine facade. |
| `@hachej/boring-ui-kit` | Independent headless controllers, mature chat, viewers/editors, trusted custom-component bindings and thin source recipes. No server runtime ownership. |
| `@hachej/boring-execution` | Working-environment/virtual-Bash/remote-workspace adapters using native filesystem/shell seams. No scheduler, JavaScript engine or second workspace truth. |

Files imports no repository runtime package. Its optional native adaptation can reuse exported Pi environment types without importing the kernel. Agent can use files, never execution. The UI root has no agent, Pi, files or React import. Optional `ui/resources` consumes resource types and `ui/pi` returns the exact native ConversationWatch; neither is re-exported from the headless root. Their peers are optional until selected. Actual services are closed over by the host feature factory. Execution acquisition depends on native types, not an agent facade or a mandatory Boring resource input; optional resource-publication integration remains separate. Package edges permit composition, not unconditional initialization. Any later browser runtime-client edge needs explicit policy and bundle proof.

Shared descriptors are browser-safe; server implementations and credentials are separate exports. Native Pi view types are allowed type-only as declared. Heavy viewers, Git, virtual Bash and vendor SDKs use separate optional subpaths/lazy imports. No kernel, Node filesystem or execution dependency enters browser UI bundles; an opt-in agent worker bundle is the one exception ([BORING-PI-5](../../INVARIANTS.md)). Reuse native interfaces and existing libraries where they fit rather than add another contracts package or duplicate method surface. [FILES-GIT-EXEC.md](FILES-GIT-EXEC.md) owns environment/resource composition; [WEBSITE-INTEGRATION.md](WEBSITE-INTEGRATION.md) owns embedding and source installation.

React is the first prebuilt presentation. Headless clients/controllers accept injected access and can support other frontends. The host owns layout, routing, CSS and assets; no mandatory Dockview, shell, global reset, cross-root stylesheet or hard-coded app endpoint.

### Runtime targets

Node 22.19+ is the first server qualification target; pin the actually tested native package and Node versions. Browser support covers presentation, headless controllers and authenticated clients, not a kernel import. Workers/edge execution is unqualified: the public Storage interface exists, but compatible persistence, task ownership, cancellation, background lifetime and required native/WASM dependencies must be tested on that platform. A Durable Object or a heartbeat alone is not proof of recoverable execution or external-effect fencing.

Prefer Web-standard APIs in portable code and keep Node/vendor implementations behind explicit platform entry points. This is not an instruction to remove working native capabilities or change dependency policy without tests. An edge-hosted app may use a separately hosted authorized Node runtime; it must not silently move app code or secrets into the hub. The [seam register](UPSTREAM-EXAMPLES.md#seam-qualification-register) records qualification work. For one-owner deployments, prefer supported storage locks or host deployment ownership and test competing open/crash/stale-owner cases; do not add a home-grown heartbeat scheduler to the library.

## Attachment and lifecycle

The primary integration borrows a host-created native Harness and explicitly selected bindings. It neither reopens storage nor creates another Harness. Native conversations, submissions, task graphs, events and configuration remain directly accessible. Detach removes only Boring-owned subscriptions/transport, not unrelated work. Optional setup opens an ordinary native Harness with host configuration, returns the same native handle, and closes only what it owns. UI may instead consume a host-provided authorized native snapshot source.

Apply the same ownership to workspaces, watchers and shared transports. Acquire a file/shell pair once; narrow interfaces share its provider identity, view and lifecycle. A failed partial attachment releases only newly acquired resources. One viewer unmount cannot close another's shared observer or stop background work. Reattachment verifies the stored provider instance/incarnation and never substitutes an empty workspace as successful recovery. Do not turn local reference counting into durable task ownership.

### TypeScript-first consumer integration

Consumers use native Pi tools, extensions, prompt sections, registry installation and conversation configuration. Boring adds selected resource tools, viewer bindings and authenticated transport. It does not require another agent-definition DSL, `agent.md`, a filesystem or sandbox. File definitions are optional loading adapters.

Native configuration shape below assumes the host already supplies the registry, conversation, context, model choices and domain tools; it is not a released Boring setup API:

```ts
registry.install(domainExtension);
await conversation.configure({
  instructions: "Help the expert refine requirements before implementation.",
  model: { provider: selectedProvider, modelId: selectedModel },
  tools: [lookupReference, inspectFeature],
}, context);
```

Ship complete, typechecked consumer examples using public Pi APIs. Add a read-only reference mount, writable document mount and viewer without rewriting the agent. Installing browser/transport adapters must not silently select native tools/extensions for unrelated conversations. Accidental Boring registration collisions are explicit; the host can still use native Pi's intentional extension replacement and tool overrides. Configuration options beyond the convenience recipes remain available through native APIs.

### Optional declarative definitions

A loader reads definition data at an authorized pinned revision and maps it to native configuration. It never imports/evaluates code from definition files. Tool names resolve against the host's installed, allowed capabilities; unknown or forbidden names refuse loading. Record definition revision/digest and relevant implementation-version compatibility for workflows requiring reproducibility; restart uses a compatible definition or explicitly refuses. Ordinary TypeScript configuration remains first-class.

A file may refer to an explicitly installed code-mode tool, but that executes only under the separately qualified upstream sandbox/callback/limit policy. Parsing a definition does not grant execution or load native plugins. The same small loader can serve an app or hub file app; it is not a second runner, tool schema engine or new mandatory DSL.

### Lean concrete interfaces

The [scaffold guide](../contracts/SCAFFOLD.md) maps the revised public surfaces. Use native ToolRegistration/ToolExecutionApi/ToolExecutionResult and public control hooks directly; do not create a second Boring HostOperation/tool-result vocabulary. Passive attachment takes the actual Harness, not an independently supplied writable Registry. The exact native environment factory preserves target/cwd/committed reads, Context, async and undefined. The exact native watch preserves operations/backpressure/termination for trusted in-process integration; the [remote boundary](../contracts/CONTRACTS.md#remote-projections-and-connection-state) serializes only authorized projections and does not transmit process-local Context/Error objects.

ViewerFeature owns typed headless behavior; ViewerRenderer is separate and services are injected only where used. Generic presentation subjects include inline data, records and unsaved drafts. A resource save can target expected absence or an observed revision. Boring generic callbacks use function properties so unsafe narrowing/widening is rejected by strict TypeScript; native APIs remain unchanged. Runtime parsing, identity/authorization and lifecycle evidence are still required.

## Authority and deployment

- Resolve authenticated principal, app/tenant partition, host-defined access scope and request initiator outside model arguments. Shared visibility does not erase initiator attribution or imply equal roles.
- Every read, watch, submission, decision, page target and artifact request is independently authorized. Capability discovery is descriptive, never a grant. The same managed operation has the same policy whether invoked by human, tool, viewer or code mode.
- Start with one active Harness owner per durable storage partition. SQLite alone is not distributed scheduler fencing; active-active runtime needs separate ownership/failover qualification.
- Credentials remain at their explicitly trusted host/provider boundary. No process-global model login as cross-app authority. An untrusted workspace/frame receives no unrelated credentials through composition.
- Provider fencing protects later authoritative commits where claimed. Cancellation is best-effort and cannot undo an already committed effect. Record requested, acknowledged and confirmed cancellation distinctly; unreachability does not prove termination. A business task can be withdrawn while execution remains unconfirmed.
- A restricted file API is insufficient when shell or another alias exposes the same protected bytes. Qualify the complete exposure, including mounts, execution and egress. Unsupported guarantees are refused for the composition requiring them, not silently weakened or imposed on unrelated native work.

## One owner for each state

| State | Authority |
| --- | --- |
| Native conversations, submissions, generations, tools, checkpoints, active transcript and recorded model usage | Pi Durable storage |
| Optional durable integration bindings, pending runtime questions, operation intents and receipt references | Boring-namespaced native documents/entries when that integration is installed |
| Business records, product approvals, claims, accepted deliverables, permissions, budgets and credentials | Host/application |
| Working bytes and remote workspace lifetime | Selected working-environment provider; only its declared persistence guarantee applies |
| Published resource bytes, revisions and committed effect evidence | Resource/publication provider; it may share physical backing with the working provider |
| Browser focus, selection, viewport, draft buffers and layout | Local presentation until explicitly saved |
| Kept experience descriptors | Versioned resource provider; generated drafts remain presentation state until kept |

No independently writable Boring run/event/usage store duplicates Pi. Host reporting is an idempotent projection. Business children may be fixed deliverables while native descendants remain dynamically created and separately observed; intentionally detached work retains native semantics. Custom feature supplements are authorized views, not a replacement transcript.

Native watches and provider observations may coalesce. A gap causes resnapshot, not re-execution. Audit is a separately paginated durable surface. Compaction/reset may change active context without deleting effect/decision evidence. Forked history can display old approvals, not inherit usable grants or pending-decision authority. Privacy stays with the data-owning runtime: a hub can retain references/digests without copying private inputs/results. A digest alone is not a recoverable dispatch input.

### Current consumer ownership and payload residency

The [compatibility owner map](../compatibility/HUB-M1.md#current-consumer-ownership) follows hub revision 6. The hub owns registry/identity, capability invocation, workspace file apps, companion and cross-app presentation. Factory and app repositories own discovery/claims/build/verification/merge/release; skills live in boring-stack. No remote builder or deploy credential is a prerequisite for current hub composition. Historical H01–H09/A39 evidence is not silently reassigned; H10/A48 adds the current hub scenario.

A reference-only Job table is insufficient to establish reference-only residency if raw app returns enter a native companion transcript. The app/host must decide where interpretation occurs and what may be persisted in native documents, prompts, logs, exports, drafts and caches. Keep sensitive interpretation in the data-owning app and return allowed references/summaries, or explicitly authorize retained content with an owner-approved policy. The current hub's stronger no-app-content rule is not relaxed by this library document. No private engine patch is an acceptable workaround.

Read-only diagnosis joins existing native task/question/delivery references and provider outcomes with source and freshness. Use existing identities where applicable, not a mandatory universal correlation record on every object. Reobserve, reconcile, safely retry and re-execute are distinct actions. Diagnosis adds no effect or second durable event database.

## Application operations and external effects

All entry points to a Boring-managed authoritative operation use the same admitted operation semantics: ordinary tools, human application controls, nested code-mode calls and publication of staged work. Validate inputs/outputs. Model text, registration and presentation acknowledgement confer no authority. The dispatcher is an integration boundary over existing host services, not a mandatory wrapper around all native Pi tools or every working-file write.

A managed mutation carries stable operation identity, trusted context, canonical argument digest and expected subject revisions. Strong providers atomically persist mutation and receipt, support lookup by operation ID, return the original outcome for an identical duplicate and conflict on changed arguments. A crash after external commit but before native acknowledgement reconciles the provider outcome rather than blindly repeating the effect.

Pi recording tool intent cannot make external effects transactional. Rename followed by an unrelated receipt insert is not atomic mutation-plus-receipt. Legacy/weak providers must declare, improve or refuse unsupported guarantees. Multi-resource atomic publication requires a real provider batch transaction; otherwise retain per-resource receipts and partial/unknown outcomes. Do not claim exactly one physical call or automatic rollback of irreversible effects.

Working bytes are different: installs, builds, caches and tests use normal environment operations. Record admitted commands and required evidence, not a domain receipt for every compiler temporary file. Local commit, accepted resource publication, merge and deployment remain distinct. A native filesystem write or shell command must not be able to bypass protection of Boring-managed authoritative resources.

### Publication intent versus trusted evidence

External publication intent contains a stable request ID, nonempty changes, explicit atomicity and applicable preconditions. The host captures mutable inputs, validates them, resolves approval and computes the canonical digest; callers do not assert trusted digest/approval fields. Atomic requests refuse unsupported providers before effects rather than degrade to partial writes. Per-change partial results retain input index and full resource/view identity. Lookup is an independently installed capability; not-found is not proof of no effect and cannot justify blind retry after uncertainty.

## Model admission, usage and settings

Host model/budget adapters use supported public provider seams; Pi retains generation/retry/compaction ownership. A strict budget composition must demonstrate the actual requests its admission covers, including recovery and compaction. Opaque retries require a documented upstream option or an explicit unsupported per-HTTP-attempt guarantee, not interception of private internals. Throwing observational hooks are not authorization fences.

Budget policy can reserve capacity and reconcile observed usage under stable native generation/attempt identity where available; host selects pricing and hard/soft limits. Interrupted usage remains unknown, not invented zero cost. Optional usage export is retryable/idempotent reporting, not another authoritative usage store. Preserve locale for repair/failure/history wording.

Native configuration semantics remain the default. A structured workflow requiring reproducible input captures configuration, message date and definition/rules/schema versions as durable input, then demonstrates that guarantee through supported native APIs or refuses qualification. Do not freeze every ordinary conversation or discard native provider options to satisfy one strict recipe. Whole-job versus per-child admission consistency is the host's choice. New work may use new settings.

## Structured work and durable result delivery

Plain native Pi remains usable without any Boring workflow feature. Questions, output validation/repair and acknowledged application delivery are independently installed native tools/extensions/tasks/documents. Use the public patterns in [UPSTREAM-EXAMPLES.md](UPSTREAM-EXAMPLES.md), not another Boring agent scheduler. Foreground children follow ownership cancellation; background anchors/reporters can outlive ordinary turn cancellation and need an explicit stop-all policy. Native capability/configuration copying does not grant child access; authorize narrowed capabilities and child views. Independent application specialists need not inherit fail-fast sibling cancellation.

The owning application or Factory owns its business scheduling/dispatch and result interpretation; the current hub composes exposed app capabilities but does not run the development Factory. Pi owns execution phases and waits. Optional producing/validating/repairing/delivering status supplements native state for that feature only. Validation uses supported tool/hook controls, not another model loop; raw model completion is not validated publication, and a throwing observational yield hook cannot establish it. Bounded repairs use the same admitted model path and retain original validated output separately from human edits.

When delivery is installed, atomically bind the producer and delivery obligation before execution using proven native commit/task/document primitives. A native delivery task waits for validated output, then applies it through a conditional idempotent host operation. Restart reconciles delivery even after producer completion. In-memory completion callbacks or browser listeners cannot be the sole delivery mechanism. Cross-store exports use explicit delivery obligations/receipts, not incidental observer writes.

Use opaque per-subject generation IDs, separate human-edit/resource revisions and stable item IDs. Timestamp identities and one record-wide CAS cannot represent independent parallel sibling publication. Stale generation cannot overwrite newer work; even a new successful proposal cannot replace a human correction without deliberate adoption. Input, validation evidence and outputs remain in the appropriate authorized data-owning runtime, not automatically copied into the hub.

Correctness validators retain actual authorized tool evidence: opened resources, returned URLs/calculations and nested code-mode returns. Missing required evidence fails closed rather than disabling checks. Search snippets are not opened sources; classify returned content, since some search operations return complete sections. UI evidence references identify source kind/label/resource/result without trusting model-written markers or copying private payloads into every browser/log event.

## Decisions (optional ask-user/approval extension)

Retain the v2 prompt/tool + form + answer-bridge feature composition, but persist pending questions and wait dependencies with native tasks/documents. No process-local waiter/file transcript authority. Persist before presenting and release the transaction before waiting for a person. A background app can receive an answer through an authorized surface later; it does not require an already-open chat.

Approval binds scope, authorized responder, conversation/task, exact operation/digest, expected revisions, capability scope, policy/implementation version and expiry. An authenticated endpoint resolves once by compare-and-set. Consumption and commit recheck prevent duplicates, stale answers, expired or unauthorized grants. Conversational yes, page acknowledgement and copied history are not approval. Clarification, patch adoption and product-contract approval remain distinct. A remote inbox projects the original runtime question, not another independently resolvable authority.

## Files and resources

Use two complementary contracts, not two engines: native FileSystem/Shell/ExecutionEnv for working-environment behavior; Boring resources for exact revision, conditional publication and provider evidence. A resource provider need not implement a shell or a POSIX filesystem; a workspace need not turn every scratch byte into a published resource. They share storage without being interchangeable guarantees: every file lives in a workspace, every access goes through that workspace's single provider, and its conditional write is the one safe way to write; the workspace provider owns published bytes. See [FILES-GIT-EXEC.md](FILES-GIT-EXEC.md#one-place-for-files).

Mounted files are optional. Records stay records; existing domain services need not become a filesystem. Text/binary source and derived model text have explicit identity, revision and lineage; unreadable content remains unreadable. Pinned reads return the requested revision or refuse, never silently substitute current content. Create and overwrite are distinct.

A host can attach selected server directories without installing native exec. Trusted server filesystem I/O does not give the model ambient Node/shell authority. Logical mount identities hide raw roots. Provider support, current path/caller grants, availability and qualified guarantees remain separate. Catalog failure cannot invent a writable primary workspace. See [FILES-GIT-EXEC.md](FILES-GIT-EXEC.md#filesystem-capabilities-and-server-directories).

One resource can have multiple deliberate views: published revision, live working view, task-private overlay. Interfaces bound to the same view share bytes/namespace; an expert and two parallel tasks need not share unfinished writes. Cache/command identity includes selected view and scope, not just path. A recreated remote workspace is not the original because it has the same path. Snapshot refresh retains old provenance/proposals and creates a new attempt.

Viewers use injected resource access directly, never shell commands. Assets are authenticated and revision-aware; no arbitrary generated-URL fetch capability. Dirty buffers remain local uncommitted state. Flush acknowledges the exact selected input revision/receipt or fails; it cannot report newer unsaved text as saved. Generation refuses unconfirmed relevant input. Conflicts retain the buffer until deliberate resolution, not implicit typing-as-overwrite. Late acknowledgements cannot mark newer text clean. Unmount/initialization is not a save guarantee.

## Prebuilt viewers and custom features

- Markdown: raw HTML off by default, controlled links/assets and revision-aware source editing.
- HTML: passive sandboxed preview by default; no scripts/forms/popups/host-origin privilege, restrictive CSP and explicit egress. Interactive mode is independently opt-in. Raw serving/downloading preserves isolation.
- Canvas: tldraw is the default. Persist its validated document snapshot, not camera/selection/session state. Inject authenticated assets and schema/migration policy; no authoritative IndexedDB or demo backend. Realtime multiplayer is optional and needs one defined authority, not a second store racing conditional saves. Qualify SDK/license/CSS/network independently in [CANVAS.md](CANVAS.md).
- Custom: trusted host components at explicit kind/schema/version. Generated JSON references only installed allowlisted bindings, not executable imports. Cells, fixed/derived/generated layouts and regions use [EXPERIENCE.md](EXPERIENCE.md); UI layout composition is not a second dependency or agent framework.

Shared schemas/descriptors pair separately installed server operations and browser renderers/commands. No registration grants permission. Resolve accidental collisions and incompatible versions explicitly. A custom viewer is added without editing a core switch, installing a new agent runtime or forcing a workbench shell. Pure controllers/resource transformations are host-independent; native adapters do not import browser rendering code.

Browser commands open/focus/scroll/highlight/propose against a specific page/viewer/subject epoch. They may be unavailable or stale, not falsely successful. Backend mutations report actual provider evidence. Async callbacks including transcription cannot follow a selection change into the wrong subject. Resnapshot need not remount a dirty editor. Clipboard/local browser constraints do not manufacture resource writes or approvals.

### Viewers expose manipulation tools

Preserve the v3 headless state/actions/tools feature: schema/resource, controller, renderer, typed presentation commands and supported semantic resource operations. Human controls and native agent adapters use the same document behavior and policy. No second viewer permission system or file store. Controller logic is independently testable without React where not inherently browser-specific.

| Destination | Examples | Meaning |
| --- | --- | --- |
| Mounted viewer | Focus/reveal heading, select, zoom/pan/frame, temporary highlight, current selection/buffer inspection | Instance/resource/view/buffer-epoch bound; missing viewer returns unavailable. |
| Authoritative resource | Read saved text, conditional patch, saved-canvas edits, persisted annotation | Existing admitted provider operations and receipts; browser not inherently required. |
| Proposal | Suggested text/shape changes | Base revision and relevant buffer version; not a commit or product approval. |

Buffer reads disclose saved revision, local version and dirty state. Mounted apply refuses/proposes over unsaved human work. Headless writes cannot pretend to know every browser draft: refresh preserves it and exposes conflict. Durable proposals use explicit host/resource persistence, not a hidden viewer database. Built-ins provide Markdown inspection/headings/selection/navigation/propose/apply, canvas shape inspection/edits/selection/framing, and tree list/reveal/select plus granted mutations. Image/PDF/custom adapters advertise only supported operations; metadata is not pixel analysis and a highlight is not a saved annotation. HTML source edits occur outside the untrusted frame.

Ship a complete consumer-defined file-backed viewer with viewer-only, native-tool and browser-closed resource use. Record-backed/inline views remain valid. Server/browser imports and lifecycle are separate. See [CONTRACTS.md](../contracts/CONTRACTS.md#viewer-feature-and-tool-binding).

## Chat UI and source distribution

Port mature v2 chat and v3 headless viewer/shadcn behavior through [LEGACY-UI.md](../compatibility/LEGACY-UI.md), not just streamed Markdown. Replace old gateway/coordinator authority with native Pi views. Preserve stable rows while streaming, bounded history rendering, follow-bottom/older-history anchoring, useful loading/error/empty states, drafts/attachments, keyboard/IME behavior, session safety and honest retry/cancellation/compaction. Uncertain admitted submissions reconcile identity, not resubmit as new work.

Quiet expert and detailed developer presentations share the same native state. Quiet mode retains required question/approval cards and actionable failures. Typed provenance, not model-authored prefixes, identifies control entries. Tool renderers, artifact opening, composer contributions, native model controls, layout and styling remain host choices. Multiple viewers share the relevant authorized observer; removal releases only their interest, not execution.

Use the standard shadcn registry for thin copyable presentation over versioned headless behavior, alongside package imports and fully headless use. Runtime viewer registration and development-time source installation are distinct. Do not copy controllers/server credentials into every consumer or create another installer/marketplace. Require actual install, restyle, build and tool behavior in [WEBSITE-INTEGRATION.md](WEBSITE-INTEGRATION.md#viewer-and-style-installation); no invented published endpoint.

## Common configurations

The three reference applications compose the same pieces, not three runtimes:

| Application | Native core | Boring additions |
| --- | --- | --- |
| Remote coding agent | Native tools/tasks/model and a coherent acquired ExecutionEnv | Workspace identity/lifecycle, separately authorized publication and optional chat/evidence viewers |
| Embedded background agent | Native tasks and typed application tools | Optional authenticated admission, questions/validation/delivery; no browser/files/exec required |
| Assistant beside an app | Native conversation/configuration and host domain tools | Chat, viewer manipulation, resource/page binding and acknowledged editing without replacing the app |

[PI-COMPLEMENT.md](PI-COMPLEMENT.md#three-reference-applications) supplies their concrete flows and fault cases. Virtual VFS + just-bash + optional isomorphic-git is a composable capability within these applications, not another mode. Typed tools default; optional code mode reuses upstream pi-codemode, never another Boring interpreter or JavaScript recovery system.

Use native FileSystem/Shell types for working semantics, not a parallel mandatory ExecProvider API. File-only tools can close over resource providers; Pi's environment hook still requires its complete native contract when used. A coding provider supplies coherent file/shell views from one acquisition. Stock Pi coding tools are appropriate inside controlled working/staging environments, not blindly installed over authoritative application mounts.

Virtual commands have declared inputs/cwd/limits and no automatic native/network fallback; custom commands/filesystem callbacks are capabilities. Native coding tools run in an explicitly granted isolated workspace. Ordinary native configuration/provider capabilities remain accessible. Publication binds original versions and required approvals independently of working writes; deployment is separate. Stopping a process cannot undo committed external effects.

## Small interfaces, executable composition

ViewerFeature is parameterized by its descriptor and complete concrete controller, not a rebuilt base controller that loses flush or custom methods. Controller snapshots are pure cached observations; asynchronous owner disposal is explicit and separate from synchronous subscription removal. The host chooses an SSR-safe adapter or an explicit client-only boundary rather than requiring every controller to implement browser/SSR machinery.

Workspace acquisition can expose native FileSystem, Shell or their ExecutionEnv composition. Shell-only use calls the separately injected native Shell from a tool; it does not satisfy the native env factory. Reuse one backing workspace but return per-call facades that respect native target/cwd; mutating one shared cwd during concurrent calls is invalid.

Implementation evidence is composable too. Every package with runtime source requires a test/packages/<package>.test.mjs entry that exercises its public output. The verifier runs it and rejects failed, skipped, empty or todo results. This wiring rule cannot prove coverage or honest assertions; review and targeted fault tests still matter. Global native/consumer proof slots remain unchanged, and release still fails on any deferral. No second feature/evidence registry is introduced. See [COMPOSITION-CHECKS.md](../contracts/COMPOSITION-CHECKS.md).

## Migration and upstream risk

Clean v4 native integration, not parallel Flue/Pi engines. Preserve completed legacy history/receipt IDs read-only with provenance. Interrupted legacy work needs an explicit fresh submission; do not invent checkpoints or restore imported credentials/grants. Keep v2 pairing/lifecycle/performance/UI lessons and strengthen old optimistic-write/acknowledgement assumptions.

Version Pi storage, integration task/docs and wire/viewer/resource schemas independently. Pin experimental upstream packages; test upgrades with pending questions, interrupted effects, changed/removed definitions and backups. Unsupported rollback/state versions refuse safely. Existing upstream probes are not application/provider qualification.

Research pins include Pi Durable/code mode 1.0.0 and [Pi public environment source](https://github.com/earendil-works/pi/blob/0495646a8322ff99ce40ac2f9e15f1f49f56bb11/packages/durable/src/env/index.ts), with prior source/probe history in [UPSTREAM-EXAMPLES.md](UPSTREAM-EXAMPLES.md). just-bash/isomorphic-git/tldraw qualification is owned by their adapter documents. These references do not claim installed runtime compatibility.

## Explicit non-goals and open decisions

No replacement scheduler/transcript/model loop, generic multi-engine facade, mandatory DI/plugin framework, application database replacement, required file representation, workbench shell, automatic deployment, production patching, generic uninstrumented browser automation, untrusted native plugin execution or active-active runtime in the first qualification.

Required guarantees need a supported public seam or an explicit unsupported outcome/upstream request; do not patch the engine. Runtime proofs remain pending and cannot be discharged by documentation/source checks. Choose storage topology, provider commit/fencing protocol, actual native transport fit, schema/version strategy, HTML assets/CSP, tldraw license and migration procedure before their dependent code. Do not block independent native workflows on a missing optional guarantee.

Delivery and evidence are in [ROADMAP.md](ROADMAP.md), [ACCEPTANCE.md](../acceptance/ACCEPTANCE.md), [REDACTION.md](../stress-tests/REDACTION.md) and [HUB-M1.md](../compatibility/HUB-M1.md). Current consumer specializations and historical revision-5 Factory requirements are separated in HUB-M1.md. Native graph/cancellation/privacy compatibility still needs actual consumer evidence; updating this library specification changes neither consumer implementation nor qualification.
