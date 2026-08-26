# docs/direction/

Canonical cross-issue strategy home: [`DIRECTION.md`](DIRECTION.md)
(sequencing authority), [`VISION.md`](VISION.md) (living vision),
[`STATE.md`](STATE.md) (rolling completion tracker), [`state/`](state/)
(dated snapshots). Update cadence: each burn updates STATE.md and adds a dated
snapshot. Precedence: user > DIRECTION > issue plan folders.

Service architecture (above issue plans):
[`sandbox-service-architecture.md`](sandbox-service-architecture.md) — the
sandbox service's corrected public multi-tenant architecture: Firecracker
microVM-per-sandbox on shared EU bare metal in v1, an owned snapshot-aware fleet
in v2, and the four-layer contract that sits above the SBX1.4 plan.

Grounding evidence for the sandbox service lives in the issue folder:
[`../issues/1081/`](../issues/1081/) (index) and
[`../issues/1081/references/`](../issues/1081/references/) — the version-controlled
research artifacts, including the controlling multi-tenant sandbox-engine
security evaluation, E2B API/internals, Kata/Firecracker constraints, and the
historical single-tenant/runsc studies.
