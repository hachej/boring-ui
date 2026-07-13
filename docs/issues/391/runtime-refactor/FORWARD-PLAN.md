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
`e45df5440` (#713, D1-004c5). Verified freshest D1 landed FEAT bead:
**D1-004c5** — INDEX.md still reads "D1-004c1 ACTIVE", which is stale
`[resolved per gh ancestry 2026-07-13: D1-004c1 (#704), D1-004c2 (#705),
D1-004c3 (#708), D1-004c4 (#711), and D1-004c5 (#713) are landed; #703/#706
are docs-only]`.

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
D1 → M1 recuts (landed #650) → AR1 → M2/E2 → T1/T2 → P2/X1. Conditional P5a follows D1-006 evidence only when that evidence identifies a consumed secret/readiness gap; it does not gate D1 or precede landed M1.

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

**Phase 3A — managed B2B external delivery.** A pre-provisioned regular
principal connects with a stock MCP client, reaches only the authorized client
workspace, submits a brief, and receives a provenance-bearing artifact through
M1 + AR1 Lane W + M2/E2. This is the first client-demo exit and requires no
public signup or catalog.

**Phase 3B — managed B2B contracting.** For one owner-recorded design partner,
AC1 contracted mode + governed projection + AR1 Lane X deliver an immutable
digest-pinned artifact from the contractor workspace into the client's
workspace, with no live cross-workspace access. Existing managed identity is
sufficient.

**Public self-service promotion.** ID1 plus spend/rate controls later lets a new
user sign up from a stock client and enter the same managed flow (the fitness
story — MCP-only, unbilled). This is a promotion gate, not the phase-3
architecture prerequisite and not yet a marketplace.

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
  **Sequencing note (plan-level, does not pre-settle the owner decision):** the
  policy must land **before the first third-party engagement writes durable
  state** (once A's data is in unscoped durable state, later separation cannot
  prove non-leak), so it is the FIRST contracting bead (**AC1-H**, §4.4), not a
  parallel afterthought. Its proposed default reuses this decision's own
  mechanism — engagement-scoped mutable work + readonly caller projection, no
  customer-derived bytes into contractor-global durable knowledge without
  explicit approval + provenance — which the owner confirms when contracting
  opens.

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
| **A1 compile** | #624 | Deterministic `agents/<name>/` → content-addressed bundle compiler. The post-D1 local-dev recut gating P8 is tracked by bead `wt-391-forward-d3y`, not D1. |
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
| **D1-004c2** | #705 | Embedded/browser workspace-selector convergence (foreign/malformed → stable 421). |
| **D1-004c3** | #708 | Boring MCP trusted-binding scope admission; invalid authenticated selectors are bounded and reject before effects. |
| **D1-004c4** | #711 | WorkspaceBridge verified runtime/refresh claims reject foreign host scope before runtime effects. |
| **D1-004c5** | #713 | Managed-agent MCP route admits only the trusted configured workspace before dispatch. **← origin/main HEAD 2026-07-13.** |

**Freshest D1 landed FEAT bead: D1-004c5 (#713).** Remaining D1 body →§4.

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
**D1-004d → D1-004e → D1-005a → D1-005b → D1-005c**, alongside independent
**D1-006a** runtime-profile qualification; **D1-006** consumes both branches.
Each PR stays dark/additive until its own acceptance; no PR claims the
three-agent exit early. **P2/P5a do not gate D1.** They remain explicit priority-4/X1 prerequisites where their own beads require them.

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

#### D1-004d — Durable admission ledger

- **Goal.** A durable, insert/read-only
  `(hostId, bindingId, executionIdentityDigest)` admission fence committed
  **before** the first agent effect, so a binding that may have crossed the
  effect boundary can never later be silently removed or confused with a
  different execution identity.
- **Why / workflow.** Additive N+1 revision publication and unused-binding
  rollback need a crash-safe conservative boundary. A commit followed by a
  process crash before the effect is intentionally treated as "effect may have
  started" and remains non-removable; the ledger is not a successful-effect
  audit log.
- **Build.** One new core Drizzle migration + schema export;
  `admissionLedger.ts`; a first-effect hook through the D1 host scope. Rows carry
  `{hostId,bindingId,executionIdentityDigest,firstRevisionId,
  firstDesiredStateDigest,sequence,admittedAt}`. The execution digest covers the
  resolved composition and execution-affecting binding facts but excludes
  landing-only fields (so landing-only revisions retain one identity). An
  existing row must match the active binding's digest byte-for-byte or fail
  **`D1_ADMISSION_IDENTITY_MISMATCH`** before any effect. The DB-allocated
  sequence transaction commits before the first effect; concurrent admission is
  idempotent; restart recovery + CLI destructive-diff read from the DB; **no
  update/delete API.** Export one session-level Postgres advisory fence keyed by
  `(hostId, bindingId)` on a dedicated connection: first use holds it while
  re-reading the active collection, inserting/idempotently reading admission in
  a transaction, and committing before the effect, then releases in `finally`.
  D1-004e extends first-use with rollback-journal/prepared-state fencing; that
  extension is not D1-004d acceptance. A failed lock/commit →
  **`D1_ADMISSION_RECORD_FAILED`** and no agent effect.
- **Do NOT / stop-signs.** No update/delete; no route pre-read/process mutex/SQL
  as authority; no "false-positive cleanup" for commit-before-effect crashes.
- **Dependencies.** External Postgres (D1-003); D1-005c installs the first-effect
  hook consumer.
- **Acceptance.** Admitted binding stays non-removable after process restart +
  revision-directory cleanup; landing-only revisions retain the same execution
  identity; binding-id reuse with different execution facts fails closed;
  concurrent admission is idempotent; kill-after-commit-before-effect leaves a
  deliberate permanent fence; pre-commit failure admits no effect. Prepared-removal
  survival and recovery are exclusively D1-004e acceptance.

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
  expected/target revision+digest, removal set). It defines and tests the
  injectable activation/served-ack protocol consumed by D1-005c; it neither
  publishes a production collection pointer nor wires a stable core. The durable
  `prepared` event continues to fence first use if those session locks disappear.
  No row is updated/deleted. Recovery reacquires the same sorted lock set and
  resolves the tuple `(journal state, activation outcome)`: abort when activation
  did not occur, retry activation when its durable intent advanced but completion
  is absent, and finalize only on the exact acknowledged target. Any other
  combination fails closed as **`D1_ROLLBACK_JOURNAL_FAILED`**. Authority is the
  fixed validated revision + operation record, never the wake-up signal, and no
  reconciler daemon is introduced.
- **Do NOT / stop-signs.** No deletion/update of journal rows; no background GC
  reconciler.
- **Dependencies.** D1-004d.
- **Acceptance.** Real-Postgres races on first/last removal keys and overlapping
  sets with no deadlock; fault injection covers root death and DB-connection
  loss at every journal phase boundary; a prepared removal survives either loss
  and admits no row/effect until tuple recovery resolves it; if rollback wins,
  first use on a removed key creates no row/effect; if any admission wins, the
  whole rollback rejects. Concrete pointer publication, stable-core swap,
  ingress-last ordering, and served acknowledgement are exclusively D1-005c
  acceptance.

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
  `/etc/boring/d1/approved-host-releases/<hostId>.json`, outside D1 host-state
  and immutable revision mounts, installed only by the root maintenance release
  procedure — it is not mounted into the app, the app cannot write it, and the
  apply command exposes no mutation for it. The authority directory is
  root:root `0755`; each exact `<hostId>.json` record is root:root `0444`. It binds
  `{ hostAppImageDigest, coreCommand, migrationProcess, ingressImageDigest,
  ingressCommand, caddyfileDigest, hostSecurityConfigDigest,
  selectorInventoryRevision, executionPolicyRevision,
  databaseSchemaCompatibility:{migrationSetDigest,currentEpoch,
  readableByPreviousRelease} }` (both revisions =
  immutable merged commit/content identities, not mutable labels). Before any
  Compose mutation: validate desired digest == approved digest, validate the
  current database schema epoch against the release's declared readable range,
  and intended
  image/Entrypoint/Cmd == approved. Parse Compose + `core.env` through one
  strict versioned production-env schema without logging values: allowed keys =
  approved image defaults + fixed Compose keys + schema-declared app keys. Every
  allowed value is integrity-bound as either **fixed-exact** or
  **canonical-digest-only** when its raw representation (for example a host path)
  must stay out of output. `redacted` is an output classification, never an
  unpinned integrity class; the `hostSecurityConfigDigest` covers the complete
  canonical value map, and D1-005b recomputes the same identity from Docker's
  observed configuration. **Unknown keys, unbound values, and secret-bearing env
  keys reject; secrets are file-mounted only.** Require `NODE_ENV=production`; reject `NODE_OPTIONS`,
  `NODE_PATH`, `LD_PRELOAD`, `LD_AUDIT`, `LD_LIBRARY_PATH` regardless of class.
  The nonsecret identity pins at least `{ d1HostId, publicationOwnerUid,
  agentMode, workspaceRoot:"/data/workspaces", sessionRoot:"/data/pi-sessions",
  trustedProxy:{cidrs:["192.168.255.250/32"],hops:1}, externalPlugins:false,
  pluginAuthoring:false, betterAuthUrl, corsOrigins, cspEnabled, ...,
  managedAgentMcp:{enabled:false},
  collectionPolicy:{maxBindings,maxBundleBytes,maxTotalBundleBytes,
  maxConcurrentPreloads} }` (the policy is part of the approved digest). D1 R0
  hard-pins managed-agent MCP disabled and intentionally cannot serve managed
  MCP. A named post-R0 **M1-D1H managed-MCP deployment-hardening** bead, owned
  by M1, must add bearer `*_FILE` resolution/materialization/rotation/restart
  plus conditional workspace/user target enablement. P5a participates only if
  shared secret brokerage is required; this host-approval slice does not.
- **Do NOT / stop-signs.** No container create/start, P6-R, admission, preload,
  pointer, or ingress op in this bead; the release record is never caller-
  supplied, persisted-by-app, mounted, or reconstructed from app self-report.
- **Dependencies.** D1-004c1–c5 (the static selector inventory it freezes),
  D1-003a ingress constants.
- **Acceptance.** Unknown/secret-bearing keys and drift in owner UID, mode,
  roots, proxy, auth URL, CORS, CSP, cookie security, or MCP enablement all
  reject; managed-agent MCP enablement or target keys also reject in D1 R0.
  Changing any allowed behavior-bearing value changes the
  approved digest and rejects even when the value is output-redacted; a
  materialized secret canary proves no secret bytes enter Docker
  config/identity/failure output.

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
  reject the inherited web-entrypoint and root user; run to zero exit. Migrations
  in a rollback-capable release are **expand-only**: every intermediate and final
  schema must remain readable/writable by the immediately prior approved core; a
  contracting migration is a separate later maintenance release after the prior
  core is removed as a rollback target. Refuse migration before execution when
  the compatibility declaration or migration-set digest does not match. Bind the
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
  inspect/config; an isolated-copy rehearsal proves both the new and immediately
  prior approved core can boot and execute a read/write smoke after migration; an
  incompatible/contracting migration rejects before changing the live DB; drift
  stops/quarantines the unexposed core with ingress still stopped.

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
  independent P6-R calls. Before secret materialization or runtime creation,
  reject a collection exceeding the approved binding/count/byte ceilings with
  **`D1_COLLECTION_LIMIT_EXCEEDED`**; stream bundle reads under the per-bundle
  limit and preload through a simple bounded worker loop capped by
  `maxConcurrentPreloads` (a safety bound, not a scheduler); canonical results
  remain sorted by binding id. Require each candidate composition digest == that
  binding's resolved/preloaded composition (sibling digests may differ). Install
  the D1-004d lazy admission hook; preload all logical bindings through the
  root-owned pending pointer/signal; wait all-ready; atomically publish the
  durable additive/landing-only pointer, then atomically swap the stable
  process's immutable collection and receive the exact served-revision
  acknowledgement (preload is not an agent effect — creates no admission row).
  The signal is only a wake-up mechanism, never authority; the fixed revision
  root, expected prior revision, operation id, and digest are revalidated by the
  core. Expose a local-only redacted status tuple
  `{durableRevision,servedRevision,pendingOperation}` for root-command recovery
  and the runbook. Candidate failure cancels/disposes every candidate-only
  preload while leaving retained active bindings untouched. Only after
  publication may first boot revalidate + start the exact stopped ingress id from the D1-005b capability
  (Caddyfile digest must still match) — that start is initial public
  publication. For an EU shared-host production start, consume the accepted
  `RuntimeIsolationEvidenceV1`: verify its content digest and exact runtime-profile
  facts against the observed host, and reject material drift until D1-006a reruns
  the probes. Qualification-only operations remain non-production and do not
  claim this exit. First actual agent effect: the hook takes D1-004d's fence,
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
  back cleanly; a used addition rejects removal; lost-signal/lost-ack/core-crash
  recovery converges without dual authority; cap and cap+1 tests prove
  deterministic rejection before effects; a failed concurrent preload leaks no
  runtime/provider handle; other rotation rejects before effects.

#### D1-006a — EU runtime-profile qualification

- **Goal.** Qualify one exact EU-host runtime profile for D1's shared
  multi-workspace topology and emit a content-addressed
  `RuntimeIsolationEvidenceV1` consumed by D1-006.
- **Why / workflow.** D1-006 is a priority-1 production gate, while P2's package
  extraction merges only after priority 3 (Decision 23). Security evidence must
  therefore be produced independently of that relocation, against the provider
  where it currently lives, without pretending structural preflight proves
  runtime isolation.
- **Build.** Run the real provider on the selected EU host and record the exact
  kernel, container-engine, runtime-binary digest/version, platform mode,
  privilege/capability set, cgroup/network policy, uid/gid mapping, and provider
  configuration. Probe sibling filesystem traversal, `/proc` and PID enumeration,
  signals/ptrace, mount/device access, process escape, cross-workspace network
  reachability, resource ceilings, teardown, and secret absence. Automate these
  probes as a narrow reusable test suite (two test agents: one attempts the
  attacks, the other asserts denial + secret absence) so the sibling
  filesystem/process-denial proof is machine-checkable and regression-safe as the
  host evolves. Produce a redacted evidence envelope and digest — the envelope
  gains a `testSuiteDigest` binding that automated probe suite (reused by D1-006's
  proof script); D1 startup must reject material runtime-profile drift until the
  proof is rerun.
- **Do NOT / stop-signs.** No package relocation (that is P2), provider
  abstraction, fallback to `direct`, capability self-report as authority, or
  forced runsc approval. The spike may reject the candidate profile.
- **Dependencies.** D1-005c may proceed independently; D1-006 consumes the
  accepted evidence. P2 later reuses the probe suite and evidence schema.
- **Acceptance.** Real hostile probes pass on the exact EU profile; a changed
  runtime binary, privilege model, platform mode, or material host policy
  invalidates the evidence; a rejected profile leaves D1-006 blocked with no
  downgrade.
- **Open questions.** **OWNER:** accept the evidenced privilege boundary or select
  another profile. **ENGINEER:** choose and execute the probes; rejection is an
  acceptable result.

#### D1-006 — EU-host proof and runbook (incl. the open runsc privileged-model decision)

- **Goal.** Prove the whole thing on a real EU host and write the ops runbook —
  three agents/workspaces/hostnames, timing, idempotence, N+1 continuity,
  rollback reproduction, isolation, and secret canary.
- **Why / workflow.** This is the phase-2 product exit; component tests do not
  complete v1 (VISION + OWNER product review card).
- **Build.** `work/D1-tenant-provisioning/RUNBOOK.md`; a narrow proof script
  under `scripts/` (reusing the D1-006a automated isolation test suite so the
  sibling filesystem/process-denial proof is machine-checkable, not a hand-run
  probe); reuse P8's `golden-path.json` (do not duplicate its version
  contract). Reproduce the landed pre-apply edge-network overlap guard on the EU
  host (incl. idempotent reuse of the exact owned D1 project network); three
  distinct agents/workspaces/hostnames in one EU deployment; three independent
  P6-R digests; setup-to-first-success timing + per-stage breakdown; idempotent
  additive apply; N+1 continuity; exact rollback as a **new revision**;
  cross-host/workspace + sibling filesystem/process denial; secret canary;
  dedicated-VM configuration render (variant 2 — config render only, no second
  live host required). Add a distinct **offline disaster-recovery** procedure
  (separate from revision rollback): stop new ingress, drain accepted effects,
  quiesce the core, then capture one manifest covering external PostgreSQL,
  `/data/workspaces`, `/data/pi-sessions` (Pi JSONL + `agent.db`), D1 host
  state/revisions/sequence, approved-release identity, and any enabled host-owned
  artifact-blob root. Secret values are backed up through a separate encrypted
  operator channel; the redacted manifest contains only refs/digests. Restore
  into an isolated network, preserving logical `d1HostId` and admission/journal
  history, verify all digests and authorization denials, then make publication a
  separate explicit step. Measured RPO/RTO are recorded as evidence, not a gate.
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
- **Dependencies.** D1-005c; accepted D1-006a evidence for one exact
  host-approved EU profile.
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
  proves sibling filesystem + process denial** (the runsc gate above,
  machine-checked by the D1-006a automated isolation suite); golden
  path records wall-clock vs the 15-minute target. As DR evidence (not a gate on
  the golden path), a real backup is restored on an isolated host: admitted
  bindings remain admitted, membership/ownership is unchanged, revision and
  composition digests reproduce, sessions remain readable, no DNS/ingress starts
  during restore, and measured RPO/RTO are recorded.

**Conditional P5a (narrow).** A D1 qualification/evidence record that identifies a
consumed secret/readiness gap triggers this follow-up; it must not wait for a
successful D1-006 exit when that gap is what prevents the exit. The closing record
is either an explicit **zero-code** finding that existing seams suffice, or the
smallest D1-consumed secret-ref-from-env/file seam or boot-time readiness check
with stable failure codes plus its proof. Do NOT build Vault/KMS, rotation
machinery, or a provisioning API. P5a never selects or abstracts sandbox providers.

---

### 4.2 ID1 — public self-service promotion (Hydra per D24; not a managed-B2B gate)

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
| **ID1-002** | Login/consent UI (minimal) | Hydra delegates authenticate/consent to existing app auth, including the normal signup path for a new email. Account creation stays owned by existing auth — no token-endpoint hook, parallel login stack, or new user store. | Existing user and new-signup flows complete accept/deny; both yield ordinary accounts. | ID1-001. |
| **ID1-003** | OIDC identity link + personal-workspace ensure | Store a unique `(issuer,subject)` link to the existing account; never auto-link by email. After issuer/resource/token validation, transactionally ensure the ordinary personal workspace during consent or first resource use. Concurrent retries converge; disabled/deleted principals fail closed. | Two concurrent first connects create one identity link and one personal workspace; later connects are no-ops; issuer A's `sub=x` cannot collide with issuer B; email changes do not relink. | ID1-001/002/005. |
| **ID1-004** | RFC 9728 metadata endpoint | Serve protected-resource-metadata from the **MCP resource server** (boring-owned) using the canonical resource URI from approved exposure config, never reconstructed from `Host`/forwarded headers. | Stock client discovers the Hydra issuer + exact configured resource id; hostile Host/proxy input cannot change it. | ID1-001. |
| **ID1-005** | Complete resource-token validation | On **every** MCP request, standard middleware/introspection validates `active`, issuer, expiry, configured RFC 8707 resource vs audience, required scope, current principal status, and current membership. | Cross-resource, wrong-issuer, expired, disabled-principal, removed-member, and insufficient-scope tokens reject before effects; matching token succeeds. | ID1-004. |
| **ID1-006** | DCR enablement + verification | Enable Dynamic Client Registration (RFC 7591) as CIMD fallback; **verify Hydra's DCR default state** (research says on; live spike found it disabled) and set deliberately; scope/bound registration. | DCR endpoint registers a client; default state verified + documented; registration bounded (not an open relay). | ID1-001. |
| **ID1-007** | Boring-owned API-key credentials | Issue ≥256 bits of CSPRNG entropy; reveal plaintext once; store only a keyed digest + nonsecret lookup prefix, label, principal id, created/expiry/revoked timestamps, and bounded last-used metadata. Hydra does not store or validate API keys. A key resolves to an ordinary principal, then reuses the exact resource, account-status, membership, rate, and budget admission path; no key ACL or embedded workspace id. | Raw keys never appear in DB/log/audit; rotation supports overlap; expiry/revocation is immediate; revoking one key does not revoke OAuth or sibling keys, while account disablement/membership removal denies all credentials; keys grant no elevated role. | ID1-003/005/008. |
| **ID1-008** | **Per-workspace budget caps — BLOCKING tripwire** | Decorate `createMeteringSink` with a per-workspace hard spend cap + stable refusal code. **Must land BEFORE or WITH ID1 public exposure.** | Capped workspace refuses over-budget calls with a stable code; cap is per-workspace; reuses the metering seam (no new billing system). | governance metering seam. |
| **ID1-009** | CIMD fetch/validation (later) | Implement Client ID Metadata Documents fetch+validate as the primary registration path, pulled in only when a stock client requires CIMD; SSRF guard / allowlist. | A CIMD client-id URL is fetched, validated, and authorizes the flow; malformed/untrusted rejected with a stable code. | ID1-004; a stock client requiring CIMD. |

**Why / workflow.** A stock MCP client (ChatGPT/Cursor) OAuths through the
existing signup/auth flow; boring links the validated issuer/subject and
transactionally ensures one personal workspace, and drives an agent — the
public self-service door. That personal workspace becomes the consumer's
persistent journal (the fitness scenario).

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
    secret/path in the URL. Unknown ids and existing ids belonging to a workspace
    the principal cannot access produce the **same outward status/code/body** and
    do not reveal tombstone/provenance; only an authorized member may distinguish
    a live target from a tombstone.
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
  MUST NOT be built until **(a)** the owner records a named design-partner
  engagement brief that identifies distinct producer/destination workspaces and
  requires an immutable cross-workspace deliverable (still an explicit
  owner-recorded trigger, not an inferred event; the engagement need not already
  be runnable — this removes the circular "need Lane X to run the engagement that
  authorizes Lane X" reading) **AND (b)** a focused protocol review accepts the
  staged-write / atomic-rename / durable redemption-state / crash-recovery
  protocol (§2.3.4 / §2.10).
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
  384 KiB serialized). Per-artifact caps do not bound aggregate disk, so add
  approved `maxActiveHandlesPerWorkspace`, `maxActiveBlobBytesPerWorkspace`, and
  `maxActiveBlobBytesPerHost` limits: reserve count/declared bytes transactionally
  before durable capture; persist the blob under an opaque exact-DAC host-owned
  root that is never web-served; re-hash/length-check on every redemption; failed
  capture and restart recovery release reservations idempotently; quota
  exhaustion returns **`AR1_ARTIFACT_QUOTA_EXCEEDED`** before issuing a handle.
  Retention = 7-day default expiry + 72h GC grace;
  `maxRedemptions` defaults to 1 with `open-authenticated` + unbounded deferred
  (§2.12 owner ratification). Boundary codes map to M1's real
  `MCP_AGENT_ARTIFACT_INVALID` / `_TOO_LARGE` / `_UNAVAILABLE` (finding 3;
  `AR1_PAYLOAD_REJECTED` retired). SSRF/path guard: the adapter never fetches an
  arbitrary caller URL, follows redirects, or accepts a path — accept only the
  platform's canonical signed handle.
- **Do NOT / stop-signs.** No live cross-workspace reference; no background GC
  reconciler/daemon (GC is one bounded idempotent root/operator command,
  optionally invoked by an external systemd timer/cron, never an
  application-owned scheduler); no second MCP runtime owner; no generic
  attachment registry; no capability secret in any URL; no workspace path in any
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
  already-materialized copy; cap and cap+1 races cannot exceed workspace/host
  active-byte limits; a crash during reservation/capture leaves neither leaked
  quota nor an unaccounted blob; the bounded sweep removes eligible/orphaned
  blobs without touching active reservations; the two concurrency ACs (6.1.11
  `maxRedemptions` across two destinations → exactly one succeeds; 6.1.12
  revoke-vs-redeem → one clean outcome).
- **Open questions.**
  - **OWNER:** record the first qualifying design-partner brief (distinct
    producer/destination workspaces + immutable deliverable). This unblocks Lane X
    without presupposing that contracted mode already runs.

**AR1 whole-workpackage exit** = Lane X §6.1 holds (the cross-workspace pinned
copy). Lane W dispatching now delays Lane X's *build*, not the exit.

---

### 4.4 AC1 — agent consumption contract (issue #636; the AC1-D micro-spec block)

Implements Decision 22 in code. AC1-T (types) landed #657, but one corrective
types slice must land before any dispatcher or external binding (repo-verified:
the landed `ArtifactRef` carries a generic `uri: string` and `AgentTask` pins
`schemaVersion: '1'`):

- **AC1-T2 — typed artifact authority.**
  - Replace generic internal `ArtifactRef.uri` authority with a discriminated
    `ArtifactLocator` containing only platform-owned opaque ids, media metadata,
    and a required digest where bytes are immutable. V1 supports only the concrete
    locators actually owned by AR1; **do not add a generic URL variant.**
  - A destination-local `WorkspaceFileLink` is resolved to an HTTP deep link or
    MCP resource only by the authorized edge adapter. An `ArtifactTransferHandle`
    is a separate typed part carried in protocol data, never embedded in a URL or
    dereferenced as an arbitrary URI.
  - Since the published strict task schema already calls itself version 1,
    publish this correction as `AgentTask` schema version **2**; a compatibility
    parser for version 1 may exist only at an edge and must reject/non-dereference
    arbitrary schemes before translating (Decision 22 permits schema versioning
    once external bindings exist — M2 is the first).
  - **Acceptance.** `file:`, `http(s):`, absolute paths, workspace-relative paths,
    and unknown locator kinds fail before storage/network effects; UI, HTTP, and
    MCP render the same authorized locator without exposing its server-internal
    path.

The near-term implementation body is **AC1-D**, which remains blocked on its
micro-spec and AC1-T2 (the honest open item).

- **AC1-D — in-process subagent dispatcher.**
  - **Goal.** An in-process dispatcher for **subagent** mode reusing pi session
    machinery for the loop and a **durable** task-state seam (a 24h
    `input-required` deadline cannot survive a deploy/crash on an in-memory timer;
    the T1 landed event-store foundation is the reuse-first candidate — the
    micro-spec settles whether it reuses the full `AgentEvent` envelope or a
    narrow dedicated task-state table). Guards REQUIRED: consumption depth limit,
    refusal of any repeated resolved agent in the **full invocation ancestry**
    (A→B→C→A, not just the immediate pair), and durable
    `input-required` deadline/correlation state with timeout → terminal `canceled`
    (the context is reusable only by a new task).
  - **Why / workflow.** Agent A delegates to subagent B in A's workspace; B asks
    back via `input-required`; A answers; the task completes with artifacts — the
    native two-way in-process binding (no MCP loopback, no serialization).
  - **BLOCKING — AC1-D-SPEC required before implementation.** A dispatcher must
    NOT be dispatched until an accepted micro-spec settles: **(1)** the
    dispatcher API surface; **(2)** task ↔ pi-session ownership/mapping;
    **(3)** `input-required` response correlation; **(4)** restart/timeout
    persistence through a narrow **durable task-state slice** (authoritative task
    state, pending input request, response receipt, and event append committed in
    one SQLite transaction) — the persistence *question* is resolved toward
    durable because a 24h deadline demands it; the reuse-first candidate is T1's
    landed event-store foundation and the spec settles only whether it reuses the
    full `AgentEvent` envelope or a narrow dedicated task-state table (in-memory
    is not an option for deployed hosts);
    **(5)** audit events (principal = originating user/workspace; acting agent
    recorded as **actor**); **(6)** stable public error codes; **(7)** target
    files; **(8)** the proof matrix.
  - **Ratified guard defaults** (2026-07-12, platform defaults, owner-overridable,
    consumers may tighten): **consumption depth = 3**; **input-required timeout =
    24h → canceled** (resumable context). `[resolved per AC1 PLAN: concrete
    numbers live here, not in Guardrails]`.
  - **Build.** Store an absolute deadline and stable `inputRequestId`; answer
    idempotency is keyed by `(taskId,inputRequestId,responseId)`. A bounded boot
    recovery scan and every read/answer evaluate expired deadlines — no background
    scheduler is required. While an in-process parent is actively awaiting input,
    its ephemeral timer may reject that waiting promise at the same durable
    deadline; it is an optimization only, and restart/recovery remains governed by
    the durable record. Deployed hosts require the file-backed store under
    `BORING_AGENT_SESSION_ROOT`; in-memory storage is explicit local-dev/test
    only. Check depth and full-chain cycle guards before session allocation,
    projection, metering, or agent effect.
  - **Do NOT / stop-signs.** No task queue/broker; no `TaskScheduler`; no state
    machine library; no retry policies; no A2A wire transport; no persistence
    system beyond the existing event-store SQLite unit; **contracted mode not
    built here** (see AC1-M).
  - **Dependencies.** AC1-T (landed) + AC1-T2; pi session machinery; the narrow
    T1-AC1 task-state slice (not full T1 transport); P1/P6-R behavior (bind
    targets, not owners).
  - **Acceptance.** A delegates to B in A's workspace; B asks back; A answers;
    task completes with artifacts; A→B→C→A and depth overflow reject before target
    effects; kill/restart during `input-required` preserves one answerable request
    and deadline; duplicate answers converge; timeout commits one terminal
    cancellation and cannot resurrect the task.
  - **Open questions.**
    - **ENGINEER (in the micro-spec):** which durable seam shape (T1 `AgentEvent`
      envelope vs a dedicated narrow `task_state` table). Consideration for that
      choice: reusing the full envelope for task metadata/deadlines/idempotency
      receipts adds write amplification, WAL pressure, and broader transaction
      scope on the single-core D1 writer under fan-out, so a dedicated append/
      upsert `task_state` table (authoritative task record + pending
      `inputRequestId` + absolute deadline + idempotency receipts, with a
      foreign-key reference to the event stream, appended in the same SQLite
      transaction) biases the evaluation — but the micro-spec settles it and
      either shape reuses the landed T1 SQLite unit and recovery-scan pattern.
      Also settle task↔pi-session mapping and error taxonomy.
    - **OWNER:** whether to tighten depth/timeout defaults for the first
      consumer.

- **AC1-M — consumption modes** (deferred). Workspace-binding parameter in
  `AgentDefinition` (subagent = caller workspace). Contracted mode = a **layered
  decorator over the same pipeline, never a fork** (Decision 22). It is gated by
  an accepted AC1-D pipeline plus the named managed-B2B engagement brief, **not
  by ID1** — contracted execution needs an authenticated principal, membership, a
  workspace-binding parameter, governed projection, and metering, none of which
  requires Hydra or public signup (M1 already proves a pre-provisioned bearer
  flow). Managed deployments use existing regular principals and membership.
  Public/self-service contracted exposure remains gated by ID1-008, request/rate
  admission, and the AC1-H data-hygiene policy.
  - **Dependencies.** AC1-D + AC1-H + a named managed-B2B engagement. ID1 is
    required only for public self-service exposure.
- **AC1-P — governed-projection brief** (deferred with AC1-M). Generalize
  governance `filesystemBindings` readonly projection (today hardcoded to
  `company_context`) to arbitrary source workspaces.
- **AC1-H — contractor engagement data boundary** (must precede AC1-M for an
  external customer; sequenced with the contracting work, not built early).
  - **Goal.** Prevent customer A's projected inputs, scratch work, sessions, and
    artifacts from becoming readable in customer B's engagement while allowing the
    contractor to retain explicitly approved global knowledge.
  - **Build.** Reuse governance filesystem bindings to compose three explicit
    scopes: contractor-global assets, the caller's readonly projection, and one
    engagement-local writable scratch namespace. Pi sessions, tool state, and
    artifact provenance carry `engagementId`. Other engagement namespaces are
    absent from resolution, not merely hidden by UI. Promotion from engagement
    scratch to contractor-global state is an explicit principal-approved action
    with provenance and a retention decision.
  - **Do NOT / stop-signs.** No new workspace type, live cross-workspace grant,
    vector-memory platform, policy DSL, or automatic "learning" promotion.
  - **Acceptance.** Seed a unique canary through customer A's projection, scratch,
    session, and artifact paths; customer B cannot discover it through files,
    tools, session recovery, logs, or artifact listing. Explicit approved
    promotion is visible to both provenance and audit.
  - **Dependencies.** AC1-D pipeline; existing governance projection seam.

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
  agent as a first-class MCP exposure addressed by a host-owned opaque
  `exposureId` (`agentId` is descriptive metadata, never routing authority),
  mounted from host/deployment exposure config, delegating to an immutable
  `ResolvedAgent` via the same public agent contract as every other surface and
  projecting AC1 `AgentTask` schema version 2 — never inventing an MCP-specific
  lifecycle — consuming M1 ingress + AR1 destination-local artifact contract.
- **Why / workflow.** A stock MCP client connects to a per-agent exposure by its
  canonical exposure URL and drives it — the "consumer contracts an agent from
  their own ChatGPT" scenario (ingress dual of E2: M2 exposes an agent, E2 an
  environment).
- **Build.** Per-agent MCP mount from `AgentDeployment` + host-owned
  `McpAgentExposureConfig` bound to a `ResolvedAgent`; auth modes `bearer` +
  `public-demo`; `demoPolicy`/`exposureId`/URL shape carried only by
  deployment/host config. The route accepts **no caller `agentId`,
  `deploymentId`, or workspace selector**; exact host + `exposureId` maps to one
  immutable resolved deployment, intersected with D1 trusted scope. Public-demo
  issues a short-lived exposure-scoped demo principal/session and enforces
  approved request, concurrency, token/spend, and wall-time ceilings plus a host
  kill switch **before model effects**; global exhaustion fails closed even when
  per-session limits remain. Advertise the literal external contract identity
  `boring.agent-consumption/v2`, reject unsupported versions with a stable code,
  and map submit/status/cancel/input-response/artifact operations to the same
  AC1 transition validators. Reuse M1's caller-stable subject-scoped idempotency,
  dedupe-before-quota, and explicit byte budgets (input/progress/poll/final/
  artifact/aggregate), keying idempotency by trusted principal + exposure +
  contract version + request id and persisting the canonical payload digest so a
  reused key with a different payload/version conflicts. Reuse one set of golden
  task fixtures for MCP and the future HTTP/CLI/native bindings. Amendment
  2026-07-08: `demoPolicy`/`exposureId` must also be reusable as the future **D2
  per-tenant subdomain trial gate**.
- **Do NOT / stop-signs.** Exposure is **NOT agent behavior** — absent from
  `AgentDefinition` (host/deployment authority; this is the Architecture review
  card's explicit stop-sign); never expose raw environment tools unless the
  definition + resolved facts grant them; public-demo uses a host-issued demo
  principal, never an unscoped global key; result URLs expose no absolute paths,
  raw roots, or secrets; no hardcoded production demo verticals outside fixtures.
- **Dependencies.** M1 ingress + AR1 artifact contract + AC1-T2 versioned task
  contract — hard; AC1-D native dispatch is **not** required for an edge binding;
  P6 canonical definition/deployment. **D1 does not depend on M2.**
- **Acceptance.** Stock MCP client connects by canonical exposure URL;
  guessing/submitting an `agentId` cannot select a target; bearer requires valid
  tenant/workspace authority; public-demo obeys `demoPolicy` and
  cap+1/concurrency/kill-switch tests prove no uncapped model effect; delegation
  creates sessions through the public transport + streams/replays; a lost-response
  retry under a new protocol request id returns the **original** delegation with
  every payload class bounded; MCP lifecycle traces validate byte-for-byte against
  the shared AC1 v2 golden fixtures and unsupported versions/conflicting
  idempotency payloads reject before agent effects; internal result payloads =
  final text + typed artifact locators (only the MCP edge renders authorized safe
  share URLs/resources); behavior derives from `ResolvedAgent`, exposure from
  validated `AgentDeployment`/`McpAgentExposureConfig`.
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
  `resolveInput()`. Production hosts open/migrate exactly one file-backed
  `agent.db` under `BORING_AGENT_SESSION_ROOT` and inject it as a required owned
  unit. Assert the D1 single-core writer topology; a second writer process fails
  startup. Pin and test SQLite WAL, busy-timeout, foreign-key, and durability
  settings. Enforce per-event, per-session, per-workspace, and host active-byte
  ceilings; reserve disk headroom for failure/terminal events and refuse new
  turns before the low-watermark is crossed. Live fan-out has a bounded subscriber
  buffer; slow consumers disconnect and replay from their durable offset rather
  than growing process memory. Define a versioned retention policy before public
  dispatch: a bounded operator command may prune only whole terminal sessions
  after their retention window, and a request for a pruned offset returns stable
  **`AGENT_EVENT_OFFSET_EXPIRED`** with the earliest available offset/session
  status — never a silent replay gap.
- **Do NOT / stop-signs.** T1 route hosts REJECT missing/in-memory storage
  (in-memory only for explicit transport-less headless/dev); access/caches use
  trusted structured session scope, NOT UUID uniqueness as authorization; across
  restart never call a seeded new-turn transparent `resume` — say
  `recovery`/`expiry`/durable continuation; a request event cannot exist without
  an answerable/expired pending record; legacy `?cursor=` route stays only until
  the T2 cutover; Pi JSONL remains the conversation-state compatibility authority
  with an explicit reconciler/terminal-failure rule; no automatic vacuum/retention
  daemon, unbounded subscriber queue, or continued model admission after
  durable-event capacity is unavailable.
- **Dependencies.** P1 seams (`createAgent.ts`, `shared/events.ts` must exist —
  T1 extends, does not fork); Node `node:sqlite` preflight; a named
  durable-contract consumer to trigger dispatch (CH1/T2).
- **Acceptance.** SSE drop + reconnect replays losslessly; another authorized
  client answers an approval; standalone `createAgentApp()` + CLI/core/workspace/
  full-app restart prove file-backed recovery; restart leaves no unanswerable or
  silently-resumed request; JSONL/event divergence reconciled or represented by
  explicit durable terminal state; concurrent-stream and 24h soak tests stay
  within bounded memory; disk-full/low-watermark tests preserve terminal-event
  headroom and start no unrecordable turn; slow-subscriber tests reconnect without
  loss; prune tests return an explicit expired-offset boundary.
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
- **Dependencies.** AC1 contracted mode (the invocation shape BL1 bills). Public
  billing additionally depends on ID1, but managed B2B contracting itself does not
  wait for public identity or merchant-of-record work.
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
  retry). Define **`S3MountConsistencyV1`**: readonly mounts may share a prefix;
  readwrite mounts require a single-writer lease per `(endpoint,bucket,prefix)` on
  one host, and multi-host readwrite is rejected until a named consumer supplies a
  real distributed lease. Expose observed facts for read-after-write, atomic
  rename, advisory locking, and durable flush rather than implying POSIX support.
  A successful close/teardown waits for bounded VFS write-back and verifies the
  backend object length/digest; timeout returns a stable failure and preserves the
  protected cache for recovery rather than claiming success. Cap cache
  bytes/inodes; keep it root-owned/exact-DAC; disable `allow_other` unless the
  selected uid-mapping profile explicitly proves it safe. Capability fact
  `mounts.fuseS3: reported|unknown` (fail closed;
  `vercel` reports unsupported); short-lived prefix-scoped STS injected into the
  mount-process env only; reuse the P2-moved bwrap arg builder, not a fork.
- **Do NOT / stop-signs.** Never expose `/dev/fuse`/`fusermount3`/creds to the
  sandbox (the sandbox gets a directory handle, never a secret — invariant 14);
  mounts scoped to the `user` filesystem only (governed `company_context` NEVER
  raw-mounted); no generic driver interface until a second real mount lands; no
  concurrent readwrite mounts of one prefix, silent last-writer-wins claim,
  teardown-before-flush success, or assertion that object storage supplies local
  POSIX rename/locking semantics;
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
  in a reviewed follow-up after the flawed baseline reruns), including
  close-to-backend-visible latency, flush failure/recovery, cache saturation, and
  competing-writer rejection; a successful teardown is followed by a backend-side
  length/digest verification, and an injected upload failure cannot report
  success.
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
  A1 compile (#624)─┘                          (LANDED: D1-001..004c5)      (slice #664)
                                               D1-004d → D1-004e
                                               → D1-005a → D1-005b → D1-005c ─┐
                                               D1-006a [profile qualification] ─┼→ D1-006 [owner acceptance: OPEN]
                                                                                ┘
                                               (+conditional narrow P5a)
        A1-dev recut (`wt-391-forward-d3y`, after D1-006) ──────────────> P8 (dev journey)

PRIORITY 2 (phase 3 — managed B2B external delivery):
  Phase 3A: M1 (LANDED #650) ─> AR1 Lane W (AR1-002/003/004, DISPATCH NOW)
                             ─> M2 recut ─> E2 recut (zero-code allowed)
  Phase 3B (named design partner): AC1-D (after AC1-D-SPEC + AC1-T2)
                             ─> AC1-M / AC1-P / AC1-H + AR1 Lane X
  [public self-service later adds ID1-001..008 + public abuse controls]

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

1. **D1-004d** (durable admission ledger) → **D1-004e** (rollback fence).
2. **D1-005a** → **D1-005b** → **D1-005c** (approve → attest → publish).
3. **D1-006a** qualifies one exact EU runtime profile without performing P2's
   package extraction, in parallel with D1-005c. **D1-006** (EU-host proof +
   runbook) runs only after both branches and the runsc privileged-model owner
   decision for the *EU production exit only*. D1-001–005c are landed or do not
   wait for either bead.
4. In parallel (priority-2 lane, safe now): **AR1-002/003/004** (Lane W).
5. After M1/AR1 stabilize: **M2 recut** → **E2 recut**.
6. Phase 3B (managed B2B contracting, on a named design-partner brief): AC1-T2
   then **AC1-D** (after AC1-D-SPEC) → AC1-H → AC1-M/AC1-P + AR1 Lane X. ID1 is
   NOT a gate here. Public self-service promotion later: ID1-001..008 + public
   abuse controls; **ID1-008 blocks public exposure.**
10. T1 completion → T2 (priority 3); then P2 (#641, merges last) → X1.

**Cross-lane rules.** D1 does not wait for M2/P2/X1. M2/E2 do not wait for
P7/T2/E1. P2 merges after the priority-3 proof and grows no scope during
rebases. Lane X and all demand-gated WPs need an explicit owner trigger.

---

## 6. Risk register and tripwires (consolidated)

| # | Risk | Owner-relevant tripwire / mitigation | Source |
| --- | --- | --- | --- |
| R1 | **runsc production lock (D1-006)** — the shared EU host must prove sibling filesystem + process denial; the privileged execution model is undecided. | D1-001..005c proceed; D1-006a produces the content-addressed `RuntimeIsolationEvidenceV1` (no P2 extraction), and the D1-006 EU exit blocks until that evidence exists **AND** the owner approves the privileged model. A plan cannot self-assert isolation; trusted-`direct` is never valid for the shared host. | D1-R0 §9.9 |
| R2 | **Unbounded spend the day ID1 opens** — open signup + operator-funded keys + no budget. | **ID1-008 per-workspace budget cap is BLOCKING**: lands before/with any public exposure. Decorate `createMeteringSink`; a hard cap + stable refusal code suffices — no billing system. | Guardrails ID1 tripwire |
| R3 | **Public exposure abuse** beyond spend. | Every bearer exposure requires per-principal request/rate admission. `public-demo` additionally requires short-lived exposure-scoped principals, global + per-session request/concurrency/token/spend caps, and an operator kill switch before any model effect. | Guardrails vertical-GTM / M2 |
| R4 | **Contractor data hygiene** — a persistent contractor workspace can mix customer A's state into work for B. | AC1-H is the first contracting bead (before AC1-M writes durable state): readonly caller projection, engagement-local scratch/session scope, deny-by-absence across engagements, explicit approved promotion into contractor-global state. Still owner-triggered when contracting opens; not built early. | Decision 22 / AC1-H |
| R5 | **Workspace-budget ownership ambiguity** — both ID1-008 and BL1 claim "workspace spend budgets." | Resolve which WP owns the durable cap before ID1 public exposure; the ID1-008 hard cap must exist regardless of BL1's schedule. | §4.2 / §4.7 |
| R6 | **Stacked-PR merge trap** — a MERGED label on a stale base ≠ on main. | Every status cites `git merge-base --is-ancestor <sha> origin/main`; retarget stacked PRs to main the moment their base merges; verify mergeCommit ancestry. | INDEX footnote / OWNER-REVIEW |
| R7 | **Over-engineering under a departed strategic holder** — schedulers, registries, managers, config DSLs. | The universal stop sign (Guardrails §6); the thermo review rule; "ship the dumb version." | Guardrails |
| R8 | **Lane X built on "accepted"** — a dispatcher reads AR1-001 "accepted" and starts the cross-workspace blob lane. | Lane X is DOUBLE-gated: first contracted-mode engagement (owner announcement) AND a focused protocol review of the staged-write/recovery protocol. "Accepted" ≠ "build now." | AR1-001 §8 |
| R9 | **AC1-D built without its micro-spec** — dispatcher API/session-mapping/persistence undecided (esp. T1 YES/NO). | AC1-D is NOT dispatchable until AC1-D-SPEC is accepted. | AC1 PLAN |
| R10 | **Secret/path leakage or incomplete disaster restore.** | Redacted outputs contain no secret/raw path; secret canary in the D1 proof; roots are durable siblings, not container home/root. A quiesced backup manifest covers **external PostgreSQL authorities** (auth/membership/admission/journals), workspace/session roots, `agent.db`, D1 revision/sequence state, and enabled blob state; encrypted secret backup is separate. Restore preserves `d1HostId`, admissions, membership, and digests and is proven in an isolated network before publication. | D1-R0 §9.8 / Guardrails ops |
| R11 | **P2 false parity** — forcing a "production-ready" claim the EU host can't back. | The EU-host viability spike may reject the provider; unproved facts stay `unknown`/fail closed; P2 merges last and grows no scope. | P2 PLAN / OWNER-REVIEW |
| R12 | **X1 benchmark regressions** — the provisional 2026-07-05 numbers are flawed. | No numeric threshold locks until BBX1-009 republishes a corrected repeatable run; readonly/backend-down semantics re-verified. | X1 PLAN |
| R13 | **Regulated-domain launch** (insurance/accounting/legal) without sign-off. | BLOCKING: disclaimers in the agent definition, human-in-loop default for advice-shaped outputs, an owner regulatory-exposure review recorded in DECISIONS.md; a versioned legal/risk sign-off doc kept outside DECISIONS.md. | Guardrails vertical-GTM |
| R14 | **Ops/upgrade gaps while tenant workspaces are live.** | Approved releases carry a schema-compatibility envelope; rollback-capable releases are **expand-only** and rehearse the prior core against the migrated schema. Contracting migrations wait until the prior release leaves the rollback window. Keep the backup/restore + support runbooks (log locations, event-store query one-liners, per-agent restart, compose rollback); no dashboard (P8 guardrail). | Guardrails ops |
| R15 | **INDEX status drift** — INDEX text lags daily D1 merges (reads "c1 ACTIVE" while c1–c5 landed). | Re-verify the freshest D1 landed bead via gh/git ancestry before each dispatch; INDEX has one writer (owner/orchestrator). | §"Freshness" / INDEX plan-write rule |

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
`origin/main` (HEAD `e45df5440`, #713) on 2026-07-13.

---

## Review round log

Accumulates across adversarial review rounds; feeds the final arbiter. Each
round: what the integrator applied wholeheartedly, applied with a trim, rejected
(with reason), or escalated to the owner.

### R1 (Sol / gpt-5.6-sol) — 17 applied, 2 somewhat, 0 rejected, 0 escalated

**Applied wholeheartedly (17):**

1. **D1-006a EU runtime-profile qualification bead** — extracts the isolation
   evidence (`RuntimeIsolationEvidenceV1`) into a dispatchable predecessor of
   D1-006 without doing P2's package extraction; adds fail-closed-on-drift.
2. **Crash-recoverable publication/rollback commit protocol** — durable
   `prepared` journal event is an admission fence even if the session lock dies;
   served-revision acknowledgement + recovery tuple; no reconciler daemon.
3. **Admission rows bound to `executionIdentityDigest`** + honest
   commit-before-effect "effect may have started" semantics; `D1_ADMISSION_
   IDENTITY_MISMATCH`; no false-positive cleanup.
4. **Separate redaction from integrity** in the approved-release env schema —
   fixed-exact vs canonical-digest-only; `redacted` is output-only.
5. **Collection-capacity + bounded-preload policy** (`collectionPolicy`,
   `D1_COLLECTION_LIMIT_EXCEEDED`, bounded worker loop — a bound, not a scheduler).
6. **DB-schema compatibility in release approval** — expand-only rule +
   prior-core rehearsal; rewrites R14.
7. **Real disaster-recovery proof covering external PostgreSQL** + all authority
   roots; rewrites R10 (PostgreSQL was missing from the vault list).
8. **Reframe phase 3 as managed B2B external delivery (3A/3B)**, not a
   marketplace MVP; ID1 becomes public self-service promotion. (Graph line adapted
   so AC1-D stays gated by its micro-spec, not by the design partner.)
9. **Remove ID1 as a prerequisite for managed contracted mode** + eliminate the
   Lane X trigger cycle (owner-recorded design-partner brief with distinct
   producer/destination workspaces).
12. **Remove generic artifact URIs (AC1-T2 typed `ArtifactLocator`)** —
    repo-verified: landed `ArtifactRef.uri: string` + `AgentTask schemaVersion:'1'`;
    publish `AgentTask` v2; the cheapest correction point before any dispatcher.
13. **M2 as an explicit versioned projection** of the one contract
    (`boring.agent-consumption/v2`, shared golden fixtures, version-keyed idempotency).
14. **Transactionally safe issuer/subject linking** (`(issuer,subject)`, no email
    auto-link, canonical resource from config not `Host`, complete per-request
    token validation) — reworks ID1-002/003/004/005.
15. **API keys as first-class high-entropy credentials** (≥256-bit CSPRNG, hash +
    prefix, Hydra stores nothing) — reworks ID1-007.
16. **Host-owned `exposureId` not `agentId` as M2 routing authority** + mandatory
    public-demo abuse controls (kill switch, global+per-session caps); rewrites R3.
17. **Bound AR1 aggregate storage** (per-workspace/host active-byte quotas,
    private non-web-served blob root, re-hash on redemption) + non-enumerating
    Lane W denials (unknown/foreign ids share one outward response).
18. **T1 single-writer/storage-budget/backpressure/retention contract**
    (`agent.db` under session root, low-watermark refusal, bounded subscriber
    buffer, `AGENT_EVENT_OFFSET_EXPIRED`; GC/prune as bounded operator command).
19. **X1 `S3MountConsistencyV1`** — single-writer lease per prefix, observed
    facts over POSIX-parity claims, teardown verifies backend length/digest.

**Applied somewhat (2):**

10. **Contractor data hygiene as a fundamental (AC1-H bead).** Integrated the
    AC1-H workpackage (three governed scopes, `engagementId`, canary non-leak
    acceptance), the AC1-M dependency, and the R4 rewrite. **Trimmed:** the
    proposal rewrote the Decision 22 digest to convert the locked *known-unknown*
    into a settled "pre-engagement decision" with a stated default policy — that
    would silently change a locked decision's status. Kept the known-unknown +
    owner-trigger framing; added a sequencing note naming AC1-H as the workpackage
    that settles it *when contracting opens* and presenting the reuse-based default
    as *proposed*, not decided. AC1-H is thus sequenced-with-contracting (gated by
    the named design partner), not built early — consistent with the guardrail.
11. **Durable `input-required` + full-chain cycle detection in AC1-D.** Integrated
    the durability requirement (a 24h deadline cannot survive on an in-memory
    timer), full invocation-ancestry cycle guard (A→B→C→A), durable idempotency
    `(taskId,inputRequestId,responseId)`, and terminal-cancel-then-new-task
    semantics. **Trimmed:** the proposal hard-committed the AC1-D-SPEC's
    load-bearing "(4) T1 event store YES/NO" to *the T1 event store specifically*.
    Kept the persistence answer resolved toward *durable* (forced by the 24h
    requirement) while leaving the micro-spec to settle the exact seam shape (full
    `AgentEvent` envelope vs a narrow dedicated task-state table) — preserving the
    SPEC's engineering latitude rather than rubber-stamping the coupling.

**Rejected (0).** No proposal contradicted a locked DECISION #21–24, an owner
ruling, or a do-NOT-build list on its merits. The one status-changing edit (the
Decision 22 digest rewrite inside #10) was handled by trimming rather than
whole-proposal rejection, since its substantive core (sequence hygiene before the
first durable write) is guardrail-consistent.

**Escalated to owner (0 formal).** Flag for the arbiter: #10's default hygiene
policy (engagement-scoped mutable + readonly caller projection) is stated as the
*proposed* default; it reuses Decision 22's own projection mechanism, so it is a
low-stakes owner confirmation rather than a new decision — but the owner still
formally confirms it when contracting opens.

### R2 (Grok 4.20-reasoning) — 1 applied, 1 somewhat, 2 rejected, 0 escalated

Four proposals (the reviewer's own close says "these four changes").

**Applied wholeheartedly (1):**

- **P2 — automated isolation test suite for the EU host proof.** Added a narrow
  reusable two-agent probe suite (attacker attempts sibling filesystem traversal,
  `/proc`/PID enumeration, cross-binding network reach, secret exfiltration; the
  other asserts denial + secret absence) to D1-006a, made the D1-006 proof script
  reuse it, and gave `RuntimeIsolationEvidenceV1` a `testSuiteDigest`. Makes the
  sibling filesystem/process-denial proof machine-checkable and regression-safe;
  strengthens R1/R11; adds no runtime code and respects every D1 stop-sign.
  Adapted from the reviewer's placement: the `testSuiteDigest` field lands in
  D1-006a (which owns the evidence envelope), not dangling at the end of D1-006.

**Applied somewhat (1):**

- **P1 — resolve AC1-D persistence to a dedicated narrow `task_state` table.**
  The reviewer's WAL-pressure/write-amplification/transaction-scope rationale is
  legitimate and was recorded as an ENGINEER consideration biasing evaluation
  toward a dedicated `task_state` table (foreign-key to the event stream, same
  SQLite transaction). **Trimmed:** did NOT close the seam decision. R1 (item #11)
  deliberately kept the exact durable seam shape open for the BLOCKING
  AC1-D-SPEC — the micro-spec exists precisely to let the ENGINEER settle "(4)"
  with real repo knowledge. Hard-committing the table in this plan would reverse
  that trim and make the plan self-contradictory (require a micro-spec to settle
  a question the plan already answered). Persistence stays resolved toward
  *durable* (forced by the 24h deadline); the seam shape stays with the spec.

**Rejected (2):**

- **P3 — Prometheus `/metrics` seam in D1-005c.** Conflicts with the "Boring by
  default" guardrail (no new operational/observability infra until a measured
  problem is recorded in DECISIONS.md *first*), the P8 "no dashboard" guardrail
  (R14), and the universal stop sign (R7). D1-005c already ships the boring
  version — a local redacted status tuple + runbook. Bolting ~12
  counters/gauges/histograms onto a priority-1 v1-gate bead for observability no
  measured problem demands (the reviewer's own justification cites *future*
  autoscaling, which is on the D1 do-NOT-build list) is exactly the
  over-engineering the discipline forbids. When a real observability gap is
  measured, it gets recorded in DECISIONS.md, then a narrow follow-on bead — not
  the v1 exit.

- **P4 — mandatory versioned `capabilities` set on `AgentDefinition` as a
  Global non-negotiable.** Rejected as presented. (1) Adds a second tool-authority
  source that can drift from the plan's existing model — M2/E2 already gate tools
  on "the definition + resolved facts" and E2's do-NOT explicitly forbids a
  "second enforcement path"; a declared capability set used to gate projection is
  that split-brain hazard. (2) No named current consumer — the cited consumers
  (M2/E2 projection gating, AC1 pre-filter, marketplace) are priority-2+/demand-
  gated; Guardrails forbid new mechanism without a second consumer and "ship the
  dumb version." (3) It injects a schema change to landed P6-D "before D1-005a,"
  loading critical-path scope for a non-critical feature. (4) A hard non-negotiable
  should originate from a DECISION/owner ruling, not a reviewer preference —
  Decision 22 already declares *modes* in `AgentDefinition`, and MK1 already
  anticipates capabilities *metadata* deriving from `AgentDefinition` at phase 4.
  The idea can land with its first real consumer; not as a pre-D1 invariant.

**Escalated to owner (0).** No proposal argued to change a locked DECISION; none
needed escalation. P1's engineering signal is captured without disturbing the
locked AC1-D-SPEC latitude.

### R3 (Gemini 3.5 Flash) — 1 applied, 0 somewhat, 3 rejected, 0 escalated

**Applied wholeheartedly (1):**

- **Active in-process deadline wake-up for AC1-D.** While a live parent is
  awaiting an `input-required` response, an ephemeral timer may reject that
  waiting promise at the already-durable absolute deadline. This closes an active
  process-resource leak without adding a persistent scheduler: the durable task
  record remains authoritative, and boot/read/answer recovery still performs the
  terminal transition after any restart.

**Rejected (3):**

- **POSIX `flock` as the T1 single-writer mechanism.** The requirement to reject
  a second writer already stands, but prescribing `flock` introduces an
  unverified platform/native-dependency choice and a new error-code/API surface
  before the host lifecycle seam selects it. SQLite configuration and the D1
  single-core deployment topology remain the current contract; an implementation
  may propose a portable startup fence with evidence rather than silently making
  POSIX locking normative.
- **`d1Command --force-clear-journal <op-id>`.** An operator command that marks a
  poisoned rollback operation `aborted` or `committed` would bypass the plan's
  fixed recovery tuple and append-only admission/rollback authority. It risks
  converting a fail-closed publication mismatch into an unsafe manual assertion.
  The runbook may diagnose and execute the defined recovery protocol, but an
  exception path needs a separately reviewed owner/DECISION-level operational
  design, not a priority-1 escape hatch.
- **AR1 destination MIME/extension ingress filter.** This invents a generic
  workspace policy/inspection enforcement path with no named authority, consumer,
  policy source, or acceptance evidence. AR1's present cryptographic, quota, and
  destination-local authorization contract is intentional; a concrete product
  policy may later introduce a narrow consumer-backed validation bead.

**Escalated to owner (0).** The active-wait optimization does not alter a locked
choice. The other proposals either require new unproven authority or conflict
with fail-closed/boring-by-default constraints, so no owner ruling is needed to
continue the current plan.

### R4 (Opus) — not run

Anthropic's rate limit ended the session before the scheduled Opus review. No
unreviewed proposal was treated as accepted; the completed Sol, Grok, and Gemini
rounds remain the multi-model evidence for this version.

### Final arbiter — NO-GO resolved, then GO for bead conversion

**NO-GO:** the plan still offered D1-004c3–c5 as dispatchable although
`origin/main` had already landed #708/#711/#713. This correction moves those
beads into §3 context and makes **D1-004d** the next D1 dispatch.

**GO:** conversion may proceed without changing locked decisions or owner
rulings. Residual blockers are explicit: **D1-006** cannot claim the EU
production exit until the owner makes the privileged-`runsc` decision from real
D1-006a evidence, and **AC1-D** remains blocked on its AC1-D-SPEC micro-spec.
