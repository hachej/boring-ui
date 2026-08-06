# Visual Review Documents

Owner gates are reviewed as **self-contained HTML documents**, not prose
walls. Every plan-approval intention (gate 1) and PR/merge intention (gate 2)
links a review doc built to the matching skeleton below, delivered through the
artifact transport and linked to the bead (thread=bead).

Rules:

- Self-contained HTML, Mermaid for all diagrams (`<pre class="mermaid">`),
  no external services. Readable on a phone in ~10 minutes.
- Lead with the single highest-value diagram, above the fold, before prose.
- Tables for enumerable facts (risks, decisions, coverage); diagrams for
  structure and flow; prose only to explain a choice.
- Shared elements across both docs: header strip (title, status pill,
  one-line TL;DR, bead ID), risk table format (Risk | Likelihood | Impact |
  Mitigation, color-coded cells).

## Plan doc (gate 1)

Section order:

1. Header strip — title, status, author seat, date, TL;DR, epic/bead IDs.
2. Goals / Non-goals — two-column table, ≤5 bullets each.
3. Proposed architecture — Mermaid `flowchart` or `C4Container`. Mandatory.
4. Bead/dependency graph — Mermaid `graph LR`, nodes = beads, edges =
   blocks/depends-on. Only when >3 beads.
5. Key flow — one Mermaid `sequenceDiagram` for the new/risky interaction.
   Omit when trivial.
6. Decisions table — Decision | Options | Chosen | Why (absorbs ADRs inline).
7. Risks table.
8. Open questions — each tagged with who answers.
9. Proof path and references.

## PR doc (gate 2)

Section order:

1. Header strip — PR title, CI status, risk badge, what-changed-and-why line.
2. Changed-component map — one Mermaid `flowchart`: changed nodes
   highlighted, context nodes dimmed (before/after in one diagram).
3. New/changed flow — Mermaid `sequenceDiagram`; skip for pure refactors.
4. Annotated walkthrough — collapsible per-file sections, 1-2 sentence "why"
   per hunk. Never a raw diff dump (GitHub owns the diff).
5. Risks table.
6. Test coverage — area | tests added/changed | manual verification | gaps.
7. Reviewer checklist — 3-5 targeted yes/no questions for this change, not a
   generic list.
8. Proof links — CI run, bead, issue, related PRs.

Format sources: Google design docs, Stripe-style RFCs, arc42 + C4 levels,
standard risk-matrix practice. Diagram authoring guidance:
`.agents/skills/ui/visual-report-bundle.md`.
