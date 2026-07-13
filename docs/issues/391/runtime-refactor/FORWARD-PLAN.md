# FORWARD-PLAN — #391 runtime refactor (planning-workflow phase A)

**Purpose.** One self-contained forward plan for the remaining #391 work. A
reviewer must be able to reason from this file alone: it folds the entire plan
pack plus `docs/DECISIONS.md` #21–24 into a single ordered body, kills
repetition by precedence, and collapses everything already shipped into a
one-line-per-item context table.

**Precedence used to resolve duplication** (highest wins; a fact is stated once,
in the highest-precedence voice): `DECISIONS.md` → `D1-R0-SPEC` /
`AR1-001-SPEC` → `INDEX.md` → `PR-PLAN.md` → `work/*/PLAN.md` →
`TODO.md`/`HANDOFF.md`. Where two sources disagreed, the resolution is marked
inline as `[resolved per <file>]` so a reviewer can audit it.

**Terminology is normalized to one glossary** (§7): *binding, revision,
engagement, bead, lane, principal, actor, projection*. Legacy synonyms from the
pack (`generation` → **revision**; `site binding` / `tenant` → **binding**;
`caller`/`subject` → **principal**; `share entry` / `deep link` are **lane**
artifacts) are rewritten to those terms except inside quoted stable error codes
and file names, which are preserved verbatim.

**Freshness.** D1 is moving daily. This file's landed set was ancestry-verified
against `origin/main` on **2026-07-13**; `origin/main` HEAD was
`26bd895a9` (#705, D1-004c2). Verified freshest D1 landed FEAT bead:
**D1-004c2** — INDEX.md still reads "D1-004c1 ACTIVE", which is now stale
`[resolved per gh ancestry 2026-07-13: D1-004c1 (#704) and D1-004c2 (#705) are
both landed; #706 is docs-only]`.

---

## 1. Mission and product priorities

### 1.1 North star (owner, VISION.md)

> **eve-style DECLARATIVE authoring that ships agents fast, natively integrated
> into the boring-ui FARM, open to foreign agents.**

Land an eve-class UX — author an agent, deploy it, converse with it from any
channel, inspect it — but **steered from the boring-ui workspace** and **hosted
in Europe**. Six pillars:

1. **Declarative authoring:** `agents/<name>/` compiles to a self-contained
   content-addressed bundle (versioned `AgentDefinition` + immutable assets).
   Local dev and D1 consume the same bundle/digest through an authorized
   workspace host. No platform-source edits, no imperative per-agent wiring.
2. **The boring-ui FARM:** the workspace is the farm control plane — fleet view,
   tasks, artifacts, approvals. This epic ships the *substrate*; the farm UI is
   the **next epic** and does not gate this epic's exit.
3. **Open integration:** a foreign agent (Claude Code, Codex, any MCP client)
   attaches an environment via E2 MCP projection.
4. **Flue internals:** durable indexed event streams, channel ingress packages,
   `SessionEnv`-shaped environments.
5. **Plugin-extensible host:** workspace UI and the agents inside it extend over
   real APIs. Honest caveat: `full-app` ships `externalPlugins:false`.
6. **EU-sovereign hosting** (00 invariant 15).

### 1.2 Owner priorities (the owner's 4)

Set 2026-07-11; INDEX.md "Owner priorities" is the authoritative statement.

1. **Multi-agent prod hosting** — run MANY distinct agents in ONE prod
   deployment, each mapped to a workspace. (P1 + A1 + P6-R + D1.)
2. **External agent consumption via MCP + shareable artifacts** — a consumer
   agent receives an artifact link, opens it, lands in its workspace.
   (M1 → AR1 → M2/E2.)
3. **Multi-channel consumption of the same agent.** (arch-08 surfaces + T1
   completion + T2.) Stays behind priorities 1–2.
4. **Sandbox proper** — provider extraction + S3/FUSE mounts. (P2 + X1; LAST;
   the existing in-monolith sandbox keeps working meanwhile.)

**Derived build order:** #631 + P1 recut (landed #642) → P6-R (landed #647) →
D1 (+conditional P5a) → M1 recuts (landed #650) → AR1 → M2/E2 → T1/T2 → P2/X1.

### 1.3 The B2B-now ruling (MARKETPLACE-PATH.md, owner)

Verbatim-ish, and load-bearing for what is *staffed* vs merely *sequenced*:

- **"Revenue path now: B2B"** — managed agents + custom workspaces for clients.
  Phases 1–3 serve this directly; **phase 3 doubles as the client demo.**
- **"Marketplace is LATER and demand-gated"** — phases 4–5 stay sequenced but
  **unstaffed until factory revenue or a flagship creator forces them.**
- **"Build discipline: get the FUNDAMENTALS marketplace-ready in phases 1–3"**
  so adding the marketplace later is only adding discoverability (MK1).

**Consequence:** BL1 pricing/merchant-of-record, MK1 catalog shape, and CH1
channel order are deferred **DECISIONS, not deferred fundamentals**. They need
no further owner input until their phase opens. Starting any of them now without
a named consumer recorded in INDEX.md is itself an over-engineering failure
(Guardrails).

### 1.4 Phase exit metrics

**Phase 2 — factory v1 (the binding v1 product proof, VISION + D1-R0 §9).**
Not "component tests pass" — the golden path:

- A developer scaffolds one `agents/<name>/`, validates it, selects/creates an
  authorized local workspace + approved runtime, runs a local turn, and deploys
  it with **≥ 2 distinct agents** (D1-R0 §9 proves 3) into **one EU Docker
  host** in **≤ 15 minutes** with **zero platform-source edits**. The
  15-minute figure is a **measured target, not a gate** `[resolved per D1-R0
  §9.10 and HANDOFF: earlier drafts read it as a gate]`.
- Each exact hostname (e.g. `insurance-comparison.senecapp.ai`) serves bounded
  landing → CTA → existing-member sign-in → authorized workspace → deployed
  definition as agent `default`. Hostname selection never grants membership.
- Proof records: ≥2 (D1-R0: 3) agents on distinct workspace/default bindings;
  definition/deployment + workspace-composition digests; crash/concurrency-safe
  reapply with no duplicate resource; remote materialization without the
  authoring checkout; complete redacted host snapshot/digest; rollback restoring
  the entire prior snapshot and reproducing all resolved digests without a P6
  revision store or a secret value; sibling filesystem/process denial; secret
  canary.

**Phase 3 — external consumption (marketplace MVP).** An authenticated external
consumer receives an artifact in an authorized workspace (M1 bearer + AR1 Lane
W + M2/E2). Public promotion later adds ID1 + AC1 contracted mode so a new user
signs up via their own ChatGPT, contracts an agent, and runs the fitness story
end-to-end — MCP-only, unbilled.

**Phases 4–5 — demand-gated** (creators earn; coach-in-your-pocket). Exit prose
only; bead-level acceptance is written when the phase opens.

---

## 2. Locked decisions digest (#21–24 + guardrail global doctrine)

Compressed but complete enough to reason from. Full text lives in
`docs/DECISIONS.md`; this is the operative core.

### Decision 21 — Workspace-first agent factory v1 supersedes public pure mode

**Status: Accepted 2026-07-11 (landed #617, ancestry-verified).**

- Every local or deployed agent run resolves to **an authorized workspace + an
  approved runtime/environment.** The dedicated journey is: exact hostname →
  landing → member auth → bound workspace → deployed agent selected as that
  workspace's `default`.
- `headless` means only "no UI/presentation surface." API, MCP, CLI, and future
  channels still address a **workspace-backed** agent. **There is no
  public/product no-environment mode and no v1 `runtime: 'none'` contract.**
- Preserves the environment/Fastify-independent `@hachej/boring-agent/core`
  boundary, injected harness/tools/sessions, workspace/session-root separation,
  package layering, and optional surfaces — composed from a workspace host.
- Local authoring still starts from `agents/<name>/`, but `agent dev` creates or
  selects an explicit local workspace + approved runtime (`bwrap` when
  available; trusted `direct` only by explicit policy).
- **Supersedes** decision 19's pure-mode and 19a's wider v1 gate graph where they
  conflict; 19a's R0 tracer is explicitly non-blocking. T1/T2 durability, full
  P3 extraction, generic E1, and true no-environment execution move **post-v1**.
- **Re-evaluate when** a named consumer cannot use a workspace-backed agent and
  brings an explicit contract. Reintroduction = composition by explicit
  capabilities, never a mode-label fork; requires a new superseding decision.

### Decision 22 — One agent-consumption contract; protocol bindings at the edges

**Status: Accepted 2026-07-11 (landed #632); implementation pending (AC1 /
issue #636 — types landed #657; dispatcher/modes/projection not built).**

- An agent exposes **ONE consumption contract** in the contracts layer: task
  lifecycle — the **seven-state subset** of A2A v1.0 (`submitted`, `working`,
  `completed`, `failed`, `canceled`, `rejected`, plus the interrupted
  `input-required`) — `contextId` grouping tasks into conversations, messages
  with typed parts, and artifacts. A2A's eighth state `auth-required` is
  **intentionally out of scope internally** (no trust boundary inside one
  deployment); a future A2A edge binding must map it explicitly.
- **Bindings of that one contract:** UI (human chat); **MCP** (the external
  entry gate — a door, not a distribution vector); an HTTP API (REST projection
  of the same task model); a CLI (drives the HTTP API); a **native in-process
  binding** for agent-to-agent (no MCP loopback, no serialization; two-way via
  `input-required`); and **A2A as a FUTURE external binding only**. Adopting A2A
  internally is rejected.
- **Two internal consumption modes**, declared per agent in `AgentDefinition`:
  **(a) SUBAGENT** — runs inside the caller's workspace, full shared context;
  **(b) CONTRACTED/SERVICE** — runs in its OWN workspace (SaaS-like; may invoice
  — economic layer deferred with the workspace-budget concern).
- **Context flow to a contracted agent = GOVERNED PROJECTION IN THE TASK.** The
  caller declares paths; a path-filtered **readonly** snapshot of their
  workspace attaches to the task; the contractor works on it in its own
  workspace; more context is requested via `input-required`. Implementation
  seam: generalize boring-governance's existing `filesystemBindings` readonly
  projection (today hardcoded to `company_context`) to arbitrary source
  workspaces.
- **Explicitly rejected: live cross-workspace access grants.** Workspace
  membership remains the ONLY live access boundary. For long collaborations, an
  **ENGAGEMENT workspace** (plain shared membership) is the future pattern.
- **Layering constraint (load-bearing):** contracted mode MUST be a **layering
  over the same consumption pipeline as subagent mode — never a forked code
  path.** A contractor = subagent + (1) workspace-binding parameter on the
  resolver + (2) governance projection brief + (3) metering decoration
  (`createMeteringSink`). MCP is orthogonal: how a principal reaches their OWN
  workspace from outside. From outside, boring presents as a **contracting
  platform**: submit a job, receive artifacts; other workspaces/sandboxes stay
  invisible. Contractor workspaces persist across engagements.
- **Recorded for implementation (not decisions):** `input-required`
  timeout/escalation; consumption cycle/depth guards; audit model (principal =
  originating user/workspace; acting agent recorded as **actor** in provenance);
  contract schema versioning once external bindings exist.
- **Known-unknown (trigger: third parties contracting):** contractor data
  hygiene across customers — a persistent contractor workspace mixes learnings
  from customer A into work for B; policy needed when external contracting opens.

### Decision 23 — Multi-agent Docker host is the first deployment topology

**Status: Accepted 2026-07-12 (amendment landed with reconciled pack #649; P6-R
merged #647).**

- The first production topology is **one EU Docker image/compose deployment
  hosting N distinct compiled agent bundles** mapped through authorized
  workspaces. Each configured exact hostname selects bounded landing/site state,
  then normal auth + membership resolve one workspace; that workspace's deployed
  agent is `default`. **Hostname selection grants no workspace authority.**
- A **dedicated tenant VM** runs the same artifact as **deployment variant 2**,
  not a code fork or a prerequisite.
- P6-R and D1 use the existing approved workspace/runtime composition; **P2
  provider extraction and X1 mounts are later and do not gate them.**
- **Supersedes** 19a's dedicated-only v1 topology and any P2 → P5a → P6-R/D1
  dependency where they conflict; does **not** weaken workspace authorization or
  create D2's wildcard tenant control plane.

### Decision 24 — Identity server: Ory Hydra + boring-owned adapter layer

**Status: Accepted 2026-07-12 (merged #670).**

- **Hydra v2.x** selected for ID1 (OAuth 2.1 + PKCE proven live in spike;
  ~42 MB image, ~21 MiB idle RSS). Decisive factors: footprint (Ory's 5–15 MB Go
  binary vs 750 MB+ JVM) and the live PKCE spike.
- **Boring owns** the RFC 9728 protected-resource-metadata endpoint,
  resource-vs-audience validation (reject cross-resource token reuse), and CIMD
  handling **regardless of server** — these are boring beads, not server config.
- **Re-evaluate when** Keycloak's RFC 8707 support is stable **and** CIMD becomes
  required.

### Guardrail global doctrine (IMPLEMENTATION-GUARDRAILS.md — applies to every WP)

1. **Reuse-first checklist.** Before a new mechanism, check the seams:
   governance `createMeteringSink` (metering/budgets), governance
   `filesystemBindings` (readonly projections), T1 `eventStreamStore` (durable
   events), the workspace membership model (all authorization), pi session
   machinery (conversation state). If a seam does 80%, **extend it**.
2. **Boring by default.** One process, one compose file, YAML/JSON config,
   env/file secrets. No queues, brokers, reconciler loops, caches, or
   microservices until a measured problem demands one, recorded in DECISIONS.md
   first.
3. **No new package until a second consumer exists.**
4. **Every error carries a stable code; every route receives a Workspace, never
   a raw path** (CI greps enforce).
5. **Vertical slices, small PRs** (≤ ~400 net lines). A slice that boots beats a
   framework that might.
6. **The universal stop sign:** if you are writing a scheduler, retry framework,
   plugin system, config DSL, an abstraction with one implementation, or a
   cross-cutting "manager" class — stop and ship the dumb version.

**Global non-negotiables (INDEX.md, every bead):**

- `@hachej/boring-agent` keeps **zero value imports** from `@hachej/boring-bash`
  or `@hachej/boring-sandbox`. Acyclic: `boring-sandbox → agent(types)`;
  `boring-bash → boring-sandbox(values) + agent(types)`.
- Surfaces never own the loop; surface packages import only the public agent
  contract (+ their channel ingress package).
- **Two handles:** `sessionId` is runtime-owned; platform addressing is
  surface-owned; public agent APIs never accept platform addressing.
- **One approval channel:** HITL declared on the tool, travels as stream events.
- `filesystem + path + operation + actor` is the resource identity; path alone
  never selects a filesystem.
- Existing workspace behavior and `company_context` no-leak conformance stay
  green in every phase.
- **EU-sovereign defaults:** no bead introduces a US-hosted service as a default
  or hard dependency; US-hosted providers are optional, behind the capability
  matrix.

**Review rule (thermo, before coding each file).** A clean review = no package
import cycle; no duplicated provisioning/readiness system; no filesystem/bash
split brain; no workspace/runtime authorization bypass; no public
`runtime: 'none'` or mode-label fork; no child-app or multi-agent scope leak; no
claim that unrelated backlog issues are solved by this abstraction.

---

## 3. Context: landed

Everything below is shipped and ancestry-verified — **context, never body.**
Status cites `git merge-base --is-ancestor <sha> origin/main`, not GitHub
MERGED labels (the stacked-PR trap). One line each.

| Area | PR(s) | What landed (one line) |
| --- | --- | --- |
| **P0 D21** | #617 | Workspace-first agent factory v1 accepted; supersedes public pure mode. |
| **P0 D22/23** | #632, #649 | One consumption contract accepted; multi-agent Docker-first topology reconciled. |
| **P0 D24** | #670 | Ory Hydra + boring-owned RFC 9728/8707/CIMD adapter accepted. |
| **P1** | #523, #529, #530, #543, #626, #631, #642 | Config-surface inventory → `createAgent()` façade → thin adapters → pure-runtime completion → façade into core → request-binding lifecycle → **fail-closed binding-local readiness recut (#642, the v1 P1 exit)**. |
| **P6-D** | #618, #623 | Minimal `AgentDefinition` + `AgentDeployment` schemas/identities/digests (relanded, verified). |
| **A1 compile** | #624 | Deterministic `agents/<name>/` → content-addressed bundle compiler. (A1 local-dev run is a post-D1 recut gating P8, not D1.) |
| **P6-R** | #647 | Stateless deployment resolver: one pure call resolves one authorized deployment + workspace-composition + `default` binding; no host-wide map. |
| **M1** | #538, #650 | Managed MCP delegate server → recut delivery v0 + composition + stock-client smoke (#650 supersedes #549/#556). |
| **P8 slice** | #664 | Golden-path timing script + `golden-path.json` + CI invariant/`runtime:'none'`-residue gates (pull-forward). |
| **AC1-T** | #657 | Consumption-contract types + lifecycle validators (types-only slice). |
| **AR1-001 spec** | #656, #668 | Shareable-artifact transfer + same-workspace share contract drafted, amended, owner-ratified. Lane W dispatchable; Lane X build-gated. |
| **T1 foundation** | #531, #535, #537 | Transactional `EventStreamStore` (pr1) + envelope append at the harness tap (pr2) + re-land. **Historical foundation only**; full durable contract = "T1 completion", post-v1 `[resolved per INDEX/Decision 21: T1 durability is post-v1]`. |
| **P2 structural** | #557, #628 | Publish-parity + structural-only `runsc` preflight contract (`productionReady:false`). |
| **Pack/docs** | #521–#534, #565, #593, #640, #644, #646, #648, #655, #666, #668, #670(docs), #673, #681–#683, #686–#687, #691, #693, #703, #706 | v2 pack, incremental-v1 reset, guardrails, GTM, evidence, fresh-eyes audits, D1 doc splits/limiter-ordering. |
| **D1-R0** | #649 | Atomic multi-agent host **revision** spec accepted (sole v1 topology mechanism). |
| **D1-001** | #652 | Host plan + canonical redacted workspace-composition identity/digest; independent P6-R inputs. |
| **D1-002** | #653, #654, #660, #662, #665, #671 | Revision codec → immutable revision store → persistence → command engine → locked revision command boundary/CLI (`d1Command*.ts`) → canonical `resolvedDigest` plumbing. |
| **D1-003** | #667, #672, #675–#680 | Stable-process Compose topology, file-secret input, deterministic binding env/perms, secure tmpfs materialization, file runtime-input provider, prod wiring, real-Docker UID/DAC proof. |
| **D1-004a1** | #684 | Explicit trusted-proxy policy, secure generic default, deterministic edge network, pre-effect overlap guard. |
| **D1-004a2** | #685 | Mounted exact-DAC active-collection reader. |
| **D1-004a3a/b** | #690, #692 | Canonical Caddy ingress artifact + real-Docker header proof → exact raw-header authority + trusted-hop scope. |
| **D1-004a4a/b** | #694, #695 | Bounded landing/root seam → loopback readiness + owner/process identity checks + production activation. |
| **D1-004b1** | #698, #699 | Workspace + signup/default-provisioning authority fences; owner-authority transaction made atomic. |
| **D1-004b2a/b2b** | #700, #701 | Atomic managed-member mutations → atomic managed-owner account-deletion guard. |
| **D1-004c1** | #704 | Public invite scope fence (foreign invite → non-enumerating `invite_not_found`). |
| **D1-004c2** | #705 | Embedded/browser workspace-selector convergence (foreign/malformed → stable 421). **← origin/main HEAD 2026-07-13.** |
| **D1-004c3 (docs)** | #703, #706 | Boring MCP limiter ordering + read-rate-limit binding documented. **FEAT not yet landed** — see §4 D1-004c3. |

**Freshest D1 landed FEAT bead: D1-004c2 (#705).** Remaining D1 body →§4.

---

## 4. Forward work

Each item: **goal · why/workflow · design constraints (build / do-NOT /
stop-signs) · dependencies · acceptance (machine-checkable) · open questions
(OWNER vs ENGINEER).** Constraints are drawn from Guardrails + the governing
spec; acceptance is drawn from the spec's proof matrix.

---

### 4.1 D1 remaining — the priority-1 / v1 gate

D1's sole v1 mechanism is **D1-R0-SPEC** (atomic multi-agent host **revisions**;
one ingress + one stable full-collection core process; agents are **not**
per-container; additive/landing-only online revisions preserve in-flight work).
The remaining ordered stack after the landed set is:
**D1-004c3 → c4 → c5 → D1-004d → D1-004e → D1-005a → D1-005b → D1-005c →
D1-006.** Each PR stays dark/additive until its own acceptance; no PR claims the
three-agent exit early. **P2/P5a do not gate any bead.**

Global D1 constraints (Guardrails "D1" + D1-R0 §10 stop-signs), apply to every
bead below:

- **Build:** one compose file (core + N resolved bundles + identity server
  later); hostname→landing map in plain config (hostname grants nothing);
  per-binding env/secret files; a short ops runbook.
- **Do NOT build:** Kubernetes, Terraform, autoscaling, multi-region, a secrets
  service, an admin UI, tenant lifecycle automation (**that is D2, post-v1**),
  a per-agent container, a provisioning/registry daemon, watcher, queue,
  scheduler, retry framework, wildcard host/tenant API, cross-host fleet control,
  or a P6 revision store.
- **Stop signs:** helm charts; a "provisioner" process; templating beyond
  envsubst-level; "registry" in a type name.
- No secret value / raw host path in git, JSON snapshots, Compose rendering,
  logs, errors, or audit. Workspace + session roots are durable siblings
  (`/data/workspaces`, `/data/pi-sessions`), never container home/root.

#### D1-004c3 — Boring MCP scope admission

- **Goal.** Fence the Boring MCP surface (four POST actions `connect`/`refresh`/
  `disconnect`/`tools` + `GET /sources`) to the trusted host **binding**'s
  workspace, without adding a manual limiter or a second budget store.
- **Why / workflow.** On a dedicated host, an external MCP caller must never
  reach a workspace other than the one bound to that hostname; malformed/foreign
  selectors must be rejected and rate-charged before they can probe.
- **Build.** Preserve existing global-auth ordering + the unauthenticated 401 +
  exact generic behavior when trusted scope is absent. The four POST routes keep
  their `@fastify/rate-limit` limiters; give `GET /sources` the same mechanism
  with unscoped requests allowlisted/skipped. Under trusted scope, all five
  limiters run **after** global auth and **before** selector admission, share one
  key helper keyed on `request.user.id` + frozen `requestScope.workspaceId`
  (never a raw caller selector), and charge every authenticated
  valid/malformed/conflicting/foreign/nonmember request. Scope admission is the
  first `preHandler` after the limiter, using the shared admission helper on all
  five routes: absent selector derives scope; malformed/conflicting/foreign →
  stable **421** after budget consumption but before workspace/member/store/
  provider/transport effects.
- **Do NOT / stop-signs.** No independent/manual D1 limiter; no second budget
  store; raw selectors never key or bypass a budget.
- **Dependencies.** D1-004a3b (trusted host scope), D1-004b1/b2 (workspace
  authority). The docs half (#703/#706) already landed.
- **Acceptance.** All invalid authenticated D1 traffic is bounded;
  unauthenticated D1 traffic keeps the existing 401; unscoped `GET` is skipped by
  the limiter; generic malformed/unauthenticated/unauthorized behavior stays
  exact.
- **Open questions.** None material; docs already ratified the ordering.

#### D1-004c4 — WorkspaceBridge runtime-claim admission

- **Goal.** Assert host scope on a verified WorkspaceBridge runtime token
  **between** its read-only signature/claims check and its
  registry-definition/capability authorization.
- **Why / workflow.** A signed Bridge runtime/refresh token must not act on a
  foreign workspace even when its signature is valid; a D1 mismatch must surface
  as a transport-level rejection, not a swallowed RPC error.
- **Build.** Split runtime-token verification into (a) read-only signature/claims
  and (b) registry-definition/capability authorization. Assert host scope on the
  verified claims **between** the phases, before `getRuntime`,
  registry/idempotency/refresh-store selection, `recordUse`, handler execution,
  or mint; apply the same claim-first assertion to refresh. Let branded D1 scope
  errors escape the Bridge protocol catch so core returns HTTP
  **421/`D1_HOST_SCOPE_VIOLATION`** — **do not** add a Bridge error code or
  translate to 403. Foreign refresh consumes no refresh-use/rate bucket.
- **Do NOT / stop-signs.** No caller agent/deployment selector; no generic
  selector framework; browser/header flow stays D1-004c2-owned; generic
  standalone behavior stays exact.
- **Dependencies.** D1-004c2 (owns browser/header Bridge traffic).
- **Acceptance.** Foreign signed-runtime/refresh claims reject at the choke point
  before runtime load/mint; D1 mismatch escapes as HTTP 421 not RPC error;
  generic standalone Bridge behavior unchanged.

#### D1-004c5 — Managed-agent MCP configured-target admission

- **Goal.** Require, after bearer auth but before any effect, that the trusted
  request scope equals the configured workspace on the managed-agent MCP route.
- **Why / workflow.** The M1/M2 managed-agent MCP endpoint on a dedicated host
  must dispatch only to the configured workspace/agent/deployment; payload or
  header cannot retarget.
- **Build.** After bearer auth, before request storage/controller/app-store/
  dispatcher/stream effects, require trusted request scope == configured
  workspace or return stable **421**. The dispatcher receives the trusted scope
  including `defaultDeploymentId`; payload/header cannot retarget workspace,
  agent, or deployment. Preserve generic absent-scope deployment exactly.
- **Do NOT / stop-signs.** No caller-controlled `agentId`/`deploymentId` parser
  exists — do not invent one.
- **Dependencies.** D1-004c3 pattern; M1 managed-agent route.
- **Acceptance.** Payload/header retarget attempts → 421 before dispatch; generic
  absent-scope deployment unchanged.

#### D1-004d — Durable admission ledger

- **Goal.** A durable, insert/read-only `(hostId, bindingId)` admission ledger
  committed **before** the first agent effect, so a **binding** that has ever run
  cannot later be silently removed.
- **Why / workflow.** Additive N+1 revision publication and unused-binding
  rollback both need a crash-safe truth of which bindings have admitted real
  work; a used binding must reject removal even after process restart + revision
  cleanup.
- **Build.** One new core Drizzle migration + schema export;
  `admissionLedger.ts`; a first-effect hook through the D1 host scope. Rows carry
  a DB-allocated monotonic sequence; the transaction commits before the first
  effect; concurrent admission is idempotent; restart recovery + CLI
  destructive-diff read from the DB; **no update/delete API.** Export one
  session-level Postgres advisory fence keyed by `(hostId, bindingId)` on a
  dedicated connection: first use holds it while re-reading the active
  collection, inserting/idempotently reading admission in a transaction, and
  committing before the effect, then releases in `finally`; connection loss
  releases the lock. A failed lock/commit → **`D1_ADMISSION_RECORD_FAILED`** and
  no agent effect.
- **Do NOT / stop-signs.** No update/delete; no route pre-read/process mutex/SQL
  as authority.
- **Dependencies.** External Postgres (D1-003); D1-005c installs the first-effect
  hook consumer.
- **Acceptance.** Admitted binding stays non-removable after process restart +
  revision-directory cleanup; concurrent admission idempotent; failure path
  admits no effect.

#### D1-004e — Recoverable unused-binding rollback fence

- **Goal.** An append-only rollback journal that makes online removal of an
  **unused** newly-published binding crash-recoverable and race-safe against
  first-use admission.
- **Why / workflow.** Online rollback may remove only an added binding that has
  no admission row; once its first effect admits it, removal must reject. A crash
  between prepare, pointer publish, and finalize must never leave an unjournaled
  removal.
- **Build.** One append-only rollback-journal migration + schema export; the
  stable error enum in `d1Plan.ts`; `admissionRollbackJournal.ts`; root-command
  integration; real-Postgres + pointer-recovery tests. Rollback derives the exact
  **sorted** removal set, acquires every D1-004d session advisory lock in that
  order on one dedicated connection; while all held, re-reads active state + all
  admission rows and appends a durable `prepared` event (operation id,
  expected/target revision+digest, removal set); after commit, publishes one
  atomic pointer, appends `committed`, releases. No row is updated/deleted.
  Recovery reacquires the same sorted lock set and finalizes/resumes/aborts per
  pointer+journal state; any inconsistent state → **`D1_ROLLBACK_JOURNAL_FAILED`**
  closed.
- **Do NOT / stop-signs.** No deletion/update of journal rows; no background GC
  reconciler.
- **Dependencies.** D1-004d.
- **Acceptance.** Real-Postgres races on first/last removal keys and overlapping
  sets with no deadlock; crash at every phase boundary recoverable; if rollback
  wins, first use on a removed key creates no row/effect; if any admission wins,
  the whole rollback rejects.

#### D1-005a — Approved host release and intended policy

- **Goal.** Mint one non-serializable root-owned `ApprovedD1HostRelease`
  capability that pins the exact host artifacts, commands, and a strict
  production-env schema — the reviewed static closure of the entire
  workspace-selector-bearing route set (all of c1–c5).
- **Why / workflow.** Before any Compose mutation, the operator must prove the
  intended host image/command/env is exactly what was reviewed, so an operator
  cannot smuggle a different command (e.g. one that flips `externalPlugins`) or
  a secret-bearing env key past review.
- **Build.** `approvedHostRelease.ts` + `hostSecurityConfig.ts`; reuse landed
  core/ingress identity constants. The release record lives at
  `<host-state>/approved-host-release.json` **outside** immutable revision
  directories, installed only by the maintenance release procedure — the app
  cannot write it and the apply command exposes no mutation for it. It binds
  `{ hostAppImageDigest, coreCommand, migrationProcess, ingressImageDigest,
  ingressCommand, caddyfileDigest, hostSecurityConfigDigest,
  selectorInventoryRevision, executionPolicyRevision }` (both revisions =
  immutable merged commit/content identities, not mutable labels). Before any
  Compose mutation: validate desired digest == approved digest and intended
  image/Entrypoint/Cmd == approved. Parse Compose + `core.env` through one
  strict versioned production-env schema without logging values: allowed keys =
  approved image defaults + fixed Compose keys + schema-declared app keys; each
  classified as fixed-exact or redacted-nonsecret; **unknown or secret-bearing
  env keys reject.** Require `NODE_ENV=production`; reject `NODE_OPTIONS`,
  `NODE_PATH`, `LD_PRELOAD`, `LD_AUDIT`, `LD_LIBRARY_PATH` regardless of class.
  The nonsecret identity pins at least `{ d1HostId, publicationOwnerUid,
  agentMode, workspaceRoot:"/data/workspaces", sessionRoot:"/data/pi-sessions",
  trustedProxy:{cidrs:["192.168.255.250/32"],hops:1}, externalPlugins:false,
  pluginAuthoring:false, betterAuthUrl, corsOrigins, cspEnabled, ...,
  managedAgentMcp:{enabled,workspaceId?,userId?} }`.
- **Do NOT / stop-signs.** No container create/start, P6-R, admission, preload,
  pointer, or ingress op in this bead; the release record is never caller-
  supplied, persisted-by-app, mounted, or reconstructed from app self-report.
- **Dependencies.** D1-004c1–c5 (the static selector inventory it freezes),
  D1-003a ingress constants.
- **Acceptance.** Unknown/secret-bearing keys and drift in owner UID, mode,
  roots, proxy, auth URL, CORS, CSP, cookie security, MCP enablement, or managed
  target all reject; a materialized secret canary proves no secret bytes enter
  Docker config/identity/failure output.

#### D1-005b — Observed host execution attestation

- **Goal.** Attest that the **running** core + ingress containers match the
  approved release before any binding activates — image, command, read-only
  root, mounts, env, and a leak-free migration container.
- **Why / workflow.** Image identity alone is insufficient because `main.ts` pins
  `externalPlugins:false`; an operator override of the command would change
  behavior. The host must inspect the actual containers, not trust plan echo or
  app self-report.
- **Build.** `verifyRunningHostArtifact.ts` + `migrationRunner.ts`; the
  unexposed-first-core / stopped-ingress orchestration seam; reuse landed D1-003a
  ingress validators; fixed read-only-root/mount policies in `compose.yml`.
  Consume D1-005a's live `ApprovedD1HostRelease`. First boot: core + ingress
  absent/stopped. Replace the uninspected `compose run` migration with a stopped
  one-shot container from the approved core image, exact Cmd
  `node apps/full-app/dist/server/migrate.js`, `User=10001:10001`, strict
  approved nonsecret env, file-mounted same-attempt DB secret readable only by
  that identity, read-only root, DB access only, **no workspace/session/state
  mounts, no added capabilities, no privileged mode**; inspect before start;
  reject the inherited web-entrypoint and root user; run to zero exit. Bind the
  stopped core id, start only that exact id, wait for health; the core joins
  `d1-edge` but ingress stays stopped and the request-scope guard rejects direct
  non-Caddy traffic (no public port). For ingress: require approved
  `D1_CADDY_IMAGE` + exact command + landed `D1_CADDYFILE_DIGEST`;
  `docker compose create --no-deps ingress` (create, not start); inspect stopped
  (`ReadonlyRootfs:true`, exact `80:8080`, one read-only Caddyfile mount, no
  extra mount/env/command). Mint the non-serializable `VerifiedD1HostExecution`
  only after both checks. Drift → **`D1_ACTIVE_BINDING_RESTART_REQUIRED`** before
  candidate/effects; a running host validates observed state before D1-005c
  candidate effects rather than recreating the stable core.
- **Do NOT / stop-signs.** No P6-R call, admission, preload, active-pointer
  mutation, or ingress start in this bead; no second ingress abstraction; no hot
  plugin reload/snapshot contract.
- **Dependencies.** D1-005a; D1-003a ingress artifact.
- **Acceptance.** Migration container has DB-only access, no state mounts, no
  privileged mode, non-root uid, zero exit; secret canary absent from full Docker
  inspect/config; drift stops/quarantines the unexposed core with ingress still
  stopped.

#### D1-005c — Collection preload and atomic publication

- **Goal.** Boot the full collection: N independent P6-R calls, non-effectful
  preload to all-ready, atomic additive pointer publication in the stable
  process, ingress-last first boot, and lazy first-effect admission — with
  unused-add rollback under the D1-004d/e fences.
- **Why / workflow.** This is where the multi-agent host actually comes alive and
  where N+1 continuity is proven: adding a binding must not interrupt in-flight
  sessions of the others.
- **Build.** `bootCollection.ts` + `preloadSignal.ts`; integrate D1-001/002/003/
  004 seams through the root command wrapper + `main.ts`. Require D1-005b's live
  `VerifiedD1HostExecution`; read one immutable **revision**; perform N
  independent P6-R calls; require each candidate composition digest == that
  binding's resolved/preloaded composition (sibling digests may differ). Install
  the D1-004d lazy admission hook; preload all logical bindings through the
  root-owned pending pointer/signal; wait all-ready; atomically publish the
  additive/landing-only pointer in the stable process (preload is not an agent
  effect — creates no admission row). Only after publication may first boot
  revalidate + start the exact stopped ingress id from the D1-005b capability
  (Caddyfile digest must still match) — that start is initial public
  publication. First actual agent effect: the hook takes D1-004d's fence,
  revalidates the binding is still active, commits the idempotent row before the
  effect. Unused-binding rollback uses D1-004e. Invalid pending payload/path/
  digest or one failed binding leaves the old collection active, creates no
  admission row, and on first boot leaves ingress stopped + quarantines the core.
- **Do NOT / stop-signs.** Active binding replacement/removal and secret/runtime/
  root rotation reject before effects; app HTTP credentials cannot trigger
  candidate activation (only the root-owned pending-pointer/signal handler can).
- **Dependencies.** D1-005b, D1-004d, D1-004e, P6-R.
- **Acceptance.** A running request + reconnect survive N+1 publication in the
  same stable process with no core recreate; unused published addition rolls
  back cleanly; a used addition rejects removal; other rotation rejects before
  effects.

#### D1-006 — EU-host proof and runbook (incl. the open runsc privileged-model decision)

- **Goal.** Prove the whole thing on a real EU host and write the ops runbook —
  three agents/workspaces/hostnames, timing, idempotence, N+1 continuity,
  rollback reproduction, isolation, and secret canary.
- **Why / workflow.** This is the phase-2 product exit; component tests do not
  complete v1 (VISION + OWNER product review card).
- **Build.** `work/D1-tenant-provisioning/RUNBOOK.md`; a narrow proof script
  under `scripts/`; reuse P8's `golden-path.json` (do not duplicate its version
  contract). Reproduce the landed pre-apply edge-network overlap guard on the EU
  host (incl. idempotent reuse of the exact owned D1 project network); three
  distinct agents/workspaces/hostnames in one EU deployment; three independent
  P6-R digests; setup-to-first-success timing + per-stage breakdown; idempotent
  additive apply; N+1 continuity; exact rollback as a **new revision**;
  cross-host/workspace + sibling filesystem/process denial; secret canary;
  dedicated-VM configuration render (variant 2 — config render only, no second
  live host required).
- **THE OPEN runsc / privileged-model decision (D1-R0 §9.9, `[resolved per
  D1-R0 as OPEN]`).** D1-001…005c do **not** wait for a provider lock. But
  **D1-006 cannot claim the EU production exit** until one host-approved EU
  profile supplies real lifecycle/security evidence proving sibling filesystem +
  process denial (a plan cannot self-assert it; trusted-`direct` is valid only
  for local dev or a single-workspace dedicated composition, never the shared
  N-workspace host). The real non-mocked `preflightRunsc` passed **all seven
  structural probes** on the EU host (#628, #648). **Still blocking the runsc
  production lock:** the **privileged execution model decision** (does the runsc/
  systrap provider run privileged, and is that acceptable on the target EU host?)
  plus the remaining runtime lifecycle/security proofs — **unless another
  approved EU profile satisfies the same proof.** This is the one honest
  infrastructure gate on the v1 EU exit.
  - **OWNER decision:** approve the privileged execution model on the chosen EU
    host, OR select an alternate approved EU profile that proves sibling
    filesystem/process denial without it. Commercial provider/host choice is
    ultimately owner's.
  - **ENGINEER decision:** the P2 EU-host provider viability spike (may reject
    the proposed provider rather than force a false parity claim); which real
    lifecycle/security probes close the lock.
- **Dependencies.** D1-005c; one host-approved EU profile.
- **Acceptance (D1-R0 §9, CI- or EU-host-provable).** Three bundles via three
  independent P6-R calls in one core process/revision, each its workspace
  default; three exact hostnames serve distinct bounded landings (hostname grants
  nothing); member auth reaches only its workspace, non-members + cross-binding
  selectors fail before effects; N+1 adds a fourth binding while an admitted
  request on binding 1 completes + reconnects in the same process, retained
  identities byte-identical, no Compose service restart; binding replacement /
  admitted-binding removal / secret-runtime-root rotation reject with stable
  restart/admission codes; rollback creates N+2 from a prior COMPLETE snapshot,
  removes only the unadmitted fourth binding with exact confirmation, reproduces
  prior digests; stale CAS / duplicate bindings / root overlap / proxy confusion
  / unavailable secret / unsatisfied requirement / partial readiness fail with
  stable codes; no secret/raw-path in any output; **the shared runtime profile
  proves sibling filesystem + process denial** (the runsc gate above); golden
  path records wall-clock vs the 15-minute target.

**Conditional P5a (narrow).** After D1-006 demonstrates a gap, add **only** what
the D1 slice consumes: a missing secret-ref-from-env/file seam or a boot-time
readiness check with stable failure codes. **"Zero P5a code" is a valid
outcome.** Do NOT build Vault/KMS, rotation machinery, or a provisioning API.
P5a never selects or abstracts sandbox providers.

---

### 4.2 ID1 — agent-driven identity (marketplace self-service; Hydra per D24)

Phase-3-public / marketplace lane. Nine beads; **not** a cold-start or AR1
tracer gate (the M1-backed tracer uses a pre-provisioned bearer). Selection is
**settled: Ory Hydra + boring-owned adapter (Decision 24)** — do not
re-litigate.

**Global ID1 do-NOT (Guardrails + BEADS).** No hand-rolled token/JWT code
(validate via standard OIDC middleware + Hydra introspection — writing JWT
validation by hand is a stop sign); no `permissions` table and no roles beyond
`admin|user` + membership (the membership model is the ONLY authorization
system; MCP consumers are **regular principals**, no special class); no
user-admin UI beyond the minimum login/consent screens; no SSO federation;
reuse D1 compose conventions (one compose file, Postgres, env/file secrets) —
no second infra pattern.

| Bead | Goal | Build | Acceptance | Depends |
| --- | --- | --- | --- | --- |
| **ID1-001** | Hydra service + migrate init + Postgres | Add Hydra as one D1-compose service backed by **Postgres** (the external DB D1 already requires — **no compose DB service** `[resolved per Fable ruling 2026-07-12, owner-overridable: this supersedes the BEADS default of a dedicated Hydra Postgres service; D1-003's "no database service is created" is unaffected]`); one-shot idempotent `hydra migrate sql` init before boot; pin image digest; admin API internal-network only. | Hydra boots against Postgres; migrate job one-shot + idempotent on re-apply; admin API unreachable from outside; ~42 MB image. | D1-003 (`compose.yml`). |
| **ID1-002** | Login/consent UI (minimal) | The two screens Hydra delegates to (authenticate, grant consent), reusing existing app auth — no parallel login stack, no new user store. | Browser completes Hydra login+consent with the existing account; accept/deny works; no new user store. | ID1-001. |
| **ID1-003** | Auto-provision hook | On first token exchange, create account + personal workspace, idempotent by subject claim, on the same authorization path as any regular signup (no invite gate, no special class). | First connect creates account + personal workspace; **second connect is a no-op**; provisioned account is an ordinary member. | ID1-001/002. |
| **ID1-004** | RFC 9728 metadata endpoint | Serve protected-resource-metadata from the **MCP resource server** (boring-owned; Hydra does not serve 9728 by design). | Stock MCP client discovers the auth server via boring's 9728 doc pointing at the Hydra issuer + correct resource id. | ID1-001. |
| **ID1-005** | Resource-vs-audience validation | Validate the RFC 8707 resource indicator against token `audience` on **every** MCP request; reject cross-resource reuse; use introspection/standard middleware. | Audience-mismatch token rejected with a stable code; matching accepted; check runs on every call, not just issuance. | ID1-004. |
| **ID1-006** | DCR enablement + verification | Enable Dynamic Client Registration (RFC 7591) as CIMD fallback; **verify Hydra's DCR default state** (research says on; live spike found it disabled) and set deliberately; scope/bound registration. | DCR endpoint registers a client; default state verified + documented; registration bounded (not an open relay). | ID1-001. |
| **ID1-007** | API-key issuance | Issue API keys from the same identity layer; keys map to the same regular principal + membership; no separate key ACL. | An API key authorizes the same workspace access as its OAuth token; revoking one does not affect the other; keys carry no elevated role. | ID1-003. |
| **ID1-008** | **Per-workspace budget caps — BLOCKING tripwire** | Decorate `createMeteringSink` with a per-workspace hard spend cap + stable refusal code. **Must land BEFORE or WITH ID1 public exposure.** | Capped workspace refuses over-budget calls with a stable code; cap is per-workspace; reuses the metering seam (no new billing system). | governance metering seam. |
| **ID1-009** | CIMD fetch/validation (later) | Implement Client ID Metadata Documents fetch+validate as the primary registration path, pulled in only when a stock client requires CIMD; SSRF guard / allowlist. | A CIMD client-id URL is fetched, validated, and authorizes the flow; malformed/untrusted rejected with a stable code. | ID1-004; a stock client requiring CIMD. |

**Why / workflow.** A stock MCP client (ChatGPT/Cursor) OAuths against a fresh
email, gets an auto-provisioned account + personal workspace, and drives an
agent — the marketplace signup door. That personal workspace becomes the
consumer's persistent journal (the fitness scenario).

**Sequencing.** ID1-001..003 = boot spine; ID1-004..005 = boring-owned protocol
conformance Hydra does not supply; **ID1-008 is a blocking gate on public
exposure**; ID1-006/009 = client-registration paths (009 deferred until a stock
client requires CIMD).

**Open questions.**
- **ENGINEER:** Hydra DCR default-state discrepancy (ID1-006) — verify at build.
- **OWNER (with build):** the ID1-008 budget-cap number and whether the fuller
  workspace-budget work rides here or in BL1 (BL1 also lists workspace budgets
  as the tripwire resolver — see §4.7). Resolve which WP owns the durable cap.

---

### 4.3 AR1 — shareable artifacts (Lane W dispatchable; Lane X gated)

AR1 delivers **two lanes** (AR1-001-SPEC, owner lane split 2026-07-11) that
share neither storage nor authority model and MUST NOT share code beyond the
deep-link route family and the existing MCP server/transport owner. **A
workspace path never appears in any handle, link, deep-link URL, error, audit
record, or MCP resource identifier in either lane.** Both depend on M1
(authenticated principal + bounded artifact shape) + the workspace contract;
neither waits for M2, E2, T1/T2, P2, X1, or ID1.

#### Lane W — same-workspace share (DISPATCH NOW)

- **Goal.** A producer returns a link to a file in the **same** workspace the
  consumer already belongs to. Model: `WorkspaceFileLink` (a live reference, not
  a snapshot) resolved through membership, with a tombstone when the file is
  gone. **Membership IS the access boundary and membership IS revocation.**
- **Why / workflow.** An agent returns a `/a/<id>` link; the workspace owner
  opens it logged-in and lands focused on the file; a deleted target shows a
  provenance tombstone, never a bare 404; a non-member gets a clean denial.
- **Beads (dispatch now, spec §8):**
  - **AR1-002** — `ShareEntryV1` store `{id, workspaceId, server-internal
    path (never emitted), provenance{producerPrincipalRef, createdAt}}`. No blob
    capture, no expiry/revocation fields. Proof: create/get by opaque `id`;
    `path` never in any payload/log/audit; a deleted target still reads back with
    tombstone metadata.
  - **AR1-003** — `/a/<id>` deep-link route reusing the existing membership-denial
    path (no new ACL); renders live resolution to current file state. Proof
    (§6.2 1–3): member lands on the file; deleted → provenance tombstone
    (**`AR1_SHARE_TOMBSTONED`**), not a 404; non-member → clean denial; no
    secret/path in the URL.
  - **AR1-004** — the **first minimal MCP server-side resource** support
    (`listResources`/`readResource`) scoped to share entries, through the same
    M1/M2 server process (reuse of transport, not of resource machinery — no MCP
    resource seam exists today). Proof (§6.2 item 4): a machine consumer reads the
    same current file state, membership-gated identically to the route.
- **Do NOT / stop-signs.** No expiry/revocation/capability token in Lane W; no
  preview-rendering engine; nothing else in this lane.
- **Acceptance (Lane W, §6.2).** The four bullets above, all `[machine]`, plus:
  removing membership removes access.

#### Lane X — cross-workspace deliverable (BUILD-GATED; the authoritative AR1 exit)

- **Goal.** A producer agent in one authorized workspace hands an **immutable,
  digest-pinned** artifact to a *different* authorized workspace; redemption
  materializes an immutable **copy** in the destination, then returns a
  destination-local deep link. Governed by `ArtifactTransferHandle` (signed,
  expiring, revocable authority for one pinned source digest) + host-owned
  `ArtifactBlob` (immutable byte capture) + `WorkspaceFileLink` (destination-local
  reference created after copy). **This is INDEX priority-2's authoritative AR1
  workpackage exit.**
- **Why / workflow.** Decision 22 presents boring as a contracting platform: a
  contracted agent returns artifacts across the projection boundary to a
  customer's workspace, with no live cross-workspace reference permitted.
- **Build gate (do NOT start on "accepted" alone, spec §8 finding 5).** Lane X
  MUST NOT be built until **(a)** the first contracted-mode **engagement** exists
  (Guardrails AR1 — the trigger is an OWNER announcement, not an inferred event)
  **AND (b)** a focused protocol review accepts the staged-write / atomic-rename
  / durable redemption-state / crash-recovery protocol (§2.3.4 / §2.10).
- **Design (settled in spec, ready for that review).** Mint authorizes source →
  captures complete bounded bytes → verifies digest → persists blob → only then
  issues a handle carrying an opaque blob ref/digest (never a source path).
  Destination authorization is independent of link access. Redemption is
  idempotent per `(handleId, destinationWorkspaceId)`. `maxRedemptions` uses a
  durable DB compare-and-increment reservation + staged materialization
  (finding 1). Revoke-vs-redeem boundary = the durable DB reservation, then
  staged write + atomic rename + restart recovery (finding 4). 1:1 handle↔blob
  ownership (blob dedup dropped; refcounting is a future alternative, finding 2).
  Size caps inherit M1 exactly (96 KiB final assistant text / 256 KiB Markdown /
  384 KiB serialized); retention = 7-day default expiry + 72h GC grace;
  `maxRedemptions` defaults to 1 with `open-authenticated` + unbounded deferred
  (§2.12 owner ratification). Boundary codes map to M1's real
  `MCP_AGENT_ARTIFACT_INVALID` / `_TOO_LARGE` / `_UNAVAILABLE` (finding 3;
  `AR1_PAYLOAD_REJECTED` retired). SSRF/path guard: the adapter never fetches an
  arbitrary caller URL, follows redirects, or accepts a path — accept only the
  platform's canonical signed handle.
- **Do NOT / stop-signs.** No live cross-workspace reference; no background GC
  reconciler/daemon; no second MCP runtime owner; no generic attachment
  registry; no capability secret in any URL; no workspace path in any
  handle/link/audit.
- **Acceptance (§6.1, the AR1 exit).** Handle carries no path/secret; source
  edit/delete after issuance does not change redemption (byte-identical to pinned
  digest); destination member materializes a pinned copy whose digest equals the
  handle's; foreign/expired/revoked/digest-mismatch/arbitrary-URL/internal-net/
  raw-path all fail with stable codes **before any destination mutation**;
  redemption idempotent (one `linkId`, one copy); deep link is opaque, member
  lands on the local copy, non-member denied, deleted copy → provenance
  tombstone; a machine consumer reads the copy via MCP resource; revoke/expiry
  durable across restart; blob GC after expiry does not affect an
  already-materialized copy; the two concurrency ACs (6.1.11 `maxRedemptions`
  across two destinations → exactly one succeeds; 6.1.12 revoke-vs-redeem → one
  clean outcome).
- **Open questions.**
  - **OWNER:** announce the first contracted-mode engagement that unblocks Lane X
    build. (This is the gate trigger.)

**AR1 whole-workpackage exit** = Lane X §6.1 holds (the cross-workspace pinned
copy). Lane W dispatching now delays Lane X's *build*, not the exit.

---

### 4.4 AC1 — agent consumption contract (issue #636; the AC1-D micro-spec block)

Implements Decision 22 in code. AC1-T (types) landed #657. The near-term body is
**AC1-D**, which is **blocked on a micro-spec** (the honest open item).

- **AC1-D — in-process subagent dispatcher.**
  - **Goal.** An in-process dispatcher for **subagent** mode reusing pi session
    machinery for the loop and (if durability is needed) T1's event store. Guards
    REQUIRED: consumption depth limit, same-pair cycle refusal, `input-required`
    timeout → canceled (resumable context).
  - **Why / workflow.** Agent A delegates to subagent B in A's workspace; B asks
    back via `input-required`; A answers; the task completes with artifacts — the
    native two-way in-process binding (no MCP loopback, no serialization).
  - **BLOCKING — AC1-D-SPEC required before implementation.** A dispatcher must
    NOT be dispatched until an accepted micro-spec settles: **(1)** the
    dispatcher API surface; **(2)** task ↔ pi-session ownership/mapping;
    **(3)** `input-required` response correlation; **(4)** restart/timeout
    persistence — **decide: T1 event store YES/NO** (the load-bearing unknown);
    **(5)** audit events (principal = originating user/workspace; acting agent
    recorded as **actor**); **(6)** stable public error codes; **(7)** target
    files; **(8)** the proof matrix.
  - **Ratified guard defaults** (2026-07-12, platform defaults, owner-overridable,
    consumers may tighten): **consumption depth = 3**; **input-required timeout =
    24h → canceled** (resumable context). `[resolved per AC1 PLAN: concrete
    numbers live here, not in Guardrails]`.
  - **Do NOT / stop-signs.** No task queue/broker; no `TaskScheduler`; no state
    machine library; no retry policies; no A2A wire transport; no persistence
    beyond existing stores; **contracted mode not built here** (see AC1-M).
  - **Dependencies.** AC1-T (landed); pi session machinery; optionally T1 (the
    spec decides); P1/P6-R behavior (bind targets, not owners).
  - **Acceptance.** A delegates to B in A's workspace; B asks back; A answers;
    task completes with artifacts; exceeding the ratified depth is refused with a
    stable code.
  - **Open questions.**
    - **ENGINEER (in the micro-spec):** T1 event store YES/NO for
      restart/timeout persistence; task↔pi-session mapping; error taxonomy.
    - **OWNER:** whether to tighten depth/timeout defaults for the first
      consumer.

- **AC1-M — consumption modes** (deferred). Workspace-binding parameter in
  `AgentDefinition` (subagent = caller workspace). Contracted mode = a **layered
  decorator over the same pipeline, never a fork** (Decision 22) — **gated behind
  ID1**, not built before a real contracting consumer exists.
- **AC1-P — governed-projection brief** (deferred with AC1-M). Generalize
  governance `filesystemBindings` readonly projection (today hardcoded to
  `company_context`) to arbitrary source workspaces.

**Layering constraint (Decision 22, load-bearing).** Subagent and contracted are
layers over ONE pipeline: workspace-binding parameter + governance projection +
metering. MCP is a door, not a distribution vector.

---

### 4.5 M2 / E2 — canonical MCP surface + consumer intake (priority-2 recuts)

Both require a **recut**: the registry/P7/T1/T2 designs in their PLAN bodies are
**non-dispatchable history** (supersession 2026-07-11). `[resolved per INDEX
reconciliation: PR-PLAN's M2 "after P7 + T2" precondition is stale and created a
false cycle against INDEX; INDEX wins — M2/E2 must NOT wait for P7, T2, generic
E1, or a control plane.]`

#### M2 — canonical MCP agent surface

- **Goal.** Recut the **smallest canonical MCP surface** that exposes a boring
  agent as a first-class per-agent MCP endpoint, mounted from host/deployment
  exposure config, delegating to an immutable `ResolvedAgent` via the same public
  agent contract as every other surface — consuming M1 ingress + AR1
  destination-local artifact contract.
- **Why / workflow.** A stock MCP client connects to a per-agent endpoint by
  `agentId` and drives it — the "consumer contracts an agent from their own
  ChatGPT" scenario (ingress dual of E2: M2 exposes an agent, E2 an environment).
- **Build.** Per-agent MCP mount from `AgentDeployment` + host-owned
  `McpAgentExposureConfig` bound to a `ResolvedAgent`; auth modes `bearer` +
  `public-demo`; `demoPolicy`/`exposureId`/URL shape carried only by
  deployment/host config; reuse M1's caller-stable subject-scoped idempotency,
  dedupe-before-quota, and explicit byte budgets (input/progress/poll/final/
  artifact/aggregate). Amendment 2026-07-08: `demoPolicy`/`exposureId` must also
  be reusable as the future **D2 per-tenant subdomain trial gate**.
- **Do NOT / stop-signs.** Exposure is **NOT agent behavior** — absent from
  `AgentDefinition` (host/deployment authority; this is the Architecture review
  card's explicit stop-sign); never expose raw environment tools unless the
  definition + resolved facts grant them; public-demo uses a host-issued demo
  principal, never an unscoped global key; result URLs expose no absolute paths,
  raw roots, or secrets; no hardcoded production demo verticals outside fixtures.
- **Dependencies.** M1 (ingress) + AR1 (artifact contract) — hard; P6 canonical
  definition/deployment. **D1 does not depend on M2.**
- **Acceptance.** Stock MCP client connects by `agentId`; bearer requires valid
  tenant/workspace authority; public-demo obeys `demoPolicy`; delegation creates
  sessions through the public transport + streams/replays; a lost-response retry
  under a new protocol request id returns the **original** delegation with every
  payload class bounded; result payloads = final text + safe artifact/share URLs
  only; behavior derives from `ResolvedAgent`, exposure from validated
  `AgentDeployment`/`McpAgentExposureConfig`.
- **Open questions.**
  - **ENGINEER:** recut sizing against INDEX (how much of the superseded registry
    design survives — target: the minimum canonical surface).

#### E2 — consumer intake / MCP environment projection

- **Goal.** Project an environment over MCP (fs ops + exec where policy allows)
  as capability-gated tools, reusing the existing readonly/management projection
  enforcement **verbatim** as thin adapters. **A zero-code recut is a VALID
  outcome** if M2 + AR1 already own the intake seam.
- **Why / workflow.** An external MCP client (Claude Code) mounts a boring
  environment and sees exactly what an in-process readonly attachment sees —
  "external reuse for free"; foreign-agent farm integration + AR1 delivery
  intake.
- **Build.** MCP handlers are thin adapters (`read` → `operations.read(desc)`);
  tool surface gated by attachment (read-family always; `write`/`edit` only iff
  `access:'readwrite'`; `exec` only iff `execPolicy:'attached'`); each MCP
  session maps to exactly one `BoundFilesystemContext` (token-per-projection,
  workspace-bound); consume the injected P6-R `DeploymentAttachmentCatalog`. Add
  exact `@modelcontextprotocol/sdk@1.29.0` (no caret) + a new `./mcp` export to
  `@hachej/boring-bash`.
- **Do NOT / stop-signs.** No second enforcement path; no second address store;
  never accept independently-supplied contributions from another attachment;
  never receive raw prepared handles or long-lived operation objects; a denied
  path throws the existing projection error mapped to an MCP error without
  leaking the path. Remote-worker reclassification stays deferred (post-E2 P8
  follow-up BBP5-010), NOT an E2 deliverable.
- **Dependencies.** M2 + AR1 (hard); P6-R injected catalog; E1 auth-gated
  contributions consumed if present but **E2 does not wait for generic E1**.
- **Acceptance.** External MCP client mounts + sees exactly the in-process
  readonly view; denied files absent over MCP (no-leak suite passes on MCP
  mount); no broker secret reachable; every MCP operation reauthenticates + enters
  a fresh callback-scoped E1 lease (expired/revoked/foreign identity fails even
  on an established session).
- **Open questions.**
  - **ENGINEER:** zero-code vs code recut — decide after M2 + AR1 land.

---

### 4.6 T1 completion / T2 — durable multi-channel transport (priority-3)

Both are **post-v1** under Decision 21 and require a recut/dispatch trigger:
dispatch only after a named consumer requires the durable contract; P1 must NOT
prebuild it. `[resolved: T1 pr1/pr2 (#531/#535) landed the transactional
EventStreamStore + envelope-append FOUNDATION historically; "T1 completion" here
means the FULL durable contract beyond those two PRs — the live path is still the
legacy pi-chat `?cursor=` NDJSON route it will supersede.]`

#### T1 completion — durable events

- **Goal.** Durable, offset-addressed replay + one approval (HITL) path after P1,
  backed by a single embedded SQLite `agent.db` (append-only events +
  authoritative pending/waiting rows + idempotency receipts sharing one
  transaction).
- **Why / workflow.** SSE drop + reconnect replays losslessly by offset; an
  approval raised in one client is answerable from another; new-session retries
  survive restart before a caller has a `sessionId`. The substrate channels (CH1)
  and transport (T2) bind to.
- **Build.** `AgentEvent` envelope around existing `PiChatEvent` (no parallel
  event union); monotonic index in `agent.db`; caller receipts keyed by trusted
  admission scope + `requestId`; `agent.stream(sessionId,{startIndex})`
  replay-from-offset + live tail; DS-compliant `GET`/`HEAD` SSE + long-poll
  routes; `needsApproval` + request event + pending row in one transition +
  `resolveInput()`. Production hosts open/migrate one file-backed `agent.db` and
  inject it as a required owned unit.
- **Do NOT / stop-signs.** T1 route hosts REJECT missing/in-memory storage
  (in-memory only for explicit transport-less headless/dev); access/caches use
  trusted structured session scope, NOT UUID uniqueness as authorization; across
  restart never call a seeded new-turn transparent `resume` — say
  `recovery`/`expiry`/durable continuation; a request event cannot exist without
  an answerable/expired pending record; legacy `?cursor=` route stays only until
  the T2 cutover; Pi JSONL remains the conversation-state compatibility authority
  with an explicit reconciler/terminal-failure rule.
- **Dependencies.** P1 seams (`createAgent.ts`, `shared/events.ts` must exist —
  T1 extends, does not fork); Node `node:sqlite` preflight; a named
  durable-contract consumer to trigger dispatch (CH1/T2).
- **Acceptance.** SSE drop + reconnect replays losslessly; another authorized
  client answers an approval; standalone `createAgentApp()` + CLI/core/workspace/
  full-app restart prove file-backed recovery; restart leaves no unanswerable or
  silently-resumed request; JSONL/event divergence reconciled or represented by
  explicit durable terminal state.
- **Open questions.** **ENGINEER:** restart recovery policy (expire/cancel vs
  named recovery) within the "no transparent resume" rule.

#### T2 — transport

- **Goal.** Formalize a minimal AI-SDK-shaped `ChatTransport` (`sendMessages` +
  `reconnectToStream` + `resolveInput`/`interrupt`/`stop`) over the T1 durable
  stream, keyed by `sessionId` only, proven by one shared conformance suite
  passed **identically in-process and over HTTP+SSE**.
- **Why / workflow.** The workspace UI runs unmodified against a refit while a
  headless Node consumer drives the same session interleaved with the UI —
  replacing the bespoke `?cursor=` NDJSON replay + `schedulePiChatReconnect`/
  `replay_gap` dance.
- **Build.** Transport maps 1:1 onto Phase-1 façade members; front stack
  (`RemotePiSession`/`usePiSessions`/`PiChatPanel`) refit to consume ONLY the
  public contract (no internal imports), reconnect wired to T1
  `startIndex`/DS offsets via `@durable-streams/client`; `sendMessages` returns
  `{accepted, sessionId, startIndex}` without draining (turn runs on an
  independent producer, consumed via `reconnectToStream`); `originSurface?`
  provenance (workspace/Slack/embed) populated here for S3's badge. Amendment
  BBT2-007: input-asset intake — persist to a writable accepting sink,
  direct-to-model where provider+host policy allow, or stable rejection.
- **Do NOT / stop-signs.** **Two-handles hard rule** — public agent APIs accept
  `sessionId` only; a lint/invariant forbids surface-native addressing (Slack
  thread ts, workbook/sheet ids, pane ids, raw `x-boring-workspace-id`) in core
  signatures; the `x-boring-workspace-id`→`SessionCtx` mapping lives in
  HTTP-adapter code only. Legacy `?cursor=` path, `PiChatReplayBuffer`,
  `piChatStream.ts` front helpers deleted **LAST**, only after the DS transport
  passes conformance and the workspace playground runs unmodified. UI/render
  layer untouched.
- **Dependencies.** T1 durable stream; P1 façade.
- **Acceptance.** In-process + HTTP+SSE adapters both pass the shared conformance
  suite; workspace UI runs unmodified; a headless Node consumer drives the same
  session interleaved with the UI; the two-handles lint/invariant is enforced.
- **Open questions.** None flagged.

---

### 4.7 Demand-gated marketplace WPs — CH1 / BL1 / MK1 (phases 4–5; DO NOT START)

Guardrails: **"Starting any of these without a named consumer recorded in
INDEX.md is itself an over-engineering failure."** These are deferred DECISIONS,
not deferred fundamentals (§1.3). Documented for completeness; each entry states
the trigger, the shape, and who decides.

#### CH1 — consumer channels (phase 5; T1/T2 first)

- **Goal.** Consumer messaging channels as **bindings of the one Decision-22
  contract** — Telegram first (simple bot API), WhatsApp Business second — no
  channel-specific agent logic.
- **Why / workflow.** "Coach-in-your-pocket": a consumer reaches a contracted
  agent over Telegram using the same task/`contextId`/`input-required` contract
  as every other binding.
- **Constraints.** Channel adapters speak the identical contract as UI/MCP/HTTP/
  CLI/native. **Do NOT:** treat WhatsApp as committed scope — it is an **open
  spike** needing an approval/cost bead first (Meta business verification +
  per-conversation costs). **Slack is OUT of #391** (separate flue-channel story,
  `work/S1-slack-channel/`). No new pipeline/ACL/fork.
- **Dependencies.** T1 completion + T2 (the contract to bind to) + arch-08
  pluggable-surface contract.
- **Acceptance (exit prose).** A consumer reaches a contracted agent over
  Telegram via the shared contract; WhatsApp ships only after its spike resolves.
- **Open questions.** **OWNER:** WhatsApp cost/approval sizing; channel order
  beyond Telegram-first.

#### BL1 — engagement billing (phase 4; metering-seam decorator)

- **Goal.** Turn **engagements** into money — pricing on contracted agents,
  per-engagement/task invoices from metered usage, creator payout accounting —
  built **strictly as a decorator on `createMeteringSink`** (Decision 22
  layering; NEVER a forked billing path).
- **Why / workflow.** "Creators earn": a contracted agent has a pricing ref;
  completing an **engagement** produces an invoice traceable to metered usage; a
  creator payout ledger reflects it.
- **Constraints.** Scope: pricing ref on contracted `AgentDefinition`; invoice
  per engagement/task; creator payout ledger; **workspace token/spend budgets**
  (resolves the ID1-008 tripwire — see the ownership open question in §4.2).
  **Do NOT:** fork the billing path; ship public contracted-mode exposure without
  the workspace budget (hard gate — open signup + no budget = unbounded spend).
- **Dependencies.** AC1 contracted mode (the invocation shape BL1 bills); ID1
  (the identity layer invoices attach to + the budget tripwire it resolves).
- **Acceptance (exit prose).** Contracted agent has a pricing ref; completing an
  engagement/task produces an invoice traceable to metered usage; the payout
  ledger reflects it; workspace spend budgets enforced before any public
  externally-billable exposure.
- **Open questions.** **OWNER (deferred DECISION):** pricing model /
  merchant-of-record.

#### MK1 — agent catalog (phase 4; small)

- **Goal.** Discovery — public profiles for contractable agents (name, creator,
  capabilities, pricing ref), a browse/search surface, a per-agent "contract this
  agent" entry into AC1. **v1 profiles derive from `AgentDefinition` metadata.**
- **Why / workflow.** The one thing marketplace adds on top of phases 1–3
  fundamentals: discoverability. A consumer browses, views a profile, enters the
  AC1 contracting flow from it.
- **Constraints. Do NOT:** build dynamic ranking, reviews, or discovery ML in v1;
  A2A agent-card export is future (Decision 22's future binding).
- **Dependencies.** P6-R (deployed contractable agents to list); AC1 (the
  contracting hand-off); BL1 (pricing ref).
- **Acceptance (exit prose).** Consumer browses the catalog, views a profile
  (capabilities + pricing), and enters the contracting flow from it.
- **Open questions.** **OWNER (deferred DECISION):** catalog shape.

---

### 4.8 P2 (#641) — sandbox provider extraction (priority-4; MERGES LAST)

- **Goal.** Stand up the three-package runtime stack: move concrete providers
  (direct/bwrap/vercel-sandbox/remote-worker-client) out of `packages/agent` into
  `@hachej/boring-sandbox` (imports agent **types only**); `resolveMode`/
  `autoDetectMode`/`hasBwrap` land in `@hachej/boring-bash`; ship one hardened v1
  production provider (gVisor `runsc --platform=systrap`).
- **Why / workflow.** Provider swap needs no agent-package change; honest
  `reported|unknown` capability facts feed environment resolution; EU-sovereign
  isolation for D1's shared host (this is also where the D1-006 runsc lock's
  provider ultimately lives).
- **Recut / ordering (binding priority-4 supersession 2026-07-11).** P2 merges
  **only after the priority-3 T1/T2 proof.** The isolated "Sol recut" may prepare
  against main but **cannot merge, change D1 APIs, or claim a D1 prerequisite.**
  `[resolved per INDEX: every "runsc-before-D1" statement in the P2 body is
  historical/non-dispatchable where it conflicts.]` #557 (publish parity) already
  merged; #628 landed structural-only (`productionReady:false`).
- **Build.** Acyclic edges `sandbox→agent(types)`, `bash→sandbox(values)+agent
  (types)`, agent imports neither; migrate every importer in the **same PR** (no
  old-path re-exports, host shims, or stubs; transitional code carries
  `// TODO(remove:<bead-id>)`); provider facts are `reported|unknown` (fail
  closed, never user-facing capability truth alone); `direct` is explicit
  trusted-local policy only; deployed/core/tenant composers fail closed when no
  approved provider is available; publish-pipeline parity (BBP2-009) before
  boring-bash value-depends on sandbox; move mode-private helpers so no moved
  file value-imports `@hachej/boring-agent`.
- **Do NOT / stop-signs.** Providers do NOT land in `boring-bash/providers` (they
  go to `boring-sandbox/src/providers`); do not move providers until Phase-1
  injection is complete; no automatic isolation downgrade to `direct`; unknown
  facts never silently grant; no capability handshake on worker
  `/internal/health` in P2; #416 contracts + import invariants unchanged; do not
  re-scaffold/republish existing `@hachej/boring-sandbox`. Full relocation +
  capability matrix + `resolveMode` cutover + pure-only binary = post-v1.
- **Dependencies.** Priorities 1–3 complete (esp. T1/T2 proof) **before merge**;
  P1 injection complete before the provider move; P5 (BBP5-002) owns the atomic
  provisioning-engine move. **D1 does not consume or wait for this recut.**
- **Acceptance.** Package builds; no import cycle; current apps compile after
  same-PR importer migration; #416 contracts unchanged (governance consumers
  #476–#501 still work); the hardened runsc provider passes lifecycle/preflight/
  policy conformance; **one preconfigured real EU worker** proves systrap,
  netns/nftables, resource limits, digest-pinned image, and secret absence
  (mocks alone do not close P2 v1).
- **Open questions.** **ENGINEER:** EU-host provider viability spike (may reject
  the proposed provider rather than force a false parity claim) — time-boxed,
  required before any numeric/parity threshold locks. **OWNER:** commercial
  provider/host choice; the privileged-execution decision shared with D1-006.

---

### 4.9 X1 — S3/FUSE mounts (priority-4/last; not a v1 exit gate)

- **Goal.** The mount subsystem of `@hachej/boring-sandbox`: S3-backed
  filesystems (concrete `rclone mount --vfs-cache-mode full`) appearing as a real
  directory inside a sandbox, so an agent's E1 environment can be an object-store
  prefix.
- **Why / workflow.** Environments backed by EU object storage; per-session
  lifecycle mounts with a readiness gate; foreign-agent/farm mounted-environment
  scenarios.
- **Build.** Concrete rclone module (EU-endpoint-first OVH/Scaleway/MinIO);
  **host-side** mount then bwrap `--bind`/`--ro-bind` into the sandbox
  (gVisor-portable); per-session lifecycle (own process/VFS cache/scoped
  creds/isolated teardown; readiness via `/proc/self/mountinfo` + stat/readdir
  probe; lazy-unmount + reap; `ENOTCONN`/`ESTALE` remount vs transient `EIO`
  retry); capability fact `mounts.fuseS3: reported|unknown` (fail closed;
  `vercel` reports unsupported); short-lived prefix-scoped STS injected into the
  mount-process env only; reuse the P2-moved bwrap arg builder, not a fork.
- **Do NOT / stop-signs.** Never expose `/dev/fuse`/`fusermount3`/creds to the
  sandbox (the sandbox gets a directory handle, never a secret — invariant 14);
  mounts scoped to the `user` filesystem only (governed `company_context` NEVER
  raw-mounted); no generic driver interface until a second real mount lands;
  mountpoint-s3 + fuse-overlayfs variants deferred (never kernel overlayfs over
  FUSE); no US-hosted default (invariant 15). The 2026-07-05 benchmark
  (`~/projects/x1-bench/report.md`) is **PROVISIONAL** — BBX1-007 must re-verify
  readonly/backend-down semantics and BBX1-009 must publish a corrected
  repeatable run before any numeric threshold locks.
- **Dependencies.** P2 (creates `boring-sandbox` + moves bwrap), P5/P5a, **and
  E1** (the shipped attachment/conformance path consuming the E1
  `Environment`/`EnvironmentAttachment` contract) + a **named native-mount
  consumer** before implementation resumes.
- **Acceptance.** Readonly S3 mount passes the no-leak suite; `bash`-visible
  files == file-route-visible files over the same mount; no credential readable
  inside the sandbox; EU-endpoint matrix (MinIO in CI) green, no US-hosted
  default; `mounts.fuseS3: unknown`/`vercel` fail closed; `bench:mounts`
  publishes corrected raw results + methodology (numeric thresholds binding only
  in a reviewed follow-up after the flawed baseline reruns).
- **Open questions.** **ENGINEER:** numeric perf thresholds (blocked on the
  corrected benchmark). **OWNER:** the named native-mount consumer trigger
  (demand-gated).

---

## 5. Sequencing and dependency graph (one authoritative ordering)

INDEX.md is the ordering authority; this graph reproduces it with the landed set
verified 2026-07-13. Where PR-PLAN or a PLAN body implied a different order, the
INDEX ordering was kept.

```txt
PRIORITY 1 / v1 (phase 2 — factory host):
  P0 decisions (LANDED: #617/#632/#649/#670)
  P1 (LANDED #642) ─┐
  P6-D (LANDED #623)├─> P6-R (LANDED #647) ─> D1 revision stack ─────────> P8 exit
  A1 compile (#624)─┘                          (LANDED: D1-001..004c2)      (slice #664)
                                               D1-004c3 → c4 → c5
                                               → D1-004d → D1-004e
                                               → D1-005a → D1-005b → D1-005c
                                               → D1-006  [runsc lock: OPEN]
                                               (+conditional narrow P5a)
        A1-dev recut ──────────────────────────────────────────────────> P8 (dev journey)

PRIORITY 2 (phase 3 — external consumption / marketplace MVP):
  M1 (LANDED #650) ─> AR1 Lane W (AR1-002/003/004, DISPATCH NOW)
                   ─> M2 recut ─> E2 recut (zero-code allowed)
  [public promotion later adds: ID1-001..008 + AC1-D + AC1-M/AC1-P(gated)]
  AR1 Lane X: BUILD-GATED on first contracted-mode engagement + protocol review

PRIORITY 3 (phase 5 spine):
  M2/E2 proof ─> T1 completion ─> T2

PRIORITY 4 / LAST:
  T2 proof ─> P2 (#641) provider extraction ─> X1 mounts

DEMAND-GATED (phases 4–5, unstaffed until triggered):
  AC1-M/BL1/MK1 (phase 4)   |   CH1 (phase 5, after T1/T2)

DEFERRED LEAVES (documented, undispatched):
  full P3 | generic E1 | true no-environment | P4 | P5b |
  P6 plugin/child-app expansion | P7 | D2 | S3/S4
```

**Authoritative near-term order (what to dispatch next):**

1. **D1-004c3** (Boring MCP scope admission) — FEAT; docs already landed.
2. **D1-004c4** (WorkspaceBridge runtime-claim admission).
3. **D1-004c5** (managed-agent MCP configured-target admission).
4. **D1-004d** (durable admission ledger) → **D1-004e** (rollback fence).
5. **D1-005a** → **D1-005b** → **D1-005c** (approve → attest → publish).
6. **D1-006** (EU-host proof + runbook) — blocked on the runsc privileged-model
   decision for the *EU production exit only*; 001–005c do not wait.
7. In parallel (priority-2 lane, safe now): **AR1-002/003/004** (Lane W).
8. After M1/AR1 stabilize: **M2 recut** → **E2 recut**.
9. ID1-001..008 + AC1-D (after the AC1-D-SPEC lands) when phase 3 public
   promotion opens; **ID1-008 blocks public exposure.**
10. T1 completion → T2 (priority 3); then P2 (#641, merges last) → X1.

**Cross-lane rules.** D1 does not wait for M2/P2/X1. M2/E2 do not wait for
P7/T2/E1. P2 merges after the priority-3 proof and grows no scope during
rebases. Lane X and all demand-gated WPs need an explicit owner trigger.

---

## 6. Risk register and tripwires (consolidated)

| # | Risk | Owner-relevant tripwire / mitigation | Source |
| --- | --- | --- | --- |
| R1 | **runsc production lock (D1-006)** — the shared EU host must prove sibling filesystem + process denial; the privileged execution model is undecided. | D1-001..005c proceed; D1-006 EU exit blocks until an approved EU profile supplies real lifecycle/security evidence, OR the owner approves the privileged model. A plan cannot self-assert isolation; trusted-`direct` is never valid for the shared host. | D1-R0 §9.9 |
| R2 | **Unbounded spend the day ID1 opens** — open signup + operator-funded keys + no budget. | **ID1-008 per-workspace budget cap is BLOCKING**: lands before/with any public exposure. Decorate `createMeteringSink`; a hard cap + stable refusal code suffices — no billing system. | Guardrails ID1 tripwire |
| R3 | **Public exposure abuse** beyond spend (budget caps alone do not stop abuse). | Public exposure additionally requires **authenticated per-principal request/rate admission controls at the door**. | Guardrails vertical-GTM |
| R4 | **Contractor data hygiene** — a persistent contractor workspace mixes customer A's learnings into work for B. | Known-unknown; **policy required when external contracting opens** (trigger: third parties contracting). Do not build early. | Decision 22 |
| R5 | **Workspace-budget ownership ambiguity** — both ID1-008 and BL1 claim "workspace spend budgets." | Resolve which WP owns the durable cap before ID1 public exposure; the ID1-008 hard cap must exist regardless of BL1's schedule. | §4.2 / §4.7 |
| R6 | **Stacked-PR merge trap** — a MERGED label on a stale base ≠ on main. | Every status cites `git merge-base --is-ancestor <sha> origin/main`; retarget stacked PRs to main the moment their base merges; verify mergeCommit ancestry. | INDEX footnote / OWNER-REVIEW |
| R7 | **Over-engineering under a departed strategic holder** — schedulers, registries, managers, config DSLs. | The universal stop sign (Guardrails §6); the thermo review rule; "ship the dumb version." | Guardrails |
| R8 | **Lane X built on "accepted"** — a dispatcher reads AR1-001 "accepted" and starts the cross-workspace blob lane. | Lane X is DOUBLE-gated: first contracted-mode engagement (owner announcement) AND a focused protocol review of the staged-write/recovery protocol. "Accepted" ≠ "build now." | AR1-001 §8 |
| R9 | **AC1-D built without its micro-spec** — dispatcher API/session-mapping/persistence undecided (esp. T1 YES/NO). | AC1-D is NOT dispatchable until AC1-D-SPEC is accepted. | AC1 PLAN |
| R10 | **Secret/path leakage in D1 outputs** — the vault claim. | No secret value / raw path in git, JSON, Compose render, logs, errors, audit; secret canary in the D1 proof; roots are durable siblings, not container home/root. Backup/restore covers workspace volumes + session root + `agent.db` + revision store + config refs (the whole vault, not just volumes). | D1-R0 §9.8 / Guardrails ops |
| R11 | **P2 false parity** — forcing a "production-ready" claim the EU host can't back. | The EU-host viability spike may reject the provider; unproved facts stay `unknown`/fail closed; P2 merges last and grows no scope. | P2 PLAN / OWNER-REVIEW |
| R12 | **X1 benchmark regressions** — the provisional 2026-07-05 numbers are flawed. | No numeric threshold locks until BBX1-009 republishes a corrected repeatable run; readonly/backend-down semantics re-verified. | X1 PLAN |
| R13 | **Regulated-domain launch** (insurance/accounting/legal) without sign-off. | BLOCKING: disclaimers in the agent definition, human-in-loop default for advice-shaped outputs, an owner regulatory-exposure review recorded in DECISIONS.md; a versioned legal/risk sign-off doc kept outside DECISIONS.md. | Guardrails vertical-GTM |
| R14 | **Ops/upgrade gaps while tenant workspaces are live.** | Paper-first: backup/restore runbook executed for real on a schedule; a support playbook (log locations, event-store query one-liners, per-agent restart, compose rollback); backward-compatible migrations + upgrade/rollback runbook. No dashboards (P8 guardrail). | Guardrails ops |
| R15 | **INDEX status drift** — INDEX text lags the daily D1 merges (reads "c1 ACTIVE" while c1/c2 landed). | Re-verify the freshest D1 landed bead via gh/git ancestry before each dispatch; INDEX has one writer (owner/orchestrator). | §"Freshness" / INDEX plan-write rule |

---

## 7. Glossary

Normalized terms used throughout this document. Where the pack used a synonym,
it is rewritten to the canonical term (exceptions: quoted stable error codes and
literal file/field names).

- **binding** — one exact-hostname site mapping inside the D1 host: bundle +
  deployment refs + exact hostname + bounded landing + owner **principal** ref +
  workspace/runtime roots + secret refs, resolving to one authorized workspace
  whose deployed agent is `default`. One Docker host serves N bindings. (Pack
  synonyms folded in: "site binding", "tenant/agent target", per-hostname
  "generation" target.)
- **revision** — an immutable, append-only, digest-identified snapshot of the
  full D1 host binding collection. Publication advances one atomic
  `currentComplete` pointer; rollback is a **new** revision copied from a prior
  COMPLETE snapshot, never an in-place edit or an old compose file over new
  volumes. (Pack synonym: "generation" / `DeploymentApplyGeneration`.)
- **engagement** — one contracted-mode job/collaboration between a consumer
  workspace and a contracted agent's own workspace; the future long-lived
  pattern is a shared-membership **engagement workspace**. The unit BL1 bills.
- **bead** — the atomic assignment/PR unit (one bead = one agent assignment =
  one PR row). A package TODO coordinates multiple beads; never dispatch a whole
  multi-PR TODO as one run.
- **lane** — one of AR1's two independent sharing paths: **Lane W**
  (same-workspace `WorkspaceFileLink`, membership-gated, dispatch now) and **Lane
  X** (cross-workspace immutable-copy via `ArtifactTransferHandle` + host-owned
  `ArtifactBlob`, build-gated). They share no storage/authority and no code
  beyond the deep-link route family + the MCP server/transport owner.
- **principal** — the authenticated human identity (user + workspace membership);
  the ONLY live authorization/access boundary. External MCP consumers are
  **regular principals**, never a special class. In audit/provenance the
  principal is the originating user/workspace.
- **actor** — the acting agent recorded in provenance for an operation; distinct
  from the **principal** (the human/workspace on whose authority it acts). Part
  of the resource identity `filesystem + path + operation + actor`.
- **projection** — a path-filtered, **readonly** snapshot of one workspace's
  files attached to a task (governed by generalizing governance
  `filesystemBindings`, today hardcoded to `company_context`). The ONLY way
  context flows to a contracted agent; live cross-workspace access grants are
  rejected.

---

### Compile provenance

Sources folded (with precedence order applied): `docs/DECISIONS.md` #21–24 +
Process; `IMPLEMENTATION-GUARDRAILS.md`; `INDEX.md`; `PR-PLAN.md`; `VISION.md`;
`MARKETPLACE-PATH.md`; `OWNER-REVIEW.md` (methodology only — its "4 priorities"
are review cards, so the owner's 4 product priorities were `[resolved per INDEX
"Owner priorities" + MARKETPLACE-PATH B2B ruling]`); `SPIKE-EVIDENCE-2026-07-11`;
`work/D1-tenant-provisioning/{D1-R0-SPEC,PLAN,TODO,HANDOFF}`;
`work/AR1-shareable-artifacts/{AR1-001-SPEC,PLAN,TODO}`;
`work/AC1-agent-consumption-contract/PLAN`; `work/ID1-agent-identity/{BEADS,PLAN}`;
`work/{M2,E2,T1,T2,CH1,BL1,MK1,P2,X1}/PLAN`. Landed set ancestry-verified against
`origin/main` (HEAD `26bd895a9`, #705) on 2026-07-13.
