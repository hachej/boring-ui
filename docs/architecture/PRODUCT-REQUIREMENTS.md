# Product requirements

Julien's explicit v4 delivery targets, not implemented capabilities. [SPEC.md](SPEC.md) owns architecture; [BORING-PI-1..6](../../INVARIANTS.md) own the Pi/composition boundary. Extend native Pi with useful application capabilities; do not replace it with a smaller universal engine API or require a complete Boring application to use one component.

| ID | Requirement | Contract and proof |
| --- | --- | --- |
| P01 | Native TypeScript agent integration and mature chat. | Borrow the host Harness, preserve direct native APIs and ordinary configuration, optional setup owns only what it creates. Custom prompts/tools need no files/shell/UI workflow. Background use works with no browser; full chat includes the legacy behavior and A40/A44/A45, not just Markdown streaming. |
| P02 | Make an existing website agent-driven. | Typed live-page commands, host context and authorized backend actions beside existing router/auth/database/UI. Thread/target binding before first message; no arbitrary browser automation or replacement application shell. |
| P03 | Remote coding with an injectable sandbox. | Acquire one provider workspace and adapt native FileSystem/Shell/ExecutionEnv. Files and commands share its namespace/lifecycle; no second checkout or duplicate exec API. Reattach/expiry/honest cancellation, bounded output and separately authorized publication. Qualified verifier protects inputs throughout execution. |
| P04 | Embed in existing apps such as redaction, including background work. | Preserve shared cabinet scope and initiator, native parallel tasks, typed validation/delivery, human corrections and custom UI. No mandatory mounts/exec/chat; no browser-owned completion callback. |
| P05 | Extensible, agent-manipulable viewers. | Headless state/actions/tools, file/resource-backed defaults and custom record/inline views. Semantic resource operations work headlessly; presentation binds an instance. New viewer adds no core switch, engine or permission system. A42/A43/A47, viewer-only use and provider substitution. |
| P06 | Fully adaptable presentation and real source distribution. | Headless clients/controllers, replaceable slots/renderers, tokens/classes/scoped styles and shadcn recipes. No mandatory layout/theme. A46 actual install/restyle/tool behavior; SDK/license/accessibility qualification stays explicit. |
| P07 | Optional file/resource access, including server directories and virtual workspaces. | Files and execution are complementary, not alternatives. Reuse native working FS semantics; Boring supplies revision/publication meaning. Multiple scoped mounts, separate support/grants/availability/guarantees, readonly references plus writable documents with no exec. A41. |
| P08 | Easy virtual Git via isomorphic-git. | One selected working view shared by file tools, just-bash and installed Git commands. Typed and shell interfaces use the same service; metadata grants cannot be bypassed. No native Git parity/fallback; publishing is separate from working commit. |
| P09 | Independently granted execution without incoherent pairing. | File/domain/viewer/code-mode use requires no dummy exec. A coding environment composes native file/shell views from one acquisition; exposed shell/aliases enforce mount restrictions. No host fallback; provider-specific useful options are not silently discarded by a thin recipe. |
| P10 | Native foreground/background subagents and optional durable application features. | Pi owns dynamic graphs, scheduling and recovery. Questions, validation/repair and delivery install independently; host business deliverables do not freeze native descendants. Cancellation intent is not confirmed termination. |
| P11 | Prebuilt Markdown, safe HTML and tldraw, with useful document tools. | Independent controllers/renderers, authenticated text/binary resources, no-init-write, exact save acknowledgement and dirty-buffer protection. Canvas document/session split and separate license/migration qualification. Preserve useful legacy tree/image/conflict/proposal primitives and supported-only tools. |
| P12 | Fixed, derived and generated experiences over registered cells. | One descriptor/renderer, metadata-only composition, generated regions and conditional keep/pin; jev/local/fake evaluators. [EXPERIENCE.md](EXPERIENCE.md), A25–A32. Layout composition does not install plugins/providers or govern agent execution. |
| P13 | Consumer-qualified hub composition and separate Factory integration. | [Current owner map and H10](../compatibility/HUB-M1.md#current-consumer-ownership), A48 for hub revision 6; preserve historical H01–H09/A39 provenance and Factory/app approval/release scope. No current runtime/vendor/consumer qualification implied. |
| P14 | Optional upstream Pi code mode, reused directly. | Native tool registration around pi-codemode, no Boring interpreter or VM recovery. A14/A22 qualify injected-call authority/evidence/limits/partial effects and exec independence. Native outer-task persistence does not resume a VM stack. |

## The three reference applications

[PI-COMPLEMENT.md](PI-COMPLEMENT.md#three-reference-applications) owns concrete composition and fault cases. Each uses actual introduced code and native Pi; neither a mock framework nor one application-specific runtime stands in for the others.

| Example | Composition | Critical absence/boundary |
| --- | --- | --- |
| Remote coding | Native tools/tasks + acquired working environment + host publication + optional evidence/chat | Files and shell cannot point at different checkouts; no automatic publish/deploy or fabricated stop confirmation. |
| Embedded background | Native task + typed app services + optional validation/question/delivery | No browser, chat, mounted files, HTTP service or shell required; results survive crash independently of presentation. |
| Assistant beside app | Native conversation + host context/tools + chat/viewers + optional resources | Existing app retained; headless document operations differ from live selection/focus; unmount does not cancel unrelated work. |

Adding/removing an unrelated viewer/provider must preserve existing tools, authority, identities and lifecycle. Files and shell share identity when composed; published and task-private views remain deliberately separate. Native overrides stay available through explicit host configuration. A provider with weaker guarantees cannot silently substitute for a qualified one. These are extensions of existing law/test obligations, not new runtime modes or a feature engine.

## Minimal developer experience

Use ordinary native TypeScript registration/configuration. Optional file definitions are loaders, not the price of embedding. A selected reproducible task can capture input/settings/rules for a stronger guarantee without wrapping every native turn. A consumer can import a controller or resource client without an agent, or attach chat without a filesystem.

Custom viewers install shared schema/controller/actions, a trusted renderer and selected native adapters. Human/agent operations share semantics; saved-resource tools need no open browser. A provider can be a scoped directory, versioned store or workspace view; low-level native working I/O and authoritative resource commits are distinct contracts, not duplicate engines. Thin virtual Bash/Git and remote environment adapters compose where wanted.

Shadcn recipes copy presentation, not core behavior or server code. Pure adapters can be tested/acquired without starting an agent; optional integration entry points install native capabilities explicitly. No generic multi-engine facade, mandatory DI container, global plugin loader or duplicated lifecycle registry.

## Compatibility and scope

Backend-embedded and separately deployed native integration are both valid host compositions. Prebuilt UI is React-first; protocol/controllers remain injectable. Full v4 delivery preserves [LEGACY-UI.md](../compatibility/LEGACY-UI.md) dispositions and A01–A47, with A48 added for the current hub instead of renaming historical acceptance. The mature v2 chat/paired-environment lifecycle and v3 viewer/shadcn implementation are deliberate port sources, not evidence of v4 correctness by themselves.

Unsupported strict guarantees block their qualifying composition, not unrelated native capabilities. All required targets remain visible; a minimal example is not a complete product and a fake vendor is not live qualification. No runtime, installer endpoint or cloud-provider implementation is claimed before it exists.
