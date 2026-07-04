# Quality Metrics

What "good" means, measured. The Polish Bar is the qualitative rubric; this file is its quantitative companion. Every run should emit a `phase_metrics.json` reporting these numbers at build time.‍​‌‌​​‌‌​​‌‌​​​​‌​‌‌​​​‌​

---

## Primary metrics

### Coverage (quantitative)

- **API coverage**: for a library with auto-extractable public API, *N / M* of public items have a documentation page, where N = documented items and M = total public items. Target: **100%** for reference-quality libraries; **≥80%** acceptable for a first-pass.
- **Command coverage**: for a CLI, every subcommand has a page. Target: **100%**.
- **Section coverage**: every section identified in Phase 0 partition has ≥1 page. Target: **100%** by end of Phase 2.
- **Example coverage**: ratio of reference pages that have at least one code example. Target: **≥90%**.

### Density (qualitative-ish)

- **Word count per page**: sweet spot 300–2000 words. Flag pages <150 (underbaked) or >3000 (DECOMPOSE candidate).
- **Code-to-prose ratio**: weight of code blocks ÷ total content length. Target 15%–40% for non-reference pages; higher is fine for Reference.
- **Example-to-prose ratio**: count of fenced code blocks × 30 (rough word-equivalent) ÷ total word count. Target ≥10%.
- **Cross-link density**: in-repo links ÷ page word count × 1000. Target ≥4 per thousand words; <2 is a "dead-end" warning.
- **Mental-model density**: pages with mermaid or FileTree or Cards ≥1. Target ≥30% of non-Reference pages.

### Readability

- **Flesch Reading Ease**: run against prose blocks (excluding code). Technical docs should target 50–70 (high-school to college). <50 = too dense; >80 = likely missing technical detail.
- **Average sentence length**: target 15–22 words. >25 is usually salvageable by splitting.
- **Passive voice ratio**: target <20% of sentences.

### AI-slop detection (based on `de-slopify` skill)

Flag pages where any of these exceed thresholds:

| Pattern | Threshold | Action |
|---------|-----------|--------|
| Emdashes (`—`) | >2 per 1000 words | `de-slop` operator |
| "Here's why" | any occurrence | rewrite |
| "It's not X, it's Y" | any occurrence | rewrite |
| "Let's dive in" | any occurrence | delete |
| "At its core" | any occurrence | rewrite |
| "It's worth noting" | >0 occurrences | rewrite or cut |
| "In this section" / "In this guide" | >2 occurrences | rewrite (headings already say this) |
| "Simply" / "Just" | >3 occurrences per page | review — often patronizing |

### Structural quality

- **Heading hierarchy**: no skipped levels (h2→h4). Target 100% compliance.
- **ORPHANS**: every `.mdx` is referenced from `_meta.global.tsx` or from another page. Target 0 orphans.
- **BROKEN LINKS**: 0 allowed.
- **TRAILING TODOs / placeholders**: 0 allowed by Phase 5 end.
- **Empty sections**: heading with no content. Target 0.

---

## The metrics dashboard​​‌‌​​​​​‌‌​​‌​​​​‌‌​​‌‌

`scripts/audit-content.mjs` emits `phase_metrics.json`:

```json
{
  "timestamp": "2026-04-22T12:00:00Z",
  "total_pages": 47,
  "total_words": 28142,
  "coverage": {
    "sections_documented": "5/5",
    "api_coverage_pct": 87,
    "pages_with_example": "41/47",
    "pages_with_mental_model": "28/47"
  },
  "density": {
    "median_words_per_page": 612,
    "p5_words_per_page": 180,
    "p95_words_per_page": 1840,
    "pages_under_150_words": 1,
    "pages_over_3000_words": 0,
    "avg_links_per_page": 4.7
  },
  "readability": {
    "avg_flesch_reading_ease": 58.2,
    "avg_sentence_length": 18.4,
    "pages_below_flesch_40": 2
  },
  "slop": {
    "emdash_per_1000_words": 0.8,
    "pattern_violations": [
      {"path": "guides/auth.mdx", "pattern": "Here's why", "count": 1}
    ]
  },
  "structural": {
    "heading_skips": 0,
    "orphan_pages": 0,
    "broken_links": 0,
    "trailing_todos": 0
  },
  "operator_coverage": {
    "orient": "47/47",
    "motivate": "44/47",
    "mental_model": "28/47",
    "exemplify": "41/47",
    "warn": "31/40",
    "cross_link": "47/47"
  }
}
```

The main agent consults this between phases to decide "are we done yet?".

---

## Exit-criteria by phase

### Phase 3 exit
- `sections_documented` == `N/N`
- `pages_with_example` ≥ 60%
- Overview tree (6 canonical pages) all present
- `broken_links` == 0

### Phase 4 exit
- `pages_with_mental_model` ≥ 30%
- `pages_with_example` ≥ 90%
- `emdash_per_1000_words` ≤ 2
- `pattern_violations` empty for critical patterns (Here's why / It's not X, it's Y / Let's dive in)​‌‌​​‌​​​‌‌​​​​‌​‌‌​​​​‌
- `avg_links_per_page` ≥ 3
- `operator_coverage.orient` == `N/N`
- Termination rule: prior pass's changes are all tagged `[trivial]` in log

### Phase 5 exit
- `orphan_pages` == 0
- `trailing_todos` == 0
- Glossary has every term on first-use list
- All P1–P8 from content-lint pass

### Phase 6 exit (after all subphases)
- `bun run build` green
- `bun run typecheck` clean
- `api_coverage_pct` ≥ 90 (if TSDoc applicable)
- Bundle size < 100 KB first-load JS

### Phase 7 exit
- Three fresh-eyes rounds produced only trivial changes twice in a row
- `ubs .` clean (if available)
- `broken_links` == 0 after uplift (edits can re-break links)

---

## Nielsen heuristics mapping (for `/ux-audit` equivalents)

| # | Nielsen heuristic | Doc-site application | Metric |
|---|-------------------|----------------------|--------|
| 1 | Visibility of system status | Loading states for remote MDX | manual |
| 2 | Match real-world language | No jargon without glossary entry | orphan glossary terms |
| 3 | User control and freedom | Undo search, clear filters | keyboard test |
| 4 | Consistency | Same component for same job (always `<Callout>` for warnings) | grep audit |
| 5 | Error prevention | "Did you mean…" on 404 page | 404 page exists |
| 6 | Recognition over recall | Sidebar always visible, breadcrumbs on | theme config |
| 7 | Flexibility & efficiency | Keyboard shortcuts (search, nav) | shortcut overlay visible |
| 8 | Aesthetic & minimalist | No wall of text; generous spacing | visual review |
| 9 | Recover from errors | Edit-on-GitHub link on every page | `editLink` set |
| 10 | Help and documentation | (meta: the docs ARE the help) | — |

Phase 9 Playwright smoke checks #3, #5, #6, #9 automatically; the rest are visual review.

---

## Accessibility (WCAG AA targets)

Run `axe-core` via `scripts/a11y-check.sh` against the built site. Required passes:

- **1.1.1 Non-text Content**: all images have alt text. (Images without alt are common in auto-generated diagrams — check mermaid SVG titles.)
- **1.3.1 Info & Relationships**: semantic headings, no visual-only structure.​‌‌​​​‌‌​‌‌​​‌​‌​‌‌​​‌​‌‍
- **1.4.3 Contrast (Minimum)**: text 4.5:1, large text 3:1. Dark-mode pages often fail here after custom theming.
- **2.1.1 Keyboard**: all functionality reachable via keyboard.
- **2.4.1 Bypass Blocks**: skip-to-content link present.
- **2.4.6 Headings & Labels**: descriptive, not "Click here" or "Learn more".
- **4.1.2 Name, Role, Value**: correctly-labeled components (check custom React components in particular).

Target: **zero critical violations** by Phase 9.

---

## Performance budgets

- **First-load JS**: < 100 KB gzipped
- **CSS**: < 50 KB
- **Largest Contentful Paint (LCP)**: < 2.5s on throttled 4G
- **Cumulative Layout Shift (CLS)**: < 0.1
- **Time to Interactive (TTI)**: < 3.5s on throttled 4G

Measure via Lighthouse in CI, or run `lighthouse https://yoursite.com --output=json` manually. Budget overruns are often caused by:
- Mermaid on every page (use lazy loading or only on pages that need it)
- Shiki with all themes (pick two)
- Large OG images requested by preloaders
- Unthemed webfonts causing FOIT/FOUT

---

## Prose quality (self-scoring rubric per page)

Have a polisher rate each page on these axes (1-5). Anything <3 is rework-worthy.

| Axis | 1 (bad) | 3 (acceptable) | 5 (exemplary) |
|------|---------|----------------|----------------|
| Orient | opens with a signature | clear intro paragraph | sets context, audience, outcome in 3 sentences |
| Motivate | no motivation | motivation present but generic | motivation is specific, names the alternative |
| Teach | misses the "why" | explains how | explains how AND why behind the design |
| Show | no example | one minimal example | example with realistic inputs + output shown |
| Warn | no gotchas | one warning | warnings with explicit fixes |
| Tip | generic advice | one useful tip | non-obvious insight only-experts-know |
| Link | dead-end | 2+ cross-links | deep cross-links to related concepts AND alternatives |
| Concise | bloated | reasonable | every sentence earns place |

Polishers log these in `phase4_polish_log.md` alongside each page edit. Phase 4 termination considers median score ≥ 4.

---

## When the numbers disagree with feel

Metrics are directional, not absolute. A page can fail `pages_with_mental_model` and still be excellent (short reference pages don't need diagrams). A page can pass every metric and still read terribly.

**Rule of thumb**: metrics triage attention. A human reads every flagged page. The human's judgment wins.

Report metrics in the run summary so the user can decide where to spend follow-up time.
