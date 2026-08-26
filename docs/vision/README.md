# Boring — the vision, in one place

One story, four layers, told once. Every section links down into the pack
that owns the detail; this file never contradicts them and never re-decides
anything. If a statement here and a ratified document disagree, the ratified
document wins and this file has a bug.

Companion files: [`explorations.md`](explorations.md) — every spike, study
and evaluation behind these decisions, with verdicts —
and [`../roadmap/README.md`](../roadmap/README.md) — how this sequences.

---

## The one paragraph

Boring is a **sovereign engine that turns private data, explicit objectives,
agent exploration, and real feedback into measurably better outcomes** — and
every visible product (a client dashboard, a creator-growth agent, a
chief-of-staff workbench) is a *view over that engine*, not a separate app.
The user-facing shape is a **multi-agent workspace**: one shell where
deterministic views sit beside agentic threads, several agents work one job
behind a single composer, and everything they produce lands in one governed
filesystem with an audit-grade record of who did what.

## Layer 1 — the execution engine (built, hardening)

Agents run behind **one gateway** — a single frozen session contract and a
single construction path every consumer uses (workspace app, CLI,
playground, delegation). One canonical workspace filesystem, no copies;
authority that only narrows; a fleet fixed at deployment and validated at
boot. This layer shipped (v0.1.91, Decision 29) and its next obligation is
**durable streams**: conversations a client can always resume, which the
multi-agent layer refuses to build without.

Detail: [`../plans/agent-runtime/`](../plans/agent-runtime/README.md) ·
binding contract `packages/agent/docs/AGENT_GATEWAY_V0.md`.

## Layer 2 — the optimization kernel (the new work)

Objective → Candidate → Evaluation → Outcome → Evidence: small durable
records that sit on top of every run, so agents don't just act — they
provably improve. Twelve nouns, frozen ontology, ported into a clean kernel
interface-first. This is the part of the company that compounds.

Detail: [`../plans/long-term/ratified/VISION.md`](../plans/long-term/ratified/VISION.md)
(the merged ratified vision) and its implementation spec beside it.

## Layer 3 — the product surface (specified, premise-gated)

The **multi-agent workspace shell**: Search on top, then Inbox / Work /
Agents / Library over one workspace. A **Thread is one job** — several
agents inside what looks like an ordinary chat, one composer, workers hidden
behind an orchestrator's voice, per-agent logs demoted to drill-down
provenance. Threads archive, they never die. The embedded workbench is one
component mounted four ways (thread canvas, evidence viewer, file popover,
standalone Library). Two deliberate boundaries: artifacts are **shared**
through the workspace; conversation is **posts-only** — agents share the
work, never each other's minds and keys.

The design is settled — an owner-iterated design canvas plus a running spike
recomposing shipped components, ratified as specification artifacts. What the
surface *waits on* is kernel truth: durable streams, a decided thread-storage
model, and audit-grade who-said-what. Premises before surface.

Detail: [`../plans/multiagent-shell/`](../plans/multiagent-shell/README.md)
(front door → premises → shell → engine → consumer chapters, plus the
absorbed north-star ruling ledger).

## Layer 4 — the commercial motion (lives in the tenant repos)

The platform repo deliberately holds **no** pricing, campaigns, or GTM
sequencing. Verticals are *recipes* — saved views + automations + an
objectives shape + participants staffed from the application fleet — and the
tenant repositories (Seneca) own which recipe sells first, to whom, at what
price. Today that motion is real: paying subscribers on the creator side, a
deployed client tenant, and a commercial roadmap that references these
platform documents rather than duplicating them.

Detail: the Seneca repository's `docs/COMMERCIAL-ROADMAP.md`.

---

## What is deliberately NOT decided

Honesty about open questions is part of the vision:

- **Thread storage shape** — one first-class record vs a projection over run
  records: goes to a dedicated spike with a competitor study before the
  engine's first slice.
- **Relay vs native binding vs blackboard** — how agent turns technically
  hop: decided after durable streams land; the ratified default is the
  native in-process binding unless an explicit amendment says otherwise.
- **The orchestrator's Seat** — the surface promises one voice; the engine
  must staff it or the owner must amend the promise.

The complete conflict record and how each was resolved:
[`../plans/agent-runtime/alignment/CONTRADICTIONS.md`](../plans/agent-runtime/alignment/CONTRADICTIONS.md).

## Who owns what

| Question | Owner |
|---|---|
| What is true (ontology, invariants, decisions) | `docs/plans/long-term/ratified/` + `docs/DECISIONS.md` |
| Why things wait on each other | `docs/plans/multiagent-shell/premises.md` |
| **When** anything runs | `docs/direction/DIRECTION.md` — alone |
| What was tried and what it proved | [`explorations.md`](explorations.md) |
| What sells and for how much | the Seneca tenant repository |
