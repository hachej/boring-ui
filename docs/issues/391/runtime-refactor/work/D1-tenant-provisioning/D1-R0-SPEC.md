# D1-R0 — atomic multi-agent host revisions

Status: **accepted by adversarial plan review; binding on merge**. This
specification replaces the active D1-R0 planning tracer. It does not revive the
historical dedicated-site design later in this work package.

## 1. Decision and scope

D1 v1 runs one Docker Compose deployment on one EU host. It has one ingress,
one stable `core-app` process, and shared durable database/storage. The current
full app already hosts N lazy workspace bindings in one process. D1 preserves
that composition and invokes stateless P6-R independently for every binding.
**Agents are not containers.**

D1-S1 does not implement concurrent core-process replacement. Current request leases do
not prove that a disconnected accepted producer has finished, so an in-flight
counter cannot safely retire an old process or decide reconnect affinity. A
generic dual-process claim would risk two processes writing the same session. The
first slice instead publishes immutable **additive** binding revisions to the
one stable process. Existing binding runtime/composition/secret/root fields must
remain byte-identical. A revision may add a binding or change bounded landing
copy; replacement of an admitted binding, runtime/secret rotation, or removal
fails closed with `D1_ACTIVE_BINDING_RESTART_REQUIRED`.

This makes the continuity guarantee mechanical: applying N+1 never moves or
restarts the process serving bindings 1..N, and their resolved identities do not
change. A reconnect reaches the same process and durable session root. An
online rollback may remove only a binding with no durable admission row
(landing views do not count) and restore landing-only values. Any binding that
has admitted an agent request requires an explicit maintenance-window restart;
D1-S1 never infers idleness from connection state. Rollback still materializes
a new immutable COMPLETE revision and never moves the active pointer backward.

The hostname is a surface lookup only:

```txt
trusted ingress Host -> active revision site map -> landing/auth handoff
                                           |
                                           +-> configured workspace id
                                               + existing membership check
                                               + configured default deployment
                                               + one P6-R call
```

Possessing or supplying a hostname, workspace id, bearer token, deployment id,
or operator-ref string grants no workspace or host authority. Membership is the
workspace authority. Only the local CLI process admitted by host OS permissions
may plan, apply, publish, or roll back a host revision. D1 adds no management
HTTP route, tenant CRUD API, wildcard router, scheduler, reconciler, queue,
provider registry, or secret service.

P2/runsc and P5a are not D1 gates. The real non-mocked `preflightRunsc`
execution passed all seven structural probes on the EU host. The runsc
production lock remains open until the privileged execution model and the
remaining lifecycle/security proofs land. D1 consumes the currently approved
isolated runtime composition; a trusted-direct runtime is valid only for local
development or a single-workspace dedicated composition, never this shared
N-workspace host.

## 2. Compose and apply rules

The production file is `deploy/d1/compose.yml`. It defines ingress and one
`core-app`; `databaseRef` resolves to an external, already-provisioned database,
not a D1 Compose database service. The core uses one pinned host-app image
digest and durable workspace/session volumes. The core mounts the revision tree
read-only; only the root-owned local CLI writes revisions and the atomic active
pointer on the host. The core writes admission state through the external
database, not through that mount. Direct core ports bind loopback or an
internal-only network; clients cannot bypass ingress.

Compose operations obey the verified EU-host spike rules:

- use one compose file for plan/apply/rollback;
- run idempotent `docker compose up -d`, never `--force-recreate`;
- use service-specific `up -d --no-deps core-app` only for initial boot or an
  explicit maintenance-window restart; additive revisions do not invoke Compose;
- change or roll back only the named service with `--no-deps`; never run a
  blanket old compose file over newer volumes, secrets, or services;
- keep process-level Compose environment in one core env file;
- keep each agent/workspace binding in its own redacted env file and secret-ref
  directory, mounted under the immutable revision directory and parsed by the
  app. Do not merge agent values into process-global environment variables.

The core reads one atomic active-revision pointer when deriving a new trusted
host scope; it never mutates an already-admitted request's scope. Ingress has a
static trusted hop to the same core process, so additive publication needs no
upstream cutover. The proof starts a request on binding 1, atomically adds
binding 4, and shows the existing request and reconnect continue in the same
process while binding 4 becomes available. No disconnected-producer retirement
claim is made.

## 3. Canonical inputs

### 3.1 Desired host plan

`D1HostPlanV1` is strict, versioned input:

```ts
interface D1HostPlanV1 {
  schemaVersion: 1
  hostId: string
  expectedHostRevision: string | null
  hostAppImageDigest: `sha256:${string}`
  runtimeProfileRef: string
  databaseRef: string
  workspaceRootPolicyRef: string
  sessionRootPolicyRef: string
  bindings: D1SiteBindingV1[]
}

interface D1SiteBindingV1 {
  bindingId: string
  hostname: string
  workspaceId: string
  defaultDeploymentId: string
  bundleRef: string
  deploymentRef: string
  workspaceAllocationRef: string
  sessionAllocationRef: string
  ownerPrincipalRef: string
  landing: { title: string; summary: string; ctaLabel?: string }
  environmentRef: string
  secretRefs: string[]
}
```

`operatorRef`, readiness, timestamps, container ids, ports, resolved secret
versions, and health are not desired inputs. The CLI records the OS principal
(`uid`, effective user, invocation id) plus an optional operator note in the
audit record; neither is accepted as authorization material.

Hostname parsing accepts a lower-case ASCII exact DNS name with no wildcard,
scheme, path, userinfo, port, trailing dot, or ambiguous Unicode. D1 must never
use `trustProxy: true`: its startup configuration names an exact trusted proxy
CIDR and bounded hop count. An absent policy disables proxy trust. Only the Fly
configuration in `apps/full-app/fly.toml` and the self-host configuration in
`config/self-host/deploy.full-app.yml.template` (mirrored by
`config/self-host/full-app.env.template`) may use the explicit temporary
`legacy-unsafe` compatibility sentinel until their adjacent peer and forwarded
chain are measured. Every other path remains absent/null and therefore false;
the sentinel is not available when `BORING_D1_HOST_ID` is set. The server accepts
a forwarded host only when the
direct peer and chain length match, rejects multiple/ambiguous forwarded-host
values, and otherwise uses the direct authority. Ingress strips inbound
forwarding headers before emitting one canonical value. The app still matches
it to the active revision map. Unknown, duplicate, or mismatched hosts fail
before auth.

`workspaceRootPolicyRef` and `sessionRootPolicyRef` identify host-approved base
root policies: each resolves to one canonical parent path plus its ownership and
mount rules. The two approved parents must be distinct and non-overlapping.
Each binding allocation ref resolves to one concrete durable child under the
matching approved parent. Allocation roots across all bindings and both kinds
must be distinct, non-nested, and non-symlink-aliased; each allocation belongs
only to its matching root policy. The plan contains opaque refs, not paths.

Before effects, plan validation rejects duplicate binding ids, hostnames,
workspace ids, deployment ids, or default bindings; an allocation outside its
approved parent; equal, nested, or symlink-aliased allocation roots; secret
values; missing refs; and an unknown runtime profile ref. The host resolves
`runtimeProfileRef` from its approved immutable profile store and verifies its
content digest plus sibling filesystem/process-denial attestation. The plan
cannot self-assert an isolation literal. Root/profile refs are opaque plan
identities resolved by the local host adapter; public output never contains raw
host paths.

### 3.2 Canonical workspace-composition identity

D1 owns one producer, `createWorkspaceCompositionSnapshot`, beside the full-app
host composition. It receives concrete values already selected for one
workspace and returns a frozen `WorkspaceCompositionSnapshotV1` plus its
canonical SHA-256 digest. P6-R consumes that digest; callers cannot supply an
arbitrary digest.

The snapshot contains, sorted by stable id:

- schema/domain version and workspace id;
- runtime-profile ref plus host-resolved immutable profile/version/content digest,
  isolation-attestation digest, and redacted root policy refs;
- host-app image digest;
- explicit server/plugin contribution ids, versions, and content digests from
  `createFullAppServerPlugins` and `defaultPluginPackages`;
- static system-prompt input digest;
- final activated capability, tool, skill, and MCP-server inventories where the
  current host has a trustworthy enumerator;
- provisioning contribution ids/versions and governance filesystem-binding
  ids/policies, excluding handles and paths;
- explicit external-plugin and plugin-authoring policy booleans.

It excludes functions, object identity, order of discovery, filesystem paths,
raw prompts, secret values, health, timestamps, process/container ids, and
other observations. Canonical JSON uses fixed keys and lexically sorted arrays;
duplicate inventory ids fail. Every contribution must expose a stable
descriptor at the current host composition seam. Current capability, skill, and
MCP inventories are incomplete: D1-001 must not invent them. An undescribed
contribution or non-empty requirement whose trustworthy inventory is unavailable
fails closed; D1 must not hash `Function#toString`, package paths, or a caller
label.

Before digest production, D1 compares `capabilityRequirements`, `toolRefs`,
`skillRefs`, and `mcpServerRefs` from the verified definition against the final
activated inventories. Requirements grant nothing. A missing item throws
`AGENT_COMPOSITION_REQUIREMENT_UNSATISFIED` with only redacted
`{ definitionId, field, ref }` details. D1 then passes the resulting digest,
workspace id, and configured default deployment id to one P6-R call. The
resolved digest is recorded in the candidate snapshot.

## 4. Revision model

Host state lives under one root-owned directory outside the app container:

```txt
/var/lib/boring/d1/<hostId>/
  active                         # atomic pointer: revision id + digest
  revisions/<revisionId>/
    desired.json                 # canonical redacted plan
    desired.sha256
    bindings/<bindingId>.env     # non-secret, one binding per file
    secret-refs.json             # identities only, no values
    resolved.json                # N P6-R identities/digests, no handles
    observed.json                # redacted readiness for this attempt
    completion.json              # COMPLETE record and completion digest
  audit.jsonl
```

Admission state is deliberately not part of an immutable revision. The same
external database selected by `databaseRef` owns a durable
`d1_binding_admissions` ledger keyed by `(hostId, bindingId)`, with a database-
allocated monotonic sequence, `activeRevision`, and server timestamp. The core
has insert/read access; the OS-authorized CLI has read access for diff and
rollback validation. D1 exposes no update/delete operation, and migrations,
backups, and host recovery preserve the table independently of revision cleanup.

`desired.json`, binding env files, `secret-refs.json`, `resolved.json`, and
`completion.json` become immutable before publication. Revisions store secret
refs only. The root-owned adapter materializes raw mode-0400 values in external
tmpfs under `/run/boring/d1/`; values never enter the revision tree, JSON, logs,
plan output, Compose output, or git. Their values are excluded from desired and
completion digests; secret ref identity is included. Boot and rollback resolve
refs afresh and record only a redacted version/fingerprint observation. A
changed value behind an unchanged secret ref is a
runtime replacement in D1-S1 and returns
`D1_ACTIVE_BINDING_RESTART_REQUIRED`; it is never mistaken for an idempotent
no-op.

The CLI holds one non-stealable OS file lock for the entire mutation. It checks
`expectedHostRevision` against the active pointer while holding the lock. A
different value fails before materialization. It writes a new revision in a
temporary sibling directory, fsyncs files/directories, renames it into
`revisions/`, and records observed readiness. For an active host it proves the
candidate is additive: all admitted bindings retain identical runtime,
composition, root, deployment, and secret identities. Only after every retained
and new binding reports ready does it append the COMPLETE record and atomically
replace `active`. Failed candidates remain inspectable with no COMPLETE record,
are never selected by the host map, and may be removed only by an explicit
cleanup command.

Desired state and observed state never share a digest. `desiredStateDigest`
covers the complete redacted plan, composition snapshots, and N P6-R results.
`completionDigest` covers desired digest plus this attempt's redacted observed
attestations. Same desired state is an idempotent no-op only after the CLI
re-resolves all N bindings and reproduces their P6-R digests.

### Rollback

`rollback --to <completeRevision> --expected <activeRevision>` loads the prior
COMPLETE desired snapshot, re-resolves secret refs and all N P6-R calls, and
materializes it as a **new** monotonically allocated revision. It never changes
the active pointer to the old revision id and never replays old observations.
An online rollback may remove only bindings introduced after the target for
which no durable admission row exists; it may also restore landing-only fields.
Before the first agent effect for a binding, the core commits an idempotent
insert into `d1_binding_admissions`; the unique key makes concurrent first
requests converge on one database-allocated sequence. The effect proceeds only
after that transaction commits. A database error fails closed. The row is never
updated or cleared. At boot and before every destructive diff, the core/CLI
reloads the ledger from the database rather than trusting cached readiness or
revision files. A single accepted request therefore makes the binding
non-removable online forever, even if its connection closed. Other runtime/
composition/root/deployment/secret
replacement fails `D1_ACTIVE_BINDING_RESTART_REQUIRED`. A full runtime rollback
therefore requires an explicit maintenance-window stop and reapply in D1-S1.

Every permitted removal also requires `--confirm-remove <bindingId>` for the
exact sorted set. Extra, missing, or stale confirmations fail. CAS is not
destructive consent, and confirmation never bypasses the admission/restart
guard.

## 5. Publication state machine

Only this finite command flow exists; there is no background reconciler:

1. acquire host lock and authenticate through OS permissions;
2. parse the complete plan, normalize hosts/refs, verify expected revision and
   destructive confirmations;
3. build each canonical composition snapshot, validate definition requirements,
   and execute N independent P6-R calls;
4. write one immutable candidate revision and materialize secret refs;
5. on initial boot only, run backward-compatible migrations and idempotent
   `docker compose up -d`; on an active host, prove the additive/landing-only
   diff and reject every replacement before publication;
6. write the candidate revision id/digest to the root-owned atomic pending
   pointer under `/run/boring/d1/`, then send the core process its dedicated
   preload signal; the process reads only that fixed pointer/revision root,
   instantiates/verifies every new logical binding, and writes an all-binding
   readiness ack without changing the active host map;
7. write COMPLETE, atomically replace the active revision pointer, and verify
   the new hostname map while an already-admitted request on a retained binding
   completes in the same process;
8. append the redacted operator/revision audit result and release the lock.

Pre-publication failure retains only the inactive candidate files and leaves the
prior active pointer unchanged. Failure after pointer publication completes
forward by recording audit/recovery state; it never silently switches backward.
No Compose service is restarted during an online additive publication.

Candidate preload is not HTTP and is not a general mutation protocol. Only the
root-owned CLI can atomically write `{ schemaVersion, revisionId,
desiredDigest }` to the fixed pending pointer and signal the core PID. The
payload accepts no path or caller binding. The core cross-checks the fixed-root
immutable files/digest and writes a revision-scoped ack. A failed preload
discards candidate logical bindings and cannot alter the active pointer.
Ordinary app credentials and members cannot trigger it; the HTTP route table
contains no deployment mutation endpoint.

The loopback/internal readiness surface reports active revision id, desired
digest, and binding readiness only. The separate durable admission row commits
before the first agent effect and is used only to forbid online removal; it is
not an in-flight/producer lease. Neither surface contains secrets, raw paths,
owner identities, instructions, or tool content.

## 6. Bound-host workspace fences

The active site binding becomes a server-derived `D1WorkspaceScope` only after
trusted host parsing. It contains `{ bindingId, workspaceId,
defaultDeploymentId, activeRevision }` and is never built from request
workspace/agent fields.

The first D1 delivery stack must fence these current seams:

- `packages/core/src/server/routes/workspaces.ts`: on a bound host, list only
  the bound workspace after membership; do not call default auto-provision;
  reject create, foreign detail/update, and ordinary delete;
- `packages/core/src/server/auth/postSignupHook.ts`: without an accepted invite,
  do not create a personal default workspace under bound-host signup;
- `packages/core/src/server/routes/members.ts` and account deletion ownership
  paths: do not orphan/delete/transfer the D1-managed workspace outside the
  local operator lifecycle;
- `packages/core/src/app/server/createCoreWorkspaceAgentServer.ts` and
  `apps/full-app/src/server/main.ts`: inject the trusted scope and configured
  default deployment into existing route/runtime composition;
- full-app MCP, agent, plugin-front/runtime, pane-status, and WorkspaceBridge
  workspace selectors: intersect any path/query/body/header/token workspace id
  with the same scope before lookup or effects.

Membership checks remain existing core checks. A member of another workspace
does not gain the bound workspace. A non-member sees a generic denial before
default creation, provisioning, workspace lookup detail, or agent resolution.
The front may hide create/switch/delete, but server fences are acceptance.

## 7. Stable failures

The D1 implementation adds one typed host error carrying these stable codes:

| Code | Meaning |
| --- | --- |
| `D1_PLAN_INVALID` | schema, hostname, ref, duplicate, or root-overlap failure |
| `D1_HOST_SCOPE_VIOLATION` | untrusted/unknown host or cross-binding selector |
| `D1_RUNTIME_PROFILE_UNAPPROVED` | shared-host isolation proof is absent |
| `D1_REVISION_CONFLICT` | expected active revision or host lock is stale/busy |
| `D1_DESTRUCTIVE_CONFIRMATION_REQUIRED` | exact removal set was not confirmed |
| `D1_SECRET_UNAVAILABLE` | a named secret ref cannot be securely materialized |
| `AGENT_COMPOSITION_REQUIREMENT_UNSATISFIED` | final activation lacks a declared ref |
| `D1_COLLECTION_NOT_READY` | any binding/host readiness check failed, including a conflicting D1 edge network (`field: edgeNetwork`) |
| `D1_PUBLICATION_FAILED` | atomic ingress/pointer publication failed |
| `D1_ROLLBACK_TARGET_INVALID` | target is absent, incomplete, or fails reproduction |
| `D1_MANAGED_WORKSPACE_MUTATION_FORBIDDEN` | app/user lifecycle tried to mutate a managed binding |
| `D1_ACTIVE_BINDING_RESTART_REQUIRED` | an online revision replaces/removes an admitted runtime binding or rotates its runtime inputs |
| `D1_BINDING_ADMITTED` | rollback tried to remove a binding with a durable admission row |
| `D1_ADMISSION_RECORD_FAILED` | the durable admission row did not commit before the first agent effect |

Errors expose no raw paths, secret values, landing-private metadata, or foreign
workspace/deployment ids. Tests assert codes, not messages.

## 8. Implementation beads

The user-facing D1-S1 vertical slice is the ordered stack D1-001 through
D1-006. Each PR stays dark/additive until its own acceptance; no PR claims the
three-agent exit early. P2/P5a do not gate any bead.

**§8 budgets are planning estimates; landed beads supersede their rows.**
D1-001 through D1-003 are LANDED (ancestry-verified against `origin/main`):
D1-001 shipped as [#652](https://github.com/hachej/boring-ui/pull/652);
D1-002 shipped as multiple PRs — codec
([#653](https://github.com/hachej/boring-ui/pull/653)), store
([#654](https://github.com/hachej/boring-ui/pull/654)), persistence
([#660](https://github.com/hachej/boring-ui/pull/660)), command-engine
([#662](https://github.com/hachej/boring-ui/pull/662)), and the locked
revision command boundary/CLI
([#665](https://github.com/hachej/boring-ui/pull/665)) — with the CLI files
named `d1Command.ts`, `d1CommandCliProtocol.ts`, and `d1CommandEntry.ts` (not
`cli.ts` as originally specced below). D1-003 shipped as the Compose topology
([#667](https://github.com/hachej/boring-ui/pull/667)), core file-secret input
([#672](https://github.com/hachej/boring-ui/pull/672)), deterministic binding
environment and permissions ([#675](https://github.com/hachej/boring-ui/pull/675),
[#676](https://github.com/hachej/boring-ui/pull/676)), secure tmpfs
materialization ([#677](https://github.com/hachej/boring-ui/pull/677)), fixed
file runtime-input provider ([#678](https://github.com/hachej/boring-ui/pull/678)),
production/Compose wiring ([#679](https://github.com/hachej/boring-ui/pull/679)),
and the real Docker UID/DAC proof
([#680](https://github.com/hachej/boring-ui/pull/680)). D1-004a1 is active;
D1-004a2 through D1-006 remain un-landed.

### D1-001 — plan and composition identity (<= 400 net lines; 25 minutes)

Files: new `apps/full-app/src/server/deployment/d1Plan.ts`,
`workspaceComposition.ts`, and focused tests; minimal descriptor exports from
`apps/full-app/src/server/plugins.ts` and host composition wiring only.

Deliver: strict plan validation, canonical redacted composition snapshot/digest,
final requirement inventory validation, and exact stable errors. Prove sort
stability, secret/path exclusion, digest sensitivity, unknown inventory refusal,
and two workspaces producing independent P6-R inputs. No filesystem mutation,
Compose, routing, or CLI yet.

### D1-002 — immutable revision store and local CLI (<= 400 net lines; 25 minutes)

Files: new `apps/full-app/src/server/deployment/hostRevisionStore.ts`,
`apps/full-app/src/server/deployment/cli.ts`, tests, and one private script entry
in `apps/full-app/package.json`.

Deliver: plan/apply dry-run, OS lock, expected-revision CAS, immutable candidate/
COMPLETE records, atomic pointer, audit, exact destructive confirmation, and
rollback-as-new-revision using injected materialize/readiness/publish adapters.
Prove concurrency, pre/post-publication fault boundaries, idempotence, and no
secret/path output. No HTTP management route.

### D1-003 — stable-process Compose adapter (<= 400 net lines; 25 minutes)

Files: new `deploy/d1/compose.yml`, `deploy/d1/collection.example.json`,
`apps/full-app/src/server/deployment/composeAdapter.ts`, and focused tests. Raw
secret files and generated revision material stay outside the checkout; secret
values exist only in the external tmpfs materialization root.

Deliver: one ingress plus one full-collection core process; pinned image,
external `databaseRef`, durable workspace/session roots, per-binding env plus
external tmpfs secret inputs; `up -d` and maintenance-only service-specific
`--no-deps`. Prove additive publication does not invoke Compose, no database
service is created, and generated commands never contain `--force-recreate`,
blanket rollback, secret values, or source-checkout mounts.

### D1-004a1 — explicit proxy policy (<= 400 net lines; 25 minutes)

Files: surgical trusted-proxy configuration in
`packages/core/src/server/app/createCoreApp.ts`, config schema/load/shared types,
the two named legacy production configurations, deterministic D1 edge-network
wiring in `deploy/d1/compose.yml`, a narrow
`apps/full-app/src/server/deployment/edgeNetworkPreflight.ts` module wired before
the first command in `composeAdapter.ts`, and focused tests.

Deliver: D1 startup fails closed without an exact ingress CIDR plus bounded hop
count (never `trustProxy: true` or broad private ranges), and a deterministic
one-ingress network. An absent or explicit null policy disables proxy trust.
Only the two inventoried non-D1 production configurations receive a conspicuous
temporary `legacy-unsafe` opt-in pending a measured peer-chain migration. Every
other path keeps proxy trust disabled. Before
the first Compose apply, reject overlap between the fixed D1 edge subnet and
non-default host routes or foreign Docker networks; reuse an exact existing D1
project network only when its subnet, gateway, and ownership match. Map any
conflict to `D1_COLLECTION_NOT_READY` with redacted `field: edgeNetwork`. RFC
`Forwarded` remains rejected; a later
`X-Forwarded-Host` value is usable only from this exact trusted peer/chain after
the ingress replacement behavior is proven.

### D1-004a2 — mounted active-collection reader (<= 400 net lines; 25 minutes)

Files: new `apps/full-app/src/server/deployment/activeCollectionReader.ts` and
focused tests.

Deliver: read-only, exact-DAC validation of the mounted host `active` pointer
and COMPLETE revision through existing codecs. No mutation-store reuse, cache,
watcher, P6-R call, or secret-value read.

### D1-004a3 — trusted host scope (<= 400 net lines; 25 minutes)

Files: new `deployment/hostSurface.ts`, one optional core request-scope contract,
focused tests, and minimal pre-auth server wiring.

Deliver: normalize one direct authority or one canonical `X-Forwarded-Host`
from the exact trusted peer/chain against the active site map and attach
`D1WorkspaceScope` before authentication. Reject RFC `Forwarded`, duplicate or
ambiguous forwarded-host values, and every untrusted forwarded host; hostname
grants nothing. Membership/CRUD enforcement remains D1-004b.

### D1-004a4 — landing and readiness wiring (<= 400 net lines; 25 minutes)

Files: bounded landing renderer, loopback readiness, minimal `main.ts` wiring,
and a narrow optional core root-handler seam.

Deliver: escaped landing copy, fixed same-origin auth return, and redacted
loopback-only readiness. No membership handoff, arbitrary HTML, open redirect,
or workspace/deployment identifiers in public output.

### D1-004b — workspace authority fences (<= 400 net lines; 30 minutes)

Files: one shared optional scope contract in core app server types; surgical
updates/tests in `workspaces.ts`, `postSignupHook.ts`, managed-workspace
membership/account-deletion paths.

Deliver: member-only bound list; create/foreign switch/delete/default auto-
provision denial; operator-owned managed lifecycle. Preserve generic-host
behavior byte-for-byte at the public contract.

### D1-004c — remaining selector conformance (<= 400 net lines per PR; 25 minutes)

Inventory full-app agent/MCP/plugin/pane/WorkspaceBridge selectors first. Split
one PR per route family if the diff exceeds the budget. Every selector rejects
a foreign caller value before lookup/effects and derives default deployment
from scope. Do not introduce a generic policy framework.

### D1-004d — durable admission ledger (<= 300 net lines; 20 minutes)

Files: one new core Drizzle migration plus the matching export in
`packages/core/src/server/db/schema.ts`; new
`apps/full-app/src/server/deployment/admissionLedger.ts`; focused schema/store
tests; and a narrow first-effect hook through the D1 host scope.

Deliver: insert/read-only `(hostId, bindingId)` admission rows with a database-
allocated monotonic sequence; transaction commit before the first agent effect;
idempotent concurrent admission; restart recovery and CLI destructive-diff
reads from the database; no update/delete API. Prove a failed commit produces
`D1_ADMISSION_RECORD_FAILED` and no agent effect, and an admitted binding remains
non-removable after process restart and revision-directory cleanup.

### D1-005 — collection boot and atomic publication (<= 400 net lines; 30 minutes)

Files: new `apps/full-app/src/server/deployment/{bootCollection,preloadSignal}.ts`,
integrate the D1-001/002/003/004 seams in `main.ts`, and focused integration
tests. The fixed pending-pointer/signal handler is the only local candidate-
activation seam.

Deliver: read one immutable revision, perform N independent P6-R calls, preload
all logical bindings through the root-owned pending pointer and signal, wait for
its all-ready ack, and atomically publish an additive/landing-only pointer in the stable
process. Prove invalid pending payload/path/digest and one failed binding leave the old
collection active, a running request and reconnect survive N+1 publication in
the same process, and replacement/removal/secret rotation rejects before effects.

### D1-006 — EU-host proof and runbook (<= 300 net lines; 20 minutes)

Files: `docs/issues/391/runtime-refactor/work/D1-tenant-provisioning/RUNBOOK.md`,
a narrow proof script under `scripts/`, and the generated `golden-path.json`
evidence path already assigned to P8 (do not duplicate its version contract).

Deliver: boot/add-agent/apply/rollback/cleanup commands and a documented
maintenance-restart boundary for every runtime/secret replacement. Reproduce
the landed pre-apply edge-network overlap guard on the EU host, including
idempotent reuse of the exact owned D1 project network;
three distinct agents/workspaces/hostnames in one EU deployment; three
independent P6-R digests; setup-to-first-success timing and per-stage breakdown;
idempotent additive apply; N+1 continuity; exact rollback as a new revision;
cross-host/workspace and sibling filesystem/process denial; secret canary;
dedicated-VM configuration render. Record actual commands and redacted results.

## 9. D1-S1 acceptance

D1-S1 is complete only when all of the following are CI- or EU-host-provable:

1. Three distinct verified bundles resolve through three independent P6-R calls
   and run in one core process/host revision, each as its workspace default.
2. Three exact hostnames serve distinct bounded landings; hostname alone grants
   no data or workspace authority.
3. Existing-member auth reaches only the configured workspace; non-members and
   cross-binding selectors fail before effects; generic-host behavior remains.
4. Apply N+1 adds a fourth binding while an admitted request on binding 1
   completes and reconnects in the same process; retained binding identities
   are byte-identical and no Compose service restarts.
5. Binding replacement, admitted-binding removal, and secret/runtime/root
   rotation reject before effects with stable restart/admission codes. Compose
   uses no force-recreate or blanket rollback.
6. Rollback creates N+2 from a prior COMPLETE full snapshot, removes only the
   unadmitted fourth binding with exact confirmation, reproduces the prior
   desired/composition/P6-R digests, and records fresh observations. A
   maintenance-window full runtime rollback is documented, not claimed online.
7. Stale CAS, duplicate bindings, root overlap, proxy confusion, unavailable
   secret, unsatisfied definition requirement, partial readiness, and active
   binding replacement/removal fail with their stable codes.
8. No secret value/raw host path appears in git, JSON snapshots, Compose
   rendering, logs, errors, or audit. Workspace and session roots are durable
   siblings, not container home/root.
9. The shared runtime profile proves sibling filesystem and process denial.
   D1-001 through D1-005 do not wait for a provider lock, but D1-006 cannot
   claim the EU production exit until one host-approved EU profile supplies
   the required real lifecycle/security evidence. The real runsc structural
   preflight passed; the privileged execution decision and remaining security
   proofs still block the runsc production lock unless another approved EU
   profile satisfies the same proof.
10. The golden path records wall-clock setup-to-first-agent success and stages;
    the 15-minute figure remains a measured target, not an assertion.

## 10. Non-goals and stop signs

Stop and re-review if implementation adds a per-agent container, provisioning
service, registry daemon, watcher, queue, scheduler, retry framework, secrets
backend, Kubernetes/Terraform layer, wildcard host/tenant API, app management
route, cross-host fleet control, or P6 generation store. D2 owns runtime tenant
lifecycle/control-plane work. P2 owns later provider extraction. P5a receives a
narrow follow-up only if a real D1 secret/readiness gap remains after D1-001.
