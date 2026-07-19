# Skill Size Reduction

Use for `/skill:skill-management reduce-size <skill-path>`. The goal is lower
active context load with the same predictable process—not a smaller file at the
cost of behavior.

## Method

1. **Baseline.** Record the target `SKILL.md` word and byte counts. Use an
   existing tokenizer when available; do not add a dependency only to estimate
   tokens.
2. **Inventory.** Read the full skill, every context pointer it requires, and
   canonical project policy. List invocation branches, commands, hard
   guardrails, authority boundaries, numeric bounds, completion criteria, and
   proof/handoff requirements.
3. **Shape.** Keep `SKILL.md` as the smallest reliable router. Inline what every
   branch needs; move branch-only reference behind a precise pointer. Keep each
   meaning in one canonical owner:
   - Boring policy in `docs/kanzen/`;
   - raw external methods in `.agent/skills/*/references/`;
   - active discovery skills in `.agents/skills/`.
4. **Prune.** Remove duplication, stale sediment, and sentence-level no-ops.
   Prefer strong leading words and positive target behavior. Retain hard
   prohibitions where safety or authority requires them.
5. **Compare.** Diff the result against the inventory. Check every load-bearing
   item, invocation mode, pointer, relative path, and completion criterion.
   Size reduction never changes an explicit-only skill into a model-invoked
   skill or hides must-read material behind a conditional pointer.
6. **Prove.** Run skill/frontmatter validation when available, reference-path
   checks, `git diff --check`, and the repository's active-policy checks.
7. **Review.** Obtain an independent before/after policy-preservation review;
   integrate material findings and re-review non-trivial fixes.

No file deletion or replacement of external source material is implied by this
method; follow repository safety rules.

## Completion criterion

Finish only when active words/bytes are lower (or the exception is explained),
every safety/authority rule and user-visible behavior is preserved, all pointers
resolve, proof is green, and independent review is clean. Any other behavior
change requires explicit user approval and must be listed in the handoff. Report
before/after counts plus the canonical destinations of moved policy.
