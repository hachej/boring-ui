# Cross-Product Recommendations

2026-08-18. The synthesis of the W33 research program — five framework scouts,
four code censuses, six executable spikes, three adversarial review passes, and
the Part-1 review — expressed as recommendations that hold **across every
product** in the long-term plan (Operate / Distribute / Improve, all channels,
all verticals, internal factory included). Full evidence chain in the sibling
folders; each item links its source.

## The five backbone invariants (ratified 2026-08-16)

1. **Agents exist independently of workspaces; workspaces bind them through Seats.**
2. **The Agent owns its session record; the Host owns accepted-work authority/envelope.** Run identity is minted at durable admission (`RunId := RequestKey`) and joins usage, artifacts, evaluations, outcomes. *(02/R-33-01,07,16 · 01/RECONCILIATION §6)*
3. **Effective capability = Agent-declared ∩ Workspace-granted** (∩ seat ∩ work restriction); authority only narrows, is host-issued, and is never inferred from ambient environment. *(02/R-33-15 · 04/loop-authority-trace)*
4. **Agents reason over semantic resources, views, artifacts — never renderer concepts.**
5. **A Seat grants participation, not identity** — a workspace constrains an agent but never mutates what agent it is.

## Cross-product recommendations (all grounded, all survived adversarial review)

| # | recommendation | grounding | applies to |
| --- | --- | --- | --- |
| X1 | **Payer binding at admission; per-execution credential resolution; never ambient.** The audit VERIFIED a live bypass (F-33-G15: cached registries + ambient host auth skip customer BYOK). No commercial model in the plan is enforceable without this. | 04/seam-census · 02/R-33-08 · 07/E1 | every billed product |
| X2 | **Admission before execution; usage/artifacts/evidence attach only to admitted identity.** Derived independently three times (Flue's accepted-work, our C6 protocol, the plan's Work admission). | 02/R-33-07 · 01/PLAN D-c · 07/E2 | all |
| X3 | **Facts plane ≠ content plane.** Telemetry, metering, support, publisher analytics read operational facts only; Work content never leaves the Instance except via explicit transfer forms. (Scout finding: mainstream OTel adapters capture content by default.) | 01/VISION R2 · 07/E3 | sovereignty story, support, billing |
| X4 | **Recovery = replay to safe checkpoints; unresolved external effects are `unknown-outcome`; last-known-good never displaced by a failed challenger.** Proven by three spikes; boundary proven equally (mid-turn runner re-entry is WORK, not a fact). | 05/README · 02/R-33-02 · 07/E8 | all |
| X5 | **Approvals bind to exact proposal + plan position, void on change, with channel step-up for higher effect classes.** (Think abort-record-replay + our verified self-asserted-identity minting hole.) | 06/sol-recall #7 · 07/E4 | channels, factory, all approvals |
| X6 | **Platform-bound Operation arguments**: payer/tenant/recipient/resource ids supplied from authorized context, never model-selectable, snapshotted per execution. The confused-deputy control that "content ≠ authority" alone doesn't provide. | 03/eve scout · 07/E5 | all agent-invocable operations |
| X7 | **Every gate must be demonstrably load-bearing** (mutation-verified). Empirical: 17/17 tests stayed green after their constraints were deleted. A gate whose removal changes nothing is a defect, not a control. Applies equally to CI gates, review gates, evaluators, and documented "guarantees" (the G16 lesson: 23 convention-only of 40 audited controls). | 05/l0-schema · 04 · 07/E6 | factory, promotion, CI, docs |
| X8 | **Composition collisions resolve by explicit immutable vocabulary (disable/alias/wrap/replace), never registration order.** Shipped today as first-wins array order; the guard that would catch it is dead code. | 04/seam-census §1 · 07/E7 | plugins, packages, multi-app |
| X9 | **Seams ship Owner + Implementation + Consumer together.** Census found two dead seams (collision policy, credential vault) and a systemic pattern: mechanism built, decision ratified, never wired — then docs describe a system that doesn't run. Corollary: docs never precede implementation. | 04/seam-census · 02/R-33-09 | engineering process |
| X10 | **Model-visible means logged**; frozen initial composition + append-only capability signals; generated event catalog with CI drift-fail. Triple convergence (Flue, DeepSeek, our R3). | 02/R-33-10 · 03/harvest-deepseek | record design |
| X11 | **Physical durability shard = the session/thread; agent ownership is logical.** Per-agent WAL refuted (recreates cross-session contention); host-wide DB refuted (shipped, contended, flag-gated off). | 06/sol-recall #5 · 01/PLAN R2 | storage |
| X12 | **Bounded capability exposure: summary-level (+72% smaller) with pre-call authorization for dispatched child calls; post-hoc identity logging alone is refuted.** Measured: 40 tools = 10,344B resident vs 2,867B summaries; search-per-task costs +1 round-trip with decaying advantage. | 05/token-costs.json · 02/R-33-06 | agents with many tools/MCPs |
| X13 | **Refuted designs are boundaries, kept on the record**: no canonical mega-schema (refuted ×2); no catalog dispatch without pre-call authority; no per-agent WAL; no authority from `NODE_ENV`; no declared-but-unenforced security metadata; no untrusted code in-process (the tier is isolation + explicit promotion, ratified). | 02/R-33-05,06 · 06 | what NOT to build |

## Where the field stands (five scouts, one conclusion)

Flue, eve, and DeepSeek dsh all lack tenancy — they trade it for pluggability;
dsh can make even the loop a plugin *because* every plugin is trusted. The
ratified position takes both sides of the trade: **mechanisms plural at
composition time, authority singular and host-owned**, with the untrusted tier
served by isolation + explicit promotion rather than in-process trust. No
surveyed framework closes prompt injection, tool-result exfiltration, confused
deputy, or result authorization; those stay open with spike gates (never
"absorbed").

## Method note (why these can be trusted)

Every recommendation above survived: (a) code-grounding against main with
file:line, (b) at least one adversarial pass that fabricated-citation-checked
and re-judged it on merits, and (c) where executable, a spike — two of which
**refuted their own recommendations** (kept above as X13). The convergence
trajectory across passes was geometric (11 plan-breaking → 5 → 4 mechanical →
0), and three independently-run planning threads arrived at the same
invariants. That, not any single argument, is the basis for confidence.
