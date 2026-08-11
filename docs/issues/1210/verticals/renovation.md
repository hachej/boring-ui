# Vertical stub — Kitchen & bath renovation, Romandie (PILOT)

Bead: `wt-391-forward-vertical-agents-epic-nfgt.1` · Status: **PILOT** (evidence-picked #1) · Epic: `…epic-nfgt`
Source: [`../plan.md`](../plan.md) §Vertical ranking #1, §The offer. GitHub #1210.

**This vertical = configuration over the shared machinery.** No code branch. If
it needs one, the "verticals are configuration" thesis is falsified (plan
decision 1) — stop and re-plan.

## Today / Delta

**Today.** The platform gives the recipe: a private vertical agent (fleet seat +
persona/knowledge package + own landing page) is "fully operational today" per
`docs/direction/DIRECTION.md`, first-agent gap costed at 3-8 PRs, binding
constraint is "content and ops, not platform code." Knowledge packaging exists
(#1168: `agent_knowledge`, 256KB/file, 128 files). Swiss models wired
(Infomaniak, CHF-billed, no FX). Approval primitive ready (`plugins/ask-user`,
capability-token `HumanArtifact`). Channel design ratified (#1127/#1140, Meta
Cloud API direct). Scheduled headless runs ship (`plugins/boring-automation`).

**Delta to a live pilot.** (1) Build the FR renovation **config bundle** (the 5
elements below). (2) Wire renovero/ofri **inbound** lead ingest (email/form, not
scraping). (3) Stand up the **customer landing page** template feeding RESPOND.
(4) Stand up the **vertical LP** (one hostname). (5) Instrument first-party Swiss
response-rate numbers (the evidence vacuum is a marketing asset — plan §Evidence).

## The 5-element kit

1. **Persona** — `instructions.md`, **FR-native**, Romandie bath/kitchen trade
   voice; covers Schreiner/Maler/Plattenleger coordination vocabulary.
2. **Knowledge corpus** — `knowledge/` on winning bath/kitchen work: scope
   templates from photos + m², price bands, standard clauses. *To build.* Watch
   the 128-file / 256KB ceiling.
3. **Vertical LP** — *our* marketing page, one FR hostname; pitch = "you will win
   jobs you are currently losing," anchored on one won CHF ~25k job, not hours
   saved. Cite HBR/Oldroyd speed-to-lead + Aroundhome DACH proof (not the
   unsourced "78% buy from first responder").
4. **Customer-LP template** — the mobile-first FR site we build per customer:
   services, photos, Google reviews, quote-request form + WhatsApp click-to-chat.
   The form + WhatsApp button **feed straight into RESPOND** — the site is a lead
   source the agent owns end to end.
5. **Signal filters** — trade = bath/kitchen reno; region = Romandie; capacity
   rules; keyword match on renovero/ofri request text.

## Four-verbs config

| Verb | Applies? | Config |
| --- | --- | --- |
| **FIND** | Constrained | Defensible form only: customer's own alert emails + renovero/ofri inbound web-form leads. **No scraping** (marketplace ToS), **no cold B2C outbound** (UWG). |
| **BID** | Yes | Draft offer from customer price book + past quotes; submit on approval. Scope templatable from photos + m². |
| **RESPOND** | **Primary** | Every inbound lead → credible FR draft in minutes, owner-approved, incl. evenings/weekends. This is the wedge: on renovero's flat-fee unmetered model, speed wins the job. |
| **FOLLOW-UP** | Yes | Chase unanswered quotes on cadence (front-loaded, per XANT); post-job review request (reviews = 20% of local-pack weight, recency top-5); dormant reactivation; seasonal. |

## Legal

UWG art. 3(1)(o) + 2021 art. 3(1)(u): automated cold B2C outbound near-prohibited
→ **RESPOND-first by design**. Swiss Marketplace Group / renovero ToS ban
scraping and reuse of contact data → **inbound / opt-in only**. Position against
Yarowa (insurer/property-manager jobs); defensible territory = homeowner-
originated web-form/email lead. (Plan §9, §Vertical ranking.)
