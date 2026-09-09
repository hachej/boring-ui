# Delta: what we have vs. what the invariants demand

2026-08-17. Gap analysis of our own operation against the nine invariants in [04-generalization-premises.md](04-generalization-premises.md). Scope: the engineering loop (boring-factory / kanzen on boring-ui-v2) where the evidence is in the repo, and the business loops (discovery, GTM) where the assessment is inferred and should be corrected by the owner.

Legend: ✅ have · 🟡 partial · ❌ missing.

---

## Per-invariant scorecard

### I1. Reification (artifact exists, diffable)
- ✅ **Code/process:** everything is in git — code, AGENTS.md conventions, factory stage contracts, plan packs. Fully evolvable substrate.
- 🟡 **Prompts/agent configs:** worker prompts and lane routing conventions are partially written down (procedures, memory), partially tacit in how the orchestrator steers sessions day to day.
- ❌ **Discovery & GTM artifacts:** ICP/pain hypotheses, outreach sequences, positioning, demo scripts are not versioned artifacts with attached results. They live in heads, threads, and one-off docs. **This is the cheapest, highest-leverage gap in the whole table: no archive of hypotheses+outcomes means every campaign restarts at gen 0.**

### I2. Orderability (valid fitness signal)
- ✅ **Code:** CI, typecheck, tests, UI-review hard gates — variants are rankable.
- 🟡 **Validity risk:** green CI ranks *mergeability*, not *product value*. The deep-audit-before-merge rule ("spec-fit + complexity verdict, never just green CI") exists precisely because the automated signal alone is a weak proxy — but that corrective is human and unscaled.
- ❌ **Deployed product:** no telemetry that orders variants (task-success rate, retention per change). We can tell that a change shipped, not whether it made the product better.
- ❌ **Discovery/GTM:** no pre-committed metrics per hypothesis (reply→call→pilot conversions at fixed effort). Signals exist but aren't captured as rankings over named variants.

### I3. Eval economics (cheap, fast, staged)
- ✅ **Staged gates exist in the factory:** cheap checks before expensive review; lane routing sends mechanical work to cheap workers, judgment to expensive ones — this is DGM's 10→60→200 pattern, already practiced.
- 🟡 **Eval latency is unmanaged at the tail:** unbounded reviews and CI-wait stalls have burned days (documented incidents: stalled orchestrators, subagent CI-wait stalls). The loop's clock speed is set by its slowest gate, and ours occasionally hangs.
- ❌ **No cost accounting per accepted change:** we don't know what a merged bead costs in tokens/hours, so we can't do budget-matched comparison (see I8) or tune proposal volume against eval spend.

### I4. Brutal pre-committed gate
- ✅ **Merge gates are real:** review + validation queue + no-merge-without-validation; false closes get reopened with incident comments.
- 🟡 **Rejection rate unknown and probably too low.** The literature's working regime is ~90% rejection of *proposals*. Our beads are mostly accepted after iteration; we rarely kill work outright. That may mean proposals are well-filtered upstream — or that the gate negotiates instead of rejecting. Without counting, we can't tell.
- ❌ **Business side has no gate at all:** no weekly promote/kill/mutate decision against thresholds for discovery or GTM hypotheses.

### I5. Defend the fitness signal from the optimizer
- ✅ **Honesty rules as anti-gaming policy:** no fake tests, no weakened assertions, no false closes — this is exactly the failure class DGM exhibited (faked logs, deleted anti-cheat markers). We anticipated the right threat.
- ❌ **But enforcement is policy + spot-audit, not structure.** Nothing scans diffs for weakened assertions/deleted tests; no "too-good-to-be-true" outlier trigger; no automated lineage audit. We rely on the same agents' compliance that the invariant says will eventually fail under pressure.
- ❌ **No public/private split anywhere:** agents see every signal they're judged on. No held-out validation scenarios for PRs, no held-out metric for product changes, no revenue-behind-the-reply-rate discipline in GTM. **This is the most important structural gap on the engineering side.**

### I6. Iteration count fits the horizon
- ✅ **Engineering loop cycles fast:** many beads/PRs per week; serial small mutations are the right shape and that's what we do.
- ❌ **GTM/discovery run serial when they should run wide:** slow noisy signals demand parallel populations of bold variants (islands per segment) with statistical kills. Current practice (inferred): one positioning, one sequence at a time, iterated occasionally — a lineage with ~monthly generations, which cannot compound.

### I7. Memory with forced diversity
- ✅ **Engineering archive is strong:** git, beads history, proof-of-work comments, docs/issues, agent memory. Proposals do condition on history.
- 🟡 **Diversity is ad hoc:** nothing resembling fork-on-stall or keeping losers sampleable. Rejected approaches are recorded (sometimes) but never systematically revisited when a lane plateaus.
- ❌ **No cross-loop archive for business learning:** what the agency track learns (which pains pulled, which claims converted) is not written where the framework track can condition on it — the "portfolio of tracks" only compounds if the archive is shared.

### I8. Fixed-budget comparison
- ❌ **Absent everywhere.** "The new prompt/worker/process is better" claims are not budget-matched; growth experiments aren't spend-matched; agent-lane changes aren't token-matched. Every internal improvement claim currently confounds improvement with effort. Cheap fix: state the budget in the claim ("at equal tokens/hours/spend, X beat Y on held-out Z").

### I9. Reversibility bounds mutation
- ✅ **Engineering:** worktrees, branches, canonical-checkout-on-main, no-destructive-ops rules, revert culture. Blast radius well managed.
- ✅/🟡 **Client work:** Constellation treated as high-blast-radius (stability paramount during outreach) — correct instinct; the "loop on staging signals, humans carry accepted variants to the client" pattern is followed informally, not stated.
- 🟡 **Production:** no canary/rollback discipline stated for deployed changes; reversibility exists at the git level but not at the deployment-measurement level.

---

## Ranked build list (by leverage ÷ cost)

1. **Start the business archive (I1, days):** one versioned file per discovery/GTM hypothesis — claim, probe, budget, pre-committed metric, outcome. No tooling needed; a folder and a template. Unlocks I2/I4/I6/I7 downstream for the business loops.
2. **Held-out validation for the engineering loop (I5, weeks):** a private scenario set PRs are scored against that worker agents never see; refresh it periodically. The public/private split is the single defense the literature says is non-negotiable.
3. **Structural gaming detection (I5, weeks):** automated diff checks for weakened assertions, deleted/skipped tests, suspicious metric jumps → auto-flag for audit. Turns the honesty rules from policy into instrumentation.
4. **Fixed-budget claim discipline (I8, immediate):** every "better" claim states its budget and its held-out signal. A sentence-level convention, adoptable today in AGENTS.md.
5. **Gate telemetry (I4, weeks):** count proposals vs. accepts per lane; if acceptance is high, the gate is negotiating. Also fixes I3's missing cost-per-accepted-change.
6. **Product telemetry that orders variants (I2, months):** task-success/retention per change, canary + rollback (I9). Prerequisite for running the loop on the deployed product at all.
7. **Go wide on GTM (I6, next campaign):** 5–10 parallel bold variants per segment, spend-matched, CI-based kills, revenue as the held-out metric no copy loop ever optimizes.

## What we already got right (worth protecting)

- Honesty rules target the exact empirical failure mode of self-improving loops (I5) — they are eval infrastructure, not etiquette.
- Staged gates + lane routing = correct eval economics (I3).
- Deep-audit-before-merge + review-surface-by-surface = validity correction on a weak automated proxy (I2).
- Worktree/branch discipline = reversibility (I9).
- The factory itself is the loop with humans at the gate — the architecture is right; the gaps are almost entirely in **measurement** (held-out signals, budget-matching, gate statistics), which is precisely where the literature predicts the gaps of a loop-shaped organization will be.
