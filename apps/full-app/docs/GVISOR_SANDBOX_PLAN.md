# gVisor Sandbox Plan — proper multi-tenant isolation for the remote worker

- **Status:** Proposed (planning)
- **Date:** 2026-06-15
- **Tracking issue:** #307
- **Related:** #301 (remote bwrap worker, what this hardens), #223 (external runtime/provider candidates umbrella)

## Goal & threat model

The remote worker (#301) runs **untrusted, multi-tenant** agent code with internet access. We must guarantee two properties; one risk is explicitly accepted.

- **Accepted:** exfiltration of a user's *own* workspace data to the internet (inherent to giving sandboxes egress for `pip`/`npm`/`uv`). Scope is self-contained — one tenant's own data, never another tenant's and never platform secrets.
- **Must prevent:**
  1. **Main-app attack** — sandbox reaching the public app, Postgres, Fly 6PN, or instance metadata.
  2. **Cross-workspace attack** — workspace A reaching or reading workspace B.

## Why the current bwrap worker does not meet this

| Attack | Needs an escape? | Covered by bwrap today? |
| --- | --- | --- |
| Connect to DB / main-app / 6PN / metadata | no | ❌ `--share-net` puts the sandbox on the worker's network |
| Connect to peer workspace's `localhost` | no | ❌ all sandboxes share one netns (shared loopback) |
| LPE escape → read every `/data/workspaces/*` on host FS | yes | ❌ no seccomp, shared kernel, all tenants are uid 10001 |
| LPE → root → flush firewall → reach main-app | yes | ❌ escape lands below any host firewall |

Network rules alone close only the **no-escape** rows. The **escape** rows need a substrate that does not share a kernel across tenants — that is the core change here.

## Why gVisor (and why not Machine-per-workspace)

- **gVisor (`runsc`)** is a user-space kernel: the workload's syscalls are serviced by gVisor (memory-safe Go) instead of the host kernel, and gVisor itself runs behind a tight seccomp boundary. Production-proven for hostile multi-tenant code (Google Cloud Run / App Engine / Functions). It moves us from "one kernel bug = total cross-tenant compromise" to "break the Go kernel **and** its seccomp boundary."
- **Machine-per-workspace is rejected on cost.** A Fly Machine per workspace would give a hard Firecracker boundary, but paying for one Machine per workspace does not scale. **gVisor lets us pack many sandboxes onto one Fly Machine**, which is the cost-effective way to get a real per-tenant boundary.
- gVisor needs no `/dev/kvm` (uses the **systrap** platform), so it runs **inside** a Fly Machine — unlike Kata/Firecracker, which need nested virt Fly does not expose.

## Target architecture (layered isolation)

```
Fly Machine (Firecracker microVM)              <- outer boundary: worker <-> your infra
  +- dockerd + runsc (gVisor, systrap platform)
  |    +- container ws-<uuidA>  (own netns, own gVisor kernel)   <- tenant <-> tenant
  |    +- container ws-<uuidB>  (own netns, own gVisor kernel)
  |    +- nftables egress firewall (host) -> public internet only
  +- worker Node server (existing remote-worker API, unchanged)
```

Two boundaries stack: a gVisor escape lands in the Fly guest (still trapped by Firecracker, still firewalled), reaching neither the main app nor other Fly tenants. Cross-workspace requires breaking gVisor **and** the Fly microVM.

Note: filesystem ops already run on the host via `createNodeWorkspace` (not through the sandbox), so **only the exec path moves to gVisor.**

## Phase 0 — Spike the Fly constraint (do first; ~½ day)

Decider: Fly Machines do not expose `/dev/kvm`, so gVisor must use the **systrap** platform (no nested virt), which adds syscall overhead. Prove it before building.

1. `fly machine run` a throwaway Machine with a Docker + runsc image.
2. Inside it:
   ```sh
   runsc install            # registers runsc as a docker runtime
   # /etc/docker/daemon.json runtimes.runsc.runtimeArgs:
   #   ["--platform=systrap", "--network=sandbox"]
   docker run --rm --runtime=runsc alpine cat /proc/version    # must print "gVisor"
   docker run --rm --runtime=runsc python:3.12 python -c "import urllib.request"
   ```
3. Benchmark a realistic workload (`uv pip install rich`, `npm i`, a build) under runsc vs runc; record overhead.
4. **Gate:** acceptable perf → proceed. Otherwise reconsider substrate.

## Phase 1 — Host image: Docker + runsc inside the Fly Machine

New Dockerfile target `worker-gvisor-host` (replaces `worker-runtime` as the Machine image):

- Base `node:22-slim` + **docker-ce (engine)** + **runsc** (pin a gVisor release SHA, verify signature).
- `/etc/docker/daemon.json`: `runsc` runtime with `--platform=systrap`; `storage-driver: overlay2` (validate overlay in Fly's guest kernel during Phase 0; fallback `vfs`).
- Entrypoint: start `dockerd` (data-root on the `/data` volume), wait for the socket, **install the nft firewall (Phase 4)**, then `exec` the worker Node server (server runs as non-root uid 10001 with docker-socket access via a `docker` group; dockerd runs as root).
- Keep the worker server bundle (`worker/agent-worker.js`, `worker/worker/`).

## Phase 2 — Sandbox image: per-workspace toolchain

Minimal image `boring-sandbox:<ver>` run inside each gVisor container:

- `python3 + uv + node + git + ripgrep + bash` (the tools previously baked into `worker-runtime` move here).
- Non-root user, `WORKDIR /workspace`, **no secrets**.

## Phase 3 — gVisor `Sandbox` adapter (code)

New `createGvisorSandbox` implementing the existing `Sandbox` interface; `createWorkerRuntime` constructs it instead of `createBwrapSandbox`. Container-per-workspace, driven via the Docker socket:

- **`init({ workspace, sessionId })`** — idempotently ensure the workspace container is running:
  ```sh
  docker run -d --name ws-<uuid> --runtime=runsc \
    --network boring-sbx --dns 1.1.1.1 \
    --memory 1g --cpus 1 --pids-limit 512 \
    --read-only --tmpfs /tmp \
    -v /data/workspaces/<uuid>:/workspace -w /workspace \
    boring-sandbox:<ver> sleep infinity
  ```
- **`exec(cmd, opts)`** — `docker exec -i ws-<uuid> bash -c "$CMD"`, wiring stdout/stderr capture, `timeoutMs`, abort `signal`, `maxOutputBytes`. **`buildExecEnv` stays** — the worker still controls the env passed to `docker exec`, so secret-stripping is unchanged.
- **`shutdown` / idle reap** — `docker stop && docker rm`.
- **Resource limits** move from shell `ulimit` to **container cgroups** (`--memory/--cpus/--pids-limit`).

This also fixes the unbounded `runtimes` map: explicit create/reap + LRU/idle-timeout eviction.

## Phase 4 — Networking rules

**Per-workspace netns:** free — each container is its own netns, so the shared-loopback cross-workspace path is gone. All sandbox containers go on a dedicated bridge `boring-sbx`.

**Egress firewall** (host nftables; allow public, deny internal):

```
table inet sbx {
  chain forward {
    type filter hook forward priority -1; policy accept;
    iifname "br-boring-sbx" ct state established,related accept
    # allow public DNS explicitly (we block 6PN, where Fly's resolver lives)
    iifname "br-boring-sbx" ip daddr 1.1.1.1 udp dport 53 accept
    iifname "br-boring-sbx" ip daddr 1.1.1.1 tcp dport 53 accept
    # DROP internal planes
    iifname "br-boring-sbx" ip  daddr { 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16, 100.64.0.0/10 } drop
    iifname "br-boring-sbx" ip6 daddr { fc00::/7, fe80::/10 } drop   # ULA (incl. Fly 6PN) + link-local
    # everything else (public internet) allowed -> pip/npm/uv work
  }
}
```

**Fly DNS gotcha:** Fly's internal resolver lives on 6PN (`fdaa::3`), which we block — so set sandbox containers to a **public resolver** (`--dns 1.1.1.1`) and allow it explicitly above, or installs fail with DNS errors.

**Structural belt-and-suspenders for the main-app condition:** deploy this worker in a **separate Fly org/network** so even a gVisor-escape-to-Fly-guest-root is not 6PN-peered with the main app + Postgres. Combined with the firewall, this closes the main-app condition even post-escape.

## Phase 5 — Lifecycle, limits, reaping

- Idle reaper: stop+rm containers after N minutes idle; evict the runtime cache.
- On worker boot: reconcile/clean orphaned `ws-*` containers (fixes the orphan-reaping gap).
- Machine sizing: gVisor Sentry + dockerd + N containers is heavier than bwrap — bump from `2gb/1cpu` to **>=4-8gb / 2-4 cpu**, cap concurrent sandboxes, keep the exec semaphore. (Still far cheaper than a Machine per workspace.)

## Phase 6 — Validation (extend `remote-worker-smoke.mjs`)

1. **gVisor active:** `cat /proc/version` inside a sandbox returns `gVisor` (fail closed otherwise).
2. **Egress allow:** `curl -sSf https://pypi.org` and `uv pip install rich` succeed.
3. **Egress deny (main-app):** `curl --max-time 3 http://<app>.internal` and `http://169.254.169.254` time out / fail.
4. **Cross-workspace deny:** two sandboxes; B binds `localhost:8000`; A's `curl localhost:8000` fails.
5. **Secret isolation:** keep the existing env-leak probe (`DATABASE_URL` / `*_TOKEN` / process-secret all empty in the sandbox).
6. **Limits:** cgroup memory/pids enforced.
7. **fs confinement:** unchanged (path validation already covered).

Add a CI job `gvisor-worker-smoke` (needs Docker-in-Docker / privileged runner).

## Phase 7 — Rollout

- `BORING_WORKER_SANDBOX = bwrap | gvisor` switch in worker config; ship gVisor **off by default**, bwrap as fallback.
- Deploy to a **staging worker app**, run smoke + manual soak, watch perf/memory.
- Flip default to `gvisor`; keep bwrap one release for rollback.
- **Public cutover (`BORING_WORKER_BASE_URL`) remains a separate, later decision** — still weighed against staying on Vercel for launch.

## Reuse vs change

| Reuse unchanged | Changes |
| --- | --- |
| remote-worker protocol, routes, auth (token), fs ops + `paths.ts`, tenancy gating, backup job, smoke harness | `Sandbox` impl (bwrap → gVisor container), worker image (+docker +runsc, split sandbox image), networking (firewall + bridge + DNS), Fly config (separate net, bigger Machine), resource limits (ulimit → cgroups) |

## Risks & decision points

1. **systrap perf** (no KVM on Fly) — the #1 unknown; Phase 0 gates it.
2. **dockerd-in-a-Fly-Machine** overhead + init complexity; overlay2 availability. Alternatives: containerd + runsc (leaner, more setup) or raw `runsc run` with OCI bundles (no daemon).
3. **Machine sizing/cost** — gVisor is heavier per box, but packing many sandboxes per Machine is far cheaper than Machine-per-workspace.
4. **Residual cross-workspace within one Machine** — all sandboxes on a Machine share the Fly guest kernel, so cross-workspace rests on gVisor's boundary (strong) rather than a per-tenant VM. Acceptable given cost; revisit only if the threat model demands a guest-kernel-per-tenant guarantee.
5. **EU residency** holds (`cdg`) either way.

## Recommended sequencing

Run **Phase 0 this week** (prove gVisor/systrap on Fly + benchmark). Keep **Vercel as the launch substrate** until the gVisor worker passes its full smoke suite; the public cutover is a later, separate decision.
