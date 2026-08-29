# Final execution plan: Workspace Agent Seats
## 1. Scope and invariant
Implement:
```text
effective agent access = explicitly deployed product
                       ∩ workspace Seat
                       ∩ acting-user entitlement
```
Keep out of scope:
- Dynamic deployment registry
- Session release-digest pinning
- Active-generation reconciliation
- Release rollback history and GC
- Changing Charlotte’s immutable publication/activation model
A Seat references stable `agentTypeId`, never a release digest. Seneca’s explicit deployed-product manifest supplies the deployment set now; a future lifecycle resolver can replace that source without changing Seats.
---
## 2. Blocking review findings and dispositions
| Finding | Severity | Evidence | Disposition |
|---|---:|---|---|
| F1: unsafe bootstrap replacement | P0 | `packages/core/src/server/defaultAgentType.ts:3-6`, `src/front/AgentAuthPages.tsx:150-178` | Remove `replace-bootstrap` entirely. Add a server-issued, single-use signup intent consumed atomically when creating the initial workspace and Seat. |
| F2: allowed-ID list cannot distinguish 404/402/503 | P0 | `packages/agent/src/server/agent-host/embeddedGateway.ts`, `src/server/creatorSubscriptions.ts:336-345,624-640` | Replace boolean/ID authorization with a structured decision model. Seat is evaluated before entitlement. |
| F3: runtime bridge bypass | P0 | `packages/agent/src/server/runtimeEnvContributions.ts:5-10`, `packages/workspace/src/server/workspaceBridge/runtimeToken.ts:13-21`, `packages/core/src/app/server/coreWorkspaceBridge.ts:181-198` | Bind bridge credentials to agent, Seat, session and acting user; revalidate every call and refresh before effects. Reject old unbound tokens. |
| F4: shadow-to-enforce race | P1 | Session creation remains open during inventory | Add `write-enforce`, admission leases, a cutover advisory fence, drain, final census and stored high-water digest before full enforcement. |
| F5: no complete census API | P1 | `packages/agent/src/server/agent-host/sessionInventory.ts:42-74` | Add an offline/operator inventory service that enumerates all known and stale namespaces without runtime provisioning. |
| F6: fleet loading and rollback reopen exposure | P1 | `src/server/agents.ts:1-9,91-94`, `src/server/migrate.ts:1-9` | Preserve a Seneca-owned deployed-product manifest. Never auto-deploy every valid directory. Run migrations and app from the same immutable image digest. |
| F7: open streams leak after revocation | P1 | `packages/agent/src/server/agent-host/httpProjection.ts:232-267` | Re-evaluate before every sensitive stream event; terminate on denial or policy failure. Reconnect-only enforcement is rejected. |
---
## 3. Durable data model
### Core migration
Add `workspace_agent_seats`:
```sql
seat_id                 uuid PRIMARY KEY DEFAULT gen_random_uuid()
workspace_id            uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE
agent_type_id           text NOT NULL CHECK (...)
source                   text NOT NULL CHECK (...)
enrolled_by_user_id     uuid NULL REFERENCES users(id) ON DELETE SET NULL
created_at               timestamptz NOT NULL DEFAULT now()
UNIQUE(workspace_id, agent_type_id)
```
Sources:
- `signup-intent`
- `generic-default`
- `user-add`
- `migration-default`
- `migration-session`
- `operator`
Add `agent_signup_intents`:
```sql
intent_id                uuid PRIMARY KEY
token_hash               text UNIQUE NOT NULL
agent_type_id            text NOT NULL
auth_attempt_hash        text NOT NULL
expires_at               timestamptz NOT NULL
bound_user_id            uuid NULL
consumed_workspace_id    uuid NULL
consumed_at              timestamptz NULL
created_at               timestamptz NOT NULL DEFAULT now()
```
Add `agent_seat_cutover`:
```sql
app_id                   text PRIMARY KEY
mode                     text CHECK (mode IN
                           ('compat','shadow','write-enforce','enforce'))
epoch                    bigint NOT NULL
census_digest            text NULL
manifest_digest          text NULL
updated_at               timestamptz NOT NULL
```
Add an audited backfill-run table containing manifest digest, census digest, counts, operator identity, and completion status.
### Core store API
Implement in both Postgres and Local stores:
- `listAgentSeats(workspaceId)`
- `hasAgentSeat(workspaceId, agentTypeId)`
- `addAgentSeat(...)`
- `createDefaultWorkspaceWithInitialSeat(...)`
- `consumeSignupIntentAndCreateWorkspace(...)`
- `readAgentSeatCutover()`
- `transitionAgentSeatCutover(...)`
Workspace creation must atomically create:
1. Workspace
2. Owner membership
3. Exactly one initial Seat
4. Matching `defaultAgentTypeId`
---
## 4. One-time initial enrollment protocol
### New creator/Macro signup
1. Before starting email or Google signup, the frontend calls:
   ```http
   POST /api/v1/auth/agent-signup-intents
   { "agentTypeId": "charlotteledoux", "returnPath": "..." }
   ```
2. Core validates:
   - Exact agent slug
   - Agent exists in Seneca’s deployed-product manifest
   - Agent is eligible for public product signup
   - Same-origin/CSRF policy
   - Rate limit
3. Core stores only a hash and sets an opaque, HttpOnly, Secure, SameSite=Lax cookie.
4. The intent is bound to the Better Auth attempt/state nonce.
5. On successful identity creation, Core compare-and-swap binds the intent to the resulting user.
6. Core consumes the intent in the same transaction that creates the default workspace, owner membership, initial Seat, and default agent.
7. The cookie is cleared after consumption.
There is never an intermediate dummy Seat for creator signup.
### Generic signup
No product intent produces exactly one `dummy` Seat atomically.
### Existing authenticated user
**Add to my workspace** uses an additive endpoint:
```http
POST /api/v1/workspaces/:workspaceId/agent-seats/:agentTypeId
```
Owners and editors may add; viewers may not. It is idempotent and never replaces or removes an existing Seat.
### Recovery
If identity creation succeeds but workspace initialization fails, the user has no workspace and cannot open agent controllers. A new authenticated, user-bound, expiring recovery intent may complete initial workspace creation atomically.
There is no client-authorized replacement operation.
### Required protocol tests
- Cross-user intent fails
- Mismatched OAuth attempt fails
- Expired intent fails
- Replayed intent fails
- Consumed intent cannot create another workspace
- Existing sole-dummy workspace cannot be replaced
- No dummy session/controller/runtime binding occurs before creator initialization completes
---
## 5. Structured authorization model
Core resolves:
```ts
type AgentAccessDecision =
  | { state: 'allowed'; seatId: string }
  | { state: 'not-available'; internalReason: 'not-deployed' | 'not-seated' }
  | {
      state: 'entitlement-denied'
      seatId: string
      denial: 'subscription-required' | 'forbidden'
    }
  | { state: 'policy-unavailable'; retryAfterSeconds?: number }
```
Evaluation order:
1. Authenticate user
2. Verify workspace membership and trusted workspace scope
3. Check Seneca deployed-product manifest
4. Check workspace Seat
5. Resolve acting-user entitlement
6. Apply route/operation policy
External mapping:
| Decision | External response |
|---|---|
| Unknown agent | 404 |
| Deployed but unseated | Identical 404 |
| Seated creator requiring payment | Existing authoritative 402 |
| Seated but otherwise forbidden | 403 |
| Seat/entitlement infrastructure unavailable | 503 |
| Allowed | Continue |
Catalog behavior:
- Return only `allowed`.
- If entitlement resolution is unavailable for any deployed and seated agent, return 503 instead of a partial or widened catalog.
- Explicit subscription/onboarding routes may inspect trusted Seat presence without exposing other fleet members.
Entitlement becomes tri-state:
```ts
granted | denied | unavailable
```
`src/server/creatorSubscriptions.ts` must stop converting Stripe/database transport failures into ordinary inactive status:
- Confirmed missing/inactive subscription → `denied`
- Active subscription/public test access → `granted`
- Database, Stripe transport, timeout or malformed response → `unavailable`
Macro initially uses a Seneca policy returning `granted` for a Macro Seat because no separate Macro billing system exists. This is explicit compatibility policy, not Core logic.
---
## 6. Complete authorization enforcement
### Agent/Gateway
Enforce before lookup, binding, provisioning, or effect in:
- `packages/agent/src/server/agent-host/embeddedGateway.ts`
- `packages/agent/src/server/agent-host/httpProjection.ts`
- `packages/agent/src/server/agent-host/runtimeCapabilityProjection.ts`
- `packages/agent/src/server/agent-host/createAgentHost.ts`
Cover:
- Agent catalog
- Session list/summaries/create/read/state/rename/delete
- Attachments
- Prompt/follow-up
- Interrupt/stop/queue controls
- Models/tools/runtime capabilities
- Environment/runtime binding
- Legacy `/api/v1/agent/*` aliases
- Share, automation and dispatcher paths carrying agent/session identity
Legacy aliases resolve only an allowed workspace default. They never fall back to an unseated process default.
### Long-lived streams
For:
- Agent session event streams
- Session activity SSE
- Legacy chat streams
- Workspace bridge/UI command streams
Before forwarding every sensitive event:
1. Resolve current decision
2. Emit only if still allowed
3. Close immediately on Seat/entitlement denial
4. Close fail-safe on policy unavailability
An admitted model run may finish internally, but no further data is disclosed after revocation.
### Runtime bridge
Change:
- `packages/agent/src/server/runtimeEnvContributions.ts`
- `packages/workspace/src/server/workspaceBridge/runtimeToken.ts`
- `packages/workspace/src/server/workspaceBridge/httpRoutes.ts`
- `packages/workspace/src/server/workspaceBridge/refreshTokenStore.ts`
- `packages/core/src/app/server/coreWorkspaceBridge.ts`
Do not install durable workspace-wide bridge authority in the runtime environment.
Mint short-lived execution credentials per admitted operation, bound to:
```text
workspaceId
agentTypeId
seatId
sessionId
authSubjectId
accessEpoch
capabilities
expiry
```
Requirements:
- Prompt by user A cannot lend authority to user B.
- Refresh revalidates membership, Seat and user entitlement.
- Every call revalidates before idempotency reservation, handler dispatch, UI command, automation, or mutation.
- Token format/version changes; all legacy unbound credentials are rejected after cutover.
- If per-execution bridge credentials cannot be completed, workspace-bridge credentials remain disabled for enrolled-agent runtimes. Enforcement cannot ship with the old workspace-only token.
---
## 7. Explicit deployment authority
Replace `SENECA_INCLUDE_MACRO_ANALYST` with a Seneca-owned static product manifest, for example:
```text
agents/deployed-products.json
```
It explicitly lists:
- `dummy`
- `macro-analyst`
- `charlotteledoux`
Rules:
- Compiling a directory does not deploy it.
- Production fails if a manifest entry is missing or invalid.
- Unmanifested valid directories remain undeployed.
- Runtime releases may only replace an already manifested ID.
- Seat creation never changes the manifest.
- No `SENECA_INCLUDE_<AGENT>` variable remains.
This preserves current activation authority without expanding lifecycle scope.
---
## 8. Operator census service
Add a read-only, non-HTTP operator service in Boring Agent/Core.
It must:
- Enumerate every host session namespace
- Include namespaces for removed/uncompiled agent IDs
- Map known namespaces to workspace and agent
- Report unknown/unparseable/stale namespaces
- Avoid provisioning sandboxes or runtimes
- Never read transcript bodies
- Produce canonical sorted JSON and SHA-256 digest
- Include storage layout version, counts and latest metadata timestamp
- Require host/operator capability unavailable to ordinary requests
Likely implementation areas:
- `packages/agent/src/server/agent-host/sessionInventory.ts`
- Session-record store/layout implementation
- New operator inventory module exported only from server/operator entrypoint
- Core operator wrapper joining workspace IDs/defaults/Seats
Unknown or unparseable historical namespaces block enforcement.
---
## 9. Migration and cutover fence
Persisted modes:
### `compat`
- Used only before migration readiness.
- Existing global behavior remains.
- Never used as normal rollback after enforcement.
### `shadow`
- Computes and logs decisions.
- Continues legacy behavior.
- Produces no prompt/session content in telemetry.
### `write-enforce`
For unseated/unentitled agents:
- Deny session creation
- Deny prompt/follow-up
- Deny new runtime binding/provisioning
- Deny bridge credential mint/refresh
- Deny new external effects
Legacy reads remain temporarily available for census validation.
### `enforce`
- Catalog, reads, writes, streams, runtime and bridge all enforce decisions.
### Fence protocol
1. Admission paths acquire a shared cutover lease.
2. Operator transition acquires the exclusive database advisory fence.
3. Transition to `write-enforce`.
4. Wait for all pre-transition admission leases to drain.
5. Record epoch and high-water marker.
6. Run complete operator census.
7. Produce reviewed Seat manifest:
   - Valid persisted default, otherwise dummy
   - Every deployed agent with an existing session
   - Explicitly reviewed creator/product intent
   - Never every deployed agent
8. Apply idempotent manifest.
9. Re-run census and compare stable digest.
10. Verify no uncovered session/namespace exists.
11. Under the exclusive fence, store final census and manifest digests and transition to `enforce`.
12. Release fence.
No unseated session can appear between final census and enforcement.
---
## 10. Ordered cross-repository PR slices
### Boring PR 1 — Structured Agent access policy
Files include:
- `packages/agent/src/shared/gateway/types.ts`
- `packages/agent/src/shared/gateway/errors.ts`
- `packages/agent/src/server/agent-host/embeddedGateway.ts`
- `packages/agent/src/server/agent-host/httpProjection.ts`
- `packages/agent/src/server/agent-host/runtimeCapabilityProjection.ts`
- `packages/agent/src/server/agent-host/createAgentHost.ts`
Deliver:
- Structured decision API
- Optional backward-compatible host policy
- All gateway/direct/runtime enforcement
- Per-event stream revalidation
- Stable denial mapping
Gate: Agent tests, gateway conformance, typecheck and build.
### Boring PR 2 — Core Seats, signup intents and cutover fence
Files include:
- `packages/core/src/server/db/schema.ts`
- `packages/core/drizzle/<next>_workspace_agent_seats.sql`
- `packages/core/src/server/db/stores/PostgresWorkspaceStore.ts`
- `packages/core/src/server/db/stores/LocalWorkspaceStore.ts`
- `packages/core/src/server/auth/postSignupHook.ts`
- `packages/core/src/app/server/createCoreWorkspaceAgentServer.ts`
- `packages/core/src/server/defaultAgentType.ts`
- Workspace route/store tests
Deliver:
- Seat and signup-intent persistence
- Atomic initial workspace/Seat creation
- Add-only Seat endpoint
- Structured Core policy service
- Tri-state policy failure handling
- Cutover state and admission leases
- No replacement API
Gate: schema/store/auth/Core integration tests, including old-code compatibility with additive schema.
### Boring PR 3 — Runtime bridge and operator census
Files include:
- `packages/agent/src/server/runtimeEnvContributions.ts`
- `packages/agent/src/server/agent-host/sessionInventory.ts`
- `packages/workspace/src/server/workspaceBridge/runtimeToken.ts`
- `packages/workspace/src/server/workspaceBridge/httpRoutes.ts`
- `packages/workspace/src/server/workspaceBridge/refreshTokenStore.ts`
- `packages/core/src/app/server/coreWorkspaceBridge.ts`
- `packages/workspace/src/app/front/WorkspaceAgentFront.tsx`
Deliver:
- Execution-bound bridge authority
- Call/refresh revalidation
- Old-token rejection
- Offline complete census
- Empty/stale catalog frontend behavior
Gate: bridge security, inventory fixture, stream revocation, Workspace tests.
### Package gate
After all three Boring PRs:
1. Publish immutable Agent/Core/Workspace versions together.
2. Prefer stable packages.
3. If publication is blocked, generate exact pnpm patches from merged commits, including JS, declarations and migration assets.
4. Record upstream commit and installed-package probes.
5. Never implement a divergent Seneca-only authorization shim.
### Seneca PR 1 — Product manifest and policy
Files include:
- `agents/deployed-products.json`
- `src/server/agents.ts`
- `src/server/workspaceAgentPolicy.ts`
- `src/server/creatorSubscriptions.ts`
- `src/server/main.ts`
- `src/server/dev.ts`
- `docker-compose.prod.yml`
Deliver:
- Explicit deployment manifest
- Remove Macro-specific include flag
- Seat-first, tri-state entitlement policy
- Generic cutover-mode wiring
- Exact package consumption
### Seneca PR 2 — Signup/Add UX and discovery filtering
Files include:
- `src/front/AgentAuthPages.tsx`
- `src/front/AgentOnboarding.tsx`
- `src/front/agentRouting.ts`
- `src/front/main.tsx`
- `src/server/agentOnboarding.ts`
- `src/server/agentCommands.ts`
- `src/server/agentKnowledgeFilesystems.ts`
- `src/server/creatorSubscriptions.ts`
Deliver:
- Signup-intent issuance
- Email and OAuth intent preservation
- Add-only existing-user flow
- Catalog/command/filesystem filtering
- No false “added” success
- Workspace and split-pane independence
### Seneca PR 3 — Operator migration and cutover tooling
Files include:
- `src/server/migrate.ts`
- `scripts/census-agent-seats.mts`
- `scripts/backfill-agent-seats.mts`
- `scripts/cutover-agent-seat-enforcement.mts`
- Deployment/diagnostic workflows
- Production safety tests
Deliver:
- Exact-image migrations
- Census and reviewed manifest workflow
- Cutover fence commands
- Digest/count verification
- No destructive cleanup
---
## 11. Package and image ordering
1. Merge all Boring enforcement PRs.
2. Publish immutable package versions.
3. Merge Seneca code with enforcement mode initially `compat`.
4. Build one immutable Seneca image.
5. Resolve and record image digest.
6. Run migrations using that exact image digest.
7. Verify Seat, intent and cutover schema.
8. Start the exact same image digest in `compat`, then `shadow`.
9. Run census and reviewed backfill.
10. Enter `write-enforce`, drain and final-census.
11. Enter `enforce`.
12. Perform authenticated production smokes.
Never run migrations from a mutable tag and start a different digest.
---
## 12. Rollback
Normal rollback after enforcement:
- Deploy the last-known-good **enforcing** image.
- Keep Seat rows and cutover state.
- Do not alter Charlotte release pointers.
- Do not drop schema or delete sessions/workspaces/runtimes.
Initial-cutover failure:
- Prefer maintenance mode while fixing.
- A controlled fallback to `write-enforce` may restore legacy reads while keeping new effects blocked.
- `compat`/global access after enforcement is break-glass only:
  - Explicit human approval
  - Incident record
  - Time limit
  - Access audit
  - Immediate re-enforcement plan
An old pre-enforcement image is not a safe routine rollback target.
---
## 13. Required tests
### Authorization
- Unknown and deployed-unseated return identical 404.
- Seated inactive Charlotte returns 402.
- Entitlement outage returns 503.
- Shared workspace: one paid member cannot lend authority to another.
- Every direct addressed and legacy route denies before runtime/effect.
- No unauthorized tool/runtime provisioning occurs.
### Signup intent
- User, auth-attempt and target binding
- Expiry
- Replay
- Cross-user misuse
- Existing-user misuse
- Generic signup gets only dummy
- Charlotte signup gets only Charlotte
- Macro signup gets only Macro
- No intermediate dummy controller or session
### Bridge
- Token bound to agent/user/session/Seat
- Cross-user and cross-agent use denied
- Unseat/entitlement loss invalidates call and refresh
- Denied call creates no idempotency, UI, automation or handler effect
- Legacy token rejected
### Streams
- Revocation prevents the next activity update
- Revocation stops subsequent session events
- Policy outage closes stream
- No hidden session/agent identifier emitted after revocation
### Census and fence
- Known, stale and unparseable namespace fixtures
- No provisioning during inventory
- Stable sorted digest
- Concurrent pre-fence admission drains
- Post-fence unseated session creation denied
- No session appears between final census and enforcement
- Manifest/census mismatch blocks transition
### Frontend and product
- Add survives refresh/new browser
- No workspace reload or split-pane closure
- Stale localStorage selection clears
- No controller created for hidden agent
- Commands and knowledge excluded for hidden agents
- Explicit filesystem authorization preserved
- Macro tools require deployed + seated + entitled + addressed
- Public creator-test access changes entitlement only, never Seat persistence
---
## 14. Production acceptance gates
Enforcement may activate only when:
1. All Boring and Seneca suites pass.
2. Exact package versions and image digest are recorded.
3. Migrations ran from the same image digest now running.
4. Deployment manifest exactly matches approved products.
5. Operator census reports no unknown/unparseable namespace.
6. Reviewed backfill manifest digest matches stored run.
7. Every existing session has a corresponding Seat.
8. `write-enforce` denies concurrent unseated admission.
9. Final census is stable after drain.
10. Charlotte/Macro/generic signup E2E produces exactly the expected Seat.
11. Direct bypass, bridge and stream revocation smokes pass.
12. Commands, knowledge and tools follow the same access decision.
13. Health, Stripe, ClickHouse fail-fast, Charlotte release digest and creator activation remain unchanged.
14. No `SENECA_INCLUDE_<AGENT>` parameter remains.
## Residual risks
- Already admitted model/tool effects are not synchronously undone; this remains A8/accepted-work lifecycle scope. New bridge calls and data streaming are stopped.
- Macro currently has no independent paid entitlement provider; its compatibility policy remains intentionally open once seated.
- Census must understand every historical session-layout version. Unknown layouts block enforcement.
- The first enforcement cutover has no older enforcing image; maintenance or `write-enforce` is safer than reverting to globally open access.
- Temporary multi-package patches are higher risk than stable publication and should not be preferred.
```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "The plan dispositions review findings F1-F7 with P0/P1 severity, concrete source paths, revised protocols, ordered PR slices, enforcement closure, migration fence, rollback, tests and residual risks."
    }
  ],
  "changedFiles": [],
  "testsAddedOrUpdated": [],
  "commandsRun": [],
  "validationOutput": [
    "Reviewed /tmp/agent-enrollment-plan.plan-review.json.",
    "Revised every blocking finding: F1, F2, F3, F4, F5, F6 and F7."
  ],
  "residualRisks": [
    "Already admitted effects are not undone; broader revocation lifecycle remains out of scope.",
    "Macro has no independent paid entitlement provider.",
    "Unknown historical session-layout namespaces block enforcement.",
    "Stable package publication is preferred over temporary multi-package patches."
  ],
  "noStagedFiles": true,
  "diffSummary": "Plan-only revision; no repository files modified.",
  "reviewFindings": [
    "P0 F1: packages/core/src/server/defaultAgentType.ts and Seneca AgentAuthPages.tsx - unsafe bootstrap replacement removed in favor of atomic single-use signup intent.",
    "P0 F2: AgentHost access policy and creatorSubscriptions.ts - boolean allowed-ID model replaced by structured 404/402/503 decisions.",
    "P0 F3: runtimeEnvContributions.ts, runtimeToken.ts and coreWorkspaceBridge.ts - runtime bridge authority must be agent/user/session/Seat bound and revalidated.",
    "P1 F4: migration cutover - write-enforce stage and admission fence close shadow-to-enforce race.",
    "P1 F5: sessionInventory.ts - explicit offline complete census service added to the plan.",
    "P1 F6: Seneca agents.ts and migrate.ts - explicit deployment manifest and exact-image migration ordering preserve activation authority.",
    "P1 F7: httpProjection.ts - every stream update is reauthorized; reconnect-only filtering rejected."
  ],
  "manualNotes": "The plan is execution-ready, but enforcement must stop if census coverage or runtime bridge binding cannot be proven complete."
}
```
