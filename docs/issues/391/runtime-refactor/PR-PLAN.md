# Historical Decision 25 review-sized PR plan

> **Status: historical / non-dispatchable.** The P0/S1–N1 map below is
> superseded by Decision 28 and [`../plan.md`](../plan.md). Active PR-sized work
> is represented only by the Decision 28 F-series Beads; nothing below
> authorizes implementation.

| Order | PR scope | Primary review focus | Expected review |
| --- | --- | --- | --- |
| P0 | Decision 25, canonical plan, historical markers, issue/tracker reset | no conflicting authority; no implementation | 30–45 min |
| S1 | static declaration, behavior binding, default-off safe DTO, route ownership table | no second AgentDefinition; deployment is provenance only | 20–30 min |
| S2 | trusted agent request scope, sessions, prompt/tool/provenance identity | exact primary namespace; bounded mismatch/no-spoof | 30–45 min |
| S3 | logical children over sole runtime + Agent-owned registrar extraction | no package-owner move; shared routes once; lifecycle/disposal | 30–45 min |
| S4 | Core membership-before-selection, Agent-owned scoped routes, primary alias | auth order; catalog disabled/enabled; no duplication/leak | 30–45 min |
| S5 | reusable conformance fixture and full-app single-primary wiring | behavior freeze; no AgentHost return | 30–45 min |
| R1 | exact changed package cohort release | pre-publish Seneca tarball qualification; exports, integrity, clean registry install | 20–30 min |
| N1 | Seneca exact-pin two-agent integration and proof | real auth/runtime/session/provenance | 45–60 min |

## Stacking

S1–S5 are dependency-ordered and may use stacked branches, but each branch has
one writer, current proof, and an independent review. Do not dispatch them in
parallel while their public seams are unsettled.

## Per-PR requirements

Every PR records:

- tracker ID and dependency;
- explicit scope and exclusions;
- review estimate and focus;
- exact commands and result summary;
- rollback;
- standards/spec review, plus security/thermo review where applicable;
- stable errors and compatibility impact.

R1 starts only from clean synchronized main after S5. N1 installs registry
artifacts at exact versions and never uses workspace links or unpublished paths.
