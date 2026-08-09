---
name: present-pr
description: Present a PR to the owner for validation as one self-contained artifact — an intro context diagram plus a filterable, GitHub-style diff. Use when a PR is ready for human review/merge approval and the owner needs to understand what it touches before reading code.
---

# Present PR

Owner validation is a *reading* task, not a link-dropping task. A GitHub PR page opens on
an unordered file list with lockfiles and snapshots at the top and no picture of what the
change touches. This skill produces the opposite: one page that opens with a diagram of
the seam being changed, then a diff you can filter down to production code only.

## When to use

- A PR is CI-green and audited, and you are asking Julien for a merge decision.
- A change spans several packages and "which seam does this touch?" is the first question.

Do **not** use it as a substitute for the review itself. Present only what you have
already reviewed, and state the open questions.

## Steps

1. **Understand the seam.** Read the production files (ignore tests/docs on the first
   pass). Identify the flow the PR changes: entry point → policy/decision → effect.

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
   ~~~

   Rules for the diagram: one diagram, not three. Show the *mechanism*, not the file
   tree. Mark new/changed nodes distinctly. Keep it under ~12 nodes — if it needs more,
   the PR is the problem, not the diagram.

3. **Generate the page:**

   ```bash
   node scripts/present-pr.mjs <pr-number> \
     --repo hachej/boring-ui \
     --context <scratchpad>/pr-<n>-context.md \
     --audit "deep audit <date>: N findings closed, M deferred" \
     --out <scratchpad>/pr-<n>-presentation.html
   ```

   The script pulls metadata, checks, and the combined diff via `gh`, categorizes every
   file (production / test / docs / config / generated), and renders one HTML file with
   no external requests — safe for the artifact viewer's strict CSP. Mermaid is emitted
   as `<pre class="mermaid">`, which artifacts render natively.

4. **Publish it as an artifact** and hand the owner the URL, together with a two-line
   message: the decision you want, and the open questions.

## What the page gives the reviewer

- **Header** — title, author, branch pair, churn, live CI check tally, audit status slot.
- **Section 1** — the intro diagram and the context summary.
- **Section 2** — the diff. Category chips toggle whole classes of file off (generated
  files start off), with per-category file and line counts, so "show me only production
  code" is one click. Files are collapsible; oversized and generated files start
  collapsed. Wide diffs scroll inside their own container.

## Notes

- Categorization is first-match-wins in `categorize()`; extend it there if a repo
  convention is mis-bucketed.
- `gh pr diff --patch` emits one patch *per commit* and would duplicate files — the
  script deliberately uses the plain combined diff.
- Syntax highlighting is a deliberately small regex tokenizer (comments, strings,
  numbers, keywords). It is legibility, not correctness; no external highlighter is
  bundled because the CSP forbids one.
