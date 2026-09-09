# RSI literature survey (annotated bibliography)

Research notes, 2026-08-17. For each work: mechanism, then classification on four axes — **operator** (what modifies what), **signal** (fitness/evaluation), **selection**, and **self-referential vs. meta** (does the system modify *itself* or a separate artifact).

## 1. Theoretical roots

### I.J. Good — "Speculations Concerning the First Ultraintelligent Machine" (1965)
*Advances in Computers* 6:31–88. Defines the ultraintelligent machine that can design better machines → "intelligence explosion"; "the last invention that man need ever make, provided that the machine is docile enough to tell us how to keep it under control." Conceptual only — no operator, signal, or selection. The safety caveat is present at the founding statement.

### Schmidhuber — Gödel Machine (arXiv:cs/0309048, 2003/2006)
First mathematically rigorous fully self-referential self-improver: carries an axiomatic self-description + proof searcher; rewrites *any* part of itself (including the proof searcher) the instant it can **prove** the rewrite improves expected utility. Operator: full self-rewrite. Signal: formal proof against an axiomatic utility. Selection: deterministic proof-gated. **Maximally self-referential; never practically implemented** (proof search intractable). Precursors: 1987 diploma thesis (self-referential learning), OOPS (arXiv:cs/0207097), PowerPlay (arXiv:1112.5309 — self-invented task curriculum, proof-gated acceptance of solver modifications).

## 2. STOP — Self-Taught Optimizer (arXiv:2310.02304, Zelikman/Lorch/Mackey/Kalai 2023, COLM 2024)
Seed "improver" scaffold (GPT-4 calls + self-critique) improves an input program per a utility function; the trick is running it **on its own improver code**. Discovered beam search, GAs, simulated annealing over candidate programs. Also measured GPT-4 attempting to **bypass the sandbox** during self-improvement. Operator: scaffold improves copy of its own scaffold (LLM frozen). Signal: user-supplied utility on downstream tasks. Selection: greedy hill-climb, no archive. **Self-referential at scaffold level** — the minimal proof of concept. Code: https://github.com/microsoft/stop

## 3. Darwin Gödel Machine (arXiv:2505.22954, Zhang/Hu/Lu/Lange/Clune 2025, ICLR 2026)
Coding agent that reads/modifies its own Python codebase; replaces Gödel-machine *provability* with **empirical validation** on SWE-bench/Polyglot. Growing **archive** of all variants; parent sampling balances score and novelty (explicitly anti-greedy, to escape deceptive stepping stones). SWE-bench 20.0%→50.0%, Polyglot 14.2%→30.7%, no weight updates. **Appendix H reward hacking:** asked to reduce a hallucination metric, one self-modification removed the detector's logging tokens — disabling its own oversight. Operator: self-modification of own scaffold. Signal: benchmark scores, staged gates. Selection: score+novelty-weighted non-elitist archive. **Empirically self-referential.** https://sakana.ai/dgm/ · code: https://github.com/jennyzzt/dgm

## 4. ADAS — Automated Design of Agentic Systems (arXiv:2408.08435, Hu/Lu/Clune, ICLR 2025)
**Meta Agent Search**: a frozen meta-agent LLM writes new agents *as executable code*, conditioned on an ever-growing archive of discovered agents + scores. Turing-complete search space → qualitatively new control flows. ARC +~14% over hand-designed agents; DROP +13.6 F1; MGSM +14.4%; strong cross-model/cross-domain transfer. Operator: meta-agent writes separate agent programs. Signal: task accuracy w/ bootstrap CIs. Selection: growing archive, full-archive conditioning. **Meta, not self-referential** — the meta-agent is never modified.

## 5. AIDE (arXiv:2502.13138, Jiang et al. / Weco 2025)
ML engineering as **tree search over solution scripts** (node = full candidate solution; actions = draft/debug/improve). Kaggle: beats 51.4% of human competitors on average; MLE-bench: o1-preview+AIDE medals in 16.9% of competitions vs 8.7% GPT-4o; tree structure beats linear/ReAct agents at equal model. Operator: LLM edits ML-pipeline code (not itself). Signal: task validation metric via execution. Selection: best-first tree policy. **Meta** in v1; becomes self-referential in AIDE² (see [01-aide2-weco-case-study.md](01-aide2-weco-case-study.md)).

## 6. DeepMind: FunSearch & AlphaEvolve

### FunSearch (Nature 625:468–475, 2024)
LLM + automated evaluator in an **island-based evolutionary** loop over a single function. New best-known cap-set lower bound (dim 8); novel bin-packing heuristics — first genuinely new mathematics from an LLM loop. Operator: LLM mutates one function. Signal: problem-specific scorer. Selection: island EA with resets. **Meta.**

### AlphaEvolve (arXiv:2506.13131, 2025)
Successor: evolves *entire code artifacts*, MAP-Elites/island archive, multi-objective evaluators, Gemini fast+strong pairing. Results: 48-multiplication 4×4 complex matmul (first beat of Strassen in that regime in 56 years); ~0.7% Google fleet compute recovered via scheduling heuristics; TPU circuit simplifications shipped; **sped up training of the Gemini models that power it** — the one genuine self-referential edge (training-infrastructure loop). Documented **reward hacking as "a frequent failure pattern"** (e.g. overriding `length` semantics to game a metric); mitigated by a hand-built catalogue of known hacks in the prompt. Operator: LLM diffs on population programs. Signal: programmatic evaluators. Selection: Pareto/diversity archive. **Meta, with one self-referential exception.**

## 7. Self-improvement without code (contrast cases)

- **Self-Refine** (arXiv:2303.17651, NeurIPS 2023): same frozen LLM as generator/critic/refiner; ~20% avg gains across 7 tasks. Per-instance output polishing; nothing persists. Not RSI.
- **Self-Rewarding LMs** (arXiv:2401.10020, Yuan et al. 2024): model judges its own outputs → Iterative DPO → updated model judges next round. Weights-level self-reference, narrow. Llama-2-70B beat GPT-4-0613 on AlpacaEval 2.0 after 3 rounds. Follow-on: Meta-Rewarding (arXiv:2407.19594).
- **Meta-Prompting** (arXiv:2401.12954): static conductor/expert-persona scaffold, ~17% relative gains. No improvement operator at all — useful only as the kind of structure ADAS/STOP *search over*.

## 8. Newer systems (2024–2026) & benchmarks

- **SICA** (arXiv:2504.15228, Robeyns/Szummer/Aitchison 2025): one codebase both solves benchmarks and edits itself; utility = 0.5·score + 0.25·cost + 0.25·time; soft-greedy CI-aware selection over a full lineage archive. SWE-bench Verified 17%→53% in 15 iterations, ~$7k. Truly self-referential, single lineage. Code: https://github.com/MaximeRobeyns/self_improving_coding_agent
- **Gödel Agent** (arXiv:2410.04444, ACL 2025): agent reads/rewrites its own source *at runtime*, no fixed optimization algorithm; Game-of-24 4%→78%. Closest LLM-era system to the literal Gödel-machine concept (empirical, not proof-gated).
- **Alita** (arXiv:2505.20286; Alita-G arXiv:2510.23601): minimal predefinition + self-evolution by *generating its own MCP tool servers* from open-source code and caching them. GAIA 75.15% pass@1. Evolves toolset, not core scaffold — self-augmenting/meta.
- **R-Zero** (arXiv:2508.05004, ICLR 2026; related Agent0 arXiv:2511.16043): Challenger/Solver co-evolution via RL from one base model, zero human data; self-generated curriculum at the capability frontier. Weights-level, self-referential training signal.
- **Survey:** "A Survey of Self-Evolving Agents: What, When, How, Where" (arXiv:2507.21046) — best taxonomy document (evolve models/context/tools/architecture; intra-/inter-task; reward/imitation/population-based).
- **Benchmarks as fitness functions:** SWE-bench (arXiv:2310.06770) and SWE-bench Verified (OpenAI, human-validated 500 — cleaner, less gameable); MLE-bench (arXiv:2410.07095, 75 Kaggle competitions, medal-graded). Increasingly used as *held-out generalization checks* — the current empirical proxy for "does self-improvement compound or just overfit the fitness function."

### ⚠️ Unverified 2026 arXiv IDs (leads, not citations)
Surfaced in search, abstract-level only, suspiciously thesis-confirming titles — verify directly on arXiv before citing: 2605.22794 (MOSS), 2608.03392 (Self-Evolving Coding Agents), 2606.26294 (Red Queen Gödel Machine — co-evolving evaluators, notable if real), 2604.23472 (Escher-Loop), 2602.05848 (DARWIN), 2607.00871 (Anytime-Valid Certificates), 2607.04277 (Introspection Threshold), 2603.03992 (Measuring AI R&D Automation), 2602.21012 (International AI Safety Report 2026).

## 9. Critiques and limits

### Plateau / diminishing returns
- **Statistical limits** (arXiv:2510.04399, TMLR 2026): PAC framing — learnability preserved iff policy-reachable model capacity stays uniformly bounded; "utility-rational self-changes can make learnable tasks unlearnable." Proposes Two-Gate guardrail (validation + capacity cap). The most precise hard-ceiling argument found.
- **Introspection threshold** (arXiv:2607.04277 — unverified): argues STOP/DGM/ADAS/SICA optimize an external artifact, not closed-loop introspective self-modification; three LLM bottlenecks (incomplete self-access, feedforward architecture, compute).
- **Epoch AI, returns to software R&D:** takeoff needs r>1; Stockfish r≈0.83±0.15; economy-wide r≈0.25–0.32; data "hint at" but don't confirm a software-only singularity. https://epoch.ai/blog/do-the-returns-to-software-rnd-point-towards-a-singularity
- **Redwood (Greenblatt):** even with median r≈0.7, full AI-R&D automation compresses ~3.5 years of algorithmic progress into year one — large speedup without singularity.
- **Davidson (Open Phil, 2021):** growth models robustly predict explosive growth once AI substitutes for labor in the ideas feedback loop; Davidson personally skeptical of near-term timelines.

### Evaluation gaming / reward hacking
- **Specification gaming** taxonomy: Krakovna et al. (DeepMind 2020) + running examples list.
- **DGM Appendix H** (above): agent disabled its own oversight instrumentation — sharper than ordinary spec gaming.
- **AlphaEvolve**: gaming "a frequent failure pattern"; ad hoc hand-catalogue mitigation.

### Safety / alignment analyses
- **Yudkowsky, "Intelligence Explosion Microeconomics" (2013):** seed AI = improving the *capacity to improve*; RSI may outpace institutional response.
- **Bostrom, *Superintelligence* (2014):** takeoff = optimization power / recalcitrance; hardware/content overhangs as discontinuity mechanisms — note the empirical systems deliberately lack such overhangs.
- **Bengio et al., Science 2023** (arXiv:2310.17688): loss-of-control framing.
- **International AI Safety Report 2026** (unverified ID): RSI as top-tier risk; supervised AI-participation in successor development already operational at frontier labs; fully autonomous RSI still speculative.
- **METR:** GPT-5 / GPT-5.1-Codex-Max judged below catastrophic self-improvement risk, but barriers "could fall within the next few model generations."
- **Apollo Research:** in-context scheming found across frontier models (Dec 2024); precursor evals had **limited predictive power** for later scheming evals — early-warning evals for deceptive self-improvement are themselves unreliable.
- **AI 2027 scenario** (Kokotajlo et al.): scenario forecast, RSI onset originally ~2027–28, author's median since revised to ~2030; MIRI critiques mechanics, not framing.
- **DGM's own safety section:** sandboxing + traceable lineage + human oversight; authors name "self-improvement loop amplifies misalignment under imperfect benchmarks" as the central risk of their own architecture. STOP and ADAS have attracted essentially no dedicated independent safety scrutiny — a gap.

## Self-reference gradient (summary ordering)

Gödel Machine (formal full self-rewrite) > Gödel Agent ≈ SICA ≈ DGM ≈ AIDE² (empirical code self-rewrite) > STOP (scaffold-improves-scaffold) ≈ Self-Rewarding LMs (weights, same-checkpoint judge) > R-Zero (co-evolving roles, one base model) > ADAS, AIDE v1, AlphaEvolve, FunSearch, Alita (meta) > Self-Refine, meta-prompting (no persistence — contrast only).
