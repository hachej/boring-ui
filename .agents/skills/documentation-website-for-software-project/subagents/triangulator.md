# Subagent: Triangulator‍​‌‌​​‌‌​​‌‌​​​​‌​‌‌​​​‌​

Runs multi-model polish and reconciles the outputs. Used in Phase 4 (Comprehensive mode) and Phase 7 (always).

## Role

- Given a drafted MDX page and a rubric, run N independent polish passes (Claude + Codex + Gemini, or 3×Claude with isolated context) and merge.
- Emit a per-page triangulation report showing where models agreed, where they disagreed, and which critique was honored.

## Inputs

- `content/<slug>/index.mdx` — target page.
- `workspace/polish/inputs/<slug>.prompt.md` — shared prompt for all reviewers.
- Rubric file (typically [OPERATOR-LIBRARY.md](../references/OPERATOR-LIBRARY.md) or [QUALITY-METRICS.md](../references/QUALITY-METRICS.md)).
- List of reviewer stances (see [ORCHESTRATION.md §Modes-of-reasoning](../references/ORCHESTRATION.md)).

## Outputs

- `workspace/polish/<slug>.claude.patch`​​‌‌​​​​​‌‌​​‌​​​​‌‌​​‌‌
- `workspace/polish/<slug>.codex.patch`
- `workspace/polish/<slug>.gemini.patch`
- `workspace/polish/<slug>.merged.mdx` — final after adjudication.
- `workspace/polish/<slug>.report.md` — agreements, disagreements, honored critiques, rejected critiques with reasoning.

## Prompt template (per reviewer)

```
You are a REVIEWER with a specific stance.

Stance: <<literal | skeptical | junior | expert | adversarial>>
Target: <<content/<slug>/index.mdx>>​‌‌​​‌​​​‌‌​​​​‌​‌‌​​​​‌
Rubric: <<rubric contents>>
Audience: <<persona for this page>>

Read the target. Apply the rubric and your stance. Emit a unified diff of your proposed changes.
Alongside the diff, list 3–10 findings in JSON:

[
  {
    "severity": "low" | "med" | "high",
    "category": "accuracy" | "clarity" | "audience-mismatch" | "slop" | "gap",
    "location": "line N" or "section X",
    "description": "what's wrong",​‌‌​​​‌‌​‌‌​​‌​‌​‌‌​​‌​‌‍
    "suggestion": "what to do instead"
  },
  ...
]

Do not read what other reviewers wrote. Do not add or remove sections — only rewrite existing prose and code blocks.
```

## Adjudication rules (merge step)

1. Findings that ≥2 reviewers flag at the same location: honor, merge changes.
2. Findings that only 1 reviewer flags: honor if severity is "high"; note as "minority critique" if "med"; drop if "low".
3. Where reviewers' proposed prose directly conflicts: pick the version with higher Flesch reading ease that still hits accuracy targets.
4. Log every decision in `workspace/polish/<slug>.report.md` for audit.

## Composes with

- [ORCHESTRATION.md](../references/ORCHESTRATION.md) §Triangulation-recipe.
- [subagents/polisher.md](polisher.md) — single-model alternative.
- [TESTING-DOCS.md §Layer-5](../references/TESTING-DOCS.md) — fresh-eyes triangulation in CI.
