# Path to the contracting-platform vision (owner-approved 2026-07-11)

**Canonical scenario:** a fitness influencer distributes their knowledge as a
contracted agent; a consumer contracts coaches from their own workspace via
ChatGPT (MCP), WhatsApp, or Telegram; projections go in, artifacts come back,
invoices go out. Full worked example: see the
[AC1 PLAN.md scenario section](work/AC1-agent-consumption-contract/PLAN.md#scenario-creatorcoach-marketplace-canonical-worked-example-owner-2026-07-11).

## Owner ruling (2026-07-11)

- **Revenue path now: B2B** — managed agents + custom workspaces for clients.
  Phases 1–3 serve this directly; phase 3 doubles as the client demo.
- **Marketplace is LATER and demand-gated:** phases 4–5 stay sequenced but
  unstaffed until factory revenue or a flagship creator forces them.
- **Build discipline: get the FUNDAMENTALS marketplace-ready in phases 1–3**
  so adding the marketplace later is only adding discoverability (MK1) —
  concretely: engagement/task records keep actor + provenance + metering
  identity (Decision 22 spec items); `AgentDefinition` keeps presentation
  metadata (name/creator/description); bundles stay digest-pinned so creator
  updates flow via deployment promotion; contracted mode stays a layered
  decorator (no fork).
- **Consequence:** BL1 pricing/merchant-of-record, MK1 catalog shape, and CH1
  channel order are deferred DECISIONS, not deferred fundamentals — no
  further owner input needed until their phase opens.

This is the phase roadmap from where #391 stands today to that scenario
working end-to-end. It does not change ordering inside any phase already
sequenced in [INDEX.md](INDEX.md) — it only names the phases and slots the
three new gap-identified workpackages (BL1, MK1, CH1) plus the S4 revival
into where they land.

## Phase 1 — Now

[#631](https://github.com/hachej/boring-ui/pull/631) + P1 recut (running).

## Phase 2 — Factory v1

[P6-R](work/P6-plugin-child-app/PLAN.md) (+ AC1 types) → [D1](work/D1-tenant-provisioning/PLAN.md)
docker multi-agent host (+ P5a slices) → [P8](work/P8-verification/PLAN.md) slice.

**Outcome:** N agents hosted in owner prod, mapped to workspaces.

## Phase 3 — External consumption = marketplace MVP

[M1](work/M1-mcp-managed-agent/PLAN.md) recuts
([#549](https://github.com/hachej/boring-ui/pull/549)/[#556](https://github.com/hachej/boring-ui/pull/556))
→ [ID1](work/ID1-agent-identity/PLAN.md) → [AR1](work/AR1-shareable-artifacts/PLAN.md)
+ [AC1](work/AC1-agent-consumption-contract/PLAN.md) contracted mode/projections.

**Outcome:** an external user signs up via their own ChatGPT (MCP), contracts
an agent, receives artifacts. The fitness story works end-to-end, MCP-only,
unbilled.

## Phase 4 — Marketplace mechanics

[BL1](work/BL1-engagement-billing/PLAN.md) + [MK1](work/MK1-agent-catalog/PLAN.md)
+ contractor-data-hygiene policy (the known-unknown recorded in
[Decision 22](../../../DECISIONS.md#22-one-agent-consumption-contract-protocol-bindings-at-the-edges)
triggers here — a persistent contractor workspace mixing customer A's
learnings into work for customer B needs a policy once external contracting
opens).

**Outcome:** creators earn.

## Phase 5 — Reach & self-serve

[T1](work/T1-durable-events/PLAN.md)/[T2](work/T2-transport/PLAN.md) →
[CH1](work/CH1-consumer-channels/PLAN.md) (Telegram before WhatsApp) →
[S4](work/S4-agent-onboarding/PLAN.md) revival (creator self-serve authoring)
→ A2A external binding when partner orgs appear (Decision 22's future
binding, activated only when an external org needs multi-turn task-driving
against hosted agents).

**Outcome:** coach-in-your-pocket, and creators onboard themselves.

## Delta honesty

Phases 1–3 are entirely existing sequenced workpackages — nothing new. The
marketplace vision added only three workpackages (BL1, MK1, CH1) plus an S4
revival. No architectural changes: Decision 22 held under the grill (see
[REVIEW-2026-07-11-unknowns.md](REVIEW-2026-07-11-unknowns.md) for the
grilling record). BL1 is a decorator on the existing metering seam, MK1 is
static profile pages over existing `AgentDefinition` metadata, CH1 is two
more bindings of the one consumption contract — no new consumption pipeline,
no new ACL system, no fork.
