---
github: https://github.com/hachej/boring-ui/issues/1081
issue: 1081
state: needs-owner-approval
updated: 2026-08-10
revision: r1
flag: BORING_AGENT_MODE=remote-worker
track: owner
---

# gh-1081 — SBX1.4 internal-first sandbox service execution plan r1

## Outcome

Ship one owner-operated EU sandbox worker for seneca production. Seneca keeps
the agent/control plane; `BORING_AGENT_MODE=remote-worker` sends each agent
session to a Docker container running under gVisor `runsc --platform=systrap`
on one rented KVM VM. The worker exposes the already-merged remote-worker V1
protocol through a minimal HTTP daemon authenticated by one static shared
bearer secret.

The first production admission is deliberately manual: provision the rented
VM, run the repository's committed qualification harness on that exact box and
artifact cohort, require green evidence, then copy the resulting immutable
digests into the single-worker config consumed by seneca and the daemon. There
is no fleet controller in v1.

Success is a seneca production canary session whose filesystem and exec calls
run on the EU worker, whose in-sandbox `uname -r` reports the gVisor sentinel,
and which can be returned to `vercel-sandbox` by one environment rollback.

## Ratified topology and trust boundaries

```text
seneca production (agent/control plane)
        |
        | HTTPS + one pre-shared bearer secret
        v
one rented EU KVM VM (OVH for v1)
        |  provider hypervisor = boundary 1
        v
minimal V1 worker daemon -> Docker -> one runsc/systrap sandbox per session
                                      runsc sandbox = tenant boundary
```

- The VM is rented from a provider. It is **not** a self-hosted nested VM on
  bare metal. Infomaniak or Hikube are acceptable future CH placements; OVH is
  the ratified EU placement and seneca target for v1.
- `runsc --platform=systrap` needs no `/dev/kvm`. The 2026-08-10 proof ran the
  same Docker+runsc shape inside a nested KVM guest and passed all 11 hostile
  probes, so v1 does not provision, require, or pass through `/dev/kvm`.
- One runsc sandbox is created per agent session. For the internal-first
  deployment, that is the tenant boundary. VM-per-tenant is a later enterprise
  placement option, not a v1 requirement.
- The VM's OS is controlled by us. An openat2-capable host/runsc cohort, a
  dedicated `prjquota` data volume, and the root quota helper are provisioning
  facts, not application-level fallbacks. Missing facts fail qualification and
  keep the box out of use.
- The one static secret is the sole v1 authentication root. S1 supplies the
  currently missing shared codec that lets the V1 client issue short-lived,
  request-bound bearer capabilities and lets the daemon authenticate them and
  sign binding receipts. There is no user database, RBAC service, tenant
  credential table, or second token class.

## Today / target delta

| Area | Today on `origin/main` | SBX1.4 delta |
| --- | --- | --- |
| Remote protocol | `createRemoteWorkerProvider.ts`, `protocolClient.ts`, and `pairProxies.ts` implement the V1 client/provider against an abstract transport. | A real bounded HTTP/SSE transport and daemon implement the V1 endpoints. |
| Runtime | `RunscSessionRuntimeV1` creates, execs, mutates files, renews, and retires real Docker+runsc sessions in-process. | The daemon authorizes and proxies every V1 operation to this runtime; no second runtime is built. |
| Replay | `SingleUseNonceStoreV1` is a registry-scoped in-memory `Map` plus expiry heap; restart loses consumed nonces. `bindingRegistry.ts` is also volatile. | Only nonces become durable, atomically consumed, globally bounded, and per-workspace bounded. Bindings/receipts stay volatile. |
| Image admission | The create request carries expected digests, but `sessionRuntime.ts:startContainer` runs the supplied image without comparing it to admitted evidence. | Startup verifies the manually admitted bundle/evidence and every container start/replacement requires its exact `repository@sha256:...` image. |
| Box readiness | The nested-KVM proof is green, while this week's host integration is honestly non-admitting because its older runsc returns `ENOSYS` for `openat2` and its volume lacks `prjquota`. | The rented VM is provisioned with a known-good systrap runsc, openat2, `prjquota`, and the installed root helper; the committed harness is green on that exact box. |
| Seneca | Production safety accepts `vercel-sandbox`; a legacy V0-style remote-worker adapter exists but `remote-worker` is not a built-in mode. | Seneca composes the V1 `@hachej/boring-sandbox` provider and flips behind `BORING_AGENT_MODE=remote-worker`; the prior mode remains the immediate rollback. |

## Decisions that constrain every slice

1. One epic branch may carry the plan, but implementation is five ordered,
   independently reviewed PRs. Each PR remains within the normal review budget
   (about 1,500 added production lines); if it cannot, the implementer returns
   to the owner instead of silently widening a slice.
2. The daemon owns trusted filesystem roots. No HTTP request may supply a host
   path, Docker socket, image override, or qualification override.
3. Production uses HTTPS. Plain HTTP is allowed only for in-process/loopback
   tests. TLS termination and the server certificate are box configuration;
   the V1 fleet config continues to pin CA and server name.
4. Stable V1 schemas, request-size ceilings, capability lifetime, binding
   checks, error codes, retry semantics, startup sweep, and hard expiry are
   reused. The daemon does not invent a parallel wire protocol.
5. Bindings and receipts remain in memory. Under issue #1167, a future change
   that persists either must persist nonces in the same atomic change and must
   repeat the restart regression. That future change cannot be split across
   PRs.
6. Qualification is manual per box. A green run is necessary but is accepted
   only when it names the exact worker/provider/workload cohort used by the
   daemon and seneca config. Drift fails closed at daemon startup and provider
   health comparison.
7. No real seneca traffic reaches the box until S1-S4 are merged, S4 evidence
   is green, and S5's exact configuration is owner-approved.

## Gate 0 — prove openat2 before funding implementation

This is an operator prerequisite, not a code PR or a sixth delivery slice. The
2026-08-10 nested-KVM proof established systrap viability but did not exercise
the workspace helper's mandatory `openat2` call. The older host run proved that
`release-20260706.0` returns `ENOSYS`; no supplied evidence yet proves a runsc
release that admits the real workspace path.

Before S1 begins, provision a disposable rented KVM VM, start with
`release-20260803.0`, and run the existing SBX1.3 integration preflight against
candidate releases until the `workspace-openat2-fs` and `symlink-swap-race`
follow-ups are absent and both `workspace-fs` (with `openat2Probe: true`) and
`session-create` are passed. Record the exact release tag, binary digest, host
kernel, guest sentinel, and raw output beside the plan. If no candidate passes,
stop: the owner chooses between pinning a patched gVisor build or deferring
SBX1.4 as refusal-only. No realpath fallback and no waiver are permitted.

The disposable box must already provide the harness's fixed prerequisites:
Docker access, `/usr/bin/findmnt`, `/usr/local/bin/runsc`, busybox-static, a C
compiler, Node/pnpm, and passwordless `sudo -n` for its bounded chown/cleanup
calls. Gate 0 changes no system policy; it only selects a candidate runsc.

```bash
pnpm install --frozen-lockfile
pnpm --filter @hachej/boring-agent run build
pnpm --filter @hachej/boring-sandbox run build
RUN_RUNSC_INTEGRATION=1 \
  node packages/boring-sandbox/scripts/integrate-docker-runsc-runtime.mjs \
  > /tmp/sbx14-openat2-candidate.json
```

Gate 0 is green only when the command exits zero, stdout parses as exactly one
JSON document, `results` contains no `operator-follow-up` entry for
`workspace-openat2-fs` or `symlink-swap-race`, and `session-create` (not
`session-create-fail-closed`) is `passed`. Project-quota follow-ups may remain
for this disposable gate; S4 must close them on the production box.

## Slice order

```text
S1 daemon + V1 transport
  -> S2 durable nonces
  -> S3 admitted image pin
  -> S4 rented-VM provisioning + manual qualification
  -> S5 seneca canary flip
```

S4 infrastructure preparation may start while S1-S3 are reviewed, but its
admission run must use the exact artifacts produced after S3, including S3's
real V3 harness mode. S5 is blocked on all prior slices.

## S1 — minimal daemon, static-secret auth, and runtime proxy

**Size:** M, upper edge (2-4 days; explicit owner review-budget check before
implementation).  
**Blocked by:** merged SBX1.3 only.  
**Delivers:** a systemd-friendly server-only process and real HTTP transport
for the existing V1 provider.

### Today

- `RemoteWorkerProtocolClientV1` already calls health/create/fs/events/exec/
  renew/delete paths and enforces bounded, strict responses, but
  `RemoteWorkerTransportV1` has no production implementation.
- `RemoteWorkerSandboxBindingRegistryV1` already authenticates request-bound
  capabilities before operations and produces binding receipts, but no route
  invokes it.
- `RunscSessionRuntimeV1` already owns Docker/runsc session lifecycle. It is
  exercised in-process only.

### Delta

- Add a server-only worker composition/entrypoint under
  `packages/boring-sandbox/src/worker/**` and a fetch/SSE implementation of
  `RemoteWorkerTransportV1` under `src/providers/remote-worker/**`.
- Add one versioned shared token codec used by both sides. It canonicalizes the
  existing strict claims/payload schemas and derives separate
  HMAC-SHA-256 subkeys for `boring.remote-worker.v1/capability` and
  `boring.remote-worker.v1/binding-receipt` from the single static secret. It
  is the only production implementation of capability issuer/authenticator and
  binding-receipt signer/verifier; S5 consumes it rather than inventing another
  format. Commit deterministic test vectors and round-trip/cross-domain
  rejection tests.
- Load the secret from a root/operator-owned credential file and use
  constant-time MAC comparison. Never log the secret, token, capability,
  Authorization/header value, host paths, or request bodies.
- Implement only the V1 routes already named by `protocolClient.ts`:
  `GET /internal/v1/health`, `POST /internal/v1/sandboxes`, and fs/events/
  exec/renew/delete beneath `/internal/v1/sandboxes/:sandboxId`.
- Enforce the existing 8 MiB protocol body bound before JSON parsing, strict
  content type/schema, request abort/timeout propagation, bounded SSE lifetime,
  stable redacted `RemoteWorkerErrorPayloadV1`, and 404/hard-expiry behavior.
- Authorize before touching a workspace, watcher, credential resolver, quota
  helper, or Docker. Derive the workspace mount from the daemon-owned data root
  plus the authorized workspace UUID; never accept a host path on the wire.
- Derive `sandboxId` deterministically and opaquely from the authorized
  `(workspaceId, clientLeaseId)` with a domain-separated subkey. A create retry
  after a lost response therefore returns the same sandbox/receipt and cannot
  leak a second container.
- Proxy create/fs/exec/renew/delete into one `RunscSessionRuntimeV1`. Add a
  daemon-owned host watcher over the trusted bind-mount source, reusing the
  existing node-workspace/chokidar primitive rather than claiming the runtime
  already watches. Close watchers on stream expiry, delete, daemon shutdown,
  or lost client.
- V1 does not deliver sandbox credentials in this internal-first slice.
  Non-empty `credentialRefs` fail closed with
  `REMOTE_WORKER_SECRET_REFERENCE_REJECTED`; model credentials remain in the
  seneca control plane.
- Run `startupSweep()` before listening. On SIGTERM, stop admission, drain
  bounded in-flight work, call runtime shutdown, close the server, and return a
  non-zero exit when cleanup cannot be proven.
- Export a package entry/bin suitable for a systemd `ExecStart`. Do not add
  admin, metrics, console, discovery, or fleet endpoints.

### Acceptance and proof

- A protocol-conformance test drives the real fetch transport against the real
  daemon process with the existing runtime behind a fake Docker runner. It
  covers create, write/read, exec, SSE mutation event, renew, delete, repeated
  delete/404, hard expiry, bounded body, transport loss, and graceful shutdown.
- Shared-code test vectors prove client-issued capability -> daemon verification
  and daemon-signed receipt -> client verification, while swapping domains or
  changing any claim fails.
- A create retried after its first response is dropped returns the same
  sandbox id and receipt and leaves exactly one owned container.
- A write originating inside the runsc workspace reaches the daemon's host
  watcher and SSE client. A normal serial file-read then exec sequence succeeds;
  deliberately overlapping fs/exec fails with the existing stable concurrency
  code instead of corrupting state.
- Missing/wrong bearer material is 401 with the stable unauthenticated code;
  malformed/oversize requests fail before runtime/Docker calls; workspace and
  sandbox mismatches are rejected before runtime calls.
- The daemon cannot listen until startup sweep and static qualification facts
  load successfully (S3 replaces fixture facts with admitted facts).

```bash
pnpm --filter @hachej/boring-sandbox exec vitest run \
  src/worker/__tests__/daemon.conformance.test.ts \
  src/worker/__tests__/tokenCodec.test.ts \
  src/providers/remote-worker/__tests__/httpTransport.test.ts
pnpm --filter @hachej/boring-sandbox run typecheck
pnpm --filter @hachej/boring-sandbox run check:invariants
```

**Slice rollback:** stop/disable the new daemon; no existing production mode
points to it before S5. Startup sweep retires its owned test/canary containers.

S1 remains one owner-requested delivery slice because the protocol, binding
guards, runtime, schemas, and watcher primitive already exist; the production
delta is composition and one small codec. Before implementation the worker must
estimate production additions. If it exceeds the normal review budget, it
returns to the owner for an explicit S1a/S1b split rather than hiding an
oversized PR.

## S2 — persistent nonce store and #1167 atomicity

**Size:** M (1-3 days).  
**Blocked by:** S1 composition seam.  
**Delivers:** persistent, transactional, bounded replay protection with a
per-workspace sub-budget; no binding persistence.

### Today

- `SingleUseNonceStoreV1` accepts a nonce into one registry-scoped in-memory
  set/expiry heap.
- A restart forgets consumed nonces. A tenant can consume the entire worker
  maximum and cause `REMOTE_WORKER_CAPABILITY_NONCE_STORE_EXHAUSTED` for every
  other tenant.
- Binding records and receipts are volatile and therefore share one lifecycle
  today, matching #1167's fail-closed constraint only accidentally.

### Delta

- Introduce a synchronous injectable nonce-store constructor option on
  `RemoteWorkerSandboxBindingRegistryV1` and a production SQLite implementation
  using Node's built-in `node:sqlite`; retain the in-memory implementation for
  narrow unit tests. Change the port to
  `consume(nonce, workspaceId, expiresAtMs, nowMs)` so the authenticated
  workspace—not request input—owns the sub-budget.
- Update the in-memory implementation to the same four-argument signature so
  it remains a faithful unit-test double for per-workspace budgeting.
- Store global-unique nonce, authorized workspace/tenant id, and expiry in a
  daemon-owned file such as `/var/lib/boring-worker/security/nonces.sqlite`.
  The provisioning slice creates the parent directory root-owned and not
  group/world-readable.
- Consume in one `BEGIN IMMEDIATE` transaction: evict expired rows, reject a
  global nonce collision as replay, enforce the global maximum, enforce a lower
  per-workspace active-nonce maximum, insert, and commit. Two daemon processes
  or SQLite connections must never both return `accepted` for one nonce.
- Preserve the existing stable replay/global-exhaustion error codes. A tenant
  sub-budget exhaustion uses the same fail-closed exhaustion code with no
  tenant counts or identifiers in the response.
- Open/migrate the nonce database before the daemon listens; an unreadable,
  corrupt, locked beyond the bounded busy timeout, or unmigratable database
  prevents startup. No volatile production fallback exists.
- Pin the worker runtime to Node `>=22.19.0`, matching the repository/CI floor,
  and prove flagless `DatabaseSync` import on both CI Node and the rented VM.
  Configure the SQLite busy timeout explicitly through the supported
  `DatabaseSync` API/pragma and test that exceeding it fails closed within the
  daemon's startup/request bound.
- **Do not persist binding records or receipts.** The absence of a binding
  table is the cheapest #1167-compliant form: there is no second persistence
  commit to coordinate. A later binding/receipt persistence PR is blocked
  unless nonce and binding state share one atomic transaction and the restart
  proof is retained.
- The earlier boot-epoch proposal is intentionally subsumed by transactional
  global nonce uniqueness across processes/connections. V1 stores no epoch
  column; the concurrent-connection test is the fencing proof.

### Acceptance and proof

- `consumed nonce survives simulated restart`: consume, close the store, open a
  new store instance on the same database, and assert the nonce is replay.
- Concurrent independent connections consuming the same nonce yield exactly
  one `accepted` and one `replay`.
- Tenant A can exhaust only its sub-budget; tenant B remains accepted until the
  global limit. Expired rows release both budgets without accepting an
  unexpired replay.
- Daemon restart with a consumed capability rejects that capability before any
  runtime call; restart does not hydrate a binding or preserve a container.

```bash
pnpm --filter @hachej/boring-sandbox exec vitest run \
  src/providers/remote-worker/__tests__/persistentNonceStore.test.ts \
  src/worker/__tests__/daemonRestart.test.ts \
  src/providers/remote-worker/__tests__/tenantBinding.test.ts
pnpm --filter @hachej/boring-sandbox run typecheck
```

**Slice rollback:** never roll a traffic-bearing worker back to the volatile
store. Stop/drain the daemon and retain the nonce database. If an older binary
must be restored, rotate the static secret and retire all old sessions first so
old capabilities cannot be replayed; otherwise restore the S2 binary.

## S3 — qualification-bound image digest pinning

**Size:** M (2-3 days, including real-harness V3 binding).  
**Blocked by:** S1; lands after S2.  
**Delivers:** no `docker run` or replacement unless the workload image exactly
matches the manually admitted cohort.

### Today

- `RemoteWorkerCreateRequestV1` and health already carry evidence, bundle,
  cohort, and image digests, and the client compares health facts to static
  placement.
- `buildDockerRunArgv()` already rejects tags and malformed image references;
  `RunscSessionRuntimeV1.startContainer()` can still accept any syntactically
  valid `repository@sha256:...`, even when it differs from qualification.
- Existing bundle and evidence validators can verify immutable cohort facts,
  but the runtime is not configured from their accepted result.

### Delta

- At daemon startup, load the operator-installed qualification bundle and
  evidence files, run the existing strict validators, and construct one frozen
  admitted-cohort value. Startup fails closed on missing, malformed, stale, or
  mismatched facts.
- Derive the only allowed workload reference as
  `<qualified repository>@<expectedWorkloadImageManifestDigest>`. Health and
  create checks report/compare those same immutable values; request input never
  selects another repository or digest.
- Pass the admitted image into `RunscSessionRuntimeV1` as configuration. At the
  top of `startContainer()`—therefore covering initial start and clean
  replacement—require an exact canonical digest reference and equality with
  the admitted digest **before** constructing/running Docker argv.
- Preserve `REMOTE_WORKER_REQUEST_INVALID` for tags/malformed image references
  rejected by `dockerArgv`; return `REMOTE_WORKER_UNQUALIFIED` for a validly
  pinned repository/digest that differs from the admitted cohort or for a
  drifted bundle. Tests assert the Docker runner was not invoked in either
  class.
- Verify the root quota helper and other bundle entry bytes at daemon startup;
  v1 has one workload image, not a speculative second helper container image.
- Upgrade the **real** `qualify-docker-runsc-isolation.mjs` path from its
  current V2 envelope to the existing production V3 schema. Add an explicit
  observe-only mode that emits the real profile/cohort-pin inputs without
  claiming admission plus writes the deterministic cohort-spec input, and a
  bound mode that accepts a verified qualification bundle path/digest and the
  exact pre-pulled workload image and emits the final V3 evidence. Bound mode
  adds the four V3 controls (own-workspace write, persistence across recreate,
  byte quota, inode quota), workload repository/repository digest/manifest
  digest/architecture, host facts, and policy digests from real observations.
  It refuses placeholder/reference values.
- Test the required ordering: observe -> build bundle -> bound V3 run -> strict
  verify. `qualify-runsc-v3-reference.mjs` remains fixture-only and cannot
  satisfy this path.
- Add a narrow opt-in to `integrate-docker-runsc-runtime.mjs` to consume the
  same external, pinned workload image rather than its throwaway registry
  build. The admission run must not prove one image and deploy another.
- Add a production-qualification opt-in to that integration script which wires
  `/usr/local/libexec/boring-workspace-quota` through the real
  `FixedQuotaHelperCommandRunnerV1`/`FixedProjectQuotaManagerV1` instead of the
  current no-op quota stub. With `prjquota` active it performs real byte/inode
  fill, sibling isolation, and host-reserve checks and records
  `project-quota-fill` as `passed`; without the explicit helper opt-in it keeps
  the current honest operator follow-up.
- Add one explicit qualification workspace-root input shared by the integration
  script and real V3 observe/bound modes. It must be an existing child of the
  operator-selected `prjquota` mount, relocates all harness workspaces off
  `/tmp`, and is exported to the helper subprocess as `BORING_WORKSPACE_ROOT`.
  Qualification refuses `/`, `/tmp`, a non-child path, or a root whose
  `findmnt` options lack project quota. The helper opt-in is a boolean that
  always selects the production constant
  `/usr/local/libexec/boring-workspace-quota`; an arbitrary proof-only helper
  path is not accepted.
- External-image mode still starts an isolated sibling container for the
  egress-sibling negative even when it skips the throwaway registry. The probe
  may not disappear merely because image publication moved outside the script.
- When forming daemon health/admission facts, require the bundle cohort pin's
  `expectedWorkloadImageManifestDigest` and the fleet/create field
  `expectedImageDigest` to identify the same admitted manifest; test both field
  names so a locally valid but cross-layer-mismatched digest fails closed.

### Acceptance and proof

```bash
pnpm --filter @hachej/boring-sandbox exec vitest run \
  src/worker/__tests__/qualificationAdmission.test.ts \
  src/providers/runsc/runtime/__tests__/sessionRuntime.test.ts \
  src/providers/runsc/runtime/__tests__/dockerArgv.test.ts \
  src/providers/runsc/__tests__/isolationEvidenceDocker.test.ts \
  src/providers/runsc/__tests__/fleetAdmission.test.ts
pnpm --filter @hachej/boring-sandbox run typecheck
pnpm --filter @hachej/boring-sandbox run check:invariants
```

The negative tests must name the security properties: `rejects malformed or
unpinned image before docker run` and `rejects pinned but non-admitted image
before docker run`, covering initial creation and container replacement.

**Slice rollback:** the gate is not bypassable. A bad admitted artifact is
fixed by reinstalling the last known-good bundle/evidence/image as a unit and
restarting while traffic is drained. Do not revert to code that accepts tags.

## S4 — rented-VM provisioning script and manual qualification

**Size:** M (2-4 days plus provider provisioning time).  
**Blocked by:** exact S1-S3 release/artifact cohort.  
**Delivers:** one reproducibly configured OVH EU KVM VM and the manual
admission record for that box.

### Today

- `/home/ubuntu/kvm-sbx-test/runbook-bare-metal.sh` proves Docker+runsc under
  nested KVM, including the important explicit
  `runsc install -- --platform=systrap`, but it creates another QEMU guest and
  downloads `release/latest` without a checksum. That is proof scaffolding,
  not the v1 production topology.
- The 2026-08-10 KVM proof passed all 11 hostile probes with
  `release-20260803.0` and no `/dev/kvm` dependency.
- This week's SBX1.3 host run passed 12 runtime checks but correctly reported
  three operator follow-ups: its older runsc lacks openat2, the volume lacks
  `prjquota`, and the root helper is not installed in the production path.

### Delta

- Convert the useful guest-side steps into an idempotent executable repository
  script, `packages/boring-sandbox/scripts/provision-runsc-worker.sh`, with
  explicit `--apply` and read-only `--check` modes. It configures the rented VM
  directly; it contains no QEMU/cloud-image/nested-KVM creation.
- `--apply` creates the root-owned admission, nonce-security, credential, and
  workspace directories—including
  `/var/lib/boring-worker/qualification-workspaces`—before any BuildKit
  metadata or evidence is written.
  `--check` asserts fixed tool paths and prerequisites used by the committed
  harnesses: `/usr/bin/docker`, `/usr/bin/findmnt`, `/usr/local/bin/runsc`,
  `/usr/bin/busybox`, Node/pnpm, a C compiler, non-interactive sudo where the
  harness calls it, and Docker access. It also proves the exact qualification
  workspace root resolves beneath `/var/lib/boring-worker` on the `prjquota`
  mount.
- Pin Docker/runsc versions and downloaded checksums; register runsc with the
  observable `--platform=systrap` runtime arg. Assert KVM virtualization but do
  **not** require `/dev/kvm`.
- Format/mount a dedicated operator-selected data volume as ext4 or XFS with
  project quotas, persist the mount, and make `--check` prove `prjquota` is
  active. The script must require an explicit block device/mount target and
  refuse `/`, the repository, or an unresolved variable.
- Build/install `/usr/local/libexec/boring-workspace-quota` as root-owned,
  non-writable by the daemon's callers, with its digest in the qualification
  bundle. Configure the worker service, nonce-state directory, workspace root,
  TLS termination, secret credential file, and bounded systemd restart policy.
- Run the v1 worker service as root: its existing Docker CLI runner and quota
  helper require root-equivalent host authority. Install the helper
  `root:root` mode `0755` (never setuid and never writable outside root), keep
  the HTTP listener loopback-only behind TLS termination, and apply systemd
  hardening that does not block Docker, the admitted workspace volume, nonce
  DB, or helper. An unprivileged/more granular service account is a later
  hardening change, not an unproven v1 claim.
- Build the workload image from the committed
  `src/providers/runsc/runtime/workload/Dockerfile` at the frozen S1-S3 head,
  push it to the operator-selected private registry, record its canonical
  `repository@manifestDigest`, and pre-pull that exact reference on the worker.
  Registry credentials are root-owned and unreadable by daemon callers; the
  script never prints them.
- Prove host and gVisor `openat2`, project-quota fill/sibling isolation/host
  reserve, root helper `apply`/`check`, runsc sentinel, egress denial, cleanup,
  and the committed hostile probe suite on the exact rented VM.
- Use S3's real observe/bound V3 harness mode; do not use
  `qualify-runsc-v3-reference.mjs`, which is explicitly a non-admitting fixture.
  Admission has four ordered phases: (1) observe real profile/pins, (2) build
  the immutable bundle from those observations plus the exact S1-S3 files and
  image, (3) rerun the real harness bound to that bundle digest, and (4) require
  `verify-fleet-admission-evidence.mjs` to accept the pair.
- Store the redacted evidence, bundle, exact git SHA, image reference, command
  transcript, and digests as the manual box-admission record. Installing those
  files into the daemon and seneca config is the admission act for this one
  box; there is no scheduled/protected fleet job or automatic candidate-box
  registration.

### Acceptance and proof

Run the entire block from an audited root login shell on the rented OVH KVM VM,
against the release checkout and an explicit data device chosen by the
operator. The root shell is required because `--apply` intentionally makes the
admission directory root-owned and shell redirections open evidence files
before child commands execute. The retained `sudo` prefixes are harmless and
keep the destructive/privileged operations obvious in copied transcripts.

```bash
sudo -i
cd <release-checkout>
sudo packages/boring-sandbox/scripts/provision-runsc-worker.sh --apply \
  --data-device /dev/disk/by-id/<operator-selected-id> \
  --mount /var/lib/boring-worker
sudo packages/boring-sandbox/scripts/provision-runsc-worker.sh --check \
  --mount /var/lib/boring-worker
pnpm --filter @hachej/boring-agent run build
pnpm --filter @hachej/boring-sandbox run build
sudo cat /run/credentials/boring-registry-token | \
  sudo docker login <operator-registry> \
  --username <robot-account> --password-stdin
sudo docker buildx build --platform linux/amd64 --push \
  --file packages/boring-sandbox/src/providers/runsc/runtime/workload/Dockerfile \
  --tag <operator-registry>/boring-runtime:<frozen-git-sha> \
  --metadata-file /var/lib/boring-worker/admission/image-metadata.json \
  packages/boring-sandbox/src/providers/runsc/runtime/workload
sudo docker buildx imagetools inspect \
  <operator-registry>/boring-runtime:<frozen-git-sha>
sudo docker pull <operator-registry>/boring-runtime@sha256:<manifest-digest>
sudo docker image inspect \
  <operator-registry>/boring-runtime@sha256:<manifest-digest>
sudo env BORING_BUSYBOX_BINARY=/usr/bin/busybox \
  BORING_RUNSC_WORKSPACE_ROOT=/var/lib/boring-worker/qualification-workspaces \
  node packages/boring-sandbox/scripts/qualify-docker-runsc-isolation.mjs \
  --observe-only \
  --workload-image=<operator-registry>/boring-runtime@sha256:<manifest-digest> \
  --cohort-spec-out=/var/lib/boring-worker/admission/cohort-spec.json \
  > /var/lib/boring-worker/admission/observation.json
sudo env RUN_RUNSC_INTEGRATION=1 \
  BORING_RUNSC_WORKLOAD_IMAGE=<operator-registry>/boring-runtime@sha256:<manifest-digest> \
  BORING_RUNSC_WORKSPACE_ROOT=/var/lib/boring-worker/qualification-workspaces \
  BORING_RUNSC_USE_INSTALLED_QUOTA_HELPER=1 \
  node packages/boring-sandbox/scripts/integrate-docker-runsc-runtime.mjs \
  > /var/lib/boring-worker/admission/runtime-integration.json
node packages/boring-sandbox/scripts/build-qualification-bundle.mjs \
  /var/lib/boring-worker/admission/cohort-spec.json \
  > /var/lib/boring-worker/admission/bundle.json
sudo env BORING_BUSYBOX_BINARY=/usr/bin/busybox \
  BORING_RUNSC_WORKSPACE_ROOT=/var/lib/boring-worker/qualification-workspaces \
  node packages/boring-sandbox/scripts/qualify-docker-runsc-isolation.mjs \
  --qualification-bundle=/var/lib/boring-worker/admission/bundle.json \
  --workload-image=<operator-registry>/boring-runtime@sha256:<manifest-digest> \
  > /var/lib/boring-worker/admission/evidence.json
node packages/boring-sandbox/scripts/verify-fleet-admission-evidence.mjs \
  /var/lib/boring-worker/admission/bundle.json \
  /var/lib/boring-worker/admission/evidence.json
```

Admission requires all commands green, zero integration failures, zero
operator follow-ups, 11/11 hostile probes passed, all positive controls true,
redaction clean, and bundle/evidence/image digests matching daemon health.
Every redirected artifact must parse as one JSON document; package-manager
banners are not accepted evidence. The canonical published manifest digest is
read from BuildKit's `image-metadata.json` and cross-checked with
`docker buildx imagetools inspect`; neither a local image ID nor an ambiguous
tag is accepted as the cohort pin.

**Slice rollback:** do not admit the box, or stop/disable the worker service and
remove it from seneca's single-worker config. Keep the VM, evidence, nonce DB,
and workspace volume intact for diagnosis; deprovisioning is a separate owner
action and is not part of an automated rollback.

## S5 — seneca production flip with rollback

**Size:** M (1-3 days plus deployment observation).  
**Blocked by:** S1-S4 merged and exact S4 evidence accepted.  
**Delivers:** V1 remote-worker as a built-in agent mode and one observed seneca
production canary.

### Today

- `packages/agent` still limits built-in modes and environment parsing to
  `direct | local | vercel-sandbox`; full-app production safety accepts only
  `vercel-sandbox` without an unsafe override.
- A legacy static-token remote-worker client/adapter exists under
  `packages/agent/src/server/**`, but it speaks the pre-V1 workspace-shaped
  routes. It is not the SBX1.3 V1 provider. Worse, Core currently selects that
  legacy adapter when `BORING_WORKER_BASE_URL` is present before it resolves
  `BORING_AGENT_MODE`, so reusing the legacy env could silently bypass V1.
- Seneca production uses `BORING_AGENT_MODE=vercel-sandbox`.

### Delta

- Add `remote-worker` to the built-in runtime mode/config schema and production
  allowlist. Compose the existing
  `createRemoteWorkerSandboxProviderV1` through the generic
  `createProviderRuntimeModeAdapter`; do not extend the legacy V0 client. Widen
  the mode id in `runtime/mode.ts`, `runtime/resolveMode.ts`,
  `runtime/modes/providerAdapter.ts`, `host/sandbox.ts`, shared config schema,
  and full-app safety/docs. Supply remote `/workspace` path mapping,
  readiness, cached health checks, and the S1 token codec's issuer/verifier.
- Change `packages/core/src/app/server/createCoreWorkspaceAgentServer.ts` so
  `BORING_AGENT_MODE=remote-worker` cannot fall into the earlier legacy
  `BORING_WORKER_BASE_URL` branch. Production startup fails closed when the V1
  mode is combined with legacy V0 env/config; no precedence rule may silently
  select V0.
- Load one server-only single-worker config path from env. The config assigns
  all 256 placement buckets to the admitted EU worker and references absolute
  token/CA files plus the exact evidence, bundle, cohort, and workload digests
  from S4. Raw secret values never enter JSON, logs, client bundles, or PRs.
- Set `qualificationMaxAgeMs` explicitly to seven days for this internal-first
  box. The operator re-runs S4 qualification at least every six days and after
  any kernel, Docker, runsc, daemon/provider, helper, policy, or image change.
  Installing refreshed immutable evidence requires draining the worker and
  restarting the daemon; old evidence remains the rollback artifact. New
  session creation must fail closed after seven days rather than silently
  extending freshness.
- Keep `BORING_AGENT_MODE` as the rollout flag. Missing config, CA, token,
  qualification facts, or a mismatched health response fail production startup
  or session creation closed; there is no fallback to direct/local or a second
  worker.
- Preserve the existing standalone-host scope rule intentionally: in
  remote-worker mode, the authenticated `sessionId` is the runtime workspace
  scope rather than `DEFAULT_SESSION_ID`. Require a UUID-shaped authorized
  seneca session/workspace id before provider create, matching the trusted
  runsc mount/quota contract; a broader protocol opaque id fails before any
  Docker call.
- Before deployment, record the current seneca environment revision and image.
  Deploy the same app with `BORING_AGENT_MODE=remote-worker` and the config
  secret mounted. Start one owner-selected canary session, verify filesystem
  write/read, exec, gVisor sentinel, renewal, delete, and daemon cleanup, then
  observe normal agent work for the owner-approved window.
- Roll back by restoring the captured environment revision to
  `BORING_AGENT_MODE=vercel-sandbox` and redeploying. Leave the EU worker and
  volume untouched until seneca health and a Vercel-sandbox canary are green.

### Acceptance and proof

```bash
pnpm --filter @hachej/boring-agent exec vitest run \
  src/server/runtime/__tests__/resolveMode.test.ts \
  src/server/runtime/modes/__tests__/remote-worker.test.ts \
  src/server/__tests__/createStandaloneAgentHostApp.remoteWorker.test.ts
pnpm --filter @hachej/boring-core exec vitest run \
  src/app/server/__tests__/createCoreWorkspaceAgentServer.test.ts
pnpm --filter full-app exec vitest run \
  src/server/__tests__/production-safety.test.ts
pnpm --filter @hachej/boring-agent run typecheck
pnpm --filter @hachej/boring-core run typecheck
pnpm --filter full-app run typecheck
```

The automated suite also proves that `BORING_AGENT_MODE=remote-worker` plus
legacy `BORING_WORKER_BASE_URL` fails startup, remote-worker scope uses the
authorized UUID session id, qualification expires at seven days, and an
evidence refresh restores create without changing the admitted image.

Manual production proof, with secrets redacted:

1. Confirm worker `/internal/v1/health` matches the S4 worker, evidence, bundle,
   cohort, and image digests.
2. Capture seneca's pre-change environment/image revision; deploy
   `BORING_AGENT_MODE=remote-worker` with the single-worker config mounted.
3. In a new owner-selected canary session, write and read a marker file, run
   `uname -r` and assert `4.19.0-gvisor`, run a bounded command, renew the
   session, close it, and confirm its `boring-sbx-*` container is absent. The
   canary includes the realistic serial sequence read -> write -> exec -> read;
   it sends no `credentialRefs`.
4. Confirm the agent transcript/session history remains on seneca's durable
   host volume, per `BORING_AGENT_SESSION_ROOT`; it is never placed in the
   sandbox workspace.
5. Rollback drill: restore `BORING_AGENT_MODE=vercel-sandbox`, redeploy, and
   prove a new canary exec is healthy. Then reapply remote-worker only with
   explicit owner approval.
6. Requalification drill with fake time in automated proof and real evidence
   install in staging: new create is rejected after the seven-day boundary,
   the worker is drained/restarted with fresh S4 evidence, and create succeeds
   with the same or newly admitted exact image digest.

**Slice rollback:** the environment revision is the primary rollback. Do not
destroy the remote workspace volume during rollback. Any canary-only workspace
changes that must be retained are exported before the owner declares rollback
complete; the untouched VM remains available for forensics or resumption.

## Per-slice review protocol

Every S1-S5 implementation PR is reviewed independently on its exact head SHA.
The two lines are sequential; neither is a substitute for deterministic proof
or owner approval.

1. **Line 1 — Opus 4.8 (T2) adversarial review.** Fresh read-only session,
   given the issue, this plan, the slice diff, and proof output. It checks slice
   scope/acceptance, trust boundaries, fail-closed behavior, rollback, and test
   honesty. Record:

   ```text
   reviewer: Opus 4.8 / T2
   target: <head SHA>
   verdict: clean | revise
   findings: <summary or link>
   ```

   Accepted findings are fixed and all slice proof reruns before line 2.

2. **Line 2 — Fable (T1) final falsification.** Fresh read-only session on the
   post-Opus head, with the same evidence packet and no Opus conclusions as
   leading context. Fable attempts to falsify the security claim and slice
   acceptance; it does not edit. Record the same four fields with
   `reviewer: Fable / T1`.

Any Fable finding returns the slice to implementation, reruns proof, and
restarts at line 1 on the new SHA. Only `clean` from both lines on the same SHA
may reach the owner gate. S1-S3 and S5 are code/security changes; S4 is
ops/security. None may use the docs/config thermo exemption to skip these two
owner-required lines. No slice merges without explicit owner approval.

## End-to-end rollback story

1. **Before S5:** rollback is simply no admission/no routing. Stop the daemon
   or remove the box from the unpublished config; seneca remains on Vercel.
2. **During/after S5:** restore the captured seneca environment revision with
   `BORING_AGENT_MODE=vercel-sandbox` and redeploy. Verify application health
   and a fresh Vercel-sandbox canary before declaring recovery.
3. Stop new worker admission, allow bounded in-flight work to drain, then stop
   the daemon. Keep the VM, nonce database, evidence, and workspaces intact.
4. Never downgrade a live worker to volatile nonces or tag-based images. If a
   binary rollback crosses S2, rotate the static secret and retire old sessions
   first. If it crosses S3, restore a previously admitted bundle/image as a
   unit; never bypass the pin.
5. The agent transcript/session list remains host-owned on seneca's durable
   `BORING_AGENT_SESSION_ROOT`, independent of either sandbox provider. Remote
   workspace-only writes are not claimed to appear magically in a new Vercel
   sandbox; export required canary data before finalizing rollback.

## Explicit non-goals

- Multi-tenant auth, users/roles, tenant token issuance, per-tenant VM
  placement, or an identity service. The per-workspace nonce sub-budget is a
  bounded availability control, not a multi-tenant product claim.
- More than one production worker, autoscaling, fleet scheduling, automatic
  candidate registration, automatic qualification, or a protected admission
  CI job. Qualification is run manually on the one box.
- VM-per-tenant. That remains a later enterprise placement configuration.
- Self-nested bare metal, creating a QEMU guest, requiring `/dev/kvm`, or
  qualifying runsc's KVM platform. V1 is one provider-rented KVM VM using
  systrap.
- A CH production worker in this slice. Infomaniak/Hikube remain valid future
  CH placement providers; the first target is OVH EU.
- Metering, billing, usage accounting, admin console, fleet console, or
  customer-facing sandbox controls.
- Persisting sandbox bindings, receipts, event streams, or session runtime
  state. Only consumed nonces are durable in v1; restart sweeps stale owned
  containers and sessions are recreated.
- Expanding, preserving as a second production path, or fully deleting the
  legacy V0 agent-owned remote-worker protocol. S5 routes around it through the
  V1 provider; mechanical V0 retirement is a separate hygiene change.
- New adversarial probe families beyond the committed qualification/runtime
  harness, automated escape canaries, a CVE game day, or full SBX1.5 fleet
  operations. Existing committed checks must all be green; no check is waived.
- Building a registry service. S4 consumes an operator-selected private
  registry and pins the resulting immutable workload digest.
- A second helper container/image. The v1 workload image and root-owned helper
  binary are pinned by the cohort bundle.

## Owner gate / next action

Owner approval of this r1 plan authorizes materializing S1-S5 as five ready
Beads/implementation PRs with the file scopes and proof paths above. No Beads
are created by this docs-only PR, and no production configuration changes occur
before that gate.
