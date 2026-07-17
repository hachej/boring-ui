# #391 plan ownership map

Issue #391 is the parent vision and owns the current static multi-agent
P0→N1 delivery plan in [`plan.md`](plan.md). GitHub owns broad child epics;
Beads own their granular implementation dependencies.

The former runtime-refactor pack mixed several independent programmes under one
issue folder. Decision 25 changes #391's critical path but does not cancel those
programmes. This map records their durable GitHub owners after the completed physical
plan redistribution.

## Owners

| Owner | Scope | Current source folders | Migration policy |
| --- | --- | --- | --- |
| [#391](https://github.com/hachej/boring-ui/issues/391) | static multi-agent package contract, identity/session scope, shared runtime composition, Core routing, full-app compatibility, exact release, Seneca proof | `docs/issues/391/plan.md`; shared architecture | stays canonical here |
| [#805](https://github.com/hachej/boring-ui/issues/805) | runtime package extraction and attachable environments | A1, E1, P1, P3, P4, P5, P6, P7, P8 | `docs/issues/805/runtime-refactor/work/`; moved |
| [#806](https://github.com/hachej/boring-ui/issues/806) | MCP ingress and shareable artifacts | M1, AR1, M2, E2 | `docs/issues/806/runtime-refactor/work/`; moved |
| [#807](https://github.com/hachej/boring-ui/issues/807) | durable multi-channel transport | T1, T2; `S1-slack-channel/CHAN-A-chat-sdk-transport.md` | `docs/issues/807/runtime-refactor/work/`; moved; S1 PLAN/HANDOFF/TODO and S2 snapshots stay here |
| [#808](https://github.com/hachej/boring-ui/issues/808) | sandbox provider extraction and S3/FUSE mounts | P2, X1 | `docs/issues/808/runtime-refactor/work/`; moved |
| [#809](https://github.com/hachej/boring-ui/issues/809) | marketplace, identity, contracting, billing, catalog, channels, control-plane roadmap | ID1, AC1, BL1, MK1, CH1, S3, S4, marketplace/GTM plans | `docs/issues/809/runtime-refactor/`; moved; preserve #636 as history |

## Retained under #391 as shared architecture

These files describe reusable package boundaries and are not owned exclusively
by one child epic:

- `architecture/00-global-isa.md`
- `architecture/01-agent-core-runtime-free.md`
- `architecture/02-boring-bash-environment.md`
- `architecture/03-policy-provisioning-readiness.md`
- `architecture/04-plugin-child-app-runtime.md`
- `architecture/05-multi-agent-sessions-hooks.md`
- `architecture/07-tests-review-acceptance.md`
- `architecture/08-pluggable-agent-surfaces.md`
- `architecture/09-environments-attachable.md`
- `architecture/10-sandbox-deployment-eu.md`

Decision 25 supersedes only their conflicting AgentHost/D1/controller/CAS
ordering. A child issue may extract a narrower canonical section when it opens;
shared historical reasoning stays linked rather than duplicated.

## Historical classes

The 121 previously blanket-marked files are audited as:

- **8 retired work orders:** D1 AgentHost execution and D2 mesh work tied to
  that topology. Strongly non-dispatchable.
- **29 historical snapshots/evidence/redirects:** retain dated evidence without
  changing independently tracked work-package status.
- **84 retained architecture, roadmap, or work-package files:** follow their
  own GitHub issue/Bead status; not on #391's static critical path, but not
  canceled.

## Physical move record

The canonical plan documents were physically moved in this PR: 74 Markdown
files total — 33 to #805, 13 to #806, 7 to #807 (including only S1's Chat SDK
transport reference), 6 to #808, and 15 to #809. Every former Markdown path
now contains a minimal direct redirect stub. #391 retains its static plan,
shared architecture, P0/D1/D2, reviews/snapshots, guardrails, golden path, and
navigator.

The child plans at `docs/issues/805/plan.md` through `docs/issues/809/plan.md`
are the canonical entries. No implementation behavior changed in this path-only
redistribution.
