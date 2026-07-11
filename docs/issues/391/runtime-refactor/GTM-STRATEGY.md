# GTM Strategy — boring agent factory

Drafted 2026-07-11 (Fable final session). Companion to MARKETPLACE-PATH.md
(owner ruling: B2B revenue now, marketplace demand-gated) and
FABLE-FINAL-REVIEW Part 1. These are strategies to run, measure, and kill —
not commitments.

## Positioning

**"Your agents, your data, EU-hosted."** boring is the system of record for
agentic work: agents are compiled artifacts, workspaces are the durable vault
of context and results, governance and audit are built in, and no US-hosted
dependency is required. Model-neutral by construction.

- Against DIY (LangChain/agent frameworks): you ship an operated product in
  days, not an internal platform project in quarters.
- Against US platforms (GPTs/Claude connectors/Copilot): sovereignty,
  governance, workspace persistence, and the ability to switch models.
- Against agencies: the retainer includes a running system, not a report.

## ICP (initial)

EU mid-market companies (20–500 FTE) with document/ops-heavy workflows —
finance/legal/compliance-adjacent, professional services, industrial back
office — plus the consultancies that serve them. Buyer: COO/Head of Ops/CTO.
Compliance sensitivity is a qualifier, not a blocker.

## Motion 1 — Lighthouse retainers (NOW; fits the 1–2h/day operating mode)

1. Outreach (existing LGM machinery) with ONE artifact: a recorded
   **golden-path demo**. The ≤ 15-minute build-and-deploy claim is GATED on
   P8's recorded evidence — until golden-path.json exists, demos show a
   pre-built agent walkthrough and make no live-build promise. The P8 timing
   bead is therefore GTM-critical, not engineering vanity.
2. Offer: free 30-min call where THEIR workflow becomes a running agent in
   their own workspace before the call ends.
3. Convert to a 4–6 week paid pilot (fixed fee) → managed retainer.
4. Cap: 3 concurrent lighthouse clients. Each phase of the build plan must
   have a named lighthouse consumer; no client, no phase.

## Motion 2 — Sovereignty wedge (parallel, messaging-level)

Target sectors where "EU-only processing" shortcuts procurement: legal,
health-adjacent admin, public-sector suppliers. Content: one page per
sector — "what an EU-sovereign agent setup looks like", the dedicated-VM
variant (Decision 23 variant 2) as the premium tier. No code work required;
this is FUTURE packaging, conditional on D1 landing and the runsc EU
validation spike proving the isolation claims (#628 is not productionReady
yet) — write the one-pagers, date the availability honestly.

## Motion 3 — Demo-as-content flywheel (cheap, compounding)

Every lighthouse build produces: a recorded golden-path run, an anonymized
template agent, a short writeup. Templates accumulate into a gallery —
which quietly becomes MK1's seed catalog the day the marketplace opens.
Distribution: LinkedIn (founder-led), the LGM outreach sequences.

## Motion 4 — Creator-led marketplace pilot (LATER; demand-gated)

Per owner ruling: only when factory revenue or a flagship creator forces it.
The cold-start is creator-led: ONE flagship creator (e.g. fitness) with an
engaged audience, revenue-share deal, their channel (Telegram first — CH1)
as the distribution. The catalog (MK1) follows the audience, never precedes
it. Success = first paid consumer conversation, not listings count.

## Motion 5 — Vertical agent products (STRONG candidate; owner-sparked 2026-07-11)

Ship named niche agents as products, not services: e.g. the **accounting
pre-close agent** (fetch/categorize invoices, prep VAT for expert-comptables)
or the **insurance-comparison agent**. Decision 23 already gives every
deployed agent an exact hostname — each vertical agent gets a product
storefront (`agent-x.domain.eu`) with zero new infrastructure. The factory
becomes the backend story; the vertical agent is what the market sees and
searches for. Selection matrix (pick ≤ 2): document-heavy repetitive
workflow · reachable niche community · EU/French regulatory angle · owner
domain proximity. Accounting scores highest (data background, reachable
networks, sovereignty synergy); the **analytics agent** (on the client's
existing warehouse/dbt stack — the owner's unfair-authority vertical) is a
strong second; insurance third (higher search demand, sharper
regulated-advice liability). Pricing: per-workspace monthly, plus a
free budget-capped lead-magnet tier (caps only — no feature-flag system).

## Motion 2b — Expert-in-a-box (the realistic creator wedge)

The first creators are not influencers; they are **B2B niche experts** (RGPD
consultant, tax advisor, HR compliance) with existing paying audiences and
B2B price tolerance. Their methodology ships as a contracted agent
(rev-share); the golden path is their onboarding ("your expertise, running
as an agent, in one afternoon"); their channel is the distribution.

**Convergence law:** every vertical agent (M5) and expert agent (M2b) is
simultaneously a template in the future MK1 catalog — the marketplace
cold-start solves itself as a by-product of revenue work. Do not build
catalog features for this; just keep AgentDefinition presentation metadata
complete.

## Motion 6 — MCP connector directories as app stores (post-ID1)

Stock-client connector directories (Claude, ChatGPT) are opening. Each
vertical agent listed there is free niche distribution with a first-mover
window ("the accounting agent" in the directory before anyone else). The
MCP-first architecture makes listing nearly free once ID1 exists. Zero build
beyond ID1; pure packaging + submission work.

## Motion 7 — The audit trojan (zero build)

Paid "where do agents fit in your company" discovery engagements, delivered
AS a boring workspace: findings, transcripts, and prototype agents live in
the client's workspace from day one. The deliverable onboards the client
into the product; the upsell is turning one finding into a running agent.

**Demo-door note (Motion 1 correction):** lead lighthouse demos with the web
UI — MCP connector setup is still fiddly for non-technical buyers. "It's
also in your ChatGPT" is the closer, not the opener.

## Pricing placeholder (reversible; owner may override)

- **Setup per agent** (authoring + deployment): fixed fee.
- **Managed retainer per hosted agent-workspace / month**: includes hosting,
  governance, updates. LLM usage passed through at cost + margin.
- **Dedicated VM variant**: infrastructure premium on top.
- Marketplace era (later): per-engagement pricing set by creator, platform
  take-rate — decision deferred with BL1.

## Metrics that matter (weekly)

demos recorded · demo→pilot conversion · time-to-new-agent (golden path) ·
retainer MRR · agents live per host · churned agents. Ignore vanity counts
(signups, stars) until Motion 4 opens.

## Kill criteria

Any motion that produces zero pilots in 6 weeks of honest effort gets
rewritten or killed at the weekly review — motions are experiments, the
vault and the factory are the constants.
