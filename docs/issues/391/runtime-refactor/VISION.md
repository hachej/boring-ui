# VISION — pluggable-agent platform (#391 runtime refactor v2)

The entry point to this plan pack. What we are building, why, and the checkable end-state per vision component. Ordering and dispatch live in [`INDEX.md`](INDEX.md); the binding architecture lives in [`architecture/`](architecture/); the per-phase work lives in [`work/`](work/); the stacked-PR execution plan in [`PR-PLAN.md`](PR-PLAN.md).

## North star

The owner's vision, in one sentence: **eve-style DECLARATIVE authoring that ships agents fast, natively integrated into the boring-ui FARM, open to foreign agents.** Land on an **eve-class UX** (`vercel/eve`) — author an agent, deploy it, converse with it from any channel, inspect it — but **steered from the boring-ui workspace** and **hosted in Europe**:

- **eve-style declarative authoring (ship agents fast):** an `agents/<name>/` directory compiles to a `createAgent()` config + an `AgentRegistry` entry — no imperative wiring. **Delivery is deferred post-P7** (the `AgentRegistry` must exist first; no-speculative-abstraction policy). Its v0 is P6a's `agents: [...]` workspace declaration; the directory-compiler is the post-P7 follow-up (P8).
- **the boring-ui FARM, natively integrated:** the workspace is the **farm control plane** — fleet view (every agent + session across every surface), tasks (work items linked to sessions), artifacts (outputs agents publish — 08 `data-artifact`), approvals (one inbox, `resolveInput`). This epic ships the *substrate*; the farm UI is the next epic.
- **OPEN integration — foreign agents join the farm:** a non-boring agent (Claude Code, Codex, any MCP client) can attach an environment (E2 MCP projection) and — deferred — create tasks / publish artifacts / request human input over a Farm MCP control plane.
- **Flue's internals:** durable indexed event streams, channel ingress packages, `SessionEnv`-shaped environments.
- **boring-ui's existing UX:** the workspace stays the first-class surface and becomes the one place to author agents, wire channels/environments, watch sessions across every surface, and answer approvals.
- **PLUGIN-extensible host product:** both the workspace UI and the agents inside it are extensible by third parties over real APIs (`definePlugin`/`defineServerPlugin`, `/api/v1/plugins/:pluginId/*`, the `boring-ui-plugin` CLI). eve/Flue extend *your own* agent; boring's plugin layer lets others extend the *host product* without forking it (honest caveats: external plugins are trusted local code, hosted-iframe is future, `full-app` ships `externalPlugins:false`).
- **EU-sovereign hosting:** see invariant 15; deployment tiers/providers in [`architecture/10-sandbox-deployment-eu.md`](architecture/10-sandbox-deployment-eu.md).

Grounding: [`architecture/00-global-isa.md`](architecture/00-global-isa.md) "North star" and [`architecture/08-pluggable-agent-surfaces.md`](architecture/08-pluggable-agent-surfaces.md) "The steering surface".

## Business horizons

The epic builds the shared substrate, not any one commercial topology. **Do not build ahead of these — they frame *what the architecture must not preclude*, not this epic's scope.**

- **Horizon 1 — now, services-led.** Named vertical agents (**Engagement Analyst** — sovereign deck+model agent for consulting boutiques; **MacroAnalyst** — sovereign macro/investment-research agent) on **dedicated sovereign tenants**, offered managed OR as a self-host handoff. The **farm is INTERNAL leverage** here — the factory that delivers client work, not a product sold to clients.
- **Horizon 2 — post 3+ repeats.** After the SSO/governance/workroom pattern recurs across 3+ deployments, productize a **white-label "AI Analyst Workroom"** for consultancies/fiduciaries to resell; the **farm becomes client-facing**.
- **Horizon 3 — 2027+.** A **hub-and-spoke** shape: a **free local CLI ⇄ hosted specialist agents** via **MCP delegation**, with **artifacts delivered cross-org**. The open-integration end state, not a near-term build.

**Architecture rule: one deployable artifact; topology is the product line.** The same build runs single-tenant self-host, managed sovereign tenant, or hub-and-spoke — topology is a commercial choice, not a code fork. This epic must **not FORCE horizon-3 infrastructure early** (no marketplace, billing, or multi-tenant control plane) **while not precluding it**. Open tension (owner to resolve): STRATEGY.md leans managed-retainer default, the older decision log has clients owning ops (self-hosted handoff); the architecture supports both, the commercial default is TBD.

## Vision components → checkable end-state

Each vision component mapped to what exists today → the delta work orders → a checkable end-state. If every end-state below passes, the vision is delivered; anything not listed is out of scope for this epic. Work orders link into [`work/`](work/).

| # | Vision component | Exists today | Delta (work orders) | Checkable end-state |
|---|---|---|---|---|
| 1 | **Headless agent** — pure config object, no fs/bash/HTTP/React | Transport-agnostic harness seam exists but only via Fastify; config sprawls across env vars + file discovery | [P0](work/P0-adr/) → [P1](work/P1-headless-core/) | `createAgent({ runtime: 'none' })` runs a full turn in a plain Node script with zero Fastify/boring-bash imports; all current HTTP consumers unchanged |
| 2 | **Multi-fs** — governed named filesystems attached per agent/session | **Landed (#416)**: `FilesystemBinding`, `user` + readonly `company_context`, no-leak conformance | [E1](work/E1-environment-attachments/) (generalized `Environment`/attachments, scoped views, symlink hardening) → [P4](work/P4-file-ui/) (file UI move) | An agent holds ≥2 filesystems with distinct identities; a scoped view passes the symlink-escape test; company_context no-leak stays green |
| 3 | **Flexible sandbox** — swappable exec providers, honest capabilities | direct/bwrap/vercel-sandbox behind `Sandbox`/`RuntimeBundle`, inside `packages/agent`, static capability claims | [P2](work/P2-sandbox-providers/) (providers → `@hachej/boring-sandbox`; `resolveMode` → boring-bash; capabilities `reported\|unknown`) → [P5](work/P5-provisioning-secrets/) (provisioning, secret brokering) | Provider swap needs no agent-package change; acyclic layering; a test proves no brokered secret is readable inside a sandbox; remote-worker capabilities only from handshake |
| 4 | **External agent access** — any MCP client mounts an environment | None (MCP used client-side only) | [E2](work/E2-mcp-projection/) (MCP projection, token→`BoundFilesystemContext`) | An external MCP client mounts a boring environment; denied files absent over MCP; no-leak suite green on the MCP mount |
| 5 | **Flue building blocks** — durable replayable streams + channels-for-free | Bespoke replay (`PiChatReplayBuffer` + `?cursor=` NDJSON); no channel adapters | [T1](work/T1-durable-events/) (DS protocol: SQLite `EventStreamStore` + approvals-on-stream) → [T2](work/T2-transport/) (transport contract, front refit) → [S1](work/S1-slack-channel/) (Slack via `@flue/slack`) | SSE drop reconnects losslessly by `offset`; an approval raised in one client is answered from another; a Slack thread and the workspace UI share one agent + session store |
| 6 | **eve UX — workspace as control plane** | Partial: `SessionList`/search, `DebugDrawer`, ask-user UI, model pickers. No agent registry, no cross-surface view, no unified approvals | [P6](work/P6-plugin-child-app/) (`AgentRegistry`, plugin/child-app scoping) → [P7](work/P7-multi-agent-inspection/) (agentId routing + public agent list + `/info`) → [S3](work/S3-control-plane-ux/) (inspect + cross-surface sessions + approval inbox) | Workspace lists agents from the scrubbed agent-list endpoint and inspects each through `/info`; a Slack-born session is observable by `sessionId`; a pending approval from any surface is answerable from the workspace inbox |
| 7 | **Embeds** — agent inside another product (pi-excel) | None | [S2](work/S2-embed-contract/) (embed contract, host-supplied domain tools, `runtime: 'none'`) | The reference embed runs with zero boring-bash dependency; host tools render; approvals work via the host dialog |
| 8 | **EU-sovereign hosting** | Implicitly true but unstated | Invariant 15 enforced across every work order | Default stack deploys on EU infra with no US-hosted hard dependency; `vercel-sandbox` is optional |
| — | **S3/FUSE mounts** — object-store-backed environments (farm substrate) | None | [X1](work/X1-s3-fuse-mounts/) (S3 prefix as a real directory in a sandbox; needs P2+P5) | A readonly S3 mount passes the no-leak suite; `bash`-visible == file-route-visible over the mount; no credential readable inside the sandbox; EU-endpoint matrix green |
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
- **Package deferral:** extract `boring-artifact` only when a second consumer appears: S2 embed, Slack link-out, or customer review page.
  PR #424's public workspace Markdown share is explicitly **non-artifact**;
  lessons reserved here: tokens address `artifactId+version+capability`,
  publish snapshots rather than live workspace paths, assets are captured into
  a manifest, viewer/editor separation is mandatory, and downloads are kind metadata.

## Architecture at a glance

**Five clean layers** (v2 extends the original three):

```txt
Surfaces         workspace UI | Slack | pi-excel | CLI — ingress/egress adapters only
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

1. **Message in** — a normalized user turn `AgentSendInput = { sessionId?, content, attachments?, actor, ctx?, originSurface? }` (omit `sessionId` to create a session). `ctx?: SessionCtx` is boring's own tenancy context, never surface-native addressing.
2. **Event stream out** — one ordered, indexed, replayable stream of typed events; wire/transport swappable.
3. **Approvals / HITL** — a request event out + a response call in, on the same channel, declared on the tool — not per-surface special cases.
4. **Session state** — a runtime-owned `sessionId` + serializable transcript; persistence and addressing are boundary decisions.

## Decisions locked (one line each)

Full text and rationale: [`architecture/08-pluggable-agent-surfaces.md`](architecture/08-pluggable-agent-surfaces.md) "Decisions this file locks", ratified in the Phase 0 ADR ([P0](work/P0-adr/)).

1. **Wire protocol** — keep `PiChatEvent` as the v1 payload, add the indexed envelope; no parallel event union.
2. **Pure mode** — pi-coding-agent with `runtime: none` + sealed cwd behind the Phase 1 audit, not a second harness.
3. **Surfaces outside the agent package** — per-channel packages (Flue model), not `boring-agent` subpaths.
4. **Readonly fs is v1** — already shipped via #416.
5. **One namespace rule** — superseded by named `(filesystem, path)` bindings.
6. **Channel ingress is reused, not written** — depend on pinned `@flue/*` packages with thin adapters; egress via provider SDKs.
7. **Environments are attachable resources** — fs+sandbox has identity independent of any agent; consumed via attachments; external agents attach via MCP projection ([09](architecture/09-environments-attachable.md)).
8. **Front chat provider unchanged** — vendored ai-elements fork insulated from the wire by the `PiChatEvent → reducer → BoringChatMessage` projection; T2 forces zero render-layer work.
9. **No feature-flag framework** — version rides existing carriers (`AgentEvent.v`, additive DS routes, injectable front transport, minor bumps at T2/P3).
10. **No retro-compat, no speculative abstraction** — importers migrate in the same PR; transitional code carries `TODO(remove:<bead-id>)` naming its deletion-owner bead; a later TODO owner is allowed only when explicitly named per [`INDEX.md`](INDEX.md); no abstraction without two real consumers.
11. **Three-package runtime stack** — concrete providers live in `@hachej/boring-sandbox`, not boring-bash subpaths; acyclic layering as above.

## Explicitly deferred (do not build in this epic)

- **Agent-as-directory authoring** (eve `defineAgent` file conventions) — unblocked after P7's `AgentRegistry`; file a dedicated issue at P8.
- **`FileTreeDataProvider` boundary** — until #295 is scheduled.
- **Document-authority write/edit override seam** — zero real consumers; arrives with #367/#226 (filed at P8).
- **Subagent environment grants** — first consumer lands in P7 (kept minimal there).
- **Durable turn continuation (WaitingTurn machine)** — restart-resume is new-turn-seeded by design (T1).
- **Remote-worker-as-environment-transport** — remote-worker stays a provider; reclassification filed at P8.
- **P6b child-app / Macro scoping** — HARD BLOCKED on the shared child-app platform type (#376); a tracked follow-up outside the epic exit.

## Dispatch order (summary)

```txt
P0 → P1 → { T1 → T2 → { S1 → S2, S3 } } ∥ { P2 → P3 → [ P4, E1 → E2, P5 → P6a → P7 → [P8, S3] ] } ∥ { X1 (needs P2+P5) }
```

Rows 1→5 are infrastructure (three parallel lanes after P1); rows 6–7 are product payoff and gate on the lanes; row 8 is a standing constraint, not a phase. P5 dispatches off P3 in parallel with P4 and E1→E2. P8 gates on **all** lanes except P6b. The authoritative phase table, dependency graph, dispatch protocol, and binding policies are in [`INDEX.md`](INDEX.md).
