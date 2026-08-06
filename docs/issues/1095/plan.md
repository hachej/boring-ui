---
github: https://github.com/hachej/boring-ui/issues/1095
issue: 1095
state: ready-for-human
updated: 2026-08-05
flag: flag:agent-inspection
track: owner
---

# gh-1095 Agent-level details, capabilities, and access inspection

## Problem

Users cannot inspect one Agent and reliably answer:

- Which public definition, configured instructions, and model policy apply?
- Which logical environments, working directory, runtime, sandbox, and filesystem bindings can it use?
- Which access was requested, which access is currently enforced, what is checked only when used, and which areas are not represented?
- Which skills, Agent/Pi package contributions, tools, commands, and health facts belong to this Agent?
- Which package also contributes workspace/Boring applications without incorrectly making those workspace capabilities appear Agent-owned?

The facts are fragmented across fleet compilation, lazy runtime bindings, environment/workspace adapters, models, skills, tools, commands, plugin bootstrap, and readiness projections. The repository has no universal permission model. Missing data therefore cannot mean “no access,” and plugin/tool presence cannot mean authorization.

The current navigation also mixes ownership:

- Skills are presented globally but are addressed to an Agent/runtime context.
- The existing Plugins experience is composition-dependent, not a per-Agent inventory:
  - the standalone Workspace server exposes a server-instance host package inventory plus SSE events;
  - the CLI hub resolves that inventory through its workspace-scoped routing layer;
  - Core does not currently mount `/api/v1/agent-plugins`;
  - reload is not part of that catalog endpoint: it is the Agent-addressed `POST /api/v1/agents/:agentTypeId/reload`, invoked through the overlay’s host callback for the active chat Agent.
- Tasks, Automation, dashboards, and other registered workspace applications are workspace capabilities.

Moving the existing Plugins surface into each Agent would duplicate host/workspace packages and falsely imply Agent ownership. Serializing compiled specs, runtime objects, plugin configuration, absolute paths, prompts, diagnostics, or environment objects would expose secrets, host topology, or misleading permission claims.

## Solution

Add a feature-flagged, read-only **Agent Details** management overlay for the plugin-tabs workspace layout. In fleet mode, the user selects an Agent using the existing future-chat selector and activates an adjacent gear/details button. In selector-hidden single-Agent plugin-tabs mode, a compact identity row provides the same Agent-specific gear. Opening Details snapshots that Agent ID into immutable `viewedAgentTypeId`; selector changes never silently retarget an open page. Classic layout does not expose the gear in phase 1 because it does not render the management overlay slot.

The overlay contains six sections:

1. **Overview** — Agent identity, public definition metadata, provenance, inspection coverage, and static/runtime snapshot state.
2. **Configuration** — explicitly authorized configured Agent instructions, public instruction-contribution provenance, safe public fingerprints, and model policy/snapshot.
3. **Runtime** — logical environments, CWD, runtime/sandbox, bindings, tools, and commands.
4. **Access** — requested/effective facts, enforcement source, scope, authority, coverage, conditions, freshness, and explicit Unknown states.
5. **Extensions** — statically known and passively captured Agent skills plus Agent-associated packages; Agent/Pi contributions are distinct from linked workspace/Boring contributions from the same package.
6. **Diagnostics** — typed configuration validity, readiness/capability states, snapshot freshness/staleness, and stable producer-authored diagnostic codes.

When the Agent Skills navigation-cutover flag is enabled and a fresh authenticated current-principal capability lease proves that Agent Details Skills is a usable contract/UI replacement for every advertised Agent, the global Agent Skills action leaves workspace navigation. Replacement availability does not require every Agent to have an instantiated runtime or a populated runtime inventory: Agent Details must truthfully render statically proven skill facts together with `not-instantiated`, partial, and Unknown runtime coverage.

Agent Details shows Agent-associated package facts, but phase 1 does **not** remove or replace the existing Plugins experience. Existing Plugins behavior remains unchanged in every composition in which it exists today. Its eventual generic-menu removal remains the long-term goal, blocked on a separately approved Workspace Settings → Plugins replacement that preserves host/workspace package inspection, SSE updates, and the appropriate reload semantics.

The server exposes an explicitly authorized, versioned projection built only from allowlisted static facts and immutable facet snapshots captured or atomically replaced by normal compile/publication/admission, readiness-tracker, and effective-resource refresh lifecycle owners. Opening Details must never acquire an environment, resolve a runtime scope, create/publish a binding, construct a harness, provision a workspace, load packages, scan skills, start a sandbox, create a session, resolve execution-time bindings, or reload plugins.

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
- One app authorization call returns an immutable section-capability set carried with the verified request scope; Agent Host does not perform one remote policy round-trip per section.
- Host scope verification still enforces workspace/Agent isolation.
- Default policy denies inspection unless the host explicitly grants it.
- Configured instruction text requires `agent.inspect.instructions`.
- Runtime topology requires `agent.inspect.runtime`.
- Access topology requires `agent.inspect.access`.
- Extensions requires `agent.inspect.extensions`.
- The Host contract supports owner/editor/viewer/local principals without hard-coding product roles into Agent Host; Core and standalone composition map their principals to capabilities.
- Standalone’s explicit local/no-token development principal receives the configured local inspection capability set; this is an explicit host policy, not an implicit Agent Host fallback.
- A denied section appears only inside an already-authorized inspection response as `state: "denied"`. Unauthorized callers receive no Agent or section existence oracle.
- Responses use explicit `Cache-Control: private, no-store`; this is a new endpoint policy, not claimed as an existing repository default.
- Inspection authorization controls presentation only and grants no execution permission.

Use `AgentGatewayErrorCode` for the addressed route boundary. Reuse `AGENT_SCOPE_DENIED` and `AGENT_TYPE_UNKNOWN` where their established semantics apply, and add stable `AGENT_INSPECTION_DENIED` and `AGENT_INSPECTION_UNAVAILABLE` codes rather than returning arbitrary error strings. Section denial remains a typed section state, not an HTTP error. Inspection-specific reason/staleness codes live in a closed shared enum separate from gateway error codes.

### 2. Capability lease, server exposure, and Skills cutover are independent

Expose browser capability through an authenticated, workspace/principal-scoped **Agent inspection capability lease**, such as `GET /api/v1/agent-inspection-capabilities`. This name is deliberately distinct from Core’s boot-cached `/api/v1/capabilities` and in-process `WorkspaceShellCapabilities`.

The lease returns only already-advertised Agent IDs, per-Agent inspectable sections, per-Agent `skillsReplacementAvailable`, the explicit aggregate `allAdvertisedAgentsSkillsReplaceable`, `issuedAt`, `expiresAt`, bounded `maxAgeSeconds`, and opaque `capabilityEpoch`. The server computes the aggregate as true only when every Agent in that same advertised list has `skillsReplacementAvailable: true`; clients validate this invariant and fail closed rather than recomputing against a different inventory. The lease omits principal identifiers, role names, denied Agent identities, policy internals, and all execution permissions.

Two phase-1 controls exist:

- `agentInspectionEnabled`: server kill switch, snapshot wiring, capability lease, route, gear, and page exposure.
- `agentSkillsNavCutoverEnabled`: requests retirement of the global Agent Skills action.

There is no inert `workspacePluginsNavCutoverEnabled` in phase 1. The future Workspace Settings → Plugins issue owns any future Plugins cutover flag and replacement proof.

Effective Skills cutover is:

```text
agentSkillsNavCutoverEnabled
AND capability lease is authenticated and unexpired
AND allAdvertisedAgentsSkillsReplaceable is true and consistent with every advertised Agent's skillsReplacementAvailable value
```

`skillsReplacementAvailable` is a contract/UI capability, not “a populated runtime snapshot exists.” For one advertised Agent, it is true only when the current principal may inspect Extensions and the server/client can represent:

- statically proven configured/bootstrap skill facts with safe provenance;
- runtime facts when a passive snapshot exists;
- `not-instantiated` when no runtime exists;
- partial/Unknown runtime discovery coverage without implying absence.

No request-time scan or runtime boot is allowed to make the gate true. The accepted phase-1 limitation is that ambient/runtime-discovered skills for a never-instantiated Agent may remain Unknown until normal runtime publication; statically configured package/bootstrap skills remain visible where bootstrap can prove them. Static rows are intentionally thin—safe name, source kind, and plugin/package identifier where available—and do not claim descriptions, enablement, diagnostics, or ambient discovery that bootstrap cannot prove.

Navigation is intentionally principal-dependent: a principal denied `agent.inspect.extensions` retains legacy Skills while an authorized principal may receive the cutover. This is the fail-closed product behavior, not an attempt to provide role-invariant navigation.

The browser treats `expiresAt` as a hard boundary with no stale grace. It revalidates before expiry and on focus, `visibilitychange` to visible, `pageshow`, `online`, and transport/auth reconnect. Expiry, malformed/revoked lease, or failed revalidation synchronously clears Details data, closes/disables Details, removes speculative gear targets, and restores legacy Agent Skills before retry. Existing Plugins behavior is unaffected.

Flag wiring is explicit rather than environment-only magic:

- `CreateWorkspaceAgentServerOptions` gains an `agentInspection` option containing `enabled`, `skillsNavCutoverEnabled`, and the app authorization callback.
- Core server configuration maps its authenticated principal/policy into that option.
- Standalone/local composition supplies its explicit local principal mapping.
- Workspace front receives only authenticated capability-lease output and host-provided identity fencing props; it cannot enable the route or cutover by itself.

### 3. Viewed, selected, and current Agent identities are distinct

- Fleet gear accessible name: `View details for {selected Agent}`.
- Activating gear snapshots the target into `viewedAgentTypeId`.
- Changing future-chat selection changes only the gear’s prospective target.
- Only explicit `View {Agent} details` retargets an open Details overlay.
- Details children must not read `useWorkspacePluginClient().agentTypeId`, which follows future-chat selection.
- Requests never infer viewed Agent from active chat/session ownership.

The page context strip shows:

- `Viewing: Alpha`
- if different: `New chats use: Gamma` with `View Gamma details`
- if different: `Current chat uses: Beta` with `View Beta details`

These actions change only Details target. They never create/switch chat or alter future-chat selection.

### 4. Entry interaction is truthful and plugin-tabs-only in phase 1

The existing fleet selector is native, so phase 1 does not add per-option gears or replace it.

- Fleet plugin-tabs mode: persistent 44×44 CSS-pixel details button beside selector.
- Selector-hidden single-Agent plugin-tabs mode: compact identity row plus same button.
- Classic layout: no gear and no Agent Details overlay in phase 1.
- Fleet/capability loading: non-interactive status placeholder, not a speculative target.
- Fleet error, capability error/revocation, removed Agent, or fallback absent from advertised fleet: hide/disable gear with concise explanation and preserve legacy Skills.
- Never request Details for a known-unadvertised fallback.
- Entry remains keyboard accessible in expanded, collapsed, narrow, and mobile plugin-tabs layouts and is never hover-only.

### 5. Use the existing management overlay mechanism

Render Agent Details through the real plugin-tabs `chatOverlay` slot using `ManagementOverlaySurface`. Do not invent a center-page state machine, browser deep link, or `WorkspaceFullPagePanel` contract in phase 1.

`WorkspaceAgentFront` owns a separate typed Details state:

```ts
{ workspaceId, viewedAgentTypeId, section }
```

Interaction rules:

- Agent Details and the existing string `leftOverlay` are mutually exclusive visual occupants of the same slot.
- Explicitly opening Details closes the currently visible legacy management overlay through the normal user-action path; automatic Skills cutover suppression must not mutate persisted overlay state.
- Explicitly opening an existing legacy overlay closes Details.
- `muteActiveSession` is true while Details occupies `chatOverlay`, matching existing management-overlay behavior.
- New-chat creation and chat-selection actions close Details before changing chat state.
- On open, focus moves to the Details heading. On close, focus returns to the originating gear or a stable shell fallback if the gear disappeared.
- The overlay uses the existing shell sizing, scroll, and mobile behavior from `ManagementOverlaySurface`.

### 6. Pair-keyed immutable facet snapshots define “current”

The existing `publishedCurrentBindings` map is keyed by physical binding identity and can retain multiple historical current entries for one `(agentTypeId, workspaceScopeId)` pair. Details must not filter that map and interpret pair cardinality.

Add a separate private pair-keyed registry owned by Agent Host. Keys use the same collision-safe canonical JSON-array encoding pattern as the existing current key, never delimiter concatenation:

```ts
type InspectionPairKey = string // JSON.stringify([agentTypeId, workspaceScopeId])

interface FrozenInspectionFacet<T> {
  facetGeneration: number
  capturedAt: string
  freshness: "current" | "stale"
  reasonCodes: AgentInspectionReasonCode[]
  value: T
}

interface PublishedCurrentInspectionSnapshot {
  pairGeneration: number
  publishedAt: string
  freshness: "current" | "stale"
  staleReasonCodes: AgentInspectionReasonCode[]
  snapshot: FrozenAgentInspectionSnapshot // composed from immutable facets
  facets: Readonly<Record<AgentInspectionFacetName, FrozenInspectionFacet<unknown>>>
  internalPublication: {
    currentBindingKey: string
    supersededBindingKey?: string
  }
}
```

Rules:

- Normal current-binding publication atomically replaces the pair entry: last published current wins.
- `pairGeneration` is monotonic per Agent/workspace pair and independent of the existing per-`currentKey` binding generation.
- Every publication or accepted facet replacement creates a new immutable pair record; live tracker/array objects never enter the registry.
- Facet replacement is permitted beyond initial publication only from an existing normal lifecycle owner, is fenced by the owning `currentBindingKey`, atomically clones/replaces the named facet, and increments both `pairGeneration` and that facet's `facetGeneration`. A late callback from a superseded/disposed binding is ignored.
- Replacement records internal supersession metadata for lifecycle/testing but never exposes private binding keys to clients.
- Existing `publishedBindings` and session-pinned/historical binding behavior remain untouched.
- Disposal clears the pair entry only if the disposed binding still owns the current pair snapshot; disposing a superseded binding cannot erase a newer snapshot.
- Host shutdown unsubscribes readiness listeners and clears the registry.
- A race before publication or during an in-progress facet refresh may report `transitioning`/Unknown or the affected facet as stale; once a commit completes, the pair has at most one current immutable record.
- The synchronous accessor reads only this pair registry and never resolves runtime identity or returns a live binding.

```ts
inspectPublishedCurrentSnapshot(agentTypeId, workspaceScopeId):
  | { state: "none" }
  | { state: "transitioning"; reasonCodes: string[] }
  | { state: "current"; pairGeneration: number; snapshot: FrozenAgentInspectionSnapshot }
  | { state: "stale"; pairGeneration: number; capturedAt: string; reasonCodes: string[] }
```

Core obtains `workspaceScopeId` only by reusing the existing Agent-request `authorizeAgentRequest`/runtime `verify` flow, whose composite scope encodes `[workspaceId, sessionNamespace]`. Details must not derive a parallel scope key. That authorization may perform its existing eager scope-descriptor/resource-digest work; it remains boot-free but is not described as cost-free.

Post-publication mutable facets are explicit:

- `ReadyStatusTracker` remains the readiness owner. The existing readiness `onTrackerCreated` lifecycle callback subscribes to tracker transitions and contributes a newly constructed advisory readiness facet on every emitted transition, with its own `capturedAt` and monotonic `facetGeneration`. Publication/disposal owns subscription setup and teardown. Tracker events never authorize access and never expose arbitrary readiness messages.
- Effective runtime skills, packages, and extensions are re-captured immediately after the existing normal `refreshEffectiveResources()` lifecycle moments used by initial harness setup, session creation, and session reload. Capture consumes the already-refreshed bounded arrays; Details itself never calls the refresher or hot scanner.
- Hot-scannable/runtime-discovered inventory coverage is always capped at `partial`, carries stable `live-discovery-may-lag` and last-refresh provenance/reason data plus `capturedAt`, and can never assert authoritative complete absence. A later filesystem/plugin-dir change may be unknown until another normal refresh. Static configured/bootstrap skill coverage remains a separate independently authoritative facet and may be `complete` for exactly its declared source set.
- Before an in-place mutable-facet operation, the owning lifecycle marks the affected facet stale/transitioning. Success atomically replaces it. Capture, refresh, or callback failure retains the last bytes only as stale with a stable failure reason; failure must never relabel old bytes current.

In-place `reloadSession` behavior is explicit:

- reload start marks all affected runtime facets stale with `runtime-reload-in-progress` before live mutation;
- successful reload captures and atomically republishes new frozen facets with incremented generations and new `capturedAt` values;
- failed reload never relabels old bytes current; affected facets remain stale with a stable failure reason until a later successful normal publication/refresh or process restart;
- Details may show statically proven facts while runtime sections report stale/Unknown.

`none` maps runtime sections to `not-instantiated`. A current static snapshot or non-hot-scannable facet with `items: []` and complete coverage is authoritative current-empty, not `none`. Hot-scannable/runtime-discovered inventories never use complete coverage even when their captured item list is empty.

Details must never call `resolveAgentRuntimeScope`, `resolveBinding`, environment acquisition, adapter `create`, `getHotReloadableResources`, dynamic prompt loaders, `getSlashCommands`, `getOrCreatePiSession`, request-time model/skill/package discovery, execution-time filesystem resolution, provisioning, session creation, reload, or remote inspection I/O.

### 7. No effective full session prompt in phase 1

The V1 DTO contains no arbitrary session ID and no full effective prompt.

- Configured Agent definition instructions may be included only after `agent.inspect.instructions` authorization.
- Without authorization, text/fingerprint are omitted and the section reports denial.
- Instruction references never become raw host paths; logical source labels may be shown.
- Instruction fingerprints include exactly normalized fields already disclosed at the same authorization level.
- Hidden static/plugin prompt contributions show provenance only; no hidden-content hash.
- Dynamic prompt sources are never executed.
- Exact-session effective-prompt inspection is a separate future feature.

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
    | "stale"
  coverage: "complete" | "partial" | "none" | "unknown"
  authority: "authoritative" | "advisory" | "none"
  reasonCodes: AgentInspectionReasonCode[]
  capturedAt?: string
  pairGeneration?: number
  scope: {
    kind: "workspace" | "subject" | "session" | "binding" | "static"
    workspaceInvariant: boolean
    subjectApplicability?: "current-subject" | "workspace-wide" | "unknown"
  }
  items: T[]
}
```

Rules:

- Top-level `assembledAt` is response assembly time, not freshness.
- `capturedAt` belongs to the producer snapshot.
- `items: []` + complete coverage is authoritative empty.
- `items: []` + unknown coverage means nothing was represented.
- Subject/session facts appear only when snapshot applicability matches current authorized request.
- Superseded/stale generations are never relabeled current.
- Public static fingerprints are not raw source-definition digests.

### 9. Access facts present enforcement truth; they do not implement policy

Each fact contains category, logical resource identifier, action, requested state/source, effective state/enforcement source, scope/applicability, authority, capture time/pair generation, coverage, stable reason codes, and contribution provenance distinct from enforcement.

- `not-requested` requires a complete authoritative request declaration; ordinary absence is Unknown.
- `allowed`/`denied` requires the actual enforcing component and matching captured scope/actor.
- Execution-time admission is `conditional` with safe condition codes.
- Per-request filesystem bindings report only immutable declarations plus `conditional` / `Checked when used` effective state. Because `getFilesystemBindings({ scope, sessionId, requestId })` is evaluated for each authorized operation, its result is never frozen as a standing allowed/denied grant or placement authority.
- Plugin discovery, tool name, method existence, empty grants, or binding existence never proves access.
- Unsupported categories remain Unknown.

Required copy includes:

- `Requested — not proof of access`
- `Allowed in this scope at {time}`
- `Denied in this scope at {time}`
- `Checked when used`
- `No access facts were reported`
- `Not represented; this does not mean allowed or denied`
- binding without facts: `Access not reported`

Persistent note:

> Reported access is limited to the enforcement sources listed here; it may not enumerate execution-time or ambient host policy.

Trust labels describe execution domains, not endorsements.

### 10. Public data is typed, bounded, producer-authored, and JSON-disciplined

Do not sanitize arbitrary internal objects after serialization.

- Construct DTOs field-by-field from typed records.
- Diagnostics use stable codes plus closed, typed, bounded arguments.
- Omit arbitrary messages, stacks, provider errors, plugin config/policy, headers, environment values, paths, and opaque handles.
- Tool shapes expose only mechanically derived parameter names/types/required flags; omit defaults, examples, descriptions, patterns, unknown fields, and executable content.
- Labels/descriptions require explicit display-safe metadata.
- Strings, arrays, maps, nesting, diagnostics, tools, bindings, and contributions have fixed maxima.
- Reject/normalize ANSI, bidi, control, NUL, and non-display characters through type-specific constructors.
- URLs are omitted unless a dedicated public URL type removes credentials/fragments and rejects non-allowlisted query values.
- No generic sanitizer is claimed to make arbitrary strings safe.

Add the new transport and lease DTOs to `packages/agent/src/shared/gateway/__tests__/dtoDiscipline.test.ts`’s JSON DTO checks. Do not assume all existing shared types are JSON-safe.

### 11. Public fingerprints cannot encode hidden data

Every returned fingerprint has a typed, versioned public input and the same disclosure authorization as every field that can affect it. Never reuse `resolvedPolicyDigest`, runtime identity hashes, compiled-spec hashes, raw schema/prompt hashes, or producer digests without proven public inputs.

Tests compare complete unauthorized DTO bytes while independently varying hidden instructions, prompt options, plugin config/policy, schema defaults/examples/patterns, secrets, runtime identity, and physical paths. Public fingerprints remain identical.

### 12. Logical editor targets only; legacy path leakage is tracked separately

Skills/plugins never expose absolute paths or host/package locations.

```ts
{ filesystemId: string; relativePath: string }
```

`filesystemId` is the bounded public identifier mapped explicitly from the existing `RuntimeFilesystemBinding.filesystem` concept (including the reserved logical `user` filesystem where applicable); it is not a claim that a new durable ID-to-filesystem registry exists. The target is produced only by the workspace/filesystem adapter owning the authorized logical filesystem. Global/package/host/unmapped sources have no editor target. Agent Details does not reuse the current absolute-path skill projection.

Before Slice 2 merges, file and link a separate security follow-up for the legacy `skills.ts` behavior that can return absolute out-of-workspace paths. That legacy issue is not silently widened into #1095, but Agent Details must not reproduce it.

### 13. Package and contribution ownership is explicit

Extensions uses:

1. Agent/Pi contributions associated with viewed Agent.
2. Workspace/Boring contributions from the same Agent-associated package, shown as linked workspace capabilities and explicitly not Agent-owned.
3. Workspace-only packages, omitted from Agent Details.

Generic Agent transport remains namespace-neutral; workspace app maps `pi`/`boring` vocabulary. Base Agent shared code gains no Workspace taxonomy/value import.

Phase 1 preserves existing Plugins behavior exactly by composition:

- standalone Workspace server: existing server-instance host inventory and SSE behavior remain;
- CLI hub: existing workspace-scoped routing behavior remains;
- Core: no new generic Plugins endpoint or menu is invented;
- reload remains Agent-addressed through the existing host callback targeting the active chat Agent.

Agent Details plugin facts are not replacement proof for the generic Plugins experience.

### 14. Reuse pure projections without invoking live resolvers

Pure readiness/capability normalization and public summary constructors live beside their semantic owners. `runtimeCapabilityProjection.ts` remains orchestration and consumes them; inspection capture consumes the same helpers only over already-captured typed inputs. Current candidate resolution, `resolveAgentRuntimeScope`, `findPublishedCurrentBinding`, and live route orchestration remain exclusive to existing paths.

If a handler is entangled with Fastify/discovery/acquisition, extract only a pure constructor over a typed already-captured fixture. Add parity tests and document Details’ stricter omissions.

Commands may remain Unknown in phase 1 when proving them would require `getSlashCommands`/live Pi session creation.

### 15. Workspace base front remains independent of Agent values

Transport fetch/validation belongs in workspace app integration:

- `packages/workspace/src/app/front/agent-details/useAgentDetails.ts`
- `packages/workspace/src/app/front/agent-details/useAgentInspectionCapabilities.ts`
- `packages/workspace/src/app/front/agent-details/agentDetailsAdapter.ts`

Base `packages/workspace/src/front/**` receives a workspace-owned presentation model via props and has zero Agent value imports.

Add a machine check to `packages/workspace/scripts/check-plugin-invariants.mjs` that rejects value imports from `@hachej/boring-agent` in workspace base front/shared, matching the documented invariant. Type-only imports remain subject to existing rules.

### 16. Skills and Plugins views are pure prop-fed inventories

Slice 4 exclusively owns extraction of stateless `SkillsInventory` and `PluginsInventory`. Legacy `SkillsPage` and `PluginsOverlay` retain current fetch/reload/event ownership for rollback. Details performs one inspection fetch and passes validated section items to pure inventories.

Details components do not fetch contextual skills, call `/api/v1/agent-plugins`, subscribe to global plugin events, invoke reload/install/edit, or read `useWorkspacePluginClient().agentTypeId`.

### 17. Auth and capability fencing have explicit owners

Introduce an opaque `inspectionAuthIdentityKey` supplied by the authentication owner solely for client cache/race fencing:

- Core auth/session provider owns and rotates a non-secret opaque generation/key whenever authenticated session identity, authorization subject, or relevant role/policy identity changes.
- Core threads it through `CoreWorkspaceAgentFront` into workspace app/front props.
- Standalone/local composition supplies a constant local identity key tied to its explicit local-principal policy.
- Workspace code never derives the key by hashing tokens/headers and never logs/persists it.
- The key is not authorization; server authorization remains authoritative.

`useAgentDetails` request identity is:

```text
{ workspaceId, viewedAgentTypeId, apiBaseUrl, inspectionAuthIdentityKey, capabilityEpoch }
```

`leaseExpiresAt` is a hard validity gate, not a request-key member. Renewal with unchanged `capabilityEpoch` does not churn a Details refetch. If effective capability changes, the server returns a changed `capabilityEpoch`, which invalidates Details. Expiry/failure still clears synchronously before retry.

For each request-key change/retry: abort prior request, increment monotonic epoch, commit only from the latest matching epoch, and synchronously clear prior data on workspace/auth/capability change or revocation.

### 18. Persisted Skills suppression is non-destructive

Details state remains separate from string-only `appLeftOverlay` persistence.

The existing `WorkspaceAgentFront` self-healing validator currently writes `null` when Skills is disabled, which deletes its localStorage key. Slice 5 must distinguish:

- **host configuration disables Skills:** retain existing invalid-state cleanup;
- **Skills is merely hidden by Agent Details cutover:** suppress rendering/action without calling `setLeftOverlay(null)` or rewriting storage.

A persisted `plugins` value continues opening the existing Plugins surface. Optional compatibility opening maps only persisted `skills` to Agent Details Extensions after fleet and capability resolution identify the resolved future-chat Agent and prove that Agent advertised/replaceable. If no such Agent is available, compatibility mapping is dropped for that render and chat remains visible; it must not guess a fallback or mutate persistence. Turning cutover off reads the untouched Skills value and reopens the legacy overlay. Corrupt/removed-Agent states close safely to chat without blank panes.

## Inspection Contract

### Transport ownership

Define internal snapshots first. Publish a minimal namespace-neutral `AgentInspectionResponseV1` under `packages/agent/src/shared/agentInspection.ts` only after producer fixtures exist. Workspace app adapter maps it to presentation.

Top-level V1 contains `schemaVersion`, `assembledAt`, public Agent identity/provenance/fingerprint, and six `AgentInspectionSectionV1` envelopes: overview, configuration, runtime, access, extensions, diagnostics.

Rules:

- Breaking semantics increment version; additive fields remain V1 and clients ignore unknown additive fields.
- Deterministic ordering and explicit count/size/depth bounds apply throughout.
- No effective prompt or arbitrary session ID.
- Model availability is not credential presence or standing execution authorization.
- Unknown is first-class.
- Every fingerprint uses matching authorized public inputs only.

### Details route

Add `GET /api/v1/agents/:agentTypeId/details` only when `agentInspection.enabled`.

Sequence:

1. app-owned general inspection authorization;
2. Host workspace/Agent scope verification;
3. unknown-Agent lookup;
4. per-section capability application;
5. static projection plus pair-keyed frozen snapshot accessor;
6. bounds/schema validation;
7. private/no-store response.

Client headers cannot choose storage/authorization scope.

### Capability lease route

Add authenticated `GET /api/v1/agent-inspection-capabilities` under the same server flag. It returns bounded lease timing, advertised Agent entries with per-Agent section capability and per-Agent `skillsReplacementAvailable`, explicit `allAdvertisedAgentsSkillsReplaceable`, and `capabilityEpoch` only. The aggregate must equal the conjunction over that exact advertised list.

Per-Agent `skillsReplacementAvailable` means the authorized page/contract can render known static facts plus truthful runtime `partial | unknown | not-instantiated` (and `complete` only for independently authoritative non-hot/static source sets); it never means an Agent has a populated binding.

## Server Architecture

### Static facts

Create internal types/constructors near Agent Host (`inspectionSnapshot.ts`, `inspectionProjection.ts`). Capture compiler-supplied public Agent identity, typed public fingerprints, configured instruction text gated at response, logical instruction source, provenance-only hidden contributions, complete requested-model declarations, statically configured skill provenance where bootstrap can prove it, Agent-associated package provenance, and section coverage/reason codes. Static skill rows are deliberately limited to safe name/source/plugin-or-package identity that trusted bootstrap actually supplies; they do not invent descriptions, enable state, ambient skills, or diagnostics.

### Pair-keyed published inspection registry

Add the separate pair registry and publication/facet-replacement lifecycle described in Decision 6. Do not change session-pinned binding selection. Capture immutable snapshots only during normal lifecycle owners; atomically replace owner-fenced facets on readiness transitions and effective-resource refreshes; mark/re-capture around in-place reload. Tests prove identity supersession, pair/facet generation, late-callback fencing, disposal/subscription ownership, stale failure behavior, and pinned bindings never surfacing as current.

### Environment/access producers

Environment, workspace, runtime-mode, sandbox, filesystem, and admission owners contribute immutable logical declarations during existing lifecycle. Each declares scope/applicability, coverage/authority, requested/effective truth source, reason codes, capture time, and pair generation. Per-request filesystem evaluation is represented only as conditional/Checked-when-used and is never cached as a standing grant. Absence is Unknown. Physical topology never enters snapshots.

### Runtime inventory producers

Models, runtime-discovered skills, Agent/Pi packages, tools, commands when safely available, readiness, and typed diagnostics contribute during normal binding/harness lifecycle. Readiness is re-contributed from `ReadyStatusTracker` subscriptions installed through `onTrackerCreated`; effective skill/package/extension inventory is re-captured after normal `refreshEffectiveResources()` moments. Hot-scannable/runtime-discovered coverage stays partial with `live-discovery-may-lag`, last-refresh provenance, and `capturedAt`; static configured skill coverage remains independently authoritative. Failed re-contribution leaves the affected facet stale. Request-time inspection never invokes discovery/acquisition.

### Workspace bootstrap provenance

Normalize trusted bootstrap metadata into bounded namespace-neutral input keyed by package ID. Include only public identity/version/artifact ID, contribution namespaces/kinds, linked workspace kinds, admission/load state, typed diagnostics, trust-domain semantics, and statically configured skill provenance. Never include config/policy values, handlers, paths, prompt text, arbitrary messages, or hidden-content digests.

## UI Architecture

### App integration

Add capability/details hooks and adapter under `packages/workspace/src/app/front/agent-details/`. The capability hook is fenced by workspace, `inspectionAuthIdentityKey`, `capabilityEpoch`, and hard lease expiry. It revalidates before expiry and on focus/visibility/pageshow/online/reconnect. Details uses the request identity from Decision 17 and rejects mismatched/malformed/late responses.

### Base presentation

Add prop-fed components under `packages/workspace/src/front/chrome/agent-details/` for page, section navigation, context strip, access facts, Skills inventory, and Plugins inventory. Base front consumes no Agent values.

### Overlay behavior

Use `ManagementOverlaySurface` through plugin-tabs `chatOverlay`. Workspace shell owns only typed state, mutual exclusion, mute/close/focus wiring, and presentation props. Section behavior remains in focused components.

Desktop uses a stable section rail/tablist; narrow/mobile uses horizontally scrollable tabs. Arrow keys/Home/End navigate. Loading uses `role=status`; page errors use `role=alert`; denied/Unknown/not-instantiated/stale are section states, not generic failure. Access becomes labeled cards on narrow screens. Long content is bounded, wrapped, and collapsible. State is text+icon, never color alone.

## Flag / Abstraction

- **Needed?:** Yes.
- **Server path:** `CreateWorkspaceAgentServerOptions.agentInspection.enabled`, default false, gates snapshot wiring and both routes.
- **Skills path:** `CreateWorkspaceAgentServerOptions.agentInspection.skillsNavCutoverEnabled`, default false, advertised only through authenticated lease.
- **Core path:** Core server config supplies authorization and flags; Core auth front supplies `inspectionAuthIdentityKey`.
- **Standalone path:** explicit local principal policy plus constant auth identity key.
- **No phase-1 Plugins flag:** future Workspace Settings owns it.
- **Rollback:** disable Skills cutover to restore untouched legacy Skills; disable server inspection to remove routes/page. Existing Plugins behavior is unaffected. Legacy components/persistence remain for one release window; no deletion without written approval.

## Test Seams

### Highest public seams

- Authenticated capability/details routes through real Core and standalone compositions.
- Agent Host pair-keyed frozen inspection registry and no-acquisition behavior.
- Workspace adapter schema/identity/bounds validation.
- Capability/Details hook race and lease fencing.
- Plugin-tabs `WorkspaceAgentFront` overlay/identity/navigation behavior.
- Desktop/mobile scripted proof.

### Required Host/snapshot tests

1. Pair registry last-current-wins after runtime identity/config/plugin change.
2. Pair generation increments independently of existing `currentKey` generations.
3. Superseded binding disposal cannot remove newer snapshot.
4. Current binding disposal clears only its owned pair record.
5. Session-pinned/historical bindings never surface through current inspection.
6. Reload start marks stale; success republishes; failure stays stale.
7. `none` differs from authoritative current-empty and stale.
8. First/repeated Details requests call none of the forbidden resolving/acquiring/discovery APIs and change no binding/session/request-ledger state.
9. Static facts remain available when runtime is not instantiated/stale.
10. Every `ReadyStatusTracker` transition owner-fenced through `onTrackerCreated` replaces only the readiness facet, increments facet/pair generation, updates `capturedAt`, and ignores late events after supersession/disposal.
11. Normal effective-resource refresh/session-create lifecycle re-captures skill/package/extension facets; hot-scannable coverage remains partial with `live-discovery-may-lag` even for an empty list, while static configured coverage remains separately authoritative.
12. Readiness/resource capture or refresh failure leaves prior bytes stale with a stable reason and never relabels them current.

### Required authorization/capability tests

1. Server flag off: routes absent and snapshot wiring disabled.
2. Flag on but general capability denied: no Agent existence disclosure.
3. General authorization precedes scope/Agent lookup.
4. Section capabilities independently deny instructions/runtime/access/extensions.
5. Core owner/editor/viewer mappings and standalone local/no-token mapping are explicit.
6. Forged workspace/storage headers cannot choose scope.
7. Stable `AgentGatewayErrorCode` values cover denied/unavailable/unknown cases.
8. Responses are private/no-store.
9. Lease includes bounded timing, current advertised Agent entries, per-Agent replacement values, the consistent `allAdvertisedAgentsSkillsReplaceable` aggregate, capability epoch, and no role/principal details.
10. Per-Agent `skillsReplacementAvailable` is true for authorized representable `not-instantiated`/partial/Unknown Agents and does not require a runtime inventory; the aggregate is true only when every advertised Agent qualifies.
11. Statically configured skill provenance appears where bootstrap proves it; ambient unknown is labeled Unknown.
12. Expiry, downgrade, revocation, malformed lease, endpoint error, and flag race clear/close Details and restore Skills synchronously.
13. Focus/visibility/pageshow/online/reconnect and bounded pre-expiry refresh revalidate.
14. Server-side role/policy/section/flag changes rotate capability epoch even without workspace/auth change.
15. Capability renewal with unchanged epoch does not refetch Details solely because expiry changed.

### Required contract/security tests

1. `[] + complete` differs from `[] + unknown`.
2. `assembledAt` never overwrites producer `capturedAt`.
3. Superseded/stale/other-subject/session facts cannot become current authoritative.
4. `not-requested` requires complete authoritative declaration.
5. Allowed/denied requires matching authoritative enforcement scope.
6. Configured instruction text/fingerprint require instruction capability.
7. Hidden prompt text has no content-derived digest; dynamic prompts never run.
8. Seeded secrets, URLs, paths, config/policy, stacks, and headers never serialize.
9. Diagnostics accept only known codes/typed bounded args.
10. Tool shapes omit defaults/examples/descriptions/patterns/unknown fields.
11. Editor targets require approved filesystem ID + relative path.
12. Ordering/count/depth/length bounds hold.
13. Namespace-neutral DTO contains no Workspace taxonomy.
14. Unauthorized complete DTO bytes/fingerprints remain identical as hidden inputs vary.
15. New transport and lease satisfy `dtoDiscipline.test.ts` JSON checks.
16. Workspace invariant check rejects Agent value imports in base front/shared.
17. Core Details scope uses the existing authorize/verify-produced composite workspace scope and rejects any independently derived or client-selected scope.
18. Mutable facet failures/supersession cannot relabel an older readiness or hot-discovery capture current.

### Required UI tests

1. Fleet gear is selector-adjacent, 44×44, Agent-named, and plugin-tabs-only.
2. Single-Agent plugin-tabs mode renders identity+gear; classic layout does not.
3. Loading/error/removed/unadvertised/denied states never target a speculative Agent and preserve legacy Skills.
4. Opening snapshots viewed ID; selector changes do not retarget.
5. Viewed/future/current identities can differ; explicit actions change only viewed.
6. Details and legacy overlays are visually mutually exclusive; mute/new-chat auto-close/focus restore work.
7. Six sections support keyboard/focus/loading/retry/denied/Unknown/not-instantiated/stale.
8. Access/trust copy is symmetric and non-misleading.
9. Skills/Plugins inventories are prop-fed with no contextual/global fetch/reload subscription.
10. Extensions distinguish Agent, linked workspace, and omitted workspace-only contributions.
11. Existing Plugins behavior remains unchanged per composition: standalone host catalog/SSE, CLI workspace routing, no invented Core endpoint, Agent-addressed reload callback.
12. Skills cutover uses the validated all-Agents aggregate and removes only global Skills while Plugins/Tasks/Automation/apps remain as today; role-dependent legacy-vs-Details navigation is intentionally fail-closed.
13. Persisted `skills` survives cutover-on → cutover-off; validator does not delete storage during suppression.
14. Persisted `plugins` continues opening existing Plugins.
15. `inspectionAuthIdentityKey` changes fence late results; lease expiry gates without request-key churn.
16. Expanded/collapsed/mobile/narrow plugin-tabs layouts remain accessible.

### Avoid testing

- Raw prompt/schema/catalog/config snapshots.
- Discovery as authorization.
- Private map shape where public lifecycle behavior suffices.
- Live credentials/providers/remote workers/runtime boot.
- Tasks/Automation internals beyond navigation preservation.

## Acceptance

### Product

- Every advertised Agent in plugin-tabs layout is inspectable through selector+gear or single-Agent identity+gear.
- Classic layout remains unchanged in phase 1.
- Read-only overlay presents Overview, Configuration, Runtime, Access, Extensions, Diagnostics.
- Instructions are visible only to authorized inspectors.
- Runtime shows logical topology only.
- Access shows requested/effective source, authority, coverage, freshness, conditions, and Unknown.
- Static configured skills plus passive runtime skills are Agent-level; never-instantiated/partial/Unknown are truthful.
- Agent-associated packages and linked workspace contributions are distinguished; workspace-only packages are omitted.
- Global Agent Skills disappears only under a valid authenticated replacement lease.
- Existing Plugins behavior remains unchanged per composition.
- Generic Plugins removal remains a documented future Workspace Settings goal.
- No mutation controls.

### Identity/lifecycle

- Viewed Agent changes only through explicit action.
- Viewed/future/current identities never cross.
- Opening/reloading Details performs no runtime/session/provisioning/discovery mutation.
- Pair-keyed current snapshot supersedes older runtime identities deterministically.
- Owner-fenced immutable facet replacement keeps readiness current across tracker transitions and keeps effective inventories tied to their last normal refresh.
- Hot-scannable/runtime-discovered coverage never claims complete absence and carries `live-discovery-may-lag`.
- Reload or facet-refresh staleness is explicit and never relabeled current after failure.
- Late responses cannot cross Agent/workspace/auth/capability epochs.
- Lease expiry is a hard gate but not a request-key churn source.

### Security/correctness

- App section authorization plus Host scope verification is enforced.
- Server flag off removes exposure.
- No secrets, raw env, paths, config/policy, arbitrary diagnostics, raw schemas, hidden digests, or effective prompt.
- Effective access comes only from matching authoritative immutable facts.
- Unknown never means allowed/denied.
- DTOs are bounded, deterministic, JSON-disciplined, and no-store.
- Public fingerprints cannot encode omitted data.
- Workspace base front has no Agent value imports, enforced mechanically.

### Quality

- Focused producer/projection/adapter/hook/component tests; shell suite only integration.
- Accessibility and desktop/mobile plugin-tabs layouts proven.
- Relevant typechecks, tests, `pnpm lint:invariants`, E2E, UI review, security review, and thermo pass on exact SHA.

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

pnpm lint:invariants
git diff --check
git diff --cached --name-only
git status --short
git rev-parse HEAD
```

### Exact-SHA proof-of-work record

Each implementation PR posts the repository proof-of-work comment required by `docs/procedures/proof-of-work.md`:

- subject includes the Bead/slice ID;
- comment names the exact current PR head SHA;
- exact commands and outcomes are listed;
- screenshot/demo artifact URLs and what to inspect are listed;
- independent security/spec/UI/thermo reviewer results are named;
- residual Unknown coverage and waivers are explicit;
- a new commit invalidates the prior proof comment and requires a refreshed exact-SHA record.

### Visual/manual proof

Capture desktop/mobile artifacts showing Alpha viewed while future/current Agents differ, authorized configuration, hidden-contribution provenance only, runtime/access complete/partial/conditional/Unknown/not-instantiated/stale states, Extensions ownership split, Skills cutover with existing Plugins/Tasks/Automation unchanged, selector-hidden entry, error/revocation states, and no mutation controls.

Manual proof confirms: no sessions/bindings change when opening Details; selector change does not retarget; explicit context actions only retarget Details; auth/capability/lease races clear stale data; hidden inputs do not change unauthorized DTO bytes; persisted Skills survives cutover rollback; existing Plugins behavior is unchanged per composition; server kill switch removes both routes and gear.

## Slices

### Slice 1: Internal current-snapshot and safety primitives (no route)

**Delivers:**

- Pair-keyed immutable current inspection registry with last-current-wins, monotonic pair/facet generations, owner-fenced facet replacement, internal supersession metadata, disposal/subscription ownership, and shutdown clearing.
- Readiness-transition and effective-resource-refresh facet semantics, plus reload stale/success/failure lifecycle.
- Immutable section envelopes with coverage/authority/freshness/applicability/bounds.
- App authorization integration contract.
- Typed public constructors, diagnostics, editor targets, and public fingerprints.
- Pure readiness/capability helpers beside semantic owners; runtime capability route remains orchestration.
- No-side-effect and hidden-data invariance tests.
- Machine check for workspace base-front Agent value-import invariant.

**Likely files:**

- `packages/agent/src/server/agent-host/inspectionSnapshot.ts` (new)
- `packages/agent/src/server/agent-host/inspectionProjection.ts` (new)
- `packages/agent/src/server/agent-host/types.ts`
- `packages/agent/src/server/agent-host/createAgentHost.ts`
- `packages/agent/src/server/agent-host/runtimeCapabilityProjection.ts`
- semantic-owner pure helper files
- `packages/workspace/scripts/check-plugin-invariants.mjs`
- focused Agent Host/invariant tests

**Blocked by:** None.

**Proof:** Agent/Workspace typecheck; identity supersession/disposal/pinned/reload tests; readiness transition generation and late-callback fencing; zero forbidden calls; DTO/fingerprint invariance; invariant script; security review.

**Review budget:** Exceeds routine PR but contains one invariant: only immutable proven public facts can become inspectable.

### Slice 2: Flagged static V1, authorization, capability lease, and auth identity fencing

**Delivers:**

- Namespace-neutral V1 transport and JSON DTO discipline.
- `AgentGatewayErrorCode` additions and closed inspection reason codes.
- `CreateWorkspaceAgentServerOptions.agentInspection` threading.
- Core and standalone authorization mappings.
- Explicit Core-owned `inspectionAuthIdentityKey` threaded through `CoreWorkspaceAgentFront`; standalone constant.
- Authenticated bounded capability lease and authorized details route.
- Static identity/instruction/model/package/known-skill provenance and explicit runtime `not-instantiated`.
- Workspace app adapter parser boundary.
- Legacy absolute skill-path follow-up issue filed and linked before merge.

**Blocked by:** Slice 1.

**Proof:** auth order/non-disclosure; Core/standalone mappings; flags; lease; auth-key rotation without token material; schema/bounds/no-store; hidden-data invariance; DTO discipline; no acquire; security/API review.

**Review budget:** Security-sensitive public exposure; no runtime truth/UI cutover.

### Slice 3A: Environment and access truth snapshots

**Delivers:** immutable logical environment/CWD/runtime/sandbox/binding declarations; independent requested/effective enforcement sources; scope/authority/coverage/freshness/conditions/Unknown; per-request filesystem facts limited to conditional/Checked-when-used rather than frozen standing grants; no universal engine or callable descriptor.

**Blocked by:** Slice 2.

**Ownership:** runtime/environment/workspace enforcement owners produce facts; Agent Host aggregates typed records only.

**Proof:** authoritative/partial/Unknown/conditional fixtures; actor/generation fencing; topology omission; no acquire; thermo/security review.

### Slice 3B: Runtime inventories and contribution snapshots

**Delivers:** immutable models, runtime-discovered skills, Agent/Pi packages, tools, safely available commands, readiness, diagnostics; readiness re-contribution on tracker transitions; effective skill/package/extension re-capture after normal refresh/session-create moments; partial `live-discovery-may-lag` runtime coverage independent from authoritative static configured coverage; namespace-neutral contribution mapping; logical editor targets; parity/stricter omission tests.

**Blocked by:** Slice 2.

**Ownership:** Agent runtime inventory owners capture facts; workspace plugin owner maps safe package provenance. UI inventory extraction is explicitly excluded and belongs to Slice 4.

**Proof:** no discovery/acquire on Details; readiness facet transition/capturedAt/generation and late-event tests; effective-resource refresh re-capture plus stale-on-failure and never-complete hot-discovery tests; parity; path/schema/diagnostic bounds; package ownership; Agent/Workspace invariants.

### Slice 4: Plugin-tabs Agent Details overlay

**Delivers:**

- Capability/details hooks and adapter using `inspectionAuthIdentityKey`, `capabilityEpoch`, and lease validity gate.
- `ManagementOverlaySurface` integration through plugin-tabs `chatOverlay`.
- Typed viewed-Agent state; mutual exclusion, mute, auto-close, and focus restoration.
- Fleet and selector-hidden single-Agent gear; no classic-layout gear.
- Six accessible responsive sections.
- Pure prop-fed Skills/Plugins inventories (single owner for extraction).
- Fixture UI after Slice 2; final integration after 3A/3B.

**Blocked by:** Slice 2 for fixture contract; integration by 3A/3B.

**Proof:** Workspace/Core typechecks; adapter/hook/component/shell tests; identity/auth/capability/lease races; overlay lifecycle; desktop/mobile plugin-tabs artifacts; high-taste UI review.

### Slice 5: Skills navigation cutover, compatibility, and exact-SHA proof

**Delivers:**

- Skills cutover using per-Agent representability-based `skillsReplacementAvailable` plus validated `allAdvertisedAgentsSkillsReplaceable`, including never-instantiated/partial/Unknown Agents and intentional role-dependent fail-closed navigation.
- Validator distinction between host-disabled and cutover-suppressed Skills; persisted key survives rollback.
- Existing Plugins behavior preserved unchanged per composition.
- Fail-closed expiry/revocation/policy/flag races.
- Full exact-SHA proof-of-work comments and artifacts.
- Legacy wrappers retained; no deletion.

**Blocked by:** Slices 3A, 3B, 4.

**Proof:** full CI/E2E/UI; Skills rollback persistence; capability races; per-composition Plugins regression proof; exact SHA/status/diff; security/spec/thermo review.

## Dependencies

```text
Slice 1 pair registry + internal safety
  -> Slice 2 static V1 + authorization + lease + auth identity
      -> Slice 3A environment/access -----------------------┐
      -> Slice 3B runtime inventories ----------------------+-> Slice 5 Skills cutover
      -> Slice 4 fixture UI; integration waits for 3A/3B ---┘

Separate future issue: Workspace Settings → Plugins replacement
  -> future generic Plugins-menu cutover
```

After owner approval, create dependency-aware Beads and validate the graph with the repository-approved Beads tooling before `/exec`.

## Out of Scope

- Effective full session prompt.
- Editing instructions/models/CWD/environments/permissions/skills/plugins/tools/assignments.
- Moving/removing existing Plugins behavior in phase 1.
- Plugin install/uninstall/enable/disable/reload from Agent Details.
- Universal permission engine or claims about unrepresented rights.
- Request-time acquisition/discovery/remote inspection/callable adapter inspection.
- Secrets, credential presence, raw env, private paths, mounts, roots, config/policy, handles, arbitrary diagnostics, raw schemas, hidden-content digests.
- Implementing the legacy absolute-skill-path follow-up inside #1095.
- Building Workspace Settings → Plugins or generic Plugins cutover.
- Changing Tasks/Automation/dashboard/workspace-app ownership.
- Replacing native selector.
- Classic-layout Details in phase 1.
- Browser deep link.
- Deleting legacy components/persistence.
- Cross-workspace/organization fleet administration.

## Open Questions

No product decision blocks implementation after owner approval. Secure defaults are explicit:

- inspection/instruction disclosure is default-deny;
- effective prompt is excluded;
- hidden prompt/plugin content has no derived digest;
- unrepresented access is Unknown;
- current runtime inspection uses a pair-keyed last-current-wins immutable facet registry, not binding-map cardinality;
- readiness transitions and effective-resource refreshes replace only owner-fenced facets; failures leave stale data stale;
- hot-scannable/runtime-discovered inventory is partial with `live-discovery-may-lag`, while static configured skill coverage is independently authoritative;
- never-instantiated Agents still satisfy Skills replacement when the authorized UI/contract truthfully represents static known facts and unknown runtime coverage;
- phase 1 uses the existing plugin-tabs management overlay and does not expose classic-layout gear;
- Skills cutover suppression preserves persisted state;
- existing Plugins behavior remains unchanged by composition;
- opaque auth identity is host-owned and never derived from token material;
- capability epoch invalidates requests while lease expiry is a hard gate; per-Agent replacement values and the explicit all-advertised-Agents aggregate are consistent;
- exact-SHA proof comments follow repository proof-of-work format.

Any relaxation or future generic Plugins removal requires a new owner-approved issue and security review.
