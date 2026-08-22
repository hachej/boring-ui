# Alternative approaches: self-improvement bets outside the code-evolution loop

2026-08-17. The main synthesis ([README.md](README.md)) covers one family: LLM mutates a code artifact, benchmark scores it, gate accepts into an archive. This doc maps the *other* families — what substrate they improve, what replaces the benchmark, and which invariant of [04-generalization-premises.md](04-generalization-premises.md) each one attacks. Sources verified on arXiv unless flagged.

## The map: eight different bets

Each family removes a constraint the code-evolution loop is stuck with:

| Family | Substrate | Replaces the benchmark gate with | Constraint it removes |
| --- | --- | --- | --- |
| 1. Self-play RL | weights | self-generated tasks + verifiable oracle | frozen-weights ceiling; external benchmark |
| 2. Test-time training | weights (at inference) | self-supervised / post-update reward | the offline train/deploy split |
| 3. Memory & skill libraries | external memory | task outcome → curation decision | needs no model or code access at all |
| 4. Prompt/text optimization | prompts / textual variables | reflective critique, textual "gradients" | whole-artifact accept/reject (adds credit assignment) |
| 5. Verification & debate | weights + a co-evolved judge | adversarial/learned verifier | the assumption that a reliable grader exists |
| 6. Architecture-level self-reference | the learning rule itself | meta-learning loss | the harness/model separation |
| 7. Certified self-modification | bounded adapter/harness | statistical/logical proof | trust in an unbounded stream of self-edits |
| 8. Open-endedness & culture | problem+solution populations | co-evolved environments, "interestingness" | the fixed fitness function itself |

## 1. Weight-level self-improvement via self-play RL

- **Absolute Zero** (arXiv:2505.03335, NeurIPS 2025): one model plays proposer (invents tasks) and solver, with a **code executor as the only ground-truth oracle**, zero human data. The curriculum and environment are self-invented; improvement is measured by generated-task learnability, not a held-out benchmark.
- **STaR** (arXiv:2203.14465, 2022): generate rationales → keep the ones reaching correct answers → fine-tune → repeat. The ancestor of the whole self-training lineage.
- **ReST** (arXiv:2308.08998): offline grow/improve batches of self-sampled data ranked by reward — continuous policy improvement, no discrete variant archive.
- **SPIN** (arXiv:2401.01335): the model plays against its own prior checkpoint (discriminate self-generated vs. human responses) — GAN-like, needs no reward model or benchmark at all.
- Test-time verification scaling: SETS (arXiv:2501.19306), T1 (arXiv:2504.04718) — scale inference compute per query instead of generations in an archive.

**Why it's a different bet:** attacks the code-loop's hard ceiling (frozen weights). The model itself gets better, not just its harness. The cost: it only works where a verifiable oracle exists (math, code execution) — the fitness-defense problem (I5) becomes *oracle design*.

## 2. Test-time training — weights update at inference

- **SEAL** (arXiv:2506.10943, MIT 2025): the model authors its own finetuning data and directives ("self-edits"), applies real gradient updates to itself, and an outer RL loop rewards self-edits by post-update performance. The model literally decides what and how to learn at deployment.
- **TTT layers** (arXiv:2505.23884, arXiv:2503.11842): fast weights updated by self-supervised loss during the forward pass — adaptation baked into the architecture; there is no candidate to accept or reject, every forward pass *is* an update.

**Why different:** dissolves the discrete propose→evaluate→accept cycle entirely. The open question it inherits: without a gate, nothing defends against bad updates — SEAL needs its outer RL loop as an implicit gate, and TTT confines updates to fast weights. The invariants don't disappear; they get pushed into architecture.

## 3. Memory/experience improvement — no weights, no code

- **Voyager** (arXiv:2305.16291): ever-growing skill library of validated executable snippets; skills transfer zero-shot to new worlds. Improvement = a growing stdlib, not an evolved agent.
- **Reflexion** (arXiv:2303.11366): failures become natural-language self-critiques stored in episodic memory — "verbal RL," reward converted straight to in-context text.
- **Dynamic Cheatsheet** (arXiv:2504.07952): generator + curator maintain a persistent strategy memory around a **fully black-box API model** — proof that self-improvement needs zero access to weights or scaffold internals.
- **ArcMemo** (arXiv:2509.04439): concept-level (not instance-level) abstractions distilled from reasoning traces, composed at test time — a bet on memory *representation* (abstractions recombine; verbatim cases don't).
- CBR survey (arXiv:2504.06943) grounds this in decades of case-based-reasoning theory. (EvoLib arXiv:2605.14477 — unverified.)

**Why different:** cheapest possible substrate, works today, on rented closed models, with zero infrastructure. The archive (I7) *is* the whole system; the gate is the curation decision. This is the family most directly transplantable to business processes — a curated "what worked" memory is a Dynamic Cheatsheet.

## 4. Prompt/context optimization — textual gradients

- **GEPA** (arXiv:2507.19457, ICLR 2026 oral): reflective natural-language critique of execution traces evolves prompts over a Pareto tree — **beats RL on sample efficiency** for optimizing compound systems. Language-level reflection needs a handful of rollouts where RL needs thousands.
- **Promptbreeder** (arXiv:2309.16797): evolves task-prompts *and the mutation-prompts that mutate them* — the mutation operator under its own evolutionary pressure, a self-referential twist AIDE²/DGM don't have.
- **TextGrad** (arXiv:2406.07496): backpropagates natural-language critiques through a computation graph of LLM calls — imports backprop's *credit assignment* (which component failed) into text, vs. the code-loop's holistic accept/reject of a whole mutated artifact.

**Why different:** the code loop can only say "the whole variant scored worse"; TextGrad-style credit assignment says *which part* to fix. Sample efficiency is the headline: reflection extracts far more signal per rollout than a scalar score does — directly relevant when evals are expensive (I3).

## 5. Verification, debate, weak supervision — when no reliable grader exists

- **Prover-Verifier Games** (arXiv:2407.13692, OpenAI): helpful and sneaky provers co-evolve against a small trained verifier; optimizing *legibility to a weak checker*, which transfers to human checkability. The gate is a **trained adversarial party**, not a static benchmark.
- **Weak-to-strong generalization** (arXiv:2312.09390): elicit strong-model capability under supervision *known to be weaker* than the model — the regime the benchmark-gated loop structurally cannot enter (it assumes the grader is reliable).
- **Debate** (arXiv:1805.00899 + 2025–26 follow-ups arXiv:2505.03989 etc.): adversaries argue before a weak judge; designed for open-ended domains with no executable scorer.

**Why different:** this family is the answer to the code-loop's deepest assumption — that a trustworthy fitness function exists (I2/I5). Where it doesn't (strategy, judgment, taste), the alternative is to *construct* the signal adversarially. This is the research line that eventually gates everything else.

## 6. Architecture-level self-reference

- **Self-referential weight matrix** (arXiv:2202.05780, ICML 2022, Schmidhuber lab): the network's weights rewrite the rule by which weights are rewritten — the learning algorithm as a differentiable, self-modifiable object; no harness/model boundary at all. (Kirsch & Schmidhuber self-referential meta-learning: OpenReview only, arXiv ID unconfirmed.)
- **DiscoPOP** (arXiv:2406.08414): LLM discovers a novel preference-optimization *loss function* — mechanically a code-evolution loop, but the artifact is the training algorithm of other models. Boundary case: same mechanism, categorically deeper target.

**Why different:** modifies the improvement process itself continuously, rather than a discrete artifact — the pure-research end of the spectrum; nothing here is deployable, but it's the direction "ignition" (improving the ability to improve) would formally live in.

## 7. Certified self-modification — the Gödel line, modernized

- **Gödel Machine** (arXiv:cs/0309048): proof-gated self-rewrite — the ancestor DGM traded provability away from.
- **Tiling Agents / Vingean Reflection** (MIRI reports, not on arXiv): can an agent *ever* soundly trust its own successor? Löb's theorem says naive proof-based self-trust fails — the formal core of why RSI safety is hard.
- **SEA — Self-Evolving Agents with Anytime-Valid Certificates** (arXiv:2607.00871 — very new, verify before heavy citation): gates an **unbounded stream** of self-edits with sequential e-process statistics under a global error budget, explicitly correcting for the distribution shift each edit induces, and confines edits to a versioned adapter/harness around a frozen model. The most practical modern answer to "how do you gate self-modification with guarantees instead of vibes."

**Why different:** everything else gates empirically and hopes; this family makes the gate itself (I4) and the signal-defense (I5) *provable* — anytime-valid statistics is the same machinery a business would need to gate an unbounded stream of process changes without p-hacking itself.

## 8. Open-endedness and cultural evolution — evolve the benchmark too

- **POET / Enhanced POET** (arXiv:1901.01753, arXiv:2003.08536): co-evolve problems *and* solvers; solutions to easy environments become stepping stones to hard ones. The benchmark is never fixed — problem generation is part of the loop.
- **OMNI / OMNI-EPIC** (arXiv:2306.01711, arXiv:2405.15568): an LLM models human "interestingness" (learnable × novel × meaningful) to choose what to attempt next; OMNI-EPIC generates environments as code. The crisp gate becomes a soft learned curriculum policy.
- **Cultural evolution in LLM populations** (arXiv:2412.10270, arXiv:2403.08882): norms/conventions improve across agent generations via peer observation and imitation — no archive, no gate, no scorer; culture is the improvement mechanism.

**Why different:** directly answers the eval-decay consequence in doc 04 ("fixed benchmarks get learned out"): don't defend a fixed fitness function, *co-evolve it*. This is where the "loop that improves its own instrumentation" goes to its logical conclusion — and it's the family Weco's own "harness engineering" task type gestures at.

---

## Judgment: how the bets stack

1. **Near-term practical (adoptable now, any process):** family 3 (memory/curation — works on black-box models with zero infra) and family 4 (reflective prompt evolution — GEPA's beat-RL-on-samples result matters most where evals are expensive). These two compose with, rather than replace, the code-evolution loop.
2. **Medium-term structural:** family 8 (co-evolving the eval) fixes the code loop's decaying-benchmark problem; family 7 (anytime-valid gates) fixes its statistically-unsound acceptance problem. Both are upgrades to the *gate and signal* of the existing loop — consistent with the thesis that all the value is in the eval.
3. **The frontier-lab bets:** families 1–2 (weights: self-play, SEAL-style self-directed finetuning) are where the ceiling actually moves, but they need training access and verifiable oracles — not where a scaffold-level operator competes.
4. **The eventual bottleneck:** family 5. Every other family assumes some signal; verification/debate/weak-to-strong is the research on *manufacturing* signal where none exists — the last unsolved dependency of the whole program.

**Unverified items (do not cite without checking):** EvoLib (2605.14477), Kirsch & Schmidhuber SRML arXiv ID, SEA (2607.00871 — very new), MIRI reports (intentionally not on arXiv).
