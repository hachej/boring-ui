---
name: present-pr
description: Present a PR to the owner for validation as one self-contained artifact — composed context visuals, a review-history audit trail, an area→package→file sankey, a file tree, and importance-ordered diffs each carrying a one-line rationale. Use as the final step of every implementation PR, before requesting owner validation.
---

# Present PR

**This is the standard final step of every implementation PR: before requesting owner
validation, generate the presentation (composed context visuals + summary + sankey +
importance-ordered diffs) and publish/hand the artifact to the owner.**

The review flow it encodes, in the owner's own order:

1. **What review already happened** — was this deep-audited? thermo-reviewed? what failed
   and did it get fixed? Answerable yes/no without reading a single comment thread.
2. **What areas/packages are touched** — `packages/` vs `apps/` vs the rest.
3. **Per-package scope check** — a PR reaching into a package it has no business in is
   visible at a glance, with that package's ±line counts on the node.
4. **Why is each file in this PR at all** — one line per file or group, readable by
   skimming headers without opening a single diff.
5. **Most important diffs first** — not alphabetical, not whatever GitHub shows first.

A GitHub PR page answers none of these: it opens on a path-sorted file list with
lockfiles and snapshots competing with the one file that decides the review.

## When to use

- Any implementation PR that is CI-green and audited and needs a merge decision.
- A change spanning several packages, where "which seam does this touch?" comes first.

Do **not** use it as a substitute for the review itself. Present only what you have
already reviewed, and state the open questions.

## Steps

1. **Understand the seam.** Read the production files first. Identify the flow the PR
   changes: entry point → policy/decision → effect. If that shape is not clear in prose,
   read `../show-me/SKILL.md` and use its smallest useful visual in the presentation.

2. **Write the context sidecar** — one markdown file, per PR, at
   `<scratchpad>/pr-<n>-context.md`:

   ~~~markdown
   # PR <n> context

   ```text
   submitForm
     createSession
   +   expandSkillMention
       launchAgent
     navigateToSession
   ```

   ```ts
   type SubmitResult =
   + | { status: 'expanded'; skill: string }
     | { status: 'started'; sessionId: string }
   ```

   Fenced blocks compose the context explanation. Use the smallest combination
   that explains the PR: trees, pseudocode, types/signatures, diff-shaped sketches,
   and Mermaid for state, sequence, component interaction, or data flow.

   Follow with 3–6 sentences of context: the problem, which two or three mechanisms
   changed, what the PR explicitly does **not** do, and what to look at first.

   ## Key files

   - path/to/the/file/that/decides/the/review.ts
   - path/to/the/second/one.ts
   ~~~

   Visual rules: compose complementary views, not a gallery. Each visual must answer a
   distinct review question; omit it if another view already answers that question.
   Show the *mechanism*, not generic architecture. Use `diff` syntax when the surrounding
   shape already exists; show the whole tree or block when most of it is new. Keep only
   the calls, states, files, props, types, and boundaries needed for the decision. Keep
   each view under ~12 nodes/lines; if it needs more, narrow that view.

   Choose and combine by the review questions:

   | Reviewer needs to see | Use |
   | --- | --- |
   | UI ownership, hooks, and boundaries | component tree |
   | backend runtime path or orchestration | call tree / call stack |
   | lifecycle and allowed transitions | Mermaid state diagram |
   | ordering across actors or services | Mermaid sequence diagram |
   | module placement or refactor ownership | shallow file layout |
   | algorithm or policy branch | pseudocode |
   | API or contract shape | types and signatures |
   | before/after shape with mostly shared context | `diff` syntax |
   | visual UI, responsive layout, or interaction feel | focused HTML mockup as the companion artifact; use a component tree or state view as the inline context visual |

   Mermaid blocks are pre-rendered to inline SVG; text, `diff`, pseudocode, trees,
   layouts, types, and signatures render as escaped preformatted shapes. The renderer
   preserves their sidecar order so the explanation can move from structure → behavior
   → contract. Never inject arbitrary HTML into the presentation itself.

   `## Key files` is optional and pins the reading order explicitly, overriding the
   importance heuristic. Use it whenever you know which two or three diffs decide the
   review — you almost always do.

3. **Write the `## Why` block — required, and deliberately cheap.** One line per file
   *group*, matched by glob, budget **~10-15 lines for the whole PR**:

   ~~~markdown
   ## Why

   - packages/boring-sandbox/src/providers/bwrap/** | emit --ro-bind-try per protected prefix after the writable mount
   - packages/boring-bash/src/server/routes/** | 403 mutations of protected paths at the HTTP edge
   - packages/agent/src/server/runtime/userFilesystemBinding.ts | intersect lexical path with realpath so symlinks cannot alias around the policy
   - **/__tests__/** | lock the deny/allow matrix
   ~~~

   **Group-first is the rule, not a shortcut.** Reach for a per-file line only where the
   file carries a mechanism a group line cannot state — in practice, roughly the same
   files as `## Key files`. Globs support `*`, `**/` and a trailing `/**`; the *most
   specific* match wins, so a per-file line always beats the group line covering it.
   Files matching nothing render nothing — that is fine, not an error, and cheaper than
   padding the block with filler.

   Each line answers "why is this file in this PR", in one clause. Not what the diff
   does line-by-line (the diff is right there), not a summary of the PR (section 1 has
   that).

4. **Fill the review history — this is mandatory, not optional.** Add a
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

   **Reconstruct it from the PR's actual audit trail**, and reconstruct it from *all four*
   sources — never from memory or optimism:

   ```bash
   gh pr view <n> --json commits,reviews,comments,mergedAt,mergedBy
   gh run list --branch <head-branch> --limit 30 \
     --json databaseId,name,conclusion,createdAt,headSha            # ← the one agents skip
   gh run view <failing-run-id> --json jobs --jq '.jobs[]|select(.conclusion=="failure")|.name'
   gh run view --job <job-id> --log-failed
   ```

   **The run history is mandatory, not optional.** Reviews and comments alone will make you
   miss the most valuable events on the page: a gate that failed, got diagnosed, and was
   fixed. Those are precisely what the owner wants preserved — a PR whose CI went green on
   the first try and one that went green after a hard gate caught a real regression are
   very different objects, and only the run history tells them apart. Walk the runs on the
   head branch, find every `conclusion: failure`, open the failing job's log, and record
   what failed, what the diagnosis was, and which commit fixed it. Note reruns too: a
   failure that reproduces on rerun is a real defect, not a flake, and that distinction
   belongs in the summary. Cite run ids and fix commit shas so the claim is checkable.

   Do not write `SKIPPED` for a job you did not actually look up. A job that was skipped
   because a path filter excluded it and a job that failed twice then passed after a fix
   look identical from the reviews-and-comments view — and opposite from the run history. Every finding gets its resolution state:
   closed, deferred with stated risk, or open. If a review *did not happen*, record that as
   an event with verdict `NOT RECORDED` and say so; the header badge reads "thermo review:
   NOT recorded" and will not count a `NOT RECORDED`/`SKIPPED` thermo entry as evidence of
   review. Recording an absence honestly is the point of the section.

   Omitting the block entirely does not hide the gap: the artifact renders a red
   "No review history recorded — treat as unreviewed" panel in its place.

5. **Generate the page — into the lane worktree, not a scratchpad:**

   ```bash
   mkdir -p .handoff
   node scripts/present-pr.mjs <pr-number> \
     --repo hachej/boring-ui \
     --context <scratchpad>/pr-<n>-context.md \
     --audit "deep audit <date>: N findings closed, M deferred" \
     --out .handoff/pr-<n>-presentation.html
   ```

   `.handoff/` is gitignored and lives **inside the workspace root**, which is
   what makes the next step possible: the workspace file API is relative-only,
   so a page written to a scratchpad outside the worktree cannot be opened as a
   pane.

   The script pulls metadata, checks, and the combined diff via `gh` and renders one HTML
   file with no external requests — safe for the artifact viewer's strict CSP. Mermaid is
   emitted as `<pre class="mermaid">`, which artifacts render natively.

6. **Hand it over as two panes — the standard handoff.** Working inside a
   workspace session, the artifact is not a link, it is a pane:

   ```jsonc
   // the review artifact
   { "kind": "openFile",  "params": { "path": ".handoff/pr-<n>-presentation.html" } }
   // the live demo, if the change has a running surface
   { "kind": "openPanel", "params": { "id": "demo:br-<id>", "component": "url-pane.panel",
                                      "params": { "url": "http://127.0.0.1:<port>/", "title": "br-<id> demo" } } }
   ```

   Both via `exec_ui`. The `.html` path resolves to the sandboxed HTML viewer;
   `url-pane.panel` embeds the running server (loopback origins are allowed by
   default — see `packages/workspace/docs/URL_PANE.md`). Then send the owner
   card through `ask_user`, naming both panes, with the decision you want and
   the open questions.

   Outside a workspace session, fall back to publishing the page as an artifact
   and handing over the URL.

## What the page gives the reviewer

- **Header** — title, author, branch pair, churn, live CI check tally, audit status.
- **Section 1 — what this touches.** The composed context visuals and summary.
- **Section 2 — review history.** A chronological audit trail with type badges, per-event
  verdict, who ran it, and a 1-line finding summary with resolution state. A headline badge
  answers "thermo review: recorded / NOT recorded" at a glance. Absent history renders as an
  explicit warning, never as an omitted section.
- **Section 3 — changes.** A file **tree** on the left (directories nested with
  single-child chains collapsed, counts rolled up, a category dot per file, group
  rationale on directory rows) linked to the diff panel on the right: clicking a tree row
  scrolls to and expands that diff. The tree is the spatial view; the panel keeps
  importance order.
  Within that:
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
  - **One line of rationale inside every file header**, visible while the diff is
    collapsed — skimming the headers is skimming the rationale. The same line is the tree
    row's hover title.

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
