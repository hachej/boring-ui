## 1. Pass-2 minimal edit set

| Requirement | Result |
|---|---|
| Canonical rewrite | **DONE** — v3 is now one canonical document; prior material is history-only. |
| Complete item-level DAG | **INADEQUATE** — P-1 has no explicit barrier edge; B2 is absent; A1/B2 prerequisites and A7/B7→C4 joins remain implicit or missing. [DAG](/tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/2f6c6143-73be-4a87-886b-e8dd7fb126e0/scratchpad/docs-research/ARCHITECTURE-PLAN.md:136) |
| A2c cutover | **INADEQUATE** — dual-read is specified, but rollback lacks dual-write or reverse synchronization, so flipping the marker can discard post-cutover writes. [D-d](/tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/2f6c6143-73be-4a87-886b-e8dd7fb126e0/scratchpad/docs-research/ARCHITECTURE-PLAN.md:204) |
| C6 commit protocol | **DONE** — admission, deduplication, settlement, lost-ACK handling, and recovery reconciliation are specified at appropriate altitude. [D-c](/tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/2f6c6143-73be-4a87-886b-e8dd7fb126e0/scratchpad/docs-research/ARCHITECTURE-PLAN.md:187) |
| C7/B7 ownership | **DONE** — C7 is host-owned and signed remotely; Workspace explicitly owns trusted-plugin hosting. [C7](/tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/2f6c6143-73be-4a87-886b-e8dd7fb126e0/scratchpad/docs-research/ARCHITECTURE-PLAN.md:170), [B7](/tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/2f6c6143-73be-4a87-886b-e8dd7fb126e0/scratchpad/docs-research/ARCHITECTURE-PLAN.md:179) |
| C4 deployment + A3 acceptance | **INADEQUATE** — A3 is complete and C4 covers every requested dimension, but its volume placement contradicts itself. [C4](/tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/2f6c6143-73be-4a87-886b-e8dd7fb126e0/scratchpad/docs-research/ARCHITECTURE-PLAN.md:214), [A3](/tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/2f6c6143-73be-4a87-886b-e8dd7fb126e0/scratchpad/docs-research/ARCHITECTURE-PLAN.md:224) |

## 2. Five carried pass-1 findings

- **#2 A2 stores: NO** — rollback remains unsafe without mirrored writes or validated reverse synchronization.
- **#3 distributed commit: YES** — discharged.
- **#4 ownership oracle: YES** — discharged.
- **#6 plugin host: YES** — discharged.
- **#8 deployment topology: NO** — substantively covered, but durable-volume placement is incoherent as written.

## 3. New internal contradictions

- A6 “gates A2c completion,” but both the DAG and Track A order A2c before A6. [Gate statement](/tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/2f6c6143-73be-4a87-886b-e8dd7fb126e0/scratchpad/docs-research/ARCHITECTURE-PLAN.md:210), [Track order](/tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/2f6c6143-73be-4a87-886b-e8dd7fb126e0/scratchpad/docs-research/ARCHITECTURE-PLAN.md:251)
- A volume cannot be both “under the host session root” and a sibling of `/data/pi-sessions`; `/data/pi-sessions` is itself the customary session root.
- The DAG calls itself the canonical item-level ordering authority, yet B2 exists only outside it. [B2](/tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/2f6c6143-73be-4a87-886b-e8dd7fb126e0/scratchpad/docs-research/ARCHITECTURE-PLAN.md:266)

**NOT CONVERGED — minimally: add explicit P-1, A1/B2, A7/C4, and B7/C4 dependencies; split A2c into migration and completion around A6; define rollback synchronization; and place per-agent storage beneath `BORING_AGENT_SESSION_ROOT` (`/data/pi-sessions`), which is sibling to `/data/workspaces`.**