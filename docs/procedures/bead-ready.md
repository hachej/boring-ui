# Bead Definition of Ready

A bead the Beadle may dispatch (and a worker may claim) carries:

- **WHAT** — the change, concrete enough to implement without re-planning.
- **Proof path** — exact command, or short manual path, per
  [`proof-of-work.md`](proof-of-work.md).
- **File scope** — the files/areas it touches, so concurrent beads in one epic
  never overlap.
- **Fits one session** — the Steward believes it completes within a single
  worker session. If a worker proves otherwise twice, it is a spec defect:
  split it, do not retry it.

Optional, when useful: WHY (one line), difficulty tag (routes model tier).

Enforced by Steward judgment at plan time, like every procedure. A bead
bounced back by a worker for missing any hard field counts as a plan defect,
not a worker failure.
