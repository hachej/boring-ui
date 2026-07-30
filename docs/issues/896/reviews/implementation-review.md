# Issue #896 managed Host worker implementation review

Reviewed: uncommitted implementation after `88b9926b2`

## Standards review

Initial result: blockers.

Accepted findings and fixes:

- Secondary legacy/runtime cleanup failures were being discarded after the first lifecycle error. The Host now retains the first error and emits sanitized events for every later cleanup failure.
- Worker settlement could race an immediate abort and hide an already-completed worker. The Host now races the original worker promise directly against abort and has a regression test for immediate drain.
- Automation's local worker id is now `hosted-scheduler`, producing stable composed id `boring-automation/hosted-scheduler`.

Final independent re-review: **CLEAN**.

## Spec review

Verified:

- once-per-Host worker declaration and namespacing;
- trusted provenance check before plugin entry metadata is erased;
- `onListen -> startWorkers`, `preClose -> beginDrain`, `onClose -> close`;
- worker join and worker-owned resource disposal before Agent runtime admission closes;
- explicit composition-vs-caller event-bus ownership;
- no route-owned scheduler/event-bus lifecycle;
- old shutdown participant API removed;
- actor authorization and dispatcher authority unchanged.

Final independent re-review: **CLEAN**.

## Thermonuclear review

Final result: **SHIP**.

Non-blocking residual note: Host worker drain intentionally has no local timeout. Core's existing 30-second process shutdown deadline remains the outer bound, as selected in the approved plan.
