> **Roadmap status:** retained research; non-dispatchable.**
> Decision 26 recut is required in the owning GitHub issue and Bead graph before
> implementation; stale Decision 25 or AgentHost/D1 ordering has no authority.

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

This is the phase roadmap from the verified 2026-07-12 baseline to that scenario
working end-to-end. It does not change ordering inside any phase already
sequenced in [INDEX.md](../../391/runtime-refactor/INDEX.md) — it only names the phases and slots the
three new gap-identified workpackages (BL1, MK1, CH1) plus the S4 revival
into where they land.

## Current execution baseline (2026-07-12)

P1 readiness landed via [#642](https://github.com/hachej/boring-ui/pull/642).
M1 landed via [#650](https://github.com/hachej/boring-ui/pull/650), superseding
the closed [#549](https://github.com/hachej/boring-ui/pull/549)/
[#556](https://github.com/hachej/boring-ui/pull/556) stack. D1-004a1 landed via
[#684](https://github.com/hachej/boring-ui/pull/684); D1-004a2 landed via
[#685](https://github.com/hachej/boring-ui/pull/685), canonical ingress landed
via [#690](https://github.com/hachej/boring-ui/pull/690), and trusted host scope
landed via [#692](https://github.com/hachej/boring-ui/pull/692). D1-004a4a is
landed via [#694](https://github.com/hachej/boring-ui/pull/694), and D1-004a4b
landed via [#695](https://github.com/hachej/boring-ui/pull/695), and D1-004b1
landed via [#698](https://github.com/hachej/boring-ui/pull/698), and the atomic
owner guards landed via [#700](https://github.com/hachej/boring-ui/pull/700)/
[#701](https://github.com/hachej/boring-ui/pull/701). D1-004c1-c5 landed via
[#704](https://github.com/hachej/boring-ui/pull/704),
[#705](https://github.com/hachej/boring-ui/pull/705),
[#708](https://github.com/hachej/boring-ui/pull/708),
[#711](https://github.com/hachej/boring-ui/pull/711), and
[#713](https://github.com/hachej/boring-ui/pull/713); D1-004d1 is active;
the AR1 Lane W share-entry/deep-link/resource slices are next after priority 1.

## Phase 2 — Factory v1

[P6-R](../../805/runtime-refactor/work/P6-plugin-child-app/PLAN.md) → [D1](../../391/runtime-refactor/work/D1-tenant-provisioning/PLAN.md)
docker multi-agent host (+ P5a slices) → [P8](../../805/runtime-refactor/work/P8-verification/PLAN.md) slice.

**Outcome:** N agents hosted in owner prod, mapped to workspaces.

## Phase 3 — External consumption = marketplace MVP

[M1](../../806/runtime-refactor/work/M1-mcp-managed-agent/PLAN.md) landed via
[#650](https://github.com/hachej/boring-ui/pull/650) (superseding the closed
#549/#556 stack) → [AR1](../../806/runtime-refactor/work/AR1-shareable-artifacts/PLAN.md) Lane W next
after priority 1 → M2/E2 recuts. This first
authenticated tracer uses M1's existing bearer/membership seam.

Public marketplace promotion then adds
[ID1](work/ID1-agent-identity/PLAN.md) +
[AC1](work/AC1-agent-consumption-contract/PLAN.md) contracted mode/projections;
neither widens or gates the cold-start P6-R slice.

**Outcome:** first, an authenticated external consumer receives an artifact in
its authorized workspace. With ID1 + AC1 promoted, a new user signs up via its
own ChatGPT, contracts an agent, and runs the fitness story end-to-end,
MCP-only and unbilled.

## Phase 4 — Marketplace mechanics

[BL1](work/BL1-engagement-billing/PLAN.md) + [MK1](work/MK1-agent-catalog/PLAN.md)
+ contractor-data-hygiene policy (the known-unknown recorded in
[Decision 22](../../../DECISIONS.md#22-one-agent-consumption-contract-protocol-bindings-at-the-edges)
triggers here — a persistent contractor workspace mixing customer A's
learnings into work for customer B needs a policy once external contracting
opens).

**Outcome:** creators earn.

## Phase 5 — Reach & self-serve

[T1](../../807/runtime-refactor/work/T1-durable-events/PLAN.md)/[T2](../../807/runtime-refactor/work/T2-transport/PLAN.md) →
[CH1](work/CH1-consumer-channels/PLAN.md) (Telegram before WhatsApp) →
[S4](work/S4-agent-onboarding/PLAN.md) revival (creator self-serve authoring)
→ A2A external binding when partner orgs appear (Decision 22's future
binding, activated only when an external org needs multi-turn task-driving
against hosted agents).

**Outcome:** coach-in-your-pocket, and creators onboard themselves.

## Delta honesty

Phases 1–3 use the existing sequenced workpackages and reserved AC1/ID1/AR1
packages. The marketplace review added only BL1, MK1, CH1 plus an S4 revival.
No new cold-start architecture: Decision 22 held under the grill (see
[REVIEW-2026-07-11-unknowns.md](../../391/runtime-refactor/REVIEW-2026-07-11-unknowns.md) for the
grilling record). BL1 is a decorator on the existing metering seam, MK1 is
static profile pages over existing `AgentDefinition` metadata, CH1 is two
more bindings of the one consumption contract — no new consumption pipeline,
no new ACL system, no fork.
