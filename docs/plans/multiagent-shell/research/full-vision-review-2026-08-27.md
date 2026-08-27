# Full-vision review of PR #1409 — reconciliation record

Provenance: an external full-vision review supplied by the owner on
2026-08-27, produced against PR head `12da2af`, synthesizing the complete
product/architecture/business exploration thread. Overall verdict: **revise
the ratification language, then merge** — the shell is the *flagship*
operator surface, not the universal Boring surface.

## Disposition (this branch, 2026-08-27)

**Folded into planning text immediately** (consistent with existing owner
rulings; reversible planning material):

- **P1 scope boundary** — Level-D streams are the keystone for durable
  multi-agent conversation, one component of (not a substitute for) the
  wider accepted-work / Run / Effect / Artifact spine. (Matches the
  receipt-machinery correction already recorded.)
- **P2 widened to three candidates** — (i) projection over sessions,
  (ii) first-class Thread record, (iii) **Work-record + conversation
  bindings** (a durable customer-value record owning economics/Runs/
  Artifacts/Deliveries/Outcomes, with zero-or-more conversations bound to
  it). New decision criteria: headless job without fabricating a chat;
  a request starting in WhatsApp continuing on the web; economics stable
  when a conversation forks/archives/deletes. The ratified #1401 sentence
  ("one Thread per job") stands as the shell's product shorthand — a Thread
  never mixes unrelated jobs; the *production cardinality* is exactly what
  the already-suspended storage shape lets P2 decide.
- **P3 Actor-vs-Seat clarification** — Seat attribution is the
  Agent-specific part of a universal causal Actor record; humans,
  automations, and external clients are not forced into Seats.
- **P4 pressure-tests** — the View contract must be shaped against a
  route-first vertical page, a Meridian workbench mount, a headless
  Artifact deep link, and a schema-validated agent-proposed change — not
  only Library persistence.
- **Shell plan**: the five-domain IA is the Meridian operator default, not
  universal navigation for every vertical Experience; the canonical
  workspace filesystem is the *first shared Source*, not the universal
  shared-work model; one-composer is the shell's team-presentation policy
  (candidate policies: single-voice / explicit-specialists / ambient-hidden
  / debug-roster), which also reframes the orchestrator-Seat gap; archive
  is user-facing lifecycle and never overrides retention / legal hold /
  erasure / tenant deletion.
- **Job-thread plan**: a Job Thread is the shell's conversational
  projection of customer-value work; this chapter does not own the
  universal cardinality.

**Staged for the owner (ratification-text changes — prepared, not applied
without a ruling):**

1. **§8(a) rescope**: "the product surface" → "the flagship
   operator/collaboration surface", plus the explicit sentence that the
   same governed substrate is consumable route-first, chat-first, headless,
   embedded, and channel-first (this matches the absorbed D28
   consumption-modes contract, which already lists those modes).
2. **The compact product thesis** ("one family, three jobs:
   Operate / Distribute / Improve") — currently indexed as unratified;
   the reviewer recommends ratifying the compact form alongside #1409 and
   rescoping the vision front-door paragraph accordingly.
3. **Optimization reframing** — "every visible product is an Experience
   over the governed Work substrate; the explicit optimization loop
   attaches where a real objective and outcome signal exist" — this
   softens the ratified kernel north star and is the owner's call.

**Guarded (rule 11 — no parallel ontology by review):** the review's
vocabulary (Work, Actor, Source/Projection, Experience, Delivery,
Package/Instance, Attempt) is adopted **as questions** the spikes and
gates must answer, not as new ratified nouns. Where a term overlaps a
ratified noun (Run:=RequestKey, Mount, ViewDescriptor,
Objective/Evidence/Outcome), the ratified noun holds until an explicit
amendment. Its five conformance journeys (headless job / route-first /
Meridian / controlled improvement / package isolation) are recorded as the
architecture test set for future gates.

**Explicitly kept open by the review and by us:** relay vs native binding
vs blackboard vs pi-v4 lanes; orchestrator Seat binding; the exact
View/Experience contract; distribution/packaging; context transformation
beyond v0 truncation.

The full review text follows the owner's records (supplied in-session,
2026-08-27); its §7 contains the exact proposed amendment diffs, its §11
the seven owner decisions, its Appendix B a 20-point "architecture
constitution" worth reading before any gate.

## The seven owner decisions it poses (with its recommendations)

| # | Decision | Recommended |
|---|---|---|
| 1 | Surface scope | Meridian = flagship operator surface, not universal |
| 2 | Product thesis | Ratify compact one-family / Operate-Distribute-Improve |
| 3 | Work vs Thread | Thread binds one Work; Work may have 0..n conversations |
| 4 | One composer | Meridian presentation policy, not universal rule |
| 5 | Shared resources | Canonical filesystem for file Sources; governed Source/Operation semantics universally |
| 6 | Optimization ontology | Evidence-ready everywhere; explicit loop optional |
| 7 | View-contract scope | Small first slice, planned against the wider Experience contract |

## Key excerpts (verbatim)

**Reconciled north star:** "Boring is a sovereign agent-native application
platform in which humans, Agents, automations, and external clients perform
durable Work through governed domain Operations over private Sources,
produce attributable Artifacts and Effects, receive human Decisions and
real Outcomes, and can improve through controlled versioned revision; that
substrate may be experienced as normal SaaS, a headless Agent job, a
personal expert Agent, a channel-first service, or a multi-agent operator
shell."

**On the PR's strongest decision:** "A display-grade multi-Agent demo could
be built quickly by merging several transcripts and adding Agent labels.
The PR correctly refuses to ship that as architecture."

**On the risk:** "The surface is being frozen before the product family it
serves is decided. That can make later product ratification look like an
exception to the shell rather than the shell being one expression of the
platform."

**Merge gate (§12.1):** ratification text scopes Meridian as flagship;
product-thesis disposition recorded; P2 includes Work/Thread cardinality;
P1 scoped within the wider Work spine; P3 states Actor vs Seat; archive
wording does not override retention/erasure; shared-filesystem wording does
not claim every Source is POSIX; one-composer identified as shell policy;
head SHA pinned; owner signs the open decisions explicitly.
