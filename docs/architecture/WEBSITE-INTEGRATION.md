# Making an existing website agent-driven

Boring supplies integration building blocks: authenticated agent/chat, typed backend actions, host context, mounted-page commands, portable viewers and optional generated declarative UI. It does not require replacing the site's auth, database, router, components or design system, and does not automate an uninstrumented browser.

## Three distinct surfaces

1. **Backend actions:** host-installed typed operations around existing services, with identity/tenant context, admission, subject versions, decisions and provider evidence. A browser save and an agent mutation call the same authorized service meaning.
2. **Page commands:** navigate/open, select, highlight, scroll, prefill or propose against a mounted page instance and versioned target. They can be unavailable/disconnected/stale. Proposing in a dropdown is not a commit; confirmed mutation has actual backend evidence.
3. **Context/viewers:** host supplies currently relevant subject/snapshot, registered command availability and validated artifact descriptors. Portable renderers show authenticated resources; they do not infer authorization from visible UI.

Create/attach a thread before the first message so mounted page commands are available immediately. Re-registration updates target/version/availability; stale requests and late callbacks cannot follow the user into another subject. Multiple tabs/pages require explicit target selection/lease, not first-responder execution. Reconnect/resnapshot renders state without replaying effects.

Host chooses in-process mount or separately deployed service. Client accepts host fetch/auth/base URL, and headless bridges use the same wire. Backend action works without a page; page-only action cannot claim success when no matching page is connected. Existing domain vocabulary stays in host registrations.

File-backed viewers additionally expose their manipulation tools through the same registration and operation path: see [viewer feature and tool binding](../contracts/CONTRACTS.md#viewer-feature-and-tool-binding). Ship a TypeScript consumer that combines a native Pi agent, injected file providers and a viewer; server-side saved-document tools remain usable with the browser closed, while presentation commands are bound to their actual mounted instance. A custom viewer must not require a core file-type switch edit or a new plugin runtime.

## Viewer and style installation

Offer both normal package imports and shadcn-compatible source recipes. Recipes provide host-owned chat/viewer wrappers, hooks, slots and theme wiring; runtime logic remains in versioned packages. The [shadcn registry contract](https://ui.shadcn.com/docs/registry/getting-started) is a distribution format, distinct from runtime viewer registration.

Required install targets: chat, Markdown, safe HTML, tldraw adapter and a minimal custom-viewer example. Preserve the useful v3 file-tree, image, conflict/proposal, tool-call and ask/approval presentation pieces as independently usable items or documented item dependencies; do not force a workspace shell into chat or an editor. A host can register a viewer using stable kind/version, descriptor schema, component and explicitly bound actions; install/export of a React component alone does not register backend operations or grant permission. Unknown kinds, schema mismatch and collisions are explicit errors.

Build a registry manifest and distributable item JSON with pinned package/registry dependencies using the standard shadcn mechanism. Reuse v3's source/build/check/install structure after updating imports, licenses and behavior; no new installer or runtime marketplace. The copied files own presentation and may be restyled; core controllers, resource semantics and native integration are imported from versioned packages rather than copied into each consumer. Server handlers/credentials never enter a browser item. A documented host setup deliberately installs the corresponding native tools/server operations.

Registry qualification uses an actual installation into a disposable consumer from built item JSON, not a manually copied demo. Validate item schemas and dependencies; typecheck/build the installed app; exercise chat, Markdown edit/proposal/receipt/reload and a custom viewer's agent tools; restyle copied components and rerun behavior. Verify the browser bundle contains no Pi kernel/server secrets and plain chat does not import heavy viewers. Test the selected tldraw adapter/license/assets separately. Do not advertise an installable v4 endpoint until its artifacts and serving location exist.

Styling levels: ready defaults; CSS variables/class/style hooks; replaceable component slots; fully headless client/hooks/unstyled rendering; source recipes owned by the consuming app. No fixed workspace layout, required global reset, mandatory shadcn/Tailwind theme or CSS injection outside the component root. Keep accessibility/state semantics when replacing visuals. A strict-CSP host can supply stylesheet/classes without inline styles. Third-party SDK styles/license constraints are qualified and tested separately.

A custom host can replace every Boring presentation component, not merely bubble colors. Renderer/business interpretation remains host code. Generated JSON only uses installed schema-validated bindings and named actions; source registry installation is a deliberate trusted development action, never a runtime instruction to import agent-authored native code.

### Distribution and version compatibility

Use the [standard registry format](https://ui.shadcn.com/docs/registry/registry-item-json). For a deliberately public release, evaluate [direct GitHub registry installation](https://ui.shadcn.com/docs/registry/github) before operating a registry server. Private repositories use the supported authenticated namespace or a controlled local fixture. Do not change repository visibility as a side effect. Pin the tested CLI and each item dependency separately; a parent ref does not pin all children.

Recipes declare compatible controller versions; tests install and restyle the actual copied source against them. Wire/client version compatibility is negotiated or checked by the selected transport. Unsupported pairs produce an explicit reload/upgrade requirement without losing unsaved buffers. This is a narrow compatibility check, not a second installer or runtime plugin manager. Actual browser bundles must exclude server/kernel modules and keep heavy optional viewers out of plain chat.

## Change review and draft recovery

The native tool, editor diff and review card reference one exact proposal with base revision, author/source, before/after and evidence where needed. Persist a durable proposal through existing resource/host storage, not a workflow database. Acceptance binds the reviewed change; regeneration/rebase makes a new proposal rather than expanding the open one. Reverting a committed edit is a new conditional operation, never erased history or a blind overwrite.

Offer opt-in injected draft storage, scoped to principal/resource/view/base revision. Sensitive hosts may omit browser persistence. Restore/discard requires an explicit choice and checks the current revision; a recovered draft is not a receipt or generation input until normal save/flush succeeds. Define logout/revocation/expiry and storage-failure behavior, including prevention of late writes after logout. Delete only the acknowledged draft version; a late save cannot delete later typing. Encryption/key management is host policy, not a claim that browser storage is inherently private.

The injected text-draft store binds an authenticated session to a stable provider
instance namespace. A replacement provider uses a new namespace. Records carry
their format, base, writer identity, and monotonic sequence. Stores atomically
reject older writes and retain a deletion floor after removal, so delayed writes
cannot recreate an acknowledged draft. Removing one writer's version preserves
newer versions and other writers. Reads and mutations check session validity and
expiry within their storage transaction; logout revokes that session and purges
its payloads in the same transaction. Abort notifications alone do not establish
this guarantee. Normal viewer disposal does not revoke a borrowed store.

Recovery validates the current resource and the selected local buffer again
before applying text. A pending or unknown save blocks restoration, including a
save of a clean buffer. Canvas recovery includes validated document records and
schema only. Experience recovery validates fixed descriptor text and clears
proposal and Pin authority. Draft persistence does not reconstruct a publication
attempt after reload or provide native chat continuity.

Retain v2 interaction behavior and the v3 proposal/controller pattern, but not implicit continued-typing overwrite. Quiet expert mode retains required questions and actionable errors. Read-only diagnostics link existing native/provider evidence and distinguish reconnect, reconciliation and new execution; no generic retry-all or duplicate trace store. Performance/calibration obligations live in [ACCEPTANCE.md](../acceptance/ACCEPTANCE.md#performance-and-recovery-calibration).

## Chat continuity and porting

The [legacy UI ledger](../compatibility/LEGACY-UI.md) is the starting source-to-port map. Port the mature v2 conversation/composer/tool-rendering behavior and v3 headless viewer/registry pattern; adapt runtime coupling to native Pi rather than copying an old gateway, coordinator or independently writable transcript. A minimal streaming example is an early slice, not full chat completion.

Real-browser acceptance must cover:

- Stable message/tool rows and expansion/selection during streaming; bounded long-history rendering; follow-bottom only while following; older-history scroll anchoring; target-specific window reset on thread switch.
- Loading history versus genuinely empty chat; noncontradictory terminal errors; retained drafts/attachments on denied or failed submission; uncertain accepted requests reconciled by identity rather than duplicated.
- Enter/Shift+Enter and IME composition, paste/drop/upload failures, focus/keyboard accessibility and correctly scoped drafts during reconnect or session changes.
- Quiet expert mode with required question/approval cards and actionable errors still visible; detailed developer mode; typed custom-tool renderers and authorized artifact links. Origin metadata, not text-prefix heuristics, identifies machine-authored control entries.
- Native steering, follow-up queues, stop-current/background behavior, retry and compaction surfaced accurately from native state. Host-owned model controls, base URL/authenticated fetch and router integration remain available.
- Multiple viewers sharing the relevant authorized stream, instance-bound command acknowledgement, retarget/unmount cleanup and no impact on the host-owned Harness lifecycle.

Reuse legacy component tests where their assumptions hold, but replace mocked layout/scroll coverage with actual browser journeys. Record source revision, retained/adapted/removed behavior and new evidence for each ledger row. Intentional removal needs an explicit product decision; a passing generic chat demo is not parity.

## Lessons from earlier embedding analysis

A prior design stress test (an analysis, not a deployed integration) established thread-before-message, opaque tenant scope, agent-specific policy, page target revisions, credential callbacks and strict-CSP/headless needs. Preserve those lessons, but do not inherit its proposed filesystem receipt hook as an atomicity proof.

Proposed website proof: attach beside the site's existing routes; role restrictions stay host policy; page commands (open a view, select an entry, propose a change) use the site's existing router/selection/inputs; a confirmed action goes through the site's domain services with true commit-time conditions. A server-sent version can fence a presentation command but is not itself an optimistic database lock. Stale/conflicting commands, cross-tenant reads, revoked authority, strict CSP and disconnected page are required tests. This is not a substitute for an actual implementation acceptance journey.
