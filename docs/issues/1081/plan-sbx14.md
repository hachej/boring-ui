---
github: https://github.com/hachej/boring-ui/issues/1081
issue: 1081
state: needs-owner-approval
updated: 2026-08-11
revision: r2-lean-v1
flag: BORING_AGENT_MODE=remote-worker
track: owner
---

# gh-1081 — SBX1.4 internal-first sandbox service execution plan (LEAN V1)

> **This is the execution plan** — *what ships first*, and how. It is one of the
> documents in the unified owner-gate **PR #1220**:
>
> - [`../../direction/sandbox-service-architecture.md`](../../direction/sandbox-service-architecture.md)
>   — the architecture/vision (*why*, and *what a layer is*).
> - **this file** — the lean v1 execution plan (*how, and when*).
> - [`plan-v2-hardening.md`](plan-v2-hardening.md) — the deferred hardening
>   machinery, each with an explicit re-entry trigger.
> - [`api-spec.md`](api-spec.md) — the control-plane API contract (*the wire
>   surface*). Where this plan needs an endpoint, schema, or auth detail, it
>   **references** api-spec.md rather than restating it.

## Lineage and the LEAN V1 subtraction pass

This plan originated as PR #1219 (branch `agent/docs-sbx14-plan`), superseded by
#1220. It was adversarially reviewed before unification — **L1 (Opus)**, commit
`e17242958`, and **L2 (Fable)**, commit `0aedd1a9d` (rotation dual-verify
overlap, SKU/MagicDNS procurement constraints, honest manual reminder step).
Every L1/L2 fix that survives the lean pass is preserved: the public-opening
gate, honest dogfood framing (v1 Seneca privileged), and the honest
Layer-2/Layer-4 "measured not built" caveats.

**r2 applies a thermo simplification review (Fable) to r1.** The review's core
finding: r1's v1 was *a multi-tenant control plane wearing a single-tenant
costume*. Seneca holds the static secret and mints its own capabilities
client-side (architecture §3), so in v1 the entire capability/nonce/receipt
edifice is cryptographically equivalent to `Authorization: Bearer <secret>`.
Building new **durable, transactional, per-tenant-budgeted** machinery around
the already-merged in-memory registry defends a boundary that does not exist
until the public-opening gate. r2 cuts that machinery to
[`plan-v2-hardening.md`](plan-v2-hardening.md), each item with a named re-entry
trigger, with **zero weakening of the fail-closed posture**.

**Lean v1 slice sequence:**

```text
Gate 0  → S1-lite → S3a → S4-lite → S5
(openat2)  (daemon)  (pin)  (provision+  (seneca
                            admit)       flip)
```

One slice fewer than r1 (S2 removed), two S1 subsystems fewer (rate limiter,
dual-secret rotation), and every fail-closed property intact. What moved to v2
and its trigger is listed per item in [`plan-v2-hardening.md`](plan-v2-hardening.md).

## Outcome

Ship one owner-operated EU sandbox worker for seneca production. Seneca keeps
the agent/control plane; `BORING_AGENT_MODE=remote-worker` sends each agent
session to a Docker container running under gVisor `runsc --platform=systrap`
on one rented Linux VM. The worker exposes the already-merged remote-worker V1
protocol through a minimal HTTP daemon authenticated by one static shared
bearer secret.

The first production admission is deliberately manual: provision the rented VM,
run the repository's committed qualification harness on that exact box and
artifact cohort, require green evidence (11/11 hostile probes on the exact box,
the exact pinned image), then copy the resulting immutable digests into the
single-worker config consumed by seneca and the daemon. There is no fleet
controller in v1.

Success is a seneca production canary session whose filesystem and exec calls
run on the EU worker, whose in-sandbox `uname -r` reports the gVisor sentinel,
and which can be returned to `vercel-sandbox` by one environment rollback.

## Ratified topology and trust boundaries

```text
seneca production (agent/control plane)
        |
        | Tailscale (WireGuard-encrypted) + one pre-shared bearer secret
        v
one rented EU Linux VM (OVH for v1; no public listener)
        |  provider hypervisor = boundary 1
        v
minimal V1 worker daemon -> Docker -> one runsc/systrap sandbox per session
                                      runsc sandbox = tenant boundary
```

- The v1 host is a standard rented Linux VM. The provider virtualizes it
  (typically with KVM), but v1 itself uses **no** `/dev/kvm` — gVisor is
  user-space. `runsc --platform=systrap` needs no `/dev/kvm`. The 2026-08-10
  proof ran the same Docker+runsc shape inside a nested KVM guest and passed all
  11 hostile probes. (`/dev/kvm` and bare-metal/nested-virt are v2
  microVM/Firecracker concerns, not v1 ones.)
- **Security validation:** gVisor's Sentry security model is identical across
  systrap and KVM; platform choice is a performance decision. Systrap is the
  current default and suited to running inside a VM, so v1's choice is not a
  security compromise. ([report](references/gvisor-platform-security.md);
  [gVisor platforms](https://gvisor.dev/docs/architecture_guide/platforms/);
  [gVisor security](https://gvisor.dev/docs/architecture_guide/security/))
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

The transport decision is **Tailscale-only ingress**:

- Seneca and the worker join one operator-owned tailnet. The provider firewall
  denies public ingress to the worker; a tailnet ACL allows only the named
  seneca node/service identity to reach the worker's daemon port. The daemon has
  **no public listener at all**.
- Tailscale is WireGuard: every packet on the overlay is already encrypted and
  node-authenticated. Tailscale-only ingress is preferred over a provider
  firewall allowlist because v1 must not assume stable seneca egress IPs.
  Provisioning must prove both the interface bind and firewall/ACL policy before
  admission.
- Request-bound HMAC capabilities authenticate application requests on top of
  the encrypted, node-authenticated overlay.

mTLS was considered and deferred for this single operator-controlled canary:
Tailscale already authenticates node identity and encrypts the overlay, and
request-bound HMAC capabilities authenticate application requests. Reconsider
mTLS before accepting ingress outside the tailnet or adding independently
administered clients.

### ⚑ OWNER DECISION — HTTPS/Caddy TLS layer over the tailnet

r1 mandated Caddy terminating TLS on `tailscale0` with a `tailscale cert`,
proxying to a loopback-only daemon. **r2 flags this as an owner call, not a
requirement, and does not decide it.** The tradeoff, stated honestly:

- **Tailscale/WireGuard encryption alone (default lean posture):** the tailnet
  is not plaintext on any wire — every overlay packet is already
  WireGuard-encrypted and node-authenticated. Serving the daemon directly on
  `tailscale0` drops Caddy install/config, `tailscale cert` renewal, the
  MagicDNS + HTTPS-certificates procurement constraint (a Gate 0 input), the
  loopback-proxy topology, CA/server-name pinning in the fleet config, and four
  extra `--check` assertions.
- **+Caddy + `tailscale cert` (defense in depth):** a second crypto layer, so a
  Tailscale-coordination-plane compromise loses only encryption, not the ACL
  boundary too. Cost: the ops component and procurement gate above. If the owner
  wants this, it is **defense-in-depth, not a transport requirement** — the
  tailnet already encrypts the wire.

**Provisioning (S4) and config (S5) must support whichever the owner picks.**
Where this plan mentions Caddy/TLS below, treat it as active only if the owner
selects the +Caddy option; otherwise the daemon binds directly to `tailscale0`.

## Today / target delta

| Area | Today on `origin/main` | LEAN V1 delta |
| --- | --- | --- |
| Remote protocol | `createRemoteWorkerProvider.ts`, `protocolClient.ts`, and `pairProxies.ts` implement the V1 client/provider against an abstract transport. | A real bounded HTTP/SSE transport and daemon implement the V1 endpoints. |
| Runtime | `RunscSessionRuntimeV1` creates, execs, mutates files, renews, and retires real Docker+runsc sessions in-process. | The daemon authorizes and proxies every V1 operation to this runtime; no second runtime is built. |
| Replay | `SingleUseNonceStoreV1` is a registry-scoped in-memory `Map` plus expiry heap; `bindingRegistry.ts` is also volatile. | **Unchanged for v1.** The already-merged SBX1.3 in-memory registry stays as-is. All bindings, receipts, and nonces are volatile. Durable/transactional replay defense is deferred (v2, see below). |
| Image admission | The create request carries expected digests, but `sessionRuntime.ts:startContainer` runs the supplied image without comparing it to admitted evidence. | Startup verifies the manually admitted bundle/evidence and every container start/replacement requires its exact `repository@sha256:...` image. |
| Box readiness | The nested-KVM proof is green, while this week's host integration is honestly non-admitting (older runsc returns `ENOSYS` for `openat2`; volume lacks `prjquota`). | The rented VM is provisioned with a known-good systrap runsc, openat2, `prjquota`, and the installed root helper; the committed harness is green on that exact box. |
| Seneca | Production safety accepts `vercel-sandbox`; a legacy V0-style remote-worker adapter exists but `remote-worker` is not a built-in mode. | Seneca composes the V1 `@hachej/boring-sandbox` provider and flips behind `BORING_AGENT_MODE=remote-worker`; the prior mode remains the immediate rollback. |

### Why in-memory nonces are correct for v1 (and #1167 is N/A)

**Because v1 persists nothing, #1167's "persist nonces atomically with
bindings" constraint is not applicable to v1: nothing is persisted, so there is
nothing to make atomic.** The already-merged `SingleUseNonceStoreV1` is
registry-scoped and in-memory; `bindingRegistry.ts` is volatile too. They share
one lifecycle trivially (both die on restart), which is exactly the fail-closed
state #1167 asks for. A durable nonce store defends replay of a *captured*
capability across a daemon restart — but the only party who can capture one is
an attacker already on the WireGuard-encrypted tailnet or on loopback, who per
this plan's own threat model is already host-root-equivalent. In a single-tenant
box where the client is the capability issuer, nonce durability protects nothing
real. Re-entry trigger for the durable store lives in
[`plan-v2-hardening.md`](plan-v2-hardening.md): any durable binding/record
persistence, OR the pre-multi-tenant step.

## Decisions that constrain every slice

1. One epic branch may carry the plan, but implementation is ordered,
   independently reviewed PRs. Each PR stays within the normal review budget
   (~1,500 added production lines); if it cannot, the implementer returns to the
   owner instead of silently widening a slice.
2. The daemon owns trusted filesystem roots. No HTTP request may supply a host
   path, Docker socket, image override, or qualification override.
3. Production ingress is the Tailscale-only path defined in the threat model
   (WireGuard-encrypted, node-authenticated, ACL = seneca only). The HTTPS/Caddy
   TLS layer is an owner decision (see the flagged section above); when selected,
   the V1 fleet config pins CA and server name and Caddy-to-daemon plaintext is
   loopback-only.
4. Stable V1 schemas, request-size ceilings, capability lifetime, binding
   checks, error codes, retry semantics, startup sweep, and hard expiry are
   reused. The daemon does not invent a parallel wire protocol.
5. Bindings, receipts, **and nonces** all remain in memory in v1. Because
   nothing is persisted, #1167's persist-nonces-atomically-with-bindings
   constraint is N/A for v1 (nothing persisted = nothing to make atomic). The
   day a durable binding/record store is introduced, the durable nonce store and
   #1167 atomicity re-enter together as one atomic change with the restart
   regression — see [`plan-v2-hardening.md`](plan-v2-hardening.md).
6. Qualification is manual per box. A green run is accepted only when it names
   the exact worker/provider/workload cohort used by the daemon and seneca
   config. Drift fails closed at daemon startup and provider health comparison.
7. No real seneca traffic reaches the box until S1/S3a/S4 are merged, S4
   evidence is green, and S5's exact configuration is owner-approved.
8. **v1 rotation = coordinated restart with Vercel fallback.** For one operator,
   one client, one box, secret rotation is: update the secret on both ends,
   restart both, ~seconds of canary downtime, with `vercel-sandbox` always
   available as fallback. Zero-downtime dual-secret overlap re-enters when a
   second independently-administered client exists (see v2-hardening).

## Gate 0 — prove openat2 before funding implementation

This is an operator prerequisite, not a code PR or a delivery slice. The
2026-08-10 nested-KVM proof established systrap viability but did not exercise
the workspace helper's mandatory `openat2` call. The older host run proved that
`release-20260706.0` returns `ENOSYS`; no supplied evidence yet proves a runsc
release that admits the real workspace path.

Before S1 begins, provision a disposable rented Linux VM, start with
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

## v1 module layout (E2B-grounded, one box)

v1 mirrors E2B's three tiers — control-plane `api` → per-node `orchestrator` →
in-VM `envd` (see [`references/e2b-internals-architecture.md`](references/e2b-internals-architecture.md)
§1–§3) — but **collapses the pool sprawl onto one box**, per e2b-internals §8
"v1 (minimal — collapse aggressively)". No new package is created: everything
lands in the already-shipped `packages/boring-sandbox` behind the frozen
`SandboxProviderV1` contract, plus the in-guest agent in `packages/boring-bash`.

- **Control plane + placement → `packages/boring-sandbox/src/worker/**`** (the S1
  daemon). E2B splits `api` from `orchestrator` across node pools; v1 collapses
  both onto one process on one box (e2b-internals §8). No Nomad, no Consul, no
  `client-proxy`, no Redis tier, no ClickHouse, no separate `auth`/dashboard, no
  template-manager build pool. Placement is a single worker URL in config, not a
  scheduler (see S5).
- **Node agent / runtime → `packages/boring-sandbox/src/providers/runsc/**`**
  (`RunscSessionRuntimeV1`). The daemon calls it **in-process**, not over gRPC,
  because control plane and data plane are the same box in v1.
- **Provider seam → `SandboxProviderV1`** (`packages/boring-sandbox/src/shared/providerV1.ts`),
  the already-frozen contract, on the consumer side of the wire: Seneca composes
  the `remote-worker` provider through it (S5). e2b-internals §8's "mirror the
  six-RPC set exactly" is a **v2-entry alignment** for when a microVM provider
  lands behind the frozen contract — not a v1 fact (today's surface is
  `create`/`invalidate?`/`close?` plus the pair's `Sandbox`/`Workspace`/`dispose()`).
- **In-VM guest agent → `packages/boring-bash`** (architecture §2 Layer 4),
  E2B's `envd` analog (e2b-internals §1, §3). v1 ships boring-bash as-is; the
  envd-shaped interface split is measured at v2 entry, not rebuilt in v1.

**The one durable store: none.** E2B persists sandbox records because its control
plane survives restarts across a fleet; v1 has one box and recreates sessions
via `startupSweep()`, so v1 persists nothing. (r1 proposed an SQLite nonce
store; r2 defers it — see the in-memory-nonces rationale above and v2-hardening.)

## S1-lite — minimal daemon, static-secret auth, and runtime proxy

**Size:** M (2-4 days; explicit owner review-budget check before implementation).
**Bead:** materialized at owner gate (S1).
**Review budget:** inside — composition + one small codec over already-shipped
protocol/registry/runtime, using the **existing in-memory nonce registry**, no
rate limiter, no dual-secret rotation. The pre-implementation estimate MUST
confirm the honest **~600–750 added prod LOC** (router+codec+transport+watcher+
bin) or return to the owner for an explicit S1a/S1b split (Decision 1). The
inflation that pushed r1 toward a split (dual-secret logic, rate limiter,
forwarded-header trust, their adversarial test surface) is cut, making the
sub-budget claim honest.
**Blocked by:** merged SBX1.3 only.
**Delivers:** a systemd-friendly server-only process and real HTTP transport for
the existing V1 provider.

### Today

- `RemoteWorkerProtocolClientV1` already calls health/create/fs/events/exec/
  renew/delete paths and enforces bounded, strict responses, but
  `RemoteWorkerTransportV1` has no production implementation.
- `RemoteWorkerSandboxBindingRegistryV1` already authenticates request-bound
  capabilities before operations and produces binding receipts, but no route
  invokes it. Its `SingleUseNonceStoreV1` is in-memory and stays that way in v1.
- `RunscSessionRuntimeV1` already owns Docker/runsc session lifecycle. It is
  exercised in-process only.
- **boring-bash needs NO new adapter.** The existing remote-worker provider
  already *is* the adapter: the in-guest boring-bash daemon matches the V1
  remote-worker protocol, so S1 wires the existing provider/runtime, it does not
  build a boring-bash↔daemon shim.

### Delta

- Add a server-only worker composition/entrypoint under
  `packages/boring-sandbox/src/worker/**` and a fetch/SSE implementation of
  `RemoteWorkerTransportV1` under `src/providers/remote-worker/**`.
- Add one versioned shared token codec used by both sides. It canonicalizes the
  existing strict claims/payload schemas and derives separate HMAC-SHA-256
  subkeys for `boring.remote-worker.v1/capability` and
  `boring.remote-worker.v1/binding-receipt` from the single static secret. It is
  the only production implementation of capability issuer/authenticator and
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
- Bound connection volume before runtime access: a server-wide maximum of 128
  concurrent connections, a configured maximum of 32 active sessions, a 10-second
  header timeout, and a 15-second idle keep-alive timeout. Reaching a cap fails
  closed with a stable retryable busy response and does not call the runtime; the
  operator may lower, but not silently raise, these v1 ceilings. **These
  connection/session caps — not a failed-auth rate limiter — are v1's resource
  bound against a buggy/runaway Seneca client (v1's actual threat).**
- Authorize before touching a workspace, watcher, credential resolver, quota
  helper, or Docker. Derive the workspace mount from the daemon-owned data root
  plus the authorized workspace UUID; never accept a host path on the wire.
- Derive `sandboxId` deterministically and opaquely from the authorized
  `(workspaceId, clientLeaseId)` with a domain-separated subkey. A create retry
  after a lost response therefore returns the same sandbox/receipt and cannot
  leak a second container.
- Proxy create/fs/exec/renew/delete into one `RunscSessionRuntimeV1`. Add a
  daemon-owned host watcher over the trusted bind-mount source, reusing the
  existing node-workspace/chokidar primitive. Close watchers on stream expiry,
  delete, daemon shutdown, or lost client.
- V1 does not deliver sandbox credentials in this internal-first slice. Non-empty
  `credentialRefs` fail closed with `REMOTE_WORKER_SECRET_REFERENCE_REJECTED`;
  model credentials remain in the seneca control plane.
- Run `startupSweep()` before listening. On SIGTERM, stop admission, drain
  bounded in-flight work, call runtime shutdown, close the server, and return a
  non-zero exit when cleanup cannot be proven.
- Export a package entry/bin suitable for a systemd `ExecStart`. Do not add
  admin, metrics, console, discovery, or fleet endpoints.

**Deliberately NOT in S1-lite (moved to [`plan-v2-hardening.md`](plan-v2-hardening.md)):**

- **No `authRateLimiter.ts`** (failed-auth token buckets, per-source backoff,
  forwarded-header trust logic). The tailnet ACL admits exactly one node —
  Seneca, which holds the secret — so there is no public edge to brute-force.
  Constant-time comparison (kept) already defeats timing probes, and the
  connection/session caps (kept) bound abuse from a buggy client. Re-entry
  trigger: any non-Tailscale/public ingress.
- **No dual-secret rotation machinery** (primary+secondary files, same-value
  startup check, bounded-overlap expiry, 3-step choreography). v1 rotation is a
  coordinated restart with Vercel fallback (Decision 8). Re-entry trigger:
  multi-operator / compliance policy.

### Files and modules touched

New, all under the already-shipped `packages/boring-sandbox`:

- `src/worker/createWorkerDaemon.ts` — composition root. Wires the loaded static
  secret + token codec, the admitted-cohort value (S3a), one
  `RunscSessionRuntimeV1`, one `RemoteWorkerSandboxBindingRegistryV1` (with its
  existing in-memory `SingleUseNonceStoreV1`), the daemon-owned host watcher, and
  the HTTP router into one `http.Server`.
- `src/worker/router.ts` — the seven V1 routes (unauthenticated `health` plus six
  capability-guarded sandbox routes), each: body-bound → content type/schema
  check → capability decode/verify → binding authorize → runtime proxy → redacted
  response. No route reaches the runtime before all guards pass. (No limiter stage
  — cut.)
- `src/worker/tokenCodec.ts` — the versioned shared codec (capability
  issuer/authenticator + binding-receipt signer/verifier), the only production
  implementation of the abstract `RemoteWorkerCapabilityAuthenticatorV1` /
  `RemoteWorkerBindingReceiptAuthenticatorV1` interfaces already declared in
  `bindingRegistry.ts` (lines 34/40). Derives domain-separated HMAC-SHA-256
  subkeys from the single static secret.
- `src/worker/hostWatcher.ts` — daemon-owned chokidar watch over the trusted
  bind-mount source, reusing the `node-workspace` primitive
  (`src/providers/node-workspace/**`); backs the SSE `fs/events` stream.
- `src/worker/bin.ts` — the systemd `ExecStart` entrypoint (startup sweep →
  cohort load → listen).
- `src/providers/remote-worker/httpTransport.ts` — the production
  `RemoteWorkerTransportV1` (`transport.ts` interface): `fetch` for unary verbs,
  a bounded SSE reader for `openEventStream`. This is the client half S5 reuses.

### HTTP surface

The daemon implements exactly the seven-route v1 endpoint set defined in
[`api-spec.md`](api-spec.md) §2 — the unauthenticated `health` gate plus the six
capability-guarded sandbox routes (`create`/`exec`/`fs`/`fs/events`/`renew`/
`delete`), at the internal-daemon `/internal/v1/...` prefix that exists today.
Each guarded route runs the ordered guard chain — body-bound → schema →
capability decode/verify → binding authorize → runtime proxy → redacted response
— before any runtime access, and the daemon invents no verb beyond this fixed set
(Decision 4). The wire schemas, coverage map, and E2B `SandboxService` RPC
mapping are the contract in api-spec.md, not restated here.

### Grounded in E2B (citations, not restatement)

S1 collapses E2B's `api`↔`orchestrator` gRPC boundary onto one box: the routes
serve the same lifecycle verbs (Create/renew/Delete + the exec/fs data path)
over HTTP+SSE, but the split E2B makes physical across `api` and `client` node
pools is, in v1, an in-process call from the router to `RunscSessionRuntimeV1`
(e2b-internals §2, §8). The capability+nonce auth that replaces E2B's team
API-key and per-sandbox `secure_token` is specified in api-spec §3.4. E2B's
orchestrator/envd are never public; v1 has no client-proxy, so the daemon has no
public listener at all — the tailnet is the only ingress (e2b-internals §1).

### Layer-4 note — boring-bash mirrors envd (measured, not rebuilt in v1)

No S-slice performs the boring-bash↔envd alignment; v1 ships boring-bash as-is
and the gap is only *measured* by the v2 extraction spike (architecture §5 step
4). S1's exec/fs verbs are shaped so the streaming-stdout and bulk-file-HTTP
targets (api-spec §2.2, §2.3, §4) are additive changes, not verb reshapes. v1
does **not** adopt envd's guest-minted `secure_token`: the daemon is the trust
root and the runsc workspace is reached over the daemon-owned bind-mount
(e2b-internals §3, §6). Details in architecture §2 Layer 4 — not restated here.

### Acceptance and proof

- A protocol-conformance test drives the real fetch transport against the real
  daemon process with the existing runtime behind a fake Docker runner. It
  covers create, write/read, exec, SSE mutation event, renew, delete, repeated
  delete/404, hard expiry, bounded body, transport loss, and graceful shutdown.
- Shared-code test vectors prove client-issued capability → daemon verification
  and daemon-signed receipt → client verification, while swapping domains or
  changing any claim fails.
- A create retried after its first response is dropped returns the same sandbox
  id and receipt and leaves exactly one owned container.
- A write originating inside the runsc workspace reaches the daemon's host
  watcher and SSE client. A normal serial file-read then exec sequence succeeds;
  deliberately overlapping fs/exec fails with the existing stable concurrency
  code instead of corrupting state.
- Missing/wrong bearer material is 401 with the stable unauthenticated code;
  malformed/oversize requests fail before runtime/Docker calls; workspace and
  sandbox mismatches are rejected before runtime calls.
- Connection, active-session, idle, and header bounds fail closed under
  saturation and slowloris-style tests without leaking authentication detail.
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
Because v1 persists nothing, rollback never crosses a durable replay-protection
boundary.

## S3a — admitted-cohort load and `startContainer` digest pin

**Size:** S-M (1-2 days; independently capped at the normal review budget).
**Bead:** materialized at owner gate (S3a).
**Review budget:** inside — a startup loader + one equality gate at
`startContainer()`.
**Blocked by:** S1.
**Delivers:** no `docker run` or replacement unless the workload image exactly
matches the manually admitted cohort.

### Today

- `RemoteWorkerCreateRequestV1` and health already carry evidence, bundle,
  cohort, and image digests, and the client compares health facts to static
  placement.
- `buildDockerRunArgv()` already rejects tags and malformed image references;
  `RunscSessionRuntimeV1.startContainer()` can still accept any syntactically
  valid `repository@sha256:...`, even when it differs from qualification.
- Existing bundle and evidence validators can verify immutable cohort facts, but
  the runtime is not configured from their accepted result.

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
  top of `startContainer()` — therefore covering initial start and clean
  replacement — require an exact canonical digest reference and equality with the
  admitted digest **before** constructing/running Docker argv.
- Preserve `REMOTE_WORKER_REQUEST_INVALID` for tags/malformed image references
  rejected by `dockerArgv`; return `REMOTE_WORKER_UNQUALIFIED` for a validly
  pinned repository/digest that differs from the admitted cohort or for a drifted
  bundle. Tests assert the Docker runner was not invoked in either class.
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
   `expectedImageDigest` must identify the same manifest, tested under both field
   names.

### Grounded in E2B (citation)

E2B admits a workload by **template**: `api` accepts a `templateID`, the
orchestrator fetches the content-addressed build artifact and boots Firecracker
from it (e2b-internals §2, §4). S3a is the v1 analog reduced to a single pinned
OCI manifest digest: one workload image, admitted once by the S4 evidence run,
with the daemon constructing the create call from that pinned digest — never a
client-supplied spec (api-spec §3.3). E2B's richer template/snapshot model
(`Pause`/`Checkpoint`, UFFD restore) is the v2 evolution of this pin behind the
same `SandboxProviderV1` contract (api-spec §4; architecture §5).

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
alone establishes the fail-closed admitted-image posture.

**Slice rollback:** the gate is not bypassable. A bad admitted artifact is fixed
by reinstalling the last known-good bundle/evidence/image as a unit and
restarting while traffic is drained. Do not revert to code that accepts tags.

## S4-lite — rented-VM provisioning and manual box admission

**Size:** M (2-4 days plus provider provisioning time).
**Bead:** materialized at owner gate (S4). Ops/security slice — no thermo
docs/config exemption from the two review lines.
**Review budget:** inside for the committed script + runbook; the admission run
itself is an operator action on the box, not reviewed LOC.
**Blocked by:** exact S1/S3a release/artifact cohort.
**Delivers:** one reproducibly configured rented Linux VM (OVH EU) and the manual
admission record for that box.

**Lean scope:** the load-bearing security property is *the exact box passed the
committed hostile probe suite (11/11) on the exact pinned image, openat2/prjquota/
root-helper are real, and the daemon only ever starts the one pinned digest
(S3a)*. S4-lite delivers exactly that: **digest-pin + probes-green-on-the-exact-
box + pinned image + a manual admission record (transcript + digests).** The full
4-phase immutable-bundle evidence formalism (observe→build→bound→verify,
deterministic cohort-spec, cross-layer dual-field digest-equality choreography,
strict verifier) is **fleet-admission machinery pulled forward** — it exists so
*unattended automation* can trust evidence. v1's admission is one human on one box
reading one transcript, so that formalism moves to
[`plan-v2-hardening.md`](plan-v2-hardening.md) (re-entry trigger: public-opening
gate / SBX1.5 fleet-admission automation). Mechanical drift is still caught:
S3a's startup pin + `--check` fail closed on digest mismatch.

### Today

- `/home/ubuntu/kvm-sbx-test/runbook-bare-metal.sh` proves Docker+runsc under
  nested KVM, including the explicit `runsc install -- --platform=systrap`, but
  it creates another QEMU guest and downloads `release/latest` without a
  checksum. That is proof scaffolding, not the v1 production topology.
- The 2026-08-10 KVM proof passed all 11 hostile probes with `release-20260803.0`
  and no `/dev/kvm` dependency.
- This week's SBX1.3 host run passed 12 runtime checks but correctly reported
  three operator follow-ups: older runsc lacks openat2, the volume lacks
  `prjquota`, and the root helper is not installed in the production path.

### Delta

- Convert the useful guest-side steps into an idempotent executable repository
  script, `packages/boring-sandbox/scripts/provision-runsc-worker.sh`, with
  explicit `--apply` and read-only `--check` modes. It configures the rented VM
  directly; it contains no QEMU/cloud-image/nested-KVM creation.
- `--apply` creates the root-owned admission, credential, and workspace
  directories — including `/var/lib/boring-worker/qualification-workspaces` —
  before any BuildKit metadata or evidence is written.
  `--check` asserts fixed tool paths and prerequisites used by the committed
  harnesses: `/usr/bin/docker`, `/usr/bin/findmnt`, `/usr/local/bin/runsc`,
  `/usr/bin/busybox`, Node/pnpm, a C compiler, non-interactive sudo where the
  harness calls it, and Docker access. It proves the qualification workspace root
  resolves beneath `/var/lib/boring-worker` on the `prjquota` mount. It proves
  the tailnet ACL admits only seneca and the provider firewall exposes no public
  daemon port. **If the owner selected the +Caddy option**, `--check` also proves
  Caddy listens only on `tailscale0` and its certificate matches the configured
  tailnet DNS name; **otherwise the daemon binds directly to `tailscale0`** and
  those four cert assertions are absent.
- Pin Docker/runsc versions and downloaded checksums; register runsc with the
  observable `--platform=systrap` runtime arg. Assert the host is a
  provider-virtualized guest but do **not** require or pass through `/dev/kvm`.
- Format/mount a dedicated operator-selected data volume as ext4 or XFS with
  project quotas, persist the mount, and make `--check` prove `prjquota` is
  active. The script must require an explicit block device/mount target and
  refuse `/`, the repository, or an unresolved variable. Procurement constraint
  (Gate 0): the VM SKU must offer an attachable second block volume — verify
  before purchase (OVH/Infomaniak/Hikube all sell attachable volumes, but not on
  every SKU). The MagicDNS + HTTPS-certificates tailnet constraint applies **only
  if the owner selected the +Caddy cert path.**
- Build/install `/usr/local/libexec/boring-workspace-quota` as root-owned
  (`root:root` mode `0755`, never setuid, never writable outside root), with its
  digest recorded. Configure the worker service, workspace root, Tailscale
  interface/ACL policy, secret credential file, and bounded systemd restart
  policy. (If +Caddy: also Caddy TLS termination.)
- Run the v1 worker service as root: its Docker CLI runner and quota helper
  require root-equivalent host authority. Keep the daemon HTTP listener bound to
  `tailscale0` (or loopback behind Caddy if selected), no public listener, tailnet
  ACL limited to seneca. Apply systemd hardening that does not block Docker, the
  admitted workspace volume, or helper. An unprivileged service account is a
  later hardening change, not an unproven v1 claim.
- Build the workload image from the committed
  `src/providers/runsc/runtime/workload/Dockerfile` at the frozen S1/S3a head,
  push it to the operator-selected private registry, record its canonical
  `repository@manifestDigest`, and pre-pull that exact reference on the worker.
  Registry credentials are root-owned and unreadable by daemon callers; the
  script never prints them.
- Prove host and gVisor `openat2`, project-quota fill/sibling isolation/host
  reserve, root helper `apply`/`check`, runsc sentinel, egress denial, cleanup,
  and the committed **11-probe hostile suite** on the exact rented VM, against the
  exact pinned image.
- Store the redacted evidence, exact git SHA, image reference, command
  transcript, and digests as the manual box-admission record. Installing those
  files into the daemon and seneca config is the admission act for this one box;
  there is no scheduled/protected fleet job or automatic candidate registration.

### Manual admission (lean) — commands

Run from an audited root login shell on the rented OVH Linux VM against the
release checkout and an explicit operator-chosen data device. After `sudo -i`
every command runs uniformly as root.

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
# Prove the exact box + exact pinned image: 11/11 hostile probes, openat2,
# prjquota fill/isolation/reserve, root-helper apply/check, sentinel, egress-deny.
env RUN_RUNSC_INTEGRATION=1 \
  BORING_RUNSC_WORKLOAD_IMAGE=<operator-registry>/boring-runtime@sha256:<manifest-digest> \
  BORING_RUNSC_WORKSPACE_ROOT=/var/lib/boring-worker/qualification-workspaces \
  BORING_RUNSC_USE_INSTALLED_QUOTA_HELPER=1 \
  node packages/boring-sandbox/scripts/integrate-docker-runsc-runtime.mjs \
  > /var/lib/boring-worker/admission/runtime-integration.json
```

Admission requires all commands green, zero integration failures, zero operator
follow-ups, **11/11 hostile probes passed**, all positive controls true,
redaction clean, and the pinned image digest matching daemon health. Every
redirected artifact must parse as one JSON document; package-manager banners are
not accepted evidence. The canonical published manifest digest is read from
BuildKit's `image-metadata.json` and cross-checked with `docker buildx imagetools
inspect`; neither a local image ID nor an ambiguous tag is accepted as the pin.

> The r1 4-phase `observe → build-bundle → bound-run → verify-fleet-admission`
> ceremony (with `--observe-only`, `--cohort-spec-out`, `build-qualification-
> bundle.mjs`, `verify-fleet-admission-evidence.mjs`, and the S3b harness upgrade
> that produced them) is deferred to v2 — see
> [`plan-v2-hardening.md`](plan-v2-hardening.md). v1 uses the existing integration
> harness pointed at the external pinned image plus the real quota helper (two
> narrow opt-ins) and a manually reviewed transcript.

### Grounded in E2B (citation)

S4 collapses E2B's `build` + `client` node pools + Terraform/Nomad/Consul weld
(e2b-internals §1, §4, §7 "the biggest weld … replace wholesale") into **one
idempotent shell script + one manual evidence install**: one build → one pinned
digest, one provisioned VM, and the single-worker config as the entire registry —
`--check` is the health gate, admission is installing evidence into config, not
registering with a Consul catalog. Continuous evidence-bound admission is the
SBX1.5 v2 target (architecture §5), not a v1 concern.

**Slice rollback:** do not admit the box, or stop/disable the worker service and
remove it from seneca's single-worker config. Keep the VM, evidence, and
workspace volume intact for diagnosis; deprovisioning is a separate owner action.

## S5 — seneca production flip with rollback

**Size:** M (1-3 days plus deployment observation).
**Bead:** materialized at owner gate (S5).
**Review budget:** inside — mode/config widening + fail-closed precedence fix +
single-worker config loader; reuses the existing provider adapter.
**Blocked by:** S1/S3a/S4 merged and exact S4 evidence accepted.
**Delivers:** V1 remote-worker as a built-in agent mode and one observed seneca
production canary.

> **S5 carries the single most important fix in the whole plan:** the legacy
> `BORING_WORKER_BASE_URL` precedence fail-closed fix (below). It is the one real
> auth bypass in the codebase today.

### Today

- `packages/agent` still limits built-in modes and environment parsing to
  `direct | local | vercel-sandbox`; full-app production safety accepts only
  `vercel-sandbox` without an unsafe override.
- A legacy static-token remote-worker client/adapter exists under
  `packages/agent/src/server/**`, but it speaks the pre-V1 workspace-shaped
  routes. It is not the SBX1.3 V1 provider. **Worse, Core currently selects that
  legacy adapter when `BORING_WORKER_BASE_URL` is present *before* it resolves
  `BORING_AGENT_MODE`, so reusing the legacy env could silently bypass V1.**
- Seneca production uses `BORING_AGENT_MODE=vercel-sandbox`.

### Delta

- Add `remote-worker` to the built-in runtime mode/config schema and production
  allowlist. Compose the existing `createRemoteWorkerSandboxProviderV1` through
  the generic `createProviderRuntimeModeAdapter`; do not extend the legacy V0
  client. Widen the mode id in `runtime/mode.ts`, `runtime/resolveMode.ts`,
  `runtime/modes/providerAdapter.ts`, `host/sandbox.ts`, shared config schema,
  and full-app safety/docs. Supply remote `/workspace` path mapping, readiness,
  cached health checks, and the S1 token codec's issuer/verifier.
- **The precedence fix (most important fix in the plan).** Change
  `packages/core/src/app/server/createCoreWorkspaceAgentServer.ts` so
  `BORING_AGENT_MODE=remote-worker` cannot fall into the earlier legacy
  `BORING_WORKER_BASE_URL` branch. Production startup fails closed when the V1
  mode is combined with legacy V0 env/config; no precedence rule may silently
  select V0. This is architecture §3 invariant item 2 — the one real code bypass,
  closed here.
- Load one server-only single-worker config path from env. **Placement in v1 is a
  single worker URL + digests, not a bucket map** — the config points every
  session at the one admitted EU worker. This is the architecture §2 Layer-2
  "constant placer as config" realized as a **one-line interface stub / one box**,
  NOT a hardcoded assumption inline in the request path and NOT a
  `placeSession(request)→box` code interface (no slice ships that function). The
  256-bucket placement structure r1 specified is a data structure with exactly one
  distinct value; it is deferred to the v2 scheduler that introduces real buckets
  (see [`plan-v2-hardening.md`](plan-v2-hardening.md)). The config references
  absolute token/CA files plus the exact evidence and workload digests from S4.
  Raw secret values never enter JSON, logs, client bundles, or PRs.
- **Requalify on change, not on a calendar.** Rather than a 7-day expiry / 6-day
  manual requal treadmill, the operator requalifies (rerun S4 admission) on any
  change to kernel, Docker, runsc, daemon/provider, helper, policy, or image —
  the triggers the box actually has — plus `--check` at every daemon start. If the
  owner later wants a freshness bound, 30 days matches the real risk better than 7
  (owner call). Installing refreshed evidence requires draining the worker and
  restarting; old evidence remains the rollback artifact.
- Keep `BORING_AGENT_MODE` as the rollout flag. Missing config, CA, token,
  qualification facts, or a mismatched health response fail production startup or
  session creation closed; there is no fallback to direct/local or a second
  worker.
- Preserve the existing standalone-host scope rule intentionally: in
  remote-worker mode, the authenticated `sessionId` is the runtime workspace
  scope rather than `DEFAULT_SESSION_ID`. Require a UUID-shaped authorized seneca
  session/workspace id before provider create; a broader protocol opaque id fails
  before any Docker call.
- Before deployment, record the current seneca environment revision and image.
  Deploy the same app with `BORING_AGENT_MODE=remote-worker` and the config
  secret mounted. Start one owner-selected canary session, verify filesystem
  write/read, exec, gVisor sentinel, renewal, delete, and daemon cleanup, then
  observe normal agent work for the owner-approved window.
- Before any planned environment flip, stop new canary admission, drain and close
  every canary session, and confirm the daemon reports no active canary sessions
  or `boring-sbx-*` containers. If rollback must retain workspace data, a root
  operator copies the resolved daemon-owned bind-mount source
  `/var/lib/boring-worker/workspaces/<authorized-workspace-uuid>/` into a
  timestamped root-owned archive under `/var/lib/boring-worker/rollback-exports/`;
  the operator verifies the source remains beneath the trusted workspace root and
  records the archive digest.
- Only after drain/close and any required root-side export, restore the captured
  environment revision to `BORING_AGENT_MODE=vercel-sandbox` and redeploy, so no
  session remains in flight across the provider flip. For an emergency that cannot
  drain naturally, explicitly terminate the canary sessions and confirm daemon
  cleanup before restoring the revision. Leave the EU worker and volume untouched
  until seneca health and a Vercel-sandbox canary are green.

### Files and modules touched

- `packages/agent/src/server/runtime/mode.ts`, `runtime/resolveMode.ts`,
  `runtime/modes/providerAdapter.ts`, `host/sandbox.ts` — widen the built-in mode
  id to include `remote-worker` and compose
  `createRemoteWorkerSandboxProviderV1`
  (`packages/boring-sandbox/src/providers/remote-worker/createRemoteWorkerProvider.ts`)
  through the generic `createProviderRuntimeModeAdapter`. Do **not** extend the
  legacy V0 client.
- `packages/agent` shared config schema + full-app production-safety allowlist —
  add `remote-worker` as a production-permitted mode.
- `packages/core/src/app/server/createCoreWorkspaceAgentServer.ts` — the
  precedence fail-closed fix above.
- The single-worker config loader (server-only, from env) — one worker URL +
  digests.

### Grounded in E2B (citation)

E2B's placement is the crown-jewel weld: `api` picks a node via
`internal/orchestrator` scheduling against the Nomad/Consul catalog (e2b-internals
§2, §7 "replace wholesale"). v1's single-worker config is the **degenerate
one-box case** — the constant function `∀ request → the one EU worker`. Extracting
a real `placeSession(request)→box` interface with fleet/warm-pool/bin-packing
logic is the v2 evolution target (architecture §2 Layer-2, §5; e2b-internals §8
v2) and is deferred (see v2-hardening). The standalone-host scope rule
(authenticated `sessionId` = workspace scope, UUID required) is the single-box
analog of E2B binding a sandbox to one orchestrator node in Consul.

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
legacy `BORING_WORKER_BASE_URL` **fails startup** (the precedence fix), that
remote-worker scope uses the authorized UUID session id, and that an evidence
refresh restores create without changing the admitted image.

Manual production proof, with secrets redacted:

1. Confirm worker `/internal/v1/health` matches the S4 worker, evidence, and
   image digests.
2. Capture seneca's pre-change environment/image revision; deploy
   `BORING_AGENT_MODE=remote-worker` with the single-worker config mounted.
3. In a new owner-selected canary session, write and read a marker file, run
   `uname -r` and assert `4.19.0-gvisor`, run a bounded command, renew the
   session, close it, and confirm its `boring-sbx-*` container is absent. The
   canary includes the realistic serial sequence read → write → exec → read; it
   sends no `credentialRefs`.
4. Confirm the agent transcript/session history remains on seneca's durable host
   volume, per `BORING_AGENT_SESSION_ROOT`; it is never placed in the sandbox
   workspace.
5. Rollback drill: stop admission; drain/close all canary sessions and confirm no
   active canary/container remains; create and digest the root-side archive from
   the daemon-owned bind-mount source when data retention is required; then
   restore `BORING_AGENT_MODE=vercel-sandbox`, redeploy, and prove a new canary
   exec is healthy. Reapply remote-worker only with explicit owner approval.
6. Requalify-on-change drill: after a simulated runsc/image change, new create is
   rejected until the box is requalified; the worker is drained/restarted with
   fresh S4 evidence, and create succeeds with the newly admitted exact digest.

**Slice rollback:** the environment revision is the primary rollback. Do not
destroy the remote workspace volume during rollback. Stop admission and
drain/close or explicitly terminate all canary sessions before the flip; no
session may be in flight across it. Export required data with the named
root-side bind-mount archive mechanism before the owner declares rollback
complete; the untouched VM remains available for forensics or resumption.

## v1-complete exit criteria (the gate to START v2)

These are **v1-hygiene criteria**: meeting them means v1 is complete and the v2
productization backlog (architecture §5 + [`plan-v2-hardening.md`](plan-v2-hardening.md))
may start. They are **NOT** the gate to open the service to untrusted public
strangers — that is the separate, higher bar below. Each is owner-gated:

1. **Seneca has run production agent traffic on the remote runsc worker for a
   sustained soak** (target: ≥ 4 weeks of real workspaces, no owner-visible
   sandbox regression, no manual daemon babysitting between deploys).
2. **The admission gate is admitting, not just refusing.** A real
   `openat2`-passing runsc cohort exists and the manual box admission binds the
   frozen SBX1.4 digests — today it is refusal-only (the single biggest v1
   blocker; see `references/sbx14-scoping.md`). Delivered by Gate 0 + S4-lite.
3. **Image pinning is enforced.** No container starts unless workload + helper
   digests equal the admitted evidence digests (S3a), fail-closed with a stable
   code.
4. **The control-plane API is the only path Seneca uses.** No `Seneca-special`
   bypass exists, enforced by two concrete invariants (architecture §3): (a) no
   production code path branches on caller identity, and (b) V1-mode combined
   with legacy `BORING_WORKER_BASE_URL` env fails closed (delivered by S5). Part
   (b) ships in S5; **part (a)'s automated `check:invariants` rule is NOT yet
   implemented by any slice** — until it lands, this criterion is not mechanically
   evaluable and cannot be claimed met (owed work, named in architecture §3).
5. **A qualified-box runbook exists and has been rehearsed once** — provision,
   admit, drain, restore — so a second box can be stood up without the owner in
   the loop for every step (S4-lite + S5 rollback drill).

> **Replay-defense-survives-restart is deliberately NOT a v1 exit criterion.**
> r1 listed the persistent nonce store here; r2 removes it because v1 persists
> nothing and the threat it defends cannot exist single-tenant (see the
> in-memory-nonces rationale). It re-enters as a v2-hardening exit criterion at
> its trigger.

Until 1–5 hold, the service stays single-tenant Seneca-only. Meeting them is the
gate to **start** the v2 backlog, **not** authorization to admit untrusted public
strangers — that requires the separate public-opening gate below.

## The public-opening gate — a SEPARATE, higher bar

The v1-complete criteria make v1 *complete*; they say **nothing** about the
isolation/tenancy escalation that opening to untrusted strangers requires. Before
the **first untrusted self-serve stranger** is admitted, all of the following
must hold — a distinct gate, evaluated *after* the v1-complete gate:

1. **Isolation-tier decision (firm position).** Untrusted public self-serve
   **requires the microVM / Firecracker tier plus the continuously-running SBX1.5
   evidence-admission gates.** Shared gVisor is authorized only for trusted /
   first-party tenants until an **explicit, written owner risk-acceptance** for
   shared gVisor lands — contingent on a gVisor CVE-response SLO,
   continuously-running escape canaries, and an abuse pipeline (item 2). The v2
   "gVisor (shared, dense)" tier is not a self-serve-untrusted default until that
   acceptance exists (architecture §4).
2. **Egress + abuse controls.** v1's posture is egress-denial (probed in S4). A
   public product cannot be egress-deny-only, and the moment egress opens, abuse
   handling is a launch blocker: an egress policy (default-deny with per-plan
   allowlisting), rate limits / concurrency and spend caps per tenant, and an
   abuse-detection story (anti-crypto-mining, outbound port-scanning / spam
   detection, takedown path). These are v2 backlog items and explicit
   public-opening blockers (architecture §5).
3. **Multi-tenant auth actually exists.** Per-tenant identity, the edge compat
   shim / server-side capability issuer (api-spec §3.4) so no tenant holds the
   host-root-equivalent secret, per-tenant DoS quotas (the deferred per-workspace
   nonce sub-budget, v2-hardening), and tenant-isolation testing must all exist
   and be tested before the first stranger arrives.

Only when the v1-complete criteria **and** this gate both hold is the service
authorized to open to untrusted public self-serve. Architecture §5 and
[`plan-v2-hardening.md`](plan-v2-hardening.md) are the build backlog that gets us
there.

## Per-slice review protocol

Every implementation PR — S1-lite, S3a, S4-lite, and S5 — is reviewed
independently on its exact head SHA. The two lines are sequential; neither
substitutes for deterministic proof or owner approval.

1. **Line 1 — Opus 4.8 (T2) adversarial review.** Fresh read-only session, given
   the issue, this plan, the slice diff, and proof output. It checks slice
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

Any Fable finding returns the slice to implementation, reruns proof, and restarts
at line 1 on the new SHA. Only `clean` from both lines on the same SHA may reach
the owner gate. S1-lite/S3a/S5 are code/security changes; S4-lite is
ops/security. None may use the docs/config thermo exemption to skip these two
owner-required lines. No slice merges without explicit owner approval.

## End-to-end rollback story

1. **Before S5:** rollback is simply no admission/no routing. Stop the daemon or
   remove the box from the unpublished config; seneca remains on Vercel.
2. **During/after S5:** stop new worker admission; drain/close every canary
   session (or explicitly terminate it during an emergency) and confirm daemon
   cleanup before restoring the captured seneca environment revision with
   `BORING_AGENT_MODE=vercel-sandbox`. No session may be in flight across the
   flip. Redeploy, then verify application health and a fresh Vercel-sandbox
   canary before declaring recovery.
3. Before the flip, retain required canary data with the S5 root-side copy from
   the resolved daemon-owned bind-mount source into a timestamped, root-owned,
   digested archive under `/var/lib/boring-worker/rollback-exports/`. Then stop
   the daemon. Keep the VM, evidence, workspaces, and exports intact.
4. Never downgrade a live worker to tag-based images. If a binary rollback
   crosses S3a, restore a previously admitted bundle/image as a unit; never
   bypass the pin. (v1 has no durable nonce store to downgrade — nonces are
   in-memory and die with the process, which is fail-closed by construction.)
5. The agent transcript/session list remains host-owned on seneca's durable
   `BORING_AGENT_SESSION_ROOT`, independent of either sandbox provider. Remote
   workspace-only writes are not claimed to appear magically in a new Vercel
   sandbox; only the named root-side archive carries required canary data.

## Explicit non-goals

- Multi-tenant auth, users/roles, tenant token issuance, per-tenant VM placement,
  a per-workspace nonce sub-budget, or an identity service. (The sub-budget is a
  deferred v2 availability control, not a v1 claim.)
- A persistent/durable nonce store, transactional cross-connection nonce
  uniqueness, or SQLite/WAL replay state. v1 nonces are in-memory and volatile;
  durable replay defense is v2 (triggered).
- Dual-secret zero-downtime rotation overlap. v1 rotation is a coordinated
  restart with Vercel fallback.
- A failed-auth rate limiter, per-source backoff, or forwarded-header trust
  parsing. Connection/session caps bound v1's actual threat (a buggy client).
- More than one production worker, autoscaling, fleet scheduling, a multi-box
  placement scheduler, a 256-bucket map, automatic candidate registration,
  automatic qualification, or a protected admission CI job. Qualification is run
  manually on the one box.
- The 4-phase immutable-bundle evidence formalism and fleet-admission verifier
  choreography (observe→build→bound→verify, deterministic cohort-spec,
  cross-layer dual-field digest-equality). v1 admits one box by one human reading
  one transcript; the formalism is v2 (triggered).
- VM-per-tenant. That remains a later enterprise placement configuration.
- Self-nested bare metal, creating a QEMU guest, requiring `/dev/kvm`, or
  qualifying runsc's KVM platform. V1 is one provider-rented Linux VM using
  systrap with no `/dev/kvm`.
- A CH production worker in this slice. Infomaniak/Hikube remain valid future CH
  placement providers; the first target is OVH EU.
- Metering, billing, usage accounting, admin console, fleet console, or
  customer-facing sandbox controls.
- Persisting sandbox bindings, receipts, event streams, or session runtime state.
  Nothing is durable in v1; restart sweeps stale owned containers and sessions
  are recreated.
- Expanding, preserving as a second production path, or fully deleting the legacy
  V0 agent-owned remote-worker protocol. S5 routes around it through the V1
  provider; mechanical V0 retirement is a separate hygiene change.
- New adversarial probe families beyond the committed qualification/runtime
  harness, automated escape canaries, a CVE game day, or full SBX1.5 fleet
  operations. Existing committed checks must all be green; no check is waived.
- Building a registry service. S4 consumes an operator-selected private registry
  and pins the resulting immutable workload digest.

## Owner gate / next action

Owner approval of this lean-v1 plan authorizes materializing **S1-lite, S3a,
S4-lite, and S5** as four ready Beads/implementation PRs with the file scopes and
proof paths above. It also asks the owner to decide the flagged **Caddy/TLS
owner-decision** (Tailscale/WireGuard encryption alone vs +Caddy+cert). No Beads
are created by this docs-only PR, and no production configuration changes occur
before that gate. The deferred machinery and its re-entry triggers are in
[`plan-v2-hardening.md`](plan-v2-hardening.md).
