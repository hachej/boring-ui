# AC1-agent-consumption-contract — Plan

Status: decision settled ([DECISIONS.md #22](../../../../DECISIONS.md#22-one-agent-consumption-contract-protocol-bindings-at-the-edges))
— canonical tracker is issue
[#636](https://github.com/hachej/boring-ui/issues/636). Bead enumeration
(guardrails + build pointers in
[IMPLEMENTATION-GUARDRAILS.md](../../IMPLEMENTATION-GUARDRAILS.md) AC1 section):

- **AC1-T — contract types.** Task/Message/Part, `contextId`,
  `input-required`, versioned schema in the contracts layer. **LANDED
  ([#657](https://github.com/hachej/boring-ui/pull/657), types-only slice).**
- **AC1-D — in-process subagent dispatcher.** Reuses pi session machinery for
  the loop and T1's event store if durability is needed; guards REQUIRED
  (values ratified in the AC1 consumer-backed spec, not here): consumption
  depth limit, same-pair cycle refusal, input-required timeout → canceled
  (resumable context).
- **AC1-M — consumption modes.** `AgentDefinition` workspace-binding
  parameter (subagent = caller workspace); contracted mode is a layered
  decorator over the same pipeline, never a forked code path (Decision 22
  layering constraint) — gated behind ID1, not built before a real
  contracting consumer exists.
- **AC1-P — governed-projection brief.** Generalize boring-governance's
  existing `filesystemBindings` readonly-projection mechanism (today
  hardcoded to `company_context`) to arbitrary source workspaces.

The issue owns further scope detail; do not build a task queue/broker, A2A
wire transport, or persistence beyond existing stores (guardrails "Do NOT
build").

> Phase: Phase AC1 — marketplace consumption contract (separate from P6-R;
> contracted mode after ID1)
> Ordering authority: [INDEX.md](../../INDEX.md) · Vision: [VISION.md](../../VISION.md)

## Goal

Implement Decision 22: one A2A-shaped consumption contract; bindings
UI / MCP / HTTP API / CLI / native-internal / A2A-future; subagent vs
contracted consumption modes; governed-projection context flow.

## Scope (detail in issue #636)

1. Contract types in the contracts layer — task lifecycle incl.
   `input-required`, `contextId`, messages/parts, artifacts.
2. Native internal binding via resolver (agent A consumes agent B two-way).
3. Consumption modes in `AgentDefinition`: subagent (caller workspace) /
   contracted (own workspace).
4. Governed-projection briefs — generalize boring-governance
   `filesystemBindings` readonly projection to arbitrary source workspaces.
5. Spec items: `input-required` timeouts, cycle/depth guards, actor audit
   model, schema versioning.

## Sequencing

- P6-R stays frozen and narrow. Issue #636 owns a separate contract-types
  micro-PR after the cold-start resolver; no AC1 type lands inside BBP6-011.
- Subagent mode near M1.
- Contracted mode + projections gated behind ID1.

## Dependencies

- P1 / P6-R — stable runtime and deployment seams the later contract binds to,
  not implementation owners for AC1.
- [ID1](../ID1-agent-identity/PLAN.md) — gates the contracted mode (external
  consumers are regular principals + workspaces).

**Layering constraint (Decision 22):** subagent and contracted modes are layers over ONE consumption pipeline (workspace-binding parameter + governance projection + metering) — never forked code paths. MCP is a door, not a distribution vector; external third parties contract agents from their own signed-up workspace.

## Scenario: creator/coach marketplace (canonical worked example, owner 2026-07-11)

A fitness influencer distributes their knowledge as an agent (AgentDefinition; contracted mode; own workspace holds programs/methods, compounding across clients). A consumer signs up via any door (ID1), gets a personal workspace that becomes their persistent fitness journal, and contracts one or more influencer agents from there — via their own ChatGPT (MCP binding), WhatsApp, or Telegram (T2/arch-08 channel bindings; same contract). Each coach receives governed projections of the consumer's data (e.g. training log only), asks follow-ups via input-required, returns plans as artifacts (AR1 links). The influencer invoices through the metering/billing layer. Validates: ID1, AR1, AC1 contracted mode, channels, billing — with zero architecture not already decided. Stress note: for B2C consumers, WhatsApp/Telegram channels and billing are product-critical, not optional.
