---
github: https://github.com/hachej/boring-ui/issues/1081
issue: 1081
state: needs-owner-approval
updated: 2026-08-11
revision: r1
flag: BORING_AGENT_MODE=remote-worker
track: owner
---

# gh-1081 — SBX1.4 internal-first sandbox service execution plan r1

> **Unified into PR #1220.** This execution plan and the sandbox architecture/
> vision ([`../../direction/sandbox-service-architecture.md`](../../direction/sandbox-service-architecture.md))
> are the same product at two altitudes and are reviewed as one owner-gate. This
> plan originated as PR #1219 (branch `agent/docs-sbx14-plan`); PR #1219 is
> superseded by #1220.
>
> **Review lineage preserved (do not lose):** this plan was adversarially
> reviewed before unification — **L1 (Opus)** required changes applied in commit
> `e17242958`, **L2 (Fable)** findings applied in commit `0aedd1a9d` (rotation
> dual-verify overlap, SKU/MagicDNS procurement constraints, honest manual
> reminder step). See PR #1219 history for the full review record.
>
> This is the authority on *what ships first*; the architecture doc is the
> authority on *what those slices are slices of*.
>
> **Implementation-grade deepening (2026-08-11):** each slice now carries a
> "Files and modules touched," concrete API/RPC/schema/DDL shapes, and a
> "Grounded in E2B" note citing the specific E2B pattern being mirrored
> (`references/e2b-internals-architecture.md`,
> `references/control-plane-api-spec.md`). A new "v1 structure recommendation"
> section applies e2b-internals §8's structure-rec as the actual package/module
> layout. This pass **deepens** the plan; it does not undo any L1/L2/adversarial
> fix (transactional nonce uniqueness, public-opening gate, honest dogfood
> framing, E2B-shaped-subset, honest Layer-2/Layer-4 "measured not built"
> caveats all preserved).

## Plan methodology & template crosswalk

This plan is authored to the repository's iterative-planning standard
(`.agents/skills/plan/SKILL.md` → `docs/procedures/issue-plans.md`,
`docs/procedures/bead-ready.md`). It uses the issue-plan body sections under
epic-specific names, keeps **one slice where possible** but splits into six
because the work exceeds a single review budget and is stacked/ordered, frames
every slice **Today → Delta**, attaches a **proof path per slice**, and runs the
mandated **adversarial cross-model review before the owner gate** (never
self-certified — Model Card L1 Opus → L2 Fable, recorded in the header lineage).

| `issue-plans.md` body section | Where it lives here |
| --- | --- |
| Problem / Solution | **Outcome**, **Today / target delta** |
| Decisions | **Decisions that constrain every slice** |
| Flag / Abstraction | frontmatter `flag: BORING_AGENT_MODE=remote-worker`; rollback in each slice's **Slice rollback** and **End-to-end rollback story** |
| Test Seams | each slice's **Today** (existing prior art / highest public seam) + **Acceptance and proof** (what to assert, what not to fake) |
| Acceptance / Proof | each slice's **Acceptance and proof** (exact commands) |
| Slices | **S1–S5** (S3 split S3a/S3b), each with Size, **Review budget** verdict, **Bead** (materialized at the owner gate), Blocked by, Delivers, Proof |
| Out of Scope | **Explicit non-goals** |
| Open Questions / gate | **Gate 0**, **Owner gate / next action** |

Per `issue-plans.md`, the **bead graph — not this markdown — is what the Beadle
dispatches from**; this doc's owner gate authorizes materializing the six slices
as six Definition-of-Ready beads (WHAT, proof path, file scope, fits one
session). No beads are created by this docs-only PR.

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
        | HTTPS over Tailscale + one pre-shared bearer secret
        v
one rented EU KVM VM (OVH for v1; no public listener)
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

## Daemon exposure and threat model

The v1 daemon deliberately runs as root and can invoke Docker and the root
quota helper. Its static secret is therefore **host-root-equivalent**: an
attacker who obtains that secret can mint accepted capabilities, drive the
root/Docker-authorized service, and should be assumed able to compromise the
whole worker VM. Runsc remains the tenant boundary for admitted workloads; it
does not reduce the consequence of compromising the trusted daemon or secret.

The transport decision is **Tailscale-only ingress with HTTPS**:

- Seneca and the worker join one operator-owned tailnet. The provider firewall
  denies public ingress to the worker; a tailnet ACL allows only the named
  seneca node/service identity to reach the worker HTTPS port.
- Caddy on the worker terminates TLS on the worker's `tailscale0` address using
  the tailnet DNS name and a certificate obtained and renewed with
  `tailscale cert`. Caddy proxies to the daemon's loopback-only HTTP listener.
  The public interface has no HTTP or HTTPS listener.
- Plaintext is allowed only on loopback between Caddy and the daemon. Plaintext
  on a provider-private network or across the tailnet is explicitly forbidden.
  Seneca continues to pin the expected CA/server name as defense in depth.
- Tailscale-only ingress is preferred over a provider firewall allowlist
  because v1 must not assume stable seneca egress IPs. Provisioning must prove
  both the interface bind and firewall/ACL policy before admission.

mTLS was considered and deferred for this single operator-controlled canary:
Tailscale already authenticates node identity and encrypts the overlay, HTTPS
authenticates the service, and request-bound HMAC capabilities authenticate
application requests. Adding a second certificate issuance and rotation plane
would increase failure modes without replacing the static-secret rotation
requirement. Reconsider mTLS before accepting ingress outside the tailnet or
adding independently administered clients.

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

1. One epic branch may carry the plan, but implementation is six ordered,
   independently reviewed PRs. Each PR remains within the normal review budget
   (about 1,500 added production lines); if it cannot, the implementer returns
   to the owner instead of silently widening a slice.
2. The daemon owns trusted filesystem roots. No HTTP request may supply a host
   path, Docker socket, image override, or qualification override.
3. Production uses HTTPS over the Tailscale-only path defined in the threat
   model. Caddy terminates TLS with a Tailscale-issued certificate; plain HTTP
   is allowed only for in-process tests and Caddy-to-daemon loopback. The V1
   fleet config continues to pin CA and server name.
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

## v1 structure recommendation (E2B-grounded module layout)

This section applies `references/e2b-internals-architecture.md` §8 ("Structure
recommendation for OUR sandbox product") directly to the packages/modules this
plan builds. E2B's shape is three tiers — control-plane `api` (placement +
state) → per-node `orchestrator` (VM mechanics) → in-VM `envd` (guest agent)
(e2b-internals §1, §2). v1 mirrors those tiers but **collapses the pool sprawl
onto one box**, exactly as e2b-internals §8 "v1 (minimal — collapse
aggressively)" prescribes. No new package is created: everything lands in the
already-shipped `packages/boring-sandbox` behind the frozen `SandboxProviderV1`
contract, plus the in-guest agent in `packages/boring-bash`.

### Tier → module map

| E2B tier (e2b-internals) | E2B component | Our v1 module | Collapsed from E2B how |
| --- | --- | --- | --- |
| Control-plane API + placement (§1 `api`, §2, §8) | `packages/api` gRPC front door + `internal/orchestrator` scheduling, minus Nomad/Consul | **`packages/boring-sandbox/src/worker/**`** — the S1 daemon: HTTP/SSE server, the seven V1 routes, capability+nonce auth, admitted-cohort load, single-worker placement config | E2B splits `api` (control plane) from `orchestrator` (data plane) across node pools; v1 **collapses both onto one process on one box** (e2b-internals §8 "One control-plane daemon = `api` + placement, minus Nomad/Consul"). No Nomad, no Consul catalog, no separate `client-proxy`. |
| Per-node orchestrator (§1 `orchestrator`, §2 data plane) | `packages/orchestrator` microVM lifecycle (`pkg/sandbox`, Firecracker, UFFD, NBD, portmap/proxy/dns) | **`packages/boring-sandbox/src/providers/runsc/**`** — `RunscSessionRuntimeV1` (`runtime/sessionRuntime.ts`) driving Docker+runsc via `dockerRunner.ts`/`dockerArgv.ts` | E2B's orchestrator owns Firecracker; v1's node agent wraps whatever `SandboxProviderV1` abstracts — **container-under-runsc first, Firecracker later** (e2b-internals §8 "One node agent = E2B's `orchestrator`, but wrap whatever isolation `SandboxProviderV1` already abstracts"). The daemon calls the runtime **in-process**, not over gRPC, because control plane and data plane are the same box in v1. |
| Provider seam (§8 "keep the provider seam") | `orchestrator` gRPC `SandboxService` — `Create/Update/List/Delete/Pause/Checkpoint` (e2b-internals §1 appendix, §8) | **`SandboxProviderV1`** (`packages/boring-sandbox/src/shared/providerV1.ts`) — the already-frozen contract, sitting on the **consumer side of the wire**: Seneca composes the `remote-worker` provider through it (S5). The daemon's routes proxy **in-process to `RunscSessionRuntimeV1`**, not to this interface. | E2B keeps `api`↔`orchestrator` as a gRPC boundary so a Firecracker backend swaps in without touching the control plane. Ours is the analogous swap seam realized as a **TS interface**, not gRPC — but honestly: today's `SandboxProviderV1` surface is `create`/`invalidate?`/`close?` plus the returned pair's `Sandbox`/`Workspace`/`dispose()`; it does **NOT** currently mirror the six-RPC set (`Update`/`List`/`Pause`/`Checkpoint` have no direct methods; renew/exec/fs live on the pair). e2b-internals §8's "should mirror exactly that RPC set" is a **recommendation**, a v2-entry alignment to do when the microVM provider lands behind the frozen contract — not a v1 fact. |
| In-VM guest agent (§1 `envd`, §3) | `packages/envd` — Process gRPC + Filesystem gRPC + HTTP bulk file I/O + port scanner + per-sandbox secure token | **`packages/boring-bash`** — the in-guest exec/fs process (architecture §2 Layer 4) | E2B's `envd` is "the analog of our boring-bash" (e2b-internals §1, §3). v1 ships boring-bash as-is; the envd-shaped interface split is the **Layer-4 alignment target** detailed below (measured at v2 entry, not rebuilt in v1 — architecture §2 Layer 4, §6). |

### What v1 deliberately does NOT create (collapse decisions)

Grounded one-for-one in e2b-internals §8 "Collapse (v1)" and "Skip":

- **No `client-proxy`** (E2B `packages/client-proxy`): sandbox routing folds into
  the single daemon. There is no `<port>-<sandboxId>.domain` ingress in v1;
  `getHost(port)` public URLs are a v2 gap (control-plane-api-spec §1.4, §5 v2).
- **No Redis tier** (E2B cache/locks): routing/locks fold into the SQL table +
  in-process state. The nonce store is the only durable coordination primitive
  and it is SQLite (S2), matching e2b-internals §5 "Redis-tier state can start as
  an in-process/SQLite table at our scale."
- **No ClickHouse** (E2B analytics/metrics): explicitly off the orchestration
  hot path; no metrics store ships (e2b-internals §5, §8 "drop Redis/ClickHouse
  tiers").
- **No Nomad/Consul/Terraform placement** (e2b-internals §7 "biggest weld"): the
  single-worker config replaces the scheduler + node registry + health catalog
  wholesale. This is the §2 Layer-2 "constant placer as config" decision.
- **No separate `auth`/Ory or `dashboard-api`** (e2b-internals §6, §8 "Skip"):
  the one static secret + capability/nonce codec is the entire auth surface.
- **No separate template-manager/build pool** (e2b-internals §4): the workload
  image is built and pinned by the S4 runbook, not a running build service.

### The one SQL store

e2b-internals §5 names Postgres as E2B's orchestration source-of-truth and §8
folds it to "one SQL store (Postgres or even SQLite to start)." v1 takes the
SQLite floor: the **only** durable state is the consumed-nonce table (S2,
`/var/lib/boring-worker/security/nonces.sqlite`). Sandbox records, bindings,
receipts, and routing stay **in-process and volatile** (recreated on restart via
`startupSweep()`), which is the honest v1 minimum — E2B persists sandbox records
because it survives control-plane restarts across a fleet; v1 has one box and
recreates sessions, so only replay-defense state must be durable (plan Decision 5,
§S2).

## Slice order

```text
S1 daemon + V1 transport
  -> S2 durable nonces
  -> S3a admitted image pin
  -> S3b real V3 harness upgrade
  -> S4 rented-VM provisioning + manual qualification
  -> S5 seneca canary flip
```

S4 infrastructure preparation may start while S1-S3b are reviewed, but its
admission run is blocked on S3b and must use the exact artifacts produced after
it. S3a alone establishes the fail-closed admitted-image posture; it does not
make the S4 transcript runnable. S5 is blocked on all prior slices.

## S1 — minimal daemon, static-secret auth, and runtime proxy

**Size:** M, upper edge (2-4 days; explicit owner review-budget check before
implementation).  
**Bead:** materialized at owner gate (S1).  
**Review budget:** inside, contingent — composition + one small codec over
already-shipped protocol/registry/runtime; the pre-implementation estimate MUST
confirm ≤ ~1,500 added prod LOC or return to the owner for an explicit S1a/S1b
split (Decision 1). Never hide an oversized PR.  
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
- Bound connection volume before runtime access: set a server-wide maximum of
  128 concurrent connections, a configured maximum of 32 active sessions, a
  10-second header timeout, and a 15-second idle keep-alive timeout. Reaching a
  cap fails closed with a stable retryable busy response and does not call the
  runtime; the operator may lower, but not silently raise, these v1 ceilings.
- Rate-limit failed authentication both server-wide and by the tailnet source
  address Caddy forwards over the trusted loopback hop, using bounded in-memory
  token buckets (10 failures per minute, burst 10) and exponential retry
  backoff from one second to 30 seconds. Reject forwarded-source headers on any
  non-loopback connection. Apply the limiter before token decoding beyond the
  work needed for constant-time verification and before any runtime call; bound
  its key count and expiry so random sources cannot create unbounded state.
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

### Files and modules touched

New, all under the already-shipped `packages/boring-sandbox`:

- `src/worker/createWorkerDaemon.ts` — composition root. Wires the loaded static
  secret + token codec, the admitted-cohort value (S3a), one
  `RunscSessionRuntimeV1`, one `RemoteWorkerSandboxBindingRegistryV1`
  (`src/providers/remote-worker/bindingRegistry.ts`), the daemon-owned host
  watcher, and the HTTP router into one `http.Server`. This is the v1 analog of
  E2B `packages/api`'s composition (e2b-internals §2 request-flow), minus the
  Nomad/Consul cluster wiring in E2B `internal/clusters`.
- `src/worker/router.ts` — the seven V1 routes below (unauthenticated `health`
  plus six capability-guarded sandbox routes), each: body-bound → content
  type/schema check → limiter → capability decode/verify → binding authorize →
  runtime proxy → redacted response. No route reaches the runtime before all
  guards pass.
- `src/worker/tokenCodec.ts` — the versioned shared codec (capability
  issuer/authenticator + binding-receipt signer/verifier), the only production
  implementation of the abstract `RemoteWorkerCapabilityAuthenticatorV1` /
  `RemoteWorkerBindingReceiptAuthenticatorV1` interfaces already declared in
  `bindingRegistry.ts` (lines 34/40). Derives domain-separated HMAC-SHA-256
  subkeys `boring.remote-worker.v1/capability` and
  `boring.remote-worker.v1/binding-receipt` from the single static secret.
- `src/worker/authRateLimiter.ts` — bounded in-memory token buckets keyed by the
  Caddy-forwarded tailnet source (rejected on any non-loopback hop).
- `src/worker/hostWatcher.ts` — daemon-owned chokidar watch over the trusted
  bind-mount source, reusing the `node-workspace` primitive
  (`src/providers/node-workspace/**`); backs the SSE `fs/events` stream.
- `src/worker/bin.ts` — the systemd `ExecStart` entrypoint (startup sweep →
  cohort load → nonce DB open → listen).
- `src/providers/remote-worker/httpTransport.ts` — the production
  `RemoteWorkerTransportV1` (`transport.ts` interface): `fetch` for unary verbs,
  a bounded SSE reader for `openEventStream`. This is the client half S5 reuses.

### HTTP surface — the minimal v1 endpoint list

The daemon's API surface is exactly the "minimal v1 API cut" of
`references/control-plane-api-spec.md` §5 / §2.1, at the internal-daemon
`/internal/v1/...` prefix that exists today (the public `/v1/...` rename is a
v1.1 no-schema-change decision, architecture §9.0):

| Verb + path | Op | Guards before runtime | Binds to E2B `SandboxService` RPC |
| --- | --- | --- | --- |
| `GET /internal/v1/health` | health | none (public admission facts only) | (no direct RPC — E2B exposes cluster health via Consul; ours is a single-box evidence/digest gate) |
| `POST /internal/v1/sandboxes` | create | body-bound → schema → limiter → capability(create) → deterministic `sandboxId` → digest pin (S3a) | `SandboxService.Create` |
| `POST /internal/v1/sandboxes/:id/exec` | exec | + binding authorize by `sandboxId` | (envd `Process.Start`, proxied) |
| `POST /internal/v1/sandboxes/:id/fs` | fs | + binding authorize | (envd `Filesystem.*` + HTTP up/download) |
| `GET /internal/v1/sandboxes/:id/fs/events` | events | + binding authorize, bounded SSE | (envd `Filesystem.WatchDir`) |
| `POST /internal/v1/sandboxes/:id/renew` | renew | + binding authorize | `SandboxService.Update` (TTL) |
| `DELETE /internal/v1/sandboxes/:id` | delete | + binding authorize | `SandboxService.Delete` |

`list`, `pause`, `checkpoint` from E2B's RPC set (e2b-internals §1 appendix) are
deliberately absent in v1: `list` is v1.1, `pause`/`checkpoint` are the v2 UFFD
snapshot/restore tier (control-plane-api-spec §5; architecture §9.1). The daemon
does not invent verbs beyond this fixed set — Decision 4.

### Grounded in E2B

- **Mirrors E2B's `SandboxService` RPC set, not its transport.** e2b-internals §1
  appendix confirms `service SandboxService { Create, Update, List, Delete,
  Pause, Checkpoint }`, and §2 shows `api` never touches a VM directly — it
  speaks gRPC to the orchestrator's `SandboxService`. Our six sandbox routes
(health aside) are the same
  lifecycle verbs (Create/Update=renew/Delete + the exec/fs data path envd
  serves), but over HTTP+SSE instead of gRPC, because v1 **collapses the
  api↔orchestrator boundary onto one box** (e2b-internals §8 v1). The
  control-plane/data-plane split E2B makes physical across `api` and `client`
  node pools (e2b-internals §1 "Node pools", §2) is, in v1, an in-process
  function call from the router to `RunscSessionRuntimeV1`.
- **Our auth is deliberately NOT E2B's team API-key.** e2b-internals §6: E2B uses
  (1) a long-lived team API key at the edge (`api/internal/middleware`, Postgres
  + Redis cache) and (2) a single long-lived per-sandbox bearer `secure_token`
  minted by envd. There is no per-request nonce. Our daemon replaces both with
  the capability-token + single-use-nonce codec at the same choke point
  (e2b-internals §6 "we'd swap its single `secure_token` for our nonce-scoped
  capability check at the same choke point, `internal/api/auth.go` equivalent").
  The trade-off — a public SDK cannot present one static key — is why the edge
  compat shim exists (control-plane-api-spec §3.1), and that shim is explicitly
  v2, not this slice.
- **Tailscale-only bind mirrors E2B's private data-plane assumption.** E2B's
  orchestrator/envd are never public; only `client-proxy` faces inbound sandbox
  traffic (e2b-internals §1). v1 has no client-proxy, so the daemon has no public
  listener at all — Caddy on `tailscale0` is the only ingress (threat model
  above), which is the honest single-box degenerate of E2B's "api pool faces the
  internet, client pool does not" topology.

### Layer-4 alignment target — boring-bash mirrors envd's split (measured, not rebuilt in v1)

**Honest status (architecture §2 Layer 4, §6):** no S1–S5 slice performs the
boring-bash↔envd alignment; v1 ships boring-bash as-is and the gap is only
*measured* by the v2 extraction spike (architecture §5 step 4). This subsection
specifies the **target shape** the in-sandbox exec/fs interface must converge to,
so S1's daemon-side verbs are shaped to accept it without a later reshape — the
"interface that must be right now" in the sense of *not foreclosing the split*,
not in the sense of building it.

E2B's `envd` (e2b-internals §3, the stated analog of boring-bash) splits the
guest agent into three surfaces, and boring-bash's exec/fs interface should
mirror that split:

1. **Streaming RPC for exec + fs-metadata.** envd's `Process` service
   (`spec/process/process.proto`) is streaming: `Start` streams output events,
   plus `Connect`/`List`/`Update`/`StreamInput`/`SendSignal`/`CloseStdin`; its
   `Filesystem` service streams `Stat`/`MakeDir`/`Move`/`ListDir`/`Remove` and
   `WatchDir` (e2b-internals §3). Our in-guest `Sandbox.exec` already carries the
   streaming primitives (`onStdout`/`onStderr`/`onHeartbeat` byte callbacks,
   `signal`, `timeoutMs` — control-plane-api-spec §2.2), and `Workspace.watch()`
   backs `fs/events`. The alignment gap is that the *wire* `exec` response is a
   buffered base64 blob today (streaming stdout/stderr is the v1.1 target,
   architecture §9.2); the daemon's exec route is shaped so a streaming response
   is an additive change, not a verb reshape.
2. **Plain HTTP for bulk file content.** envd keeps file *content* read/write
   **out of the proto** and serves it over HTTP (`internal/api/{upload,download}.go`),
   reserving gRPC for metadata (e2b-internals §3 "File content read/write is NOT
   in the proto"). v1's `fs` op carries binary as base64 ≤ 6 MiB inline — the
   honest v1 limit; the streamed/signed-URL bulk path is the v1.1 item
   (control-plane-api-spec §2.3, §5). Mirroring envd means bulk content should
   graduate to a dedicated HTTP transfer surface, not grow the JSON `fs` union.
3. **Port scanner.** envd's `internal/port` (`scan.go`, `scan_subscriber.go`)
   autonomously detects guest listeners and surfaces them to the proxy
   (e2b-internals §3). v1 has no `getHost(port)` and no client-proxy, so the
   port-scanner concept is a **v2 deliverable** (control-plane-api-spec §5 v2);
   it is named here only so boring-bash's guest surface reserves the seam.

envd mints a per-sandbox `secure_token` at init to authenticate all guest calls
(e2b-internals §3, §6). v1 does **not** adopt a guest-minted bearer: the daemon
is the trust root and the runsc workspace is reached over the daemon-owned
bind-mount, not an authenticated guest RPC. Adopting envd's init handshake +
token is part of the same v2 alignment, swapping envd's single `secure_token`
for our capability check (e2b-internals §6).

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
- Repeated bad-bearer requests are throttled before runtime calls; connection,
  active-session, idle, and header bounds fail closed under saturation and
  slowloris-style tests without leaking authentication detail.
- The daemon cannot listen until startup sweep and static qualification facts
  load successfully (S3a replaces fixture facts with admitted facts).

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

### Secret rotation

The daemon accepts one primary and, only during rotation, one secondary static
secret from separate root-owned credential files. Both derive the same
domain-separated verification key classes; the daemon signs new receipts with
the configured primary and accepts valid capabilities/receipts from either
secret during the overlap. Startup fails if both files contain the same value
or if an overlap lacks an explicit expiry. The overlap is bounded to one
maximum capability/receipt lifetime plus clock skew; it may not become a
permanent two-secret mode.

Rotate in this order: (1) install the new secret on the daemon as secondary and
restart/drain-check it so both old and new verify; (2) switch seneca's issuer
to the new secret while its verifier accepts receipts from EITHER secret for
the duration of the overlap (the daemon keeps signing with its configured
primary — the old secret — until step 3, so a new-secret-only verifier would
reject every receipt mid-rotation), and confirm a fresh health/create/delete
canary;
(3) wait out the bounded lifetime, promote the new secret to daemon primary,
drop the old secret, and restart/drain-check again. On suspected compromise,
stop new admission and retire active sessions before this sequence; overlap
prevents an availability gap, not continued trust in a stolen secret. S2/S3a
rollback uses this procedure whenever a rollback crosses an authentication or
replay-protection boundary.

## S2 — persistent nonce store and #1167 atomicity

**Size:** M (1-3 days).  
**Bead:** materialized at owner gate (S2).  
**Review budget:** inside — one SQLite store + a four-arg port change and one
injection seam; no binding persistence keeps it small.  
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
  global nonce collision as replay, insert, enforce the global maximum and the
  lower per-workspace active-nonce maximum, and commit (the concrete
  transaction below runs the budget checks after the insert under the same
  held write lock; a failed check aborts the whole transaction). Two daemon processes
  or SQLite connections must never both return `accepted` for one nonce.
- Pin `PRAGMA journal_mode=WAL` and `PRAGMA synchronous=FULL` on every
  production connection before use; startup fails if SQLite does not report
  the requested journal mode. The nonce database must live on a local,
  non-network filesystem whose locking semantics SQLite supports. NFS, SMB,
  distributed/network block gateways without local-filesystem locking, and
  unverified mounts are forbidden; S4 `--check` asserts the resolved database
  path and filesystem type before the daemon starts.
- Preserve the existing stable replay/global-exhaustion error codes. A tenant
  sub-budget exhaustion uses the same fail-closed exhaustion code with no
  tenant counts or identifiers in the response.
- The per-workspace active-nonce sub-budget is a deliberate availability
  addition over the scoping document's minimal path: #1167 finding 1 previously
  treated it as deferrable. It does not expand the single-tenant canary claim.
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

### Files and modules touched

- `src/providers/remote-worker/singleUseNonceStore.ts` — extend the port to the
  four-argument `consume(nonce, workspaceId, expiresAtMs, nowMs)` signature (today
  it is `consume(nonce, expiresAtMs, nowMs)` on the in-memory `Map`, per the read
  source) and keep the in-memory implementation as the unit-test double.
- `src/providers/remote-worker/persistentNonceStore.ts` — new production SQLite
  implementation of the same port using Node's built-in `node:sqlite`
  (`DatabaseSync`).
- `src/providers/remote-worker/bindingRegistry.ts` — add the synchronous
  injectable nonce-store constructor option to
  `RemoteWorkerSandboxBindingRegistryOptionsV1` (line 53); the registry
  constructs `SingleUseNonceStoreV1` inline today (line 204), so the seam is a
  narrow injection point. No binding/receipt persistence is added.

### Concrete SQLite schema and transaction

```sql
-- /var/lib/boring-worker/security/nonces.sqlite  (root-owned, 0600)
PRAGMA journal_mode = WAL;      -- asserted to report 'wal' at startup or fail
PRAGMA synchronous  = FULL;     -- durability across power loss
PRAGMA busy_timeout = <bounded ms>;  -- set via DatabaseSync; exceed => fail closed

CREATE TABLE IF NOT EXISTS consumed_nonces (
  nonce         TEXT PRIMARY KEY,      -- global uniqueness = replay fence
  workspace_id  TEXT NOT NULL,         -- authenticated workspace owns the sub-budget
  expires_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nonce_ws     ON consumed_nonces(workspace_id);
CREATE INDEX IF NOT EXISTS idx_nonce_expiry ON consumed_nonces(expires_at_ms);
```

`consume` runs one `BEGIN IMMEDIATE` transaction (write lock taken at statement
start, so two connections cannot both read-then-insert): (1) `DELETE ... WHERE
expires_at_ms <= nowMs` to evict expired rows and release both budgets; (2)
`INSERT` the nonce — a `PRIMARY KEY` collision is caught and returned as `replay`
without any runtime effect; (3) enforce the global maximum
(`SELECT COUNT(*)`) and the lower per-workspace maximum
(`SELECT COUNT(*) WHERE workspace_id = ?`) before commit, returning `exhausted`
(the existing stable code, no tenant counts leaked) if either is exceeded;
(4) `COMMIT`. Because the lock is held for the whole read-check-insert, two
daemon processes or two `DatabaseSync` connections can **never** both return
`accepted` for one nonce — the `PRIMARY KEY` + `BEGIN IMMEDIATE` pair is the
fencing proof that replaces #918 gate (b)'s boot-epoch column (Decision, owner
gate).

### Grounded in E2B

E2B uses **Postgres as the orchestration source-of-truth** — teams, keys,
templates, sandbox records, quotas (e2b-internals §5 "the state a control plane
MUST hold"). S2 uses **SQLite in the identical role for the single-box v1**:
e2b-internals §8 explicitly folds E2B's SQL store to "Postgres or even SQLite to
start," and §5 says "Redis-tier state (routing/locks) can start as an
in-process/SQLite table at our scale." The narrow but deliberate difference:
E2B persists the *sandbox records themselves* because its control plane survives
restarts across a multi-node fleet and must re-find running VMs; v1 has one box
and **recreates** sessions on restart (`startupSweep()` retires stale
containers), so the *only* state that must be durable is the replay-defense
nonce — bindings/receipts stay volatile (Decision 5). This is the honest minimal
subset of E2B's persistence, not a reduced clone of it. The WAL + local-fs-only
requirement (no NFS/SMB) is the SQLite analog of E2B's assumption that Postgres
runs on a real disk with working locking, not a network filesystem.

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
must be restored, retire all old sessions and follow S1's bounded-overlap
secret-rotation procedure so old capabilities cannot be replayed; otherwise
restore the S2 binary.

## S3a — admitted-cohort load and `startContainer` digest pin

**Size:** S-M (1-2 days; independently capped at the normal review budget).
**Bead:** materialized at owner gate (S3a).  
**Review budget:** inside — a startup loader + one equality gate at
`startContainer()`; independently capped at the normal review budget.  
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
- When forming daemon health/admission facts, require the bundle cohort pin's
  `expectedWorkloadImageManifestDigest` and the fleet/create field
  `expectedImageDigest` to identify the same admitted manifest; test both field
  names so a locally valid but cross-layer-mismatched digest fails closed.

### Files and modules touched

- `src/providers/runsc/runtime/sessionRuntime.ts` — the pin-gate lands at the top
  of `startContainer()` (line 656 in the read source), which both the initial
  `await this.startContainer(record)` (line 308) and the clean-replacement
  `await this.startContainer(record, workspaceReadOnly)` (line 684) flow through,
  so one gate covers create and replacement. The check runs **before**
  `buildDockerRunArgv({...})` (line 661) constructs any argv.
- `src/providers/runsc/runtime/config.ts` — the admitted image digest is passed
  into the runtime as frozen configuration, not read from request input.
- `src/worker/qualificationAdmission.ts` (new) — daemon-startup loader that runs
  the existing strict validators over the operator-installed bundle/evidence
  (`src/providers/runsc/qualificationBundle.ts`,
  `src/providers/runsc/fleetAdmission.ts`,
  `src/shared/qualificationBundle.ts`) and constructs the one frozen
  admitted-cohort value; startup fails closed on missing/malformed/stale/mismatch.
- `src/providers/runsc/runtime/dockerArgv.ts` — unchanged behavior reused:
  `buildDockerRunArgv()` already rejects tags and malformed references
  (`REMOTE_WORKER_REQUEST_INVALID`); S3a adds the *admitted-equality* layer on
  top (`REMOTE_WORKER_UNQUALIFIED`).

### The pin-gate (two rejection classes, both before `docker run`)

1. **Malformed / unpinned reference** → `REMOTE_WORKER_REQUEST_INVALID`, from the
   existing `dockerArgv` tag/format rejection. Test asserts the Docker runner
   (`dockerRunner.ts`) was never invoked.
2. **Validly pinned but non-admitted** `repository@sha256:...` (or a drifted
   bundle) → `REMOTE_WORKER_UNQUALIFIED`. The only allowed reference is derived
   as `<qualified repository>@<expectedWorkloadImageManifestDigest>`; request
   input never selects another repository or digest. Test asserts no Docker
   effect. Cross-layer check: the bundle cohort pin's
   `expectedWorkloadImageManifestDigest` and the fleet/create field
   `expectedImageDigest` must identify the same manifest, tested under both
   field names.

### Grounded in E2B

E2B admits a workload by **template**: `api` accepts a client `templateID`, the
orchestrator fetches the corresponding **build artifact** (chunked, from GCS/S3)
and boots a Firecracker VM from it (e2b-internals §2 request-flow, §4 templates).
The immutable, content-addressed identity of *what runs* is E2B's template/build
digest. S3a is the v1 analog reduced to a single pinned OCI manifest digest: v1
has one workload image, admitted once by the S4 evidence run, and the daemon
constructs the create call from that pinned digest — never a client-supplied
spec (control-plane-api-spec §3.2 "we accept a template *reference* validated
against pinned digests, never raw container params"). E2B's richer
**template/snapshot model** — `create-build`/`resume-build`, UFFD snapshot
restore, `Pause`/`Checkpoint` (e2b-internals §4) — is the **v2 evolution** of
this pin: a v2 provider swaps the single-digest gate for template/snapshot
selection behind the same `SandboxProviderV1` contract (architecture §9.1
pause/resume/snapshot = v2, §5 TAKE row "UFFD snapshot/restore fast-start").

### Acceptance and proof

```bash
pnpm --filter @hachej/boring-sandbox exec vitest run \
  src/worker/__tests__/qualificationAdmission.test.ts \
  src/providers/runsc/runtime/__tests__/sessionRuntime.test.ts \
  src/providers/runsc/runtime/__tests__/dockerArgv.test.ts \
  src/providers/runsc/__tests__/fleetAdmission.test.ts
pnpm --filter @hachej/boring-sandbox run typecheck
pnpm --filter @hachej/boring-sandbox run check:invariants
```

The negative tests must name the security properties: `rejects malformed or
unpinned image before docker run` and `rejects pinned but non-admitted image
before docker run`, covering initial creation and container replacement. S3a
alone unblocks the fail-closed admitted-image posture; S4 remains blocked on
S3b's runnable real-evidence contract.

**Slice rollback:** the gate is not bypassable. A bad admitted artifact is
fixed by reinstalling the last known-good bundle/evidence/image as a unit and
restarting while traffic is drained. If rollback crosses a secret or
replay-protection boundary, use S1's bounded-overlap secret-rotation procedure.
Do not revert to code that accepts tags.

## S3b — real V3 qualification harness upgrade

**Size:** M (2-3 days; independently capped at the normal review budget).
**Bead:** materialized at owner gate (S3b).  
**Review budget:** inside — harness-script upgrade (V2→V3 real path + CLI/env
contract); independently capped at the normal review budget.  
**Blocked by:** S3a.
**Delivers:** a real observe/bound V3 evidence path for the exact external image,
quota helper, and workspace root that S4 admits.

### Today

- `qualify-docker-runsc-isolation.mjs` emits the current V2 envelope and has no
  real observe/bound admission modes.
- `integrate-docker-runsc-runtime.mjs` builds a throwaway image, uses a no-op
  quota stub, and defaults qualification workspaces beneath `/tmp`.
- `qualify-runsc-v3-reference.mjs` is fixture-only and cannot qualify a box.

### Delta

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

#### CLI and environment contract

S3b owns these exact names so S4's privileged transcript is committed and
cannot be improvised during admission:

- `--observe-only`
- `--cohort-spec-out=<path>`
- `--workload-image=<repo@sha256:…>`
- `--qualification-bundle=<path>`
- `BORING_RUNSC_WORKLOAD_IMAGE`
- `BORING_RUNSC_WORKSPACE_ROOT`
- `BORING_RUNSC_USE_INSTALLED_QUOTA_HELPER`
- `BORING_BUSYBOX_BINARY`

`build-qualification-bundle.mjs <cohort-spec.json>` is the positional consumer
of the file written by `--cohort-spec-out`; that positional interface already
exists and S3b preserves it. The existing `RUN_RUNSC_INTEGRATION=1` gate also
remains required for the integration-script invocation.

### Grounded in E2B

E2B's build path is the **template-manager inside `orchestrator`** on a dedicated
`build` node pool: `cmd/create-build` makes the VM artifact, and the artifact is
content-addressed and chunked before the orchestrator will boot from it
(e2b-internals §1, §4). The discipline S3b mirrors is that **the thing that runs
must be an observed, immutable artifact, not an ad-hoc build**: E2B never boots a
VM from an unbuilt template. S3b's `observe → build bundle → bound V3 run →
strict verify` ordering is the single-box analog — the harness must *observe* the
real host/runtime/quota facts, *build* the immutable qualification bundle from
those observations plus the exact pinned workload image, and only then emit
admission evidence bound to that bundle digest. It refuses placeholder/reference
values for the same reason E2B refuses to boot an unbuilt template. The
difference from E2B: E2B's build service runs continuously on the `build` pool,
whereas v1 runs this as a **manual per-box qualification** (Decision 6), because
v1 admits one box by hand — continuous evidence-bound admission is the SBX1.5 v2
target (architecture §5 "SBX1.5 fleet-admission automation").

### Acceptance and proof

```bash
pnpm --filter @hachej/boring-sandbox exec vitest run \
  src/providers/runsc/__tests__/isolationEvidenceDocker.test.ts
pnpm --filter @hachej/boring-sandbox run typecheck
pnpm --filter @hachej/boring-sandbox run check:invariants
```

Tests exercise observe mode, bound mode, deterministic cohort-spec output, the
external-image sibling negative, real quota-helper opt-in, workspace-root
validation, and refusal of placeholder/reference values. They prove the
ordered observe -> build bundle -> bound V3 run -> strict verify flow.

**Slice rollback:** S3a's fail-closed image gate remains in place. Revert only
the unapplied harness upgrade and keep the box unadmitted; S4 cannot run until
the S3b contract is restored and green.

## S4 — rented-VM provisioning script and manual qualification

**Size:** M (2-4 days plus provider provisioning time).  
**Bead:** materialized at owner gate (S4). Ops/security slice — no thermo
docs/config exemption from the two review lines.  
**Review budget:** inside for the committed script + runbook; the admission run
itself is an operator action on the box, not reviewed LOC.  
**Blocked by:** exact S1-S3b release/artifact cohort.
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
  mount, and that the resolved nonce database path is on a supported local
  ext4/XFS filesystem rather than NFS, SMB, or another network filesystem.
  It also proves Caddy listens only on `tailscale0`, its current certificate
  matches the configured tailnet DNS name, the tailnet ACL admits only seneca,
  and the provider firewall exposes no public daemon/HTTP/HTTPS port.
- Pin Docker/runsc versions and downloaded checksums; register runsc with the
  observable `--platform=systrap` runtime arg. Assert KVM virtualization but do
  **not** require `/dev/kvm`.
- Format/mount a dedicated operator-selected data volume as ext4 or XFS with
  project quotas, persist the mount, and make `--check` prove `prjquota` is
  active. The script must require an explicit block device/mount target and
  refuse `/`, the repository, or an unresolved variable. Procurement
  constraint (Gate 0): the VM SKU must offer an attachable second block
  volume — verify before purchase on the chosen provider (OVH/Infomaniak/
  Hikube all sell attachable volumes, but not on every SKU) — and, for the
  Tailscale cert path, MagicDNS + HTTPS certificates must be enabled on the
  tailnet.
- Build/install `/usr/local/libexec/boring-workspace-quota` as root-owned,
  non-writable by the daemon's callers, with its digest in the qualification
  bundle. Configure the worker service, nonce-state directory, workspace root,
  Caddy TLS termination, Tailscale interface/ACL policy, primary/optional
  secondary secret credential files, and bounded systemd restart policy.
- Run the v1 worker service as root: its existing Docker CLI runner and quota
  helper require root-equivalent host authority. Install the helper
  `root:root` mode `0755` (never setuid and never writable outside root). Keep
  the daemon HTTP listener loopback-only; bind Caddy's HTTPS listener only to
  the `tailscale0` address with its Tailscale-issued certificate, no public
  listener, and a tailnet ACL limited to seneca. Apply systemd hardening that
  does not block Docker, the admitted workspace volume, nonce DB, or helper.
  An unprivileged/more granular service account is a later hardening change,
  not an unproven v1 claim.
- Build the workload image from the committed
  `src/providers/runsc/runtime/workload/Dockerfile` at the frozen S1-S3b head,
  push it to the operator-selected private registry, record its canonical
  `repository@manifestDigest`, and pre-pull that exact reference on the worker.
  Registry credentials are root-owned and unreadable by daemon callers; the
  script never prints them.
- Prove host and gVisor `openat2`, project-quota fill/sibling isolation/host
  reserve, root helper `apply`/`check`, runsc sentinel, egress denial, cleanup,
  and the committed hostile probe suite on the exact rented VM.
- Use S3b's real observe/bound V3 harness mode; do not use
  `qualify-runsc-v3-reference.mjs`, which is explicitly a non-admitting fixture.
  Admission has four ordered phases: (1) observe real profile/pins, (2) build
  the immutable bundle from those observations plus the exact S1-S3b files and
  image, (3) rerun the real harness bound to that bundle digest, and (4) require
  `verify-fleet-admission-evidence.mjs` to accept the pair.
- Store the redacted evidence, bundle, exact git SHA, image reference, command
  transcript, and digests as the manual box-admission record. Installing those
  files into the daemon and seneca config is the admission act for this one
  box; there is no scheduled/protected fleet job or automatic candidate-box
  registration.

### Grounded in E2B — which ops concepts map, and which are deliberately manual

E2B runs three ops machines that S4 **collapses into one runbook on one box**:

| E2B ops concept (e2b-internals) | E2B mechanism | S4 single-box mapping |
| --- | --- | --- |
| **Image/template build** (§4) | `template-manager` on the `build` node pool builds the VM artifact; artifacts are content-addressed, chunked, stored in GCS/S3 | S4 builds the workload image from the committed `src/providers/runsc/runtime/workload/Dockerfile`, pushes to an operator-selected **private registry**, and pins the canonical `repository@manifestDigest` read from BuildKit's `image-metadata.json` (cross-checked with `docker buildx imagetools inspect`). No build *service* runs — one build, one pinned digest (§S3a). |
| **Node provisioning** (§1 node pools; §7 Nomad/Consul/Terraform weld) | `iac/` Terraform stands up `control`/`api`/`client`/`build`/`clickhouse` pools; Nomad schedules onto `client` (Firecracker, nested-virt) nodes | S4's `provision-runsc-worker.sh --apply` provisions **one** rented KVM VM: pinned Docker/runsc with `--platform=systrap`, the `prjquota` data volume, the root quota helper, Caddy/Tailscale ingress, systemd unit. This replaces E2B's entire `iac` + Nomad node-pool machinery — e2b-internals §7 names Nomad/Consul/Terraform as "the biggest weld … replace wholesale with our own." |
| **Service discovery / health catalog** (§1 Consul) | Consul is the live catalog of which node runs which sandbox + node health | S4 has no catalog: the single-worker config *is* the registry, and `--check` is the health gate (openat2, prjquota, Caddy bind, tailnet ACL, firewall). Admission = installing evidence into config, not registering with a catalog. |
| **Continuous admission** (architecture §5 SBX1.5) | (E2B assumes healthy nodes stay in the Nomad pool; drift handling is fleet-level) | Deliberately **manual per box** (Decision 6): one green evidence run on the exact box, digests copied into config. Continuous evidence-bound admission, drift fence, and CVE game-day are the SBX1.5 v2 target, explicit non-goals here. |

The net: S4 is the honest single-box degenerate of E2B's `build` + `client` pool
provisioning, with Terraform/Nomad/Consul replaced by one idempotent shell script
and one manual evidence install — exactly the e2b-internals §8 "collapse
aggressively" instruction applied to ops.

### Acceptance and proof

Run the entire block from an audited root login shell on the rented OVH KVM VM,
against the release checkout and an explicit data device chosen by the
operator. The root shell is required because `--apply` intentionally makes the
admission directory root-owned and shell redirections open evidence files
before child commands execute. After `sudo -i`, every command runs uniformly as
root; no per-command `sudo` is mixed into the retained transcript.

```bash
sudo -i
cd <release-checkout>
packages/boring-sandbox/scripts/provision-runsc-worker.sh --apply \
  --data-device /dev/disk/by-id/<operator-selected-id> \
  --mount /var/lib/boring-worker
packages/boring-sandbox/scripts/provision-runsc-worker.sh --check \
  --mount /var/lib/boring-worker
pnpm --filter @hachej/boring-agent run build
pnpm --filter @hachej/boring-sandbox run build
cat /run/credentials/boring-registry-token | \
  docker login <operator-registry> \
  --username <robot-account> --password-stdin
docker buildx build --platform linux/amd64 --push \
  --file packages/boring-sandbox/src/providers/runsc/runtime/workload/Dockerfile \
  --tag <operator-registry>/boring-runtime:<frozen-git-sha> \
  --metadata-file /var/lib/boring-worker/admission/image-metadata.json \
  packages/boring-sandbox/src/providers/runsc/runtime/workload
docker buildx imagetools inspect \
  <operator-registry>/boring-runtime:<frozen-git-sha>
docker pull <operator-registry>/boring-runtime@sha256:<manifest-digest>
docker image inspect \
  <operator-registry>/boring-runtime@sha256:<manifest-digest>
env BORING_BUSYBOX_BINARY=/usr/bin/busybox \
  BORING_RUNSC_WORKSPACE_ROOT=/var/lib/boring-worker/qualification-workspaces \
  node packages/boring-sandbox/scripts/qualify-docker-runsc-isolation.mjs \
  --observe-only \
  --workload-image=<operator-registry>/boring-runtime@sha256:<manifest-digest> \
  --cohort-spec-out=/var/lib/boring-worker/admission/cohort-spec.json \
  > /var/lib/boring-worker/admission/observation.json
env RUN_RUNSC_INTEGRATION=1 \
  BORING_RUNSC_WORKLOAD_IMAGE=<operator-registry>/boring-runtime@sha256:<manifest-digest> \
  BORING_RUNSC_WORKSPACE_ROOT=/var/lib/boring-worker/qualification-workspaces \
  BORING_RUNSC_USE_INSTALLED_QUOTA_HELPER=1 \
  node packages/boring-sandbox/scripts/integrate-docker-runsc-runtime.mjs \
  > /var/lib/boring-worker/admission/runtime-integration.json
node packages/boring-sandbox/scripts/build-qualification-bundle.mjs \
  /var/lib/boring-worker/admission/cohort-spec.json \
  > /var/lib/boring-worker/admission/bundle.json
env BORING_BUSYBOX_BINARY=/usr/bin/busybox \
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
**Bead:** materialized at owner gate (S5).  
**Review budget:** inside — mode/config widening + fail-closed precedence fix +
single-worker config loader; reuses the existing provider adapter.  
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
  all 256 placement buckets to the admitted EU worker — this is the **placement
  seam's single-box implementation** (architecture §2 Layer 2), a constant
  placement realized as config, NOT a hardcoded assumption baked inline into the
  request path. It is deliberately the degenerate one-box case of the v2
  scheduler seam; the named `placeSession(request)→box` code interface is a
  v2-entry refactor and is not built here. The config references absolute
  token/CA files plus the exact evidence, bundle, cohort, and workload digests
  from S4. Raw secret values never enter JSON, logs, client bundles, or PRs.
- Set `qualificationMaxAgeMs` explicitly to seven days for this internal-first
  box. The operator re-runs S4 qualification at least every six days and after
  any kernel, Docker, runsc, daemon/provider, helper, policy, or image change.
  The named owner is the seneca production operator. Creating the recurring
  six-day requalification reminder is a MANUAL admission-record step the
  operator performs at first admission (the provisioning script prints the
  exact reminder text and the admission-record/runbook links to include; it
  does not pretend to reach a calendar). Missing the reminder
  is not a waiver: expiry still fails create closed.
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
- Before any planned environment flip, stop new canary admission, drain and
  close every canary session, and confirm the daemon reports no active canary
  sessions or `boring-sbx-*` containers. If rollback must retain workspace
  data, a root operator copies the resolved daemon-owned bind-mount source
  `/var/lib/boring-worker/workspaces/<authorized-workspace-uuid>/` into a
  timestamped root-owned archive under
  `/var/lib/boring-worker/rollback-exports/`; the operator verifies the source
  remains beneath the trusted workspace root and records the archive digest.
- Only after drain/close and any required root-side export, restore the captured
  environment revision to `BORING_AGENT_MODE=vercel-sandbox` and redeploy, so
  no session remains in flight across the provider flip. For an emergency that
  cannot drain naturally, explicitly terminate the canary sessions and confirm
  daemon cleanup before restoring the revision. Leave the EU worker and volume
  untouched until seneca health and a Vercel-sandbox canary are green.

### Files and modules touched

- `packages/agent/src/server/runtime/mode.ts`, `runtime/resolveMode.ts`,
  `runtime/modes/providerAdapter.ts`, `host/sandbox.ts` — widen the built-in
  mode id to include `remote-worker` and compose
  `createRemoteWorkerSandboxProviderV1`
  (`packages/boring-sandbox/src/providers/remote-worker/createRemoteWorkerProvider.ts`)
  through the generic `createProviderRuntimeModeAdapter`. Do **not** extend the
  legacy V0 client under `packages/agent/src/server/**`.
- `packages/agent` shared config schema + full-app production-safety allowlist —
  add `remote-worker` as a production-permitted mode.
- `packages/core/src/app/server/createCoreWorkspaceAgentServer.ts` — fail closed
  when `BORING_AGENT_MODE=remote-worker` is combined with legacy
  `BORING_WORKER_BASE_URL`; no precedence rule may silently select V0 (this is
  architecture §3 invariant item 2, the one real code bypass, closed here).
- The single-worker config loader (server-only, from env) — the placement seam
  described next.

### The placement seam (Layer 2) — config, not a scheduler

The single-worker config assigns **all 256 placement buckets to the one admitted
EU worker**. This is the architecture §2 Layer-2 "constant placer as config,"
realized as data, **not** a hardcoded assumption baked inline into the request
path and **not** a `placeSession(request) → box` code interface — no S1–S5 slice
ships that function. The config references absolute token/CA files plus the exact
S4 evidence/bundle/cohort/workload digests; raw secret values never enter JSON,
logs, client bundles, or PRs.

### Grounded in E2B

E2B's placement is the crown-jewel weld: `api` picks a node via
`internal/orchestrator` scheduling against the **Nomad/Consul** catalog, then
speaks `SandboxService.Create` to the chosen orchestrator (e2b-internals §2
"placement/scheduling lives in `api` (control plane)"; §7 "Nomad+Consul do
scheduling, discovery, and health … replace wholesale"). v1's 256-bucket→one-box
config is the **degenerate one-box case** of that scheduler: the constant
function `∀ request → the one EU worker`. Extracting a real
`placeSession(request) → box` interface and putting fleet/warm-pool/bin-packing
logic behind it is the **v2 evolution target** — the surgery the architecture
doc predicts (architecture §2 Layer-2 row, §5 "Introduce a real
placement/scheduler in the control-plane daemon to replace what Nomad+Consul give
E2B"). e2b-internals §8 v2 names the same step: "Introduce a real
placement/scheduler in the control-plane daemon." v1 deliberately does not build
it (guardrail architecture §6, plan non-goals). Likewise the standalone-host
scope rule (authenticated `sessionId` = workspace scope, UUID required before
provider create) is the single-box analog of E2B binding a sandbox to one
orchestrator node in its Consul catalog — v1 has one node, so the scope is the
authorized session, not a catalog lookup.

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
5. Rollback drill: stop admission; drain/close all canary sessions and confirm
   no active canary/container remains; create and digest the root-side archive
   from the daemon-owned bind-mount source when data retention is required;
   then restore `BORING_AGENT_MODE=vercel-sandbox`, redeploy, and prove a new
   canary exec is healthy. Reapply remote-worker only with explicit owner
   approval.
6. Requalification drill with fake time in automated proof and real evidence
   install in staging: new create is rejected after the seven-day boundary,
   the worker is drained/restarted with fresh S4 evidence, and create succeeds
   with the same or newly admitted exact image digest.

**Slice rollback:** the environment revision is the primary rollback. Do not
destroy the remote workspace volume during rollback. Stop admission and
drain/close or explicitly terminate all canary sessions before the flip; no
session may be in flight across it. Export required data with the named
root-side bind-mount archive mechanism before the owner declares rollback
complete; the untouched VM remains available for forensics or resumption.

## Per-slice review protocol

Every implementation PR—S1, S2, S3a, S3b, S4, and S5—is reviewed independently
on its exact head SHA. The two lines are sequential; neither is a substitute
for deterministic proof or owner approval.

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
may reach the owner gate. S1-S3b and S5 are code/security changes; S4 is
ops/security. None may use the docs/config thermo exemption to skip these two
owner-required lines. No slice merges without explicit owner approval.

## End-to-end rollback story

1. **Before S5:** rollback is simply no admission/no routing. Stop the daemon
   or remove the box from the unpublished config; seneca remains on Vercel.
2. **During/after S5:** stop new worker admission; drain/close every canary
   session (or explicitly terminate it during an emergency) and confirm daemon
   cleanup before restoring the captured seneca environment revision with
   `BORING_AGENT_MODE=vercel-sandbox`. No session may be in flight across the
   flip. Redeploy, then verify application health and a fresh Vercel-sandbox
   canary before declaring recovery.
3. Before the flip, retain required canary data with the S5 root-side copy from
   the resolved daemon-owned bind-mount source into a timestamped, root-owned,
   digested archive under `/var/lib/boring-worker/rollback-exports/`. Then stop
   the daemon. Keep the VM, nonce database, evidence, workspaces, and exports
   intact.
4. Never downgrade a live worker to volatile nonces or tag-based images. If a
   binary rollback crosses S2, retire old sessions and follow S1's
   bounded-overlap secret-rotation procedure. If it crosses S3a, restore a
   previously admitted bundle/image as a unit; never bypass the pin.
5. The agent transcript/session list remains host-owned on seneca's durable
   `BORING_AGENT_SESSION_ROOT`, independent of either sandbox provider. Remote
   workspace-only writes are not claimed to appear magically in a new Vercel
   sandbox; only the named root-side archive carries required canary data.

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

Owner approval of this r1 plan authorizes materializing S1, S2, S3a, S3b, S4,
and S5 as six ready Beads/implementation PRs with the file scopes and proof
paths above. Approving r1 also explicitly ratifies replacing #918 gate (b)'s
boot-epoch requirement with transactional cross-connection nonce uniqueness.
No Beads are created by this docs-only PR, and no production configuration
changes occur before that gate.
