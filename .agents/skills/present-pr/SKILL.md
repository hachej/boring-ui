---
name: present-pr
description: Present a PR to the owner for validation as one self-contained artifact — a context diagram, an area→package→file sankey, and importance-ordered diffs. Use as the final step of every implementation PR, before requesting owner validation.
---

# Present PR

**This is the standard final step of every implementation PR: before requesting owner
validation, generate the presentation (context diagram + summary + sankey +
importance-ordered diffs) and publish/hand the artifact to the owner.**

The review flow it encodes, in the owner's own order:

1. **What areas/packages are touched** — `packages/` vs `apps/` vs the rest.
2. **Per-package scope check** — a PR reaching into a package it has no business in is
   visible at a glance, with that package's ±line counts on the node.
3. **Most important diffs first** — not alphabetical, not whatever GitHub shows first.

A GitHub PR page answers none of these: it opens on a path-sorted file list with
lockfiles and snapshots competing with the one file that decides the review.

## When to use

- Any implementation PR that is CI-green and audited and needs a merge decision.
- A change spanning several packages, where "which seam does this touch?" comes first.

Do **not** use it as a substitute for the review itself. Present only what you have
already reviewed, and state the open questions.

## Steps

1. **Understand the seam.** Read the production files first. Identify the flow the PR
   changes: entry point → policy/decision → effect.

2. **Write the context sidecar** — one markdown file, per PR, at
   `<scratchpad>/pr-<n>-context.md`:

   ~~~markdown
   # PR <n> context

   ```mermaid
   flowchart TB
     ...one diagram of the seam: which components, which direction data flows,
     which nodes are new (use `classDef new stroke-dasharray: 4 3`)
   ```

   3–6 sentences of context. What problem, which two or three mechanisms changed,
   what the PR explicitly does **not** do, and what to look at first.

   ## Key files

   - path/to/the/file/that/decides/the/review.ts
   - path/to/the/second/one.ts
   ~~~

   Diagram rules: one diagram, not three. Show the *mechanism*, not the file tree. Mark
   new/changed nodes distinctly. Under ~12 nodes — if it needs more, the PR is the
   problem, not the diagram.

   `## Key files` is optional and pins the reading order explicitly, overriding the
   importance heuristic. Use it whenever you know which two or three diffs decide the
   review — you almost always do.

3. **Generate the page:**

   ```bash
   node scripts/present-pr.mjs <pr-number> \
     --repo hachej/boring-ui \
     --context <scratchpad>/pr-<n>-context.md \
     --audit "deep audit <date>: N findings closed, M deferred" \
     --out <scratchpad>/pr-<n>-presentation.html
   ```

   The script pulls metadata, checks, and the combined diff via `gh` and renders one HTML
   file with no external requests — safe for the artifact viewer's strict CSP. Mermaid is
   emitted as `<pre class="mermaid">`, which artifacts render natively.

4. **Publish it as an artifact** and hand the owner the URL with a two-line message: the
   decision you want, and the open questions.

## What the page gives the reviewer

- **Header** — title, author, branch pair, churn, live CI check tally, audit status.
- **Section 1 — what this touches.** The intro diagram and the context summary.
- **Section 2 — changes.**
  - **Sankey navigation** (inline SVG, hand-rolled, no libraries): area → package → file.
    Ribbon width is changed lines, colour is the dominant file category, node bars split
    green/red by additions/deletions. Package nodes carry their own ±counts. Hovering
    isolates a branch; clicking any node jumps to the most important diff beneath it. The
    file level is optional and defaults off above 24 files. Below 4 changed files the
    sankey is skipped entirely.
  - **Category chips** toggle production / test / docs / config / generated, with
    per-category counts. Generated files start off.
  - **Diffs in importance order.** The top file is marked `start here` and the top two are
    pre-expanded; every header shows its rank. A `path` toggle restores tree order.

## Importance heuristic

`score = log2(changed lines + 1) × category weight × surface boost × new-file bonus`

- Category weight: prod 1.0, test 0.45, config 0.4, docs 0.3, generated 0.08.
- Surface boost: `src/shared/**` ×1.6; `types|schema|contract|error-codes` ×1.4;
  `routes|api|server` ×1.25; barrel `index.*` ×1.2.
- Churn is damped logarithmically so a 900-line snapshot cannot outrank a 12-line policy
  change.
- `## Key files` in the sidecar overrides all of it, in the order given.

Tune the weights in `importance()` / `surfaceBoost()` if a repo convention is mis-ranked;
tune `categorize()` (first-match-wins) if a file is mis-bucketed.

## Notes

- `gh pr diff --patch` emits one patch *per commit* and would duplicate files — the script
  deliberately uses the plain combined diff.
- Syntax highlighting is a deliberately small regex tokenizer (comments, strings, numbers,
  keywords). It is legibility, not correctness; no external highlighter is bundled because
  the CSP forbids one.
