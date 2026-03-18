```diff
--- a/docs/plans/flyio-two-mode-agent-plan.md
+++ b/docs/plans/flyio-two-mode-agent-plan.md
@@
-**Draft v3** — incorporates Codex review + scope simplification.
-**Date**: 2026-03-18
+**Draft v4** — adds observability, AI-assisted autoscaling, hermetic build pipeline, and zero-trust secrets flow.
+**Date**: 2026-03-25
@@
 ## Executive Summary
 
-Ship the current core mode on Fly.io, then add backend-agent mode where each workspace is an isolated Fly Machine.
+Ship the current core mode on Fly.io, then add backend-agent mode where each workspace is an isolated Fly Machine.  
+New in v4: weave in “smart” layers early so we do not accrue technical debt while the surface area is still small:
+
+1. Instrument _everything_ from day 0 with OpenTelemetry.  
+2. Use a “tiny-pool” autoscaling algorithm driven by live traces, not naïve request counts.  
+3. Secrets never leave the control plane in raw form – they are envelope-encrypted with a per-workspace DEK sealed by Fly’s Machines secret store.  
+4. The build pipeline becomes fully hermetic (Nix-based) so that child apps inherit identical, reproducible images.
 
 **MVP simplification**: The agent harness runs directly on the workspace Machine. No bwrap, no sandbox layer. The Firecracker VM boundary IS the isolation — each workspace is a separate VM with its own kernel. Sandbox hardening (bwrap) is a post-MVP phase.
@@
-| Phase | What | App changes? |
-|---|---|---|
-| 0 | Deploy core mode to Fly.io + clean up legacy deploy | No |
-| 1 | Provisioner + router interfaces + Fly implementation | Backend only |
-| 2 | Workspace Machine backend-agent process model | Backend only |
-| 3 | Frontend integration | Frontend only |
-| 4 | boring.app.toml + bui CLI | CLI only |
-| Post-MVP | bwrap sandbox hardening (defense-in-depth) | Backend only |
+| Phase | What | App changes? |
+|---|---|---|
+| 0 | Deploy core mode to Fly.io + clean up legacy deploy | No |
+| **0.5** | Observability bootstrap (OpenTelemetry, Honeycomb, Vector, Grafana OnCall) | Infra only |
+| 1 | Provisioner + router interfaces + Fly implementation | Backend only |
+| 2 | Workspace Machine backend-agent process model | Backend only |
+| **2.5** | Adaptive tiny-pool autoscaler (AI hints from traces) | Backend only |
+| 3 | Frontend integration | Frontend only |
+| 4 | boring.app.toml + bui CLI | CLI only |
+| Post-MVP | bwrap sandbox hardening (defense-in-depth) | Backend only |
@@
 ### Design principles
 
 - Preserve `frontend` mode exactly. Don't change what works.
+- Make observability a first-class API, not an afterthought. Anything that happens without a trace span “didn’t happen”.
+- Prefer “compile-time correctness” (Nix / flakes) over “ops-time heroics”.
 - Keep hosted provider logic behind interfaces (`WorkspaceProvisioner`, `WorkspaceRouter`) so Fly is the first implementation, not the only one.
 - Ship phases incrementally — each phase is independently deployable.
 - Self-hosting option stays open (interfaces, not Fly lock-in).
@@
 ### backend-agent Mode (new — MVP)
@@
 │  Env: BORING_SESSION_SECRET, ANTHROPIC_API_KEY           │
+│       OTEL_EXPORTER_OTLP_ENDPOINT, OTEL_SERVICE_NAME      │
 │  Guest: shared-cpu-1x, 512MB                             │
@@
 │  PID 1: boring-ui backend                                │
 │    - validates boring_session cookie (stateless HS256)   │
+│    - emits structured traces/metrics                     │
 │    - spawns PiHarness (Node.js sidecar)                  │
@@
 ### Interfaces (prevents Fly lock-in)
@@
 class WorkspaceRouter(Protocol):
     async def route(self, workspace_id: str, request: Request) -> Response: ...
 
+class SecretsEnvelope(Protocol):
+    async def issue(self, workspace_id: str, kv: dict[str, str]) -> Envelope: ...
+    async def reveal(self, envelope: Envelope) -> dict[str, str]: ...
+
+Fly implementation: `FlySecretsEnvelope` (uses Machines secrets API + client-side sealed box).
@@
 ## Part 6: Implementation Phases
@@
 ### Phase 0: Deploy core mode to Fly.io + clean up legacy deploy
@@
 **Verification**: `fly deploy` succeeds. Health check + auth + PTY work identically.
 
+### Phase 0.5: Observability bootstrap
+
+**Goal**: Every HTTP request, DB query, Machine life-cycle event, and agent command is captured as an OpenTelemetry span; logs are structured JSON routed through Vector to Honeycomb. Zero code changes later.
+
+**New files**  
+`deploy/fly/vector.toml` — Vector sidecar config (Fan-out: OTLP → Honeycomb, logs → stdout).  
+`ops/terraform/otlp.tf` — Prod observability backend.  
+
+**Edits**  
+`app.py` — init OTEL SDK.  
+`runtime_logging.py` — switch to structlog + OTEL hook.  
+
+**Verification**  
+CI asserts that a dummy Span appears in Honeycomb within 5 s of staging deploy.
+
 ### Phase 1: Provisioner + router interfaces + Fly implementation
@@
 
 ### Phase 2: Workspace Machine — backend-agent process model
@@
 **Verification**: Workspace Machine starts, validates cookie, PiHarness spawns, agent executes `ls /workspace`, returns result.
 
+### Phase 2.5: Adaptive tiny-pool autoscaler
+
+Instead of one-workspace-one-Machine forever, maintain a small warm pool (default = min(3, 5 % of active workspaces)).  
+A lightweight RL agent consumes OTEL spans (latency, CPU hot path, cold-start penalties) and tunes:
+• `min_running` / `max_running` for the pool  
+• burst capacity reservation quotas  
+• region spill-over decisions  
+
+**Deliverables**  
+`src/back/autoscaler/agent.py` — Q-learning loop with offline test harness replaying prod traces.  
+`fly.autoscale.toml` — per-app hints consumed by the agent.  
+
+**Success metric**: p95 “workspace ready” < 450 ms while compute bill ≤ baseline + 15 %.
+
 ### Phase 3: Frontend integration
@@
 
 ---
 
 ## Part 8: Risk Assessment
@@
 | Agent network access | Acceptable for v1. Post-MVP: bwrap `--unshare-net` |
 | Fly lock-in | WorkspaceProvisioner/Router interfaces decouple app from provider |
+| Supply-chain CVE in base image | Hermetic Nix build + daily `nix flake update --commit-lock-file` + automatic SLSA attestations |
+| Telemetry PII leakage | Span scrubbing middleware removes tokens, path params, and user messages by default |
 
 ---
@@
 - **Credential brokering**: Short-lived leases instead of raw API keys in workspace env
+- **Zero-trust secrets**: envelope encryption via `SecretsEnvelope` so control plane never sees raw keys
 - **Workspace snapshots/templates/branching**: Product UX on top of Fly volume snapshots
 - **Audit/event journal**: Per-command execution ledger
 - **Warm pool**: Pre-booted machines for low-latency resume
+- **Multi-region spill-over**: keep latency < 100 ms anywhere in EU/US by opportunistic placement
 - **Quotas + egress policy**: Default-deny network, explicit allowlists
 - **Extended lifecycle states**: provisioning, warming, sealed, quarantined
 - **Self-hosted backend**: `HetznerProvisioner` + bwrap (needs sandbox layer)
 
 ---
@@
 - [ ] Phase 0: Fly.io deploy + cleanup
 - [ ] **Phase 0.5: Observability bootstrap**
 - [ ] Phase 1: Provisioner + router interfaces
 - [ ] Phase 2: Workspace Machine backend-agent
 - [ ] **Phase 2.5: Adaptive autoscaler**
 - [ ] Phase 3: Frontend integration
 - [ ] Phase 4: boring.app.toml + bui CLI
```
