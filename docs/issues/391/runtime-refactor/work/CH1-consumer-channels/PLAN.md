# CH1-consumer-channels — Plan

Status: gap identified — not started.

> Phase: Phase CH1 — consumer messaging channels (marketplace path, phase 5)
> Ordering authority: [INDEX.md](../../INDEX.md) · Vision: [VISION.md](../../VISION.md) ·
> Roadmap: [MARKETPLACE-PATH.md](../../MARKETPLACE-PATH.md)

## Goal

Consumer messaging channels as bindings of the [Decision 22](../../../../../DECISIONS.md#22-one-agent-consumption-contract-protocol-bindings-at-the-edges)
contract: Telegram first (simple bot API), WhatsApp Business second.

## Scope

- Channel adapters speak the same task/`contextId`/`input-required` contract
  as every other binding (UI, MCP, HTTP API, CLI, native internal) — no
  channel-specific agent logic.
- **Telegram** — first channel; simple bot API, lowest integration cost.
- **WhatsApp Business** — second channel; needs an approval/cost spike bead
  before implementation. Recorded here as an open spike, not committed scope:
  WhatsApp Business API access requires Meta business verification and has
  per-conversation costs that need sizing before a build decision.

## Out of scope

Slack remains out of #391 scope (see
[S1-slack-channel/PLAN.md](../S1-slack-channel/PLAN.md) — relocated to a
separate flue-channel story).

## Dependencies

- [T1](../T1-durable-events/PLAN.md) completion — durable event admission the
  channel adapters need for reconnect/replay.
- [T2](../T2-transport/PLAN.md) — the transport contract channel adapters
  bind to.
- [arch-08 surfaces](../../architecture/08-pluggable-agent-surfaces.md) — the
  pluggable-surface contract channel adapters must conform to.

## Exit (to be specified in beads)

A consumer reaches a contracted agent over Telegram using the same
task/`contextId`/`input-required` contract as every other binding, with no
channel-specific agent logic. WhatsApp Business ships only after its spike
bead resolves the approval/cost question.
