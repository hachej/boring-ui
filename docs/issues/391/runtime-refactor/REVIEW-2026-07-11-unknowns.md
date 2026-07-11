# 391 Runtime Refactor — Plan Review & Unknowns Ledger (2026-07-11)

Method: full plan-pack synthesis + implementation audit vs origin/main + parallel-agent session recon; blindspot lenses per grill-for-unknowns (scale, security, failure modes, edge cases, concurrency, migration, rollback).

## Reality check (evidence-backed)

- On main: P0 (docs); P1 partial (createAgent facade + config-surface inventory; recuts A–D #566/#568/#575/#576 open); M1 partial (MCP delegate server #538); T1 partial (event-stream store #537).
- NOT on main despite MERGED labels: P6-D schema (#618) and #620 merged into stale base `plan/391-workspace-first-v1`; #620 recovered via reland #622; #618 reland (#623) + A1 compiler (#624) still open. `AgentDefinition`/`AgentDeployment` absent from packages/ on main.
- P2 essentially not started (scaffold + provider matrix; #548/#558/#564 open). Three of five v1 gates (P2-narrow, P5a, P6-R) have zero landed code.
- M1 (= MVP-M1 MCP demo) not dispatchable: blocked on P1 BBP1-005→008; #545 closed unmerged; #549/#556 flagged do-not-rebase.

## Material findings (ranked)

1. **Stacked-PR merge trap is a process gap, not an incident** (migration/rollback lens). Bit twice in 24h (#618/#620). Rule adopted: when a base branch is superseded, immediately retarget descendants to main; verify merge-commit ancestry before recording "merged" anywhere in this pack.
2. **Critical path to MVP-M1 understated** (failure lens). INDEX framed M1 as "optional tracer" while the near-term business milestone is the MCP demo. Explicit chain: P1 BBP1-005→BBP1-008 → M1 BBM1-002/003. Open question: was #545's close intentional scope-drop or lost work? Owner should rule.
3. **Decision 21 residue — #380 tension unresolved** (edge-case lens). TODO-01 BBA-015/016 (non-bash hook/command seams) exist for #380 external harnesses; Decision 21 asserts no consumer needs no-environment execution. These can't both stand. Needs an explicit ruling: re-scope as environment-full features, or retire with #380 impact noted.
4. **runtime:'none' rollback surface** (rollback lens). #622 removed the runtime:'none' fork. Residual references in configs/docs/tests should fail loudly. Recommendation: add a grep gate to P8 verification (`runtime.*none|pure.*mode` across packages/ + docs outside this pack).
5. **Plan-doc write concurrency** (concurrency lens). Two agent sessions rewrote this pack within 24h with no single-writer convention. Recommendation: INDEX.md is single-writer (owner/orchestrator); all other docs take append-only banners.
6. **EU provider parity unvalidated** (scale/security lens). v1 gate depends on the runsc/systrap narrow path; zero landed provider code proves capability-matrix parity on EU infra. Recommendation: 1-day spike bead before D1 planning locks.
7. **X1 thresholds locked on a known-flawed benchmark.** x1-bench/report.md self-reports PATH/ordering bugs invalidating readonly/backend-down checks. Mark thresholds provisional until rerun.
8. **15-minute golden path has no baseline** (scale lens). Add a measurement bead to P8 instead of asserting the number.

## Quadrant ledger (condensed)

- Known-knowns: P0 merged; M1 delegate server on main; T1 event store on main.
- Known-unknowns: commercial default (managed retainer vs self-host) TBD; Decision 21 re-evaluate clause; #545 scope intent.
- Unknown-knowns: stacked-PR retarget discipline existed as team memory but was absent from the plan (now finding 1).
- Unknown-unknowns surfaced this pass: findings 3, 4, 6.

## Appendix — full workstream audit (plan vs reality, verified 2026-07-11)

| WS | Plan-claimed (INDEX.md) | Evidence-backed actual |
| --- | --- | --- |
| P0 ADR | base merged (#521/522) | Done. Docs-only, matches. |
| P1 headless core | corrective PR + recuts in flight | Partial/unstable. `createAgent.ts`/`createAgentApp.ts` + config-surface inventory on main; `runtime:'none'` pure path added (#543) then removed (#620/#622). Recuts A–D #566/#568/#575/#576 all OPEN. |
| P2 sandbox providers | narrow/rework | Mostly not started. boring-sandbox = 8 files (scaffold + providerMatrix/capability). Provider moves #548/#558/#564 OPEN. |
| P3 routes/tools | post-v1, non-dispatchable | Matches — not started. boring-bash = pre-391 company_context code only. |
| P4 file UI | post-v1 | Matches — not started. |
| P5 provisioning/secrets | proposed v1 gate; narrow/rework | Not started. No `BashRequirement` normalizer, no PRs. |
| P6 definition/deployment | "executing independently" | NOT on main despite MERGED labels. #618/#620 merged into stale branch `plan/391-workspace-first-v1`; #620 relanded via #622; relands #623 (P6-D) + #624 (A1) OPEN. `grep AgentDefinition` on main = 0 hits. |
| A1 agent authoring | pending | Not on main. #619 DRAFT, reland #624 OPEN. |
| D1 tenant provisioning | pending | Not started, zero implementation PRs. |
| D2 shared tenant mesh | post-v1 | Matches — not started. |
| E1 env attachments | post-v1, non-dispatchable | Matches — not started. |
| E2 MCP projection | post-v1 | Matches — not started. |
| M1 MCP managed agent | optional tracer; partial | Matches. BBM1-001 (MCP delegate server, #538) on main; BBM1-002/003 (#549/#556) OPEN, flagged do-not-rebase. Not dispatchable until P1 BBP1-005→008; #545 closed unmerged. |
| M2 MCP agent surface | post-v1 | Matches — not started. |
| S1 Slack / S2 embed | relocated out of #391 (S2 → #551) | Matches — stubs only. |
| S3/S4 control-plane UX/onboarding | post-v1 | Matches — not started. |
| T1 durable events | post-v1, partially landed early | Partial. eventStreamStore + envelope append (#537) on main; #546 (durable routes), #559 (approvals) OPEN. |
| T2 transport | post-v1 | Matches — not started, zero PRs. |
| X1 S3/FUSE mounts | draft/background only | Matches. Real code on DRAFT #581, unmerged, out of v1 gate. |

Notes:

- 23 PRs open under `391-*`/`agent/391-*`/`plan/391-*` prefixes (P1 recuts A–D, P2 pr2-5, T1 pr3-4, M1 pr2-3, P6-D/A1 relands, X1 draft). Two reland PRs (#622 merged; #623/#624 open) exist specifically to recover code stranded on a stale non-main base.
- Bottom line: of ~22 workstreams, only P0 (docs), M1 partial, T1 partial, and P1's early beads have real code on main. P6-D/A1 appeared merged but are not. Everything else is either explicitly deferred post-v1 (matches plan) or has zero implementation PRs.
