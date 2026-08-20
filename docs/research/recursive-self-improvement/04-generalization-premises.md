# The invariants: what makes a self-improving loop work on any process

2026-08-17. Distilled from the systems studied in this folder (AIDE², DGM, SICA, ADAS, AlphaEvolve/FunSearch, STOP). This file is deliberately domain-free: it defines the concepts and the conditions under which the loop
`archive → select → mutate → evaluate → accept/reject`
compounds instead of stalling or corrupting. Gap analysis against our own state lives in [05-delta.md](05-delta.md).

---

## The core objects

Five nouns appear in every working system. If a process can't name all five, it can't run the loop.

| Concept | Definition | In the studied systems |
| --- | --- | --- |
| **Artifact** | The versionable, diffable thing being improved. The unit of mutation and of inheritance. | Agent source code, ML pipeline, algorithm, prompt |
| **Fitness function** | The measurement that orders two artifact variants. The loop optimizes *exactly* this, including its flaws. | Benchmark score, test pass rate, runtime |
| **Mutation operator** | Whatever generates candidate variants from (artifact, history). Since LLMs, this is cheap and abundant. | LLM prompted with parent code + performance logs |
| **Gate** | The accept/reject decision against a pre-committed criterion. Defines what enters the lineage. | Strict score comparison, CI bounds, staged gates |
| **Archive** | The persistent memory of variants + scores + lineage. What proposals condition on; what makes the loop cumulative rather than amnesiac. | Journal (AIDE), agent archive (DGM/ADAS), git lineage (SICA) |

## The nine invariants

Every failure mode documented in the literature is a violation of one of these.

### I1. Reification — no artifact, no evolution
The improved thing must exist outside anyone's head, in a form that can be copied, diffed, and rolled back. Tacit skill can be *executed* but not *evolved*: you cannot mutate, archive, or compare what isn't written down. **Test: if you can't diff it, you can't evolve it.** Every loop starts by writing the current way down as the seed (`gen 0`).

### I2. Orderability — the fitness signal must rank variants
There must be a measurement that says A > B with confidence, and its *validity* (tracks the true goal) matters more than its precision. A missing signal means the loop optimizes nothing; a misaligned signal means the loop optimizes the wrong thing with great efficiency — the loop amplifies whatever the metric actually rewards, never what it was intended to reward.

### I3. Eval economics dominate — loop cost = proposals × eval cost
Mutation is nearly free now, so the eval is the budget and the clock: loop speed = eval latency, loop cost = eval cost × proposal count. Corollaries: (a) staged evaluation (cheap gate first, expensive eval only for survivors — DGM's 10→60→200) is how expensive signals become affordable; (b) any process whose eval is slow isn't disqualified, but must change shape (see I6).

### I4. The gate must be brutal — ~90% rejection is the working regime
Most proposed "improvements" are neutral or harmful; AIDE² accepted 7 of ~100. The loop works *because* the gate kills freely. Requirements: the criterion is pre-committed (not negotiated after seeing the result), rejection is cheap, and acceptance is statistical (CIs, p-values) whenever the signal is noisy. A gate that accepts most proposals isn't a gate; it's drift.

### I5. Defend the fitness signal from the optimizer
The single strongest empirical regularity: any optimizer pressed against a proxy eventually attacks the proxy (63% of AIDE²'s unguarded wins were gaming; DGM faked test logs and deleted its own anti-cheat instrumentation). Working defenses are all at the *measurement* layer, never the execution layer:
- **Public/private split** — a held-out score the optimizer never sees and never conditions on;
- **Outlier discipline** — a suspiciously large win triggers an audit, not a celebration;
- **Lineage audit** — accepted changes remain traceable and re-inspectable after the fact.
Containment (sandboxes, permissions) protects the *host*; nothing structural protects the *scoring pipeline* — that defense must be designed, and it is never finished.

### I6. Iteration count must fit the decision horizon
Compounding requires cycles. Fast signal (minutes–days) → serial lineage of small atomic mutations. Slow signal (weeks–months) → the loop must go **wide**: a population of variants evaluated in parallel (island model), and each mutation must be high-variance (bold changes), because a 50-generation-per-year budget wasted on tweaks never compounds. Iteration count is a budget to be spent deliberately.

### I7. Memory with forced diversity
Proposals must condition on the archive (what was tried, what it scored) or the loop re-proposes dead ideas forever. But pure greedy descent inherits early mistakes (path dependency) and stalls on local optima. The fixes are convergent across systems: keep losers sampleable (non-elitist archive), and **fork-on-stall** — when a lineage plateaus, branch from an older ancestor rather than pushing the incumbent.

### I8. Fixed-budget comparison — else you measure spend, not improvement
A variant "wins" only at equal cost/effort/time. Every credible result in this literature is budget-matched; every non-budget-matched comparison is confounded by the easiest variable to increase. This is also the honest acceptance test for any internal claim that a process "got better."

### I9. Reversibility bounds what may be mutated
A mutation may only be tried where failure is cheap: sandboxed, canaried, or rollback-able. Where the blast radius is irreversible (a relationship, a reputation, production data), the loop runs on *leading or simulated* signals, and only gate-accepted variants are carried into the irreversible arena — by a human.

## Second-order consequences

1. **The moat inverts.** Mutation (LLM) is a commodity; the loop is a few hundred lines; models are rented. The scarce, compounding, unreproducible asset is the **fitness function**: fast, cheap, valid, private, defended. Whoever owns a trustworthy eval for a valuable domain can run the loop; whoever doesn't, can't — at any spend.
2. **Human roles migrate.** Humans stop being the mutation operator and become (a) fitness-function designers, (b) gate-keepers, (c) auditors of suspicious wins. The judgment work concentrates in *what to measure and when to say no*.
3. **The eval decays.** Fixed benchmarks get learned out; proxies drift from goals as pressure rises (Goodhart is a function of optimization intensity, not a one-time bug). Eval maintenance — refreshing held-out sets, cataloguing observed hacks, re-validating proxies against ground truth — is permanent operating work, not setup.
4. **Improvements are portable; loops are not.** Artifacts and techniques discovered in one loop transfer for free (publishable, copyable). The cheap strategy is to *adopt discovered artifacts* from others' loops and reserve your own loop-spend for domains where your fitness function is private.
5. **The loop's output includes its own instrumentation.** Mature loops spend part of their budget improving the eval itself (AIDE² repaired its own harness; Weco built SpecBench). A loop that only improves the artifact and never the measurement is running open-loop on a decaying signal.
