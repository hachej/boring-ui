---
github: https://github.com/hachej/boring-ui/issues/1095
issue: 1095
state: ready-for-agent
updated: 2026-08-05
flag: flag:agent-inspection
track: owner
---

# gh-1095 Agent-level details, capabilities, and access inspection

## Problem

Users cannot inspect one Agent and reliably answer:

- Which definition, configured instructions, and model policy apply?
- Which logical environments, working directory, runtime, sandbox, and filesystem bindings can it use?
- Which access was requested, which access is currently enforced, what is checked only at execution time, and which areas are not represented?
- Which skills, Agent/Pi plugin contributions, tools, commands, and health facts belong to this Agent?
- Which package also contributes workspace/Boring applications without incorrectly making those workspace capabilities appear Agent-owned?

The relevant data is fragmented across fleet compilation, published runtime bindings, environment/workspace adapters, models, skills, tools, commands, plugin bootstrap, and readiness projections. The repository has no universal permission model. Missing data therefore cannot mean “no access,” and plugin/tool presence cannot mean authorization.

The current navigation also mixes ownership:

- Skills are addressed to an Agent.
- The current Plugins overlay is workspace-scoped (`/api/v1/agent-plugins`), not Agent-scoped.
- Tasks, Automation, dashboards, and other registered workspace applications are workspace capabilities.

Moving the current Plugins overlay into every Agent would duplicate workspace-only packages and falsely imply Agent ownership. Serializing compiled specs, runtime objects, plugin configuration, paths, prompts, diagnostics, or environment objects would expose secrets, host topology, or misleading permission claims.

## Solution

Add a feature-flagged, read-only **Agent Details** management page inside the workspace shell. In fleet mode the user selects an Agent using the existing future-chat selector and activates an adjacent gear/details button. In single-Agent mode, when the selector is hidden, a compact identity row provides the same Agent-specific gear. Opening the page snapshots that Agent ID into immutable `viewedAgentTypeId`; selector changes never silently retarget an open page.

Phase 1 uses six sections:

1. **Overview** — Agent identity, public definition metadata, provenance, inspection coverage, and static/runtime snapshot state.
2. **Configuration** — explicitly authorized configured Agent instructions, public instruction contribution provenance, safe public fingerprints, and model policy/snapshot.
3. **Runtime** — logical environments, CWD, runtime/sandbox, bindings, tools, and commands.
4. **Access** — requested/effective facts, enforcement source, scope, authority, coverage, conditions, freshness, and explicit Unknown states.
5. **Extensions** — Agent skills and Agent-associated packages; Agent/Pi contributions are distinct from linked workspace/Boring contributions from the same package.
6. **Diagnostics** — typed configuration validity, readiness/capability states, and stable producer-authored diagnostic codes.

When the Agent Skills navigation-cutover flag is enabled and a fresh authenticated current-principal capability lease proves that Agent Details Skills is a usable replacement for every advertised Agent, the global Agent Skills action leaves workspace navigation and Skills remains available through Agent Details.

Agent Details also shows Agent-associated plugin facts, but phase 1 does **not** remove or replace the existing workspace-scoped Plugins surface or its reload workflow. That surface owns `/api/v1/agent-plugins` and workspace package lifecycle; per-Agent Extensions is not an equivalent replacement. The generic Plugins menu remains in phase 1 while Tasks, Automation, dashboards, and other workspace applications remain unchanged. Its eventual removal is the long-term goal, but is blocked on a separate owner-approved Workspace Settings → Plugins replacement that preserves workspace-only package inspection and reload semantics.

The server exposes an explicitly authorized, versioned projection built only from allowlisted static facts and immutable frozen snapshots captured during normal compile/binding/admission work. Opening Details must never acquire an environment, resolve a runtime scope, create/publish a binding, construct a harness, provision a workspace, load packages, scan skills, start a sandbox, create a session, resolve execution-time bindings, or reload plugins.

Phase 1 is fully read-only. It contains no install, assignment, edit, reload, permission mutation, prompt mutation, environment mutation, or configuration mutation controls.

## Decisions

### 1. Inspection authorization is app-owned, default-deny, and section-level

Workspace membership and Agent scope verification are necessary but are not permission to disclose configuration or topology.

Add an app-owned authorization seam:

```ts
authorizeAgentInspection(request, {
  agentTypeId,
  section,
}): Promise<AuthorizedAgentInspection>
```

Rules:

- General inspection authorization runs before Agent-existence disclosure.
- One app authorization call returns an immutable capability set carried with the verified request scope; the Host does not perform one remote policy round-trip per section.
- Host scope verification still enforces workspace/Agent isolation.
- Default policy denies inspection unless the host explicitly grants it.
- Configured instruction text requires `agent.inspect.instructions`.
- Runtime topology requires `agent.inspect.runtime`.
- Access topology requires `agent.inspect.access`.
- Extensions requires `agent.inspect.extensions`.
- The contract supports owner/editor/viewer/local principals without hard-coding product roles into Agent Host. Core and standalone composition map principals to capabilities.
- A denied section appears only inside an already-authorized inspection response as `state: "denied"`. Unauthorized callers receive no Agent or section existence oracle.
- Responses use `Cache-Control: private, no-store`.

Expose browser capability through a dedicated authenticated, workspace/principal-scoped lease such as `GET /api/v1/agent-inspection-capabilities`. It is computed from the same authorization seam after workspace scope verification and returns only already-advertised Agent IDs, their inspectable sections, server-bounded lease timing, and `skillsReplacementAvailable`. Agent-associated plugin inspection availability is separate and is never workspace Plugins replacement proof. It never exposes denied/unknown Agent IDs, policy internals, role names, or principal identifiers. The browser binds it to current workspace identity, an opaque auth epoch, and the lease epoch/expiry.

Inspection authorization controls presentation only; it grants no execution permission.

### 2. Exposure, Skills cutover, and future Plugins cutover are independent

- `agentInspectionEnabled`: server kill switch and capability lease advertisement. When false, inspection metadata is not wired, the details route is unavailable, and gear/page are hidden.
- `agentSkillsNavCutoverEnabled`: requests retirement of the global Agent Skills action.
- `workspacePluginsNavCutoverEnabled`: reserved for the separate Workspace Settings → Plugins replacement. It defaults off, is not enabled by this issue, and cannot use Agent Details Extensions as replacement proof.

Effective **Skills** cutover is:

```text
agentSkillsNavCutoverEnabled
AND authenticated capability lease is unexpired/current
AND skillsReplacementAvailable is true for every advertised Agent
```

The existing workspace Plugins surface remains visible and functional throughout phase 1 regardless of Agent Details plugin facts. A future Plugins cutover requires its own authenticated `workspacePluginsReplacementAvailable` proof from the Workspace Settings replacement; Agent-associated plugin coverage is insufficient.

Gear/page visibility derives from an unexpired authenticated per-Agent capability lease, never a build-time flag or unauthenticated workspace hint. The lease has server-issued `issuedAt`, `expiresAt`, and bounded `maxAgeSeconds`. The browser revalidates before expiry and on focus/visibility/pageshow/online/reconnect.

While the lease is loading, expired, stale, revoked, malformed, or failed, the UI fails closed synchronously:

- stale Details data clears immediately;
- Details closes or becomes unavailable before retry;
- speculative gear targets are not offered;
- legacy Agent Skills navigation is restored in the same render/state transition;
- the workspace Plugins surface remains available.

Capability loss, server-side role/policy/flag change, endpoint error, or flag race cannot leave neither Skills surface available. Disabling the Skills navigation flag restores legacy Skills without disabling Details. Disabling server inspection removes endpoint exposure. Neither flag deletes legacy components or persisted values.

### 3. Viewed Agent identity is explicit and immutable until user action

- Fleet gear accessible name: `View details for {selected Agent}`.
- Activating gear snapshots the target into `viewedAgentTypeId`.
- Changing future-chat selection changes the gear’s prospective target but never retargets an open page.
- Only explicit `View {Agent} details` changes the viewed Agent.
- Agent Details children must not read contextual `WorkspaceProvider.agentTypeId`, which follows future-chat selection.
- Requests never infer viewed Agent from active chat/session ownership.

The page context strip shows:

- `Viewing: Alpha`
- if different: `New chats use: Gamma` with `View Gamma details`
- if different: `Current chat uses: Beta` with `View Beta details`

These actions change only Details target. They never create/switch a chat or alter future-chat selection.

### 4. Entry interaction covers fleet, single-Agent, and failure states

The existing fleet selector is native, so phase 1 does not add per-option gear actions or replace it.

- Fleet mode: persistent 44×44 CSS-pixel details button beside selector.
- Selector-hidden single-Agent mode: compact Agent identity row plus same 44×44 button.
- Fleet/capability loading: non-interactive status placeholder, not a speculative target.
- Fleet error, capability error/revocation, removed Agent, or host fallback absent from advertised fleet: hide/disable gear with concise explanatory text and preserve legacy navigation.
- Never request Details for a known-unadvertised fallback.
- Entry remains keyboard accessible in expanded, collapsed, narrow, and mobile layouts and is never hover-only.

### 5. In-shell management page, not a public browser route

Use an in-shell Agent Details page state in `WorkspaceAgentFront`, rendered in the full center management area. Do not add a deep link or `WorkspaceFullPagePanel` contract in phase 1.

Switching/creating a chat closes Details through existing shell behavior. Focus moves to page heading on open and returns to gear, or a stable shell fallback if gear disappeared, on close.

### 6. Static and passive runtime facts have explicit semantics

Inspection has two sources:

- **Static facts:** immutable public records produced during normal fleet compilation/bootstrap.
- **Passive runtime facts:** immutable, already-redacted frozen snapshots captured during normal binding publication/admission.

Slice 1 adds a synchronous non-acquiring accessor:

```ts
inspectPublishedCurrentSnapshot(
  agentTypeId: string,
  workspaceScopeId: string,
):
  | { state: "none" }
  | { state: "ambiguous" }
  | { state: "current"; snapshot: FrozenAgentInspectionSnapshot }
```

The accessor:

- reads only `publishedCurrentBindings`;
- filters by the already-verified `(agentTypeId, workspaceScopeId)` pair;
- does not need or derive physical/runtime binding identity;
- never calls `resolveAgentRuntimeScope`, `resolveBinding`, or environment acquisition;
- returns a frozen inspection snapshot, never a mutable runtime binding.

`none` means no published current binding exists and maps runtime sections to `not-instantiated`. `ambiguous` maps to `unknown` with a stable ambiguity reason. `current` means a published current snapshot exists even when one or more of its section item arrays are empty. A current snapshot with `items: []` and complete coverage is an authoritative current-empty result, never `none` or `not-instantiated`; a current snapshot with empty unknown coverage is represented-but-unknown. `current` is usable only when its frozen workspace/subject applicability and binding generation match the authorized request; mismatch maps to Unknown. Historical/session-pinned bindings are never auto-selected.

Details must not call:

- `resolveAgentRuntimeScope` or `resolveBinding`;
- runtime/environment acquisition or adapter `create`;
- `getHotReloadableResources`;
- dynamic prompt loaders;
- `getSlashCommands` or `getOrCreatePiSession`;
- request-time model/skill/package discovery;
- execution-time filesystem binding resolution;
- provisioning, session creation, reload, or remote inspection I/O.

Do not add callable/async adapter inspection methods. Producers append immutable typed descriptors to normal compile/binding/admission results. Execution-time/ad-hoc decisions remain `conditional` or `unknown`.

### 7. No effective full session prompt in phase 1

The V1 DTO never contains arbitrary `existingSessionId` or a full effective prompt and never auto-selects a session.

- Configured Agent definition instructions may be included only after `agent.inspect.instructions` authorization.
- Without authorization, text is omitted and section/fact reports denial.
- `instructionsRef` never becomes a raw host path. A logical source label may be shown.
- Instruction fingerprint is returned only under instruction authorization and includes exactly normalized fields already disclosed at that level.
- Hidden static/plugin prompt contributions show provenance only. No hidden-content hash is returned.
- A producer may supply an explicitly public artifact/version ID under configuration authorization, but not a digest derived from hidden prompt text.
- Dynamic prompt sources are never executed.
- Effective exact-session prompt inspection is a separately designed, separately authorized future feature.

### 8. Every section reports completeness, freshness, applicability, and authority

```ts
interface AgentInspectionSectionV1<T> {
  state:
    | "complete"
    | "partial"
    | "unknown"
    | "not-instantiated"
    | "not-applicable"
    | "denied"
  coverage: "complete" | "partial" | "none" | "unknown"
  authority: "authoritative" | "advisory" | "none"
  reasonCodes: string[]
  capturedAt?: string
  scope: {
    kind: "workspace" | "subject" | "session" | "binding" | "static"
    workspaceInvariant: boolean
    subjectId?: string
    sessionId?: string
    bindingGeneration?: number
  }
  items: T[]
}
```

Rules:

- Top-level `assembledAt` is response assembly time, not freshness.
- `capturedAt` belongs to producer snapshot.
- `items: []` + complete coverage is an authoritative empty set.
- `items: []` + unknown coverage means nothing was represented.
- Subject/session facts appear only when snapshot authority matches current authorized request.
- Old binding generations are not relabeled current.
- A public static fingerprint is never described as a raw source-definition digest.

### 9. Access facts present enforcement truth; they do not implement policy

Each fact contains:

- category and logical resource identifier;
- action;
- requested state and independent requested source;
- effective state and independent enforcement source;
- scope/applicability;
- authoritative flag;
- capture time and binding generation;
- coverage category;
- stable condition/reason codes;
- contribution provenance distinct from enforcement.

Semantics:

- `not-requested` requires a complete authoritative request declaration; ordinary absence is Unknown.
- `allowed`/`denied` requires the component that enforces the decision and a matching captured scope/actor.
- Execution-time admission is `conditional` with safe condition codes.
- Plugin discovery, a tool name, JavaScript method, empty grants array, or binding existence never proves access.
- Unsupported categories remain Unknown.

Required UI copy:

- `Requested — not proof of access`
- `Allowed in this scope at {time}`
- `Denied in this scope at {time}`
- `Checked when used`
- `No access facts were reported`
- `Not represented; this does not mean allowed or denied`
- binding without facts: `Access not reported`

Persistent note:

> Reported access is limited to the enforcement sources listed here; it may not enumerate execution-time or ambient host policy.

Trust labels describe execution domains, not endorsements:

- `Runs in host trust domain — not a safety endorsement`
- `Sandbox execution boundary — access still depends on reported policy`

### 10. Public data is typed, bounded, and producer-authored

Do not sanitize arbitrary internal objects after serialization.

- Construct DTOs field-by-field from typed inspection records.
- Diagnostics use stable codes plus closed, typed, bounded arguments.
- Omit arbitrary messages, stacks, provider errors, plugin config, resolved policy, headers, and environment values.
- `operatorSafeMessage` exists only on a dedicated producer-authored contract; it is never regex-scrubbed from arbitrary errors.
- Tool shapes expose mechanically derived parameter names/types/required flags. Omit defaults, examples, descriptions, regex patterns, unknown fields, and executable content.
- Labels/descriptions require explicit display-safe metadata.
- Strings, arrays, maps, nesting, diagnostics, tools, bindings, and contributions have fixed maximums.
- Reject/normalize control, ANSI, bidi, NUL, and non-display characters through type-specific constructors.
- URLs are omitted unless a dedicated public URL type removes credentials/fragments and rejects non-allowlisted query values.

No generic sanitizer is claimed to make arbitrary strings safe.

### 11. Public fingerprints cannot encode hidden data

Every returned fingerprint has a typed versioned input and the same disclosure authorization as every field that can affect it:

```ts
interface PublicAgentSpecFingerprintInputV1 {
  agentTypeId: string
  publicDefinitionId?: string
  publicDefinitionVersion?: string
  publicLabel?: string
  publicDescription?: string
  publicProvenanceIds: string[]
}

interface PublicInstructionFingerprintInputV1 {
  normalizedDisclosedInstructions: string
  publicSourceIds: string[]
}

interface PublicToolShapeFingerprintInputV1 {
  publicToolId: string
  parameters: Array<{
    name: string
    type: string
    required: boolean
  }>
}
```

Rules:

- `publicAgentSpecFingerprint` includes only independently public identity/metadata. It cannot change when hidden instructions, plugin config/policy, runtime identity, paths, secrets, or private prompt material change.
- `PublicInstructionFingerprintInputV1` is emitted only under `agent.inspect.instructions` and contains exactly the text/source IDs already disclosed.
- Tool shape fingerprints include only visible parameter name/type/required structure.
- Never reuse `resolvedPolicyDigest`, runtime identity hashes, raw compiled-spec hashes, raw schema hashes, raw prompt hashes, or producer digests without proven public inputs.
- Hidden prompt/plugin contributions use an explicitly public producer artifact/version ID or no identifier. Hashing hidden content is forbidden.
- Tests compare complete unauthorized DTO bytes while independently varying hidden instructions, prompt options, plugin config/policy, schema defaults/examples/patterns, secrets, runtime identity, and physical paths. Every public fingerprint must remain identical.

### 12. Logical editor targets only

Skills/plugins never expose absolute paths or host/package locations.

```ts
{ filesystemId: string; relativePath: string }
```

The target is produced only by the workspace/filesystem adapter that owns the authorized logical filesystem. Global/package/host/unmapped sources have no editor target. Agent Details does not reuse current absolute-path skill projection or rely on client bridge validation as authorization.

### 13. Package and contribution ownership is explicit

Extensions uses a three-way model:

1. Agent/Pi contributions associated with viewed Agent.
2. Workspace/Boring contributions from the same Agent-associated package, shown as linked workspace capabilities and explicitly not Agent-owned.
3. Workspace-only packages, omitted from Agent Details.

Generic Agent transport stays namespace-neutral:

```ts
contributions: Array<{
  namespace: string
  ownership: "agent" | "workspace-linked"
  kinds: string[]
  provenance: PublicProvenanceV1
}>
```

Workspace app layer maps `pi`/`boring` manifest vocabulary into this form. `packages/agent/src/shared/**` gains no Workspace taxonomy/value imports.

Phase 1 does not cut over the workspace Plugins surface. Agent Details shows only Agent-associated package facts and linked workspace contributions; it is not replacement proof for `/api/v1/agent-plugins` or reload. The generic Plugins menu may disappear only in a separate Workspace Settings → Plugins effort after that workspace-owned replacement advertises fresh authenticated replacement availability. Workspace app actions remain.

### 14. Reuse pure projection logic without invoking live resolvers

Do not duplicate model, skill, readiness, tool, command, or runtime-capability formatting rules.

Slice 1 reconciles readiness and runtime-capability vocabulary without turning `runtimeCapabilityProjection.ts` into a new utility owner:

- pure readiness/capability-state normalization and public summary constructors should live beside their semantic owners, likely existing readiness/route modules or new server-internal helpers adjacent to them;
- `runtimeCapabilityProjection.ts` remains orchestration and consumes those pure helpers;
- inspection snapshot capture consumes the same helpers only over already-captured typed inputs;
- current candidate resolution, `resolveAgentRuntimeScope`, `findPublishedCurrentBinding`, and live route orchestration remain exclusive to existing runtime-capability routes;
- Details never invokes those live paths.

Apply the same extraction to model/skill/tool/command/readiness routes where feasible. If a handler is entangled with Fastify/discovery/acquisition, create a pure constructor beside the route/readiness semantic owner over an already-captured typed fixture and leave resolver/orchestration unchanged. Add parity tests for shared state vocabulary and document Details’ stricter omissions.

### 15. Base workspace front remains independent of Agent values

Place Agent transport fetch/validation in workspace app integration layer:

- `packages/workspace/src/app/front/agent-details/useAgentDetails.ts`
- `packages/workspace/src/app/front/agent-details/useAgentInspectionCapabilities.ts`
- `packages/workspace/src/app/front/agent-details/agentDetailsAdapter.ts`

That layer may compose Agent values under existing app rules. It validates schema version, identity, envelopes, bounds, and additive fields, then passes a workspace-owned presentation model into base chrome.

Base `packages/workspace/src/front/**` components receive plain props and use type-only imports where permitted. They have zero Agent value imports.

### 16. Skills and Plugins views are pure prop-fed inventories

Extract stateless presentation components:

- `SkillsInventory`
- `PluginsInventory`

Legacy `SkillsPage` and `PluginsOverlay` retain current fetch/reload/event ownership for rollback. Details performs one inspection fetch and passes validated section items to pure inventories.

Details components must not:

- fetch selected-context skills;
- call `/api/v1/agent-plugins`;
- subscribe to global plugin reload events;
- call reload/install/edit endpoints;
- read contextual `WorkspaceProvider.agentTypeId`.

### 17. Navigation and data lifecycle are reversible and race-safe

Do not overwrite existing string-only `appLeftOverlay` persistence.

- Details state is separate typed `{ workspaceId, viewedAgentTypeId, section }` state.
- Under phase-1 Skills cutover, only a legacy persisted `skills` value is suppressed, not rewritten. A persisted `plugins` value continues opening the existing workspace Plugins surface.
- Optional Skills compatibility opening waits for fleet/capability resolution and maps only `skills` to Agent Details Extensions for an advertised authorized Agent. Any future Plugins migration must target the separate Workspace Settings → Plugins replacement, never Agent Details.
- Loading/error, removed Agent, corrupt state, unadvertised fallback, or capability loss closes safely to chat with no blank pane.
- Rollback reads untouched legacy value.

`useAgentDetails` request key is:

```text
{ workspaceId, viewedAgentTypeId, apiBaseUrl, authEpoch, capabilityEpoch, leaseExpiresAt }
```

For every key change or retry:

- create `AbortController`;
- increment a monotonic request epoch;
- abort prior request during cleanup;
- commit only from latest matching epoch;
- synchronously clear prior presentation data on workspace/auth/capability change or revocation;
- close/disable Details before refetch when capability is lost.

A late Alpha response cannot replace Gamma, survive into another workspace, remain after auth change, or remain after capability revocation. Header values are not persisted/logged; auth provider supplies opaque epoch/key identity.

## Inspection Contract

### Transport ownership

Define internal snapshots first. Publish a minimal versioned namespace-neutral transport under `packages/agent/src/shared/agentInspection.ts` only after real producer fixtures exist. Workspace app adapter maps it to workspace presentation.

### Top-level V1

```ts
interface AgentInspectionResponseV1 {
  schemaVersion: 1
  assembledAt: string
  agent: {
    agentTypeId: string
    label: string
    publicDescription?: string
    publicDefinitionId?: string
    publicDefinitionVersion?: string
    publicAgentSpecFingerprint: string
    provenance: PublicProvenanceV1
  }
  overview: AgentInspectionSectionV1<OverviewFactV1>
  configuration: AgentInspectionSectionV1<ConfigurationFactV1>
  runtime: AgentInspectionSectionV1<RuntimeFactV1>
  access: AgentInspectionSectionV1<AccessFactV1>
  extensions: AgentInspectionSectionV1<ExtensionFactV1>
  diagnostics: AgentInspectionSectionV1<DiagnosticFactV1>
}
```

Rules:

- Breaking semantics increment `schemaVersion`; additive fields remain V1 and clients ignore unknown additive fields.
- Deterministic ordering applies to every collection.
- Every type has size/count/depth bounds.
- Section state/coverage/authority/freshness/scope are mandatory.
- No effective prompt or arbitrary session ID exists in V1.
- Model availability is not credential presence or standing authorization.
- Unknown is first-class, not error/empty.
- Every fingerprint uses its matching `Public*FingerprintInputV1` authorization and cannot encode omitted data.

### Details route

Add `GET /api/v1/agents/:agentTypeId/details` only when `agentInspectionEnabled`.

Request sequence:

1. app-owned general inspection authorization;
2. Host workspace/Agent scope verification;
3. unknown-Agent lookup;
4. per-section capability application from authorized scope;
5. projection from immutable static records and `inspectPublishedCurrentSnapshot` result;
6. bounds/schema validation;
7. `Cache-Control: private, no-store` response.

Client headers cannot choose storage/authorization scope. Stable denied/unknown codes follow repository conventions without existence disclosure before authorization.

### Capability advertisement route

Add authenticated `GET /api/v1/agent-inspection-capabilities` under server flag.

Response is bounded/non-cacheable and acts as a server-bounded authenticated capability lease. It includes:

- `issuedAt`, `expiresAt`, and bounded `maxAgeSeconds`; the server chooses the maximum lifetime and the client cannot extend it;
- workspace identity already authorized for browser;
- already-advertised Agent IDs only;
- general/section availability per Agent;
- `skillsReplacementAvailable` computed from current principal authorization plus actual populated Agent Skills replacement support;
- Agent-associated plugin inspection availability, explicitly **not** a claim that the workspace Plugins surface can be removed;
- capability epoch/version suitable for client invalidation.

The client treats `expiresAt` as a hard boundary with no stale grace. It revalidates early enough to complete before expiry (bounded by the smaller of 80% of the lease lifetime or 30 seconds before expiry), and also revalidates on window focus, `visibilitychange` to visible, `pageshow`, browser `online`, and transport/auth reconnect. A failed, malformed, revoked, or expired lease synchronously clears Agent Details data, closes/disables the page, restores legacy Agent Skills navigation, and preserves the workspace Plugins surface before any asynchronous retry. Server-side flag, role, policy, or section-capability changes therefore take effect without requiring workspace or auth-epoch changes.

It omits principal ID, roles, policy internals, denied Agent identities, and any execution permission. Workspace/auth changes invalidate response. Lease expiry, focus/reconnect revalidation, or a changed server-side flag/role/policy/section capability also invalidates it even when workspace and auth epoch are unchanged.

## Server Architecture

### Static snapshot

Add internal types/constructors near Agent Host:

- `packages/agent/src/server/agent-host/inspectionSnapshot.ts`
- `packages/agent/src/server/agent-host/inspectionProjection.ts`

Capture only proven public facts:

- compiler-supplied public Agent identity;
- `publicAgentSpecFingerprint` from typed public input;
- configured instruction text gated at response time;
- logical instruction source;
- authorized instruction fingerprint;
- prompt contribution provenance without hidden-content digest;
- requested model facts only where declaration is complete;
- Agent-associated package provenance supplied by trusted bootstrap;
- section coverage/reason codes.

### Published binding snapshot/accessor

Normal binding publication attaches a frozen bounded already-redacted inspection snapshot.

`inspectPublishedCurrentSnapshot(agentTypeId, workspaceScopeId)` synchronously filters `publishedCurrentBindings` by verified pair and returns `none`, `ambiguous`, or `current(frozenSnapshot)`. It never resolves identity or returns mutable binding.

Snapshot capture may reuse pure runtime-capability and route serializers extracted in Slice 1, but occurs only during the normal operation that already owns data. Zero/one/multiple current publications, subject mismatch, and generation mismatch have exact tests with forbidden resolver/acquirer spies at zero.

### Environment/access producers

Environment, workspace, runtime mode, sandbox, filesystem, and admission producers may contribute immutable facts during existing lifecycle. Each declares:

- logical resource ID/label;
- captured scope/actor applicability;
- coverage/authority;
- requested/effective truth source;
- stable condition/reason codes;
- capture time and binding generation.

Absence maps Unknown. Physical paths, handles, mounts, credentials, and environment values never enter snapshot.

### Runtime inventory producers

Models, skills, Agent/Pi plugins, tools, commands, readiness, and diagnostics contribute typed summaries during binding/harness publication. Request-time inspection never calls acquiring/discovery routes.

Skills get editor targets only from authorized adapters. Workspace-only packages are omitted. Workspace-linked contributions appear only for Agent-associated packages.

### Workspace bootstrap provenance

Normalize trusted package/bootstrap metadata into bounded namespace-neutral input keyed by package ID. Include only public package identity/version/artifact ID, contribution namespaces/kinds, linked workspace kinds, authoritative admission/load state, typed diagnostic codes, and public trust-domain semantics.

Never include config values, raw policy, bridge handlers, source paths, prompt text, arbitrary messages, or hidden-content digests.

## UI Architecture

### Authenticated capability and app integration layer

Add:

- `useAgentInspectionCapabilities.ts`
- `useAgentDetails.ts`
- `agentDetailsAdapter.ts`
- focused hook/adapter tests.

Capability hook is fenced by workspace/auth epoch **and lease expiry** and exposes only an unexpired authenticated advertisement. It schedules bounded pre-expiry revalidation and listens for focus, visibility-to-visible, pageshow, online, and transport/auth reconnect. Details hook receives workspace identity, viewed Agent, API base, headers, auth epoch, capability epoch, and lease expiry. It aborts/increments epoch on every identity/scope/auth/capability/lease change and rejects late/mismatched/malformed responses. Expiry or revalidation failure synchronously clears data, closes/disables Details, and restores legacy Skills navigation before retry; workspace Plugins never disappears in phase 1.

### Base presentation

Add prop-fed components under `packages/workspace/src/front/chrome/agent-details/`:

- `AgentDetailsPage.tsx`
- `AgentDetailsNavigation.tsx`
- `AgentContextStrip.tsx`
- `AgentAccessFacts.tsx`
- `SkillsInventory.tsx`
- `PluginsInventory.tsx`
- focused tests.

Base layer consumes workspace-owned presentation model, not Agent values.

### Six-section behavior

Desktop uses stable section rail/tablist. Narrow/mobile uses horizontally scrollable tablist with active item scrolled into view.

- Arrow Left/Right and Home/End navigate tabs.
- Loading uses `role="status"`.
- Errors use `role="alert"` and Retry.
- Page failure differs from section denied/unknown/not-instantiated.
- `not-instantiated` is neutral, not unhealthy.
- Narrow Access uses labeled cards/definition rows, not detached scrolling table.
- Long instructions/structural summaries collapse by default, are bounded/copyable, and wrap without page horizontal scroll.
- State is text+icon, never color alone.

## Flag / Abstraction

- **Server:** `agentInspectionEnabled`, default false. Gates snapshot wiring, routes, capability advertisement, gear/page exposure.
- **Skills navigation:** `agentSkillsNavCutoverEnabled`, default false. Effective only with an unexpired authenticated `skillsReplacementAvailable` lease for every advertised Agent. Loading/error/expiry/revocation fails closed synchronously to legacy Skills.
- **Plugins navigation:** `workspacePluginsNavCutoverEnabled` is a reserved future control, default false and not enabled in phase 1. It requires a separate workspace-owned Settings/Plugins replacement and fresh `workspacePluginsReplacementAvailable`; Agent Details plugin facts cannot satisfy it. The existing workspace Plugins surface/reload remains.
- **Abstractions:** immutable snapshots; discriminated no-acquire accessor; section envelopes; typed public fingerprints; capability advertisement; minimal transport; app adapter; prop-fed UI; explicit viewed-Agent state.
- **Rollback:** disable the Skills cutover to restore legacy Skills; disable server inspection to remove endpoint/page. Workspace Plugins is unaffected in phase 1. Preserve legacy components/persistence for one release window. No deletion without explicit permission.

## Test Seams

### Highest public seams

- Authenticated capability/details HTTP contracts through real Core and standalone Workspace composition.
- Agent Host no-acquisition behavior around published snapshots.
- Workspace adapter identity/schema/bounds validation.
- Capability/Details hook race fencing.
- `WorkspaceAgentFront` fleet and single-Agent identity/navigation behavior.
- Desktop/mobile scripted proof.

### Required authorization/capability tests

1. Server flag off: routes unavailable, no details payload.
2. Flag on but capability denied: no Agent existence disclosure.
3. General auth precedes scope/Agent lookup.
4. Section capabilities independently deny instructions/runtime/access/extensions.
5. Core owner/editor/viewer and standalone local/no-token mappings are explicit.
6. Forged workspace/storage headers cannot choose scope.
7. Unknown Agent/denied scope use stable non-leaking codes.
8. Responses are private/no-store.
9. Advertisement is authenticated, bound to workspace/auth epoch, and carries server-bounded `issuedAt`/`expiresAt`/`maxAgeSeconds`; denied/unadvertised Agents never appear.
10. Gear requires per-Agent general capability from an unexpired lease.
11. Skills cutover requires current `skillsReplacementAvailable` for every advertised Agent; Agent plugin facts never remove the workspace Plugins surface.
12. Loading, expiry, role downgrade, capability loss, malformed/stale advertisement, endpoint error, and flag race synchronously clear/close Details and preserve/restore legacy Skills without dead-end.
13. Focus, visibility, pageshow, online, and transport/auth reconnect revalidate; bounded pre-expiry refresh occurs before the hard expiry.
14. Server-side role, policy, section capability, and inspection/Skills flag changes are observed on revalidation even when auth epoch and workspace identity do not change.
15. `workspacePluginsNavCutoverEnabled` cannot become effective without separate authenticated workspace replacement proof; in phase 1 Plugins inventory/reload remains reachable.

### Required no-side-effect/accessor tests

For first and repeated Details requests assert zero calls/changes to:

- runtime scope resolver/`resolveBinding`;
- environment acquisition/adapter create;
- harness/session creation/`getOrCreatePiSession`;
- provisioning/filesystem resolution;
- dynamic prompt/resource loaders;
- package/skill discovery;
- hot reload/slash-command loading;
- session files/counts, binding keys/generations, request ledger effects, runtime publication.

Accessor tests prove:

- zero matching current publications -> `none`/`not-instantiated`;
- one -> `current(frozenSnapshot)`, including authoritative current-empty section arrays that must not collapse to none/not-instantiated;
- multiple -> `ambiguous`;
- key uses only Agent/workspace;
- subject/generation mismatch -> Unknown projection;
- all forbidden resolver/acquirer calls remain zero.

### Required contract/security tests

1. `[] + complete` differs from `[] + unknown`.
2. `assembledAt` never overwrites `capturedAt`.
3. Old generation/other-subject/session facts cannot become current authoritative.
4. `not-requested` requires complete authoritative declaration.
5. Allowed/denied requires matching authoritative enforcement scope.
6. Configured instruction text/fingerprint require instruction capability.
7. Hidden prompt text has no content-derived digest.
8. Dynamic prompts are not invoked.
9. Seeded secrets, credential URLs, paths, config/policy, stacks, headers never serialize.
10. Strings reject/normalize ANSI/bidi/control/NUL/oversize/unsafe URLs/path messages.
11. Diagnostics accept only known codes/typed bounded args.
12. Tool structures omit defaults/examples/descriptions/patterns/unknown fields.
13. Editor targets require approved filesystem ID + safe relative path.
14. Ordering/count/depth/length bounds hold.
15. Namespace-neutral DTO contains no Workspace taxonomy.
16. Pure serializer parity includes helpers extracted from `runtimeCapabilityProjection.ts`; stricter omissions documented.
17. Unauthorized complete DTO bytes and every fingerprint remain identical when hidden instructions, prompt options, plugin config/policy, schema defaults/examples/patterns, secrets, runtime identity, or physical paths change.
18. Fingerprint constructors reject non-public inputs and emit only at matching authorization.

### Required UI tests

1. Fleet gear is selector-adjacent, 44×44, and names Agent.
2. Single-Agent selector-hidden mode renders identity+gear.
3. Loading shows non-target status; fleet error/removed/unadvertised fallback/denial disables entry and preserves legacy nav.
4. Opening snapshots viewed ID; selector change does not retarget/refetch.
5. Current-chat, future-chat, viewed identities can all differ; explicit actions alter only viewed.
6. Open/close creates/switches no chat and restores focus.
7. Six sections support keyboard/focus/loading/retry/page failure/denied/unknown/not-instantiated.
8. Access copy includes Requested-not-grant and symmetric Allowed/Denied captured-scope wording.
9. Trust copy is not endorsement.
10. Skills/Plugins are prop-fed, no contextual/global fetch/reload subscription.
11. Extensions distinguish Agent/Pi, linked workspace, omitted workspace-only.
12. Server flag hides gear/page; Skills nav flag off preserves legacy Skills; workspace Plugins remains in phase 1.
13. Effective Skills cutover removes global Skills while Plugins, Tasks, Automation, and workspace apps remain.
14. Legacy persisted values survive flags; no blank pane on errors/removal/corruption.
15. `useAgentDetails` fencing blocks late Alpha-after-Gamma, prior workspace, prior auth, expired/revoked capability responses and clears stale data immediately.
16. Expanded/collapsed/mobile/narrow remain accessible.
17. Capability expiry/loss restores legacy Skills synchronously before suppressing replacement and closes Details.
18. Focus/reconnect/pre-expiry revalidation observes server-side policy/role/flag changes with unchanged workspace/auth epoch.
19. Future Plugins cutover remains ineffective without a workspace-owned replacement lease; existing inventory/reload behavior remains.

### Avoid testing

- Do not snapshot raw prompts, schemas, catalogs, config, or internal objects.
- Do not treat discovery/association as authorization.
- Do not assert private Host map shape when public no-side-effect behavior suffices.
- Do not require live credentials/providers/remote workers/runtime boot.
- Do not retest Tasks/Automation internals; assert navigation preservation only.

## Acceptance

### Product

- Every advertised Agent is inspectable through fleet selector+gear or single-Agent identity+gear.
- Loading/error/unadvertised/capability-loss states never target invalid Agent and never remove legacy replacement before Extensions availability is proven.
- Read-only page uses six sections.
- Instructions visible only to authorized inspectors; hidden contributions show provenance/public artifact ID only.
- Runtime includes logical CWD/runtime/sandbox/bindings without physical topology.
- Access shows requested/effective source, scope, authority, coverage, freshness, conditions, Unknown, and non-misleading copy.
- Skills/Agent-associated packages are Agent-level.
- Linked workspace contributions are not Agent-owned; workspace-only omitted.
- Global Agent Skills disappears only under an unexpired authenticated effective Skills cutover.
- The workspace-scoped Plugins surface and reload remain in phase 1; Agent Details plugin facts do not replace them.
- The generic Plugins menu remains a documented long-term removal target, blocked on a separate Workspace Settings → Plugins replacement; workspace apps remain.
- No mutation controls.

### Identity/lifecycle

- Viewed Agent is immutable until explicit action.
- Viewed/future/current identities never cross.
- Opening/reloading performs no runtime/session/provisioning/discovery mutation.
- Runtime absence/ambiguity/staleness/subject mismatch explicit.
- Late responses cannot cross Agent/workspace/auth/capability/lease epochs.
- Capability expiry or refresh failure synchronously clears/closes Details and restores legacy Skills; focus/reconnect/pre-expiry revalidation observes server changes without an auth/workspace change.
- A published current snapshot with authoritative empty items remains current-empty and is not mislabeled not-instantiated.

### Security/correctness

- App section auth plus Host scope verification enforced.
- Server flag off removes endpoint.
- No secrets, credentials, raw env, paths, config/policy, handles, arbitrary diagnostics, raw schemas, effective prompt.
- Effective access only from matching authoritative immutable snapshots.
- Unknown never means allowed/denied.
- DTO bounded/validated/deterministic/no-store.
- Public fingerprints use same-authorization public inputs only; hidden data cannot affect unauthorized DTO bytes.
- Passive lookup distinguishes none from ambiguity without runtime identity resolution.

### Quality

- Package invariants preserved.
- Focused producer/projection/adapter/hook/component tests; shell suite only integration.
- Accessibility and desktop/mobile layouts proven.
- Relevant typechecks, tests, invariants, E2E, UI review, security review, thermo pass exact SHA.

## Proof

### Commands

```bash
pnpm --filter @hachej/boring-agent run typecheck
pnpm --filter @hachej/boring-agent exec vitest run \
  src/server/agent-host/__tests__/agentInspectionSnapshot.test.ts \
  src/server/agent-host/__tests__/agentInspectionProjection.test.ts \
  src/server/agent-host/__tests__/publishedInspectionSnapshot.test.ts \
  src/server/agent-host/__tests__/publicInspectionFingerprint.test.ts \
  src/server/agent-host/__tests__/httpProjection.test.ts

pnpm --filter @hachej/boring-workspace run typecheck
pnpm --filter @hachej/boring-workspace exec vitest run \
  src/app/front/agent-details/agentDetailsAdapter.test.ts \
  src/app/front/agent-details/useAgentDetails.test.tsx \
  src/app/front/agent-details/useAgentInspectionCapabilities.test.tsx \
  src/front/chrome/agent-details/AgentDetailsPage.test.tsx \
  src/app/front/__tests__/WorkspaceAgentFront.test.tsx \
  src/app/server/__tests__/createWorkspaceAgentServer.test.ts

pnpm run check:invariants
git diff --check
git diff --cached --name-only
git status --short
git rev-parse HEAD
```

### Artifacts

Capture exact SHA and desktop/mobile artifacts showing:

1. Alpha viewed while new chats use Gamma/current chat Beta.
2. Authorized configuration and provenance-only hidden contributions.
3. Runtime/Access with complete/partial/conditional/Unknown/not-instantiated.
4. Requested-not-grant and symmetric Allowed/Denied copy.
5. Extensions Agent/Pi versus linked workspace contributions.
6. Global nav with Skills retired only under a valid lease, while workspace Plugins (including reload), Tasks, and Automation remain.
7. Single-Agent identity+gear and fleet loading/error/unadvertised fallback states.
8. Mobile section navigation/Access cards.
9. No mutation controls.

### Manual

1. No sessions/bindings: open Details; counts unchanged.
2. Change future selection while Alpha viewed; no retarget/refetch.
3. Explicit View future/current actions change only viewed Agent.
4. Trigger out-of-order Alpha/Gamma responses, workspace switch, auth epoch change, hard lease expiry, capability revocation, and server-side role/policy/flag change without workspace/auth change; stale content never commits/remains, Details closes, and Skills restores synchronously.
5. Exercise requested denial, conditional, partial, Unknown fixtures and copy.
6. Search response/DOM for seeded secret/path/control markers; none.
7. Vary hidden inputs and compare unauthorized serialized DTO bytes; identical.
8. Toggle Skills cutover off; legacy Skills/persistence returns. Confirm workspace Plugins inventory/reload never disappeared.
9. Toggle server inspection off; routes/gear/page unavailable.

### Review

- Security/authorization review after Slices 1–3.
- High-taste UI review for hierarchy/access/trust/focus/mobile.
- Thermonuclear review before cutover.
- Proof comments name commands, SHA, artifacts, reviewers, residual Unknown coverage.

## Slices

### Slice 1: Internal truth-source and safety primitives (no route)

**Delivers:**

- Immutable static/binding envelopes with coverage/authority/freshness/scope/actor/bounds.
- App authorization contract/default-deny integration interface.
- Typed public constructors, diagnostics, tool structures, editor targets, `Public*FingerprintInputV1`.
- Synchronous `inspectPublishedCurrentSnapshot` discriminating none/ambiguous/current without identity resolution.
- Pure readiness/capability helpers extracted beside their readiness/route semantic owners; `runtimeCapabilityProjection.ts` remains orchestration and consumes them. Other pure constructors follow the same ownership rule where safe.
- No-side-effect/adversarial tests.

**Likely files:**

- `packages/agent/src/server/agent-host/inspectionSnapshot.ts` (new)
- `packages/agent/src/server/agent-host/types.ts`
- `packages/agent/src/server/agent-host/createAgentHost.ts`
- `packages/agent/src/server/agent-host/runtimeCapabilityProjection.ts`
- extracted server-internal runtime summary helper (exact path finalized here)
- focused Agent Host tests

**Blocked by:** None.

**Ownership:** Agent Host/runtime owner owns accessor/frozen snapshot/helper extraction. Shared-contract reviewer owns fingerprint inputs. No workspace UI work.

**Proof:** Agent typecheck; envelope/scope/actor/freshness/bounds; zero/one/multiple accessor; hidden-data byte/fingerprint invariance; runtime parity; repeated no-side-effect; adversarial producer tests; security review.

**Review budget:** Exceeds routine PR but contains one invariant: only immutable proven public facts can become inspectable.

### Slice 2: Minimal flagged V1 static projection and capability advertisement

**Delivers:**

- Minimal namespace-neutral V1.
- Server kill switch and Core/standalone authorization mappings.
- Authenticated workspace/principal-scoped server-bounded capability lease with `issuedAt`/`expiresAt`/`maxAgeSeconds`.
- Authorized non-cacheable details route.
- Public identity/fingerprint, instruction gating/fingerprint, provenance-only hidden contributions, complete requested model facts, Agent package provenance.
- Static sections and explicit runtime not-instantiated.
- Workspace app adapter parser boundary.

**Blocked by:** Slice 1.

**Ownership:** Agent/Core server owner implements routes/advertisement/auth/DTO; workspace app owner implements adapter parser. Navigation suppression prohibited.

**Proof:** flags, roles/capabilities, auth order, no leaks, workspace/auth advertisement fencing, schema/bounds, hidden fingerprint invariance, no-store, typecheck/invariants, API/security review.

**Review budget:** Security-sensitive public exposure; excludes environment/access/runtime inventories/UI.

### Slice 3A: Environment and access truth snapshots

**Delivers:**

- Immutable logical environment/CWD/runtime/sandbox/binding records from named producers.
- Requested/effective facts with independent sources, authority, scope/actor, capture/generation, conditions, Unknown.
- No universal engine/callable descriptors.
- Typed UI access-copy fixtures including Requested-not-grant and Allowed/Denied captured-scope wording.

**Blocked by:** Slice 2.

**Ownership:** Runtime/environment/workspace adapter owner supplies immutable facts; Agent Host owner aggregates only typed descriptors.

**Proof:** authoritative/partial/unknown/conditional fixtures; actor/session/generation fencing; topology omission; no acquire; copy fixture contract; thermo/security review.

**Review budget:** Highest-risk; independent from inventories/UI.

### Slice 3B: Runtime inventories and contribution snapshots

**Delivers:**

- Immutable models, skills, Agent/Pi packages, tools, commands, readiness, typed diagnostics during normal publication.
- Pure serializers with parity/stricter omission tests, including runtime capability helpers.
- Logical editor targets.
- Namespace-neutral contributions and workspace mapping for linked contributions.
- Pure Skills/Plugins inventories may be extracted here or Slice 4.

**Blocked by:** Slice 2.

**Ownership:** Agent runtime inventory owner handles model/skill/tool/command/readiness capture; workspace plugin owner handles safe package provenance mapping.

**Proof:** no discovery/acquire; parity; path/schema/diagnostic bounds; package ownership; Agent/Workspace typechecks/invariants.

**Review budget:** May split internally by owner if serializer extraction too broad, without public scope change.

### Slice 4: Agent Details UI behind current authenticated capability

**Delivers:**

- Capability-lease and Details hooks/adapters plus prop-fed six-section page.
- Bounded pre-expiry refresh plus focus/visibility/pageshow/online/reconnect revalidation.
- Synchronous expiry/failure clearing, Details closure, and legacy Skills restoration.
- Fleet selector gear and selector-hidden single-Agent identity+gear.
- Immutable viewed state/context actions.
- Loading/error/revoked/removed/unadvertised entry states.
- AbortController + epoch fencing across Agent/workspace/auth/capability.
- Accessible responsive sections, Access cards/copy, all section states.
- Pure Skills/Plugins inventories.
- Non-destructive Details state.
- Fixture UI can proceed after Slice 2; final integration waits 3A/3B.

**Blocked by:** Slice 2 for fixture contract; integration by 3A/3B.

**Ownership:** Workspace app-front owner owns hooks/fencing/thin shell wiring. Base-front UI owner owns pure page/accessibility. No section logic in `WorkspaceAgentFront.tsx`.

**Proof:** typecheck; adapter/hooks/components/shell; capability and late-response/workspace/auth/revocation fencing; identity E2E; single/loading/error/fallback; access copy; keyboard/focus; desktop/mobile; UI review.

**Review budget:** Keep shell changes thin and focused components separate.

### Slice 5: Agent Skills navigation cutover, compatibility, exact-SHA proof

**Delivers:**

- Skills nav flag removes global Agent Skills only when an unexpired authenticated lease proves Skills replacement for all advertised Agents.
- Fail-closed loading/expiry/role downgrade/capability loss/malformed/stale/error/flag-race behavior with synchronous Details clearing/closure and legacy Skills restoration.
- Server-side role/policy/section/flag changes observed through bounded pre-expiry and focus/reconnect revalidation without workspace/auth changes.
- Existing workspace Plugins inventory/reload, Tasks, Automation, and workspace apps preserved.
- Future generic Plugins removal explicitly blocked on a separate Workspace Settings → Plugins replacement and its own authenticated replacement lease.
- Legacy overlay values suppressed non-destructively and restored on rollback.
- Full proof; legacy wrappers retained; no deletion.

**Blocked by:** Slices 3A, 3B, 4.

**Ownership:** Workspace shell/navigation owner owns reversible cutover/persistence compatibility. Agent server changes prohibited except final-review blocker fixes.

**Proof:** full CI/E2E/UI; lease expiry/focus/reconnect/server-policy-change/replacement/flag-race tests; workspace Plugins inventory/reload preservation; rollback; exact SHA/status/diff; security/spec/thermo.

**Review budget:** Focused cutover PR after prior slices.

## Dependencies

```text
Slice 1 internal primitives
  -> Slice 2 static V1 + capability advertisement
      -> Slice 3A environment/access --------------------------┐
      -> Slice 3B inventories/contributions -------------------+-> Slice 5 Skills cutover
      -> Slice 4 fixture UI + capability lease ----------------┘

Future separate issue: Workspace Settings → Plugins replacement
  -> future authenticated workspace Plugins cutover (not phase 1)
```

After owner approval, create dependency-aware Beads. Validate with `br dep cycles` and `bv --robot-insights`; never bare `bv`.

## Out of Scope

- Effective full session prompt.
- Editing instructions/models/CWD/environments/permissions/skills/plugins/tools/assignments.
- Moving or removing the existing workspace Plugins inventory/reload surface in phase 1.
- Plugin install/uninstall/enable/disable/reload from Agent Details.
- Universal permission engine or claims about unrepresented rights.
- Request-time acquisition/discovery/remote inspection/adapter introspection.
- Secrets, credential values/presence claims, raw env, private paths, mounts, roots, config/policy, handles, arbitrary diagnostics, raw schemas, hidden-content digests.
- Building Workspace Settings → Plugins or executing the eventual generic Plugins-menu cutover; that separate issue owns workspace-only package inspection/reload replacement.
- Changing Tasks/Automation/dashboards/workspace app ownership.
- Replacing native selector.
- Browser deep link.
- Deleting legacy components/persistence.
- Cross-workspace/org fleet administration.

## Open Questions

No product decision blocks implementation. Secure phase-1 defaults are explicit:

- inspection/instruction disclosure default-deny;
- effective prompt excluded;
- hidden prompt contributions have provenance/public producer artifact ID only, never hidden-content digest;
- unrepresented access is Unknown;
- workspace-owned Settings/Plugins replacement and generic-menu cutover deferred; existing workspace Plugins inspection/reload preserved;
- in-shell read-only page;
- server exposure/Skills nav cutover independently reversible;
- Skills cutover requires an unexpired authenticated Skills replacement lease;
- capability leases are server-bounded and revalidated before expiry and on focus/reconnect, with synchronous clear/close/restore on expiry/failure;
- workspace Plugins remains in phase 1; eventual generic Plugins removal requires a separate Workspace Settings replacement and authenticated proof;
- hidden data cannot affect unauthorized fingerprints;
- passive selection uses discriminated no-acquire snapshot accessor.

Any relaxation requires a new owner-approved issue and security review.
