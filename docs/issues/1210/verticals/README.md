# gh-1210 vertical-agent backlog — plan stubs

The full strategy and vertical ranking live in [`../plan.md`](../plan.md).
Structured backlog lives in beads (epic `wt-391-forward-vertical-agents-epic-nfgt`,
15 children, one per vertical).

**Thesis:** one product, verticals are **configuration**, not code. Shared
machinery — signal/opportunity-intake engine, knowledge-corpus pipeline (#1168),
FR/DE draft engine, persona package, vertical + customer landing-page mechanism
(seneca), WhatsApp/identity channel (#1127 / #1211) — is built once. A vertical
is a config bundle over it. If a vertical needs a code branch, the thesis is
falsified (plan §Architecture thesis, decision 1).

This directory holds a **plan stub only for the top 3 by readiness** — renovation
(PILOT), immobilier (RESEARCHED), IT-placement (RESEARCHED-partial). Every other
vertical is a bead only; its plan is "configure the shared machinery."

Each stub carries: Today/Delta, the 5-element kit (persona · knowledge corpus ·
vertical LP · customer-LP template · signal filters), and the four-verbs config
(FIND / BID / RESPOND / FOLLOW-UP) with legal constraints flagged.

| Vertical | Bead | Status |
| --- | --- | --- |
| [Renovation, Romandie](renovation.md) | `…epic-nfgt.1` | **PILOT** |
| [Immobilier / régies](immobilier.md) | `…epic-nfgt.3` | RESEARCHED |
| [IT placement, Vaud](it-placement.md) | `…epic-nfgt.4` | RESEARCHED-partial |
