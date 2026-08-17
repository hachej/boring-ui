# Recommendations

**Synthesis: [`ARCHITECTURE-PLAN.md`](../ARCHITECTURE-PLAN.md)** — the five-track plan grounded in the 2026-08-14 four-census audit.

One recommendation = one folder. Self-contained: the proposal, the research that produced it, and the
spike that proves or refutes it.

```
R-<run>-<n>-<slug>/
  RECOMMENDATION.md    claim · why · evidence · cost · what it breaks · refutation
  research/            source material — harvest excerpts, code traces
  spike/               QUESTION · PINNED · src/ · test/ · RESULT   (absent if design-only)
```

A recommendation with no `spike/` is **design-only** and must say so in its Status. A recommendation
whose Refutation section says nothing could disprove it is taste, and does not belong here.

## 2026-W33

| id | recommendation | status | conf | spike |
|---|---|---|---|---|
| R-33-01 | Make the durable log the only owner of session state | proven | executed | ✔ two PIDs, real turns |
| R-33-02 | Human input as a durable journaled pause | proven | executed | ✔ survived SIGKILL |
| R-33-03 | Opaque cursors · implicit sessions · authoritative `final` | proven | executed | ✔ 12 files, +77/−106 |
| R-33-04 | Migrate by importing pi JSONL; abandon event rows | proven | executed | ✔ 4,229-line transcript |
| R-33-05 | Canonical record schema (L0) | **refuted twice** | reported | ✔ 24 tests, still 17 fatal |
| R-33-06 | Bounded tool catalog | **refuted in part** | executed | ✔ disproved its own dispatch |
| R-33-07 | Accepted-work contract as #1009's spec | proposed | reported | design-only |
| R-33-08 | Correct the security claims in DECISIONS.md | proposed | verified | design-only |

Four proven, two refuted by their own spikes, two design-only. **A spike that refutes its recommendation
is the cheapest possible outcome** — R-33-06 was filed as issue #1226 and disproven six hours later.

### From the DeepSeek Harness scout (2026-08-14)

Source: [`runs/2026-W33/harvest-deepseek.md`](../runs/2026-W33/harvest-deepseek.md).

| id | recommendation | status | kind | cost |
|---|---|---|---|---|
| R-33-09 | A seam ships Owner + Impl + Consumer or it does not ship | proposed | process | low |
| R-33-10 | "Model-visible means logged" as a stated invariant | proposed | invariant | low/med |
| R-33-11 | Runtime invariants over static checks — retire the phantom brand | proposed | bug | med |
| R-33-12 | Profiles · bundles · patch layers for the external-plugin epic | proposed | design | med |
| R-33-13 | Scrub the env handed to spawned commands | proposed | bug (sec) | low |
| R-33-14 | Finish the seams: composition-time provider selection | proposed | code | med |
| R-33-15 | Split authority from mechanism; draft D31 | proposed | decision | low |

Full report: [`runs/2026-W33/SCOUT-REPORT-deepseek.md`](../runs/2026-W33/SCOUT-REPORT-deepseek.md).
Seam census (grounds R-33-09, R-33-12, R-33-14): [`R-33-14-finish-the-seams/research/seam-census.md`](R-33-14-finish-the-seams/research/seam-census.md).

R-33-09 and R-33-10 need no spike — they are review rules, grounded by the census rather than by a
spike. R-33-11 and R-33-13 are defects verified against `main` on 2026-08-14. R-33-14 is grounded by
the census and needs no spike. R-33-12 stays blocked on the unsandboxed external-plugin import.

**R-33-15 gates R-33-14 and R-33-12.** It supplies the one test that decides which units may be
plugins at all — *can this unit increase what the agent is permitted to do?* — and reclassifies tool
registration as authority, which explains both the first-wins `extraTools` spread and the dead
collision policy in one move.

The census **corrected two earlier claims** — "sandbox has no registry" and "MCP grants are unwired"
were both false. R-33-12 repriced high → med as a result, with R-33-14 carved out as the
independently shippable half.
