# Layer 4 — Delta (Today → North Star)

**Status:** Grounded survey v1 — full-plan.md vs `origin/main` @ `d7efb0469`, surveyed 2026-08-18.
**Method:** 8 parallel code-survey agents, one per area, every "Today" claim verified by reading source (`file:line`). Verbatim evidence reports: [`inbox/2026-08-18-delta-surveys.md`](inbox/2026-08-18-delta-surveys.md).
**Feeds:** `50-epics/`. Every delta row below is an epic seed.

Status vocabulary: **EXISTS** · **PARTIAL** · **WRONG-SHAPE** (exists, must be reshaped) · **MISSING** · **DOC-ONLY** (designed, zero code) · **PROCEDURE-ONLY** (humans following markdown).

---

## 1. Executive summary

The codebase is a **barbell**: an unusually solid transactional floor at the bottom (the ratified C6 admission/ledger protocol is fully implemented and mandatory at the gateway; fail-closed metering with reserve/settle; digest-pinned immutable agent definitions; a real sandbox-provider contract with a qualified gVisor stack; durable event streams behind a flag) — and, at the top, **none of the north star's customer-facing nouns exist**: no Work, no Party, no Outcome, no Delivery, no Channel, no Package/Release, no capability passport.

The dominant pattern across all 8 areas: **mechanism-level excellence, identity-level fragmentation.** Digests, append-only ledgers, unforgeable scopes, leases, and fail-closed seams are idiomatic here — but each subsystem keys them to a different ad-hoc identity (`userId`, `agentTypeId`, `sessionId`, `workspaceId`, `hostId+bindingId`, a second metering `runId`). The north-star vocabulary is largely the *unification layer* this code already wants.

Second pattern: **several things believed done are not on main.** A7/ModelCapabilityIssuer: zero code. PR #578 skill-access policy: branch only. P0.6: *inverted* (see §5). pi-subagents: lives in the pi harness, not this repo. The factory's Beadle supervisor: no code. Treat the ratified register's "done" claims as unverified until re-grounded.

## 2. Area verdicts

| Area | Verdict | Sharpest finding |
|---|---|---|
| A. Identity & governance | PARTIAL | Great integrity primitives; no Party/Actor, no Authority umbrella, Seat = boot config only |
| B. Work & execution spine | PARTIAL | C6 protocol fully real for 10 session verbs; tool calls (the actual effects) run unclassified beneath it; no Work/Run/Attempt |
| C. Channels & experience | WRONG-SHAPE shell / MISSING channels | One chat-workbench shell; plugins cannot contribute routes/pages; inbox is browser `useState`; zero channel code |
| D. Sources & semantics | PARTIAL | Three disjoint source abstractions (fs bindings, SQL adapters, MCP sources); MCP has the model to generalize; no Vintage, no taint |
| E. Artifacts & improvement | PARTIAL | RunId evidence join real for 3 of 6 hops; artifacts built twice (UI pointer vs digest ref); outcomes entirely missing |
| F. Packaging & distribution | WRONG-SHAPE | One lifecycle stage ("directory on disk, hot-rescanned"); external plugin servers hot-loaded into host (P0.6 inverse) |
| G. Automation, factory, ops | PARTIAL / PROCEDURE-ONLY | Scheduler + fleet substrate are real code; the factory control loop (dispatch, Beadle, gates, trust ladder) is humans + markdown |
| H. Sovereignty & deployment | PARTIAL, built-but-unwired | BYOK vault built, zero consumers; F-33-G15 model-auth bypass live; runsc qualified but unmounted; no export, no residency |

## 3. Per-area delta detail

### A. Identity, Parties, Authority & Governance

| Capability | Status | Today (evidence) | Delta |
|---|---|---|---|
| Party vs Actor | MISSING | Identity roots = better-auth `users` + `workspaces.createdBy` (`packages/core/src/server/db/schema.ts:49`); billing user-scoped | Party root + role bindings; re-key ownership/credits to Actor-for-Party |
| Agent identity + revisions | PARTIAL | Strong content identity (`definitionDigest`, `agent-definition.ts:46`; append-only binding admissions `schema.ts:480`); no issuer namespace, no fork/revoke lineage; `agentTypeId` is the de-facto identity | Issuer-namespaced subject ID + lineage over existing digest machinery; record revision per run |
| Seat (Agent↔Instance binding) | WRONG-SHAPE | `fleet.yaml` seats = boot config; runtime bindings = process leases; MCP grants default-deny per `(workspaceId, agentTypeId)` (`mcpGrants.ts:40`); budgets attach to *users* | Durable Seat record (identity, instance, role, ceiling, budget) resolved at admission; unify 3 identity schemes |
| Host-issued Authority | PARTIAL | Real narrowing seams: unforgeable `AuthorizedAgentScope` (`gateway/types.ts:33`), leased non-serializable credentials (`hostResolver.ts:240`), workspace RBAC audited by test (`workspaceAuthAudit.test.ts`) | Authority decomposition (ceiling/grant/decision) + delegation depth + revocation cascade |
| Effect-bound Approval | WRONG-SHAPE | ask-user = question channel, binds to `questionId` only; no proposal digest, expiry, invalidation, step-up, quorum. Digest-precondition pattern exists host-side (destructive publication ledger `schema.ts:501`) | Approval record = ask-user delivery × destructive-publication preconditions (digest-bound, single-use, atomic) |
| Authentication context | MISSING | Sessions store ip/UA only; CLI bridge trusts supplied `{workspaceId,userId}` (`createWorkspaceAgentServer.ts:1249`) | AuthN-context record on consequential decisions; classify local bridge as low-assurance |
| Durable audit | PARTIAL | Money + host publication have append-only attributed facts; everything else is analytics-shaped `telemetry_events` | Consequential-action audit stream (actor + party + authority + purpose + target version) |
| Trusted/untrusted tiers | PARTIAL | Real at sandbox/credential layer (`trust: trusted\|untrusted`, fd-3/tmpfs delivery, egress allowlists); **no untrusted plugin tier** (see F) | Untrusted plugin execution + promotion record |

### B. Work & the execution spine

| Capability | Status | Today (evidence) | Delta |
|---|---|---|---|
| Work identity | MISSING | Durable units = pi chat sessions (JSONL); tasks plugin is a read-only board over GitHub/beads | New Work aggregate; all surfaces attach to it |
| Admission-first | PARTIAL | C6 fully implemented + mandatory for all 10 gateway effects (`embeddedGateway.ts:708-846`); but `effectAdmission` default is a stub receipt string (`createAgentHost.ts:325`) — no payer/authority/revision snapshot | Real admission impl producing an immutable structured snapshot |
| RunId := RequestKey | PARTIAL | `AgentRequestKey` is the ledger key in ratified shape (`types.ts:51`); metering mints a *second* run id (`metering.ts:193`); no Run record joins outputs | Ledger record = canonical Run row; unify metering id; add artifact/effect refs |
| Attempts + fencing | MISSING | In-process lease fencing only (`workspaceAgentLease.ts:136`); no persisted fence epoch; no Attempt records | Durable Attempt table under RequestKey with fence epochs |
| Recovery | PARTIAL | #1009 durable streams + genuine replay exist but **flag-off by default** (`buildAgentComposition.ts:37`); no startup reconciliation — after `kill -9`, in-flight ledger rows wedge forever (`AGENT_REQUEST_IN_PROGRESS`) | Startup reconciliation pass; durable streams default-on; durable follow-up queue |
| Effect taxonomy + unknown-outcome | WRONG-SHAPE / EXISTS | outcome-unknown-never-replay is real (`embeddedGateway.ts:797-820`); but no observe/propose/mutate/external taxonomy anywhere, and **agent tool calls have no effect declaration or idempotency at all** | Effect declaration on tools, durable effect intents, reconciler for unknown→resolved |
| Budgets | PARTIAL | Fail-closed reserve before run; but no mid-run ceiling — one reserved run can burn unbounded tool loops; exhaustion rejects next prompt, no pause/resume | Mid-run budget checkpoints + pause-with-resume |
| Cancellation/deadlines/queues | PARTIAL | Ledgered interrupt/stop; per-session follow-up queue; no per-run deadlines, no host admission queue | Deadline in admission; host-level concurrency queue |

### C. Channels, Threads, Experience & Attention

| Capability | Status | Today (evidence) | Delta |
|---|---|---|---|
| Thread ≠ Work | PARTIAL | Durable server-side sessions with list/load/SSE (`httpProjection.ts:271-434`); no Thread entity, no per-user attribution; transcript *read* requires a live runtime binding (`embeddedGateway.ts:212`) | Thread record in DB; storage-only read path |
| Channel adapters | MISSING | Zero inbound channel code; design fully written (`docs/issues/1127/plan.md:62-130`); inbound MCP = single-tenant env-pinned endpoint; no API-key issuance exists | Build channels package per plan 1127 after Thread/Work land |
| Purpose-built Experience | WRONG-SHAPE | Plugins cannot contribute routes/pages/nav — only panels (`frontFactory.ts:118-125`); the Dockview chat-workbench is the only product shape; semantic surface resolvers are the right seed (`surface.ts:3-49`) | Routed Page/View contribution tier; product-owned nav; per-product theming |
| Chat as optional View | PARTIAL | Chat component injectable, but shell spine *is* chat (panes, composer, overlays in `WorkspaceAgentFront.tsx`); attention refresh rides the chat stream | Extract chat to optional module; attention decoupled from chat |
| Attention plane | PARTIAL | Typed inbox kinds + ask-user store are real; but inbox = browser `useState` (`WorkspaceAttentionProvider.tsx:131`), single producer, no lifecycle/ranking/notification; unanswered question blocks a turn forever | Server-side persisted attention queue, ≥2 more producers, notification delivery, unanswered-policy |
| Exact approvals + deep links | PARTIAL | Deep links explicit-only (good); binding = questionId+token only; **no enforced tool-approval interception exists** — approval display states are orphan enums (`tool.tsx:47`) | Digest-bound single-use approvals + a `canUseTool`-style runtime interception point |
| Multi-workspace/app | PARTIAL | CLI hub registry + per-workspace dispatch real; hosted core has workspaces/members/roles; no entitlement layer, no per-workspace plugin config in core | Port CLI's per-workspace plugin map into core + entitlements |
| Level-0 continuity | PARTIAL | Accidentally good (model-free boot, cold transcript reads, blocked composer); but history read needs a provisioned runtime; no export; model-pinned agents 400 the SSE | Storage-only reads, export route, declared continuity surface |

### D. Sources, Data, Projections & Semantics

| Capability | Status | Today (evidence) | Delta |
|---|---|---|---|
| Heterogeneous Sources | PARTIAL | Three disjoint abstractions: multi-FS bindings (`boring-bash/shared/index.ts:1-58`), governed read-only SQL (`data-bridge/server/index.ts:469`), MCP sources-as-operations (`boring-mcp/shared/index.ts:69`). Everything-as-mount correctly avoided | Unified Source Connection/Resource/Item registry; mail connector |
| Connection lifecycle | PARTIAL | Full lifecycle for MCP only (status/scopes/revocation/OAuth); SQL creds = ambient env | Generalize MCP's model; brokered revocable bindings |
| Projections | PARTIAL | One real policy-inheriting projection (governance regex-filtered fs projection); **no embedding/index stores exist yet** — pre-ranking permission filtering can still be built right | Dependency manifests + revocation propagation; build indexes correctly from day one |
| Vintage | MISSING | Zero occurrences; only `expectedMtimeMs` concurrency | Vintage descriptor on reads/query results, starting with explicit `unversioned` |
| Semantic layer (BSL) | PARTIAL | Real, well-quarantined python worker behind `data.v1.query.*` + guarded eval; query only — no describe/explain, no model digest on results | describe/explain ops + provenance + model registry |
| Deterministic kernels | PARTIAL | Precedents (BSL worker, DuckDB, fingerprinted venvs, isolation evidence); no registry/receipts | Kernel registry (id+version+digest) with receipts |
| Taint / prompt injection | MISSING | No origin labels anywhere; defenses all perimeter-shaped | Origin labels on tool/fs/MCP results + sticky Run taint gating high-impact actions |
| Domain Contract | PARTIAL | Two real typed-op registries: workspaceBridge trusted domain ops (naming, caller classes, idempotency policy — `trustedDomainHandler.ts:11`) and agent tools; no effect/kind declaration; raw fs/bash dominates | Extend trusted-domain metadata with kind+effects; generate agent tool from same definition (parity by construction) |

### E. Artifacts, Delivery, Evidence, Outcomes & Improvement

| Capability | Status | Today (evidence) | Delta |
|---|---|---|---|
| Artifact identity | PARTIAL | Built twice: UI `HumanArtifact` pointer (`humanArtifact.ts:18`) vs digest-bearing `ArtifactRef` types with no persistence (`agent-consumption.ts:185`) | Converge on digest locator + persistence + supersedes chain |
| Delivery | MISSING | "Handover" = UI handoff of pointers at run end; factory's receipt ritual is prose | Delivery record (intent→dispatch→receipt) keyed by artifact+digest+destination |
| Evidence join | PARTIAL | `runId` joins execution + metered cost + artifact pointers (3/6 hops); ask-user decisions carry `sessionId` not `runId`; no Work; no outcomes; usage is `unknown` blob | Thread runId into decisions/tasks; type usage; Work id above session; durable indexed store |
| Preference evidence | PARTIAL | ask-user approvals durable; edits/rejections of agent output unrecorded | Typed preference events from fs + chat panels |
| Outcome capture | MISSING | Nothing; factory retro = free-text friction notes | Outcome record (definition-version, provisional/final) — cheap once Work exists, unbuildable before |
| Evaluators | EXISTS (narrow) | Real YAML eval framework asserting tool trajectories (`packages/agent/src/eval/`, playground runner); UI-review hard gates in CI; **eval fixtures editable by the judged worker in the same PR** — no custody | Fixtures into trust-ladder `class_b_always` now; output-quality evaluators with custody later |
| Candidate/incumbent + promotion | PARTIAL | Immutable digest-pinned revisions done (`piResourceDigest.ts:95`, fleet skill pins); comparison/promotion = git + humans | A/B harness: eval suite vs two pinned fleet revisions |
| Cost attribution | PARTIAL | Metering seam is the best-shaped code in the area (fail-closed, idempotent, billed-micros truth); sink host-provided, no in-repo ledger; ccusage plugin = dev quota only | Default durable usage-facts sink; artifact-cost = join of existing keys |

### F. Packaging, Distribution, Instances & Developer path

| Capability | Status | Today (evidence) | Delta |
|---|---|---|---|
| Package identity/versions | PARTIAL | npm-with-provenance lockstep publish + `.pi/settings.json` registration; runtime version = mutable rescan hash | Digest-keyed Package/PackageVersion records; settings point at immutable resolutions |
| Package→Release→Deployment→Instance | MISSING | Exactly the forbidden "one mutable installed plugin" shape; proto-Release exists in provisioning pack step (`packArtifact.ts:27`) | Introduce all four records; scan pipeline consumes compiled immutable manifest |
| Instance isolation | PARTIAL | Good app-level scoping; but **one global pi auth store for all workspaces** (`cli.ts:145`), shared session root, sandbox opt-in, shared Postgres row-scoping | Per-instance credentials/session roots; default-on sandbox for hosted |
| Capability passport | MISSING | Manifests declare entry paths only, zero capability fields; #578 policy is branch-only | Declared-capabilities manifest block, surfaced at install, enforced at load |
| Overlays & upgrade safety | WRONG-SHAPE | Workspace plugin silently shadows global; update = in-place mutation + hot reload; no lockfile/migration/rollback/diff | Needs Release/Deployment records first; then three-way merge + LKG rollback |
| Trusted vs sandboxed plugins | WRONG-SHAPE | **P0.6 inverted**: external (agent-writable) `boring.server` is affirmatively jiti-imported into the host process (`runtimeBackendRegistry.ts:228-263`); fronts native React in host tree | Policy decision (local-trusted vs hosted default-deny) then iframe/sandbox-proxied tier |
| Developer path | PARTIAL | `npx boring-ui` local hub + full plugin authoring loop (create/scaffold/verify/test/install); no app scaffold, **no deploy**, no hosted target | App templates + manifest + deploy against a hosted control plane |
| Publisher/subscriber boundary | MISSING | No publisher concept; boundary trivially true only because no author-telemetry channel exists at all | Publisher identity on Package records; firewall designed-in before marketplace |

### G. Automation, Triggers, Factory & Operator tooling

| Capability | Status | Today (evidence) | Delta |
|---|---|---|---|
| Automations as governed actors | PARTIAL | `boring-automation` is real (~2.9k lines): cron+tz schedules, hosted heartbeat scheduler, host-derived context fail-closed; zero budgets/loop-prevention/event-triggers; local mode needs external cron | Budget binding via metering seam; trigger/rule revisions; event subscriptions |
| The factory | PROCEDURE-ONLY loop / PARTIAL substrate | Fleet boot + digest pins + tier fallback are code (`loadConfiguredAgentFleet.ts`); dispatch/Beadle/bounce/leases are markdown run by humans over `br`/`gh`; **Beadle has no code** | First bridge: Beadle as a boring-automation reading `policy.yaml` for real |
| Gates | PARTIAL | CI + UI-review gates platform-recorded (`tools/ui-review/src/core/`, `hard-gates.json`); thermo/fresh-eyes/dispositions = agent-authored comments; trust-ladder auto-merge evaluated by nobody | Platform-originated review receipts; negative-control gate tests; executable class-A merge gate |
| Delegation | PARTIAL (out-of-repo) | pi-subagents is a pi-harness plugin, not owned here; no budget narrowing, no child-Work | Platform-owned subagent spawn with narrowing + provenance |
| Model routing | PARTIAL | Seat→tier→model fallback executed at boot; per-automation model choice real; escalation policy = doc | Dispatch-time routing decisions |
| Operator tooling | PARTIAL | Session stop, automation pause, metering seam; no per-run record, no cost dashboard, no scoped kill switches, no replay | Per-run record + runs/cost/kill pane (metering + ledger already capture the facts) |
| Event substrate | PARTIAL | SSE islands + one Postgres LISTEN/NOTIFY bus; ask-user is the one real human-decision channel; no unified envelope/outbox | Shared outbox/event contract — prerequisite for event triggers and factory-on-platform |

### H. Sovereignty, Deployment, Providers & Continuity

| Capability | Status | Today (evidence) | Delta |
|---|---|---|---|
| Model provider authority | WRONG-SHAPE | Replaceability OK (env-named keys, custom OpenAI-compatible, Infomaniak); **A7 has zero code; F-33-G15 live** — per-process cached `AuthStorage/ModelRegistry` (`createHarness.ts:591`) bypasses workspace BYOK; governance allowlists gate listing, not execution | Build A7 invocation-scoped issuer; kill process-lifetime caches |
| Sandbox providers | EXISTS / PARTIAL | `SandboxProviderV1` with 5 impls; gVisor stack (~3.7k LOC) qualified with isolation evidence but **not mounted in the provider union**; remote-worker transport is a test fake | Mount runsc; one real remote transport; config-driven provider registry |
| Hosting | PARTIAL | Production Dockerfile with durable volumes + priv-drop; **no compose/fly/deploy workflow committed** — hosted topology lives in operators' heads | Committed reference topology |
| Credentials | WRONG-SHAPE | Global `pgp_sym_encrypt` passphrase for workspace settings (no per-workspace DEK/AAD); excellent AAD-bound BYOK vault **built with zero consumers and no persistence** (16f.2 open); direct-mode spawns inherit full host env incl. keys (F-33-G7) | Finish vault persistence; wire `withResolvedCredential`; env allowlist scrubbing |
| Residency | MISSING | One line in the codebase (Blaxel `eu-` check) | Region property on storage + placement seams, pre-tenants |
| Backup/export | MISSING | No export route/CLI/UI anywhere; `ConversationDownload` is dead code; deletion exists without export counterpart | Transcript export, workspace archive, GDPR export |
| Continuity/Level-0 | PARTIAL | Accidentally good fail-open reads; one fail-closed edge (model-pinned SSE 400s) | Fix SSE edge; codify as declared continuity surface |
| Tenant isolation | PARTIAL | Thorough app-level (membership, 421 scope pinning, 0o700 jails, isolation-evidence probes); DB = row-scoping with **no RLS** — one missed `where` is a silent cross-tenant leak | RLS backstop + dedicated db role now; per-tenant-db tier decision pre-SaaS |

## 4. Contradiction register — live code vs ratified decisions

These are not gaps; they are places where main **actively contradicts** what the ratified docs record as decided. Highest priority to reconcile:

1. **P0.6 inverted** (F): external, agent-writable plugin `boring.server` modules are hot-loaded into the trusted host process (`runtimeBackendRegistry.ts:228-263`). Ratified: default-deny. Needs an explicit policy split (local-dev trusted / hosted default-deny) or remediation.
2. **F-33-G15 unremediated** (H): ambient pi auth + per-process registry caches mean model execution never consults workspace BYOK; D27/A7 bypassed on every send.
3. **Judged agent can edit its judge** (E/G): eval YAML fixtures are ordinary repo files a worker can modify in the same PR the gates evaluate; trust ladder does not cover them.
4. **Free-text answers act as authorization** (A/C): ask-user is shipping as *the* human-loop surface with no digest binding — every new tool treating an answer as approval deepens the future break.
5. **Env inheritance** (H): direct-mode spawned processes receive the entire host env including all provider keys (`runtimeSupport.ts:12`); scrubbing (R-33-13) is doc-only.

## 5. Consolidated retrofit-cost ranking

Ordered by how fast the cost grows while unaddressed (the STRUCTURAL test), merging all 8 areas:

1. **Work identity above session** (B/C/E) — every new plugin store keys on `sessionId`; outcomes/delivery/billing are unbuildable without it; migration cost grows with every store shipped.
2. **Party/Actor separation** (A) — every durable table keys raw `userId`; re-attribution debt grows monotonically.
3. **Canonical Run join** (B/E) — second metering run-id already exists; each new identity minted deepens the join debt. (Mostly additive: unify on RequestKey.)
4. **Agent subject identity + Seat as durable record** (A) — `agentTypeId`-as-identity is leaking into grants, admissions, session namespaces.
5. **Effect layer on tool calls** (B/D) — touches the pi harness boundary; hardest single retrofit, and the gate for real approvals, idempotent external effects, and taint sinks.
6. **Trusted/untrusted plugin split + P0.6** (F) — structurally disqualifying for hosted multi-tenant; must be re-litigated before any marketplace work.
7. **A7 / BYOK wiring** (H) — vault crypto done; seam change now vs credential-ownership migration after tenants exist. Blocks any billed offering.
8. **Package→Release→Deployment→Instance** (F) — every consumer assumes mutable live dirs; passports/diffs/rollback/publisher identity are unanchorable without it.
9. **Experience contribution tier** (C) — routes/pages/nav for plugins; the "product ≠ chat workbench" promise depends on it; touches every plugin's assumptions.
10. **Taint/origin labels + Vintage descriptors** (D) — trivial per-site, expensive in aggregate; every month of unlabeled plumbing raises the price.
11. **Server-side attention queue + enforced approvals** (C/A) — medium build on reusable parts (ask-user store, typed kinds, digest-precondition pattern).
12. **RLS backstop + residency hooks** (H) — days now, an audit of every store method after tenants exist.

## 6. Quick wins (days, not weeks — each closes a named hole)

- Add eval fixture paths to `.agents/factory/policy.yaml` `trust_ladder.class_b_always` (contradiction #3, one line).
- Startup ledger reconciliation: stale `in-flight` → `outcome-unknown` on boot (unwedges post-crash retries).
- Flip `BORING_CHAT_DURABLE_STREAM` default-on.
- Wire the dead `ConversationDownload` into a transcript-export route (first "portable exit" brick).
- Fix the model-pinned SSE 400 (serve history, fail only the turn).
- Postgres RLS keyed on `workspace_id` + dedicated db role in reference config.
- Beadle as a `boring-automation` scheduled prompt reading `policy.yaml` (factory's first coded supervisor, dogfoods governed automation).
- Default durable metering sink (append-only usage facts per workspace) — unlocks cost-per-run views from data already captured.

## 7. What this means for sequencing (input to 50-epics)

The delta says the platform's next layer is **not** more mechanisms — it is four unifying identities dropped onto seams that already exist and are waiting for them:

- **Work** (above session) → unlocks outcomes, delivery, billing units, tasks-as-Work, factory-on-platform.
- **Run join** (RequestKey as the one execution identity) → unlocks the evidence dataset, per-run operator views, A/B eval.
- **Actor-for-Party** (+ durable Seat) → unlocks entitlements, publisher/subscriber, cross-party mandates.
- **Effect** (typed declarations on tools) → unlocks enforced approvals, safe external actions, taint sinks.

Plus two standing security reconciliations (P0.6 split, A7/BYOK) that gate any hosted/billed offering regardless of vertical, and one product-shape investment (Experience contribution tier) that gates "feels like real software, not a chat console."

*Epic decomposition lives in `50-epics/`; ordering lives only in `INDEX.md`.*
