# 7. Data, knowledge and evidence

## State may be owned or connected

A product need not centralize its records in Boring. A domain adapter
declares which source is authoritative for a fact, which operations are
allowed, how versions and freshness are represented, and where writes
commit. Read access is not write access; a remote identifier means nothing
without its source and scope. Four meanings stay distinct: source evidence,
derived result, proposed change, accepted record. A saved answer is not
domain truth.

Learner and customer data is its own lifecycle: records bind to workspace
and installation, to the Thread when produced inside a job, and carry the
release digest that produced them;
they are never keyed by session and never rolled back by a software undo.
Schema evolution is declared in the release's compatibility section and
handled by reconciliation, not by a pointer flip.

## Operations are the domain boundary

A governed operation is defined once and projected to every permitted entry
point: a button, an agent tool, an API call, an admitted event. Every call
retains the caller, the subject binding, input versions, current grants and
effect semantics. Domain code owns invariants and reproducible calculations;
agents select supported actions, interpret evidence and propose. Ordinary
queries and edits do not require a Run.

## Evidence bound to the exact software

Every Run and every product outcome records its provenance: effective
release digest, input identity, actor, cost and any human intervention.
Where an evaluation ran, it additionally records protocol, suite and checker
version, result and acceptance. An evaluation applies only to the exact
release it tested; a fork that changes tested behavior does not inherit the
claim. Worker-editable examples are separate from protected checks.
Completion, measured quality, observed business outcome and billing are four
different facts.

The explicit optimization loop — objective, candidate, evaluation, outcome —
attaches where a real objective and a measurable outcome signal exist. It
is not mandatory vocabulary for every product or every kept preference.
Evidence from private use, shared improvement, external benchmarking and
training each require their own authorization; private corrections are not
automatically shared benchmarks or training data.

## Cost

Usage facts — tokens, tool calls, sandbox minutes — are recorded per Run and
attributable to the installation, so a product's receipt can state what it
cost and a tenant can price it. Pricing itself is not platform.

## Knowledge

Knowledge may ship inside an agent package as read-only, provenance-tagged
material folded into the agent digest, or stay in an authorized external
system or read-only corpus; an attributed corpus beside writable drafts is a
first-class shape and needs no fake record schema.

## Crosswalk

Implementation status lives only in [`CROSSWALK.md`](CROSSWALK.md).

| Section | Ruling |
|---|---|
| Owned or connected state; four meanings | RECONCILIATION §12(b) |
| Learner data lifecycle; no session keys | §11(b); §13; DIRECTION binding rule |
| Operations boundary | §12(c) |
| Evidence bound to release; forks do not inherit | native-creation README; §13; Q3 dataset (§6) |
| Optimization loop optional | VISION 2026-08-27 amendment; DIRECTION 2026-08-26 |
| Cost per installation | #819 plan; native-creation acceptance |
| Knowledge in packages | #1107 lane; §12(e) Charlotte shape |
