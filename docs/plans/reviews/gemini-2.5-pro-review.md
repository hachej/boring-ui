Of course. Here are my proposed changes to make the plan more innovative, accretive, and compelling, presented in a git-diff format.

My core philosophy for these changes is to elevate the plan from a solid infrastructure migration to a platform-defining product vision. The key themes are:

1.  **Zero-Latency User Experience:** Moving beyond "fast enough" to a model that feels instantaneous.
2.  **Secure by Default:** Incorporating simple, high-impact security primitives from day one, rather than deferring them.
3.  **State as a First-Class Citizen:** Treating user workspaces not as just a running process, but as a versionable, forkable asset.
4.  **Elevated Developer Platform:** Making the "child app" experience more powerful and flexible.

Here is the diff:

```diff
--- a/docs/plans/flyio-two-mode-agent-plan.md
+++ b/docs/plans/flyio-two-mode-agent-plan.md
@@ -1,6 +1,6 @@
 # Plan: Fly.io Deployment + Backend-Agent Mode
 
 ## Status
 
-**Draft v3** — incorporates Codex review + scope simplification.
+**Draft v4** — Radical Innovations Proposal. Incorporates v3 feedback and introduces zero-latency UX, secure-by-default primitives, and a state-centric architecture.
 
 **Date**: 2026-03-18
 **Supersedes**: Parts of `backend-architecture-plan.md` (sandbox backend selection, BoxLite, nsjail-as-primary)
@@ -10,10 +10,16 @@
 
 ---
 
 ## Executive Summary
 
-Ship the current core mode on Fly.io, then add backend-agent mode where each workspace is an isolated Fly Machine.
+We will transform our application into a high-performance, secure, and stateful platform by leveraging Fly.io. We will first migrate our existing `frontend-agent` mode, then introduce a revolutionary `backend-agent` mode. In this new mode, each user workspace becomes a **Personal Cloudlet**: a dedicated, on-demand Firecracker microVM that offers bare-metal isolation with a serverless operational model.
 
-**MVP simplification**: The agent harness runs directly on the workspace Machine. No bwrap, no sandbox layer. The Firecracker VM boundary IS the isolation — each workspace is a separate VM with its own kernel. Sandbox hardening (bwrap) is a post-MVP phase.
+**Key Innovations in this Plan**:
+- **Instant Resume**: We will implement speculative pre-warming to make workspace resume from a suspended state feel instantaneous (~50-100ms).
+- **Secure by Default**: Instead of deferring all sandboxing, we will implement a minimal `bwrap` policy from day one. The VM provides macro-isolation; `bwrap` will provide micro-isolation for the agent process, preventing it from accessing host secrets or the network by default.
+- **Stateful & Forkable Workspaces**: We will treat Fly Volumes not just as disks, but as the foundation for workspace snapshotting and branching, enabling `git`-like workflows for entire development environments.
+- **Provider-Agnostic Core**: Abstract interfaces for provisioning and routing ensure we build a platform, not just a Fly.io integration.
 
 ### Phases
 
@@ -21,18 +27,19 @@
 |---|---|---|
 | 0 | Deploy core mode to Fly.io + clean up legacy deploy | No |
 | 1 | Provisioner + router interfaces + Fly implementation | Backend only |
-| 2 | Workspace Machine backend-agent process model | Backend only |
-| 3 | Frontend integration | Frontend only |
+| 2 | Workspace Cloudlet: secure-by-default process model | Backend only |
+| 3 | Frontend integration + Instant Resume | Frontend/Backend |
 | 4 | boring.app.toml + bui CLI | CLI only |
-| Post-MVP | bwrap sandbox hardening (defense-in-depth) | Backend only |
+| Post-MVP | Collaborative workspaces, advanced credentialing | Full stack |
 
 ### Non-goals (MVP)
 
-- Sandbox isolation within the VM (bwrap) — VM boundary is sufficient for v1
-- Credential brokering / short-lived leases
+- Full credential brokering (e.g., Vault integration). However, we **will** implement a minimal secret-injection sidecar to avoid exposing all secrets to the agent process.
 - Snapshots / templates / branch workspaces
 - Audit / event journal
 - Quotas, warm pools, canary rollout
 - Rewriting the current frontend-agent path
 - Baking Fly-specific assumptions into pane or router contracts
 
 ### Design principles
 
 - Preserve `frontend` mode exactly. Don't change what works.
+- **Instant Resume is the Default UX**: The system should anticipate user actions to hide cold-start latency.
+- **Secure by Default**: Employ defense-in-depth. The VM is the outer wall; process sandboxing is the inner sanctum. Don't let processes see secrets they don't need.
+- **State is Sacred**: The user's workspace is a versionable, forkable asset.
 - Keep hosted provider logic behind interfaces (`WorkspaceProvisioner`, `WorkspaceRouter`) so Fly is the first implementation, not the only one.
 - Ship phases incrementally — each phase is independently deployable.
 - Self-hosting option stays open (interfaces, not Fly lock-in).
@@ -107,43 +114,56 @@
 
 ### backend-agent Mode (new — MVP)
 
+```
+ User Action (e.g., visits dashboard)
+       │
+       ▼
 ┌──────── Control Plane Machine (always-on) ──────────────┐
 │                                                          │
-│  Image: boring-ui:latest                                 │
+│  Image: boring-ui:latest (control-plane variant)         │
 │  Env: DATABASE_URL, NEON_AUTH_*, BORING_SESSION_SECRET,  │
 │       FLY_API_TOKEN, FLY_WORKSPACE_APP                   │
 │                                                          │
 │  Routers: control_plane only                             │
 │  Role:                                                   │
 │    /auth/*              → Neon Auth token exchange        │
-│    /api/v1/workspaces   → CRUD via WorkspaceProvisioner  │
+│    /api/v1/workspaces   → CRUD via WorkspaceProvisioner   │
+│    /dashboard           → [ACTION] Speculatively resume   │
+│                           user's Workspace Cloudlet       │
 │    /w/{id}/**           → route via WorkspaceRouter      │
 │                                                          │
 └──────────────────────────────────────────────────────────┘
          │ WorkspaceRouter (Fly impl: fly-replay)
          ▼
-┌──────── Workspace Machine (auto-stop per workspace) ────┐
+┌──────── Workspace Cloudlet (auto-suspend per workspace) ──┐
 │                                                          │
 │  Firecracker VM = the isolation boundary                 │
 │  Volume: /workspace (10-50GB)                            │
-│  Image: boring-ui:latest (same image)                    │
-│  Env: BORING_SESSION_SECRET, ANTHROPIC_API_KEY           │
+│  Image: boring-ui:latest (workspace variant)             │
+│  Env: BORING_SESSION_SECRET, WORKSPACE_ID                │
 │  Guest: shared-cpu-1x, 512MB                             │
 │  Services: autostop=suspend, autostart=true              │
 │                                                          │
 │  Routers: files, git, pty, ui_state, chat_claude_code    │
 │  agents_mode: backend                                    │
 │                                                          │
-│  PID 1: boring-ui backend                                │
-│    - validates boring_session cookie (stateless HS256)   │
-│    - spawns PiHarness (Node.js sidecar)                  │
-│    - PiHarness makes LLM calls directly                  │
-│    - pi_service/tools.mjs executes commands directly     │
-│      on the workspace filesystem (no sandbox layer)      │
+│ ┌─ PID 1: boring-ui backend ───────────────────────────┐ │
+│ │ - validates boring_session cookie (stateless HS256)  │ │
+│ │ - Fetches scoped secrets (e.g. ANTHROPIC_API_KEY)    │ │
+│ │   from Control Plane or a future secret service.     │ │
+│ │ - Spawns PiHarness via a hardened wrapper...         │ │
+│ └───────────────────┬──────────────────────────────────┘ │
+│                     │                                    │
+│                     ▼                                    │
+│ ┌─ bwrap sandbox ──────────────────────────────────────┐ │
+│ │  - PID 2: PiHarness (Node.js sidecar)                │ │
+│ │  - Environment is scrubbed (`--clearenv`)            │ │
+│ │  - Injected env: `ANTHROPIC_API_KEY` only            │ │
+│ │  - Network is disabled (`--unshare-net`)             │ │
+│ │  - Filesystem is restricted to `/workspace`          │ │
+│ │  - pi_service/tools.mjs executes commands inside     │ │
+│ │    this heavily restricted environment.              │ │
+│ └──────────────────────────────────────────────────────┘ │
 │                                                          │
-│  No bwrap. No sandbox. The VM is the sandbox.            │
-│                                                          │
 └──────────────────────────────────────────────────────────┘
 ```
 
-### Why no sandbox in MVP
+### Why a "Secure by Default" Sandbox is Critical for MVP
+
+This plan revises the "no sandbox" stance. Relying solely on the VM boundary is good, but defense-in-depth is better and easy to implement. A minimal `bwrap` policy from day one is a radical improvement in our security posture for negligible cost.
 
 | Concern | Why VM-level isolation is sufficient |
 |---|---|
@@ -151,10 +171,10 @@
 | Cross-workspace access | Impossible — different VM, different kernel |
 | Agent destroys files | It's the user's own workspace. Volume snapshots exist. |
 | Agent installs packages | Contained — dies when Machine stops |
-| Fork bomb / resource abuse | Fly Machine resource limits |
-| Agent reads secrets | Agent IS the backend — it needs ANTHROPIC_API_KEY to call LLMs. No untrusted tenants in v1. |
-| Network exfiltration | Acceptable for v1 — single-tenant. Post-MVP: bwrap `--unshare-net`. |
+| Fork bomb / resource abuse | Fly Machine resource limits + user-level cgroups inside the VM. |
+| Agent reads secrets | **HIGH RISK**. An RCE in the agent could read `BORING_SESSION_SECRET` from the env. **Mitigation**: `bwrap --clearenv` ensures the agent process *only* sees the secrets explicitly passed to it (e.g., `ANTHROPIC_API_KEY`), not the host's secrets. |
+| Network exfiltration | **HIGH RISK**. An agent could `curl | bash` or exfiltrate data. **Mitigation**: `bwrap --unshare-net` disables networking for the agent process by default. Network access for tools like `git` or `curl` can be explicitly brokered through a trusted host-side proxy if needed. |
 
 ### Interfaces (prevents Fly lock-in)
 
@@ -174,15 +194,18 @@
 
 Browser → POST /auth/token-exchange → Control Plane
   ← Set-Cookie: boring_session=<HS256 JWT>
 
+Browser → GET /dashboard → Control Plane
+  → [Side effect] Control Plane calls `provisioner.resume(user_workspace_id)`
+
 Browser → GET /w/{id}/api/v1/files/tree → Control Plane
   ← WorkspaceRouter.route() → fly-replay: instance=ws-{id}
   → Fly Proxy replays to Workspace Machine
   → Workspace Machine validates boring_session (stateless HS256)
   ← 200 OK
 ```
 
-Workspace Machine needs ONE secret: `BORING_SESSION_SECRET`. No DB, no JWKS, no Neon Auth config.
+The Workspace Cloudlet's *host process* needs `BORING_SESSION_SECRET`. The sandboxed *agent process* sees no secrets by default, receiving only scoped, short-lived credentials as needed.
 
 ---
 
-## Part 5: Volume Lifecycle
+## Part 5: Workspace State Lifecycle
 
 ### Create Workspace
 
@@ -193,7 +216,7 @@
     result.machine_id, result.volume_id, workspace_id,
 )
 ```
 
-### Workspace states (MVP)
+### Workspace states
 
 | State | Machine | Volume | Cost |
 |---|---|---|---|
@@ -201,11 +224,14 @@
 | Idle | **suspended** | attached | $0 compute + $0.15/GB/mo storage |
 | Deleted | deleted | deleted | $0 |
 
-### Volume persistence
+### State Persistence and Versioning
 
 - Survives: stop, suspend, restart, redeploy
 - Lost: explicit volume delete only
 - Snapshots: daily automatic (Fly built-in), 5-day retention
+- **Future: Workspace-as-Code**: This architecture enables treating workspaces like git branches.
+  - `bui fork-workspace <prod_ws> --name <debug_branch>` → Fly Volume fork + new Machine
+  - `bui snapshot <my_ws>` → Fly Volume snapshot API
 
 ---
 
@@ -237,18 +263,19 @@
 
 ---
 
-### Phase 2: Workspace Machine — backend-agent process model
+### Phase 2: Workspace Cloudlet — secure-by-default process model
 
-**Goal**: Workspace Machine runs boring-ui in backend-agent mode. Agent runs directly on the Machine (no sandbox).
+**Goal**: Workspace Cloudlet runs boring-ui in backend-agent mode. Agent runs inside a minimal, secure-by-default `bwrap` sandbox.
 
 **Edit**:
 - `app.py`: When `agents_mode == "backend"` and no DB configured, mount workspace routers only (no control_plane)
-- `pi_service/tools.mjs`: Execute commands directly on workspace filesystem (already does this)
-- Dockerfile: ensure Node.js + pi_service available in image
+- `pi_harness.py` (or equivalent): Spawn agent tools via `bwrap` with a strict policy (`--clearenv`, `--unshare-net`, specific `/w/` mounts).
+- Dockerfile: ensure Node.js, `bwrap`, and pi_service available in image
 
 **New files**:
+- `src/back/boring_ui/agent/bwrap_policy.py`: Defines default and named sandbox policies.
 - `deploy/fly/fly.control-plane.toml` — control plane Machine config
 - `deploy/fly/fly.workspaces.toml` — workspace Machine config
 
@@ -256,12 +283,13 @@
 
 ---
 
-### Phase 3: Frontend integration
+### Phase 3: Frontend integration + Instant Resume
 
-**Goal**: Frontend handles backend-agent mode. Capabilities endpoint exposes workspace state.
+**Goal**: Frontend feels instantaneous by speculatively pre-warming the backend Cloudlet.
 
 **Edit**:
 - `/api/capabilities` returns workspace runtime info (agent mode, placement)
+- Control Plane: Add internal endpoint `POST /api/internal/workspaces/{id}/resume`
+- Frontend: On key UI events (e.g., login, dashboard view, opening a workspace link), asynchronously call the resume endpoint. The user should never see a "Starting workspace..." spinner.
 - Frontend: backend-agent → agent panel uses `/ws/agent/normal/*`, no browser-side LLM
 - PTY runs on workspace Machine
 
@@ -285,13 +313,13 @@
 
 | Setting | frontend (single Machine) | backend: control plane | backend: workspace Machine |
 |---|---|---|---|
 | `agents.mode` | `frontend` | `backend` | `backend` |
-| `[frontend.data] backend` | `lightningfs` | n/a | `http` |
+| `[frontend.data] backend` | `lightningfs` | N/A | `http` |
 | Fly Machines | 1 (always-on) | 1 (always-on) | N (auto-stop) |
 | Routers | all | `control_plane` only | files, git, pty, chat_claude_code, ui_state |
 | `DATABASE_URL` | required | required | not set |
 | `BORING_SESSION_SECRET` | required | required | required (same value) |
-| `ANTHROPIC_API_KEY` | not needed (browser) | not needed | required (PiHarness calls LLM directly) |
+| `ANTHROPIC_API_KEY` | not needed (browser) | not needed | **Injected into bwrap sandbox**, not host env |
 | `FLY_API_TOKEN` | not needed | required | not needed |
 | PiHarness | not started | not started | started |
-| Agent execution | browser (LightningFS + Pyodide) | n/a | direct on Machine (no sandbox) |
+| Agent execution | browser (LightningFS + Pyodide) | N/A | **Inside bwrap sandbox** on Machine |
 | Volume | none | none | Fly volume at /workspace |
 | Auto-stop | never | never | suspend on idle |
 
@@ -301,10 +329,10 @@
 | Risk | Mitigation |
 |---|---|
 | Fly.io rate limits (1 req/s create) | Pre-created machine pool for burst |
 | Volume data loss (NVMe failure) | Fly daily snapshots + git push |
-| Cold start (~1-2s from stopped) | Use `suspend` (~300ms resume) |
-| Agent reads env secrets | Acceptable for v1 (single-tenant). Post-MVP: bwrap `--clearenv` |
-| Agent network access | Acceptable for v1. Post-MVP: bwrap `--unshare-net` |
+| Cold start (~300ms from suspend) | **Mitigated by speculative pre-warming**. User-perceived latency should be <100ms. |
+| Agent reads host secrets | **Mitigated**: `bwrap --clearenv` prevents agent from reading `BORING_SESSION_SECRET` or other host secrets. |
+| Agent network access | **Mitigated**: `bwrap --unshare-net` disables network access by default, preventing exfiltration. |
 | Fly lock-in | WorkspaceProvisioner/Router interfaces decouple app from provider |
 
 ---
 
@@ -334,26 +362,24 @@
 | `fly.toml` generation | `bui deploy` generates | Runs `bui deploy` |
 | Custom routers / panels | Schema supports | Registers own |
 | Agent config | `[agents]` schema | Chooses mode + agent |
 
 ### Key constraint
 
-**Same Docker image**: Child apps should not need custom images for backend-agent mode. The framework image includes all dependencies. Child-specific code is mounted or bundled at deploy time via `bui deploy`.
+**Composable Docker Image**: The framework provides a base image with all core dependencies (Python, Node, bwrap). For child apps, `bui deploy` will orchestrate a multi-stage Docker build that layers the child app's specific code and dependencies on top of this base image. This provides flexibility without forcing child apps to reinvent the entire stack.
 
----
-
-## Post-MVP: Sandbox Hardening
-
-When needed (untrusted tenants, stricter isolation requirements), cherry-pick from `sandbox-poc-archive` branch:
-
-- `bwrap.py` — bubblewrap backend with `--clearenv --unshare-all`, no `/proc`, user separation
-- `validated_exec.py` — command allowlist fallback
-- `backend.py` — `ExecutionBackend` protocol
-- `presenter.py`, `auth.py`, `router.py` — sandbox HTTP surface
-
-This adds defense-in-depth inside the VM: agent commands run in a namespace sandbox with scrubbed env, no network, no access to backend secrets. The VM boundary remains the primary isolation; bwrap hardens the agent-within-VM boundary.
-
 ---
 
 ## Post-MVP: Future Enhancements
 
-From Codex review — valid but deferred:
-
-- **Credential brokering**: Short-lived leases instead of raw API keys in workspace env
-- **Workspace snapshots/templates/branching**: Product UX on top of Fly volume snapshots
+- **Collaborative Workspaces**: Leverage Fly's private networking and NATS to enable multiple users to connect to the same Workspace Cloudlet for real-time, shared environment collaboration.
+- **Advanced Credential Brokering**: Integrate a service like Vault or Confidant to provide short-lived, finely-scoped credentials directly to the `bwrap` sandbox, completely eliminating static secrets from the environment.
+- **Workspace-as-Code**: Build out the `bui` CLI and Git provider integrations to fully realize the vision of managing environments like code branches (fork, snapshot, merge, PR).
 - **Audit/event journal**: Per-command execution ledger
 - **Warm pool**: Pre-booted machines for low-latency resume
 - **Quotas + egress policy**: Default-deny network, explicit allowlists
 - **Extended lifecycle states**: provisioning, warming, sealed, quarantined
+- **Regional Affinity**: Automatically launch Workspace Cloudlets in the Fly region closest to the user or their data sources (e.g., a Neon database) for lower latency.
 - **Self-hosted backend**: `HetznerProvisioner` + bwrap (needs sandbox layer)
 
 ---
 
```