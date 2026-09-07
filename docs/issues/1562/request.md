# [Native Creation] First Seneca product journey

Owner request (2026-09-07). Build the ruled contracts of RECONCILIATION §13 / DECISIONS D33 in this repository so that an expert can create, release, install for a separate consumer, run, adapt and maintain a product without founder source edits. Epic #1562. The bead graph already exists and meets the Definition of Ready: 20 beads labelled `epic:native-creation`, dependencies wired, no cycles; plan, show-me and review artifacts are in `docs/issues/1562/`. Do not re-plan the graph; validate it, raise Gate 1 with the existing `show-me-plan.md`, then dispatch in the recorded order.

## Order (DIRECTION amendment 2026-09-07, second re-cut + review additions)

Ready now, disjoint file scope: `nc-1` release manifest · `nc-t` Thread identity · `nc-x` ExecutionContext/Capability · `nc-0` embedded runtime gate. Then `nc-p` artifact publication and `nc-2` installation/activation; then `nc-d`, `nc-a`, `nc-e`; then `nc-6`, `nc-3`; then `nc-v`, `nc-l` (UI surface, one at a time); then `nc-4a`, `nc-c`, `nc-o`, `nc-r`; then `nc-4b`, `nc-5`; finally `nc-7`. `br ready` is the truth; every bead body carries WHAT, WHY, file scope, proof path, acceptance, fits-one-session, and PRIOR WORK / REVIEW ADDITIONS notes.

## Rules for this epic

- Worker cap three; `nc-v`, `nc-l`, `nc-5` never run together.
- No product record, key or bridge input may carry a session id (test it).
- Workspace stays DB-free; core injects stores; migrations are additive (0028–0033).
- Cross-package abstraction review on every PR; thermo T2/T3 for small changes.
- Zero autonomous merges: Gate 2 is the owner's decision at a demonstrated URL (local-simulation provider; Vercel is on the Hobby plan).

## Proof

Per bead, the proof path in its body. Epic done-bar: `nc-7` passes with zero founder source edits after the fixture request; the receipt under `docs/issues/1562/` is generated from `nc-e` evidence and `nc-c` usage records.

## Risks

`nc-t` collides with durable-streams A1's session-id grammar and #1355's Console thread refs (reconcile, do not fork). Migration numbering may collide with parallel PRs (renumber at rebase). `local` runtime adapter tests need bwrap on the runner.

## Out of scope

Remote (microVM) adapter; full E5 reconciliation and schema migration execution; public packaging; Thread timeline storage shape; Seneca cross-repo delivery.
