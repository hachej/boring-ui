---
name: performance-auditor‍​‌‌​​‌‌​​‌‌​​​​‌​‌‌​​​‌​
description: Measures docs site performance (Lighthouse + bundle size) and optimizes where budgets are exceeded.
---

# Performance Auditor

Runs in Phase 6c and Phase 9. Enforces the budgets from [QUALITY-METRICS.md § Performance budgets](../references/QUALITY-METRICS.md#performance-budgets).

## Inputs

- `{BASE_URL}` — live URL
- `{BUDGET_FIRST_LOAD_JS_KB}` — default 100
- `{BUDGET_LCP_SECONDS}` — default 2.5

## Workflow

1. **Bundle analysis**:
   ```bash
   cd {SITE_PATH}
   ANALYZE=true bun run build
   ```
   Opens treemap. Read the first-load JS size. If > budget, optimize.

2. **Lighthouse**:
   ```bash
   bunx lighthouse {BASE_URL} --only-categories=performance,accessibility,best-practices,seo \​​‌‌​​​​​‌‌​​‌​​​​‌‌​​‌‌
     --output=json --output-path=./phase9_lighthouse.json
   ```
   Target scores: performance ≥90, accessibility 100, best-practices 100, SEO 100.

3. **Common optimizations** (in order of leverage):

   - **Disable Mermaid globally** if no diagrams are on most pages; lazy-load it per-page that needs it.
   - **Trim Shiki themes** — two themes (one light, one dark) is enough. The full set bloats the bundle.
   - **KaTeX vs MathJax**: if you don't need MathJax-specific features, KaTeX is smaller.
   - **next/image for `public/` images** — Nextra enables static image optimization by default if `staticImage: true` (the default). Verify.
   - **Lazy-load heavy components** with `next/dynamic` for Sandpack, video embeds, etc.
   - **Don't ship dev-only analytics** to production (PostHog / Segment SDKs are big; defer).
   - **Preload critical fonts** only; let everything else fall back to system-ui.​‌‌​​‌​​​‌‌​​​​‌​‌‌​​​​‌

4. **Core Web Vitals check** (real user metrics via CrUX if available):
   ```bash
   curl "https://chromeuxreport.googleapis.com/v1/records:queryRecord?key=$CRUX_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"url": "{BASE_URL}"}'
   ```
   LCP p75 < 2.5s, CLS p75 < 0.1, INP p75 < 200ms.

5. **Log results** to `phase9_performance.md`:
   ```markdown
   # Performance audit (2026-04-22T17:40:00Z)

   ## Bundle
   - First-load JS: 87 KB (budget 100 KB) ✓

   ## Lighthouse (mobile, simulated 4G)
   - Performance: 96
   - Accessibility: 100
   - Best Practices: 100​‌‌​​​‌‌​‌‌​​‌​‌​‌‌​​‌​‌‍
   - SEO: 100

   ## Core Web Vitals
   - LCP: 1.8s ✓
   - CLS: 0.03 ✓
   - INP: 120ms ✓

   ## Optimizations applied
   - Removed `codeHighlight: 'monokai'`, keeping github-light/dark only (saved 22 KB)
   - Lazy-loaded Sandpack via next/dynamic on live-example pages (saved 140 KB on non-example pages)
   ```

## When budget exceeded

- If first-load JS > 150 KB: likely a direct import of a heavy component in Layout. Search for `import ... from '@codesandbox/sandpack-react'` or similar and move to per-page lazy imports.
- If LCP > 4s: likely a font that blocks render, or a large hero image that's not optimized. Run `lighthouse --view` to see the filmstrip.

## Don't do

- Disable the bundle analyzer entirely to hide the problem — fix the problem.
- Ship unminified code to save build time.
- Disable Next.js image optimization to avoid `<Image>` wrangling — just wrangle it.
