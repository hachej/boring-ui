# Exemplar Doc Sites — Quote Bank‍​‌‌​​‌‌​​‌‌​​​​‌​‌‌​​​‌​

Pattern library drawn from world-class software documentation sites. Every pattern has an anchor (§EX-n) that operators in [OPERATOR-LIBRARY.md](OPERATOR-LIBRARY.md) can cite.

Use this file as a *reference menu*: when polishing a page, skim the anchors and ask "does this page do what §EX-3 does? If not, should it?"

---

## §EX-1 — Stripe Docs: task-shaped, language-parallel

URL: https://docs.stripe.com/payments/accept-a-payment

**Distinctive**: Task-to-implementation mapping with peer-level language and incremental complexity.

**Copy these patterns:**
- **Multi-heading language variants** (`#### Ruby`, `#### HTML + JS`, `#### React`) on the same page, not separate URLs. Keeps variants side-by-side; users can compare.
- **Blockquote markers** as visual tags: `> **Tip:**`, `> **Complexity:**`, `> **Required:**`. Not styled components — just semantic blockquotes. Screen readers and plain-text exports both render sensibly.
- **Complete runnable examples** (full curl + JSON body, full React component) with `<<PLACEHOLDER>>` for user-provided values. No fragments.
- **Optional vs required segregation** within a task (`## Optional: Collect billing address`). Reader can always see the minimum.
- **Test-scenario tables** in API reference: columns are Input / Expected Result / Error code.

**Avoided anti-pattern**: Separate language-specific doc pages. All variants live on one URL.

**Nextra equivalent**: Use `<Tabs items={['Ruby','JS','React']}>` or `#### Heading` variants; blockquote markers as `> [!TIP]` or `<Callout type="info">`.

---

## §EX-2 — Next.js Docs: parallel trees, teach before reference

URL: https://nextjs.org/docs/app/building-your-application/routing/pages-and-layouts

**Distinctive**: Parallel documentation trees (App Router + Pages Router) with identical navigation.

**Copy these patterns:**
- **Prerequisites list on landing page** (HTML/CSS/JS/React checklist, each expandable). Users self-select readiness.
- **File-tree diagram + code block pair** for folder structure. Visual diagram as PNG, file paths as code block. Two representations of the same truth.
- **TypeScript/JavaScript switcher on individual code blocks** via a `switcher` attribute. Keeps both in the same doc.
- **Conceptual teaching before API**: "Linking between pages" explains navigation *before* `<Link>` API reference.
- **Version switcher at top of sidebar**, not hidden in a menu.

**Avoided anti-pattern**: Assumes prior React knowledge without saying so. Next.js explicitly lists prerequisites.

**Nextra equivalent**: Use `<FileTree>` + code block pair; `<Tabs>` with `storageKey` for TS/JS switcher; version menu in `_meta.global.tsx` with `type: 'menu'`.

---

## §EX-3 — Tailwind CSS: example-in-context with visual output

URL: https://tailwindcss.com/docs/display

**Distinctive**: Interactive playground embedded in *every* example; visual output shown alongside code.

**Copy these patterns:**
- **Class-lookup table at page top** (class name → CSS property). Primary reference use-case served immediately.
- **Examples wrapped in realistic context** (full card layout, not an isolated `<div>`). Shows the class in its natural habitat.
- **Responsive variant notation in-example** (`md:inline-flex`) as part of the class string. Teaches how modifiers compose, not separately.
- **Progressive complexity grouping** (Block/Inline → Flex → Grid). Readers build on what they just learned.
- **Accessibility utilities alongside standard ones** (`sr-only` variants in the normal Display docs, not segregated).
- **Live-playground escape hatch** (play.tailwindcss.com). When inline examples aren't enough, there's an interactive fallback.

**Avoided anti-pattern**: Code without visual output. Every example shows rendered result.

**Nextra equivalent**: Use custom React components to render example + code side-by-side; ship Sandpack for the live-playground fallback (see [ADVANCED-NEXTRA.md](ADVANCED-NEXTRA.md#5-playground--interactive-code)).

---

## §EX-4 — Anthropic Docs: prose-paired-with-code

URL: https://platform.claude.com/docs/

**Distinctive**: Conversational author voice ("we", "you") paired immediately with runnable code.

**Copy these patterns:**
- **Filename-tagged code blocks** (`filename="example.ts"` on fences) so the reader sees the file context.
- **Prose → code flow**, never code → prose. Explain, then show.
- **Highlighted line ranges** (`highlight={1,10}` on code blocks) to draw attention without inline comments.
- **`> **Good to know**` callouts** for edge cases (lighter than a warning — just "while you're here, know this").
- **Parameter tables with Type / Default / Description columns**, not prose lists.

**Avoided anti-pattern**: Code snippets without file location or purpose.

**Nextra equivalent**: `filename="..."` attribute is built in; `{1,3-5}` line highlights are built in; use `<Callout type="info">` for the "good to know" flavor.

---

## §EX-5 — Supabase Docs: SDK-parallel, framework-forward

URL: https://supabase.com/docs

**Distinctive**: Six language SDKs (JS, Flutter, Python, C#, Swift, Kotlin) as primary navigation — before concepts.

**Copy these patterns:**
- **Framework quickstart grid** (React, Next.js, Vue…) as icon-and-label cards on landing. Decision first, content second.
- **Language selector above concept sections** so every concept has a matching code sample in the reader's language.
- **Migration pathways as a dedicated section** ("Moving from Firebase", "Moving from PostgreSQL"). Acknowledges readers come from somewhere.
- **Product cards with icon + short descriptor** (Database / Auth / Storage / Realtime / Edge Functions). A doc can't hide the platform's shape.
- **Ctrl+K search bar above nav** with keyboard shortcut annotated. Makes the shortcut discoverable.

**Avoided anti-pattern**: Language selection buried in nested menus.

**Nextra equivalent**: Use `<Cards>` grid on landing; `<Tabs>` at page-level for language variants; dedicated `/migrate/` section under `_meta.global.tsx`.

---

## §EX-6 — TanStack Query: concept vs reference separation

URL: https://tanstack.com/query/latest

**Distinctive**: Deliberate separation of Guides & Concepts from API Reference, cross-linked.

**Copy these patterns:**
- **Concepts clustered by pattern, not alphabetically** ("Optimistic Updates (UI)" next to "Optimistic Updates (Cache)").
- **Named concepts as sidebar entries** ("Window Focus Refetching", "Query Invalidation") — not just API methods.
- **Sidebar expand/collapse with memory** so deep-dive sessions don't lose state.
- **Three-level nav with breadcrumb trail** (category → subcategory → article).
- **Framework variants branch from one root**, not separate trees.

**Avoided anti-pattern**: Mixing concepts and reference in one section.

**Nextra equivalent**: Organize `content/` into `/guides/`, `/reference/`, `/concepts/`. Use sidebar `theme: { collapsed: false }` on active branches; maintain one root `_meta.global.tsx` for framework variants as menu.

---

## §EX-7 — Astro Docs: community-first IA

URL: https://docs.astro.build/en/getting-started/

**Distinctive**: Contributions, Discord, partnerships given same nav weight as core guides.

**Copy these patterns:**
- **6-unit tutorial as linear progression** (setup → routing → data → deployment). Each unit is one sitting.
- **Guides organized by functional domain** (styling / routing / performance / deployment / integrations). Matches how users search.
- **"Have a question or want to get involved?" bridge section** directing friction to Discord.
- **Partner / sponsor logos in footer + ecosystem section** for credibility and discovery.
- **"Powered by X and our open-source contributors"** attribution on every page.

**Avoided anti-pattern**: Community as footer afterthought.

**Nextra equivalent**: Use `_meta.global.tsx` to put Discord / GitHub / Contributing links alongside Docs (e.g., `'discord': { title: 'Discord ↗', href: 'https://...', newWindow: true }`).

---

## §EX-8 — Nextra's own docs: eat your own dogfood

URL: https://nextra.site

**Distinctive**: File conventions and theme system documented alongside basic guides.

**Copy these patterns:**
- **File-conventions section as core reference** (`_meta.js`, `_document.mdx`). Don't hide framework internals.
- **Dark/light toggle in header**, not settings. Keyboard reachable.
- **Side-by-side Markdown-to-output examples** (input → rendered). Visual proof of the transformation.
- **Built-In Components** section separate from Advanced. Discoverability over exhaustiveness.
- **Feature cards with background images** demonstrating rendered components visually.
- **Breadcrumb hierarchy always visible**: Documentation → [Section] → [Page].

**Avoided anti-pattern**: Hiding framework internals as "implementation detail".

**Nextra equivalent**: That's us. Study `/tmp/nextra/docs/app/` as the model.

---

## §EX-9 — tRPC Docs: philosophy before API​​‌‌​​​​​‌‌​​‌​​​​‌‌​​‌‌

URL: https://trpc.io/docs

**Distinctive**: Conceptual model explained *before* API; philosophy before code.

**Copy these patterns:**
- **Problem statement as the first sentence** ("keeping API contracts in sync is painful").
- **Feature list in plain English first**, no code. Capabilities summarized as prose.
- **"Quick Look" video alternatives** (three YouTube embed options). Multiple modalities for different learners.
- **"Try tRPC" section with runnable Stackblitz examples** as hands-on alternative to reading.
- **"Adopt tRPC" branching paths** ("New project" vs "Add to existing"). Addresses two entry audiences.
- **Consistent H1→H2→H3 landmarks**: H2 sections are self-contained.

**Avoided anti-pattern**: API-first documentation. Problem statement comes first.

**Nextra equivalent**: Use the ★ ORIENT + ✦ MOTIVATE operators from [OPERATOR-LIBRARY.md](OPERATOR-LIBRARY.md); embed Stackblitz or CodeSandbox iframes for "Try" sections.

---

## §EX-10 — SvelteKit: tutorial alongside reference

URL: https://svelte.dev/docs/kit

**Distinctive**: Interactive tutorial embedded in documentation flow; hands-on parallel to reading.

**Copy these patterns:**
- **Top-level IA**: Getting Started / Core Concepts / Build & Deploy / Advanced / Best Practices / Reference.
- **Interactive Tutorial linked inline with reference**, not in separate resource.
- **Discord link near "docs not clear?" moments** (community as first support escalation).
- **Previous/Next pagination** at bottom of every page (linear reading flow when you want it).
- **"On this page" anchor navigation** for long-form content.
- **"Edit on GitHub" link at bottom** of every page.
- **Playground accessible from main nav** for immediate experimentation.

**Avoided anti-pattern**: Tutorial separate from reference.

**Nextra equivalent**: `navigation={{ prev: true, next: true }}` on `<Layout>`; `editLink` built-in; floating TOC built-in; link to an iframed Sandpack page from main nav.

---

## §EX-11 — Convex Docs: multi-product, multi-framework

URL: https://docs.convex.dev/quickstart

**Distinctive**: Multi-product platform (functions, database, auth, realtime) organized by both framework AND concept.

**Copy these patterns:**
- **13+ framework-specific quickstarts** (React, Vue, Next.js, Rust, Python…) as parallel entry points. No forced path.
- **Categorical breadcrumbs showing nesting** (`/understanding/best-practices/typescript`).
- **Cross-cutting concerns appear at multiple levels** (Debugging, Testing) — agent-specific AND general.
- **Generated API reference as separate section** from user guides.
- **Framework-agnostic concept sections precede framework-specific implementations.**
- **TypeScript-first code examples** with type definitions shown alongside implementations.

**Avoided anti-pattern**: Forcing users to choose one framework path.

**Nextra equivalent**: `content/quickstart/<framework>.mdx` pages + `_meta.global.tsx` menu; `/api/` folder for auto-generated reference using `<TSDoc>` (see [ADVANCED-NEXTRA.md](ADVANCED-NEXTRA.md#1-tsdoc--api-auto-reference-generation)).

---

## §EX-12 — Hono: minimalist routing hub

URL: https://hono.dev

**Distinctive**: Sparse landing page; routes users rapidly; no prose to wade through.

**Copy these patterns:**
- **Tagline + docs link + examples reference + runtime subsections**. That's it on the landing.
- **No embedded code on landing**. Delegate to docs.
- **15+ runtime guides** (Node.js, Deno, Bun, Cloudflare Workers…) as primary choices.
- **Two depths**: Full docs + "Tiny Docs" for core only. Some readers want the summary.
- **Concept-based sections** (Middleware, Helpers, Guides) alongside getting-started.
- **Linear progression** basics → advanced, not alphabetical.

**Avoided anti-pattern**: Narrative storytelling on landing. Prioritize navigation.

**Nextra equivalent**: Minimalist home via `<Cards>` grid on `content/index.mdx`; optional "essentials" page linked from nav for the "Tiny Docs" equivalent.

---

## Synthesis — patterns that appear across 3+ exemplars

These are the copyable doc moves with the highest replication value. The skill should default to doing these unless the user says otherwise.

### 1. Language/framework variant at the code-block level (§EX-1, §EX-2, §EX-3, §EX-5, §EX-11)

`<Tabs items={['TypeScript','Python','Rust']}>` on individual blocks, not separate pages. Keeps implementations side-by-side. **Nextra difficulty: Easy.**

### 2. Conceptual model before API (§EX-6, §EX-9, §EX-11, §EX-2)

H2 for "What is X?" / "Why X?" / "When to use X?" *before* "API reference". **Nextra difficulty: Easy — just a structural choice.**

### 3. Blockquote / Callout markers over prose alerts (§EX-1, §EX-4, §EX-7)

`> [!TIP]` / `> [!WARNING]` or `<Callout type="warning">`, not long inline warnings. **Nextra difficulty: Easy.**

### 4. Progressive complexity grouping, not alphabetical (§EX-3, §EX-6, §EX-7, §EX-11, §EX-12)

Order sections by conceptual build-up. Use `_meta.js` to control explicitly. **Nextra difficulty: Easy.**

### 5. Visual output paired with code (§EX-3, §EX-2, §EX-7)

Inline rendered result or side-by-side column, not a hidden "Output" tab. **Nextra difficulty: Moderate** — needs custom components or Sandpack.

### 6. Parallel documentation trees for architectural forks (§EX-2, §EX-6, §EX-11)

When two paths genuinely diverge (App Router vs Pages, React vs Vue, v3 vs v4), maintain identical hierarchies. **Nextra difficulty: Hard** — needs sync tooling or routing logic.

### 7. Community as primary nav element (§EX-7, §EX-10, §EX-9)

Discord + GitHub + Contributing in main nav, not footer. **Nextra difficulty: Easy** — add entries to `_meta.global.tsx` with `newWindow: true`.

### 8. "On this page" anchor nav for long content (§EX-10, §EX-2, §EX-3)

Right-side TOC for pages >2000 words. **Nextra difficulty: Easy** — `toc={{ float: true }}` on `<Layout>`, built-in.

### 9. Step-by-step progression with verification points (§EX-1, §EX-7, §EX-11)

Each step ends with "You should see X…". Uses `<Steps>` + interstitial `<Callout>`. **Nextra difficulty: Easy.**

### 10. Breadcrumb navigation showing nesting (§EX-2, §EX-3, §EX-5, §EX-11)

Visual context ("Docs > Section > Page"). **Nextra difficulty: Easy** — enable in theme config.

---

## Anti-patterns observed across weaker doc sites (do not imitate)

These showed up on sites that aren't in the exemplar list but are common failure modes:

- **Wall-of-text landing page** with three paragraphs before any link. (Cure: §EX-12's minimalist approach + §EX-5's cards.)
- **"Welcome to [Product] docs!" header** with marketing voice. (Cure: §EX-1/§EX-9's problem-first framing.)
- **Auto-generated API reference as primary surface** with no narrative pages. (Cure: §EX-6's concept/reference separation.)
- **"Docs" link in nav pointing at a GitHub README.** (Cure: any of §EX-2, §EX-5, §EX-11 — have real docs.)
- **Only one implementation language shown** on a platform with multi-language SDKs. (Cure: §EX-5's language-forward grid.)
- **Separate pages for "JavaScript" and "TypeScript" version of the same API.** (Cure: §EX-2's inline switcher.)
- **No "last updated" / "edit on GitHub" / "feedback" affordances.** (Cure: §EX-10's per-page links; §EX-8 does this with Nextra's built-ins.)
- **Every warning is a red box even for minor tips.** (Cure: §EX-1/§EX-4's scaled marker vocabulary — Tip vs Warning vs Important.)
- **Architecture page with a 40-box UML diagram.** (Cure: §EX-2's file-tree-plus-code-block pairing; keep diagrams to ≤10 nodes.)
- **Versioned docs split across subdomains with no switcher.** (Cure: §EX-8's `type: 'menu'` version dropdown.)

---

## §EX-13 — Kubernetes Docs: concepts/tasks/reference triangle

URL: https://kubernetes.io/docs/concepts/

**Distinctive**: The gold-standard Diátaxis implementation on a massive project. Four top-level sections (Concepts / Tasks / Tutorials / Reference) map 1:1 to Diátaxis quadrants.

**Copy these patterns:**
- **Task pages open with a prerequisites block** and a version-requirement check. Reader knows immediately if they should keep reading.
- **"What's next"** at the bottom of every page — 2–3 links, not 20. Readers finish one task and naturally flow into a related one.
- **Per-page TOC on the right** with deeply-nested anchors stays in sync with content.
- **"This page describes…"** opening pattern: first sentence is a one-line summary matching the page title, almost as a restatement.

**Avoid**: Kubernetes docs overindex on exhaustiveness; skim-reading is hard. Don't copy the "list every field" style for audiences below operator-level.

---

## §EX-14 — Rust Book / "The Book"

URL: https://doc.rust-lang.org/book/​‌‌​​‌​​​‌‌​​​​‌​‌‌​​​​‌

**Distinctive**: A linear pedagogical tutorial that teaches an entire language. The Book is the model for "teach, don't list."

**Copy these patterns:**
- **Each chapter has a project**, not just exercises. Chapter 2 builds a guessing game; chapter 12 builds a minigrep. Motivation is baked in.
- **"Previously covered" / "We'll cover later"** callouts. The Book respects the reader's tracking.
- **Code blocks with line-number refs** pointing to explanation paragraphs: "Listing 8-3 shows…"
- **Chapter cross-links** at the end: "Chapter 10 discusses this in depth."
- **Offline-friendly**: `rustup doc` brings the book onto disk. Readers trust their docs won't vanish.

---

## §EX-15 — Django Docs: four-part tutorial

URL: https://docs.djangoproject.com/en/5.2/intro/tutorial01/

**Distinctive**: The "Writing your first Django app" tutorial is explicitly chunked into 8 parts, each completable in one sitting.

**Copy these patterns:**
- **"Philosophy" callouts**: blue boxes that explain *why* Django does it this way, without blocking progress. Reader can skip; readers who want depth get it.
- **"Where to get help"** as a first-class sidebar link, not buried.
- **Breadcrumb at the top** with version selector inline. No modal, no dropdown drama.
- **"Deprecated since version X.Y"** notice blocks with link to migration path.

---

## §EX-16 — Terraform Docs: registry-backed reference

URL: https://developer.hashicorp.com/terraform/language

**Distinctive**: Reference for a declarative language, where examples must be cross-compiled across providers. HashiCorp's `registry.terraform.io` ecosystem is auto-ingested into docs.

**Copy these patterns:**
- **Provider-dimensioned tabs** (AWS / GCP / Azure) with identical structure. Reader learns the language once; tabs let them apply to their stack.
- **"Argument reference" vs "Attribute reference" split.** Input vs output, never merged.
- **"Import syntax" section** on every resource page: copy-pasteable `terraform import`.
- **Versioned URLs for deprecated syntax**, permanent redirects to latest.

---

## §EX-17 — Prisma Docs: ORM as learning path

URL: https://www.prisma.io/docs/getting-started/quickstart

**Distinctive**: "Choose your stack" landing leading to a 5-minute quickstart per combination. Very high conversion from reader to user.

**Copy these patterns:**
- **Hands-on quickstart defaults to SQLite**, no credentials needed. First-use friction is minimized.
- **"What you'll build" preview** at the top of tutorials, showing the final state.
- **Schema-first code + generated types pattern**: shows the source of truth and what it produces.
- **Database-compat matrix** as a table, prominently linked.
- **Upgrade guides per major version**, with code-mod invocation.

---

## §EX-18 — HuggingFace Docs: task-oriented ML

URL: https://huggingface.co/docs/transformers/quicktour

**Distinctive**: ML docs aimed at users who want results in 5 lines of Python, not a tensor-shape lecture.

**Copy these patterns:**
- **`pipeline()` as the single front door**: the quickstart shows 3-line inference. Depth pages explain internals.
- **Model cards embedded in the docs**: links from a concept page to live model inference.
- **"Try it in Colab" buttons** on most tutorial pages — effectively one-click validation that the example works.
- **Multi-framework parity (PyTorch / TF / JAX)** on every page via tabs, not cross-pollination confusion.

---

## §EX-19 — PyTorch Docs: API reference with narrative

URL: https://pytorch.org/docs/stable/

**Distinctive**: Huge auto-generated API surface *with* narrative tutorials layered on top. "Recipes" are 15-minute skill-building pieces.

**Copy these patterns:**
- **Tutorials and Recipes split**: tutorials are 1-hour projects, recipes are 15-minute targeted skills.
- **Runnable as notebooks**: every tutorial is a `.ipynb` linked from the page. Readers can edit in place.
- **Graph of module hierarchy** on landing, linking every top-level module.
- **Deprecation warnings at the top of affected pages**, with "use X instead" line.

---

## §EX-20 — MDN Web Docs: browser-compat-as-first-class

URL: https://developer.mozilla.org/en-US/docs/Web/API/fetch

**Distinctive**: Reference docs where *browser compatibility data* is as important as the API signature itself.

**Copy these patterns:**
- **Compat tables** rendered from structured JSON (BCD — Browser Compatibility Data). Auto-updated; every page has a live one.
- **"Examples" section first-class** — not buried at the bottom.
- **"Specifications" section** linking back to W3C/WHATWG. Reference is grounded in spec.
- **Interactive examples** (MDN has a CodeSandbox-backed live editor in-page).
- **Warning boxes for deprecated-and-still-documented** features, with alternatives.

---

## §EX-21 — Microsoft Learn: personalized paths

URL: https://learn.microsoft.com/

**Distinctive**: Not just docs — "learning paths" combining docs, videos, and hands-on labs, tracked per-user.

**Copy these patterns:**
- **"Learning path" as a meta-structure** above individual docs. Several tutorials bundled with an overall goal.
- **Per-module progress bar** giving reader a sense of forward motion.
- **"Knowledge check" quizzes** (optional, but some readers appreciate the gate).
- **"Give feedback on this module"** link on every page — dedicated, not a generic issue link.

---

## §EX-22 — GitHub REST API Docs: OpenAPI as source

URL: https://docs.github.com/en/rest

**Distinctive**: Entirely OpenAPI-generated. The schema is the source; docs are derived.

**Copy these patterns:**
- **Category → operation navigation** (e.g., "Issues → List issues"). Readers think in domain terms, not endpoint URLs.
- **Parameters table with "In" column** (query / header / path / body). Disambiguates where each param goes.
- **"HTTP response codes" table per operation**, every code with a one-line description.
- **Working curl + lang-specific** (Node / Python / CLI) snippets auto-generated from the schema.

---

## §EX-23 — Drizzle ORM Docs: opinionated thin layer

URL: https://orm.drizzle.team/docs/overview

**Distinctive**: Drizzle's docs embrace being a thin layer — they describe *how* it's thin, not try to hide it.

**Copy these patterns:**
- **"Why Drizzle" as a landing-tier question**, answered by comparison tables against Prisma / TypeORM.
- **"How to migrate from X" pages** as first-class, not afterthoughts.
- **SQL-first examples** with generated TypeScript types shown side-by-side.
- **"Batteries included" vs "bring your own"** framing throughout — readers know where the library's opinions live.

---

## §EX-24 — Zod Docs: single-page with deep TOC

URL: https://zod.dev/

**Distinctive**: One long scrolling page with every feature. Works because Zod's surface is small and uniform.

**Copy these patterns:**
- **Single-page scan-friendliness**: big H2s, generous whitespace, anchor-to-section sidebar.
- **Method tables with description + example** inline per row — no drilling required.
- **"Recipes" section** at the bottom for idioms that don't map to a single API.

**Avoid**: don't copy Zod's single-page shape for projects with >50 APIs. It becomes unsearchable and un-skimmable. Fine for ~20-API libraries.

---

## §EX-25 — Redux Toolkit Docs: rescue-from-complexity

URL: https://redux-toolkit.js.org/

**Distinctive**: Docs that explicitly acknowledge their predecessor was too complex. "Redux without the boilerplate."

**Copy these patterns:**​‌‌​​​‌‌​‌‌​​‌​‌​‌‌​​‌​‌‍
- **"Why Redux Toolkit?"** page comparing new-way vs old-way code, same feature.
- **Migration guide for the previous library's users** as a featured path.
- **"Quick Start" and "Tutorial" split**: Quick Start is 5 minutes to code, Tutorial is 2 hours to deep understanding.

---

## §EX-26 — Laravel Docs: one project, one doc site

URL: https://laravel.com/docs

**Distinctive**: Giant PHP framework with a cohesive voice. Written like a long book, not a wiki.

**Copy these patterns:**
- **Introduction section for every feature**, even simple ones — warmup before code.
- **Version-pinned URLs** (e.g., `/docs/10.x/…`) with a subtle version dropdown in header.
- **"Upgrade guide" between majors** showing each breaking change with before/after code.
- **Consistent voice**: reads like one author, even over thousands of pages.

---

## §EX-27 — Google Cloud Docs: reference-heavy, task-indexed

URL: https://cloud.google.com/compute/docs

**Distinctive**: Huge product surface. Docs organized by *task the user wants to do*, with API reference peripheral.

**Copy these patterns:**
- **"How-to" pages grouped by task noun** (Create / Configure / Monitor / Troubleshoot).
- **Pricing calculator embedded** in relevant pages where cost matters.
- **Quota tables** inline, not just in reference — users need them in context.
- **"Migrate from X" cross-cloud guides** (e.g., AWS to GCP) as first-class.

---

## §EX-28 — Docker Docs: re-org that worked

URL: https://docs.docker.com/

**Distinctive**: Historical re-org (2022–2024) consolidated scattered pages into Diátaxis structure. Now a good example of what a mid-project re-org looks like.

**Copy these patterns:**
- **Permanent redirects** from old URLs — every external link still works.
- **"What is X" top-level explainer pages** paired with "Get started with X" tutorials.
- **Versioned docs only for the CLI**, not the concept pages. Concepts rarely version.
- **Image tags with `< >` labels**: `docker run <image>:<tag>` — placeholders are formatted.

---

## §EX-29 — Go Documentation

URL: https://go.dev/doc/

**Distinctive**: Official language docs paired with `go doc` CLI. Same source, two surfaces.

**Copy these patterns:**
- **Effective Go** as a stand-alone essay on idiomatic usage — not a reference, not a tutorial, but an invaluable concept pillar.
- **"Tour of Go" interactive playground** linked from the landing.
- **Release notes as full-bodied pages**, not git-log dumps.
- **Proposals archive** (go.dev/issue) linked from language-feature pages — transparency on why things are the way they are.

---

## §EX-30 — Ruby on Rails Guides

URL: https://guides.rubyonrails.org/

**Distinctive**: Two surfaces: Guides (narrative) and API docs (rdoc-generated). Clear separation.

**Copy these patterns:**
- **Guides have concrete "at the end of this guide you will know" lists** — outcome-first.
- **"More on X" cross-refs to API docs** at the end of each guide section.
- **Edge guides** (unreleased features) clearly marked vs stable guides.
- **Community localization** integrated into the same URL scheme (`/ja/`, `/es/`).

---

## §EX-31 — Python Docs (cpython.org)

URL: https://docs.python.org/3/

**Distinctive**: Documentation generated by Sphinx, but heavily curated. 30 years of reference-writing craft.

**Copy these patterns:**
- **Library reference grouped by category** (Data Types / Numeric / Functional / File / OS) with landing summaries.
- **"Deprecated since" banners** with explicit removal version.
- **"Changed in version X.Y"** per-feature notes — not per-page.
- **"What's New in X.Y"** as the canonical release-notes companion.
- **"Language Reference"** (formal grammar) separate from "Library Reference" (API). Spec readers and API readers want different things.

---

## §EX-32 — Prefect Docs: workflows for data

URL: https://docs.prefect.io/

**Distinctive**: Orchestrator docs for a product with two usage modes (OSS and Cloud). Disambiguates without duplicating.

**Copy these patterns:**
- **"Cloud vs OSS" tag** on any feature that differs. Otherwise assumes parity.
- **"Tutorial: Run your first flow"** front-and-center, deployable locally with one command.
- **Concept pages explicitly labeled** — "Concept: Task" vs "API: @task decorator" vs "Tutorial: My first task".
- **Migration-from-Airflow** guide with side-by-side code — acknowledges the competitor honestly.

---

## §EX-33 — NumPy Docs: scientific canon

URL: https://numpy.org/doc/stable/

**Distinctive**: Mathematical library with conventions so deep they have their own "NumPy fundamentals" concept pillar.

**Copy these patterns:**
- **"Glossary" that teaches idiosyncratic vocabulary** ("broadcasting", "vectorization", "ufunc") as first-class concept pages, not just one-line defs.
- **LaTeX in descriptions** for functions whose definition is mathematical.
- **"See Also"** table per function, listing related API.
- **Migration guide for each major version** at the top of release notes.

---

## §EX-34 — Vercel Docs: product-led

URL: https://vercel.com/docs

**Distinctive**: Multi-product (Platform, AI SDK, Vercel Functions) docs with tight visual cohesion. The docs are a product feature, not an afterthought.

**Copy these patterns:**
- **Feature-flag-style gating**: some pages show different content based on logged-in state (plan tier, role).
- **OG image per page**, dynamically rendered from page title + section.
- **Built-in AI search** ("Ask Vercel") with citations — see [AI-SEARCH.md](AI-SEARCH.md).
- **Deep, branded sidebar hierarchy** that never feels overwhelming because depth is revealed progressively.

---

## Meta-patterns observed across §EX-13 to §EX-34

Six pattern families emerge from the extended corpus:

1. **Task-indexed navigation** — Kubernetes (§EX-13), Google Cloud (§EX-27), Laravel (§EX-26): readers come with a verb, not a noun. Let them find pages by "what I'm trying to do."
2. **Opinionated quickstart with no-friction setup** — Prisma (§EX-17) with SQLite, HuggingFace (§EX-18) with Colab, Redux Toolkit (§EX-25): 5-minute first success beats 30-minute architectural briefing.
3. **Machine-generated + narrative-augmented reference** — GitHub REST (§EX-22), PyTorch (§EX-19), Python (§EX-31): auto-gen is the baseline; narrative makes it usable.
4. **Explicit migration paths** — Drizzle (§EX-23), Redux Toolkit (§EX-25), Prefect (§EX-32), Laravel (§EX-26): competitor migrations and major-version migrations are first-class, not hidden in "FAQ".
5. **Per-page interactivity** — MDN (§EX-20), Rust Book (§EX-14 via rustup doc), Go (§EX-29 via playground), Vercel (§EX-34 via AI search): docs that *do things*, not just explain.
6. **Voice cohesion at scale** — Laravel (§EX-26), Stripe (§EX-1), Rust Book (§EX-14): a million-word doc site that reads like one author. Style guides + consistent polish, not individual brilliance.

See [WRITING-CRAFT.md §19](WRITING-CRAFT.md) for voice calibration tactics.

---

## Using this file during Phase 4 and Phase 6

During polish, skim the anchors. Pick 3 that would improve a given page. Apply them. Log which anchors you followed in `phase4_polish_log.md`:

```
cli/run.mdx — applied §EX-1 (blockquote markers), §EX-9 (problem-first opener), §EX-10 (prev/next)
```

The main agent can then verify coverage diversity: if every page cites only §EX-1, we're one-note. Good polish draws from many exemplars.

With the extended set (§EX-13 through §EX-34), polishers should particularly note:
- §EX-13 for Diátaxis discipline.
- §EX-14 for pedagogy.
- §EX-17 for quickstart shape.
- §EX-20 for reference pages that include real examples.
- §EX-25 for acknowledging your predecessor's complexity honestly.
