# Proposed contract surfaces

Status: draft design with an initial [TypeScript interface scaffold](SCAFFOLD.md). The mapped source exports are compiled against actual pinned Pi types; remaining vocabulary is an implementation target, not a released API. No Boring runtime/provider/viewer behavior is implied by an interface. [SPEC.md](../architecture/SPEC.md) owns architectural decisions; [PI-COMPLEMENT.md](../architecture/PI-COMPLEMENT.md) owns composition recipes. Describe the smallest meaning missing from upstream/host interfaces, not a second set of laws or a generic engine abstraction.

## Attachment and host

The primary native integration borrows an existing Pi Harness with explicitly selected registry/host/feature bindings. Optional setup owns only the ordinary native Harness it creates and returns the same native handle. Direct native tools, extensions, configuration, submissions, graphs and views remain usable; a Boring facade is not mandatory. Attach/detach never opens a second Harness, rewrites unrelated configuration or closes unrelated work.

Composition uses ordinary TypeScript and explicit imports. File/resource controllers and viewers remain useful without Pi; background native tasks remain useful without UI/files. Browser and server installations are separate. Optional adapters need only the host capabilities they actually use, not a giant mandatory Host implementation.

| Host binding | Required meaning when selected |
| --- | --- |
| Context | Authenticated principal, app/tenant partition, access scope, initiator and allowed subject/resource bindings; shared visibility is explicit. |
| Authorization | Read/watch/submit/answer and managed operation/publication checks. Neither model arguments nor installed metadata supplies authority. |
| Configuration | Native configuration remains default; selected reproducible workflows bind their effective input/configuration/definition versions through supported native mechanisms. |
| Model access | Host-selected credentials and optional budget policy through supported public provider seams; no private retry/scheduler patches. |
| Resources | Optional provider/client bindings with authenticated revision-aware asset and derived-text access; an empty map is valid. |
| Operations | Typed domain/resource actions with actual guarantee declarations, operation identity and lookup/reconciliation where claimed. |
| Reporting | Idempotent native usage/result/effect projections; unknown observations remain unknown. |

Context and initiator follow children, delivery, decisions and exports. A shared scope does not imply equal roles, shared credentials or missing actor attribution. Browser and service callers use the same host policy. IDs in requests are resolved/authorized, never treated as grants. Raw native capabilities remain available to the trusted host without making Boring-managed resources accessible through an unguarded alias.

Lifecycle binding includes every acquired workspace, watcher and shared transport. A handle identifies what is owned/borrowed and what cleanup belongs to that attachment. File and shell views of a coding workspace share one acquisition and provider instance; failure rollback releases only new acquisitions. Removing presentation never implicitly stops admitted background work. These are interface responsibilities, not a new lifecycle manager API.

### Concrete interface boundaries

See [SCAFFOLD.md](SCAFFOLD.md) for compiled exports. Native tool schemas, execution APIs/results and hooks are reused directly; the initial duplicate HostOperation and agent-owned RuntimeSchema are removed. Passive AttachmentInput contains only the borrowed Harness and preserves host subtypes. A host installs extensions through its own native registry, not an unrelated registry passed to passive attachment.

## Submission and task

Use native Pi submission/conversation/task identities. A selected structured-work feature may bind a resolvable pinned input snapshot, configuration and definition version; ordinary conversations keep native semantics. An authenticated admission adapter can bind a caller/operation-namespaced request key and canonical body digest: same request returns the original target, changed body conflicts, interrupted admission cannot allocate an orphan second execution.

Expose native progress and task graphs plus feature-specific validated-result and delivery status. Model completion, publication, business acceptance and deploy eligibility differ. A compatibility projection can retain v3 vocabulary but must not be independently writable execution truth.

Business obligations may be manifest-defined; native child tasks/subagents remain dynamically owned by Pi. Required foreground and intentionally detached background work have their native lifetime/stop semantics. Do not constrain the execution graph to fit a fixed business manifest or add a second scheduler. Host-triggered background work needs no browser, public chat or filesystem.

Cancellation identifies the exact target/generation and records request identity, accepted intent where acknowledged, and separately observed termination. Repeating a request cannot cancel newer work. A timeout/disconnection retains last-known native/provider status with freshness/unavailability, never invents a terminal outcome. Business withdrawal may be recorded independently. Abort of a local wait/subscription is not remote task cancellation.

## Structured validation and delivery

Optional native output validation consumes the completed producer's text and retained tool-result entry references. The installed adapter verifies native result/task/call linkage and ownership through task or task-owned conversation edges. Inherited history and sibling tasks do not establish provenance. Missing, duplicate, diagnostic-bearing or unauthorized evidence refuses validation. The host interprets actual returns and rechecks current access; model-written citations cannot replace evidence. Original model arguments are distinct from arguments modified by native preparation/hooks.

A shared check may guide `onYield` repairs, but an independent native validation task gates application acceptance. The host binds a stable task name/version, original admitted configuration and application repair allowance. Hook exceptions, budget exhaustion and unsupported output cannot grant delivery. Repair decisions use durable native documents and original generation/answer identity; provider-attempt budgets remain separately qualified. See the [agent guide](../../packages/agent/README.md#structured-output-and-native-tool-evidence) for current bounds.

Validation/repair is an optional versioned native extension/task. Bounded repairs retain actual tool evidence and use the admitted model path, not another generation loop. A validator sees authorized returns, including code-mode calls; model-written citations are not evidence. Missing required evidence fails closed. Application vocabulary and acceptance remain host-owned.

When delivery is required, admit producer and delivery obligation together using actual native commit primitives. A native task waits for validated output and applies a conditional/idempotent host operation under a stable operation ID. Completion observers are notifications, not the sole delivery mechanism. Kill/restart between model completion, provider commit and acknowledgement must reconcile one accepted application outcome; multiple physical delivery attempts are possible.

Use per-subject generation/edit identities so independent specialists can publish without clobbering siblings or human corrections. A generated proposal is not automatic replacement of human work. Cross-store output/export uses durable obligations and per-store reconciliation, not two writes called a transaction.

Document delivery admission accepts the existing target expectation plus optional resource preconditions. Capture these before awaiting producer creation, retain them with the native task and include them in the same publication and argument digest as the output change. Reconciliation of an already committed operation uses its original receipt even when guards have since changed. Delivery task version 2 migrates version 1 records with empty preconditions, preserving their original unguarded contract; older definitions must not execute guarded version 2 records. A provider guard update and native task admission remain separate transactions unless the host proves a shared commit boundary.

Delivery access resolution may be asynchronous. A host that resolves original identity through committed native producer input supplies its authenticated admission access explicitly; capture that identity before producer creation. Do not query the borrowed Harness inside its own commit or read native tables after producer creation writes. Publication resolves current access independently, compares the admitted identity and detaches credential fields before later awaits. Explicit access carries attribution, not permission.

Private inputs/results remain in their authorized app/runner runtime. A hub can retain digests and resolvable versioned references rather than content. Recovery needs an authorized input reference or captured payload at the data-owning runtime; a digest alone cannot reconstruct a request. Reporting deduplicates by native/result/effect identity. Optional strict provider-attempt guarantees are demonstrated through public seams or explicitly unsupported for that use.

## Operations and receipts

All paths to a Boring-managed authoritative operation share the host's validation/policy and publication semantics. This boundary does not redefine every native tool or require domain transactions for working scratch files. Existing app services can remain the implementation behind typed operation bindings.

An admitted authoritative operation contains stable operation ID and canonical arguments/change digest; trusted scope and initiator; native task/tool attribution where applicable or explicit human attribution; target identities and expected revisions/absence; and required policy/fencing/approval bindings. Tool arguments cannot fabricate those trusted fields.

Outcomes include committed receipt, conflict, denied, unavailable, interrupted/unknown or explicit partial batch. A receipt identifies actual operation, actor/scope, initiator, affected targets and before/after revisions plus provider evidence. The provider owns mutation outcome; optional Pi integration stores/reconciles a reference. A local presentation acknowledgement or native filesystem write is not that receipt.

Declare atomic mutation-plus-receipt, conditional commit, duplicate lookup, historical revisions, batch transaction and revocation fencing separately. Missing guarantees are never inferred from method names or advisory legacy labels. A provider swap preserves required semantics or refuses qualification, never silently downgrades it. Working-file receipts are not manufactured to make ordinary environment operations look transactional.

### Publication and reconciliation capability composition

Reader, writer and lookup are independently injectable. Requiring a writer does not imply it supports lookup; recovery-sensitive compositions require the extra capability. Request authority/digests are host-resolved, not supplied as trusted fields by clients. Nonempty changes declare all-or-nothing or per-change intent, with direct revision/absence preconditions where applicable. Receipts discriminate valid create/replace/delete transitions; partial results bind each original change index and complete target/view. Providers must validate those associations and immutable input capture at runtime. Search/listing predicate validation remains its own qualified integration, not a claimed implementation of the basic type scaffold.

## Decisions (optional native extension)

A pending runtime question is one native durable request, projected by authorized surfaces. Remote resolution binds original runtime/task/conversation/question, subject/operation and relevant revision, responder scope, expiry and idempotent resolution. Authenticated delegation establishes human responder provenance; a `person_id` argument does not. The owning app/Factory owns product approval as separate business state; the current hub may project an original runtime question but does not own the development approval workflow. Clarification or viewer patch adoption cannot approve a changed feature payload.

Decision state includes pending/resolved/expired and authenticated compare-and-set resolution. Consumption/commit recheck prevent stale, copied or reusable authority. Persist pending question and native wait before presenting; no transaction remains open while waiting for a person. Browser reload/runtime restart cannot lose the question. Native task/document mechanisms own durability, not a page command, process-local waiter or duplicate inbox database.

## Wire and projections

Use the smallest authenticated adapter over native Pi requests, conversation views/events and task graphs, plus selected resource/decision/delivery features. Evaluate the existing public Pi client/protocol/server/MCP pieces before recreating their correlation, routing or observation machinery. Their authentication/lifecycle fit must be proved; a small host HTTP adapter remains valid when simpler. No new mandatory protocol engine or forced v3 payload compatibility.

UI can consume a host-provided authorized snapshot source without a Boring-owned runtime. Snapshots expose their native schema/version and sequence/cursor where provided; slow clients or gaps resnapshot. Rendering/reconnection never replays effects. Shared viewers use the relevant transport with scoped cleanup, not independent execution stores. Audit pagination exposes retained effect/decision evidence under host policy.

A manifest advertises installed schemas/capabilities, not permission. Dynamic Pi descendants need not be predeclared in a business manifest. Existing callers require explicit compatibility adapters and contract tests; observational absence or transport failure cannot be interpreted as a confirmed remote cancellation.

### Native chat watch

The optional UI/Pi ChatSource returns ConversationWatch unchanged for trusted in-process integration: value, asynchronous operations/Context, closed promise and native stop result. It is not a serializable browser protocol or a claim that an authenticated remote client exists. Native hosts retain the full public API. Do not weaken that API to fit a restricted remote projection, or force a restricted browser to simulate native runtime objects.

### Remote projections and connection state

Evaluate supported public Pi client/protocol/server components at the tested version; otherwise provide one small host adapter. The wire carries schema/versioned serializable allowed values and commands, with native IDs and explicit connection freshness. Process-local callbacks, Context and Error objects are never sent as though they were wire data. Keep supported backpressure/resnapshot semantics without transmitting arbitrary native documents or privileged raw operation batches.

Authorize opening, initial snapshot, subsequent delivery, assets and commands; enforce declared mid-stream revocation semantics. Scope/source/view partition caches and clear restricted presentation on identity change. Version mismatch is explicit and may request reload without discarding drafts. A connection close neither confirms task termination nor automatically retries admitted work.

A projection can omit private fields and present connection errors while native state remains authoritative. This is a transport/security boundary, not another execution lifecycle or a universal Boring message model. Native outcomes, publication outcomes and presentation outcomes keep their distinct meaning; display adapters may share wording but must not merge them into one engine-constraining result union.


## Artifact and viewer

An artifact descriptor identifies kind/schema version, resource and selected revision/view or validated inline data, media type/title, optional derivation reference and presentation modes. No executable import or credential comes from content. File-backed viewers are primary document use, not a requirement to convert records or transcripts into files.

A viewer takes injected authenticated resource access, installed actions, view/edit intent and status callbacks. Follow-current versus pinned display is explicit. Cache identity distinguishes scope/resource/view, not path alone. A newer published revision and a dirty local buffer can coexist without silent replacement.

An editable controller reports dirty/saving/saved/conflict/unavailable and offers awaited flush. It returns the acknowledged revision/receipt for the exact selected input snapshot or fails. Generation controls await successful flush of their relevant inputs. A late acknowledgement cannot mark later typing clean; conflicts preserve local work. Debounce/unmount/init is not save evidence. Binary bytes and model-derived text are separate representations with source revision/conversion version; unreadable input remains explicit.

### Viewer feature and tool binding

Reuse shared/server/browser registration rather than introduce another viewer/plugin runtime. Shared schema names kind/version, compatible resources, operations, effects and destinations. Headless state/actions/tools supplies document behavior; React observes it and thin copied components render it. Pure behavior remains testable without React and uses public resource types, not a mandatory agent object.

Inspection/presentation/proposal/mutation targets either a specific live viewer or an authoritative resource. Native Pi adapters install selected operations through normal registration. They share semantic transforms and host operations with human controls, without importing browser code into the kernel. File access is injected, so a consumer can replace a provider without changing controller behavior when required guarantees match.

Resource operations bind ID, expected revision and trusted context through the admitted dispatcher. Saved-document inspection/edits need no mounted viewer. Focus/selection/dirty-buffer commands require the correct instance/resource/view and local epoch/version; old, replaced or disconnected targets return stale/unavailable. A buffer inspection reports saved revision, local buffer version and dirty state, never just text presented as saved.

An unacknowledged presentation effect returns `unknown`; disconnect or cancellation does not prove that the browser did nothing. Never replay it automatically.

Distinguish applied presentation, proposed edits, committed mutation with actual receipt, stale/conflict/denied/unavailable and inherited partial/unknown provider outcomes. Proposal base revision/buffer version remain inspectable; durable proposals use explicit resource/host persistence. Acceptance is deliberate and target-bound, not inferred from typing or equated with product approval. Human-only decision resolution cannot be installed as agent approval authority.

Mounted-editor mutation refuses/proposes over unsaved human work. Headless resource writes cannot claim knowledge of every browser buffer; a later refresh preserves it and reports conflict. Readonly policy is enforced below both tool/control interfaces. Closing one viewer releases only its subscription; it cannot close the shared provider or admitted background task.

Require built-in Markdown/canvas semantic operations and presentation tools, a consumer-defined task-list viewer without core-switch changes, viewer-only use and browser-closed saved-resource use. Server and renderer installation remain deliberate and separate. Shared contracts remain browser-safe; no new engine, filesystem or authorization subsystem is created to support a custom viewer.

### Headless versus presentation installation

ViewerFeature is generic in its actual descriptor and creates the headless controller; it neither requires a renderer nor an arbitrary ResourceClient. ViewerRenderer is separately composed, with only real dependencies closed over at host construction. Base ViewerTarget is generic in its subject; resource-save helpers add a new/existing base, viewer incarnation and buffer version in an optional subpath. ValueSchema is local presentation metadata plus actual parsing, not an agent-library dependency or new native tool engine. Callback function properties reject incompatible input/target/descriptor substitutions; explicit dynamic boundaries must validate rather than cast those checks away.

### Preserve the controller rather than rebuild its type

ViewerFeature<Descriptor, Controller> returns Controller unchanged at the type boundary. Editing, custom selection, optional SSR snapshots and specialized lifecycle operations survive feature registration. Generic commands remain contravariant in accepted inputs. getSnapshot returns a stable immutable value until a change is published, and subscribe notifies after publication; rendering never initiates resource work. This follows the external-store contract rather than defining a new state engine. dispose may return a Promise: the explicit owner awaits or handles it, while unsubscribe stays synchronous. A React effect must not return a Promise or silently discard rejection.

Save/flush remains conditional and cannot be inferred from disposing an editor. Unknown in-flight writes are reconciled, not cancelled retroactively by removing a component. Runtime controller/React behavior still needs its own actual implementation tests.

## Custom feature

Shared registration: stable namespaced feature/kind ID and version, descriptor schemas and named operation/presentation schemas. Server registration: trusted operations/context with supported descriptor versions. Browser registration: trusted renderers/slots and optional commands bound to a presentation instance. Missing opposite-side installation is unavailable, not silently synthesized.

Accidental Boring collisions and incompatible versions require explicit resolution. Native Pi registry replacement/overrides remain available as deliberate host operations; Boring must not globally change those semantics. Installation grants nothing. Generated JSON can instantiate only installed schema-valid bindings and named actions, not endpoints/imports/scripts or privileged messages.

Page commands bind instance, command, target/view/version and expiry. Results distinguish presentation from backend evidence. Retarget/remount invalidates old requests. Host async editor/transcription callbacks carry subject/resource and epoch. Resnapshot must not implicitly remount dirty editors. Browser availability is not an execution grant.

## Experiences, cells and composition

[EXPERIENCE.md](../architecture/EXPERIENCE.md) owns EXPERIENCE-1..8 and CELL-1..4. Layout composition is a presentation feature over registered cells; it does not configure providers, install native extensions or become the application's dependency framework.

Kind registration names kind/version, strict props schema, slots/events, allowed named actions and static description. The renderer is host-bundled; server reads/operations install separately. One side grants nothing on the other.

Cell registration names ID, owning app, kind/version, content-free description and host-computed enumerated metadata, root/maxUses/resource constraints, and a json-render-compatible element. Presentation literals or state/bindState references resolve within the host-assigned app namespace. A registration carries no record values or credentials; values are loaded through authorized access after composition.

An experience descriptor, versioned when kept and provisional when generated, expresses:

```
{ format: "boring.experience", version: 1, name, title?,
  source: "fixed" | "derived" | "generated",
  kinds: { <kind>: <version> },
  root, elements: { <id>: { type, props, children?, slots?, visible?, on? } },
  composed?: { evaluator, model?, promptDigest, candidatesDigest, at, stopReason } }
```

A cell reference is `{ type: "boring/cell", props: { ref: "<app>/<cell>" } }`. The descriptor contains no state values. Derivation rules are host configuration, not executable descriptor content.

A generated region is `{ type: "boring/generated", props: { region, candidates, kinds?, maxElements?, minWidth?, regenerate?: ("open" | "phase" | "request")[], prompt? }, children: <default arrangement> }`. Only visible allowed cells/layout primitives enter composition; replacement is limited to that subtree. Pin writes its new default at the observed descriptor revision. The concrete region composition/request/Pin API and supported bounds are documented in [the UI guide](../../packages/ui/README.md#generated-regions-and-conditional-pin).

Evaluator vocabulary remains json-render's choice request/answer: `evaluate({ state, questions, signal })` returns answers selecting only offered criteria and optional usage. Host admission binds person/scope/budget/attempt. jev/local/fake implementations share validity rules. Input strips record props, bindings, state paths, action parameters and initialState; it contains metadata and opaque markers only. Rebinding happens after composition under host access.

Composition snapshots name composition/sequence and partial/final/default, descriptor and optional reason. Rendering invokes no operation. Final is validated; default explains failure/unavailability. Keep/pin is an admitted conditional resource write. Unsupported descriptor/kind versions refuse or render unavailable, not guessed components. Changing layout cannot acquire resource/agent capabilities.

## Files, Git and optional exec

Reuse Pi's exported FileSystem/Shell/ExecutionEnv types for working files and commands; do not define another general-purpose method-for-method FS or exec contract. Boring's distinct ResourceRef/provider/publication meaning is revision/authority/evidence, not POSIX emulation. It can be used independently, even when the same physical store supports a working environment.

The file catalog describes logical identity/root, support, effective access at declared scope/time, availability and qualified guarantees. Read/list/search/create/write/delete/move/mkdir/upload/history/diff/watch/binary support is explicit. Unknown/denied/unsupported/unavailable differ. Discovery cannot authorize narrower paths or invent a writable default. Exec is a separately granted native Shell/environment binding, not an FS boolean.

A workspace acquisition supplements native interfaces with stable provider instance/incarnation, selected working view, ownership, provision/reattach/expiry/dispose and optional ports where needed. Files and shell in one coding environment come from that acquisition, not independently selected machines. A pure adapter can be tested without a Harness. File-only application tools can bind a resource provider without an ExecutionEnv; the native env hook must not receive an incomplete object.

Identity is not merely cwd/path. Preserve native namespace semantics and separately identify resource/revision/view and authorized scope. Multiple task-private overlays and an expert's published view are valid; equal-view interfaces agree. Refresh creates a new attempt and retains old read dependencies/proposals. Working memory/copy-on-write does not imply persistent/pinned state.

Commands, outputs/spill, errors and context use native public semantics where applicable. Additional vendor capabilities remain accessible through explicit host configuration rather than flattened away. Actual environment restrictions cover every exposed interface, including shell and aliases. An unsupported qualified guarantee blocks that use without disabling unrelated native work. Detailed resource/capability/provider tests are owned by [FILES-GIT-EXEC.md](../architecture/FILES-GIT-EXEC.md).

### Workspace provider

`@hachej/boring-files/workspace` `createWorkspaceProvider({ identity, fs, journal })` returns a `ResourceProvider` with `publication` and `reconciliation` over a Pi `FileSystem` and a host-supplied `WorkspaceIdentity`; it refuses an environment without one. Revisions are Git blob ids of the bytes; `before` equal to `after` is a valid committed change. Conditional writes check expected revisions and preconditions inside one per-workspace queue, replace single files atomically or are rejected before any effect, and record receipts only for conditional writes; an intent without completion looks up as `unknown`. The agent package binds a read-before-write guard to native `read`/`write`/`edit` with Pi's `wrapTool`; the guard, `present`, the canvas tools, `working_git` and self-evolution resolve the workspace per call like Pi's `env`, by default from the binding attached to the call's env (`@hachej/boring-agent/workspaces`, [Workspace per call](../architecture/FILES-GIT-EXEC.md#workspace-per-call)), and one harness per owner is `@hachej/boring-agent/harness-pool`. Owner and rules: [FILES-GIT-EXEC.md](../architecture/FILES-GIT-EXEC.md#one-place-for-files).

## Execution

Native Pi owns execution. Optional adapters define the granted environment/network/limits and declared recovery, not another execution profile hierarchy. Readonly/scratch virtual Bash, Git and typed file interfaces operate on the same working view; no automatic native fallback. Working writes and builds need no per-file domain receipt; publishing changes uses original input/target versions and host authorization. Deploy permission is separate.

Code mode reuses upstream pi-codemode with ordinary native registration and admitted injected callbacks. Pi persists the outer task/tool, not a JavaScript continuation; interrupted mutating scripts reconcile effects rather than blindly replay. For remote coding, reattach to the original provider instance or report lost state. Cancellation request/acknowledgement/confirmed termination are separate observations. A background agent does not depend on browser lifetime, and an assistant can add viewers without rewriting execution.

## Current clarification response adapter

The optional `@hachej/boring-agent/question-response` Fetch handler resolves a host-selected original native choice question. Its concrete wire shape, trusted authentication responsibilities and late-acknowledgement semantics are documented in [the agent package](../../packages/agent/README.md#authenticated-question-responses). Public tests exercise real native commits and installed tarball use. This does not establish browser/cookie deployment, a remote inbox, human identity-provider integration, product approval or an atomic external revocation fence.


### Local publication non-dispatch evidence

The optional remote resource client can reject with `PublicationNotDispatchedError` from `@hachej/boring-files/publication` when a valid request fails before its fetch callback runs. This is evidence about that invocation, not a new publication outcome or proof about earlier requests with the same operation ID. The editor owns a fresh save operation and can release that attempt on matching non-dispatch evidence. An earlier uncertain attempt remains subject to its original lookup/recovery contract. Dispatched errors, HTTP failures and receipt absence do not imply no commit.
