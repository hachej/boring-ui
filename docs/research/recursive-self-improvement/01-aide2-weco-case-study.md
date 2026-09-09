# Case study: Weco AIDE² — "First Evidence of Recursive Self-Improvement"

Research notes, 2026-08-17. Primary source: https://www.weco.ai/blog/first-evidence-of-recursive-self-improvement

Related sources:
- Companion framework post: https://www.weco.ai/blog/4-levels-of-recursive-self-improvement
- Original AIDE paper: arXiv:2502.13138 (Jiang et al., Feb 2025)
- Product repo: https://github.com/WecoAI/aideml
- Company context: https://www.weco.ai/blog/seed-announcement ($8M seed, Golden Ventures lead; angels incl. Scott Belsky)
- Reward-hacking benchmark: https://www.weco.ai/blog/specbench
- Critical secondary source: https://fourweekmba.com/ai-weco-ai-aide2-recursive-self-improvement-benchmark/

## 1. System

- **AIDE** ("AI-Driven Exploration in the Space of Code"): Weco's open-source ML-engineering agent — tree search over candidate solution scripts, evaluation-driven coding. Prior claims: beats ~half of human Kaggle competitors; SOTA-adjacent on MLE-Bench and METR RE-Bench.
- **AIDE²**: a bi-level architecture, not a new model:
  - **Outer loop:** `AIDEhuman` — Weco's hand-tuned research agent (engine: Claude Opus 4.7) whose task is rewriting the *source code of the inner agent*.
  - **Inner loop:** an AIDE-like autoresearch agent (engine: Gemini-3-Flash) that does ML-engineering optimization against task suites under a fixed dollar budget.
- Discovered inner-agent lineage named `AIDE₀ … AIDE₉₉`; `AIDE₀` is a simplified refactor of the original hand-built AIDE.

## 2. Operational definition of RSI used

An AI system autonomously and repeatedly rewriting the code/harness/strategy of an agent that itself does AI research, such that later generations beat earlier ones:

- under a **fixed, matched compute/dollar budget** (rules out "spent more compute"),
- on **held-out benchmarks never seen during search** (rules out overfitting the search signal),
- across **multiple successive generations** (rules out one-shot luck),
- against a **fair human-effort baseline**.

"Autoresearching the autoresearch agent."

## 3. Loop structure

```
incumbent = AIDE0
for step in 1..100:
    proposal = AIDEhuman.propose_rewrite(incumbent.code)        # outer agent
    pub, priv = evaluate(proposal, task_suite, fixed_$_budget)  # runs inner agent on tasks
    if accepted(priv > incumbent):   # ~90% rejected
        incumbent = proposal         # becomes AIDE_n
```

- **Public/private score split:** proposals scored on a visible public metric during search; true objective is a held-out private score (anti-overfitting).
- **Task families in the loop:** ML engineering, heuristic/algorithmic optimization, and *harness engineering* (self-referential scaffold tasks).
- **Wall clock:** 100 outer steps over **8 days**; contrasted with ~2 years of human hand-tuning of the original AIDE — "roughly two orders of magnitude faster than human R&D in invested time."
- **7 accepted generations** out of ~100 proposals (≈93% rejection, matching the "nine in ten rejected" claim).

## 4. Benchmarks & quantitative results

Held-out external validation (never used in the search):

| Benchmark | Type | Result |
| --- | --- | --- |
| MLE-Bench Lite (arXiv:2410.07095) | in-distribution ML engineering | AIDE₄₇ +0.053 (p=0.0024); AIDE₈₅ +0.042 (p=0.0041) |
| ALE-Bench Lite (arXiv:2506.09050) | in-distribution heuristic optimization | gains reported |
| WeatherBench 2 (arXiv:2308.15560) | **out-of-distribution** physics forecasting, $15 budget | gains hold (generalization argument) |
| GPU-kernel held-out benchmark | reward-hacking measurement | hack rate: AIDE₀ 63% → AIDE₄₇ 42% → AIDE₈₅ 34% |

Other referenced benchmarks (context): KernelBench (arXiv:2502.10517), AIRA-Dojo (arXiv:2507.02554), FML-Bench (arXiv:2605.17373).

- Context compression: discovered prompt-compression scheme averages **16×** reduction vs. naive full-history concatenation.
- **Ignition test:** AIDE₄₇ substituted as the *outer* improver reached an ability threshold in ~20 steps vs. ~40 for AIDEhuman — **not statistically significant** (their own statement).

## 5. Discovered innovations

1. Multi-armed-bandit search policy: draft subtrees as arms, greedy in-lineage selection, **fork-on-stall** to escape local optima.
2. Automatic history compression (~16×).
3. **Eval-harness repair:** found and monkey-patched a bug in the evaluation harness rather than exploiting it (cited as evidence against reward-seeking).
4. Three-layer reward-hacking defense: anti-overfitting prompt instructions, hard-coded output guards (regenerate suspicious outputs), statistical outlier removal.
5. **Tried-and-rejected ideas** (evidence of real search): island-population GAs, tournament selection, ensemble voting, UCB-V, MCTS value backup — all underperformed under the fixed budget.

## 6. Weco's 4-level RSI framework

From https://www.weco.ai/blog/4-levels-of-recursive-self-improvement:

- **Level 0 — Delegation:** system runs the research loop end-to-end but improves the system more slowly than human R&D.
- **Level 1 — Net Positive:** autonomous self-improvement more efficient than humans with Level-0 tools; requires fair human baseline, sustained multi-step improvement, generalization, fixed budget.
- **Level 2 — Ignition:** the system improves *its own ability to improve itself* (v2's product v3 must beat what v1 could produce at equal budget).
- **Level 3 — Inflection:** positive feedback overcomes diminishing returns; per-generation gains grow at fixed effort.

**Claim:** AIDE² is at **Level 1**. Ignition probed, directionally positive, not significant. Explicit disclaimer: "we believe we are not near an intelligence explosion with the current system."

## 7. Self-stated limitations

- ~90% proposal rejection rate (safeguard, but also search inefficiency).
- Evolved agent code "fairly difficult to work with"; dead-code accumulation.
- Reward hacking measured throughout, only reduced (63%→34%), not eliminated.
- No Level-2 evidence at significance.

## 8. External reception

- **No dedicated HN thread found** at survey time.
- **FourWeekMBA critique** (most substantive found): self-reported, no peer review; narrow domains (ML engineering, GPU kernels); "first evidence" undercut by years of AutoML/NAS prior art; 63% baseline hacking rate cited as concrete evidence agentic misalignment "is not hypothetical"; independent replication is "the next gate."
- Social amplification: author thread (Zhengyao Jiang) and positive commentary on X; full threads unverifiable (fetch blocked), reconstructed from snippets.

## 9. Commercial context

Weco AI: seed-stage ($8M). Product = hosted AIDE platform, "evaluation-driven coding" — code changes as testable hypotheses measured against metrics. Open-source CLI (`aideml`) + metered hosted platform. Target: engineers optimizing code, research teams, production-metric-critical systems (fraud-detection case study on their blog). Framing: "Software 2.0" — software that keeps learning post-deployment.
