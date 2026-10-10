# Project invariants: complement Pi Durable

These cross-package laws have one definition here. [docs/LAWS.md](docs/LAWS.md) indexes them; [VERIFY.json](VERIFY.json) records structural checks and separately deferred runtime proofs. A passing source check is not a runtime proof. Existing feature laws remain with their owners. Composition and the three reference applications are explained in [PI-COMPLEMENT.md](docs/architecture/PI-COMPLEMENT.md); they add no second engine or law registry.

## BORING-PI-1 — Pi is the execution authority

Boring's Pi integration uses native conversations, submissions, turns, tools, scheduling, ownership, steering, cancellation, compaction, recovery and recorded model usage. It adds no alternative harness, agent loop, scheduler, replay engine or independently writable copy of that state. Native handles remain available; a Boring wrapper is not the exclusive route to Pi capabilities. Extension task/document kinds never occupy Pi's reserved `pi.*` namespace.

Host business obligations, approvals, claims and delivery status are legitimate application state, distinct from native execution descendants. They may reference or project Pi state but cannot redefine it or freeze its dynamic task graph. Native foreground and deliberately detached background work retain their supported ownership semantics under host grants. A cancellation request, acknowledged request and confirmed termination are different facts; loss of contact is not proof of completion or cancellation.

## BORING-PI-2 — attachment borrows; setup owns

Boring accepts a host-created Harness without opening another or taking its lifecycle. Detach stops only its own attachments; it does not close, reset, abort or reconfigure unrelated host work. An optional setup recipe may create a native Harness and close what it owns, with ownership explicit. Direct native API access remains available.

This ownership rule also applies to acquired workspaces, provider leases, watchers and shared transports. Attaching an unrelated viewer/provider leaves existing identities, grants and behavior unchanged. Partial attachment failure releases only acquisitions made by that attachment. Closing a viewer releases its subscription, not another viewer's observer or a running task's workspace. Shared resources have one explicit owner and safe release semantics; convenience composition cannot silently create competing owners. Restart reattaches to the recorded provider instance or reports expiry/missing state, not a silently substituted workspace.

## BORING-PI-3 — behavior is an optional native extension

Questions/approvals, validation/repair, subagents and application-result delivery are opt-in native Pi tools, extensions, documents and tasks, not a mandatory Boring workflow engine. Absence of an extension leaves an ordinary Pi agent usable. Compose supported mechanisms rather than replacing built-in generation/tool tasks. An ask-user feature pairs its native durable wait with an independently embeddable form; process-local waiters are not execution authority.

Host composition is ordinary TypeScript and explicit installation, not a mandatory dependency-injection container, mode hierarchy or plugin loader. Browser/server features are installed separately; adding presentation does not implicitly reconfigure native execution. Accidental Boring registration collisions require explicit resolution, while native Pi's supported, deliberate extension replacement/tool overrides remain usable. Optional features cannot become prerequisites for unrelated tools, workflows or components.

## BORING-PI-4 — only public seams; host owns policy

Boring integrates through upstream package exports and supported public APIs. It does not fork, vendor, patch, subclass or monkey-patch Pi's kernel, scheduler, generation or provider internals. Authentication, credentials, budgets, grants and application commits remain host/provider responsibilities. Reuse native filesystem/environment, tools, views, configuration and provider mechanisms where their meaning fits; do not duplicate them under Boring names.

A guarantee unsupported by a public seam is explicitly unavailable for the composition requiring it, or an upstream request. It is not implemented through private interception and is not silently weakened. This does not disable unrelated native workflows or impose a strict application's lifecycle on every conversation. Supported provider options/native features are not discarded merely because a smaller Boring convenience recipe does not expose them. The host can use the native API directly without bypassing the policy protecting Boring-managed resources.

Conformance (owner ruling 2026-10-10): every custom environment, filesystem or shell Boring or a host supplies runs Pi's environment conformance suite (`createEnvConformance`/`registerEnvConformance` from `@earendil-works/pi-durable/testing`); that suite is the proof it behaves like Pi. A new piece names the Pi extension point it implements (ExecutionEnv/FileSystem/Shell, `HarnessOptions.env`, native tool wrap/override, Storage) or the host concern Pi does not cover.

## BORING-PI-5 — complements remain independently usable

UI/controllers, viewers, versioned resource/file/Git capabilities, native extensions and workspace adapters can be used without a full Boring runtime or mandatory shell/layout. Files and agent execution are complementary, not alternatives. File-only tools/viewers do not need a dummy `exec`; execution is independently installed and granted. Resource/controller code depends on injected public contracts, not a universal agent facade.

Browser UI bundles carry no runtime Pi/agent or server-filesystem dependency. A host may opt into an agent worker: a separate browser bundle that runs the unchanged native kernel, reached from the page only through a request transport; the UI bundle stays free of it. Package edges follow [ARCHITECTURE.json](ARCHITECTURE.json); declared browser-safe resource and native view types are reusable directly without routing all file concepts through the agent. Heavy optional implementations remain separate entry points. A pure workspace adapter can be acquired/tested without starting an agent; native registration and application-policy bindings are explicit integration concerns. A transport exposes authorized native state, not another execution model.

Composition preserves the concrete capability it receives: a viewer feature does not erase editor-specific operations, and an adapter does not require filesystem access merely to expose native Shell. This is not a requirement that every component supply every optional method. Package-local behavior evidence accompanies implementation; unrelated system-level proof deferrals remain honest release blockers, not mandatory fake APIs in each package.

## BORING-PI-6 — one workspace, many interfaces

Reuse Pi's public FileSystem, Shell and composed ExecutionEnv for working-environment semantics. Files and shell are independently grantable interfaces, but a composed coding environment acquires them against one coherent namespace, selected working view and provider instance/lifecycle. Typed tools, virtual Bash, Git and viewers bound to that view agree on bytes and paths. An unrelated local filesystem and remote shell are not a valid pair.

The same published resource can legitimately have an expert's published view and multiple task-private overlays. Equality applies to interfaces bound to the same view, not every actor working on the project. References/caches distinguish resource identity, selected revision/working view, provider incarnation when needed and access scope. A reused path or sandbox name is not proof of identity or authorization.

Ordinary working writes, caches and build outputs are not domain publication. Record admitted execution and required evidence without requiring a resource receipt for every scratch byte. Boring-managed authoritative writes use the existing conditional, admitted resource/publication boundary; native filesystem writes cannot masquerade as those commits. Direct viewer/resource access needs no shell. Installed virtual commands share the working view and never fall through to native processes; native coding uses its assigned workspace without a second virtual checkout. Read-only/hidden resources remain protected across every exposed interface, including shell and aliases. JavaScript composition is an optional invocation interface, not a workspace or VM-recovery system. A document and its working file are the same path in the same workspace; a conditional write is a way of writing to it, not a copy, and nothing keeps a second live copy in sync.
