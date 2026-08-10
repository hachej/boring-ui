---
name: present-pr
description: Present a PR to the owner for validation as one self-contained artifact — a context diagram, a review-history audit trail, an area→package→file sankey, and importance-ordered diffs. Use as the final step of every implementation PR, before requesting owner validation.
---

# Present PR

**This is the standard final step of every implementation PR: before requesting owner
validation, generate the presentation (context diagram + summary + sankey +
importance-ordered diffs) and publish/hand the artifact to the owner.**

The review flow it encodes, in the owner's own order:

1. **What review already happened** — was this deep-audited? thermo-reviewed? what failed
   and did it get fixed? Answerable yes/no without reading a single comment thread.
2. **What areas/packages are touched** — `packages/` vs `apps/` vs the rest.
3. **Per-package scope check** — a PR reaching into a package it has no business in is
   visible at a glance, with that package's ±line counts on the node.
4. **Most important diffs first** — not alphabetical, not whatever GitHub shows first.

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

3. **Fill the review history — this is mandatory, not optional.** Add a
   `## Review history` block to the same sidecar, one bullet per event, fields separated
   by `|`:

   ~~~markdown
   ## Review history

   - 2026-08-08 | deep audit | FAIL -> fixed | Opus worker | 6 findings, 4 blocking: <one line each>. Closed by <commit>.
   - 2026-08-08 | thermo review | PASS with findings | Claude Fable 5 | Two buildBwrapArgs copies kept in sync rather than deduplicated; accepted with rationale.
   - 2026-08-09 | CI re-verify | PASS | GitHub Actions | Full matrix green on the merge commit.
   ~~~

   `date | type | verdict | who ran it | 1-line summary with resolution state`. Trailing
   fields may be omitted. Recognised types colour their badge: deep audit, security audit,
   thermo review, pi/code review, fix round, re-verify, UI review, merge. Verdicts are free
   text, tone-matched on `PASS` / `PASS with findings` / `FAIL` / `FAIL -> fixed`.

   **Reconstruct it from the PR's actual audit trail** — commits, review comments, CI runs,
   worker reports — never from memory or optimism. Every finding gets its resolution state:
   closed, deferred with stated risk, or open. If a review *did not happen*, record that as
   an event with verdict `NOT RECORDED` and say so; the header badge reads "thermo review:
   NOT recorded" and will not count a `NOT RECORDED`/`SKIPPED` thermo entry as evidence of
   review. Recording an absence honestly is the point of the section.

   Omitting the block entirely does not hide the gap: the artifact renders a red
   "No review history recorded — treat as unreviewed" panel in its place.

4. **Generate the page:**

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

5. **Publish it as an artifact** and hand the owner the URL with a two-line message: the
   decision you want, and the open questions.

## What the page gives the reviewer

- **Header** — title, author, branch pair, churn, live CI check tally, audit status.
- **Section 1 — what this touches.** The intro diagram and the context summary.
- **Section 2 — review history.** A chronological audit trail with type badges, per-event
  verdict, who ran it, and a 1-line finding summary with resolution state. A headline badge
  answers "thermo review: recorded / NOT recorded" at a glance. Absent history renders as an
  explicit warning, never as an omitted section.
- **Section 3 — changes.**
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
