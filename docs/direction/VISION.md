# VISION — the living cross-issue vision

Canonical home of the product vision. Sequencing authority is
[`DIRECTION.md`](DIRECTION.md); rolling completion status is
[`STATE.md`](STATE.md). The #391 plan pack keeps its own frozen scope summary
at [`../issues/391/runtime-refactor/VISION.md`](../issues/391/runtime-refactor/VISION.md);
execution detail (work orders, dispatch order, PR plans) lives there and in
issue plan folders, not here. Hoisted 2026-08-08 from the #391 plan pack
(pre-#889 business content + post-#889 D28 north star); content unchanged in
substance, trimmed of per-work-order execution detail.

## North star

**eve-style DECLARATIVE authoring that ships agents fast, natively integrated
into the boring-ui FARM, open to foreign agents.** An eve-class UX — author an
agent, deploy it, converse with it from any channel, inspect it — steered from
the boring-ui workspace and hosted in Europe:

- **Declarative authoring (ship agents fast):** an agent definition compiles to
  a self-contained versioned unit; local dev and production consume the same
  artifact through an authorized workspace host. No platform-source edits or
  imperative per-agent wiring.
- **The boring-ui FARM, natively integrated:** the workspace is the farm
  control plane — fleet view, tasks, artifacts, approvals in one inbox.
- **OPEN integration:** a non-boring agent (Claude Code, Codex, any MCP client)
  can attach an environment and — later — create tasks, publish artifacts, and
  request human input over a control plane.
- **PLUGIN-extensible host product:** both the workspace UI and the agents in
  it are extensible by third parties over real APIs.
- **EU-sovereign hosting:** default stack deploys on EU infra with no US-hosted
  hard dependency.

Under Decision 28 this concretizes as: a developer defines service-shaped
Agent applications, installs a trusted static fleet in app or CLI
configuration, and Workspace orchestrates them over one governed Environment
API. Core/web and CLI remain independent Workspace consumers; a future remote
adapter changes transport, not semantic contracts.

## Business horizons

These frame *what the architecture must not preclude*, not current build scope.

- **Horizon 1 — now, services-led.** Named vertical agents (**Engagement
  Analyst** — sovereign deck+model agent for consulting boutiques;
  **MacroAnalyst** — sovereign macro/investment-research agent) share one EU
  deployment while isolated by authorized workspace/default-agent bindings. A
  dedicated sovereign VM is the second topology, managed or self-host handoff.
  The **farm is INTERNAL leverage** here — the factory that delivers client
  work, not a product sold to clients.
- **Horizon 2 — post 3+ repeats.** After the SSO/governance/workroom pattern
  recurs across 3+ deployments, productize a white-label **"AI Analyst
  Workroom"** for consultancies/fiduciaries to resell; the farm becomes
  client-facing.
- **Horizon 3 — 2027+.** Hub-and-spoke: a free local CLI ⇄ hosted specialist
  agents via MCP delegation, artifacts delivered cross-org. The
  open-integration end state, not a near-term build.

**Architecture rule: one deployable artifact; topology is the product line.**
The same build runs single-tenant self-host, managed sovereign tenant, shared
subdomain tenant, or hub-and-spoke — topology is a commercial choice, not a
code fork. Do not force Horizon-3 infrastructure early (no marketplace or
billing machinery) while not precluding it.

GTM detail (motions, ICP, pricing, call kits):
[`../issues/809/runtime-refactor/GTM-STRATEGY.md`](../issues/809/runtime-refactor/GTM-STRATEGY.md)
and [`../issues/809/runtime-refactor/MARKETPLACE-PATH.md`](../issues/809/runtime-refactor/MARKETPLACE-PATH.md).

## Vision components

The checkable end-state per component. Live merged/partial/missing status per
component is tracked in [`STATE.md`](STATE.md), not here.

| # | Vision component | Checkable end-state |
|---|---|---|
| 1 | **Environment-independent agent core** — injected harness/tools/sessions, no server-framework dependency | The core closure is runtime-package independent and composes deterministically inside an authorized workspace host |
| 2 | **Multi-fs** — governed named filesystems attached per agent/session | An agent holds ≥2 filesystems with distinct identities; scoped views pass symlink-escape tests; readonly knowledge fs stays no-leak |
| 3 | **Flexible sandbox** — swappable exec providers, honest capabilities | Provider swap needs no agent-package change; no brokered secret readable inside a sandbox; capabilities reported, never assumed |
| 4 | **External MCP consumption and artifact delivery** | A stock MCP client submits a bounded brief through workspace/deployment authority and receives a complete immutable artifact in its authorized workspace |
| 5 | **Durable replayable streams and transport substrate** | SSE drop reconnects losslessly by offset; an approval raised in one client is answerable from another over shared transport |
| 6 | **Workspace as control plane (eve UX)** | Workspace lists and inspects agents; external-surface sessions observable by sessionId; pending approvals from any surface answerable from the workspace inbox |
| 7 | **Multi-agent EU deployment** | One host runs ≥2 distinct deployed agents mapped to authorized workspaces/defaults; each exact hostname reaches the correct landing/auth/workspace/agent; the host collection rolls back without platform-source edits |
| 8 | **EU-sovereign hosting** | Default stack deploys on EU infra with no US-hosted hard dependency |
| 9 | **The farm** (deferred epic) | A foreign agent creates a task, works it in a mounted env, publishes an artifact, requests approval — all visible in the workspace |

> **Business line (farm row):** the farm is Horizon-1 INTERNAL leverage; it
> becomes client-facing at Horizon 2 and hub-and-spoke at Horizon 3.

## Amendments

Amend by dated addendum via owner-gated PR; never rewrite ratified sections.
Proposed amendments queue inside the current dated snapshot under
[`state/`](state/) until ratified here.
