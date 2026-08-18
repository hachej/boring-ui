The plan is not executable as written. I verified it against local `refs/heads/main` at `2e16d787`.

1. **R3 cannot reconstruct the current session state. — VERDICT: plan-breaking**

   The proposed kill-9 equality test assumes the canonical record contains everything needed to recreate model-visible state ([plan:240–266](/tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/2f6c6143-73be-4a87-886b-e8dd7fb126e0/scratchpad/docs-research/ARCHITECTURE-PLAN.md:240)). It does not.

   Cold recovery hardcodes `status: "idle"` and an empty queue (`main:packages/agent/src/server/pi-chat/harnessPiChatService.ts:371-386`). Live queue/auth context is held in memory and partly in a `WeakMap` (`main:packages/agent/src/server/createHarness.ts:405-439`). The system prompt is recomputed on each turn from live composition (`main:packages/agent/src/server/createHarness.ts:164-173`; `main:packages/agent/src/server/buildAgentComposition.ts:242-271`). JSONL recovery restores messages, not those inputs (`main:packages/agent/src/server/pi-chat/sessions.ts:303-313`).

   Consequently:

   - “state = replay(record + envelope)” is false.
   - The proposed kill-9 test cannot pass for queued work, dynamic prompts, transient authorizations, or active runtime state.
   - Delete reconciliation cannot determine whether missing state was deliberately deleted or was never persisted.

2. **A2 conflates two stores that have incompatible semantics. — VERDICT: plan-breaking**

   A2 calls for replacing a host-wide SQLite event store with per-agent JSONL and migrating existing JSONL sessions ([plan:116–118](/tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/2f6c6143-73be-4a87-886b-e8dd7fb126e0/scratchpad/docs-research/ARCHITECTURE-PLAN.md:116)). These are not interchangeable records.

   The event database stores scoped event offsets, idempotency keys, payloads, and cursors (`main:packages/agent/src/server/events/eventStreamStore.ts:69-92`; `main:packages/agent/src/server/events/eventStreamStore.ts:178-220`). JSONL transcripts use a separate directory layout (`main:packages/agent/src/server/pi-chat/sessions.ts:59-104`) and already have agent/workspace-derived namespaces (`main:packages/agent/src/server/pi-chat/sessionInventory.ts:19-28`; `main:packages/agent/src/server/pi-chat/sessionInventory.ts:80-101`).

   The plan omits:

   - Cursor and offset compatibility.
   - Idempotency-key preservation.
   - Dual-read or version-detection behavior during rollout.
   - Quiescence and rollback procedures.
   - Migration of the SQLite event database itself.
   - Treatment of intermediate events that never became transcript messages.

   This is also the single item most likely to explode in cost: A2 is presented as storage-layout work, but it is actually a session semantics, authorization, event-protocol, migration, rollback, and deployment-topology rewrite.

3. **R2 has an unhandled distributed-commit failure between the ledger and the canonical record. — VERDICT: plan-breaking**

   The ledger stores a digest/status record, not the request or resulting session payload (`main:packages/agent/src/server/agent-host/types.ts:72-109`; `main:packages/agent/src/server/agent-host/sqliteRequestLedger.ts:48-54`). The gateway marks an operation in-flight before performing it (`main:packages/agent/src/server/agent-host/embeddedGateway.ts:790-804`).

   Under C4’s split-host topology:

   - Host records `in-flight`.
   - Agent appends the session record.
   - Host crashes before recording completion.

   On restart, the host cannot tell whether to retry without duplicating effects. Conversely, a crash before the remote append loses an accepted action. An ACK lost after append leaves an indefinitely in-flight operation.

   C5/C6 are listed only as later additions ([plan:218–222](/tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/2f6c6143-73be-4a87-886b-e8dd7fb126e0/scratchpad/docs-research/ARCHITECTURE-PLAN.md:218)), but a deduplication/commit/reconciliation protocol is a prerequisite for C4, not follow-up cleanup.

4. **C4 moves an authorization oracle into the untrusted agent. — VERDICT: plan-breaking**

   Session ownership is currently enforced from transcript metadata and runtime pins. `HarnessPiChatService` checks access before loading a session (`main:packages/agent/src/server/pi-chat/harnessPiChatService.ts:1092-1097`). `PiSessionStore` checks tenant and runtime ownership recorded in the transcript (`main:packages/agent/src/server/pi-chat/sessions.ts:994-1017`). Session inventory uses the record’s runtime pin to select its binding (`main:packages/agent/src/server/pi-chat/sessionInventory.ts:58-73`).

   Under C4, the untrusted agent owns that record while the host ledger remains deliberately non-authoritative. A malicious or compromised agent can rewrite the metadata that the host relies on to decide who owns a session.

   A2b does not fix this because it explicitly creates a non-authoritative index. C4 requires a host-authoritative session catalog or host-signed record envelopes before record ownership can move.

5. **Track B’s declared order creates package cycles before it removes them. — VERDICT: plan-breaking**

   B4 is described as the first, pure, zero-risk move ([plan:135–136](/tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/2f6c6143-73be-4a87-886b-e8dd7fb126e0/scratchpad/docs-research/ARCHITECTURE-PLAN.md:135)). The plugins are not currently separable:

   - Filesystem frontend code imports workspace-private registry, bridge, and panel APIs (`main:packages/workspace/src/plugins/filesystem/front/index.ts:4-30`; `main:packages/workspace/src/plugins/filesystem/front/agentFileBridge.tsx:4-9`).
   - The URL plugin imports workspace-local APIs (`main:packages/workspace/src/plugins/url/front/UrlPane.tsx:6-8`).
   - Workspace imports those plugins as built-ins (`main:packages/workspace/src/WorkspaceProvider.tsx:34`; `main:packages/workspace/src/WorkspaceProvider.tsx:567-570`).

   B1 is also not a leaf extraction: `defineServerPlugin` imports Agent server types and Workspace bridge contracts (`main:packages/workspace/src/server/plugins/defineServerPlugin.ts:1-5`), while frontend factories import Workspace panel and surface contracts (`main:packages/workspace/src/shared/plugins/frontFactory.ts:1-13`).

   B1/B3 and new leaf contracts must precede B4. A1 and B2 are also prerequisites, so the claimed A/B independence is false.

6. **The plan removes Workspace’s plugin-host role without assigning that role elsewhere. — VERDICT: plan-breaking**

   B1 is described as an SDK covering “define → scan → load → serve → consume,” while the target says Workspace is no longer a plugin host. Loading and serving runtime plugins are host execution responsibilities, not SDK responsibilities.

   The public plugin contract currently says the host imports plugin routes and tools (`main:packages/workspace/docs/PLUGIN_SYSTEM.md:69-80`). The proposed package split names no trusted process that will scan manifests, resolve runtime code, enforce capabilities, mount routes, manage lifecycle, and isolate failures after Workspace stops doing so.

   This is not a file-movement gap. It is an absent runtime component.

7. **The claimed retirement of arbitrary plugin RCE is not implemented by any track. — VERDICT: plan-breaking**

   The plan identifies runtime path imports as a fatal issue and claims C4 retires them ([plan:78–87](/tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/2f6c6143-73be-4a87-886b-e8dd7fb126e0/scratchpad/docs-research/ARCHITECTURE-PLAN.md:78)). The current registry still resolves and dynamically imports external runtime paths (`main:packages/workspace/src/server/plugins/runtimeBackendRegistry.ts:226-245`). External runtime plugins remain enabled in generic server construction (`main:packages/workspace/src/server/createWorkspaceAgentServer.ts:1280`; `main:packages/workspace/src/server/createWorkspaceAgentServer.ts:1399`; `main:packages/workspace/src/server/createWorkspaceAgentServer.ts:1592`).

   Moving user-authored agents out of process does not disable runtime plugin imports in the host. B1 merely relocates the machinery. The plan needs an explicit removal, default-deny transition, sandboxing boundary, compatibility policy, and migration for existing external plugins.

8. **C4 has no deploy topology for the data it relocates. — VERDICT: plan-breaking**

   The current web image owns durable session storage at `/data/pi-sessions` (`main:apps/full-app/Dockerfile:131-138`). The worker image owns `/data/workspaces` and has no session volume, routing, or lifecycle for per-agent records (`main:apps/full-app/Dockerfile:147-189`; `main:docker/worker-entrypoint.sh:6-24`). Deployment, migrations, and backups are explicitly app-owned concerns (`main:apps/full-app/README.md:102-109`; `main:apps/full-app/README.md:162-179`).

   C4 omits:

   - Durable volume allocation per agent.
   - Agent placement and session-affinity routing.
   - Discovery and restart behavior.
   - Backup/restore ownership.
   - Coexistence during staged deployment.
   - Garbage collection for removed agent types.
   - Deployment changes in the external tenant repositories.

9. **The new package topology is absent from release and CI infrastructure. — VERDICT: plan-breaking**

   A1, B1, and B4 add publishable packages, but release tooling uses hard-coded package lists (`main:scripts/version.mjs:13-40`; `main:scripts/audit-publish-manifests.mjs:18-40`). Release publishing and validation are likewise enumerated (`main:.github/workflows/release.yml:43-83`). CI change detection and package checks are hard-coded (`main:.github/workflows/ci.yml:53-80`; `main:.github/workflows/ci.yml:754-783`).

   The compatibility proposal is also not a semver plan. Agent’s `/shared` and Workspace root exports are published public APIs (`main:packages/agent/package.json:17-20`; `main:packages/workspace/src/index.ts:64-93`). Repository policy classifies export renames as breaking changes (`main:docs/DECISIONS.md:262-277`), while release scripts default to patch releases (`main:scripts/cut-release.sh:7-16`).

   “Shim for one release, remove next release” is unsafe without package-major sequencing and compatible peer-dependency ranges.

10. **C1 is sequenced before the authority and protocol it requires. — VERDICT: plan-breaking**

   C1 precedes C3 in the plan ([plan:138–149](/tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/2f6c6143-73be-4a87-886b-e8dd7fb126e0/scratchpad/docs-research/ARCHITECTURE-PLAN.md:138)), but an environment-specific execution endpoint requires verified environment claims, lease lifetime, authorization, idempotency, and audit semantics.

   Existing environment routes already authorize scoped operations and manage finite leases (`main:packages/agent/src/server/agent-host/environmentHttpProjection.ts:25-109`), but the public environment lease has no execution operation (`main:packages/agent/src/server/agent-host/types.ts:303-311`). A separate legacy worker endpoint already exposes workspace execution (`main:packages/agent/src/server/worker/routes.ts:103-127`).

   The cited V1 execution schema is yet another protocol, using `invocationId`, `command`, and `credentialRefs` (`main:packages/boring-sandbox/src/contracts/remoteWorkerProtocolV1.ts:326-360`). Its client does not match the legacy Agent route (`main:packages/boring-sandbox/src/remote/protocolClient.ts:453-466`).

   “Three pieces” conceals a protocol merge plus an authority redesign. C3 must establish the claims and lease model before C1 exposes execution.

11. **A3’s “standalone runs today” grounding claim is false for the proposed product. — VERDICT: plan-breaking**

   The executable labels itself a minimal E2E development server and says the previous CLI was removed (`main:packages/agent/src/bin/boring-agent.ts:1-13`). It imports Vite and source files from the repository playground (`main:packages/agent/src/bin/boring-agent.ts:70-120`), uses a hard-coded session and permissive CORS (`main:packages/agent/src/bin/boring-agent.ts:125-155`), is not declared as a package `bin` (`main:packages/agent/package.json:12-58`), and is not built by tsup (`main:packages/agent/tsup.config.ts:6-17`).

   The “cheap npx product” estimate ([plan:350–354](/tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/2f6c6143-73be-4a87-886b-e8dd7fb126e0/scratchpad/docs-research/ARCHITECTURE-PLAN.md:350)) therefore omits packaging, assets, production auth, storage configuration, onboarding, upgrade behavior, and distribution tests.

12. **R1’s authority/mechanism split is incomplete and contradicted by current authority sources. — VERDICT: serious**

   R1 says authority is capability, scope, identity, and ledger state, and that mechanism is never runtime-mutable ([plan:24–29](/tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/2f6c6143-73be-4a87-886b-e8dd7fb126e0/scratchpad/docs-research/ARCHITECTURE-PLAN.md:24)). Concrete counter-scenarios:

   - MCP grants are explicitly runtime mutable through `put` and `delete` (`main:packages/agent/src/server/mcp/mcpGrantStore.ts:13-17`; `main:packages/agent/src/server/mcp/mcpGrantStore.ts:102-133`).
   - Session records themselves currently determine tenant/runtime ownership, so storage is an authority source, not merely a mechanism.
   - Custom model configuration accepts externally configured provider URLs and credentials (`main:packages/agent/src/server/modelConfig.ts:200-243`). Choosing a model changes who receives prompts, history, tools, and retrieved data. That is confidentiality authority, not just execution mechanism.

   R1 only models permission to act. It omits permission to disclose data, integrity of authority-bearing records, revocation epochs, and delegated trust.

13. **R2’s “append-only record” contradicts the surviving host ledger. — VERDICT: serious**

   R2 and R3 rely on an append-only record/envelope model, but ledger transitions overwrite the current SQLite row and discard prior status history (`main:packages/agent/src/server/agent-host/sqliteRequestLedger.ts:149-172`). A replay cannot reconstruct retry timing, intermediate failures, or transition provenance from that table.

   Either ledger transitions must become append-only events included in the record model, or the plan must stop claiming the envelope plus record is sufficient for recovery and audit.

14. **§7’s convergence table hand-waves at least four open designs. — VERDICT: serious**

   - **R-33-02 / C5:** There is already a durable ask-user product with stored pending requests, answers, transcript events, bridge handlers, and UI publication (`main:plugins/ask-user/src/server/askUserStore.ts:28-55`; `main:plugins/ask-user/src/server/askUserServerPlugin.ts:21-72`). Restart currently abandons pending waiters (`main:plugins/ask-user/src/server/askUserRuntime.ts:117-123`). “Centralize in C5” omits ownership, storage migration, API compatibility, UI cutover, and restart semantics.
   - **R-33-06 / C2:** Current isolated execution supports shell/Python, not generic host tool dispatch (`main:packages/boring-bash/src/runtime/harness/index.ts:170-240`). A summary and tool identity do not define dispatcher RPC, schemas, event streaming, failure semantics, or authorization for arbitrary tools.
   - **R-33-12:** The existing agent-type model has instructions, knowledge, plugins, and model configuration (`main:packages/agent/src/server/agent-host/types.ts:158-190`). The fleet compiler validates only a subset (`main:packages/agent/src/server/agent-host/fleetCompiler.ts:84-115`). There is no specified profile, bundle, patch, inheritance, or conflict model to absorb.
   - **R-33-14:** Custom persistence remains a published extension point through `sessions?: SessionStore` (`main:packages/agent/src/shared/events.ts:95-107`; `main:packages/agent/src/server/createAgent.ts:55-96`). Making one record mandatory does not supersede backend selection.

15. **R-33-11 is marked absorbed, but the actual revocation hole is unscheduled. — VERDICT: serious**

   The plan’s D-1 premise is stale: current host and Core verifiers recheck scope and membership on operations (`main:packages/agent/src/server/agent-host/createAgentHost.ts:340-346`; `main:packages/core/src/server/createCoreWorkspaceAgentServer.ts:371-387`).

   The remaining defect is more specific: opening a connection is verified, but its event callback continues publishing without re-verification (`main:packages/agent/src/server/agent-host/embeddedGateway.ts:375-420`). Command calls reverify independently (`main:packages/agent/src/server/agent-host/embeddedGateway.ts:425-451`).

   §7 marks revocation absorbed, and §9.6 merely assumes “post-fix conformance” ([plan:344–348](/tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/2f6c6143-73be-4a87-886b-e8dd7fb126e0/scratchpad/docs-research/ARCHITECTURE-PLAN.md:344)). No track implements connection epochs, stream invalidation, or disconnect-on-revocation.

16. **Several baseline grounding claims are wrong or stale. — VERDICT: serious**

   - The ledger is not keyed by `(agentTypeId, sessionId)`. Its key includes workspace, auth subject, operation, target, and request ID (`main:packages/agent/src/server/agent-host/requestLedger.ts:10-20`).
   - Production hosts already default to durable SQLite ledgers (`main:packages/agent/src/server/agent-host/createAgentHost.ts:297-302`), contradicting the implication that only an in-memory ledger exists.
   - Boring Sandbox does not have an open descriptor registry. It has a closed five-provider object (`main:packages/boring-sandbox/src/providers/static.ts:30-57`).
   - The “zero value imports” claim is false: the runsc integration dynamically imports Agent value factories (`main:packages/boring-sandbox/scripts/integrate-docker-runsc-runtime.mjs:27-30`).
   - P0.1 points at `mergeTools`, but production composition directly concatenates tools (`main:packages/agent/src/server/buildAgentComposition.ts:204-218`). `mergeTools` is not on that production path (`main:packages/agent/src/server/catalog/mergeTools.ts:31-64`).
   - The asserted canonical execution vocabulary conflates the V1 sandbox client with the incompatible legacy Agent worker route.

17. **A2b duplicates an existing index while providing weaker coverage. — VERDICT: serious**

   The existing inventory already enumerates configured session stores and incorporates agent/workspace namespaces (`main:packages/agent/src/server/pi-chat/sessionInventory.ts:19-28`; `main:packages/agent/src/server/agent-host/embeddedGateway.ts:264-290`). An envelope-derived index cannot discover legacy JSONL sessions that have no corresponding ledger entry.

   A2b therefore introduces a second index without specifying reconciliation, backfill, precedence, corruption handling, or deletion semantics.

18. **The declared dependency graph omits newly admitted critical work. — VERDICT: serious**

   The graph contains A1–A5, B1–B6, C1–C4, and D1–D2 ([plan:91–100](/tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/2f6c6143-73be-4a87-886b-e8dd7fb126e0/scratchpad/docs-research/ARCHITECTURE-PLAN.md:91)). A6, C5, and C6 appear only later in §7, outside the dependency graph. D2 depends on A2’s canonical record semantics but is visually presented as parallel.

   This permits contract freezing and remote-host extraction before interruption, confirmation, deduplication, migration, or replay semantics exist—the exact ordering that creates the R2 commit gap.

19. **The package-version grounding is stale. — VERDICT: minor**

   The plan reports version `0.1.98`; local main’s root, Agent, and Workspace packages are `0.1.99` (`main:package.json:4`; `main:packages/agent/package.json:3`; `main:packages/workspace/package.json:3`). This is minor by itself, but it reinforces that the package/release audit was not performed against the reviewed main revision.

Residual scope: external Seneca/Constellation deployment repositories and uncommitted scratch spikes were unavailable, so claims depending on them remain unverified—not established.