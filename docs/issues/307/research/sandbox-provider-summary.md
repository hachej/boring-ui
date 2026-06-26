# Sandbox requirement brief

## 1. Requirement

Boring UI needs **one fully isolated Linux sandbox per workspace, with public internet access and no practical escape path**.

The agent must be able to:

- read/write files
- run shell commands
- install dependencies from the internet (`npm`, `pnpm`, `pip`, `uv`)
- run builds/tests
- use normal dev tools (`git`, Node, Python, `ripgrep`)

Hard security requirement:

- sandbox can access public internet
- sandbox cannot access host, orchestrator, Docker/runtime socket, metadata service, private network, DB, app secrets, model/API keys, or other workspaces
- sandbox A cannot reach sandbox B's files or localhost
- file API and shell execution must share the same workspace root

Accepted risk: a sandbox can exfiltrate **its own** workspace data because internet access is required. Not accepted: host/platform/other-tenant escape.

## 2. Self-hosted path we identified

### bwrap worker

We built the useful contract:

```text
public app: auth/UI/model calls/secrets
internal worker: workspace files + command execution
```

But `bwrap` is **not enough** for hostile public multi-tenancy:

- shared host kernel
- escape compromises the worker and potentially all workspaces on it
- networking must be separately blocked to avoid private/internal access
- resource isolation requires extra cgroups/seccomp/disk work

Conclusion: keep the protocol, do not rely on bwrap as final isolation.

### gVisor worker

Best self-host fallback:

- one gVisor container per workspace
- user-space kernel boundary
- per-workspace network namespace
- firewall: allow public internet, block private/internal/metadata ranges
- cgroup limits for CPU/RAM/PIDs

Challenges:

- operationally heavy: runsc/Docker/containerd, lifecycle, cleanup, image patching
- networking/DNS/firewall correctness is on us
- still less clean than microVM-per-workspace

Conclusion: plausible, but a real infrastructure/security project.

### Daytona-style orchestration

Interesting for API/orchestration, snapshots, commands, filesystem, network controls.

But the key question is substrate:

- true microVM/dedicated kernel/gVisor boundary? candidate
- ordinary containers on shared runners? same problem as bwrap/plain Docker

Conclusion: useful only if it proves true per-tenant no-escape isolation.

Alternative microVM runtimes such as **BoxLite** or **Docker Sandboxes** are interesting, but they require hardware virtualization access (`KVM` / nested virtualization) on the host VM. That makes them unsuitable for ordinary cloud VMs that do not expose nested virtualization.

## 3. Managed microVM options

### Vercel Sandbox

Strong current fit:

- Firecracker-style per-workspace sandbox + snapshot
- already integrated in Boring UI

### AWS Lambda MicroVMs

New AWS option, very aligned:

- Firecracker VM-level isolation
- one MicroVM per user/session/job
- stateful memory/disk/process session
- suspend/resume
- public internet or VPC egress configurable
- HTTPS endpoint with HTTP/2/gRPC/WebSockets
- up to 8h runtime, 16 vCPU, 32GB RAM, 32GB disk
- Europe/Ireland available at launch

## Bottom line

We need **internet-enabled microVM-grade sandboxes per workspace**.

- `bwrap`: not enough isolation
- `gVisor`: possible but hard to operate ourselves
- BoxLite / Docker Sandboxes: interesting alternatives, but require KVM/nested virtualization access on the VM
- managed Firecracker/microVM products are likely the cleanest fit but are non EU / CH

