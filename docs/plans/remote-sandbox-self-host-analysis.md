# Remote sandbox self-hosting analysis for boring-ui

Status: planning/research note. No implementation.

Scope: self-deployment of boring-ui with the app and database self-hosted, while agent execution runs on a **remote sandbox backend** instead of inside the web app container.

## Recommendation

For the near-term self-host plan, keep the core deployment simple:

```txt
App VM -> DB VM -> Remote Sandbox Backend
```

Default remote sandbox path:

1. **Initial production:** keep `BORING_AGENT_MODE=vercel-sandbox` while App VM + DB VM + backups stabilize.
2. **Self-hosted pilot:** test **Daytona OSS** on a separate sandbox VM as the most practical turnkey self-hosted remote workspace backend.
3. **VPS-compatible hardened path:** test **gVisor/runsc** containers on a separate sandbox VM if we want a smaller custom backend without Daytona's full platform.
4. **High-isolation later:** move sandbox host to bare metal and pilot **BoxLite** or Firecracker/E2B only if we need real microVM isolation.

Do **not** run untrusted agent execution in the web container. Do **not** require bare metal for the first self-host deployment.

## Why remote sandbox first

Remote sandboxing keeps the dangerous part away from production app/database services:

```txt
App VM:
  boring-ui web/app runtime
  auth/session/mail/model config
  no untrusted shell execution

DB VM:
  native Postgres + pgbackrest
  no agent code execution

Sandbox VM/backend:
  command execution
  file workspace
  preview ports
  resource limits
  no DB admin secrets
  no production app secrets
```

If sandbox containment fails, the attacker should not automatically get Postgres, backup keys, 1Password tokens, Cloudflare admin tokens, or Docker access to the app host.

## Options reviewed

### Daytona OSS/self-host

Best near-term self-host product candidate.

What it gives:

- self-hostable control plane;
- TypeScript SDK/API;
- sandbox lifecycle;
- command/process execution;
- file APIs;
- preview/proxy routing;
- SSH gateway;
- snapshots/templates;
- volumes/persistence;
- runners;
- dashboard.

Operational shape:

```txt
Daytona API
Daytona proxy
Daytona runner
SSH gateway
Postgres
Redis
Dex/OIDC
registry
MinIO/S3 storage
Caddy/TLS/DNS
```

Normal VPS compatibility: **good**. Official OSS deployment is Docker Compose-oriented and does not require `/dev/kvm` for the normal path.

Isolation: **medium** by default. It is container/Sysbox-style isolation, not microVM isolation. Good for controlled/self-hosted usage after hardening; not enough to call hostile multi-tenant secure without review.

Licensing: **AGPL-3.0**. Keep integration as an external adapter using API/SDK. Avoid modifying/vendoring Daytona unless we accept AGPL obligations.

Verdict:

> Best 1-2 week spike for a self-hosted remote sandbox backend.

Required spike checks:

- install reproducibility on a clean VM;
- generated secrets replaced;
- wildcard DNS/proxy works;
- sandbox create/start/stop/archive/delete;
- command execution;
- file read/write/upload/download;
- PTY/log streaming if needed;
- preview URL routing;
- snapshot/template build;
- persistence after stop/archive;
- resource limits actually enforced;
- inter-sandbox networking disabled;
- egress policy possible;
- backup/restore of Daytona control-plane state;
- crash/reboot recovery;
- AGPL implications acceptable.

### E2B OSS/self-host

Strong isolation, heavy operations.

What it gives:

- Firecracker microVM sandboxes;
- SDK/API with files, commands, PTY, git, snapshots, pause/resume;
- first-class persistence and snapshots.

Normal VPS compatibility: **poor**. Requires KVM/Firecracker and therefore `/dev/kvm`; ordinary VPS usually does not expose this.

Operational shape: Terraform-managed AWS/GCP infrastructure with Nomad/Consul and many services. General Linux single-node support is not yet the simple path.

Verdict:

> Great advanced/enterprise backend, bad first self-host default.

Use E2B when:

- we accept AWS/GCP Terraform platform operations; or
- we have bare metal / nested-virt hosts; and
- high isolation is more important than operational simplicity.

### gVisor/runsc custom backend

Best small VPS-compatible isolation upgrade.

What it gives:

- Docker/containerd runtime using a user-space kernel;
- stronger boundary than plain Docker;
- no KVM requirement;
- works on ordinary Linux VMs.

What it does not give by itself:

- workspace lifecycle API;
- snapshots/templates product layer;
- preview routing;
- dashboard;
- file API;
- persistence policy.

Verdict:

> Best if we want to build a small boring-owned remote sandbox worker instead of adopting Daytona.

Possible shape:

```txt
boring-sandbox-worker service
  -> creates per-workspace gVisor containers
  -> copies/mounts workspace data
  -> runs commands
  -> exposes file API
  -> exposes preview proxy
  -> enforces CPU/RAM/PID/disk/time
  -> default-deny egress or proxy allowlist
```

This is more engineering than Daytona, but less platform burden than E2B.

### bwrap/nsjail

Useful inside a container or worker, not enough alone.

Pros:

- no KVM;
- lightweight;
- already aligned with boring-ui local mode ideas;
- good for per-process limits and filesystem restrictions.

Cons:

- shared host kernel;
- security depends heavily on policy;
- not a complete sandbox product;
- not ideal as only boundary for hostile code.

Verdict:

> Use as defense-in-depth inside a remote worker/container, not as the whole strategy for client-safe remote sandboxing.

### BoxLite / Firecracker on bare metal

Best future high-isolation path.

Requirements:

- `/dev/kvm`;
- bare metal or nested-virt-capable VM;
- host kernel/KVM maintenance;
- image/rootfs lifecycle;
- network isolation;
- resource cleanup;
- monitoring.

Verdict:

> Promising stage-2/3 path. Do not block first self-host deployment on it.

## Proposed boring-ui remote sandbox interface

Keep boring-ui independent of the backend.

Adapter capabilities:

```ts
interface RemoteSandboxBackend {
  createWorkspace(input): Promise<RemoteWorkspaceHandle>
  connect(handle): Promise<RemoteWorkspaceHandle>
  destroy(handle): Promise<void>
  pause?(handle): Promise<void>
  snapshot?(handle): Promise<SnapshotHandle>

  exec(handle, command, options): AsyncIterable<ExecEvent>
  openPty?(handle, options): Promise<PtySession>

  readFile(handle, path): Promise<Uint8Array>
  writeFile(handle, path, bytes): Promise<void>
  listFiles(handle, path): Promise<FileEntry[]>
  deleteFile(handle, path): Promise<void>

  getPreviewUrl?(handle, port): Promise<string>
  getMetrics?(handle): Promise<SandboxMetrics>
}
```

Backend implementations can be:

- Vercel Sandbox adapter;
- Daytona adapter;
- boring-owned gVisor worker adapter;
- future BoxLite adapter;
- future E2B adapter.

## Security requirements for remote sandbox

Required for any backend:

- No DB admin secrets in sandbox.
- No app auth/mail secrets in sandbox.
- No backup keys in sandbox.
- No Cloudflare/Tailscale admin tokens in sandbox.
- No Docker socket exposed to sandbox.
- No host root filesystem mounts.
- Per-workspace identity and ownership labels.
- CPU/RAM/PID/disk/time limits.
- Log size limits.
- Network egress policy: default deny or explicit allowlist/proxy.
- Audit trail for commands and file transfer events.
- Reaper for stale sandboxes.
- Manual sandbox-mode rollback only; no silent fallback to less safe mode.

## Data and persistence policy

Remote sandbox persistence must be explicit.

Cases:

### Vercel sandbox

- actual workspace files are remote;
- `/data/workspaces` on App VM is only a host/control-plane anchor;
- backing up App VM `/data/workspaces` does not back up actual Vercel sandbox files;
- keep this caveat in deployment docs.

### Daytona

- stopped/archived sandbox persistence must be tested;
- auto-delete TTLs must be disabled or set deliberately for long-lived boring workspaces;
- object storage backing volumes/snapshots must be backed up;
- control-plane Postgres/Redis/MinIO state must be included in restore runbook.

### gVisor custom worker

- decide whether workspace state lives on sandbox VM disk, S3/R2, or App VM-controlled storage;
- backup policy must match the chosen source of truth;
- avoid unique client data only on disposable sandbox hosts unless intentionally ephemeral.

### BoxLite/E2B

- snapshot storage and workspace disks are part of the backup/restore story;
- verify snapshot size/cost and restore path before production.

## Cost implications

### Vercel Sandbox

Lowest ops burden, usage-based cost. Good first production default while VM app/DB migration stabilizes.

### Daytona OSS on VM

Cost floor:

```txt
1 sandbox/control VM: ~€20–€80/mo depending size
storage/backups/domain: extra
ops time: non-trivial
```

If runner load grows, split control plane and runners.

### gVisor custom worker

Cost floor:

```txt
1 sandbox VM: ~€10–€60/mo
engineering time: higher
ops complexity: lower than Daytona if kept tiny
```

### Bare metal BoxLite/Firecracker

Cost floor:

```txt
€60–€120/mo realistic sweet spot
€120–€250/mo for more concurrent sandboxes
```

Maintenance burden is higher, but KVM/microVM isolation is real.

## Recommended staged plan

### Stage R0 — keep current remote sandbox while self-hosting app/DB

- App VM + DB VM self-hosting first.
- Keep Vercel Sandbox for agent execution.
- Document durability/cost caveat.
- Make sandbox backend configurable.

Acceptance:

- self-hosted app works;
- self-hosted DB + backups work;
- agent execution still works via Vercel;
- no untrusted shell execution in web container.

### Stage R1 — Daytona OSS spike

- Deploy Daytona OSS on a separate sandbox VM.
- Build no product code initially; use SDK/API manually.
- Validate lifecycle, files, commands, previews, snapshots, persistence, limits, egress.

Decision:

- If Daytona is stable enough, write a boring-ui Daytona adapter plan.
- If Daytona is too heavy/AGPL awkward, move to gVisor custom worker spike.

### Stage R2 — gVisor worker spike

- Create a tiny remote worker prototype on separate VM.
- Use gVisor containers for command execution.
- Add file API and preview proxy only if minimal lifecycle works.

Decision:

- Use this if we want low-dependency boring-owned infrastructure.

### Stage R3 — bare-metal microVM track

- Rent a dedicated sandbox host.
- Verify `/dev/kvm`.
- Pilot BoxLite first because it is simpler than full E2B self-host.
- Consider E2B only if we want its full SDK/platform semantics and accept ops burden.

## Current recommendation

For boring-ui self-deployment with remote sandbox **now**:

```txt
1. Self-host App VM + DB VM.
2. Keep Vercel Sandbox initially.
3. Spike Daytona OSS on a separate sandbox VM.
4. In parallel, keep gVisor worker as the fallback/simple custom option.
5. Defer BoxLite/E2B until a bare-metal sandbox host is justified.
```

This avoids blocking the main self-host cost reduction on the hardest sandbox problem, while still moving toward a fully self-hosted remote execution backend.
