# VISION — pluggable-agent platform (#391 runtime refactor v2)

The entry point to this plan pack. What we are building, why, and the checkable end-state per vision component. Ordering and dispatch live in [`INDEX.md`](INDEX.md); the binding architecture lives in [`architecture/`](architecture/); the per-phase work lives in [`work/`](work/); the stacked-PR execution plan in [`PR-PLAN.md`](PR-PLAN.md).

## North star

The owner's vision, in one sentence: **eve-style DECLARATIVE authoring that ships agents fast, natively integrated into the boring-ui FARM, open to foreign agents.** Land on an **eve-class UX** (`vercel/eve`) — author an agent, deploy it, converse with it from any channel, inspect it — but **steered from the boring-ui workspace** and **hosted in Europe**:

- **eve-style declarative authoring (ship agents fast):** an `agents/<name>/`
  directory compiles to a self-contained content-addressed bundle containing a
  versioned `AgentDefinition` and immutable referenced assets. Local dev and D1
  consume the same bundle/digest; host resolution creates the immutable runtime
  snapshot. No platform-source edits or imperative host wiring.
- **the boring-ui FARM, natively integrated:** the workspace is the **farm control plane** — fleet view (every agent + session across every surface), tasks (work items linked to sessions), artifacts (outputs agents publish — 08 `data-artifact`), approvals (one inbox, `resolveInput`). This epic ships the *substrate*; the farm UI is the next epic.
- **OPEN integration — foreign agents join the farm:** a non-boring agent (Claude Code, Codex, any MCP client) can attach an environment (E2 MCP projection) and — deferred — create tasks / publish artifacts / request human input over a Farm MCP control plane.
- **Flue's internals:** durable indexed event streams, channel ingress packages, `SessionEnv`-shaped environments.
- **boring-ui's existing UX:** the workspace stays the first-class surface and becomes the one place to author agents, wire channels/environments, watch sessions across every surface, and answer approvals.
- **PLUGIN-extensible host product:** both the workspace UI and the agents inside it are extensible by third parties over real APIs (`definePlugin`/`defineServerPlugin`, `/api/v1/plugins/:pluginId/*`, the `boring-ui-plugin` CLI). eve/Flue extend *your own* agent; boring's plugin layer lets others extend the *host product* without forking it (honest caveats: external plugins are trusted local code, hosted-iframe is future, `full-app` ships `externalPlugins:false`).
- **EU-sovereign hosting:** see invariant 15; deployment tiers/providers in [`architecture/10-sandbox-deployment-eu.md`](architecture/10-sandbox-deployment-eu.md).

Grounding: [`architecture/00-global-isa.md`](architecture/00-global-isa.md) "North star" and [`architecture/08-pluggable-agent-surfaces.md`](architecture/08-pluggable-agent-surfaces.md) "The steering surface".

## Delivery increments and product proof

The vision is intentionally wider than the first release. Scope is controlled by
increment, not by pretending every future lane is on one critical path.

| Increment | Ships | Does not wait for |
| --- | --- | --- |
| **Release 0 — vertical tracer** | safe headless façade plus one bearer-authenticated managed MCP vertical returning self-contained bounded Markdown to a stock client | durable transports, environment extraction, tenancy automation, public-demo/download delivery |
| **Version 1 — agent factory** | minimal agent-directory authoring, versioned definition/deployment separation, reliable core transport, optional working environment, and one dedicated EU deployment path | shared tenancy, FUSE/S3, farm UI, hosted child apps, external environment MCP projection |
| **Increment 2+ — platform expansion** | additional surfaces, shared tenants, control plane, foreign-agent environment projection, advanced mounts and services | none of these may retroactively block v1 |

The v1 product acceptance is binding:

> With host credentials and infrastructure preconfigured, a developer can
> scaffold one `agents/<name>/` directory, validate it, run a local turn, and
> deploy it to one dedicated EU tenant in 15 minutes or less, with zero
> platform-source edits. The proof records definition, deployment, and resolved
> snapshot digests. Reapplying is crash/concurrency-safe and creates no duplicate
> resource; the remote target materializes without access to the authoring
> checkout; rollback selects the previous complete deployment snapshot and
> reproduces its resolved digest.

The proof records elapsed time, platform files changed, manual steps,
definition digest, deployment id, and rollback result. Passing component tests
without this golden path does not complete v1.

## Business horizons

The epic builds the shared substrate, not any one commercial topology. **Do not build ahead of these — they frame *what the architecture must not preclude*, not this epic's scope.**

- **Horizon 1 — now, services-led.** Named vertical agents (**Engagement Analyst** — sovereign deck+model agent for consulting boutiques; **MacroAnalyst** — sovereign macro/investment-research agent) on **dedicated sovereign tenants**, offered managed OR as a self-host handoff. The **farm is INTERNAL leverage** here — the factory that delivers client work, not a product sold to clients.
- **Horizon 2 — post 3+ repeats.** After the SSO/governance/workroom pattern recurs across 3+ deployments, productize a **white-label "AI Analyst Workroom"** for consultancies/fiduciaries to resell; the **farm becomes client-facing**.
- **Horizon 3 — 2027+.** A **hub-and-spoke** shape: a **free local CLI ⇄ hosted specialist agents** via **MCP delegation**, with **artifacts delivered cross-org**. The open-integration end state, not a near-term build.

**Architecture rule: one deployable artifact; topology is the product line.** The same build runs single-tenant self-host, managed sovereign tenant, shared subdomain tenant, or hub-and-spoke — topology is a commercial choice, not a code fork. This epic must **not FORCE horizon-3 infrastructure early** (no marketplace or billing) **while not precluding it**. Open tension (owner to resolve): STRATEGY.md leans managed-retainer default, the older decision log has clients owning ops (self-hosted handoff); the architecture supports both, the commercial default is TBD.

**Amendment (2026-07-08): Instant Subdomain Tenancy.** In one shared EU
deployment, an agent turns a tenant YAML into a live `company.senecapp.ai` - its
own skills, files, context, and environment pool - hot, with no redeploy: the
near-zero-marginal-cost outreach engine. This is the **Shared Subdomain tier**.
The two-tier model is directional: D1 is the **Sovereign / EU Tenant Factory**
v1 tier, one dedicated deployment per company; D2 is a post-v1 **Shared
Subdomain** tier. Both may consume the same definition/deployment contracts,
but v1 does not build shared tenancy.

## Platform / factory boundary

**Amendment (2026-07-08):** `boring-ui` owns the reusable platform seams:
the canonical agent-definition schema, the provisioning command/API, deployed
agent endpoints, public demo/share contracts, and telemetry hooks. It also owns
stable endpoint/result URL shapes so a factory can wire public flows without
knowing runtime internals.

`boring-ui-factory` owns landing pages, positioning/copy, GTM assets, pricing
page content, and CTA workflows such as try/book/request. Factory assets may
consume the platform's demo/share/lead contracts, but they do not define agent
runtime authority, provisioning, or the canonical agent definition.

## Future-scale checklist (assert, do not build)

Nothing merged in this epic may preclude these later scale moves; each becomes build scope only when demand requires the named tenant/sandbox/load trigger:

- **Postgres store adapter** — keep interfaces/conformance seams; build when one-file SQLite `agent.db` limits block N tenants or audited retention.
- **Multi-region tenancy** — keep tenancy explicit in `SessionCtx`/workspace routing and avoid region-global singletons; build when N tenants require residency or latency splits.
- **Warm sandbox pools** — preserve provider lifecycle hooks for a Firecracker-snapshot tier distinct from X1 mount tiers; build when M sandboxes need sub-cold-start admission.
- **Model gateway** — keep model selection injectable and policy-visible; build routing/fallback/caching when N tenants or M requests/minute need centralized controls.
- **Eval harness** — keep agent inputs/events replayable enough for benchmarks; build agent-quality evals when release decisions need measured regressions, not anecdotes.
- **SLO/observability layer** — keep stable event/error codes and actor/session labels; build dashboards/alerts when N tenants make manual inspection insufficient.

## Vision components → checkable end-state

Each vision component mapped to what exists today → the delta work orders → a checkable end-state. If every end-state below passes, the vision is delivered; anything not listed is out of scope for this epic. Work orders link into [`work/`](work/).

| # | Vision component | Exists today | Delta (work orders) | Checkable end-state |
|---|---|---|---|---|
| 1 | **Headless agent** — pure config object, no fs/bash/HTTP/React | Transport-agnostic harness seam exists but only via Fastify; config sprawls across env vars + file discovery | [P0](work/P0-adr/) → [P1](work/P1-headless-core/) | `createAgent()` with no environment attachment runs a full turn in a plain Node script, reports `environments: []` facts, imports zero Fastify/boring-bash; all current HTTP consumers unchanged |
| 2 | **Multi-fs** — governed named filesystems attached per agent/session | **Landed (#416)**: `FilesystemBinding`, `user` + readonly `company_context`, no-leak conformance | [E1](work/E1-environment-attachments/) (generalized `Environment` attachments/facts, scoped views, symlink hardening) → [P4](work/P4-file-ui/) (file UI move) | An agent holds ≥2 filesystems with distinct identities; a scoped view passes the symlink-escape test; company_context no-leak stays green |
| 3 | **Flexible sandbox** — swappable exec providers, honest capabilities | direct/bwrap/vercel-sandbox behind `Sandbox`/`RuntimeBundle`, inside `packages/agent`, static capability claims | [P2](work/P2-sandbox-providers/) (providers → `@hachej/boring-sandbox`; `resolveMode` → boring-bash; capabilities `reported\|unknown`) → [P5](work/P5-provisioning-secrets/) (provisioning, secret brokering) | Provider swap needs no agent-package change; acyclic layering; a test proves no brokered secret is readable inside a sandbox; remote-worker capabilities only from handshake |
| 4 | **External agent access** — any MCP client mounts an environment | None (MCP used client-side only) | [E2](work/E2-mcp-projection/) (MCP projection, token→`BoundFilesystemContext`) | An external MCP client mounts a boring environment; denied files absent over MCP; no-leak suite green on the MCP mount |
| 5 | **Flue building blocks** — durable replayable streams and surface transport substrate | Bespoke replay (`PiChatReplayBuffer` + `?cursor=` NDJSON); no durable public transport | [T1](work/T1-durable-events/) (DS protocol: SQLite `EventStreamStore` + approvals-on-stream) → [T2](work/T2-transport/) (transport contract, front refit) | SSE drop reconnects losslessly by `offset`; an approval raised in one client is answered from another over the shared public transport |
| 6 | **eve UX — workspace as control plane** | Partial: `SessionList`/search, `DebugDrawer`, ask-user UI, model pickers. No resolved-agent registry, no cross-surface view, no unified approvals | P6-R `ResolvedAgentRegistry` → [P7](work/P7-multi-agent-inspection/) (agentId routing + public agent list + `/info`) → [S3](work/S3-control-plane-ux/) (inspect + cross-surface sessions + approval inbox) | Workspace lists agents from the scrubbed agent-list endpoint and inspects each through `/info`; external-surface sessions are observable by `sessionId`; a pending approval from any surface is answerable from the workspace inbox |
| 7 | **Dedicated EU delivery (v1)** | Dedicated/manual tenant provisioning only | [A1](work/A1-agent-authoring/) (directory compiler/validator) + [D1](work/D1-tenant-provisioning/) (dedicated tenant factory) | The timed golden path above deploys a definition-pinned agent and can roll it back without platform-source edits |
| 8 | **EU-sovereign hosting** | Implicitly true but unstated | Invariant 15 enforced across every work order | Default stack deploys on EU infra with no US-hosted hard dependency; `vercel-sandbox` is optional |
| — | **Shared tenancy and S3/FUSE mounts (post-v1)** | None | [D2](work/D2-shared-tenant-mesh/) + [X1](work/X1-s3-fuse-mounts/) | Tracked increments with their own security/performance exits; neither gates the dedicated v1 path |
| 9 | **The farm (next epic — deferred; does NOT gate this epic's exit)** | boring-tasks kanban (#486) + this epic's substrate (runtime-owned `sessionId`, `agentId` scoping, replayable streams, S3/FUSE mounts, reserved `data-artifact` part) | **#397 durable task service** + the **farm epic** (fleet view, artifact shelf, Farm MCP control plane) | A foreign agent creates a task, works it in a mounted env, publishes an artifact, requests approval — all visible in the workspace (this epic guarantees only the substrate) |

> **Business line (farm row):** the farm (row 9) is **Horizon-1 INTERNAL leverage** — the factory that delivers vertical-agent client work, not a product sold yet. It becomes client-facing at Horizon 2 and hub-and-spoke at Horizon 3. One deployable artifact; topology is the product line.

### Artifact reservations (farm epic, not #391 scope)

- **Publish protocol:** `data-artifact` stays the **only** publish path.
  The agent writes an output to an attached environment, then emits
  `{ artifactId, kind, title, filesystem, path, version }`;
  `version` is monotonic per `artifactId`.
- **Kind catalog seed:** `markdown` (Streamdown/editor), `code` (CodeMirror/code-block),
  `dashboard` (`plugins/bi-dashboard`), `deck` (`plugins/deck`),
  `dataset` (`plugins/data-explorer`), and `html/generated` (`plugins/generated-pane`).
  Viewers remain pure/embeddable with no workspace-shell dependency.
- **Editable artifacts:** edit is an explicit share capability
  (signed, revocable, actor-attributed token); public shares default read-only.
  Edits create new versions and emit `artifact-edited` for the owning agent
  to consume and iterate on. Multiplayer editing is later work via #367
  TipTap/Yjs on the same version chain.
- **Security:** renderers run on a separate viewer origin in sandboxed iframes
  with CSP `default-src 'none'`, no host cookies/storage, signed URLs,
  EU S3 blob storage, and zero viewer-side credentials.
- **Package deferral:** extract `boring-artifact` only when a second consumer appears: pi-for-excel (#551), Slack via flue channels, or customer review page.
  PR #424's public workspace Markdown share is explicitly **non-artifact**;
  lessons reserved here: tokens address `artifactId+version+capability`,
  publish snapshots rather than live workspace paths, assets are captured into
  a manifest, viewer/editor separation is mandatory, and downloads are kind metadata.

### State-store reservations (no scope addition)

- #397 task tables may use later `agent.db`/Postgres state tables; the durable task service remains farm-epic scope.
- Farm-epic artifact index is a derived table folded from `data-artifact` events.
- #424 share records remain outside #391; public Markdown share remains non-artifact.

## Architecture at a glance

**Five clean layers** (v2 extends the original three):

```txt
Surfaces         workspace UI | CLI | future Slack/pi-excel adapters — ingress/egress adapters only
Transport        in-process | HTTP+SSE | future WS/durable — send + reconnect
Agent core       model/session/tool loop; no implicit runtime; typed event stream
Feature layer    optional UI, bash, web, plugin, approval, search capabilities
Runtime layer    concrete storage/sandbox/provider implementation
```

**Three-package runtime stack** (acyclic; 00 open decision 3 RESOLVED, [08 decision 11](architecture/08-pluggable-agent-surfaces.md)):

- **`@hachej/boring-agent`** (top) — defines ALL contracts; imports **neither** boring-bash nor boring-sandbox.
- **`@hachej/boring-bash`** (THE RUNTIME) — fs bindings/tools/routes/UI + bash tool + runtime-mode resolution (`resolveMode` = the CHOICE of sandbox); imports boring-sandbox **values** + agent **types**.
- **`@hachej/boring-sandbox`** (sandbox management) — providers (`direct`/`bwrap`-gVisor/`vercel`-PROXY/`remote-worker`-client), FUSE-S3 mounts, lifecycle, capability facts (`reported | unknown`); imports agent **types only**.

Layering edges: `sandbox → agent(types)`; `bash → sandbox(values) + agent(types)`. Full ownership table: [`architecture/00-global-isa.md`](architecture/00-global-isa.md) "Target package ownership".

## The four-part surface contract

A surface and the agent core exchange exactly four things ([08 "What every framework converges on"](architecture/08-pluggable-agent-surfaces.md)):

1. **Message in** — `AgentSendInput = { sessionId?, content, inputAssets?, actor?, ctx?, originSurface?, requestId }`. `requestId` is caller-supplied write idempotency; retries never synthesize a new random identity in core. Actor/origin are durable attribution. `ctx` is trusted boring tenancy context, never surface-native addressing.
2. **Event stream out** — one ordered, indexed, replayable stream of typed events; wire/transport swappable.
3. **Approvals / HITL** — a request event out + a response call in, on the same channel, declared on the tool — not per-surface special cases.
4. **Session state** — a runtime-owned `sessionId` + serializable transcript; persistence and addressing are boundary decisions.

**Amendment (2026-07-08):** `environments[]` are the semantic capability truth
for filesystem/bash/environment authority. `runtimeMode` is diagnostic only; it
must not drive feature gating. Surfaces render from resolved environment facts
and capability bundles, not from scalar `filesystem`/`shell`/`attachments`
flags.

## Decisions locked (one line each)

Full text and rationale: [`architecture/08-pluggable-agent-surfaces.md`](architecture/08-pluggable-agent-surfaces.md) "Decisions this file locks", ratified in the Phase 0 ADR ([P0](work/P0-adr/)).

1. **Wire protocol** — keep `PiChatEvent` as the v1 payload, add the indexed envelope; no parallel event union.
2. **Pure mode** — pi-coding-agent with no environment attachment + sealed cwd behind the Phase 1 audit, not a second harness; legacy `runtime: none` is a host/adapter diagnostic during migration.
3. **Surfaces outside the agent package** — per-channel packages (Flue model), not `boring-agent` subpaths.
4. **Readonly fs is v1** — already shipped via #416.
5. **One namespace rule** — superseded by named `(filesystem, path)` bindings.
6. **Channel ingress is reused, not written** — depend on pinned `@flue/*` packages with thin adapters; egress via provider SDKs.
7. **Environments are attachable resources** — fs+sandbox has identity independent of any agent; agents consume resolved environment attachments/facts; external agents attach via MCP projection ([09](architecture/09-environments-attachable.md)).
8. **Front chat provider unchanged** — vendored ai-elements fork insulated from the wire by the `PiChatEvent → reducer → BoringChatMessage` projection; T2 forces zero render-layer work.
9. **No feature-flag framework** — version rides existing carriers (`AgentEvent.v`, additive DS routes, injectable front transport, minor bumps at T2/P3).
10. **No retro-compat, no speculative abstraction** — importers migrate in the same PR; transitional code carries `TODO(remove:<bead-id>)` naming its deletion-owner bead; a later TODO owner is allowed only when explicitly named per [`INDEX.md`](INDEX.md); no abstraction without two real consumers.
11. **Three-package runtime stack** — concrete providers live in `@hachej/boring-sandbox`, not boring-bash subpaths; acyclic layering as above.

## Explicitly deferred (do not build in this epic)

- **`FileTreeDataProvider` boundary** — until #295 is scheduled.
- **Document-authority write/edit override seam** — zero real consumers; arrives with #367/#226 (filed at P8).
- **Subagent environment grants** — first consumer lands in P7 (kept minimal there).
- **Durable turn continuation (WaitingTurn machine)** — restart-resume is new-turn-seeded by design (T1).
- **Remote-worker-as-environment-transport** — remote-worker stays a provider; reclassification filed at P8.
- **Predefined runtime image catalog** — productize pinned `boring-runtime-*` OCI images with common CLIs (`node`, `python`, `git`, `gh`, `rg`, etc.) and later vertical-agent toolchains. This pairs with the vertical-agent business line, but stays a catalog/build-pipeline follow-up; #391 only reserves provider config + provisioning fingerprint semantics.
- **Farm-epic first-party plugins** — tasks, artifacts, and fleet follow the same host-mediated plugin composition pattern as bash/governance; no package imports another first-party plugin for policy/mechanism composition.
- **P6b child-app / Macro scoping** — HARD BLOCKED on the shared child-app platform type (#376); a tracked follow-up outside the epic exit.
- **Concrete Slack/spreadsheet/Office surfaces** — Slack moves to the separate
  "Slack via flue channels" story; spreadsheet/pi-excel moves to issue #551;
  Office Lane A/B/C remains issue #526. #391 keeps only the pluggable transport
  and control-plane substrate these later surfaces consume.

## Dispatch order (summary)

```txt
R0: P0 -> P1 -> M1. V1: P1 -> P6-D -> A1; P1 -> T1 -> T2;
P1 -> P2 -> P3 -> E1 -> P5a -> P6-R -> D1; these join at P8.
All remaining lanes are post-v1.
```

Delivery is milestone-based: R0 ships M1 after the safe P1 boundary; v1 joins
definition/authoring, reliable transport, optional runtime, and D1 dedicated
delivery at P8. P4, E2, X1, P5b, P6 expansion, P7, M2, D2, S3, and S4 are
post-v1. The authoritative dependency graph is in [`INDEX.md`](INDEX.md).
