---
issue: factory-plugin-owner-runtime-identity-prefix-8pdn
state: ready-for-agent
updated: 2026-09-14
track: reviewed-plan
---

# Owner embedding, bridge proof, hybrid runtime, and canonical accepted-work context

## Problem Statement

The owner needs four aligned capabilities before embedding Boring Workspace in another product:

1. `createWorkspaceAgentServer` must mount its **complete** owned surface below a host-selected prefix. “Complete” includes ordinary HTTP routes, plugin routes, `runtimeProjection` broker/routes, and `runtimeBackend` raw HTTP and WebSocket upgrade paths; path-based authorization must not regress.
2. A real plugin pane must open through the sole canonical dispatch path, `UiBridge.postCommand` → an authenticated SSE/poll transport → browser Workspace dispatch. The transport may not put bearer/session tokens in query strings, browser history, or logs.
3. A host needs application-owned `RuntimeModeId`s for ECS-local Workspace on shared EFS and AgentCore remote exec Sandbox on that EFS. Only provisioning/runtime-ID extension seams proven by repository census may be opened. Remote handles need a durable fenced lifecycle protocol.
4. Every accepted run needs one canonical identity and immutable authority context through durable admission, queueing/readmission, metering, tools, and delegation. Current Pi metering derives `pi-run:*` identifiers, conflicting with `RunId := RequestKey`.

The interrupted uncommitted Workspace diff is exploratory evidence only and is not approved implementation.

## Ratified Alignment and Explicit Conflicts

- Preserve `docs/plans/long-term/ratified/ARCHITECTURE-PLAN.md` R1/R2 and `RECONCILIATION.md` §6: the host owns authority and envelope; `RunId := RequestKey`; Seat grants participation, not identity.
- Preserve B2 ownership: generic accepted-work identity, ledger/context, metering hooks, and execution context belong to Agent; host membership/grants and Seat resolution remain Workspace/host concerns.
- Preserve `AGENTS.md`: routes/tools receive `Workspace`, not raw roots; `UiBridge.postCommand` remains the only UI dispatch path; custom providers are host-injected mechanisms while mode selection remains host authority.
- The AWS topology is an application-owned adapter, not a builtin mode and not a sovereign-tier qualification.
- Remove `pi-run:*` as canonical identity, but only after the deployment/persistence census and chosen cutover are recorded.
- UI-local counters named `runId` remain out of scope unless they collide with a newly exported canonical type.

## Solution

Use nine bounded slices. First make the complete composed server instance prefix-safe, including broker/raw/WS paths, choose and implement one authenticated browser bridge contract without query tokens, and instance-scope `uiBridgeRegistry`. Then prove the plugin pane flow against a real server and browser.

For hybrid runtime, first inventory provisioning and runtime-ID composition and open only seams demonstrated missing by a compile/test fixture. Specify and implement a host-owned durable fenced sandbox-handle store before composing the two application modes and attempting live qualification.

For accepted work, use **one nested `acceptedWork` value**, not optional identity/authority fields spread across request, session, meter, and tool types. `AcceptedWorkContext` contains a frozen canonical identity projection and the admission-time verified authority snapshot/reference. It is atomically stored with every ledger state transition. Admission provenance/audit records remain separate from current authority: provenance explains what was accepted; every execution or queued readmission obtains current authorization and must not treat an old snapshot as a live grant.

## User Stories / Scenarios

- A host mounts a server at `/owners/alice/workspace`; prefixed health, agents, files, plugin bootstrap/runtime, `runtimeProjection`, `runtimeBackend` raw/WS, WorkspaceBridge, UiBridge SSE/poll, and plugin-defined routes work, while equivalent root paths are absent.
- An authenticated agent tool posts `openSurface`; a real browser receives it once over the selected server transport and opens the plugin pane. Credentials never appear in a URL.
- Two server instances in one process use distinct prefixes and bridges without cross-instance registry delivery or teardown interference.
- The host selects `ecs-local-efs` or `agentcore-remote-efs`; both map to one validated tenant/workspace EFS namespace, while a remote sandbox is safely resumed after restart and stale owners cannot mutate or delete it.
- Prompt, persisted queue entry, retry, metering, tool call, and delegated child all refer to frozen accepted work. Queue dispatch performs fresh readmission. Retried child delegation reuses a deterministic child request key.

## Decisions

- Prefix normalization: empty or `/` means root; reject query/fragment, dot segments, encoded traversal/separators, and absolute URLs; document/test the trailing-slash rule.
- Mount through Fastify encapsulation/registration plus explicit prefix-aware handling for paths outside ordinary routing (notably raw/WS upgrade dispatch). Never assume Fastify’s HTTP prefix automatically covers `runtimeProjection` or `runtimeBackend`.
- Inventory every server registration site before editing. The required matrix names owner, route kind (HTTP/raw/WS), auth hook, prefixed positive case, and unprefixed negative case.
- Select exactly one authenticated bridge contract during slice 1: same-origin secure-cookie EventSource if compatible with host auth, otherwise authenticated `fetch` streaming or authenticated poll with an authorization header. Native EventSource plus query token is forbidden. Preserve explicit `bridgeEndpoint: null` disable semantics.
- Replace process-global `uiBridgeRegistry` authority with server/workspace-instance ownership; registration, lookup, and teardown are scoped to the constructed server instance. No implicit default may permit cross-instance delivery.
- Plugin proof must use a real listening server and browser plugin-pane UI. Fastify injection, manually invoking a subscriber, or unit-only DOM dispatch is insufficient.
- Custom runtime IDs remain application-owned. A census must identify the exact type/export/factory/provisioning call path and a failing fixture before any package API is widened. No speculative generic provisioning API.
- The durable sandbox row is keyed by host scope + workspace + provider + mode and contains encrypted opaque provider handle, monotonically increasing generation, lease owner/token, lease expiry, and version. Operations are fenced and transactional:
  - `claim`: create or acquire only when unleased/expired, increment generation, return lease token;
  - `renew`: compare generation + lease token + unexpired ownership;
  - `update`: compare generation + lease token, atomically replace handle/version;
  - `release`: compare generation + lease token and clear lease without deleting handle;
  - `delete`: compare generation + lease token (or an explicit privileged reconciliation path), delete only after provider cleanup outcome is durably recorded.
  Stale generations cannot renew, update, release, or delete. Crash, lease expiry, concurrent claim, ambiguous provider cleanup, and restart are tested.
- `AcceptedWorkContext` is one nested, deeply readonly/frozen value. It includes versioned collision-safe `runId` projection plus retained `AgentRequestKey`, admitted agent identity, workspace/auth subject, optional verified Seat participation, bounded delegation lineage, operation/target, and authority snapshot/reference. Delimiter concatenation is forbidden.
- Every durable ledger state (`accepted`, queued, running, terminal/error/cancelled as implemented) atomically persists the same frozen accepted-work value with the state write. No state may be observable without it, and mutation is rejected/detected.
- Admission provenance is append-only/separate. It records how acceptance was established, but is never consulted as current permission. Resume, queue dequeue, and delegated execution use the accepted-work reference to obtain fresh host authorization.
- A queued item persists an accepted-work reference and immutable request material. Dequeue/resume performs fresh readmission; revocation fails closed while preserving auditable terminal state. It never silently executes under stale admission authority.
- Child delegation keys are deterministic from parent request key + stable tool-call/delegation ordinal/key + child target/operation using the canonical serializer. Retries reuse the key; distinct children cannot collide. Model arguments cannot supply identity, Seat, lineage, or idempotency keys.
- Complete a `pi-run:*` deployment census before migration: code producers/consumers, persisted sink schemas/rows, logs/analytics, external integrations, retention, and rollback. Record evidence for either direct cutover (no deployed persistence) or versioned dual-read/old-write retirement; do not guess.

## Flag / Abstraction

- **Needed?:** Prefix is opt-in by `routePrefix`; root remains default. Custom modes are opt-in host configuration. Accepted-work expansion may use a temporary compatibility adapter, not a product flag. Bridge transport is an explicit endpoint/auth strategy, not ambient global state.
- **Path:** server-owned mount + explicit raw/WS prefix dispatch → instance-owned bridge → authenticated transport → existing provider adapter after seam census → fenced host store → gateway-created nested `acceptedWork` → ledger → fresh readmission → consumers.
- **Rollback:** omit prefix; select existing runtime mode while retaining handles/EFS; revert consumers to compatibility adapters while retaining accepted-work ledger data. Never delete remote handles or shared data merely because code rolls back.

## Test Seams

- **Highest public seam:** real listening Workspace server plus Playwright browser; HTTP client and WebSocket client against prefixed/unprefixed route matrix; two server instances in one process; runtime adapter fixture; ledger/gateway conformance through queue, meter, tool, and delegation sinks.
- **Existing prior art:** Workspace server/front/bridge tests, provider adapter tests, gateway conformance and ledger tests, Pi metering tests.
- **Avoid testing:** route-count snapshots alone; manual bridge subscriber relay; browser mocks in place of server transport; AWS mocks claimed as live proof; generated strings without durable admission/readmission provenance; model-supplied authority fields.

## Acceptance

- All ordinary, plugin, `runtimeProjection` broker/routes, and `runtimeBackend` raw/WS paths are prefix-mounted and root-negative; path-sensitive auth remains correct.
- SSE/poll auth has a documented browser-compatible contract and no token in URL/query. Two servers cannot see or tear down each other’s bridge registrations.
- Real browser/server proof opens a representative plugin pane exactly once through `UiBridge.postCommand`, with authenticated transport evidence.
- Public runtime/provisioning APIs change only where a pre-change failing fixture proves a missing seam. Application-owned modes do not modify builtin unions.
- The fenced handle protocol passes race, stale-generation, expiry, restart, cleanup-failure, and rollback tests. Live AWS claims remain explicitly qualified unless disposable infrastructure proof exists.
- One frozen nested `AcceptedWorkContext` is atomically present in every ledger state. Provenance is separate from live authority; queued/retried work is freshly readmitted.
- Retried delegation has a stable child key and correct verified parent lineage. Pi migration follows a recorded deployment census/cutover and leaves no second canonical ID.

## Proof

- **Commands:** targeted tests named in each slice; then `pnpm --filter @hachej/boring-workspace test`, `pnpm --filter @hachej/boring-agent test`, `pnpm typecheck:changed`, `pnpm test:changed`, `pnpm lint:invariants`; built-package export smoke where APIs change.
- **Browser evidence:** recording and Playwright trace showing prefixed page, authenticated bridge request with token-free URL, server command receipt, and plugin pane assertion.
- **Runtime evidence:** restart/race fixture logs; optional disposable ECS/AgentCore/EFS digest/resume run with teardown log.
- **Migration evidence:** checked-in census/cutover note with search commands and sink/deployment owner confirmation. If deployed-state access is unavailable, migration remains blocked rather than presumed safe.

## Slices

### Slice 1: Complete prefixed server boundary and instance-scoped authenticated bridge
**Bead:** `factory-plugin-owner-runtime-identity-prefix-8pdn.1`  
**Delivers:** registration census; normalized prefix; prefixed ordinary/plugin routes, `runtimeProjection` broker/routes, and `runtimeBackend` raw/WS paths; one selected authenticated SSE/poll contract without query tokens; instance-owned `uiBridgeRegistry`; two-instance isolation and root-negative tests.  
**Blocked by:** None.  
**Proof:** Workspace targeted tests with explicit HTTP/raw/WS route matrix, WebSocket handshake tests, auth rejection/acceptance, URL credential assertion, and two simultaneous server instances.  
**Review budget:** one security-sensitive implementation slice; production scope limited to server/bridge composition and directly required browser endpoint wiring.

### Slice 2: Real server/browser plugin-pane proof
**Bead:** `factory-plugin-owner-runtime-identity-prefix-8pdn.2`  
**Delivers:** representative real plugin surface opened by agent-triggered `UiBridge.postCommand`; fixes only observed defects.  
**Blocked by:** Slice 1.  
**Proof:** Playwright against a listening prefixed server; trace/recording; pane content and exactly-once command assertion; no query credentials.  
**Review budget:** one implementation/evidence session.

### Slice 3: Provisioning and runtime-ID seam census
**Bead:** `factory-plugin-owner-runtime-identity-prefix-8pdn.3`  
**Delivers:** repository census and compile/test host fixture locating runtime-ID typing, provider factory, provisioning, exports, and ownership; minimal API openings only where fixture failure proves need.  
**Blocked by:** None.  
**Proof:** before/after fixture evidence, targeted typecheck, built-export smoke; explicit list of considered seams left closed.  
**Review budget:** one focused API-boundary slice.

### Slice 4: Fenced durable sandbox-handle protocol
**Bead:** `factory-plugin-owner-runtime-identity-prefix-8pdn.4`  
**Delivers:** host-owned durable store contract and reference fixture implementing claim/renew/update/release/delete with generation + lease fencing and encrypted opaque payload.  
**Blocked by:** Slice 3 (uses only proven composition seam).  
**Proof:** deterministic concurrent claim, stale writer/delete, expiry takeover, restart, cleanup ambiguity, and provider/mode mismatch tests.  
**Review budget:** one high-risk persistence slice.

### Slice 5: Compose and qualify ECS-local/AgentCore shared-EFS modes
**Bead:** `factory-plugin-owner-runtime-identity-prefix-8pdn.5`  
**Delivers:** application-owned adapters through `createProviderRuntimeModeAdapter`, validated EFS mapping, fenced store integration, local restart proof, and live runbook/qualification status.  
**Blocked by:** Slices 3 and 4.  
**Proof:** provider conformance and restart/shared-file/isolation tests; live disposable digest/resume/teardown evidence or explicit unverified status.  
**Review budget:** local contract fits one session; live qualification is separately gated by credentials/infrastructure.

### Slice 6: Frozen accepted-work context atomically in ledger
**Bead:** `factory-plugin-owner-runtime-identity-prefix-8pdn.6`  
**Delivers:** one nested `AcceptedWorkContext`, canonical projection/serializer, gateway construction, and atomic persistence in every ledger state; provenance stored separately from current authority.  
**Blocked by:** None.  
**Proof:** in-memory and SQLite conformance over all transitions, restart/replay, collision and immutability tests, forged-field rejection, standalone/multi-Seat cases.  
**Review budget:** one structural/high-risk Agent slice.

### Slice 7: Durable queue reference and fresh readmission
**Bead:** `factory-plugin-owner-runtime-identity-prefix-8pdn.7`  
**Delivers:** queued accepted-work reference/request persistence and fresh host authorization at dequeue/resume, including fail-closed revocation state.  
**Blocked by:** Slice 6.  
**Proof:** restart with queued work, authority revoked/changed/retained cases, no stale snapshot execution, auditable terminal states.  
**Review budget:** one authority-boundary slice.

### Slice 8: Retry-stable child delegation identity
**Bead:** `factory-plugin-owner-runtime-identity-prefix-8pdn.8`  
**Delivers:** deterministic child request/delegation key and verified lineage from parent accepted work; no model-authored authority/idempotency.  
**Blocked by:** Slices 6 and 7 (delegated queued work follows the same readmission rule).  
**Proof:** retry/restart/concurrent distinct-child tests and forged argument rejection.  
**Review budget:** one confused-deputy/idempotency slice.

### Slice 9: Pi deployment census, cutover, and consumer migration
**Bead:** `factory-plugin-owner-runtime-identity-prefix-8pdn.9`  
**Delivers:** deployment/persistence census and approved direct or versioned cutover, then metering/tool/delegation migration to nested accepted work and retirement of canonical `pi-run:*`.  
**Blocked by:** Slices 6–8 and a resolved census/cutover decision.  
**Proof:** census artifact; sink compatibility tests; addressed prompt through ledger/meter/tool/child; replay/follow-up/concurrency; repository search showing no canonical `pi-run:*` producer.  
**Review budget:** census is a separate go/no-go checkpoint; migration is one structural session after resolution.

## Wide Refactor Strategy

Accepted-work plumbing uses expand → migrate → contract: add nested context and atomically persist it; add queue readmission and child keying; resolve deployed persistence; migrate consumers; remove compatibility fields and Pi-derived canonical IDs. The prefix and runtime tracks stay independent vertical slices.

## Out of Scope

- Making AWS modes builtin, changing auto-detection, or declaring AgentCore sovereign/qualified.
- Production AWS account/IAM/network/EFS/KMS/backup provisioning beyond a disposable proof/runbook.
- A second UI command channel, query-string credentials, or model-authored pane IDs/authority.
- Reopening Agent/Seat ontology, minting a run UUID, broad `runId` cleanup, or adopting the interrupted diff wholesale.
- Opening speculative provisioning APIs not required by the proven host fixture.

## Open Questions

- Live AWS qualification still needs host-approved AgentCore API semantics, IAM boundaries, EFS access points, KMS/residency, durable-store backend, lease TTL, and teardown ownership. This does not block slices 1, 3, 4, or 6.
- Slice 9 cannot migrate persisted keys until the deployment census establishes whether deployed sinks/external consumers contain `pi-run:*` and the owner approves direct cutover or dual-read retirement.

## Adversarial Review

T1 cross-model review of the prior revision returned **NOT READY**. This revision accepts every blocker:

- complete prefix scope now explicitly includes `runtimeProjection` broker/routes and `runtimeBackend` raw/WS paths;
- bridge transport must select an authenticated browser contract with no query token;
- pane proof requires a listening server and real browser;
- process-global `uiBridgeRegistry` is replaced by instance scope and tested with two servers;
- provisioning/runtime-ID seams are census-driven and opened only after a failing fixture;
- durable handles have explicit fenced claim/renew/update/release/delete semantics with generation and lease;
- one frozen nested `AcceptedWorkContext` is atomically persisted in every ledger state, with provenance separate from current authority;
- queued work persists its accepted-work reference and undergoes fresh readmission;
- child delegation keys are deterministic and retry-stable;
- Pi deployment census/cutover is a blocking checkpoint before migration;
- optional-field sprawl is prohibited.

No accepted finding widens the ratified architecture. Residual review gate: implementation diffs still receive the model-card-required security/structural review. The revised plan itself is execution-ready because the first slice has no unresolved product or deployment decision.

## Next Action

`ready-for-agent`.

Exact first `/exec` slice: **`factory-plugin-owner-runtime-identity-prefix-8pdn.1` — Complete prefixed server boundary and instance-scoped authenticated bridge.** Stop after its HTTP/raw/WS route matrix, authenticated token-free bridge contract, and two-server registry-isolation proof; do not begin plugin-pane E2E or any runtime/identity slice in the same execution.
