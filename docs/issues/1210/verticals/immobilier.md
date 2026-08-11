# Vertical stub — Immobilier / régies (RESEARCHED)

Bead: `wt-391-forward-vertical-agents-epic-nfgt.3` · Status: **RESEARCHED** (strongest challenger to the pilot) · Epic: `…epic-nfgt`
Source: [`../plan.md`](../plan.md) §The high-value verticals. GitHub #1210.

**Vertical = configuration over the shared machinery.** But note: a compliant v1
here is a *different product shape* from renovation because the obvious FIND is
criminally sanctioned (see Legal) — the config, not the code, absorbs that.

## Today / Delta

**Today.** Economics dwarf a bathroom: 2-3% commission (typically 3% in
Romandie) on a ~CHF 1.27M median single-family house = **CHF 25-40k gross per
closed deal**. Large fragmented market (~22,400 brokerage/management firms, 43%
with 5-9 staff; ~85% of sales still broker-led). Portal leads arrive **by email**
— exactly our ingest shape. **No Swiss incumbent** found doing instant
auto-response / SLA routing / buyer-book matching (Immomig, Casasoft, RealAdvisor,
PriceHubble own the plumbing, not the orchestration).

**Delta.** (1) Decide the compliant FIND design (human-sends / postal /
inbound-opt-in) — this is the gating decision. (2) Build the config bundle. (3)
Wire portal-email inbound ingest. (4) Sequence adjacent to trades later to
exploit the régie↔trades network effect. Do **not** start here — start with the
easier pilot (plan).

## The 5-element kit

1. **Persona** — FR (Romandie) régie / courtier voice; mandate + listing-yield
   vocabulary.
2. **Knowledge corpus** — winning listing presentations, buyer-matching playbook,
   SLA-response templates. *To build.*
3. **Vertical LP** — opening line "raise the yield on the listing you already
   paid for" (brokers publicly angry at SMG portal price rises).
4. **Customer-LP template** — broker/régie site with instant-response lead
   capture feeding RESPOND.
5. **Signal filters** — region = Romandie small-firm tail; time-on-market
   (publicly derivable from listing age, ~79 days houses / ~84 condos) as a
   clean targeting signal that touches **no** restricted data.

## Four-verbs config

| Verb | Applies? | Config |
| --- | --- | --- |
| **FIND** | **Legally constrained** | Mandate prospecting = contacting private sellers who never asked = B2C cold, UWG art. 3(1)(o)/3(1)(u). Must be **human-sends / postal / inbound-opt-in by design**. Time-on-market signal is clean; portal contact-data reuse is **not**. |
| **BID** | Yes | Draft mandate pitch / listing proposal. |
| **RESPOND** | **Clean & primary** | Instant auto-response to inbound portal-email leads + SLA routing. This is the defensible wedge. |
| **FOLLOW-UP** | Clean | Chase, buyer-book matching alerts, dormant reactivation. |

## Legal

UWG art. 3(1)(o) + 2021 art. 3(1)(u) **criminally sanction** mandate cold-outreach
(B2C). Swiss Marketplace Group (homegate, ImmoScout24, anibis, tutti) ToS **ban
scraping** and reuse of ad contact data for own advertising. → A real-estate v1
must be human-sends / postal / inbound-opt-in **by design**. régie↔trades network
effect is real but contested (casavi/relay, Mobiliar dispatch); open slice =
Romandie + small-firm tail. (Plan §9, §high-value verticals.)
