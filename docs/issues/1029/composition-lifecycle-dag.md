# gh-1029 composition and lifecycle DAG

This is normative with `route-consumer-matrix.json`. Every composition follows the same ownership-transfer and shutdown protocol; rows marked app-specific may be omitted only where the surface does not exist.

## Canonical contracts

```ts
interface AuthorizedEnvironmentIntent {
  readonly kind: 'http-route' | 'dispatcher' | 'agent-binding'
  readonly requestId: string
}

interface AgentHostEnvironmentScope {
  readonly placementIdentity: string
  readonly provisioningFingerprint: string
  readonly workspaceRoot: string
  readonly templatePath?: string
  readonly provisionRuntime?: ResolvedEnvironmentScope['provisionRuntime']
  /** Evaluated per operation after capability verification; never cached as placement authority. */
  readonly resolveFilesystemBindings?: (input: {
    verifiedClaim: VerifiedAgentScopeClaim
    requestId: string
  }) => Promise<readonly RuntimeFilesystemBinding[] | undefined>
}

interface AgentHostEnvironmentLease {
  /** Lease-guarded wrappers throw AGENT_BINDING_DISPOSED after release. */
  readonly workspace: Workspace
  readonly gitWorkspace: Workspace
  readonly fileSearch: FileSearch
  readonly filesystemBindings?: readonly RuntimeFilesystemBinding[]
  readonly readiness: Readonly<AgentCapabilityReadiness>
  readonly signal: AbortSignal
  release(): void
}

interface AgentHostDispatcherRunInput {
  readonly authorizedScope: AuthorizedAgentScope
  /** Mandatory trusted selection; no default Agent substitution. */
  readonly agentTypeId: string
  readonly context: WorkspaceAgentDispatcherContext
  readonly request?: FastifyRequest
  readonly requestId: string
}

interface LeaseBoundWorkspaceAgent {
  /** Lease-guarded Workspace; every method throws after release. */
  readonly workspace: Workspace
  readonly signal: AbortSignal
  /** Consumes the complete event stream inside the lease; no AsyncIterable escapes. */
  dispatch(
    input: WorkspaceAgentDispatcherDispatchInput,
    onEvent: (event: AgentEvent) => void | Promise<void>,
  ): Promise<{ ref: AgentSessionRef; receipt: AgentSendReceipt }>
  interrupt(sessionId: string, requestId: string): Promise<InterruptReceipt>
  stop(sessionId: string, requestId: string): Promise<StopReceipt>
}

interface CreatedAgentHost {
  readonly host: AgentHostHandle
  readonly gateway: AgentGateway
  registerDirectRoutes(options: AgentHostDirectProjectionOptions): FastifyPluginAsync
  acquireEnvironment(input: {
    authorizedScope: AuthorizedAgentScope
    intent: AuthorizedEnvironmentIntent
  }): Promise<AgentHostEnvironmentLease>
  runWithWorkspaceAgent(
    input: AgentHostDispatcherRunInput,
    run: (binding: LeaseBoundWorkspaceAgent) => Promise<void>,
  ): Promise<void>
}
```

`CreateAgentHostOptions` has separate resolvers:

```ts
authorizeAgentRequest(request): Promise<AuthorizedAgentScope>
resolveAuthorizedEnvironmentScope({
  authorizedScope,
  verifiedClaim,
  intent,
}): Promise<AgentHostEnvironmentScope>
resolveAuthorizedAgentRuntimeScope({
  authorizedScope,
  verifiedClaim,
  agentTypeId,
  intent,
  environment,
}): Promise<ResolvedAgentRuntimeScope>
```

The original capability is mandatory because issuer-held storage/runtime context is keyed by capability provenance and is intentionally absent from `VerifiedAgentScopeClaim`.

### Environment operation

```text
authorize request
→ Host verifies capability/membership
→ app resolver recovers issuer-held environment context and per-operation filesystem-binding resolver
→ EnvironmentLeaseManager acquires canonical placement generation
→ resolver evaluates actor/request-aware filesystem bindings for this operation
→ app route operates through lease-guarded Workspace/FileSearch/Operations
→ finite handler finally releases
  OR streaming transport wraps iterator and releases on close/error/cancel
```

No Agent is selected for generic environment routes.

### Dispatcher operation

```text
trusted caller supplies explicit agentTypeId + context
→ Host validates request/context equivalence
→ Host verifies capability/membership
→ Host resolves Environment then per-Agent runtime binding
→ Host creates lease-guarded Gateway operations and Workspace plus drain AbortSignal
→ runWithWorkspaceAgent callback performs and consumes the complete operation/event stream and returns void
→ callback completion/error releases operation and Environment leases
→ no AsyncIterable or raw dispatcher is returned; retained wrappers reject every later method after release
```

There is no unbounded `resolveWithWorkspace()` return and the callback cannot return a capability-bearing value. Breaking callers migrate to `dispatch(input, onEvent)`, which internally consumes the Gateway iterator before resolving; no raw dispatcher or `AsyncIterable` escapes callback scope. Workspace and operation wrappers assert the lease on every method. Drain aborts the supplied signal, waits only the configured grace, then revokes wrappers.

## Ownership transfer

```text
composition root creates Host
→ composition root owns close-on-error
→ app hooks/auth/plugin policy mount
→ canonical Host projection registers routes and lifecycle hooks exactly once
→ ownership atomically transfers to Fastify
→ later construction failure closes Fastify, which drains/closes Host
```

A second projection registration for the same Host/app throws before adding routes or hooks. A Host never successfully mounted remains the composition root's responsibility.

## Canonical shutdown

```text
Fastify preClose
→ Host fences new scope/environment/binding/effect/dispatcher admission
→ close/cancel unbounded subscriptions and streams
→ wait bounded grace for finite effects
→ mark unresolved admitted effects outcome-unknown
→ release dispatcher/app-route/binding Environment leases

Fastify onClose
→ dispose Agent compositions
→ retire current and fenced old Environment generations after final lease
→ dispose RuntimeModeAdapter exactly once
```

Late callbacks cannot mutate a retired generation or write success receipts.

## Core/full-app ordering

1. Resolve Core config/runtime stores.
2. Register telemetry and Core auth/membership/settings routes.
3. Register auth proxy before all scoped routes.
4. Resolve and preflight canonical plugins/trust once.
5. Construct dispatcher proxy in fail-closed unpublished state.
6. Construct Core bridge and session-owner memory hook.
7. Resolve runtime adapter/host pair and durable session root.
8. Build app-owned authorization/environment/Agent-scope resolvers.
9. Create one AgentHost; Core owns it until mount succeeds.
10. Mount workspace meta.
11. Mount app environment routes through `acquireEnvironment`.
12. Mount canonical AgentHost addressed/runtime-capability routes; publish direct dispatcher only after successful binding/projection readiness.
13. Mount UI routes and Core bridge.
14. Mount trusted plugin routes.
15. Mount frontend fallback last.
16. Fastify owns drain/close after step 12; any failure before then closes Host directly, any failure after then closes Fastify.

This reproduces all 18 #909 audited edges, including plugin preflight, adapter precedence, per-root Pi inputs, namespace preservation, and frontend fallback ordering.

## Workspace ordering

1. Resolve mode adapter/runtime host and workspace authorization selectors.
2. Resolve plugins and canonical runtime contributions once.
3. Build UI bridge/tools and app-owned resolvers.
4. Create one AgentHost; Workspace owns close-on-error.
5. Create Fastify and mount auth/workspace-scope hooks.
6. Mount app environment routes via Host Environment leases.
7. Mount canonical Host routes once and publish callback-scoped dispatcher.
8. Mount UI/plugin routes and frontend fallback last.
9. Transfer lifecycle ownership to Fastify after step 7.

## CLI folder mode ordering

1. Resolve folder workspace and plugin directories.
2. Enter `createWorkspaceAgentServer`; do not pre-create a second runtime provider.
3. Follow Workspace ordering with trusted-local authorization.
4. Prove plugin front host and diagnostics remain app-owned.

## CLI workspaces mode ordering

1. Load workspace registry and app-owned plugin/task routes.
2. Resolve one shared adapter/runtime host and trusted-local issuer.
3. Create one AgentHost with per-workspace environment and Agent resolvers; CLI owns close-on-error.
4. Mount registry/auth/workspace-selection hooks.
5. Mount app environment routes through Host leases.
6. Mount canonical Host routes and callback-scoped dispatcher.
7. Mount plugin front/runtime routes and fallback.
8. Transfer lifecycle ownership after step 6.

## Agent playground ordering

1. Resolve explicit playground adapter/runtime host and legacy-default Agent spec.
2. Build trusted local issuer and direct resolvers.
3. Create one Host and Fastify app.
4. Mount auth/public probes, app environment routes, canonical Host routes, then front fallback.
5. Transfer lifecycle ownership after Host projection mount.

## Standalone/bin/dev ordering

1. Thin standalone app factory creates Fastify, token-auth/public-probe hooks, and one legacy-default Host.
2. It mounts app environment routes and canonical Host routes in the same order as Workspace without plugin/Core surfaces.
3. It never constructs harness/session/binding/provisioning state itself.
4. Bin, dev, examples, test-host, eval, and smoke consume this thin factory or compose the same public Host contract directly.

## Required interleaving proofs

- Construction failure before and after lifecycle transfer.
- Duplicate projection mount rejection.
- Active addressed events, readiness, FS events, and dispatcher streams during close.
- Pending provisioning and stuck admitted effects during close.
- Same-identity hot resource reload during active leases.
- Identity/fingerprint-changing reload returns restart-required before mutation.
- Current provider generation plus leased retiring generation; no new acquisition reaches retiring generation.
- Exactly-once Host composition, Environment generation, and adapter disposal.
