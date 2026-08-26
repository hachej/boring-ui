# STATE — rolling completion tracker

**Last updated: 2026-08-26** (snapshot:
[`state/2026-08-26.md`](state/2026-08-26.md)). Each burn re-dates this file and
adds a dated snapshot under [`state/`](state/); this file holds only the
current status, snapshots hold the analysis. Vision components are defined in
[`VISION.md`](VISION.md); sequencing in [`DIRECTION.md`](DIRECTION.md).

Status verified against `origin/main` at `98619e9b8`. Roadmap items use
descriptive names; old letter-number codes appear once in parentheses.

## Vision components — status

| # | Component | Status | Evidence / gap (2026-08-26) |
|---|---|---|---|
| 1 | Environment-independent agent core | **Merged** | AgentGateway v0 + `createAgentHost()` funnel (v0.1.91); Decision 29 accepted 08-08, and **its re-evaluation trigger has now fired** |
| 2 | Multi-fs | **Merged** (base) | #416 bindings; environment mount contract (#1166) open since 08-08 |
| 3 | Flexible sandbox | **Partial** | Sovereign service architecture merged (#1220 / #1081) — Firecracker microVM-per-sandbox on EU bare metal in v1, **docs only**. gVisor still non-executing; no remote-worker impl; CLI defaults `direct`; no network-egress isolation |
| 4 | External MCP + artifact delivery | **Partial** | Consumption lane complete: connect-time SSRF enforcement (#1135) merged, lane correctly paused. Managed-agent ingress hardcoded off; shareable artifacts missing |
| 5 | Durable streams / transport | **Partial → the critical path** | Fail-loud flag guard (#1142) merged; lane closed at conformance Level B. Level D is now the keystone premise; stream-keying question still open before durable rows harden |
| 6 | Workspace as control plane | **Partial; specification settled, surface unbuilt** | Product surface ratified in shape (#1401 merged; #1416 open owner gate). Inbox badge/attention alignment (#1396) merged. Cross-surface session observability and unified approvals still missing |
| 7 | Multi-agent EU deployment | **Partial** | Persisted default agent (#1156) + signup-domain hook (#1165) merged; deploy runbook documented (#1387). Per-agent landing pages moved app-side (owner ruling 2026-08-10). **Golden-path timing proof still never recorded** |
| 8 | EU-sovereign hosting | **Holds** | Reinforced by the sovereign sandbox architecture's EU-bare-metal v1 topology |
| 9 | The farm | **Deferred** (by design) | Objectives plugin (#1382) and archive sessions (#1376) accumulate substrate in the open queue; correctly not built as product |

## Premises wave — the current critical path

Program: `docs/plans/multiagent-shell/premises.md`
([#1409](https://github.com/hachej/boring-ui/pull/1409)); ordering ratified by
[#1416](https://github.com/hachej/boring-ui/pull/1416) (owner gate).

| Premise | Status (2026-08-26) |
|---|---|
| **[durable-streams]** (bead `wt-391-forward-9p50`, formerly P1) | **Keystone, ready, not started.** Scoped and beaded; ~2 sessions. Blocks `shell-ngfs.13`, `shell-ngfs.7`, `jfxd.2`. **Bead is P2 while three dependents are P1 — re-prioritise before dispatch** |
| **[thread-storage-spike]** (`shell-ngfs.13`, formerly P2) | **Newly scoped, never run.** Competitor study + in-stack spike; 1 research + 1 spike session |
| **[seat-audit-attribution]** (`shell-ngfs.14`, formerly P3) | **Ratified in principle, unscoped in practice.** ~2 sessions, most likely to grow — it touches the envelope |
| **[saved-views-kernel]** (formerly P4) | **No sizing at all.** Needs its own planning pass |
| **[merge-queue]** (formerly P5) | **Standing obligation, overdue a pass.** Path items: #1382 (+ the eval suite stacked behind it), #1343, #1376, #1386, #1409, #1416 |
| **[gate-re-ruling]** (formerly P6) | Blocked until [thread-storage-spike] reports; minutes of owner time |
| Substrate-free chrome: **[shell-layout]** (L1), **[shell-location]** (L1.5), **[shell-navigation]** (L2a) | **Dispatchable now**, in parallel with the premises |

## Epic board — completion

| Epic / lane | Status (2026-08-26) |
|---|---|
| Multi-agent console (Wave 1) | **Complete and closed** — #1147, #1156, #1165 merged since 08-08 |
| Streaming durability (Wave 2) | **Complete at Level B** (#1128, #1141, #1142). **Reopens at Level D** as [durable-streams] |
| External MCP (#1011) | **Complete and paused** — #1135 merged; consumer still unnamed |
| Authored catalog / agent packages | **Delivered** — #1202 merged 2026-08-11 (discovery + knowledge + install on the three-seat roster). Epic #1107 closed as a duplicate surface; work lives in the `xp3s` beads |
| BYOK (#1082/#1010) | **In progress, stalled** — vault (#1132) and onboarding plan r3 (#1151) merged; durable credential persistence **#1145 open since 2026-08-07** |
| Landing lane | **Superseded 2026-08-10** by owner ruling: per-agent landings are an app concern; #1154 closed. Platform kept #1156/#1165 |
| Product surface (multi-agent shell) | **Specification ratified, implementation premise-gated.** #1401 merged (thread noun); #1416 open (surface + premise order); #1409 open (canonical plan pack) |
| Objectives plugin (#1382) | **Open**, 15 commits; the 8-eval factory suite (#1383) is **stacked behind it and not on main** |
| Factory weekend residue | #1387/#1388 merged; #1380, #1381, #1384 closed unmerged (#1384 with a recorded reason, the other two **silently**); branches orphaned |
| Sovereign sandbox (#1081) | **Architecture merged (#1220), zero implementation.** Wave 4 implementation gates unchanged |
| Metering/billing (#819) | **Nothing merged**; ships only when a usage-priced offer pulls it (unchanged 08-08 ruling) |
| Executable environments (#1123) | ACTIVE at LOW priority (unchanged); #1166 mount contract open |
| Channels (#1127) | Deprioritized (unchanged) |
| UI polish loop | Standing low-effort background work (unchanged) |
| Vertical agents (private → public) | Direction unchanged (ratified 2026-08-08). **Commercial sequencing now lives in the Seneca tenant repo**, not here |

## Known-broken tooling

- **Visual-review harness** — [#1390](https://github.com/hachej/boring-ui/issues/1390),
  open: the registered `workspace-agent-sidebar` spec times out at
  `ensureAgentNavigation` on clean main. Repair before the shell slices need
  reviewer-agent proof.
- **Bead viewer (`bv`)** — fails on a TTY error and on two invalid
  `ready_for_human` statuses in the JSONL (lines 213, 287), silently dropping
  those beads from any view.

## Snapshots

- [`state/2026-08-26.md`](state/2026-08-26.md) — the premises refresh: three
  arcs since 08-08, the premise program as the critical path, the ratified
  specification artifacts, the merge queue, and honest gaps (live multi-agent
  transcript unproven, no columnar grid component, broken visual-review
  harness, the stacked-merge trap).
- [`state/2026-08-08.md`](state/2026-08-08.md) — first snapshot: full
  component analysis, lane ranking, paying-customer gaps, GTM readiness,
  vertical-agent gap lists (private launch + public-vertical-agent features).
