> **Status: historical snapshot/evidence; non-dispatchable.**
> Decision 28 and `docs/issues/391/plan.md` govern current sequencing. This file
> cannot dispatch work; any retained idea requires explicit adoption by the
> active child plan and Decision 28 Bead graph.

# Fresh-eyes audit ledger — 2026-07-12

This ledger records three successive audit rounds over the #391 runtime-refactor
plan pack. It separates review method, defects found, defects introduced by the
review process itself, and the resulting dispatch judgment.

## Round 1 — three independent Claude reviewers

Three independent reviewers worked from dependency, numbers, and executor
vantages. The merged record in [#670](https://github.com/hachej/boring-ui/pull/670)
reports **24 findings/fixes** (the handoff tally said 23). The batch corrected
dependency/status drift, missing beads, numeric claims, identity-server
selection, and related plan-pack inconsistencies.

## Round 2 — three independent reviewers

Three fresh independent reviewers produced **21 findings**, consolidated in
[#673](https://github.com/hachej/boring-ui/pull/673). Two were defects introduced
by the Round 1 fix batch itself:

1. The M2-precondition correction created an M2↔ID1 cycle.
2. The ID1 Postgres default conflicted with D1-003's no-database-service
   contract.

Round 2 fixed those regressions along with D1 truth drift, stale graph edges,
and further specification inconsistencies.

## Round 3 — one Sol reviewer, three sweeps

Round 3 used one Sol reviewer across three sweeps because of a Claude quota
outage. This was methodologically less blind than Rounds 1 and 2 and found
approximately **14 findings**. Its deepest stratum was factual and
spec-capability verification:

- fabricated M1 error-code names survived two rounds of doc-vs-doc checking;
  the corrective lesson is to verify against **code**, never sibling docs;
- the internal task lifecycle was incorrectly described as mirroring all of
  A2A v1.0 instead of a deliberate seven-state subset that omits
  `auth-required`;
- the Keycloak RFC 8707 claim had been superseded by experimental upstream
  work;
- Lane X claimed cross-resource serializable transactionality that the
  database and workspace filesystem cannot provide.

This PR fixes those facts, replaces Lane X's overreach with a durable
reservation plus staged-write/atomic-rename/restart-recovery protocol, and
marks that lane for protocol review before build.

## Convergence verdict

Finding count stayed roughly flat at first and then declined
(24 → 21 → approximately 14), while severity shifted from staleness, to factual
errors, to specification-capability gaps. The plan is dispatch-ready for the
D1-004 lane. After this PR, D1-005a/005b/005c, AR1 Lane W, and ID1 boot are dispatch-ready
when their queue gates open; AC1-D is the exception and still awaits its
required AC1-D-SPEC micro-spec before dispatcher implementation.

## Meta-lessons

1. Blind multi-vantage review produced roughly three times as many unique
   findings as a single-reviewer pass.
2. Every fix batch is itself a defect source: audit the auditor.
3. Status-flip-on-merge must be mechanical, not remembered.
4. Code is the only ground truth.
