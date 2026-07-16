# VISION — pluggable-agent platform (#391 runtime refactor v2)

The entry point to this plan pack. What we are building, why, and the checkable end-state per vision component. Ordering and dispatch live in [`INDEX.md`](INDEX.md); the binding architecture lives in [`architecture/`](architecture/); the per-phase work lives in [`work/`](work/); the stacked-PR execution plan in [`PR-PLAN.md`](PR-PLAN.md).

## North star

The owner's vision, in one sentence: **eve-style DECLARATIVE authoring that ships agents fast, natively integrated into the boring-ui FARM, open to foreign agents.** Land on an **eve-class UX** (`vercel/eve`) — author an agent, deploy it, converse with it from any channel, inspect it — but **steered from the boring-ui workspace** and **hosted in Europe**:

- **eve-style declarative authoring (ship agents fast):** an `agents/<name>/`
  directory compiles to a self-contained content-addressed bundle containing a
  versioned `AgentDefinition` and immutable referenced assets. Local dev and D1
  consume the same bundle/digest through an authorized workspace host. The
  workspace supplies activated plugins, policy, and the approved runtime; host
  resolution creates the deterministic stateless resolved value. No platform-source edits or
  imperative per-agent host wiring.
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
| **Version 1 — multi-agent factory host** | minimal agent-directory authoring, versioned definition/deployment separation, explicit workspace/runtime composition, and one EU Docker deployment hosting N agents mapped to authorized workspaces/default bindings and exact-host landing flows | MCP/artifact delivery, T1/T2, full P3, generic E1, true no-environment execution, P2 provider extraction, FUSE/S3, farm UI, hosted child apps |
| **Increment 2 — external consumption** | bearer-authenticated MCP ingress, shareable artifact links, and consumer-workspace intake | canonical M2/E2 recuts follow the M1/AR1 tracer instead of blocking v1 |
| **Increment 3+ — channels and infrastructure** | multi-channel transport first; sandbox providers and advanced mounts last | none of these may retroactively block the multi-agent Docker host |

The proposed v1 product acceptance becomes binding when decision 21 merges:

> With host credentials and infrastructure preconfigured, a developer can
> scaffold one `agents/<name>/` directory, validate it, select or create an
> authorized local workspace with an approved runtime, run a local turn, and
> deploy it with other distinct agents into one EU Docker host in 15 minutes or
> less, with zero platform-source edits. Each configured exact hostname, such
> as `insurance-comparison.senecapp.ai`, serves bounded landing content; its CTA
> enters existing-member sign-in; an authorized member reaches the configured
> workspace; and that workspace selects the deployed definition as agent
> `default`. Hostname selection never grants workspace membership. The proof
> includes at least two agents mapped to distinct workspace/default bindings
> and records definition/deployment digests and each exact
> canonical redacted workspace-composition identity/digest specified by D1-R0
> and bound by stateless P6-R. Reapplying
> is crash/concurrency-safe and creates no duplicate
> resource; the remote target materializes without access to the authoring
> checkout. The complete redacted agent-host snapshot/digest covers the full
> site-binding collection and every desired-state input: hostnames, bounded
> landings, auth/membership/owner and workspace/default bindings,
> roots/storage/runtime, host artifact, workspace compositions,
> definitions/deployments, and secret reference identities only. Fresh
> redacted readiness/status gates publication separately and is not rollback
> identity. The proof
> changes collection-level values, then rollback restores the entire prior
> snapshot and reproduces all resolved digests without a P6 store or secret
> value. The same image/compose may run on a dedicated tenant VM as variant 2.

The proof records elapsed time, platform files changed, manual steps, local
workspace/runtime identities, hostnames, landing/auth/workspace/default-agent
results, definition/deployment and workspace-composition digests, pinned host
artifact, full prior-host restoration, reproduced P6-R digests, and rollback
result. Passing
component tests without this golden path does not complete v1.

## Business horizons

The epic builds the shared substrate, not any one commercial topology. **Do not build ahead of these — they frame *what the architecture must not preclude*, not this epic's scope.**

- **Horizon 1 — now, services-led.** Named vertical agents (**Engagement Analyst** — sovereign deck+model agent for consulting boutiques; **MacroAnalyst** — sovereign macro/investment-research agent) share one EU Docker deployment while remaining isolated by authorized workspace/default-agent bindings. A dedicated sovereign VM is the second topology, offered managed or as a self-host handoff. The **farm is INTERNAL leverage** here — the factory that delivers client work, not a product sold to clients.
- **Horizon 2 — post 3+ repeats.** After the SSO/governance/workroom pattern recurs across 3+ deployments, productize a **white-label "AI Analyst Workroom"** for consultancies/fiduciaries to resell; the **farm becomes client-facing**.
- **Horizon 3 — 2027+.** A **hub-and-spoke** shape: a **free local CLI ⇄ hosted specialist agents** via **MCP delegation**, with **artifacts delivered cross-org**. The open-integration end state, not a near-term build.

**Architecture rule: one deployable artifact; topology is the product line.** The same build runs single-tenant self-host, managed sovereign tenant, shared subdomain tenant, or hub-and-spoke — topology is a commercial choice, not a code fork. This epic must **not FORCE horizon-3 infrastructure early** (no marketplace or billing) **while not precluding it**. Open tension (owner to resolve): STRATEGY.md leans managed-retainer default, the older decision log has clients owning ops (self-hosted handoff); the architecture supports both, the commercial default is TBD.

**Owner ruling (2026-07-11; supersedes the 2026-07-08 topology order).** D1 is
the **multi-agent EU Docker host**: one deployment holds N agent bundles and N
workspace/default bindings, with exact hostnames selecting bounded site
bindings before normal authentication and membership checks. Dedicated VM per
tenant is deployment variant 2 using the same artifact. D2 remains later work
for wildcard tenant administration, cross-tenant control-plane concerns, and
hot tenant lifecycle; those concerns are not required merely to host multiple
authorized workspaces in D1.

## Platform / factory boundary

**Amendment (2026-07-08):** `boring-ui` owns the reusable platform seams:
the canonical agent-definition schema, the provisioning command/API, deployed
agent endpoints, public demo/share contracts, and telemetry hooks. It also owns
stable endpoint/result URL shapes so a factory can wire public flows without
knowing runtime internals.

`boring-ui` v1 owns a minimal exact-host landing shell, bounded declarative
title/summary/CTA text, same-origin member sign-in, membership-gated workspace
resolution, and the workspace's deployed-default-agent binding.
`boring-ui-factory` owns bespoke landing design/code, generated
positioning/copy, GTM assets, pricing content, analytics funnels, and campaign
workflows. Factory assets may consume the platform's site/demo/share/lead
contracts, but they do not define agent runtime authority, provisioning, or the
canonical agent definition.

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
| 1 | **Environment-independent agent core** — injected harness/tools/sessions, no Fastify/runtime-package dependency | Transport-agnostic harness seam exists but server/default composition still leaks into the published core graph | [P0](work/P0-adr/) → [P1](work/P1-headless-core/) | the real `/core` closure is Fastify/runtime-package independent and composes deterministically inside an authorized workspace host; any no-environment smoke is lower-level conformance, not a v1 product mode |
| 2 | **Multi-fs** — governed named filesystems attached per agent/session | **Landed (#416)**: `FilesystemBinding`, `user` + readonly `company_context`, no-leak conformance | [E1](work/E1-environment-attachments/) (generalized `Environment` attachments/facts, scoped views, symlink hardening) → [P4](work/P4-file-ui/) (file UI move) | An agent holds ≥2 filesystems with distinct identities; a scoped view passes the symlink-escape test; company_context no-leak stays green |
| 3 | **Flexible sandbox** — swappable exec providers, honest capabilities | direct/bwrap/vercel-sandbox behind `Sandbox`/`RuntimeBundle`, inside `packages/agent`, static capability claims | [P2](work/P2-sandbox-providers/) (providers → `@hachej/boring-sandbox`; `resolveMode` → boring-bash; capabilities `reported\|unknown`) → [P5](work/P5-provisioning-secrets/) (provisioning, secret brokering) | Provider swap needs no agent-package change; acyclic layering; a test proves no brokered secret is readable inside a sandbox; remote-worker capabilities only from handshake |
| 4 | **External MCP consumption and artifact delivery** | MCP is client-side only; no canonical managed-agent ingress or destination-local artifact contract | [M1](work/M1-mcp-managed-agent/) → [AR1](work/AR1-shareable-artifacts/) → recut [M2](work/M2-mcp-agent-surface/)/[E2](work/E2-mcp-projection/) | A stock MCP client submits a bounded brief through workspace/deployment authority and delivers a complete, immutable artifact copy into the authorized consumer workspace; E2 may be a zero-code recut when M2 + AR1 already own the seam |
| 5 | **Flue building blocks** — durable replayable streams and surface transport substrate | Bespoke replay (`PiChatReplayBuffer` + `?cursor=` NDJSON); no durable public transport | [T1](work/T1-durable-events/) (DS protocol: SQLite `EventStreamStore` + approvals-on-stream) → [T2](work/T2-transport/) (transport contract, front refit) | SSE drop reconnects losslessly by `offset`; an approval raised in one client is answered from another over the shared public transport |
| 6 | **eve UX — workspace as control plane** | Partial: `SessionList`/search, `DebugDrawer`, ask-user UI, model pickers. V1 has only stateless default-agent resolution; no resolved-agent registry, cross-surface view, or unified approvals | [P7](work/P7-multi-agent-inspection/) (post-v1 registry-backed agent routing + public list + `/info`) → [S3](work/S3-control-plane-ux/) (inspect + cross-surface sessions + approval inbox) | Workspace lists agents from the scrubbed agent-list endpoint and inspects each through `/info`; external-surface sessions are observable by `sessionId`; a pending approval from any surface is answerable from the workspace inbox |
| 7 | **Multi-agent EU Docker delivery (v1)** | Existing host can run agents but lacks deterministic N deployment/workspace/default resolution and repeatable site collection apply | [A1](work/A1-agent-authoring/) + [P6-R](work/P6-plugin-child-app/) + [D1](work/D1-tenant-provisioning/) | One host runs at least two distinct deployed agents mapped to authorized workspaces/defaults; each exact URL reaches the correct landing/auth/workspace/agent and the complete host collection rolls back without platform-source edits |
| 8 | **EU-sovereign hosting** | Implicitly true but unstated | Invariant 15 enforced across every work order | Default stack deploys on EU infra with no US-hosted hard dependency; `vercel-sandbox` is optional |
| — | **Tenant control plane and S3/FUSE mounts (later)** | None | [D2](work/D2-shared-tenant-mesh/) + [P2](work/P2-sandbox-providers/) + [X1](work/X1-s3-fuse-mounts/) | Tracked increments with their own security/performance exits; neither gates the multi-agent Docker host |
| — | **Generic external environment mounting (later)** | Existing in-process projection operations only | Recut [E2](work/E2-mcp-projection/) after a named consumer justifies the generic E1/catalog design | An authorized external MCP client sees exactly the permitted environment view and denied files remain absent; this does not gate the priority-2 artifact-delivery recut |
| 9 | **The farm (next epic — deferred; does NOT gate this epic's exit)** | boring-tasks kanban (#486) + this epic's substrate (runtime-owned `sessionId`, `agentId` scoping, replayable streams, S3/FUSE mounts, reserved `data-artifact` part) | **#397 durable task service** + the **farm epic** (fleet view, artifact shelf, Farm MCP control plane) | A foreign agent creates a task, works it in a mounted env, publishes an artifact, requests approval — all visible in the workspace (this epic guarantees only the substrate) |

> **Business line (farm row):** the farm (row 9) is **Horizon-1 INTERNAL leverage** — the factory that delivers vertical-agent client work, not a product sold yet. It becomes client-facing at Horizon 2 and hub-and-spoke at Horizon 3. One deployable artifact; topology is the product line.

### Historical artifact design inputs (non-binding; AR1 decides)

The bullets below predate AR1. They are review inputs, not accepted contract.
AR1's first slice uses a canonical signed handle and immutable copy into an
authorized destination workspace. It has no S3, FUSE, arbitrary-URL, live-
reference, projection, editing, or package-extraction dependency.

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
2. **No public pure mode in v1** — workspace-backed composition is mandatory; existing sealed/no-environment code is migration/test residue. A true no-environment consumer requires a later decision and explicit contract.
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
P0 -> P1 ----------------------┐
P0 -> P6-D --------------------┼-> P6-R -> D1-R0 ----------------┐
          \-> A1-compile ----------------------┬-> D1 beads(+P5a) ┼-> P8
                                               \-> producer -> A1-dev

D1 -> M1 recuts -> AR1 -> M2/E2 -> T1/T2 -> P2/X1
```

Delivery is milestone-based: v1 joins definition/authoring, P1 lifecycle and
readiness, workspace/deployment resolution, and the multi-agent agent-host runtime at P8.
External MCP/artifact consumption follows as priority 2, multi-channel as
priority 3, and provider extraction/mounts as priority 4. Full P3, generic E1,
true no-environment execution, P4, P5b, P6 expansion, P7, D2, S3, and S4 remain
deferred. [`INDEX.md`](INDEX.md) is authoritative.
