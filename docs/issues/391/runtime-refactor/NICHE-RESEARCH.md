# Niche research — EU/French vertical-agent candidates

Research conducted in three rounds of web research in July 2026. This document
persists the findings that originally existed only in session transcripts and
records how they changed the vertical-product direction in
[GTM Strategy — Motion 5](GTM-STRATEGY.md#motion-5--vertical-agent-products-strong-candidate-owner-sparked-2026-07-11)
and the validation scripts in [GTM Call Kits](GTM-CALLKITS.md).

## Method

The research scored vertical-agent candidates for the EU/French market against
six criteria:

1. Document-heavy, repetitive workflow.
2. Reachable niche community.
3. Willingness to pay / existing software spend.
4. EU/French regulatory-sovereignty angle.
5. **Low saturation:** few AI-agent products already serve the workflow.
6. **Low advice liability:** the product assists an operational workflow rather
   than replacing regulated professional judgment.

Round 1 broadly scored candidates out of 30. Rounds 2 and 3 then grilled the
shortlist against three feasibility gates: integration gate, incumbent
penetration, and legal formalism.

## Candidate scoreboard

| Candidate | Round 1 score (/30) | Integration / formalism finding | Market finding | Verdict |
| --- | ---: | --- | --- | --- |
| Wine & spirits export paperwork (accises DAE/DRM via GAMMA2) | **25** | GAMMA2 EDI is open but gated by ANSSI-validated certification and a douane contract (3–6 months) | Best whitespace and French-only regulation, but Akanea, Wineriz, and Cap Vignes already penetrate the market; the remaining small-domain tail is price-sensitive | **Parked / caution** |
| Syndic AG-cycle agent (convocations/PV, loi 1965) | **24** | Drafting under loi 1965 is case-law-sensitive rather than mechanical; Septeo APIs are closed | Strong pain and reachable buyers; LogicielSyndic is about €2,400/year for 100 lots, but Septeo owns about 40% and buyers are conservative | **No-go** |
| Architects' permit dossiers (PC/PCMI) | **24** | No shortlist grill performed | Agency-side whitespace, but weak budgets | **Not advanced** |
| Customs declarants (DELTA-G/IE, HS classification) | **23** | Classification and document assembly do **not** require customs agrément; only filing does | Real pain, regulatory tailwind, and an open France gap because Digicust is DACH-centric | **Go if validated** |
| Association grant dossiers (subventions) | **22** | No shortlist grill performed | Huge candidate count, but low willingness to pay | **Not advanced** |
| Accounting pre-close | — | OCR, bank reconciliation, and TVA preparation are already productized | Near-total saturation across Pennylane, Tiime, Cegid Loop + Dext, Dougs, and Fulll | **No-go** |
| Analytics on the existing warehouse | — | Can sit above Postgres/BigQuery + dbt; MCP-native is the emerging expectation and boring's front door | Mid-market teams too small for Snowflake are underserved by an independent governed agent; sovereignty is currently a weak buying signal | **Conditional go** |
| Appels d'offres | — | — | Saturated by Tengo, Tenderbolt, Maître AO, and others | **Rejected** |
| Notaires | — | High legal/advice liability | Septeo and Genapi already ship AI | **Rejected** |
| Payroll | — | Incumbents own the system rails | Silae and PayFit dominate the workflow | **Rejected** |

## Feasibility grill by candidate

### 1. Customs pre-filing — go if validated

Pain concentrates in HS classification and document assembly: roughly 30–40
minutes per declaration, worsened by 2026 tariff chaos and the new €2-per-line
fee. The decisive insight is that **classification and assembly do not need the
customs agrément; only filing does**. An agent can therefore classify and
assemble the declaration package, then hand it to the commissionnaire's
existing certified filing tool. This sidesteps the 6–12 month EDI gate rather
than competing with the filing rail.

Digicust's DACH focus leaves a France gap. Validate the wedge with one small
commissionnaire processing 10–50 declarations per month and test willingness
to pay at €500–1,500/month. The core questions are whether classification plus
assembly saves enough time, whether the human handoff fits the existing tool,
and whether a commissionnaire will pay without automated filing.

### 2. Analytics on warehouse — conditional go

The target is a French mid-market company using Postgres or BigQuery with dbt,
but too small to standardize on Snowflake. This segment is underserved by an
independent, governed analytics agent: Snowflake Cortex and Databricks Genie
are vendor-locked, while dbt Analyst remains beta. MCP-native access is the
emerging expectation and is boring's natural front door.

The sovereignty thesis is contingent: EU sovereignty is a weak buying signal
today, so the initial value proposition must be time saved and governed access,
not hosting geography alone. Validate with a roughly €5M French SaaS company:
test €500–1,000/month and require evidence that the agent can save at least five
hours per week versus Looker plus ad-hoc SQL.

### 3. Wine accises — parked / caution

Wine and spirits export paperwork had the strongest Round 1 score: French-only
regulation, high paperwork burden, and apparently zero AI-agent competition.
The incumbents—Cap Vignes, Akanea, and Wineriz—behave mainly as form-fillers,
which initially suggested unusually strong whitespace.

The feasibility grill weakened the case. GAMMA2 EDI is open but gated by an
ANSSI-validated certification plus a douane contract, typically taking 3–6
months. The market is already penetrated by those incumbents, while the
unserved small-domaine tail is price-sensitive. The riskiest assumption should
be tested by interviewing a recently certified player about actual
certification time/cost and willingness to resell or white-label. Until then,
the candidate remains parked rather than killed.

### 4. Syndic AG cycle — no-go

The initial case was attractive: strong recurring pain around convocations and
procès-verbaux, reachable buyers, and demonstrated software spend of roughly
€2,400/year for 100 lots through LogicielSyndic.

The grill produced a no-go. Septeo owns about 40% of the market and exposes
closed APIs, creating a hard integration and distribution constraint. More
importantly, loi-1965 drafting is case-law-sensitive professional work rather
than mechanical document generation. High-friction, conservative buyers add a
third barrier.

### 5. Accounting pre-close — no-go

Accounting pre-close is almost completely saturated. Pennylane, Tiime, Cegid
Loop with Dext, Dougs, and Fulll all ship OCR, bank reconciliation, and TVA
preparation. The only visible whitespace is orchestration of reminders and
client-document chasing, estimated at less than 5% of the workflow's value.
The 2026 e-invoicing change is a one-time migration tailwind, not recurring
product value.

This evidence kills accounting as a lead vertical despite its earlier strong
position in [Motion 5](GTM-STRATEGY.md#motion-5--vertical-agent-products-strong-candidate-owner-sparked-2026-07-11).

### 6. Other Round 1 candidates and rejected categories

- Architects' PC/PCMI permit dossiers showed agency-side whitespace but weak
  budgets, so they did not advance to the feasibility grill.
- Association grant dossiers offered a huge buyer count but low willingness to
  pay, so they also did not advance.
- Appels d'offres were rejected as saturated (Tengo, Tenderbolt, Maître AO,
  and others).
- Notaires were rejected because Septeo and Genapi already ship AI and the
  advice-liability risk is high.
- Payroll was rejected because Silae and PayFit own the rails.

## Overall ranking after all three rounds

1. **Customs pre-filing** — classify and assemble, then hand off to the
   incumbent filing tool. It sidesteps the filing gate and is the lowest-risk
   validation target.
2. **Analytics on warehouse** — a real independent-agent gap in the mid-market,
   with MCP-native access as the entry point; EU sovereignty remains contingent
   rather than a proven purchase driver.
3. **Wine accises** — the certification gate is navigable, but incumbents are
   entrenched and the available tail is price-sensitive; keep parked.

Killed by evidence: **accounting pre-close, syndic, appels d'offres, notaires,
and payroll**.

## How the research fed GTM

The two go candidates—customs pre-filing and analytics on warehouse—became the
buyer-validation scripts in [GTM Call Kits](GTM-CALLKITS.md). They are the
evidence-backed candidates for [GTM Strategy — Motion 5](GTM-STRATEGY.md#motion-5--vertical-agent-products-strong-candidate-owner-sparked-2026-07-11),
with one-buyer validation questions feeding DEMAND-1's five vertical discovery
calls.

> **Prominent DEMAND-1 mismatch:** DEMAND-1 currently describes five
> **expert-comptable** discovery calls, but this research **killed accounting
> pre-close as saturated**. Those calls should target **customs
> commissionnaires and/or analytics data leads instead**. Leaving the bead
> pointed at accounting would validate a candidate the evidence has already
> rejected and would contradict the call kits.

Motion 5 itself still names accounting as the highest-scoring candidate. Until
that strategy text and DEMAND-1 are updated, this research record and the
customs/analytics [GTM Call Kits](GTM-CALLKITS.md) are the current evidence for
candidate selection.
