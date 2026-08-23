# Founder / Chief-of-Staff Agent — Delta Plan

## Status

- Plan state: `draft` — owner gate required before any slice starts.
- Target: this repo (old repo keeps shipping per ratified R-a); the Founder agent
  operates the *current* business, so it builds on current factory/ask-user machinery.
- Planning source: owner product conversation 2026-08-23 ("Founder agent first,
  Engagement second") + full open-PR audit of 2026-08-23 (39 PRs, ~45.8k lines).
- Precedent: plan-docs PR pattern (`#1356`, `#1220`, boring-mail workbench plan).

## Problem Statement

The bottleneck is founder attention, not tokens. The factory already runs workers,
reviews, and evals, but nothing maintains a cross-project ranked view of what matters,
nothing verifies outcomes (only PR-level proof), and no daily operating review exists.
Five loops are targeted:

1. product prioritization — partially covered (beads, GH), no synthesis;
2. code/repo supervision — strongest loop today (factory, CI, verifiers);
3. sales follow-up — zero infrastructure;
4. customer/research synthesis — partial (boring-mail plan, research corpus);
5. daily operating review — missing entirely.

## Alignment with ratified plans

This proposal is derived from, and does not supersede, the ratified documents:

- **VISION §7 GTM**: "internal commercial-discovery workspace … is itself vertical
  candidate #3." The Founder agent IS that workspace, run on our own company.
  It is also the deepest dogfood: one founder uses Seneca to run the company that
  builds Seneca agents.
- **VISION §2/§5 kernel track**: the ranked queue and evidence ledger are NOT new
  durable primitives. Ranked priorities are **Objectives** (K2 records). Shipped
  evidence is **Outcome/Evidence** records joined to Runs via `producedByRunId`.
  The daily dashboard is a **View** over those records.
- **Invariant 8** (Evaluation ≠ Outcome) and **invariant 11** (promotion on evidence)
  govern the evidence ledger: the ledger records what happened; it never self-grades.
- **Invariant 12** (every platform investment pulled by a real experiment): the pull
  here is real — it operates Seneca itself from day one.
- **Non-goals respected**: no cloud scheduler (uses #896 local automation), no new
  kernel nouns, no autonomous mutation of production repos (merge stays at human gate).

### Named conflicts / tensions

1. **Invariant 14 ("docs never precede implementations") vs this document.**
   Resolution: this is a gating plan in the established #1356/#1220 pattern; each
   slice hard-gates named feature work below and lands with its implementation.
2. **Human attention exists at exactly two gates.** The daily digest adds an Inbox
   intention that is informational only — read-only projection, no approval authority,
   so the two-gate contract is preserved. Any digest item that requests a decision
   must route through the existing plan/merge gates or an explicit ask_user question.
3. **Cross-project scope vs workspace binding (invariant 1).** The aggregator is a
   read-only View composed by the owner's personal host across workspaces it is
   authorized to see; agents still act inside Seats. No agent gains cross-workspace
   authority from this plan.

## The delta: D1–D6

Audit result (2026-08-23): the delegation skeleton is built or in-flight
(#1288 dispatch loop, #1343 durable-question Inbox, #1356/#1357 Console,
#1310 package lifecycle, #1145/#1164/#1166 credentials, #1309 Composio).
Six components are net-new.

| # | Delta | Maps to | Size |
| --- | --- | --- | --- |
| D1 | Cross-project read aggregation | View over existing projections | small |
| D2 | Objective-ranked priority queue synthesizer | K2 Objectives + beads/GH inputs | small |
| D3 | Daily operating review job → Inbox intention | #896 automation + attention projection | medium |
| D4 | Shipped-evidence ledger (Outcome/Evidence records) | K2 Outcome/Evidence stores | small |
| D5 | Sales pipeline store + prospect-research specialist | CRM-as-View; Composio connectors | greenfield |
| D6 | Customer-notes ingestion (boring-mail Slice 1 + LinkedIn #1346) | existing vertical plans | medium |

Prerequisite landings this plan depends on (all already open as PRs/worktrees):

- #1343 Inbox projects all durable questions → D3's write path
- #1288 durable factory dispatch loop → D3's execution path
- #896 internal-automation-scheduler (worktree, no PR yet) → scheduling for D3
- objectives plugin (`weekend-objectives` worktree) → Objectives store for D2
- #1356 ratified + Console v1 (#1357) → the surface D1/D3 render into
- boring-mail Slice 1 (`ready-for-agent`) → D6

## Slices

### Slice F0: Attention spine landing (no new code)

Merge/ratify the prerequisite set above. Exit gate: Founder agent's I/O paths exist.

### Slice F1: Aggregator + evidence ledger (D1+D4)

Read-only server route composing per-project PR/beads/CI/worktree/session state;
append-only Outcome/Evidence records keyed by merged PR and objective id.
No agent authority; owner-host read scope only.

Proof: route tests over fixture project trees; ledger append idempotency test.

### Slice F2: Ranked queue + daily review (D2+D3)

Scheduled job compiles: Top 3 priorities (from Objectives × beads × PR state),
agents-now, shipped-since-yesterday (from D4 ledger), blockers/approvals,
delta-vs-yesterday. Posts ONE informational Inbox intention. No approval semantics.

North-star instruction stored as config on the objective root:
maximize probability of getting/retaining paying customers while minimizing
founder attention; optimize for shipped evidence and revenue, never activity.

Proof: deterministic fixture run produces the six-section digest; scheduler test;
projection lands via supported attention API only (no ask-user internals import).

### Slice F3: Sales loop (D5)

SQLite pipeline store (boring-mail data-model pattern), prospect-research specialist
persona (worker-class seat instructions, no new seat without owner ruling),
follow-up generator writing draft intentions. Read-only external fetch via #1309
catalog until credential chain (#1145→#1164→#1166) lands.

Proof: pipeline CRUD + idempotent research-caching tests; manual demo digest row.

### Slice F4: Customer/research ingestion (D6)

Execute boring-mail Slice 1 tracer bullet; customer notes as mail-like artifacts
resolvable through the same opaque-target surface contract.

## Explicitly out of scope

- Engagement vertical build-out (Founder agent orchestrates it later; not this plan).
- Any new kernel noun; any autonomous merge/write authority; cloud scheduler;
  revenue-metrics ingestion contracts beyond placeholder Outcome payloads;
  multi-tenant anything.

## Open questions (owner)

1. Does the daily cadence start weekly (Monday) and tighten, or daily from F2?
2. Which projects are in F1 v1 scope: boring-ui-v2 + boring-mail only, or all five?
3. Sales source of truth v1: plain SQLite pipeline plugin vs Notion/Airtable via
   curated Composio transport?
4. Confirm the north-star instruction wording as the durable Objective root text.
