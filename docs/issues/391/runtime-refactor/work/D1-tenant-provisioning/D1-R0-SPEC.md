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
- initial boot is the D1-005b stopped create/inspect then exact-id start protocol
  for migration, core, and ingress; additive revisions do not invoke Compose;
- use service-specific `up -d --no-deps` only for an explicit maintenance-window
  restart after fresh attestation;
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
Before the first effect-bearing operation for a binding, the core commits an
idempotent insert into `d1_binding_admissions`; the unique key makes concurrent
first-effect admissions converge on one database-allocated sequence. The effect proceeds only
after that transaction commits. A database error fails closed. The row is never
updated or cleared. At boot and before every destructive diff, the core/CLI
reloads the ledger from the database rather than trusting cached readiness or
revision files. A single accepted D1-004d2 mutation or D1-004d3 direct operation
therefore makes the binding non-removable online forever, even if its connection
closed. D1-004d2 service/facade read/list/subscribe and cache population,
D1-004d3 token refresh, and D1-005c preload/all-ready do not admit; every
D1-004d3 direct operation still admits, including a read-like operation. Other
runtime/composition/root/deployment/secret
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
before a D1-004d2 mutation or any D1-004d3 direct operation and is used only to
forbid online removal; it is
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
| `D1_ADMISSION_RECORD_FAILED` | the durable admission row did not commit before a D1-004d2 mutation or D1-004d3 direct operation |
| `D1_ROLLBACK_JOURNAL_FAILED` | rollback journal/pointer state is invalid or cannot be recovered/finalized |

Errors expose no raw paths, secret values, landing-private metadata, or foreign
workspace/deployment ids. Tests assert codes, not messages.

## 8. Implementation beads

The user-facing D1-S1 vertical slice is the ordered stack D1-001 through
D1-006. Each PR stays dark/additive until its own acceptance; no PR claims the
three-agent exit early. P2/P5a do not gate any bead.

**§8 budgets are planning estimates; landed beads supersede their rows.**
D1-001 through D1-004a1 are LANDED (ancestry-verified against `origin/main`):
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
([#680](https://github.com/hachej/boring-ui/pull/680)). D1-004a1 shipped the
explicit proxy policy, secure generic default, deterministic edge network, and
pre-effect overlap guard
([#684](https://github.com/hachej/boring-ui/pull/684)). D1-004a2 shipped the
mounted exact-DAC active-collection reader
([#685](https://github.com/hachej/boring-ui/pull/685)). D1-004a3a landed the
canonical ingress artifact and real-Docker header proof
([#690](https://github.com/hachej/boring-ui/pull/690)). D1-004a3b landed exact
raw-header authority and trusted-hop scope enforcement
([#692](https://github.com/hachej/boring-ui/pull/692)). D1-004a4a landed the
bounded landing/root seam ([#694](https://github.com/hachej/boring-ui/pull/694));
D1-004a4b landed readiness and production activation
([#695](https://github.com/hachej/boring-ui/pull/695)). D1-004b1 landed the
workspace/signup authority fences ([#698](https://github.com/hachej/boring-ui/pull/698)).
D1-004b2a/b2b landed the atomic owner guards
([#700](https://github.com/hachej/boring-ui/pull/700),
[#701](https://github.com/hachej/boring-ui/pull/701)). D1-004c1-c5 landed the
complete static selector fence
([#704](https://github.com/hachej/boring-ui/pull/704),
[#705](https://github.com/hachej/boring-ui/pull/705),
[#708](https://github.com/hachej/boring-ui/pull/708),
[#711](https://github.com/hachej/boring-ui/pull/711),
[#713](https://github.com/hachej/boring-ui/pull/713)). D1-004d1/d2/d3,
D1-004e, D1-005a/005b/005c, and D1-006 remain un-landed.

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
`Forwarded` remains ineligible as D1 authority; D1-004a3a adds transport
stripping and canonical XFH emission. A later
`X-Forwarded-Host` value is usable only from this exact trusted peer/chain after
the ingress replacement behavior is proven.

### D1-004a2 — mounted active-collection reader (<= 400 net lines; 25 minutes)

Files: new `apps/full-app/src/server/deployment/activeCollectionReader.ts` and
focused tests.

Deliver: read-only, exact-DAC validation of the mounted host `active` pointer
and COMPLETE revision through existing codecs. No mutation-store reuse, cache,
watcher, P6-R call, or secret-value read.

### D1-004a3a — canonical ingress artifact and proof (<= 400 net lines; 25 minutes)

Files: repo-owned `deploy/d1/Caddyfile`; its read-only mount and exact command in
`deploy/d1/compose.yml`; one approved `caddy@sha256:...` constant enforced by
`composeAdapter.ts`; `apps/full-app/package.json`; focused adapter/topology/proof
tests; and a narrow real-Docker echo proof under `apps/full-app/scripts/` that
imports the same approved image identity.

Deliver: the exact approved production image is
`caddy@sha256:af5fdcd76f2db5e4e974ee92f96ee8c0fc3edb55bd4ba5032547cbf3f65e486d`;
another repository or digest fails before effects. Compose executes
`["caddy","run","--config","/etc/caddy/Caddyfile","--adapter","caddyfile"]`
explicitly because that image has no entrypoint. Strip every RFC `Forwarded`
value and replace every absent, hostile, repeated, or comma-joined inbound
`X-Forwarded-Host` with exactly one raw header value derived from the original
direct authority before proxying. Prove Forwarded absent/single/empty/repeated/
comma cases all produce backend absence, and prove backend raw XFH cardinality/
value for absent/hostile/repeated/comma cases through the read-only mounted
config and exact image. Until this proof lands, no D1 host scope may consume
forwarded authority; direct authority is the only eligible future D1 input.
Direct-only mode does not complete D1-004a3. `D1_HOST_SCOPE_VIOLATION` remains
owned by D1-004a3b, not the ingress artifact.

### D1-004a3b — trusted host scope (<= 400 net lines; 25 minutes)

Files: new `deployment/hostSurface.ts`, one optional core request-scope contract,
focused tests, and minimal pre-auth server wiring.

Deliver: normalize one direct authority or one canonical `X-Forwarded-Host`
from the exact trusted peer/chain against the active site map and attach
`D1WorkspaceScope` before authentication. Reject RFC `Forwarded`, duplicate or
ambiguous forwarded-host values, and every untrusted forwarded host; hostname
grants nothing. Membership and workspace CRUD enforcement remain D1-004b1;
atomic member and account guards remain D1-004b2a/b2b.

### D1-004a4a — landing and root seam (<= 400 net lines; 25 minutes)

Files: bounded landing renderer, focused tests, and a narrow optional core
root-handler seam. No production activation in this bead.

Deliver: known bound unauthenticated `GET /` renders only revalidated and
escaped landing title/summary/optional CTA, with a fixed same-origin
`/auth/signin?redirect=%2F` target and `cache-control: no-store`. Authenticated
root delegates byte-for-byte to the existing SPA shell. Re-read the active
collection and require the request scope revision plus binding/workspace/default
deployment tuple to match before rendering. Drift/read failure returns only
redacted `D1_COLLECTION_NOT_READY`. No arbitrary HTML, request-derived URL,
membership handoff, or public internal identifier.

### D1-004a4b — readiness and production activation (<= 400 net lines; 25 minutes)

Files: D1 server wiring/readiness modules, small host-scope/core type changes,
literal-IPv4 health probe in `deploy/d1/compose.yml` plus topology proof,
minimal `main.ts` wiring, and focused tests.

Deliver: when `BORING_D1_HOST_ID` is present, fail before other effects unless
`BORING_D1_OWNER_UID`, process identity `10001:10001`, and the exact D1 proxy
policy are valid; require the publication owner UID to differ from the app UID;
read `BORING_D1_OWNER_UID` from the existing process-level
`/etc/boring/d1/core.env` handoff;
construct one reader rooted at fixed
`/var/lib/boring/d1/<hostId>` using the owner UID and effective app GID; reuse it
for host scope, landing, and readiness. Only raw socket `127.0.0.1` may bypass
scope for exact `GET /health` and `GET /internal/d1/readiness`; query/encoded/
other-method/remote/forwarded variants fail closed. Readiness returns only
active revision, desired digest, and sorted binding-id readiness, or redacted
`D1_COLLECTION_NOT_READY`. Compose must probe literal
`http://127.0.0.1:3000/health`; prove it succeeds before an active collection
while readiness remains redacted 503. Generic mode stays byte-for-byte
unchanged. No membership handoff, Compose publication, or runsc decision.

### D1-004b1 — workspace authority and signup fences (<= 400 net lines; 30 minutes)

Files: one narrow request-workspace helper; surgical updates/tests in
`workspaces.ts`, `requireWorkspaceMember.ts`, `postSignupHook.ts`, auth proxy/
composition, and stable errors.

Deliver: under optional trusted request scope, reject a foreign or malformed
workspace path as generic 421 before store/effects; authorize membership before
workspace lookup; list exactly the one bound workspace; deny create and bound
delete before validation/effects; never auto-provision a default workspace.
Propagate the already-resolved request workspace into Better Auth/post-signup
through one reserved internal header: delete every caller-supplied value at the
auth proxy boundary, then install only a canonical encoding of the trusted
scope. Prove spoofed and direct-auth variants cannot synthesize scope. This
bead changes post-signup invite handling only; public invite resolve/accept
selectors remain D1-004c1-owned. Post-signup accepts an invite only
for the exact bound workspace. A scoped foreign or invalid invite sets the
existing non-enumerating `boring_invite_failed=invite_not_found` cookie and
creates no default workspace; generic invalid-invite behavior remains the
existing failure cookie plus default creation. PUT rename and generic-host
behavior remain unchanged. No schema/store change or policy framework.

### D1-004b2a — atomic managed-member mutations (<= 300 net lines; 30 minutes)

Files: `packages/core/src/server/app/types.ts`; Local/Postgres workspace stores;
`members.ts`; focused route/store/conformance tests.

Deliver: under trusted request scope, add a member through an atomic create-if-
absent operation, never a read-then-upsert that can overwrite a concurrently
created owner. Scoped role update and removal pass one explicit store precondition
evaluated under the same target-membership lock/transaction as the mutation. If
the target's current committed role at the mutation linearization point is
`owner`, demotion/removal returns
`D1_MANAGED_WORKSPACE_MUTATION_FORBIDDEN` with zero mutation. Do not use a route
pre-read as authority. Preserve owner addition/promotion, editor/viewer role
changes/removal, and generic-host store/route behavior when the precondition is
absent. Prove controlled PostgreSQL interleavings in both orders plus Local-store
sequential conformance. No mutex, route SQL, schema/migration, fault hook, or
policy framework.

### D1-004b2b — atomic managed-owner account deletion guard (<= 250 net lines; 25 minutes)

Files: `deleteUserCompletely.ts`, the core account route, and their focused
transaction/route tests.

Deliver: pass only the trusted scoped workspace id into `deleteUserCompletely`.
Inside its existing serializable retry transaction and before deletion/transfer,
lock the user and scoped membership rows, then evaluate the current committed
role. If it is `owner`, abort with
`D1_MANAGED_WORKSPACE_MUTATION_FORBIDDEN`; perform no user/member/workspace/ledger
mutation and no sign-out. Preserve scoped non-owner deletion of only that
member's data/membership and generic deletion exactly. Prove controlled owner-
insert/promotion versus deletion interleavings in both lock orders and existing
serializable retry behavior. No mutex, route SQL, schema/migration, or generic
lifecycle/policy abstraction. Operator lifecycle remains the local OS-authorized
D1 command path.

### D1-004c1 — public invite scope — LANDED #704

Files: core legacy/public invite routes and focused tests.

Deliver: legacy workspace-id accept paths compare the path workspace with trusted
request scope before token lookup. Public token-only resolve/accept may perform
exactly one read-only token-hash lookup because workspace scope is otherwise
unknowable; compare the resolved invite workspace immediately. A foreign invite
returns the same non-enumerating `404/invite_not_found` response as an unknown
token, not a distinguishable D1 421, before locked/expired/accepted checks,
failed-attempt/reset counters, workspace/member reads, acceptance mutation, or
success/audit log. Existing IP/principal transport rate accounting may precede the
lookup, but is outside D1 application effects and never keys on or reveals the
discovered workspace. Preserve generic behavior and prove zero foreign invite/
workspace/member mutation.

### D1-004c2 — embedded/browser selector convergence — LANDED #705

Files: the existing core `resolveAuthorizedWorkspaceId` choke point, pane status
route, and focused agent/UI/automation/browser-WorkspaceBridge tests.

Deliver: under trusted scope, collect every presented header/query workspace
selector before precedence. Absent derives the scope; malformed, conflicting,
or foreign values return stable 421 before membership, root/runtime/store,
dispatcher, bridge, or status effects. Pane body workspace must match and is
never silently overwritten. Preserve generic header/query precedence exactly.
This bead owns only browser/header WorkspaceBridge traffic.

### D1-004c3 — Boring MCP scope admission — LANDED #708

Files: Boring MCP binding, full-app wrapper, and focused route tests.

Deliver: preserve the existing global-auth ordering and unauthenticated 401, plus
generic behavior exactly when trusted D1 scope is absent. The four POST action
routes (`connect`, `refresh`, `disconnect`, and `tools`) keep their existing
`@fastify/rate-limit` route limiters. Give `GET /sources` the same route mechanism,
with unscoped requests allowlisted/skipped so generic behavior remains exact. Under
trusted scope, all five route limiters run after successful global auth and before
selector admission. They share the same key helper, use only `request.user.id` plus
frozen `requestScope.workspaceId`, ignore every raw caller selector, and charge
every authenticated valid, malformed, conflicting, foreign, unauthorized, or
nonmember request that reaches them. Scope admission is the first route
`preHandler` after the limiter and uses the same admission helper on all five
routes. Inspect every header/body/query workspace selector: absent derives scope;
malformed, conflicting, or foreign returns stable 421 after transport-budget
consumption but before workspace/member/user-store/source/provider/transport lookup
or mutation. Add no independent/manual D1 limiter and no second budget store. Raw
selectors never key or bypass a budget. Prove all invalid authenticated D1 traffic
is bounded, unauthenticated D1 traffic retains the existing 401, unscoped GET
requests are skipped by the limiter, and generic malformed/unauthenticated/
unauthorized behavior remains exact.

### D1-004c4 — WorkspaceBridge runtime-claim admission — LANDED #711

Files: a two-phase runtime-token verification seam plus one narrow host-supplied
scope-assertion callback in core Bridge options, workspace HTTP runtime/refresh
routes, and focused tests.

Deliver: split runtime-token verification into read-only signature/claims checks
and later registry-definition/capability authorization. Assert host scope on the
verified claims between those phases, before `getRuntime`, registry/idempotency/
refresh-store selection, `recordUse`, handler execution, or mint; only then load
the operation definition and validate required capabilities. Apply the same
claim-first assertion to refresh. Let branded D1 scope errors escape the Bridge
protocol catch so core returns stable HTTP
`421/D1_HOST_SCOPE_VIOLATION`; do not add a Bridge error code or translate to
403. Foreign refresh consumes no refresh-use/rate bucket. Browser/header flow
remains D1-004c2-owned; generic standalone behavior remains exact.

### D1-004c5 — managed-agent MCP configured-target admission — LANDED #713

Files: full-app managed-agent MCP route and focused tests.

Deliver: after bearer authentication but before request storage, controller/app
store, dispatcher, or stream effects, require trusted request scope to equal the
configured workspace or return stable 421. Dispatcher receives the trusted
scope including `defaultDeploymentId`; payload/header cannot retarget workspace,
agent, or deployment. Preserve generic absent-scope deployment exactly. There is
no current caller-controlled `agentId`/`deploymentId` parser; do not invent one.

### D1-004d1 — durable admission ledger and session fence (<= 400 net lines; 30 minutes)

Files: one new core Drizzle migration plus the matching export in
`packages/core/src/server/db/schema.ts`; new
`apps/full-app/src/server/deployment/admissionLedger.ts`; narrow root-CLI
destructive-diff read integration; and focused schema/store/real-Postgres tests.

Deliver: insert/read-only `(hostId, bindingId)` admission rows with a database-
allocated monotonic sequence; idempotent concurrent admission; restart recovery;
and no update/delete API. Export one session-level Postgres advisory fence keyed
by `(hostId, bindingId)` and held on a dedicated physical connection. While the
fence is held, re-read the active collection and require the exact binding,
workspace, and default deployment; the active revision may advance only when
that binding triple remains byte-identical in an additive revision. Then insert
or idempotently read admission in a transaction and commit before returning the
fence result; always release in `finally`, and rely on connection loss to release
an orphaned lock. Every `BEGIN`/`COMMIT`/`ROLLBACK` and advisory lock/unlock
command executes on that same reserved postgres.js handle; do not use pooled
Drizzle or a reserved `.begin()` abstraction that can escape the physical
handle. Failed lock, active recheck, or commit produces
`D1_ADMISSION_RECORD_FAILED` and no caller effect.

D1-004d1 exposes ledger/core/CLI operations only through an injected,
nonserializable `AttestedD1DatabaseConnection`. The production CLI requires that
capability and exact equality between its bound `databaseRef` and the active
plan; absence or mismatch fails closed. Ref-label equality never opens or
attests a production connection. D1-005c is the sole production minter, so core
and CLI remain fail-closed until it lands. This bead adds no provider registry.
An admitted binding remains non-removable after process restart and revision-
directory cleanup.

### D1-004d2 — real agent first-effect admission (<= 400 net lines; 30 minutes)

Files: one shared Pi session-service admission decorator; a surgical
`packages/agent/src/core/createAgent.ts` session-facade delegation; D1 full-app
composition wiring; explicit slash-command and reload admission hooks; and
focused route/composition tests.

Deliver: D1 production wiring invokes D1-004d1 once immediately before real
effect-bearing Pi `createSession`, `deleteSession`, `prompt`, `followUp`,
`clearQueue`, `interrupt`, and `stop` operations, including the agent session-
facade paths, plus slash-command execution and agent reload. Session creation
must admit before any durable session record exists. Slash execution and reload
count as use even if the
underlying handler performs no later model call. The effect proceeds only after
the fence recheck and durable transaction commit. For reload, trusted scope/
binding authorization may run first, but admission must commit before binding
reprovision, `beforeReload`, `reloadSession`, or any other reload-route effect.
Read/list/subscribe paths,
candidate preload/all-ready, and cache population never admit a binding.
Admission results are never cached. Generic composition without trusted D1
scope remains exact. Completeness tests enumerate every current service/facade
mutation so a newly added effect cannot silently bypass the decorator. In
particular, `Agent.sessions.create()` must delegate through the admitted
`runtime.service.createSession` path rather than calling `sessionStore.create`
directly; prove admission commits before the underlying store write. Facade
deletion continues through the admitted service path.

### D1-004d3 — direct WorkspaceBridge operation admission (<= 220 net lines; 20 minutes)

Files: the workspace runtime-operation route's existing two-phase authorization
flow, D1 full-app host callback wiring, and focused completeness/order tests.

Deliver: every direct runtime WorkspaceBridge operation conservatively counts
as use. After verified claims pass host scope and the operation definition passes
capability authorization, but before idempotency, runtime/store selection, or
handler execution, invoke D1-004d1 and require durable commit. Token refresh is
not an operation and creates no admission row. Prove every current direct
operation passes this one hook, failures have zero downstream effects, and no
second route-local ledger/cache exists.

### D1-004e — recoverable unused-binding rollback fence (<= 350 net lines; 30 minutes)

Files: one append-only rollback-journal migration plus schema export; the stable
error enum/type in `apps/full-app/src/server/deployment/d1Plan.ts`; new
`apps/full-app/src/server/deployment/admissionRollbackJournal.ts`; narrow root-
command integration; focused real-Postgres and pointer-recovery tests.

Deliver: after D1-004d1/d2/d3, rollback derives the exact sorted removal set and
acquires every D1-004d1 session advisory lock in that order on one dedicated
connection. While all are
held, re-read active state/all admission rows and append a durable `prepared`
event containing operation id, expected/target revision+digest, and removal set.
After that transaction commits, publish one atomic pointer, append a `committed`
terminal event, then release locks. No journal row is updated or deleted.

Recovery reacquires the same sorted lock set. If the target pointer is active,
append `committed`; if the expected pointer remains and all rows are absent,
resume publication then append `committed`; if the expected pointer remains and
any row exists, append `aborted` with no pointer change; any other pointer/journal
state fails `D1_ROLLBACK_JOURNAL_FAILED` closed. Thus a DB failure cannot make an
unjournaled removal, and a crash between durable prepare, pointer publication,
and finalization is recoverable. If rollback wins, later first use sees the
binding absent and creates no row/effect; if any admission wins, the whole
rollback rejects. Prove real-Postgres races on first/last keys of a two-binding
removal, overlapping sets/no deadlock, and crashes at every phase boundary.

### D1-005a — approved host release and intended policy (<= 300 net lines; 25 minutes)

Files: new
`apps/full-app/src/server/deployment/{approvedHostRelease,hostSecurityConfig}.ts`,
reuse of landed core/ingress identity constants, and focused codec/policy tests.

Deliver: mint one non-serializable root-owned `ApprovedD1HostRelease` capability
only after the approved release and intended host execution checks below
succeed. D1-005b consumes it in the same apply attempt; it is never caller
supplied, persisted, mounted, or reconstructed from app self-report.
V1 selector closure is the reviewed exact host release. Its complete potential
workspace-selector-bearing production route set is static and covered by
D1-004c1-c5. The production entrypoint hard-pins `externalPlugins: false`, which
makes `BORING_PLUGIN_AUTHORING`/`installPluginAuthoring` inert; hot reload rejects, no
runtime/plugin-front/raw-route gateway is mounted, and per-binding composition
descriptors cannot register startup routes. Conditionally enabled static Boring
MCP and managed-agent MCP families remain inside c3/c5 respectively.
The sole D1 web entrypoint is the approved full-app Docker web runtime invoking
`apps/full-app/dist/server/main.js`; generic `runCoreWorkspaceAgentServer` and
command overrides are not D1 launchers. A root-owned approved-host-release
record at `/etc/boring/d1/approved-host-releases/<hostId>.json`, outside D1
host-state and immutable revision mounts, is installed only by the root
maintenance release procedure and is not mounted into the app. The app cannot
write it and the D1 apply command exposes no mutation for it. The authority
directory is root:root `0755`; each exact `<hostId>.json` record is root:root
`0444`, regular, singly linked, and at most 64 KiB. It binds
`{ hostAppImageDigest, coreCommand, migrationProcess, ingressImageDigest, ingressCommand,
caddyfileDigest, hostSecurityConfigDigest,
selectorInventoryRevision, executionPolicyRevision }`; both revisions are
immutable merged commit/content
identities for the reviewed c1-c5 plan, execution policy, and release evidence,
not mutable labels. Before any Compose mutation, validate desired digest ==
approved digest and the intended image reference/Entrypoint/Cmd == the approved
release. Parse intended Compose plus `core.env` through one strict, versioned
production environment schema without logging values. The exact allowed key set
is the approved image defaults plus fixed Compose keys plus schema-declared app
keys; every key is classified as a fixed exact or redacted nonsecret value in
`hostSecurityConfigDigest`. Unknown or secret-bearing environment keys reject.
Secret-ref identities remain in the approved plan/revision, while raw values
remain only in the external tmpfs file-provider mount. Require
`NODE_ENV=production` and reject any of `NODE_OPTIONS`, `NODE_PATH`,
`LD_PRELOAD`, `LD_AUDIT`, or `LD_LIBRARY_PATH` regardless of classification.

The nonsecret identity includes at least `{ d1HostId, publicationOwnerUid,
agentMode, workspaceRoot: "/data/workspaces", sessionRoot: "/data/pi-sessions",
trustedProxy: { cidrs: ["192.168.255.250/32"], hops: 1 }, externalPlugins: false,
pluginAuthoring: false, betterAuthUrl, corsOrigins, cspEnabled,
cspUpgradeInsecureRequests, sessionCookieSecure, boringMcpEnabled,
managedAgentMcp: { enabled, workspaceId?, userId? } }`. Effective values come
from the same production readers used by the app. Bearer/API/auth/database/model
secret refs bind through the existing approved plan identity, never env. Any new environment
key or route/auth/browser/trust-boundary config reader requires a schema/policy
revision, renewed review, and new approved record before production use. Prove
unknown/secret-bearing keys and drift in owner UID, mode, roots, proxy, auth URL,
CORS, CSP, cookie security, MCP enablement, or managed target reject. A
materialized canary proves no secret bytes enter Docker config, identity, or
failure output.

Before mutation, also inspect the local approved core/ingress image objects and
hash the root-owned Caddyfile bytes against the approved identities. No Docker
container create/start, P6-R, admission, preload, pointer, or ingress operation
belongs to D1-005a.

### D1-005b — observed host execution attestation (<= 400 net lines; 30 minutes)

Files: new
`apps/full-app/src/server/deployment/{verifyRunningHostArtifact,migrationRunner}.ts`, the
unexposed-first-core/stopped-ingress orchestration seam, reuse of landed D1-003a
ingress validators/constants, fixed read-only-root/mount policies in
`deploy/d1/compose.yml`, the initial migration command path in `composeAdapter.ts`,
their tests, and focused integration tests.

Deliver: consume D1-005a's live `ApprovedD1HostRelease`. On first boot, require
core and ingress absent/stopped. Replace the uninspected `compose run` migration:
create a stopped one-shot container from the approved core image with exact
Entrypoint/Cmd `node apps/full-app/dist/server/migrate.js`, container
`User=10001:10001`, strict approved nonsecret env, file-mounted same-attempt DB
secret input readable only by that identity, read-only root, DB access only, no
workspace/session/state mounts, no added capabilities, and no privileged mode;
inspect it before start. The inherited `/usr/local/bin/web-entrypoint` is invalid
for migration because it performs root-owned data-root mutation, and direct
root-user `node` execution is forbidden. Add negative proofs for both.
then start/attach and require zero exit. Its name/idempotency key is the exact
bounded `(hostId, desiredDigest)` identity. Persist a root-owned redacted
completion record containing operation identity, verified container id, image/
command identity, and exit status before cleanup. Retry behavior is exact:
created/stopped -> inspect then start that id; running -> attach/wait that id;
exited zero -> durably record/accept; exited nonzero or any identity drift ->
quarantine and fail `D1_COLLECTION_NOT_READY` with redacted `field: migration`;
completion record with no container -> accept only when every identity matches.
After durable completion, remove only the exact verified container id. Prove
crashes after create, inspect, start, exit, completion write, and cleanup, plus
idempotent/backward-compatible migration behavior and no raw log/secret evidence.

Next run `docker compose create --no-deps core-app` (create, do not start).
`verifyRunningHostArtifact` inspects the stopped container and requires observed
digest/command == approved. It also
requires `ReadonlyRootfs: true` and exactly four D1 mounts: writable named
volumes at `/data/workspaces` and `/data/pi-sessions`, the read-only host-state
bind at `/var/lib/boring/d1/<hostId>`, and the read-only host-tmpfs secret/input
bind at `/run/boring/d1`; no other mount is allowed and none may cover
`/app`, `/usr/local/bin`, package/code paths, or another executable location.
Inspect the effective container environment with the same redaction-safe policy:
`NODE_ENV` must equal `production`, all five code-loader variables must be absent,
the observed exact environment key set/classifications must match the approved
schema, and the redacted host-security-config digest must equal approved. Reject
all secret-bearing env keys and prove a materialized canary is absent from the
complete Docker inspect/config serialization. Raw bytes remain only in the read-
only tmpfs file-provider mount and never enter image/container metadata, logs,
digests, capabilities, errors, or evidence. A changed secret ref/value remains an
active replacement and requires the existing maintenance restart plus a fresh
005a/005b attestation.
Bind the stopped core container id, then start only that exact verified id and
wait for its Docker health/readiness; do not re-resolve/recreate the service.
After start, only approved code executes. Although the core joins `d1-edge`,
ingress remains stopped and the landed request-scope guard rejects direct non-
Caddy application traffic; no public host port is published.
The public ingress is part of the same approval boundary. Before any public port
can listen, require the approved exact `D1_CADDY_IMAGE`, landed selected image
identity, exact Caddy command, and landed `D1_CADDYFILE_DIGEST`. On first boot,
after core verification, run `docker compose create --no-deps ingress` (create,
do not start), then inspect the stopped container: approved image/command,
`ReadonlyRootfs: true`, exact `80:8080` mapping and D1 edge identity, exactly one
read-only Caddyfile mount with approved bytes, and no extra mount/env/command.
"No extra env" means no Compose-added environment and exact approved image
defaults; the image environment need not be empty.
Bind that stopped ingress id alongside the verified core id in
`VerifiedD1HostExecution`. Drift leaves it
stopped/quarantined. On a running host, verify the existing ingress container
against the same identity before D1-005c candidate work. This extends the landed
D1-003a proof; it does not create a second ingress abstraction. Mint the non-
serializable capability only after both core and ingress checks; D1-005c consumes
it in the same apply attempt.
Missing/unapproved/mismatched initial state stops or quarantines the unexposed
core and fails `D1_ACTIVE_BINDING_RESTART_REQUIRED`; ingress remains stopped.
An already-running host does not recreate the stable core and validates its
observed state before D1-005c candidate effects. Never trust app env,
plan echo, app self-report, or image reference without the execution-policy
inspection. Command identity matters because
`main.ts` pins `externalPlugins: false`; image identity alone is insufficient if
an operator overrides the command. A changed artifact/command/startup-env/
execution policy or any workspace-selector-bearing code, config, or plugin
activation outside the reviewed static set fails
`D1_ACTIVE_BINDING_RESTART_REQUIRED` before candidate/effects and requires a
renewed c1-c5 inventory plus a new root-approved release during maintenance. The
approval evidence identity is not a runtime route registry or route digest. No
hot plugin reload or plugin-snapshot contract is introduced.

No P6-R call, admission, preload, active-pointer mutation, or ingress start
belongs to D1-005b.

### D1-005c — collection preload and atomic publication (<= 400 net lines; 30 minutes)

Files: new `apps/full-app/src/server/deployment/{bootCollection,preloadSignal}.ts`,
integration of the D1-001/002/003/004 seams through the root command wrapper and
`main.ts`, and focused integration tests. The fixed pending-pointer/signal
handler is the only local candidate-activation seam.

Deliver: require D1-005b's live `VerifiedD1HostExecution`, read one immutable
revision, and attest its opaque `databaseRef` against the live connection. The
operator installs one root-owned nonsecret expected identity
`{ databaseRef, databaseName, serverAddress, serverPort }` for this host, not a
provider registry. On the same reserved postgres.js handle used for admission,
query `current_database()`, `inet_server_addr()`, and `inet_server_port()` and
require an exact match before minting the nonserializable
`AttestedD1DatabaseConnection` consumed by core and CLI. Production core boot and
every production CLI destructive-diff read must obtain that capability freshly;
connection options, caller labels, ref-label equality, or an old result are
insufficient. Add no provider registry or database-identity table. Then perform
N independent P6-R calls and require each candidate
composition digest to equal that binding's resolved/preloaded composition;
sibling digests may differ. Install the D1-004d1 fence through the complete
D1-004d2/d3 effect coverage, then preload
all logical bindings through the root-owned pending pointer/signal, wait for all-
ready, and atomically publish the additive/landing-only pointer in the stable
process. Preload/all-ready is not an agent effect and creates no admission row.
Only after atomic pointer publication may first boot revalidate and start the
exact stopped ingress container id from the live D1-005b capability; it must not
recreate or re-resolve the service, and the root-owned Caddyfile digest must still
match. That start is initial public publication.
Start failure leaves ingress stopped/unreachable and the ready internal pointer
retryable; it never exposes a different container. On the first D1-004d2 mutation
or D1-004d3 direct operation, the hook takes D1-004d1's shared fence, revalidates
that the binding is still active, and commits the idempotent row before the
operation. Unused-binding
rollback uses D1-004e's sorted session fences and durable prepare/publish/
finalize journal; deterministic orders yield either recoverable removal with no
later row/effect or rejection of the whole rollback after any admission. Invalid pending payload/path/digest or one failed binding
leaves the old collection active and creates no new admission row; on first boot it also leaves
ingress stopped and stops/quarantines the unexposed core. A running request and
reconnect survive N+1 publication in the same stable process with no core
recreate. Online rollback may remove a newly published but unused/unadmitted
binding; once its first effect admits it, removal rejects. Other active
replacement/removal/secret rotation rejects before effects.

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
   D1-001 through D1-005c do not wait for a provider lock, but D1-006 cannot
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
