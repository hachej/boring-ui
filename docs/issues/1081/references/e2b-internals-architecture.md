# E2B `infra` Internals — Architecture Study

> **Historical repository study, not the current v1 blueprint.** The component
> inventory and envd/orchestrator mechanics remain useful. Its §7–§8 extraction
> recommendations (container-first, remove Redis/Nomad/Consul, collapse
> client-proxy) are superseded by [`../plan-sbx14.md`](../plan-sbx14.md) and
> [`../tech-choice.md`](../tech-choice.md). Corrected v1 adopts E2B's supported
> public surface with Firecracker, client-proxy, Redis, Postgres, object storage,
> and Nomad/Consul. In E2B's current official architecture, client-proxy reads
> the Redis sandbox-to-node routing catalog; Consul discovers services but is
> not that routing catalog.

Source: `github.com/e2b-dev/infra` (Apache-2.0), branch `main`. All service/dir
names below were read from the actual repo tree (gh API + GitHub tree views),
not guessed. Items I could not confirm from source are marked **[UNVERIFIED]**.

Scope: E2B's **internal service architecture** — how the repo/services are laid
out — to inform how WE structure our sandbox product. (A separate study covers
E2B's public SDK/API surface.)

---

## 1. Service topology

Everything under `packages/` is Go. The whole platform is scheduled as **Nomad
jobs** across **Consul**-discovered node pools. Confirmed `packages/` children:
`api`, `auth`, `clickhouse`, `client-proxy`, `dashboard-api`, `db`, `envd`,
`local-dev`, `nomad-nodepool-apm`, `orchestrator`, `otel-collector`, `shared`.

| Service (dir) | Responsibility | Lang | Talks to | Liftable for v2? |
|---|---|---|---|---|
| `packages/api` | Public control-plane REST API. Sandbox CRUD, templates, teams, auth middleware, quotas, analytics. The front door. | Go | Postgres (`db`), Redis (cache/locks), orchestrator (gRPC via `internal/orchestrator` client), ClickHouse (metrics), analytics collector | **Mostly liftable.** Business logic is portable; the Nomad/Consul cluster discovery in `internal/clusters` is infra-welded. |
| `packages/orchestrator` | Data-plane node agent. Runs on each `client` (Firecracker) host. Owns microVM lifecycle: create/pause/resume/checkpoint/delete, UFFD snapshot restore, rootfs/NBD mounts, per-sandbox proxy, DNS, port mapping. **Also hosts template-manager** (build service). | Go | Firecracker (local), envd (in-VM), GCS/S3 (build storage), api (as gRPC server) | **Core is liftable but heavy.** Firecracker/UFFD/NBD/cgroups logic is the crown jewel; married to Linux+KVM but NOT to a specific cloud. Storage backend is pluggable (local or GCS). |
| `packages/envd` | In-microVM guest daemon. Exposes exec/process, filesystem, port-forward, init/auth over the VM's vsock/HTTP+gRPC. **This is E2B's analog of our boring-bash.** | Go | Runs inside guest; served to orchestrator/client-proxy | **Highly liftable.** Self-contained guest agent; only assumes a Linux guest. Best single component to study/harvest. |
| `packages/client-proxy` | Edge/data-plane reverse proxy. Routes inbound sandbox traffic (`<port>-<sandboxID>.domain`) to the right orchestrator node + envd port. Session/host routing. | Go | Redis sandbox→node routing catalog, orchestrator nodes, API auto-resume | **Concept liftable, code cloud-welded** to their DNS/host scheme + service discovery. |
| `packages/auth` | Authentication service (Ory-based; `fixtures/ory` in repo). | Go | Postgres, api/dashboard | **[UNVERIFIED]** internals; likely replaceable by our own token model — not worth lifting. |
| `packages/dashboard-api` | Backend for the web dashboard (teams, keys, usage views). | Go | Postgres, ClickHouse | Product-specific; skip. |
| `packages/db` | Shared DB layer / migrations / generated queries (Postgres schema owner). | Go | Postgres | Schema is instructive; code skip. |
| `packages/clickhouse` | ClickHouse client/schema for analytics + sandbox metrics. | Go | ClickHouse | Skip (analytics-only). |
| `packages/shared` | Cross-service Go libs: models, gRPC clients, telemetry, env. | Go | all | Reference only. |
| `packages/otel-collector`, `nomad-nodepool-apm` | Observability: OpenTelemetry collector; Nomad node-pool autoscaler/APM. | Go | Nomad, telemetry backends | Infra-welded; skip. |
| `packages/local-dev` | Local dev harness. | Go | — | Skip. |

Non-package infra: `iac/` (Terraform for GCP/AWS), `firecracker/` (kernel +
Firecracker build), `spec/`, `tests/`, `fixtures/ory/`.

**Node pools** (from `self-host.md`): `control` (Nomad/Consul), `api` (api +
client-proxy + ingress + otel/loki), `client` (orchestrator + Firecracker,
nested virt), `build` (template-manager), `clickhouse`. This pool split IS the
control-plane / data-plane boundary made physical.

---

## 2. Control-plane ↔ data-plane split & request flow

**Control plane** = `api` (+ `auth`, `dashboard-api`, Postgres, Redis).
Stateless-ish request handling + persistent orchestration state.
**Data plane** = `orchestrator` + `envd` + `client-proxy` on the `client`/`api`
pools. Owns real microVMs and their traffic.

The boundary: **api never touches a Firecracker VM directly.** It speaks gRPC to
the orchestrator's `SandboxService`; the orchestrator owns everything below.

### Create/exec request path

```
SDK/CLI
  │  HTTPS  (API key)
  ▼
[api]  packages/api/internal/{middleware(auth,quota) → handlers → orchestrator client}
  │      - validates team/API key (Postgres + Redis cache)
  │      - picks a node  (internal/orchestrator scheduling; Nomad/Consul catalog)
  │  gRPC  SandboxService.Create(SandboxCreateRequest)
  ▼
[orchestrator]  (on a `client` node)   packages/orchestrator/pkg/{server,sandbox,scheduling,template}
  │      - fetches template build (GCS/S3, chunked)  ← template-manager artifacts
  │      - starts Firecracker microVM
  │      - UFFD snapshot restore for fast resume (pkg/sandbox + cmd/resume-build)
  │      - sets up network: pkg/{portmap,proxy,dns,tcpfirewall}
  │      - boots guest → envd comes up inside the VM
  ▼
[envd]  (inside the microVM)   packages/envd/internal/{api,services,execcontext,port}
  │      - Process gRPC (Start/exec/stream), Filesystem gRPC, HTTP up/download
  ▼
returns sandboxID + host  → api → SDK

Later exec / file / HTTP traffic to the running sandbox:
SDK ──► [client-proxy]  (routes <port>-<sandboxID>.domain → node+port) ──► [envd] in VM
```

Key insight: **placement/scheduling lives in `api` (control plane), microVM
mechanics live in `orchestrator` (data plane), guest actions live in `envd`.**
Three clean tiers.

---

## 3. envd deep-dive (maps to OUR boring-bash)

Location: `packages/envd`. Go daemon inside every microVM. Interfaces are
defined as **Buf/Connect protobuf** in `packages/envd/spec/{process,filesystem,upgrade}`
plus an **HTTP API** in `internal/api` for bulk file transfer and lifecycle.

Confirmed `internal/` layout: `api`, `services`, `execcontext`, `host`, `logs`,
`permissions`, `port`, `utils`.

### Process service (`spec/process/process.proto`) — gRPC/Connect
- `Start` — launch process (cmd, args, env, cwd), streams output events
- `Connect` — attach a stream to an existing process for output
- `List` — running processes
- `Update` — resize/modify PTY
- `StreamInput` / `SendInput` — send stdin/PTY input (streaming + unary)
- `SendSignal` — SIGTERM/SIGKILL
- `CloseStdin` — EOF for non-PTY procs
- Messages: `ProcessConfig`, `ProcessInfo`, `ProcessEvent` (start/data/end/keepalive), `ProcessSelector` (by PID or **tag**), `PTY`.

### Filesystem service (`spec/filesystem/filesystem.proto`) — gRPC/Connect
- `Stat`, `MakeDir`, `Move`, `ListDir` (depth), `Remove`
- Watch: `WatchDir` (streaming) + polling trio `CreateWatcher`/`GetWatcherEvents`/`RemoveWatcher`
- Events: CREATE/WRITE/REMOVE/RENAME/CHMOD; rich `EntryInfo` metadata.
- **File content read/write is NOT in the proto** — handled over **HTTP** in
  `internal/api/{download.go, upload.go}` (bulk streaming up/download).

### Other envd internals
- `internal/api`: HTTP surface — `init.go` (sandbox init/handshake),
  `auth.go` + `secure_token.go` (per-sandbox auth token), `upload.go`/`download.go`
  (files), `envs.go`, `compose.go`, `fsfreeze.go`, `mounts_handover.go`.
- `internal/port`: **port forwarding + scanning** — `forward.go`, `scan.go`,
  `scan_subscriber.go` (auto-detect listening ports in the guest, expose them).
- `internal/execcontext`, `permissions`, `host`, `logs`.

**Takeaway for boring-bash:** E2B splits the guest agent into (a) a streaming
RPC surface for interactive process + fs-metadata ops, (b) a plain-HTTP surface
for bulk file I/O and lifecycle/auth, (c) an autonomous **port scanner** that
surfaces guest listeners to the proxy. A per-sandbox **secure token** minted at
init authenticates all guest calls — parallels our capability-token+nonce, but
E2B's is a single bearer token, not a nonce-per-call scheme.

---

## 4. Templates & snapshots (fast-start)

- **Template-manager** lives INSIDE `packages/orchestrator` (proto
  `template-manager.proto`; runs on the `build` node pool). Not a separate
  top-level package.
- Build tooling is in `orchestrator/cmd/`: `create-build` (make VM snapshot),
  `resume-build` (boot from snapshot), `copy-build` (move builds between
  storage), `mount-build-rootfs` (NBD mount), `inspect-build`, `show-build-diff`.
- **Fast start = UFFD snapshot restore.** A paused/checkpointed VM's memory is
  restored lazily via userfaultfd; rootfs via **NBD**. `SandboxService` has
  `Pause` and `Checkpoint` RPCs; `cmd/resume-build` + `pkg/sandbox` do restore.
- Build artifacts are **chunked** (`chunks.proto`) and stored in GCS/S3 (or
  local); the orchestrator streams chunks on demand. `volume.proto` +
  `pkg/volumes`/`nfsproxy` handle persistent volumes.
- **[UNVERIFIED]** whether Packer is used — `iac/`/`firecracker/` build the base
  image + kernel; I did not open those files. The snapshot pipeline itself is
  the orchestrator's own Go tooling above, not Packer.

---

## 5. State & data stores

- **Postgres** (`packages/db`, `packages/api/internal/db`): the **source of
  truth for orchestration** — teams, users, API keys, templates/build metadata,
  sandbox records, quotas. This is the state a control plane MUST hold.
- **Redis**: source of truth for running-sandbox state and the sandbox→node
  routing catalog read by client-proxy, plus caches, locks, and rate limits.
  The deployment may use a managed service, but the Redis role is required by
  the adopted E2B public path.
- **ClickHouse** (`packages/clickhouse`): **analytics + sandbox metrics only** —
  not orchestration state. Skippable for a minimal control plane.
- **Consul**: live service catalog for available services/orchestrator nodes and
  their health. It does not replace Redis's running-sandbox or sandbox→node
  routing catalog.

**What OUR control plane must persist (minimal):** teams/tenancy, capability
tokens/keys, template/image refs, live sandbox records (id → node/endpoint →
status → owner), quotas. Everything ClickHouse does is optional. The earlier
idea of replacing Redis routing/locks with in-process/SQLite state is
superseded for the adopted E2B v1 path.

---

## 6. Auth / tenancy internals

- Public auth = **API key per team**, checked in `api/internal/middleware`,
  backed by Postgres and cached in Redis. `internal/team` owns team/org models;
  `internal/oauth` + `packages/auth` (Ory) handle user identity/dashboard login.
- Internal guest auth = **per-sandbox secure token** minted by envd at init
  (`envd/internal/api/secure_token.go` + `auth.go`); all guest RPC/HTTP calls
  carry it. The orchestrator/client-proxy hold the token to reach the guest.
- Contrast with **our capability-token + nonce model:** E2B uses (1) a
  long-lived team API key at the edge and (2) a single long-lived bearer token
  per sandbox at the guest. There is no per-request nonce / capability scoping —
  our model is finer-grained. When we harvest envd, we'd swap its single
  `secure_token` for our nonce-scoped capability check at the same choke point
  (`internal/api/auth.go` equivalent).

---

## 7. Separable vs cloud-welded (extraction-spike guidance)

| Component | Verdict |
|---|---|
| `envd` | **Harvest first.** Nearly standalone; only assumes a Linux guest. Best ROI. |
| `orchestrator` microVM core (`pkg/sandbox`, UFFD, NBD, `cmd/*build`) | **Harvest, high value, high effort.** Cloud-neutral (Linux+KVM+Firecracker); storage backend pluggable. The hard-to-rebuild IP. |
| `orchestrator` networking (`pkg/{proxy,dns,portmap,tcpfirewall}`) | Liftable but tied to their host/DNS scheme; adapt. |
| `api` business logic | Historical extraction idea only; corrected v1 adopts its placement path. |
| `client-proxy` | Concept liftable; code welded to the Redis routing catalog + `<port>-<id>.domain`. |
| Scheduling/placement (E2B API placement + Nomad/Consul + `iac` Terraform) | **Cloud/infra-welded.** Historical extraction candidate; corrected v1 adopts it with one eligible sandbox host. |
| ClickHouse / otel / nomad-apm / dashboard-api / auth(Ory) | Skip — replaceable or optional. |

Biggest weld: **the E2B API places sandboxes while Nomad/Consul schedule and
discover services.** Any future extraction must supply both placement and a
node/service registry.

---

## 8. Structure recommendation for OUR sandbox product

> **Superseded recommendation.** This section records the earlier BUILD-shaped,
> single-tenant proposal. Do not implement it for v1. The controlling plan
> adopts the full required E2B path, including client-proxy, Redis, and
> Nomad/Consul, with Firecracker from day one.

E2B's shape is **3 tiers**: control-plane API (placement + state) → per-node
orchestrator (microVM mechanics) → in-VM guest agent (envd). Mirror the tiers,
collapse the pool sprawl.

Tie-in to our repo: `packages/boring-sandbox` + `SandboxProviderV1` contract +
the planned control-plane daemon.

### v1 (minimal — collapse aggressively)
- **One control-plane daemon** = E2B's `api` + placement, minus Nomad/Consul.
  Holds tenancy, capability tokens, sandbox registry, template refs in
  **one SQL store** (Postgres or even SQLite to start). No ClickHouse, no Redis
  tier (fold routing/locks into the SQL table + in-proc). This is the "planned
  control-plane daemon" — make it the single control-plane process.
- **One node agent** = E2B's `orchestrator`, but at v1 it can wrap whatever
  isolation `SandboxProviderV1` already abstracts (container first, Firecracker
  later). Keep the **provider seam** = E2B's `orchestrator` gRPC
  `SandboxService` (Create/Update/Delete/Pause/Checkpoint/List). Our
  `SandboxProviderV1` contract should mirror exactly that RPC set so we can swap
  a Firecracker backend in later without touching the control plane.
- **Guest agent = boring-bash** = E2B's `envd`. Adopt its interface split:
  streaming RPC for exec/process + fs-metadata, plain HTTP for bulk file I/O,
  auto port-scan, single init handshake. Replace E2B's bearer `secure_token`
  with our **capability-token + nonce** at the same auth choke point.
- **Collapse:** no separate client-proxy at v1 — fold sandbox routing into the
  node agent or control plane. No separate auth/dashboard services.

### v2 (grow toward E2B's boundaries)
- Split the **edge proxy** out (E2B `client-proxy`) once you have multiple nodes
  and per-port sandbox ingress — that's when the `<port>-<sandboxID>` routing
  and a real service registry earn their keep.
- Split **template/snapshot build** into its own build service (E2B keeps it
  inside orchestrator on a `build` pool) once UFFD fast-start + chunked build
  storage land. Keep build artifacts pluggable (local → S3/GCS) from day one.
- Add **analytics (ClickHouse-equivalent)** only when metrics volume justifies a
  separate store — keep it off the orchestration hot path, exactly as E2B does.
- Introduce a real **placement/scheduler** in the control-plane daemon to
  replace what Nomad+Consul give E2B (node registry + health + bin-packing).

### Boundaries to MIRROR / COLLAPSE / SKIP
- **Mirror:** the api↔orchestrator gRPC `SandboxService` seam (= our
  `SandboxProviderV1`); envd's guest-agent interface split (= boring-bash);
  control-plane-owns-state / data-plane-owns-VMs split; pluggable build storage.
- **Collapse (v1):** api + placement into one daemon; client-proxy into node
  agent; template-manager into node agent; drop Redis/ClickHouse tiers.
- **Skip:** Nomad/Consul/Terraform pool machinery (replace with our own
  daemon), Ory auth (we have capability tokens), otel/nomad-apm until scale.

---

## Appendix — confirmed evidence

- `packages/` children — gh API listing (confirmed).
- `orchestrator.proto` `service SandboxService { Create, Update, List, Delete,
  Pause, Checkpoint }` — read from base64-decoded file (confirmed).
- `orchestrator` protos present: `orchestrator.proto`, `template-manager.proto`,
  `chunks.proto`, `info.proto`, `volume.proto` (confirmed).
- `orchestrator/cmd`: create-build/resume-build/copy-build/mount-build-rootfs/
  inspect-build/show-build-diff (confirmed from tree view).
- `orchestrator/pkg`: sandbox, scheduling, server, template, proxy, portmap,
  nfsproxy, tcpfirewall, volumes, hyperloopserver, chrooted, startupreclaim …
  (confirmed via gh API).
- `envd/spec/{process,filesystem,upgrade}` + proto RPCs (confirmed from proto
  files).
- `envd/internal`: api, services, execcontext, host, logs, permissions, port,
  utils; `internal/api` has upload.go/download.go/init.go/auth.go/secure_token.go;
  `internal/port` has forward.go/scan.go (confirmed via gh API).
- `api/internal`: handlers, orchestrator, middleware, db, cache, clusters,
  oauth, template(-manager), team, sandbox, pause, analytics_collector, metrics
  (confirmed from tree view).
- Node pools + Postgres/Redis/ClickHouse roles — `self-host.md` (confirmed).
- **[UNVERIFIED]:** Packer usage; `auth`/Ory internals; exact client-proxy
  routing code (inferred from dir + naming, not read line-by-line).
