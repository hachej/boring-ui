# Contradiction audit — multi-agent pack vs the ratified plan and the agent-runtime set

Adversarial alignment audit of PR #1409 (the multi-agent vision pack) against
the ratified long-term pack, the decision ledger, and the absorbed #391/#909
agent-runtime plans. Run 2026-08-26 (Sol, xhigh, two passes). Verdict:
**three confirmed conflicts, all resolved on this branch**; the
Gateway/session spine itself is sound.

Per-area reviews (Sol + pi over each subfolder of this pack) append here as
they conclude.

## Per-area verdicts

| Area | Sol (contradiction lens) | pi (reader lens) | Response |
|---|---|---|---|
| fleet-and-environments | revise (9 findings) | pass | README rewritten as a reconciliation layer: DIRECTION-only authority (incl. F-graph edges + the #805 DAG demoted to reference), shipped-D29/gateway reality named where the frozen text predates it, the silent default-agent fallback flagged as a code-vs-D28 defect (#1311 line), F7 re-gated behind [durable-streams]+[seat-storage], the in-process adapter mandate superseded, the AgentHost stop-condition read narrowly. Stale `DECISIONS.md` links to the old `docs/issues/391/plan.md` path repaired. The frozen `plan.md` itself is untouched. |
| cloud-vision | pending | pass | — |
| gateway | pending | pending (rate-limited, retrying) | — |
| plugins-across-hosts | pending | pending (rate-limited, retrying) | — |
| consumption-modes | pending | pending (rate-limited, retrying) | — |
| alignment | pending | pending (rate-limited, retrying) | — |

---

## 1. Relay mechanism vs the ratified native binding — CONFIRMED, resolved

**The conflict.** The decision ledger ratifies a **native in-process
agent-to-agent binding** as the internal collaboration mechanism (D22,
`docs/DECISIONS.md:354`/`:364` — "no MCP loopback, no serialization; two-way
chat via `input-required`"; internal A2A explicitly rejected). D25 defers
D22's implementation *sequencing* — and a deferral does not authorize a
replacement mechanism. The job-thread engine plan proposed a non-agent
**relay** as the dispatch mechanism and framed the choice as "a live product
choice, not a compliance requirement" — understating the ratified default.
The engine plan also mislabeled the ruling as D24 (it is D22; D24 begins at
`DECISIONS.md:390`).

**Resolution (applied).** The engine plan's correction note, non-goal 2, and
owner question Q2 now state the asymmetry: **the ratified default for the
shipped engine is D22's native binding through the D29 AgentGateway funnel;
shipping the relay instead requires an explicit D22/D28 amendment at the
owner gate.** The v0 relay remains a candidate; Q2 stays deferred
post-[durable-streams]. Decision numbering corrected.

## 2. Thread storage suspension not propagated — CONFIRMED, resolved

**The conflict.** RECONCILIATION §8 suspends the "a Thread owns one record"
storage *shape* pending the thread-storage spike, with banners at
RECONCILIATION §7 and VISION R-c — but five other normative sites still
stated the one-record shape unqualified: the V2 implementation spec (locked
"shard = per-thread records" line and the `Thread` interface comment), the V2
port handbook (Thread implementation + Flue durability-shard note), the
VISION §1 noun table, the engine plan's "Today" section, and the #1355
console plan's single-session `ConsoleThreadRefV1`.

**Resolution (applied).** Suspension notes added at every site, uniformly
phrased: *the backing shape is suspended pending the thread-storage spike
(RECONCILIATION §8); the ontology stands.* `ConsoleThreadRefV1` is
additionally marked **blocked** on the spike's finding — a multi-seat Thread
may not map to one `(agentTypeId, sessionId)` pair.

## 3. Per-workspace fleet assumption — CONFIRMED (narrow), resolved

**The conflict.** D28 rules that the **host application** defines one
deployment-static fleet (compiled and validated at startup per D29); a
Workspace persists only its default agent, and "per-Workspace fleet
allowlists" sit on D28's re-evaluation list. The pack's retained owner
synthesis ("1 channel = 1 fleet declared at the workspace level") and the
shell plan's recipe definition read as Workspace-curated fleets — a
capability nothing currently authorizes, and no premise carries the D28
re-evaluation.

**Resolution (applied).** The shell plan's recipe definition and the engine
plan's staffing picker now say participants are **selected from the
deployment-static application fleet**; the north-star ledger entry carries a
status note; Workspace-*curated* fleets are named as requiring an explicit
D28 re-evaluation if ever intended.

---

## Confirmed sound (checked, no conflict)

- **Gateway/session spine.** The engine consumes sessions exclusively through
  the D29 AgentGateway funnel (per-agent session addressing, single
  construction path, `AuthorizedAgentScope` as a runtime capability); the
  relay design holds no capability between turns.
- **Premise program vs the 391-forward lanes.** [durable-streams] is the 391
  epic's own bead (`wt-391-forward-9p50`); the D29 Level-D addendum rides
  PR #1409 and matches D29's named re-evaluation trigger.
- **Ontology.** No new noun; the multi-seat Thread ruling (merged PR #1401)
  and §8 are additive, with the one named storage-shape exception above.
