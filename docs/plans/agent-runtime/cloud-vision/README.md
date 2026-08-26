# Cloud vision

This area holds the longer-range "agent cloud" vision — a developer shipping
a custom agent the way one ships a web app — plus the landing-surface
decision that came out of retiring the old AgentHost concept.

## Files

- `AGENT-CLOUD-VISION.md` — the long-term agent cloud vision note.
- `landing-surface-reconciliation.md` — the landing-surface reconciliation
  writeup.

## Status — non-binding, with known contradictions

`AGENT-CLOUD-VISION.md` is explicitly non-binding later vision. A 2026-08-26
area review found that it contradicts later rulings in four ways; the
ratified side wins in each case:

(a) It calls the SBX1 gVisor sandbox design "ratified." The final owner
decision is [`docs/issues/1081/tech-choice.md`](../../../issues/1081/tech-choice.md),
which supersedes gVisor and requires Firecracker microVMs; no accepted gVisor
ruling exists in DECISIONS.md.

(b) Its three-layer plane model (framework/control/data, with execution
inside the data plane) differs from the ratified spec's distinct
control/data/execution planes
([`V2-IMPLEMENTATION-SPEC.md`](../../long-term/ratified/V2-IMPLEMENTATION-SPEC.md)).

(c) Its "every tool invocation crosses the sandbox" claim overclaims — the
ratified split keeps trusted first-party plugins in the workspace process and
sandbox-proxies only the untrusted tier
([`ARCHITECTURE-PLAN.md`](../../long-term/ratified/ARCHITECTURE-PLAN.md)).

(d) Its sequencing references (old plan controls, F0–F8b active) are stale —
dependency rationale now lives in
[`docs/plans/multiagent-shell/premises.md`](../../multiagent-shell/premises.md)
and ordering in [`docs/direction/DIRECTION.md`](../../../direction/DIRECTION.md).

`landing-surface-reconciliation.md` is RATIFIED 2026-08-08 (Decision 30, path
A — the original lean/config-driven static-landing platform path (label:
path A)). The later 2026-08-10 app-side ruling superseded the path-A
*implementation* (platform renderer #1154 closed), while Decision 30 remains
the authorization (see
[`docs/direction/state/2026-08-26.md`](../../../direction/state/2026-08-26.md)).
