---
github: https://github.com/hachej/boring-ui/issues/1355
issue: 1355
state: ready-for-human
updated: 2026-08-21
flag: host-composition-capability
track: owner
---

# gh-1355 — persistent multi-project agent Console

## Problem

Boring currently has the pieces of a multi-project shell, but not one durable
Console model shared by the CLI and hosted Seneca:

- CLI workspaces mode holds one host but keys `WorkspaceAgentFront` by the
  selected local workspace, so switching destroys and remounts the workbench.
- CLI session previews issue one addressed request per local workspace and are
  capped client-side; startup also prewarms plugin runtimes for every available
  workspace.
- Hosted full-app serves one authorized Workspace shell at a time.
- Tasks, Human Intentions, and Automations remain request-Workspace scoped.
- Session identity is scope-relative: `(workspaceScopeId, agentTypeId,
  sessionId)`.

The product needs one persistent browser Console that can cold-list and organize
authorized Workspaces, Agents/Seats, Sessions/Threads, Tasks, Human Intentions,
and Automations without booting inactive runtimes. Project navigation must
organize work rather than mint authority or silently rebind execution.

## Ratified architecture reconciliation

This plan is subordinate to:

1. [`docs/plans/long-term/ratified/VISION.md`](../../plans/long-term/ratified/VISION.md)
2. [`docs/plans/long-term/ratified/ARCHITECTURE-PLAN.md`](../../plans/long-term/ratified/ARCHITECTURE-PLAN.md)
3. [`docs/plans/long-term/ratified/RECONCILIATION.md`](../../plans/long-term/ratified/RECONCILIATION.md)
4. [`docs/plans/long-term/ratified/V2-IMPLEMENTATION-SPEC.md`](../../plans/long-term/ratified/V2-IMPLEMENTATION-SPEC.md)

The frozen meanings remain unchanged:

| Ratified noun | Meaning retained here |
| --- | --- |
| Workspace | Durable governed world containing Seats, Threads, Mounts, shared state, and artifacts. |
| Agent | Durable actor independent of any Workspace. Current `agentTypeId` is a compatibility projection, not a Project-owned copy. |
| Seat | Workspace-specific participation/grants for an Agent; a Seat never mutates Agent identity. |
| Thread / Session | One object. Thread is the product noun; Session is the current runtime implementation. It owns one record and many Runs. |
| Run | One admitted execution. `RunId := RequestKey`; the Console never mints a second execution ID. |
| Mount | Governed logical namespace. It is not a Project and need not be POSIX. |
| Authority | Host-issued, reauthorized at the originating Workspace/effect, and only narrows. |
| Product | Deferred packaging definition that instantiates a Workspace; not a company or Project container. |

### Compatibility collection labelled “Project”

The user requirement for movable organizational Projects cannot reuse
`Workspace`: a Thread's Workspace is part of its governed world and authority,
while changing an organizational label must preserve execution and history.
It also must not create a thirteenth V2 kernel noun or let an L6 surface own
cross-domain semantics. The implementation contract is therefore a
compatibility-only saved collection, displayed as **Project** in the Console:

```ts
interface ConsoleCollection {
  id: string
  owner: { appId: string; principalId: string }
  label: string
  description?: string
  revision: number
  createdAt: string
  updatedAt: string
}

interface ConsoleThreadRefV1 {
  workspaceScopeId: string
  agentTypeId: string
  sessionId: string
}

interface ConsoleCollectionThreadAssignment {
  collectionId: string
  owner: { appId: string; principalId: string }
  thread: ConsoleThreadRefV1
  revision: number
  assignedAt: string
}
```

`ConsoleCollection` is host/control-plane navigation metadata analogous to a
saved View or folder. It is UI-labelled Project, explicitly not ported as a V2
noun, and has no Seats, Mounts, credentials, runtime, cwd, Task ownership, or
authority. It does not own a Thread record, Task, Human Intention, or Automation.
Those domains expose independently authorized references that the collection
may organize.

For v1 the owner is derived server-side as `(appId, principalId)`; the browser
never supplies or widens it. A collection can contain scoped references from
several visible Workspaces, but each read and mutation independently verifies
both collection ownership and current origin-resource visibility.

Persistence enforces a foreign key to the collection; a unique key over
`(appId, principalId, workspaceScopeId, agentTypeId, sessionId)`; owner equality;
and transactional compare-and-set using `revision`. `Add` is idempotent only
when the current assignment matches. `Move` requires `expectedCollectionId`
(or expected unassigned) and conflicts on stale revision. Unassign is explicit.
Deleting a collection unassigns references but never deletes origin resources.
Revoked membership hides and prevents mutation of an origin ref without
silently deleting the assignment; stale Thread refs remain repairable metadata.

The existing proposed
[`PROJECT_ENVIRONMENT_MODEL.md`](../../PROJECT_ENVIRONMENT_MODEL.md) is
superseded in Slice 0 where it conflicts with the frozen plan: delete the
`Product Workspace → Project → Environment` authority hierarchy from its
normative proposal, retain useful runtime/filesystem research as non-binding
compatibility notes, and point its ownership vocabulary to canonical
Workspace/Seat/Thread/Mount/Authority. Placement, request Authority, Mounts,
and runtime fencing remain distinct.

## Solution

### 1. One persistent Console shell

```text
Authenticated Console (persistent)
├── Console catalog and navigation
│   ├── Projects
│   ├── Agents / Seats
│   ├── Sessions / Threads
│   ├── Tasks
│   ├── Inbox / Human Intentions
│   └── Automations
└── Active Workspace projection
    └── WorkspaceAgentFront (mounted only after explicit activation)
```

Filtering or reorganizing the Console does not remount it. Inactive Workspaces
remain cold DTOs. Explicitly opening a Workspace/Thread may mount or replace the
active Workspace projection, but the Console, catalog state, filters, and global
surfaces remain mounted.

The default left-pane projection is `Project → Agent → Session`; omit the Agent
level when the authorized fleet has one Agent. Other organization modes are:

```text
By Project: Project → Agent → Session
By Agent:   Agent → Project → Session
By Task:    Task → Agent → Session
Flat:       Session rows with Project and Agent labels
```

`By Agent` appears only when more than one authorized Agent/Seat is visible.
`By Task` appears only when an authorized Task source exists. Manual ordering is
out of scope.

### 2. Server-owned cold catalog

Add one bounded, paginated, browser-safe aggregate service rather than browser
N+1 requests. Providers supply the authorized inventory:

- CLI: declared entries from `LocalWorkspaceRegistry` plus host-side session
  stores/catalogs.
- Hosted: current Core `(appId, principalId)` Workspace listing plus a new cold
  storage-coordinate/session index. C7 SessionCatalog and full Seat projection
  are target architecture, not current prior art or a prerequisite silently
  assumed by this plan.

The catalog may read metadata stores and envelope-derived projections. It must
not:

- resolve or provision an Environment/runtime;
- instantiate `HarnessPiChatService` merely to list sessions;
- prewarm plugin runtimes for every local workspace;
- create task runtimes or automation executors;
- read message/tool content for tenancy, metering, or global activity; legacy
  reconciliation may call only the exported Slice `.20` scanner, which reads
  the header plus contiguous `session_info` records and stops before the first
  message/tool entry;
- treat a Project-labelled collection association as authorization.

The catalog contract is versioned and collection-specific: each collection
(Workspaces, collections, Agents/Seats, Threads, Tasks, Intentions, Automations)
uses its own opaque cursor. A cursor is server-bound to principal, app, filters,
provider revision, sort key, and limit; it cannot be replayed under another
scope. Default/max page sizes are 25/100 rows and 256 KiB encoded response per
collection. Ordering is stable `(updatedAt DESC, stableId ASC)`. Pages are
best-effort at an exposed provider revision; a revision mismatch returns a
restart cursor rather than silently mixing snapshots. Browser DTOs are explicit
allowlists and never contain host paths, credentials, prompt bodies, transcript
content, or provider handles.

Every row is filtered server-side. Every effect routes back to its origin and
reauthorizes there.

### 3. Session/Thread creation and organizational movement

Creation from a Project-labelled ConsoleCollection requires an explicit authorized Workspace and
Agent/Seat target. Server policy resolves runtime placement and current
authority; callers never choose host paths, credentials, provider internals, or
runtime admission.

`Add to project` and `Move to project` change only
`ConsoleCollectionThreadAssignment` through the CAS rules above. They preserve:

- `workspaceScopeId` and Thread/Session identity;
- Agent/Seat identity;
- runtime binding/lease/generation;
- relative cwd;
- transcript/record and active connection;
- Task links and admitted Runs.

A cross-Workspace Thread transfer is not called Move. It requires a future
fork/copy-with-provenance or explicit authority/data migration protocol and is
out of scope.

### 4. Tasks and Inbox are projections, not new truth

GitHub, Beads, and other Task adapters remain canonical. Reuse stored
`BoringTaskSessionLink` v1 unchanged so rollback code cannot reject a widened
file schema. The Console provider wraps it in trusted origin context:

```ts
interface ScopedTaskSessionLink {
  originWorkspaceScopeId: string // derived by provider, never from link JSON
  link: BoringTaskSessionLink
}
```

Do not add a second Task↔Thread entity or canonical Task database. A later
persisted schema change requires expand → dual-read/write → cutover → contract;
it is not hidden inside this projection slice.

Task linking never moves a Thread's collection assignment. If the UI detects a
cross-Project-label link, it offers explicit `link only` or `move assignment
and link`; the server executes two independently authorized operations.

Inbox is a View over durable Human Intentions, approvals, Tasks, and Activity.
Current `ask-user` file records are a named compatibility adapter, not final C5
truth: C5's future durable-pause store may replace the adapter through its own
migration, while the Console projection contract remains stable. Inbox cannot
grant authority. Aggregation filters server-side. The current ask-user adapter
supports only answer/cancel and routes both to originating Workspace, Thread,
Run, and request reauthorization. Approval remains absent until C5 supplies a
durable approval source; the compatibility UI must not simulate it.

### 5. Console-level Automation definitions with explicit targets

Existing Automation definitions remain canonical and Workspace/actor-owned;
their prompts stay in their current Workspace stores. The Console adds a
non-executable `AutomationGroup` that organizes references to independently
authorized child definitions. The UI may present the group as one multi-Project
automation, but scheduling and execution always happen through its children.

```text
AutomationGroup (personal Console metadata; no prompt/executor)
└── AutomationGroupTarget[]
    ├── collectionId (display context)
    ├── workspaceScopeId + agentTypeId
    └── childAutomationId (canonical Workspace definition)
        └── target invocation
            ├── invocationKey = hash(groupId, occurrence, targetId)
            ├── one Thread/Session (new by default)
            ├── one admitted Run = RequestKey
            └── independent receipt/status/error
```

Creating/updating a group first authorizes every target, then materializes or
updates child Workspace definitions through existing stores. Materialized
children carry `managedByGroupTargetId` and are excluded from both local
`DueRunService` and `hostedDueRunService`/Postgres due-candidate evaluation; the
group scheduler is the sole scheduling authority for them. A conformance test
runs local due, hosted due, and group scheduler paths for one occurrence and
requires exactly one child Run. Partial
materialization records target-level error and does not pretend the group is
fully enabled. Removing a target disables its future child schedule but does
not cancel a running Run or delete history; deletion of the child definition is
a separate authorized action. Group cancellation fans out explicit child
cancellations and records each result. Repeated scheduling of the same
`(groupId, occurrence, targetId)` is idempotent; changed target configuration
gets a new target revision and cannot reuse an old occurrence key.

Rollback disables group scheduling/UI; canonical child definitions, prompts,
runs, and histories continue Workspace-scoped operation. Fan-out never unions
Workspace grants. Credentials, metering, partial failure, cancellation, and
`outcome-unknown` remain per target. Listing groups/children never starts an
inactive runtime.

## Decisions

| Decision | Chosen | Why |
| --- | --- | --- |
| Console ownership | V1 is personal to server-derived `(appId, principalId)`; CLI uses one local registry profile. Organization-shared collections wait for a real organization identity/role contract. | Matches current Core authority instead of inventing an organization boundary. |
| Project ontology | Internal `ConsoleCollection` is host-owned saved navigation metadata, UI-labelled Project and explicitly not ported as a kernel/domain noun. | Preserves movable grouping without making an L6 surface or Project a new authority owner. |
| Thread ownership | Canonical Workspace owns Thread; ConsoleCollection holds an optional singular navigation assignment. | Matches frozen V2 ontology and keeps authority explicit. |
| Session movement | Move changes only assignment. Cross-Workspace transfer is a distinct future fork/migration. | Prevents silent transcript/resource/authority rebinding. |
| Environment | No new durable Environment authority in this epic. Placement/runtime profiles are host mechanisms; AuthorizedEnvironment is request-derived. | Avoids competing Mount/Authority/Placement abstractions. |
| Agent fleet | Agent identities are global; Seats carry Workspace participation. Current static `agentTypeId` remains compatibility identity. | Preserves deployment-static fleets and the Seat invariant. |
| Global queries | Server-side authorized projections with bounded pagination. | Avoids leaks, N+1 traffic, and runtime boots. |
| Tasks | External adapters remain canonical; reuse and scope `BoringTaskSessionLink`. | No duplicate task truth or link entity. |
| Automations | A Console `AutomationGroup` references canonical Workspace-owned child definitions; every child target gets independent authorization, Thread, Run, and receipt. | Preserves existing prompt/store truth, rollback, and target-level failure without authority union. |
| Rollout | Injected Console catalog/provider capability, not a new feature-flag framework. | Host-owned composition is explicit and rollback is removing the provider. |

## Flag / Abstraction

- **Needed?:** Yes, as an additive host-composition capability; no global flag
  framework.
- **Path:** hosts inject a Console catalog/collection-assignment provider and
  advertise the corresponding browser-safe capability. CLI is the first
  provider; hosted core is added only after the tracer is proven.
- **Rollback:** remove/disable the provider and routes. Existing
  Workspace-scoped routes, stores, session records, Task links, and Automation
  definitions remain authoritative and unchanged.

## Test seams

- **Highest public seam:** authenticated Console catalog route/service, then the
  persistent shell consuming its DTO.
- **Existing prior art:** `LocalWorkspaceRegistry`; addressed
  `/api/v1/agents/:agentTypeId/sessions`; `SessionStore.list`; app-left
  multi-project tree; core membership Workspace store; Tasks source service;
  ask-user store; Automation request-scoped store/executor.
- **Avoid testing:** private React state, provider-private filesystem roots,
  implementation-specific SQL queries, or runtime internals through mocks that
  cannot detect boot.

Required negative instrumentation wraps runtime/plugin/provision entry points.
A cold catalog test fails if any inactive runtime, plugin host, due-run service,
or executor is created.

## Acceptance

1. One Console shell remains mounted while organization mode, Project filter,
   and active Workspace change.
2. Global catalog reads are server-side, authorized, paginated, and demonstrably
   no-boot.
3. The Project-labelled ConsoleCollection is optional personal navigation
   metadata and cannot grant Workspace, filesystem, Task, Automation, Session,
   or Agent authority; it is not ported as a V2 noun.
4. Every Session/Thread is addressed with trusted origin scope; identical
   `sessionId` values cannot collide across Workspaces/Agents.
5. Creating a Thread from Project context requires explicit authorized
   Workspace and Agent/Seat targets.
6. Moving a Thread between Project-labelled collections preserves execution binding, cwd,
   record/transcript, Agent/Seat, Runs, Task links, and live connection.
7. Agent organization appears only for multi-Agent fleets; Task organization
   appears only with an authorized Task capability.
8. Global Tasks remain adapter-owned and reuse a scope-safe
   `BoringTaskSessionLink`.
9. Inbox actions reauthorize their originating scope; the aggregate is never an
   approval authority.
10. AutomationGroups preserve canonical Workspace child definitions and produce
    independent per-target Threads, admitted Runs, credentials, receipts,
    status, and partial failures with deterministic occurrence keys.
11. CLI and hosted Seneca share contracts/conformance suites but keep separate
    providers and persistence.
12. Existing Workspace-scoped behavior remains available as rollback.

## Proof

- **Graph:** `br dep cycles` → no cycles.
- **Planner graph analysis:** `bv --robot-insights` completed; the graph now
  separates contracts, cold catalog, personal assignment, shell, and each
  Task/Inbox/Automation/hosted adapter.
- **Plan validation:** `git diff --check`; local Markdown-link check;
  `pnpm lint:invariants`; independent adversarial architecture review.
- **Visual review:** [`plan-review.html`](plan-review.html).
- **Implementation commands:** exact package commands are part of every bead
  below; a worker must update only a path renamed by intervening main changes,
  never replace proof with a generic waiver.

## Slices

### Gate 1 — approve architecture (`.1`)

Owner decision on the four open rulings. Proof is an answered Human Intention
linked to `plan-review.html` and the exact PR revision. No implementation bead
is ready before it.

### Slice 0 — vocabulary and browser contracts (`.2`)

Supersede the conflicting hierarchy in `PROJECT_ENVIRONMENT_MODEL.md`; record
the compatibility-only ConsoleCollection ruling; add browser-safe DTOs,
independent cursor contracts, and disclosure bounds.

- **Blocked by:** `.1`.
- **Proof:** `pnpm --filter @hachej/boring-workspace test -- src/shared/__tests__/consoleCatalog.test.ts`; `pnpm lint:invariants`; `git diff --check`.
- **Scope:** named docs plus `packages/workspace/src/shared/consoleCatalog.ts`
  and its contract test.

### Slice 1 — cold CLI catalog (`.3`)

Add the bounded CLI route, cold storage-coordinate/session index, and actual
composition no-boot instrumentation. C7/Seat catalog remains named new target
work, not assumed current machinery.

- **Blocked by:** `.2`.
- **Proof:** `pnpm --filter @hachej/boring-ui-cli test -- src/server/__tests__/consoleCatalog.test.ts`; `pnpm --filter @hachej/boring-ui-cli typecheck`.
- **Scope:** CLI server catalog/route/tests and Agent cold index interface only.

### Slice 2 — personal CLI collections and assignment service (`.5`)

Persist owner-derived collections and singular Thread assignments with FK,
full-ref uniqueness, owner equality, CAS revisions, explicit unassign/delete,
revocation, stale-ref, and idempotency semantics. No Agent tool.

- **Blocked by:** `.3`.
- **Proof:** `pnpm --filter @hachej/boring-ui-cli test -- src/server/__tests__/consoleCollectionStore.test.ts src/server/__tests__/consoleCollectionService.test.ts`; `pnpm --filter @hachej/boring-ui-cli typecheck`.
- **Scope:** CLI host adapter/service/routes/tests only.

### Slice 3 — persistent shell (`.4`)

Keep one Console mounted and add Project-labelled collection, Agent, and Flat
organization. Explicit activation mounts one Workspace projection. `By Task`
remains absent until `.14`.

- **Blocked by:** `.3`, `.5`.
- **Proof:** `pnpm --filter @hachej/boring-ui-cli test -- src/front/__tests__/ConsoleShell.test.tsx`; `pnpm --filter @hachej/boring-workspace test -- src/front/layout/plugin-tabs/__tests__/AppLeftPane.test.tsx`; desktop screenshot.
- **Scope:** CLI Console front and Workspace app-left projection/tests only.

### Slice 4A — scope-safe Task projection (`.6`)

Keep Task link storage v1; add provider-derived scoped wrappers and authorized
server projection. No Inbox or UI work.

- **Blocked by:** `.4`.
- **Proof:** `pnpm --filter @hachej/boring-tasks test -- src/server/__tests__/taskSessionProjection.test.ts`; `pnpm --filter @hachej/boring-tasks typecheck`.
- **Scope:** Tasks shared/server projection/tests only.

### Slice 4B — CLI Task host routes (`.16`)

Register personal cross-Workspace Task projection/link routes in the CLI host;
inject server-derived owner/collection providers and reauthorize every origin.

- **Blocked by:** `.6`.
- **Proof:** `pnpm --filter @hachej/boring-ui-cli test -- src/server/__tests__/consoleTaskRoutes.test.ts`; `pnpm --filter @hachej/boring-ui-cli typecheck`.
- **Scope:** one CLI Task route family, host registration seam, and tests.

### Slice 4C — `By Task` UI (`.14`)

Expose Task grouping only when an authorized Task source exists and present
explicit link-only versus move-assignment-and-link actions.

- **Blocked by:** `.4`, `.6`, `.16`.
- **Proof:** `pnpm --filter @hachej/boring-workspace test -- src/front/layout/plugin-tabs/__tests__/AppLeftPane.test.tsx`; `pnpm --filter @hachej/boring-tasks test -- src/front/__tests__/ConsoleTaskProjection.test.tsx`; capability-on/off screenshots.
- **Scope:** Workspace app-left and Tasks front projection/tests only.

### Slice 5A — ask-user compatibility adapter (`.13`)

Project current Workspace ask-user records as origin-scoped Human Intentions;
route actions back through origin authorization and reserve C5 replacement.

- **Blocked by:** `.5`.
- **Proof:** `pnpm --filter @hachej/boring-ask-user test -- src/server/__tests__/consoleIntentionProjection.test.ts`; `pnpm --filter @hachej/boring-ask-user typecheck`.
- **Scope:** ask-user shared/server adapter/tests only.

### Slice 5B — CLI Intention host routes (`.17`)

Register personal cross-Workspace Intention list/action routes in the CLI host;
route answer/cancel to origin authorization and reject stale/abandoned actions.

- **Blocked by:** `.13`, `.16` (serializes the shared host registration seam).
- **Proof:** `pnpm --filter @hachej/boring-ui-cli test -- src/server/__tests__/consoleIntentionRoutes.test.ts`; `pnpm --filter @hachej/boring-ui-cli typecheck`.
- **Scope:** one CLI Intention route family, host registration seam, and tests.

### Slice 5C — persistent Console Inbox UI (`.15`)

Render authorized global Intentions with origin context and stale/abandoned
states; never treat the aggregate as approval authority.

- **Blocked by:** `.4`, `.13`, `.17`.
- **Proof:** `pnpm --filter @hachej/boring-ask-user test -- src/front/inbox/__tests__/ConsoleInboxProjection.test.tsx`; `pnpm --filter @hachej/boring-ask-user typecheck`; Inbox screenshot.
- **Scope:** ask-user front Inbox projection/tests and Console registration.

### Slice 6A — AutomationGroup store/materialization (`.7`)

Add non-executable personal group metadata and authorize/materialize canonical
Workspace child definitions while prompts remain child-owned. Managed children
carry `managedByGroupTargetId`.

- **Blocked by:** `.5`.
- **Proof:** `pnpm --filter @hachej/boring-automation test -- src/server/__tests__/automationGroupStore.test.ts src/server/__tests__/automationGroupMaterializer.test.ts`; `pnpm --filter @hachej/boring-automation typecheck`.
- **Scope:** Automation group store/materializer/tests only.

### Slice 6B — AutomationGroup dispatch (`.9`)

Make the group scheduler sole authority for managed children by excluding them
from both local and hosted due evaluation; fan out deterministic target occurrences to
independent Workspace authorization, Thread, Run/RequestKey, receipt,
cancellation, and partial-failure records.

- **Blocked by:** `.7`.
- **Proof:** `pnpm --filter @hachej/boring-automation test -- src/server/__tests__/automationGroupExecutor.test.ts src/server/__tests__/dueRunService.test.ts src/server/__tests__/hostedDueRunService.test.ts`; `pnpm --filter @hachej/boring-automation typecheck`; local due, hosted due, and group paths produce exactly one child Run.
- **Scope:** Automation executor/due integration/event tests only.

### Slice 6C — CLI AutomationGroup host routes (`.18`)

Register personal group CRUD/materialization/dispatch/cancel/status routes in the
CLI host without exposing child prompt bodies or unioning grants.

- **Blocked by:** `.9`, `.17` (serializes the shared host registration seam).
- **Proof:** `pnpm --filter @hachej/boring-ui-cli test -- src/server/__tests__/consoleAutomationGroupRoutes.test.ts`; `pnpm --filter @hachej/boring-ui-cli typecheck`.
- **Scope:** one CLI AutomationGroup route family, host registration seam, and tests.

### Slice 6D — AutomationGroup UI (`.10`)

Present group targets, explicit Workspace/Agent destinations, target errors,
runs, and cancellation.

- **Blocked by:** `.4`, `.9`, `.18`.
- **Proof:** `pnpm --filter @hachej/boring-automation test -- src/front/__tests__/AutomationGroupPanel.test.tsx`; `pnpm --filter @hachej/boring-automation typecheck`; partial-failure screenshot.
- **Scope:** Automation front components/tests only.

### Slice 7A — hosted collection/assignment store (`.8`)

Add personal Core/Postgres persistence keyed by server-derived app/principal,
with constraints and rollback-safe additive migration. No routes.

- **Blocked by:** `.5` contract/semantics.
- **Proof:** `pnpm --filter @hachej/boring-core test -- src/server/db/stores/__tests__/consoleCollectionStore.test.ts src/server/db/__tests__/consoleCollections.schema.test.ts`; `pnpm --filter @hachej/boring-core typecheck`.
- **Scope:** Core schema/migration/store/tests only.

### Slice 7B — hosted routes and authorization (`.11`)

Add personal catalog/CRUD providers, independent origin authorization, opaque
cursors, and cold index access. Browser never supplies owner scope.

- **Blocked by:** `.8`.
- **Proof:** `pnpm --filter @hachej/boring-core test -- src/server/routes/__tests__/consoleCatalog.test.ts src/server/routes/__tests__/consoleCollections.test.ts`; `pnpm --filter @hachej/boring-core typecheck`.
- **Scope:** Core services/routes/auth adapters/tests only.

### Slice 7C — hosted domain routes (`.19`)

Register provider-backed Task, Intention, and AutomationGroup route families in
Core with server-derived personal owner and per-origin authorization, reusing
the CLI-proven browser contracts.

- **Blocked by:** `.6`, `.9`, `.11`, `.13`, `.18` (the CLI route chain is proven first).
- **Proof:** `pnpm --filter @hachej/boring-core test -- src/server/routes/__tests__/consoleDomainRoutes.test.ts`; `pnpm --filter @hachej/boring-core typecheck`.
- **Scope:** Core domain route/provider composition and tests only.

### Slice 7D — exported metadata-only session scanner (`.20`)

Add an Agent-package cold scanner that reads only the Pi header and contiguous
`session_info` records, stops before the first message/tool entry, enforces
line/byte bounds, and returns an incomplete-title marker instead of reading the
first user message.

- **Blocked by:** `.2`.
- **Proof:** `pnpm --filter @hachej/boring-agent test -- src/server/harness/pi-coding-agent/__tests__/sessionMetadataScanner.test.ts`; `pnpm --filter @hachej/boring-agent typecheck`.
- **Scope:** Agent metadata scanner export/implementation/tests only.

### Slice 7E — full-app composition and legacy reconciliation (`.12`)

Wire the hosted provider/shell/domain routes and reconcile legacy session
metadata through `.20` only. Incomplete rows remain untitled until normal
authorized access updates the index. Existing Workspace routes remain rollback.

- **Blocked by:** `.4`, `.11`, `.19`, `.20`.
- **Proof:** `pnpm --filter full-app test -- src/__tests__/consoleComposition.test.tsx`; `pnpm --filter @hachej/boring-core test -- src/app/server/__tests__/consoleInventoryReconciliation.test.ts`; `pnpm --filter full-app typecheck`; manual hosted login/switch; no-runtime-boot counters.
- **Scope:** full-app composition and Core reconciliation job/tests only; no transcript parser changes.

## Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| UI Project label becomes a competing Workspace/domain API | Medium | High | Internal compatibility-only ConsoleCollection, no origin ownership/authority, explicit non-port ruling, Slice 0 supersession text. |
| Global inventory leaks unauthorized metadata | Medium | High | Provider returns only actor-filtered rows; actions reauthorize origin; cross-membership tests. |
| Listing boots every runtime/plugin | High today | High | Server aggregate tracer, remove unconditional prewarm from inventory path, instrument zero-boot tests. |
| Organizational move is mistaken for authority migration | Medium | High | Move mutates only assignment; cross-Workspace transfer absent and explicitly named fork/migration. |
| Task and Session IDs collide across scopes | Medium | High | Trusted `workspaceScopeId + agentTypeId + sessionId` refs and migration tests. |
| Automation becomes a confused deputy | Medium | High | Bind Workspace/Seat before admission; one authority/envelope per target; never union grants. |
| Hosted and CLI stores drift | Medium | Medium | Shared DTO/conformance suite; independent providers by design. |
| Broad UI/store PR exceeds review budget | Medium | Medium | Twenty one-session beads split contracts, stores, scanners, host routes, UI, fan-out, and hosted composition. |

## Out of scope

- A new V2 kernel noun or change to frozen Workspace/Seat/Thread/Run meanings.
- Organization-shared Console collections before Core has a real organization identity and role contract.
- Cross-Workspace Thread migration or transcript copying.
- Environment switching, provider migration, or caller-selected runtime images,
  host paths, credentials, Mounts, or network policy.
- A canonical Task database or duplicate Task↔Thread link.
- Booting all Workspace runtimes for global views.
- Manual sidebar ordering.
- Agent marketplace, remote A2A, cloud scheduler, or arbitrary persistent
  processes.
- Implementation in this planning PR.

## Open questions for owner gate

1. Approve a personal, host-owned `ConsoleCollection` compatibility object,
   UI-labelled Project and explicitly not ported as a V2 noun?
2. Approve v1 ownership derived server-side as `(appId, principalId)`, with
   organization-shared collections deferred until Core has a real organization
   identity/role contract?
3. Confirm that `Move to project` changes only collection assignment and that
   cross-Workspace transfer is a future fork/migration?
4. Confirm AutomationGroup semantics: references to canonical Workspace child
   definitions, deterministic per-target occurrence identity, and one Thread
   and admitted Run per child invocation?
