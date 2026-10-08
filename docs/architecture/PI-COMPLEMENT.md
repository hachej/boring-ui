# Pi Durable, complemented—not replaced

Project laws are owned only by [INVARIANTS.md](../../INVARIANTS.md), BORING-PI-1..6. [SPEC.md](SPEC.md) owns architectural decisions. This document owns their composition recipes and integration consequences; it introduces no alternative engine or generic plugin framework. The [interface scaffold](../contracts/SCAFFOLD.md) now supplies initial compiled contracts. Runtime APIs and full reference applications below remain implementation targets, not released capabilities.

## What the library adds

Boring makes native agents useful inside applications: portable chat and agent-manipulable viewers; versioned resources and honest publication; authenticated application/page bindings; optional durable questions, validation and delivery; workspace adapters using existing execution mechanisms. It does not compete with Pi's model loop, tools, extension registry, task ownership, storage, steering, forks, compaction or recovery.

Keep the rich native API available rather than inventing a lowest-common-denominator `AgentRuntime` interface. Resource/controller/viewer surfaces are not tied to a scheduler; Pi-specific integration is deliberately named and depends on supported native exports. A future adapter for another engine would compose those independent surfaces, not justify building a multi-engine framework now. Pi Durable and the coding-agent/TUI are not interchangeable APIs; reuse compatible standalone pieces without importing a second agent loop or promising every plugin works unchanged.

## Composition by explicit installation

A consumer uses ordinary TypeScript functions, injected interfaces and native registry/configuration. Boring does not own a global plugin catalogue, service locator or feature dependency solver. Install a feature's shared schema, trusted server operations and browser renderer where each belongs. Descriptors, filesystem metadata and generated content never install executable code or grant authority.

| Piece | Consumes | Adds | Does not require |
| --- | --- | --- | --- |
| Native integration | A host-created Harness and selected host bindings | Authorized native views/requests and optional extensions | A workspace, chat, Boring-owned storage or setup factory |
| Resource provider/client | Host policy and a concrete storage authority | Versioned reads, conditional publication and declared guarantees | Pi execution or a shell |
| Working-environment adapter | One acquired provider instance | Native FileSystem/Shell/ExecutionEnv as appropriate | Boring task scheduling or application records as files |
| Viewer/controller | Resource access, schemas and explicit actions | State, human actions, manipulation tools and presentation | Chat, an open model session or a workbench shell |
| Chat/headless client | Authorized native snapshots/commands | Mature conversation/composer behavior and replaceable presentation | Files, canvas or remote execution |

Adding an unrelated piece must not change existing tools, grants, identities, model settings or lifecycle. Only declared dependencies are required. Conflicting Boring registrations fail clearly or use an explicit host choice; native Pi's deliberate replacement/override semantics remain available. Removing one piece releases only its own registrations and subscriptions. A recipe is wiring, not another runtime type.

### Do not rebuild smaller native contracts

The concrete scaffold reuses native tools/results, the complete environment factory and the complete ConversationWatch rather than parallel HostOperation/SnapshotSubscription wrappers. Headless UI is installable without files, Pi or agent; resource and native-chat subpaths are optional. Renderer/controller and acquisition/recovery are separate capabilities. Native hooks retain their particular semantics: beforeTool has a documented blocking path, while ordinary observation/reporting hooks are not a general admission fence. Test the actual seam rather than globally replacing or disabling native behavior.

## Bring your Harness; own only what you acquire

Attach borrows the existing native Harness. Detach stops Boring watches/transports, not ongoing host execution. An optional setup recipe opens an ordinary Harness using the host's models/storage/registry, returns that same native handle, and may close what it explicitly owns. UI can instead consume a host snapshot source without any setup helper.

Acquire a coding workspace once. Its file and shell views, path mapping, provider identity and lifetime come from that acquisition. Separate narrow ports can share it; they must not provision independent machines. Borrowed handles and owned leases have explicit release responsibilities. If initialization fails halfway, roll back only newly acquired attachments. Native task/doc state may record durable provider bindings, but process-local reference counts and caches are never recovery authority.

A stopped browser is not a stopped background agent. Cancelling a local watch or request wait is not cancelling the admitted task. Explicit cancellation records intent and the actual acknowledged/observed outcome; disconnected status remains last-known with its freshness, not invented termination. Reattachment verifies provider instance/incarnation; lost working state stays explicitly lost.

## Working files versus published resources

The pinned [native environment contract](https://github.com/earendil-works/pi/blob/0495646a8322ff99ce40ac2f9e15f1f49f56bb11/packages/durable/src/env/index.ts) exports `FileSystem`, `Shell` and `ExecutionEnv extends FileSystem, Shell`. Use it for filesystem/command behavior; do not copy its methods and errors into a new Boring general-purpose FS or exec API.

The native environment hook expects the native contract. For file-only application tools, close over the selected provider and register ordinary native tools; do not pass an incomplete ExecutionEnv or invent a dummy shell. Stock native coding tools fit controlled working/staging environments. They are not automatically qualified to overwrite approved application documents.

Native working writes do not provide expected domain revisions or atomic publication receipts. Boring's resource contract adds that distinct meaning. A build can create thousands of temporary files without thousands of approval records. A reviewed patch, saved document or generated result crosses the admitted resource/publication boundary. Do not turn all host tools into a mandatory Boring transaction workflow, but every path to a Boring-managed authoritative mutation must preserve its host policy.

A provider may offer direct conditional editing or an explicit working snapshot followed by publication. Do not force two stores or two physical copies. When staging is needed, the human may read published R while two tasks privately derive A and B; those are intentionally different views. Refresh creates a new attempt and retains old provenance/proposals. Copy-on-write over a changing source is not automatically a pinned snapshot; memory alone is not restart-durable staging.

[FILES-GIT-EXEC.md](FILES-GIT-EXEC.md) owns the capability/guarantee model, adapters and publication details. Low-level support, current grants, availability and qualified guarantees remain separate. A narrow readonly RPC interface cannot protect data also exposed through an unrestricted shell or alias.

## Three reference applications

These are executable example/acceptance targets over the same library, not product modes or three engines. Test them with native Pi and real introduced adapters; mocks replace only external services whose behavior is explicitly out of scope. Keep UI port and provider qualification separate from real-model judgment.

### Remote coding agent

A host selects native tools/model/extensions and acquires a provider workspace at an explicit source snapshot. Its file tools and shell address the same namespace; native coding tools are reused where suitable. Optional virtual Git or MCP/code-mode bindings do not install another scheduler. Boring adds the provider lifecycle/identity binding, reviewable resource publication and optional chat/evidence viewers.

The agent installs/builds/tests inside that workspace. Working writes are ordinary environment effects; publication to a task branch or application resource is a distinct host-authorized operation against original input/version conditions. Deploy permission is not implied. Required credentials stay at their declared trusted boundary; restrict egress and protected inputs through the provider, not only tool descriptions. A verifier uses a separately qualified protected view with no publication capability.

After a runner restart, reattach to the recorded workspace or report expiry/loss. A stop timeout leaves termination unconfirmed until native/provider evidence resolves it. Dynamic native children and authorized background work remain usable; business deliverables are not a replacement task graph. Prove A23/A24/A36 and the relevant H03/H04 cases; a fake provider does not qualify a live vendor.

### Embedded background agent

An existing app starts a native task from its own event, job or service call. No browser, chat, mounted directory, HTTP server or sandbox is required. It supplies authenticated actor/service context, typed application tools and a pinned input/configuration only where the selected workflow requires it. Do not turn records into files or route completion through a UI.

When validated delivery is needed, install optional native validation/delivery tasks and atomically bind producer and delivery obligation. Publish to the app through its idempotent conditional operation. A crash after generation or after external commit reconciles one accepted outcome; independent specialist failures need not cancel siblings. Human questions may be answered later through an authenticated projection of the original native question.

Pi owns task progress/recovery; the app owns business scheduling, data and accepted-result meaning. Timers/cron are not a new Boring scheduler. The data-owning app/runtime retains private payloads; an external hub may retain authorized resolvable references and digests. Prove A01/A03/A08/A09/A24 with the browser absent, then attach a viewer without changing execution.

### Assistant beside an application

An existing app attaches chat and optional viewers to a host-owned native conversation. Existing routing, auth and domain services remain. Start with narrow typed tools; optionally add a read-only reference mount, writable documents or a custom viewer without changing the agent definition system.

The host supplies current subject/context explicitly. A saved-resource operation can work with the browser closed; focus, selection and dirty-buffer operations require the correct live viewer instance. A relevant generation waits for acknowledged editor flush. Human controls and agent tools use the same document semantics and authenticated mutation boundary, not equivalent-looking separate write paths.

Adding a viewer advertises only explicitly installed and currently allowed operations. Retargeting invalidates old presentation commands; it never redirects a late result to the newly selected subject. Closing chat or a viewer leaves admitted background work and the borrowed Harness intact. Quiet expert presentation still shows questions and actionable errors. Prove A19/A40–A47, including actual shadcn installation, long-history behavior and a consumer-defined viewer.

## Optional native features, not wrappers around every turn

Ask-user retains the useful v2 prompt/tool + form + answer-bridge composition. Pending question/answer and waits use native documents/tasks rather than v2's file/transcript store or process-local waiter map. The hub inbox references the original question. Clarification, patch acceptance and product approval are distinct host decisions.

Validation/repair and delivery use public native tasks/hooks/tool controls where supported. An ordinary conversation remains ordinary without them. Public provider adapters enforce the budget guarantee they can actually demonstrate; a throwing observational hook is not a policy fence. An unsupported per-HTTP-attempt guarantee refuses that strict qualification, not every native model call. Native configuration/retry/compaction behavior remains default outside explicitly installed stronger workflows.

Use native views and task graphs for observation. Custom supplements expose feature data without becoming a second transcript/event engine. Evaluate existing Pi client/protocol/server/MCP pieces before building equivalent transport machinery; reuse only where their public contract fits the host's authentication and lifecycle. Code mode reuses upstream `pi-codemode` with native registration; Pi task persistence is not JavaScript VM checkpointing.

## Invariants, legacy and consumer composition

Keep v2 pairing, scoped acquisition/rollback, shared-watcher, binary I/O and mature chat lessons, plus v3 headless viewer/tools and shadcn recipes. [LEGACY-UI.md](../compatibility/LEGACY-UI.md) owns that port ledger. Actual conditional-save, controller and browser tests decide parity, not historical source or a minimal demonstration.

The [current consumer owner map](../compatibility/HUB-M1.md#current-consumer-ownership) separates hub control/composition from Factory development and app acceptance. Host specializations strengthen resource/authority semantics without copying library laws or freezing Pi's native graph. Historical Hub M1/1 remains a provenance record; H10/A48 is current hub qualification. Generic references to product approval refer to its app/Factory owner, not a new hub feature.

[ROADMAP.md](ROADMAP.md) starts with the thin native/resource S0 and headless-controller S1, then grows the three reference applications. In-process native APIs stay exact; [remote projections](../contracts/CONTRACTS.md#remote-projections-and-connection-state) carry only authorized serialized data. Locality, lifecycle, view coherence, no-authority-widening and truthful outcomes extend existing law/acceptance slots. No new invariant service, universal outcome engine or second trace store is needed. Structural and native-assumption checks are not implemented application/provider guarantees.
