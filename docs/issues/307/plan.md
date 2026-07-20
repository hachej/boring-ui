---
github: https://github.com/hachej/boring-ui/issues/307
issue: 307
state: active
phase: plan
track: owner
flag: env:BORING_WORKER_SANDBOX=gvisor
updated: 2026-06-26
---

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

---

# Appendix — Background, decisions & rationale

> Captured from the 2026-06-15 review + design session so we don't restart from scratch. This is the "why", the plan above is the "what/how".

## A. Decision log (how we got here)

1. **Security review** of the remote bwrap worker (#301) — full findings in §B.
2. **Threat model fixed:** exfiltration of a user's *own* workspace data is **acceptable** (inherent to internet-enabled sandboxes). We **must** prevent (a) **main-app attack** (sandbox → public app / Postgres / Fly 6PN / metadata) and (b) **cross-workspace attack** (A → B).
3. **Finding:** the current shared-net bwrap worker does **not** meet (a) or (b). Worse, (b) is broken **without any escape** — `--share-net` shares one netns across all sandboxes, so A reaches B's `localhost` (e.g. a dev server). See §C.
4. **Launch decision:** ship **on Vercel Sandbox** (already the default), park the bwrap worker. See §D.
5. **Strategy reframe:** the remote worker is the **first step toward our own sandbox service** — it nailed the *Contract*; *Substrate* + *Orchestration* remain. See §E.
6. **Substrate choice for in-house v1:** **gVisor** (this plan). **Machine-per-workspace rejected on cost** (would pay ~per workspace; gVisor packs many sandboxes per Machine → cost scales with concurrency, not user count). See §F.

**Standing decisions:**
- Launch substrate = **Vercel** (now); in-house substrate = **gVisor** (later, this plan).
- Exfil **accepted**; main-app + cross-workspace are **hard requirements**.
- gVisor chosen over bwrap/plain-Docker (shared kernel) and over Machine-per-workspace (cost).
- Network rules (per-workspace netns + egress firewall) are required **in addition** to gVisor — different axis (§C/§F).
- Keep the remote-worker **Contract** (protocol/auth/fs/tenancy) constant across all substrates.

## B. Security review findings — remote bwrap worker (#301)

**Verified solid (do not re-review):**
- **Secret isolation holds & is smoke-tested** — worker secrets never enter the sandbox. `buildExecEnv` (`apps/full-app/src/server/worker/exec.ts:22`) + `withWorkspacePythonEnv` (`packages/boring-sandbox/src/providers/node-workspace/workspacePythonEnv.ts`, `baseEnv = passed env`, not `process.env`) + control-plane `mergeEnv` barrier that drops host env for both vercel-sandbox and remote-worker (`packages/agent/src/server/tools/harness/index.ts:84`). Smoke probe asserts `DATABASE_URL`/`*_TOKEN`/process-secret all empty inside the sandbox (`apps/full-app/scripts/remote-worker-smoke.mjs:175-189`).
- **Tenancy gated** — `resolveAuthorizedWorkspaceId` → `isMember` (403) before any worker call (`packages/core/src/app/server/createCoreWorkspaceAgentServer.ts` ~335-352).
- **Worker hardening** — non-root uid 10001, `setpriv --reset-env --no-new-privs`, `--cap-drop ALL`, `--unshare-all`, `--new-session`, fails closed if token missing (`apps/full-app/docker/worker-entrypoint.sh`).
- **Path confinement** realpath-based (`packages/boring-sandbox/src/providers/node-workspace/paths.ts`); **constant-time token** (`workerClient.ts:273`); token never logged.
- **Mode dormant/opt-in** — active only if `BORING_WORKER_BASE_URL` is set (`createCoreWorkspaceAgentServer.ts:679-682`); public app uses `vercel-sandbox` (`apps/full-app/Dockerfile:80`).
- **CI** enforces no-app-code-in-image + auth-401 + env-no-leak + limits; **backups** are Fly-native volume snapshots (no off-platform exfil).

**Open risks (the reason for this plan):**
- **H1 — shared-net on Fly 6PN** (lateral movement) + open egress (`apps/full-app/fly.worker.toml:17`, `buildBwrapArgs.ts:66`).
- **H2 — no seccomp + shared kernel/uid/process** → one escape = all workspaces' files + the worker token.
- **M1 — unbounded `runtimes` map** → fd/memory leak (`apps/full-app/src/server/worker/routes.ts:50`).
- **M2 — single shared internal token** = all-workspace authority (no per-workspace scoping).
- **M3 — no TLS enforcement** on `BORING_WORKER_BASE_URL` (`workerClient.ts:54`).
- **M4 — auth at `preHandler`** (after 20 MB body parse) + no rate limit (`routes.ts:79`).
- **L1 — `buildExecEnv` denylist** case-sensitive / misses `AWS_*` (defense-in-depth only; control plane already sends no secrets).
- **L3 — whole `/etc` RO-bound** into the sandbox (audit for secrets).
- Authors' own backlog: seccomp, cgroup limits, egress allowlist, scheduled image rebuilds, non-root smoke (`apps/full-app/docs/REMOTE_BWRAP_WORKER_HARDENING_TODO.md`).

This plan addresses H1 (netns + firewall + separate net), H2 (gVisor + cgroups), and M1 (lifecycle/reaping).

## C. Why bwrap + network rules alone still isn't enough

| Attack | Needs an escape? | Fixed by network rules? |
| --- | --- | --- |
| Connect to DB / main-app / 6PN / metadata | no | ✅ egress firewall |
| Connect to peer workspace's `localhost` | no | ✅ per-workspace netns |
| LPE escape → read every workspace off host FS | **yes** | ❌ kernel/FS isolation, not network |
| LPE → root → flush firewall → reach main-app | **yes** | ❌ escape lands below the firewall |

**gVisor and the network rules defend orthogonal axes** — gVisor = "can it escape the box?"; netns+firewall = "what can it reach from inside the box?". The main-app and cross-workspace-network attacks need **no escape** (`connect()` is a legal syscall gVisor forwards), so the network layer must stop them; the host-FS cross-workspace attack needs gVisor. The threat model has all three → pair them.

## D. Why Vercel for launch (and migration later)

- **Per-workspace microVM** — Vercel sandboxes are keyed per `workspaceId` (`packages/agent/src/server/runtime/modes/vercel-sandbox.ts:397-408`), each its own Firecracker microVM ⇒ separate kernel + netns ⇒ cross-workspace is a hard boundary, no shared loopback.
- **Off our network** ⇒ can't reach 6PN/DB/metadata; only our public, auth-gated URL — i.e. just another internet client.
- Internet works (installs); already the production default ⇒ **verify, don't build**.
- **Files live in Vercel** (persistent sandbox + snapshots, keyed by workspaceId) — not on a Fly volume.
- **Launch checklist:** deploy from `main` with `BORING_AGENT_MODE=vercel-sandbox`; **ensure `BORING_WORKER_BASE_URL` is unset** (else it bypasses Vercel → bwrap worker); don't deploy `boring-sandbox-worker`.
- **Caveat — EU residency:** Vercel Sandbox compute is likely US. If EU residency is a hard requirement, don't open public untrusted signup on Vercel — launch **invite-only on Fly** (trusted users) or hold for the gVisor worker.
- **Migration off Vercel is tractable, not a re-platform:** workspace identity/membership live in **Postgres** (backend-independent); both backends implement the same `Workspace` interface ⇒ migration = walk-tree-and-copy (or Vercel snapshot export → Fly volume). Gotchas: escaping **symlinks** (rejected by `assertRealPathWithinWorkspace` on access — validate/rewrite during copy), a **read-only/quiesce window**, and confirming chat-session state lives in Postgres. Launching on Vercel does **not** raise migration cost.

## E. Strategy — our own sandbox = Contract + Substrate + Orchestration

| Layer | What it is | Status |
| --- | --- | --- |
| **Contract** | `Sandbox`/`Workspace` interfaces, remote RPC protocol (exec/fs/fs-events + token), tenancy gating, secret stripping, backups, smoke/CI | ✅ **built — the remote worker** |
| **Substrate** | the per-tenant isolation boundary (Vercel = Firecracker microVM) | ❌ bwrap-on-shared-VM today → **gVisor (this plan)** |
| **Orchestration** | lifecycle, snapshot/restore, warm pools, idle reaping, scheduling, autoscale | ❌ single static worker |

The worker isn't a detour from Vercel — it's the **in-house version of it**, one substrate upgrade away. Build order is sound: prove the Contract with a cheap data plane (bwrap), then upgrade the substrate (gVisor → microVM if ever needed).

## F. Substrate comparison

| Substrate | Boundary | Needs KVM? | Verdict |
| --- | --- | --- | --- |
| bwrap / plain Docker (`runc`) / namespace-based BoxLite | **shared kernel** | no | ergonomics only; cross-workspace = best-effort. **Rejected.** |
| **gVisor (`runsc`)** | user-space kernel + seccomp | **no** | strong, production-proven (Google), runs on Fly. **Chosen.** |
| Kata Containers | **real microVM** behind OCI | yes | VM-grade + Docker UX, but needs bare-metal/KVM (e.g. OVH). Future option. |
| Firecracker direct / **Fly Machine per workspace** | **real microVM** | yes (Fly provides it) | strongest; **rejected for v1 on cost**. |

Notes: "our own Docker solution" alone = `runc` = shared kernel (same class as bwrap) — not a guarantee; you must plug in gVisor or Kata. gVisor's edge for us: **no KVM**, so it runs inside a Fly Machine today. Network rules (§C) are required regardless of substrate.

## G. What's exfiltratable (the accepted-risk scope)

With gVisor + netns + CIDR firewall, the **only** exfiltratable thing is the **attacker's own workspace** (files at `/workspace`, anything brought into `HOME=/workspace`, non-secret env). **Not** reachable: other workspaces (netns + gVisor), platform/provider secrets (stripped before reaching the sandbox), DB / main-app / metadata (firewall). So exfil is **self-scoped — no privilege escalation, no multi-tenant breach.**
- **Nuance:** "own data" includes the **prompt-injection** case — a malicious repo/doc can make the agent exfiltrate the *honest* user's own workspace to a third party. Still one tenant, but name it as a known product decision.
- **Edge cases that widen it:** anything you **seed/mount in** (keep non-sensitive); any **feature credential** deliberately placed in the workspace (GitHub clone tokens, etc. — make short-lived/least-privilege).
- **Sibling risk of open egress** (not exfil): sandboxes used for **outbound abuse** (crypto-mining/DDoS/spam) → IP-reputation damage. A filtering proxy would address both this and injection-exfil; deferred because exfil is accepted.
