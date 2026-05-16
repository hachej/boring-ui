# Exact Prompts for Each Subagent‍​‌‌​​‌‌​​‌‌​​​​‌​‌‌​​​‌​

Copy-paste-ready prompts. Brief each agent like a smart colleague who just walked in the room. Substitute `{SECTION}`, `{SOURCE_PATH}`, `{SITE_PATH}`, `{WORKSPACE}` where they appear.

> **Rule:** each agent writes to `{WORKSPACE}` often enough to survive context compaction. The main agent checks those files, not the agent's in-message report.

---

## Phase 1 — Section research agent

Type: `Explore` (read-only).

```
You are researching a section of a software project so another agent (maybe you) can write documentation about it. You don't have the context of what we're doing yet — here it is.

We're building a Nextra documentation website for the repo at {SOURCE_PATH}. The main agent has partitioned the codebase into sections; you own section "{SECTION}", which covers these paths:

{PATHS_LIST}

Your job in this phase is RESEARCH ONLY. Do not write any MDX. Do not write documentation prose. Produce a structured research notebook that a later drafting agent will use.

Steps:

1. Read {SOURCE_PATH}/AGENTS.md, {SOURCE_PATH}/README.md, and (if present) CONTRIBUTING.md, ARCHITECTURE.md, CHANGELOG.md — in full.
2. List the files in your section paths; decide which are entry points, which are core types, which are glue.
3. Follow data flow from the obvious entry points outward. Trace at least one end-to-end path (input → processing → output) through your section.
4. Grep for: external integrations (HTTP clients, DB drivers, file I/O), configuration sources (env vars, config files, CLI flags), error handling patterns, test files relevant to your section.
5. Produce a notebook at {WORKSPACE}/phase1_notes/{SECTION}.md with EXACTLY these headings:

   ## Executive Summary (2-3 sentences: what this section does and why it exists)
   ## Audience (who needs to read docs about this section: end-user, contributor, integrator)
   ## Entry Points (bullet list with file:line)
   ## Key Types (table: Type | Location | Purpose)
   ## Data Flow (ASCII diagram or mermaid, plus 3-5 sentence narrative)
   ## External Dependencies (table: Dep | Purpose | Critical)
   ## Configuration (table: Source | Key | Default | Purpose)
   ## Test Infrastructure (what tests cover this section, file:line)
   ## Quirks and Gotchas (things a new contributor would trip over)
   ## Open Questions (things the user may need to clarify — do NOT guess)

6. If you find obvious documentation bugs in the source code itself (wrong comment, stale README snippet), note them in ## Open Questions. Do not edit the source code.

Keep the notebook under ~500 lines. Rich content with file:line citations beats any speculation. When you're done, output nothing but the path to the notebook file.
```

---

## Phase 2 — Section drafting agent (same identity as Phase 1)

The Phase-1 research agent is reinvoked with the Phase-2 prompt. It already has the notebook and full context of the section.

```
You just finished Phase 1 research for section "{SECTION}" and wrote {WORKSPACE}/phase1_notes/{SECTION}.md.

Phase 2: DRAFT the documentation content. You are writing MDX files under {SITE_PATH}/content/{SECTION}/. The final site will be a Nextra doc site, but for now treat everything as plain MDX (standard headings, fenced code, standard markdown). Nextra-specific components come in Phase 6.

Before any file reservation, register with MCP Agent Mail and reserve {SITE_PATH}/content/{SECTION}/** with reason "nextra-docs-phase2-{SECTION}" (exclusive, ttl 3600). Release when done.

Content rules — every page MUST satisfy the Polish Bar (from SKILL.md):

- First 3 paragraphs orient a cold reader: what is this, who is this for, where does it fit in the bigger picture.
- Motivation (WHY this exists) before HOW.
- At least one mental model — a diagram (mermaid/ASCII) or named analogy.
- At least one concrete, copy-pasteable example that would actually run.
- "Common pitfalls" or `<Callout type="warning">` when the reader would naturally trip up.
- Tips/tricks where you know something non-obvious that helps an experienced user.
- Cross-links to related pages (at least 2 per page; don't leave the reader dead-ended).

Structure to produce under {SITE_PATH}/content/{SECTION}/:
- overview.mdx — section overview hitting all six bar items
- one .mdx per notable module / command / concept identified in Phase 1
- (optional) gotchas.mdx if your section has enough pitfalls to warrant a dedicated page
- _meta.js declaring page order

Write in a voice: technically precise, opinionated where opinion helps, warm-but-compact. Don't write boilerplate disclaimers or AI-tells ("Sure! Here is..."). Don't invent APIs. If a function is named X and takes (a, b), do not write "X(a, b, c, d)".

Quality gates:
- Every code example is valid syntax for the language and uses actual identifiers from the source repo.
- Every file:line citation points at something real.
- If you're uncertain about a behavior, read the code to verify. If you still can't verify, log an entry in {WORKSPACE}/phase2_open_questions.md (not in the MDX — Phase 4 will see it) and pick the most defensible interpretation in the draft itself. Don't leave TODOs or `{{placeholder}}` patterns in the MDX — the content-lint script fails pages that contain them.

When done, append each created file path to {WORKSPACE}/phase2_drafts_index.md (one line per file, plus its sha256). Also release your Agent Mail file reservation.
```

---

## Phase 3 — Synthesis agent

One agent, serial. Gets broad context.

```
You are the synthesis agent for the doc site at {SITE_PATH}. The research + drafting phases are done. Your job is to write the cross-cutting overview pages that could ONLY be written after reading every section's research notebook and drafts.

Inputs:
- All notebooks under {WORKSPACE}/phase1_notes/*.md
- All section drafts under {SITE_PATH}/content/**
- The source repo at {SOURCE_PATH} (re-open if you need to verify a claim)

Produce these files (under {SITE_PATH}/content/ unless noted):

1. index.mdx — landing page. Hero paragraph pitching the project (1 sentence elevator). Three or four <Cards> leading to the main sections. No deep content here; this is a launchpad.

2. overview/what-is-this.mdx — 400-800 words. What is {PROJECT}? Who is it for? What problem does it solve, and how is it different from the obvious alternatives? End with a "Quick tour" paragraph that previews the sections below.

3. overview/architecture.mdx — the system diagram page. At least one mermaid diagram showing the major components and their relationships. Prose explaining each box on the diagram in 2-4 sentences. Call out anything clever or non-obvious about how the pieces connect.

4. overview/data-flow.mdx — trace one representative end-to-end request/operation from user input to final output. Step by step. Include file:line references so a reader can click through to the source. Use <Steps> in Phase 6; for now, "### Step 1" headings are fine.

5. overview/contributing.mdx — how to set up a dev environment (clone, install, build, test). How the project is organized (link back to each section). Coding conventions. Commit style. Where new issues get filed. Cite paths that actually exist in the source — read {SOURCE_PATH}/CONTRIBUTING.md if present and do not contradict it.

6. overview/glossary.mdx — seed glossary. Skim each section draft and add every term that would be unfamiliar to someone outside the project. Definition style: 1 sentence technical definition + 1 sentence about where it shows up in this project. Alphabetical. Phase 5 will expand.

7. Update {SITE_PATH}/app/_meta.global.tsx (or create it) to place Overview first, then sections in the order given in {WORKSPACE}/partition.json, then Reference (if exists), then Contributing.

Write in the same voice as the section drafts. The synthesis pages are the highest-leverage pages on the whole site — many readers will only read these. Treat them accordingly.

When done, append output files to {WORKSPACE}/phase3_synthesis_log.md.
```

---

## Phase 4 — Polisher (parallel, repeat until marginal)

```
You are polishing section "{SECTION}" of the doc site at {SITE_PATH}/content/{SECTION}/. Other agents are polishing other sections in parallel — reserve {SITE_PATH}/content/{SECTION}/** in Agent Mail before editing.

Walk every .mdx file in your section. For each page, grade it against the Polish Bar:

- Orientation (cold-reader friendly intro): yes/no
- Motivation (why this exists) explicit: yes/no​​‌‌​​​​​‌‌​​‌​​​​‌‌​​‌‌
- Mental model (diagram or analogy): yes/no
- Concrete example that actually runs: yes/no
- Pitfalls / gotchas called out: yes/no
- Beyond-the-basics tip where applicable: yes/no
- Cross-links to ≥2 related pages: yes/no

For every "no", make the smallest change that upgrades it to "yes". Examples:

- No intro → rewrite the first paragraph to orient.
- No motivation → add one paragraph before the how-to explaining why this module exists and what it replaces.
- No mental model → add a mermaid block OR a 4-sentence "think of it as X" analogy.
- No concrete example → add a runnable code block with realistic inputs.
- No pitfalls → add a `<Callout type="warning">` with the gotcha you'd tell a new hire.
- No tips → add a `<Callout type="info">` with the non-obvious thing experienced users know.
- No cross-links → add them.

ALSO:
- Replace long narratives that are actually sequential with ### headings (Phase 6 will make them `<Steps>`).
- If a page is 3000+ words and mostly a ref dump, split it: keep an overview, move the deep API listing into a sibling reference page.
- Fix obvious factual errors you spot (wrong function name, wrong default value) — verify against source first.
- Do NOT rewrite content that's already good just to fit your voice. You are editing, not replacing.
- Do NOT add TODO placeholders; either do the work or file an Open Question in {WORKSPACE}/phase4_polish_log.md.

Log every page you touched in {WORKSPACE}/phase4_polish_log.md with format:
  <section>/<page>.mdx — [new] added mental-model diagram; added 2 cross-links
Entries with only "[trivial]" tags are how the main agent decides Phase 4 is done.
```

---

## Phase 5 — Glossary + harmonization agent

```
One pass only. You're the last pre-Nextra content agent.

Inputs: everything under {SITE_PATH}/content/.

Do these three things:

1. Glossary expansion. For every domain term used in any .mdx (grep the section drafts and the synthesis pages), ensure there is an entry in content/overview/glossary.mdx. Use an alphabetical table. For each term: one-sentence definition, one-sentence usage-in-this-project note, link to the most canonical page where it's discussed. Also: on the first use of a glossary term in every page, wrap it with a link to the glossary page on first use.

2. Contradiction sweep. Find every place two pages disagree. Examples: default values, command names, types, version requirements, file paths. For each contradiction:
   - Pick the canonical answer (verify against {SOURCE_PATH} if needed).
   - Update the wrong page(s).
   - Log the contradiction + resolution in {WORKSPACE}/phase5_contradictions.md.

3. Terminology harmonization. If the codebase uses "handler" in some places and "controller" in others for the same concept, pick ONE for the docs and use it everywhere. Note the decision + reasoning in the glossary entry. If there's a legitimate distinction (they really ARE different), spell that out.

Also: run (or simulate) a link check by grepping `\[.*\]\(.*\)` for in-repo targets and verifying each target exists. Report broken links in {WORKSPACE}/phase5_broken_links.md.

DO NOT introduce Nextra components yet. This pass is pure content.
```

---

## Phase 6a — Scaffolder (one-shot, main agent or delegate)

```
Scaffold the Nextra app at {SITE_PATH}. Follow NEXTRA.md exactly.

Steps:

1. Copy scripts/scaffold-nextra.sh from this skill and run it. It creates app/, mdx-components.tsx, next.config.ts, tsconfig.json, package.json (and a content/index.mdx stub). Add a `postcss.config.mjs` yourself only if you're opting into Tailwind 4 — see NEXTRA.md.
2. Verify content/ already exists (from Phase 2). If there's a content/index.mdx, good. If not, create a stub that <Cards>-links to the major sections (overview + each top-level section from {WORKSPACE}/partition.json).
3. Run: bun install (or pnpm / npm based on user preference).
4. Run: bun run build. It MUST succeed. If it errors, read the error and fix — common causes:
   - MDX parser errors (unclosed JSX, fenced blocks starting with three backticks inside a string, etc.)
   - Missing import in an MDX file for a component it references
   - _meta.js referring to a file that doesn't exist
   Fix surgically; don't rewrite content.
5. If `bun run build` succeeds, run the postbuild pagefind step and verify public/_pagefind/ exists.
6. Start `bun dev` in the background on port 3000, curl http://localhost:3000, confirm 200. Kill the dev server.

When done, post the build size summary to the user.
```

---

## Phase 6b — Component uplifter (parallel, repeat until marginal)

```
You are upgrading plain MDX to use Nextra's component library. Section: "{SECTION}". Reserve {SITE_PATH}/content/{SECTION}/** in Agent Mail first.

For every page in your section, look for opportunities:

1. Sequential "### Step 1 / ### Step 2 / ### Step 3" sections → wrap in <Steps>.
2. "If you're using X, do this; if you're using Y, do that" paragraphs → <Tabs items={['X', 'Y']}>.
3. Directory structures shown as ```text``` code fences → <FileTree>.
4. Section-index pages with link lists → <Cards num={2 or 3}> grid.
5. Ambient warnings/tips inline with prose → <Callout type="warning|info|important|error">.
6. Install commands ```sh / ```bash → ```sh npm2yarn when it's a package-install command.
7. Architecture-ish diagrams described in text → ```mermaid blocks.
8. Code fences for files you're referencing → add filename="...", {line-ranges}, /highlights/, showLineNumbers when useful.
9. Pages that would benefit from a full-width layout (landing, changelog, showcase) → set `theme: { layout: 'full' }` in _meta.
10. Long-form article pages (contributing, about, philosophy) → set `theme: { typesetting: 'article' }`.

Do not over-component-ize. Callouts and Cards wear out their welcome fast: aim for at most one of each per page. Prose is still king.

After every change, run `bun run build` — if it breaks, fix immediately before moving on.

Log every page touched in {WORKSPACE}/phase6_nextraify_log.md. Use [substantive] or [trivial] tags so the main agent can evaluate the termination rule.
```

---

## Phase 7 — Fresh-eyes trio (run each prompt separately, different agents)

Run in sequence, not parallel; each fixes what the previous missed.

### Fresh-eyes prompt #1
```
great, now I want you to carefully read over all of the new code you just wrote and other existing code you just modified with "fresh eyes" looking super carefully for any obvious bugs, errors, problems, issues, confusion, etc. Carefully fix anything you uncover.

Context: you are reviewing the Nextra doc site at {SITE_PATH}. Scope: app/*, mdx-components.tsx, next.config.ts, _meta.*, and every .mdx under content/. Do not edit the source repo at {SOURCE_PATH}.
```

### Fresh-eyes prompt #2​‌‌​​‌​​​‌‌​​​​‌​‌‌​​​​‌
```
I want you to sort of randomly explore the code files in this project, choosing code files to deeply investigate and understand and trace their functionality and execution flows through the related code files which they import or which they are imported by. Once you understand the purpose of the code in the larger context of the workflows, I want you to do a super careful, methodical, and critical check with "fresh eyes" to find any obvious bugs, problems, errors, silly mistakes, etc. and then systematically and meticulously and intelligently correct them. Be sure to comply with ALL rules in AGENTS.md and ensure that any code you write or revise conforms to the best practice guides referenced in the AGENTS.md file.

Scope: the doc site at {SITE_PATH} (code + MDX).
```

### Fresh-eyes prompt #3
```
Ok can you now turn your attention to reviewing the code written by your fellow agents and checking for any issues, bugs, errors, problems, inefficiencies, security problems, reliability issues, etc. and carefully diagnose their underlying root causes using first-principle analysis and then fix or revise them if necessary? Don't restrict yourself to the latest commits, cast a wider net and go super deep!

Scope: the doc site at {SITE_PATH}.
```

After each prompt, the main agent runs:

```bash
cd {SITE_PATH}
bun run build        # must be green
bun run typecheck    # alias for `tsc --noEmit`; must be clean
ubs .                # if ubs is available; fix any findings
```

Repeat the full trio until two consecutive rounds produce only trivial edits (typos / wording). Log to `{WORKSPACE}/phase7_review_log.md`.

---

## Specialized agents — API reference writer

For a TypeScript library where auto-generated reference is possible.

```
You're writing the API reference for section "{SECTION}" of {PROJECT}, a
{LANGUAGE} library. See subagents/api-reference-writer.md for full context.

Output: austere Reference pages under {SITE_PATH}/content/reference/{SECTION}/.

Rules:
- Every public item has a page (or a table entry on a consolidated page).
- Standard format for every entry:
  ## <Name>
  <One-line purpose.>
  **Signature**: `<canonical signature>`
  ### Parameters (table)
  ### Returns
  ### Errors (or "none")
  ### Example
  ### See also
- No opinions. Reference describes; opinions live in Concepts/Explanation.
- Every identifier extracted from source, not paraphrased.

For TypeScript: use <APIDocs componentName="..." /> (the TSDoc wrapper — see
references/ADVANCED-NEXTRA.md § 1). Author a one-line purpose sentence + usage
example above each <APIDocs /> block; TSDoc handles the parameter tables.

For Rust: link to `cargo doc` output where possible; fill the narrative layer.

For Python: consider keeping Sphinx for autodoc and linking to `/api/` from
Nextra; or use manual tables.

Verify: every identifier you mention exists in {SOURCE_PATH}. No invented
signatures. No phantom deprecations.

Output: content/reference/{SECTION}/ populated with one page per entity (or a
consolidated page if <20 items).
```

---

## Specialized agents — Tutorial writer

For creating a hands-on tutorial (Diátaxis Tutorial quadrant).

```
Write a tutorial for {PROJECT} teaching {TOPIC}. See
subagents/tutorial-writer.md for full context.

Output: content/tutorials/{TOPIC-SLUG}.mdx (or content/get-started.mdx for
the canonical "first run" tutorial).

Required structure:
1. Opening: what the reader will build, who it's for, estimated time.
2. Prerequisites <Callout type="info">.
3. "What we're building" — describe the end state, show screenshot/ASCII if UI.
4. Sequential `## Step N: <action>` sections. Each step:
   a. Brief "why" explanation.
   b. Fenced code block with realistic content.
   c. "Run it" command.
   d. Expected output shown.
   e. Troubleshooting callout if the step commonly fails.
5. "You did it!" — what the reader just accomplished.
6. "Next steps" — links to next tutorial / how-to / concept page.
7. "Common issues" — pitfalls specific to this tutorial.

Rules:
- One arc, no side quests. Link out for Explanation.
- Verification after every step.
- Concrete scenario ("Build a TODO app"), not abstract.
- Assume nothing unless listed as a prerequisite.
- Peer-level, warm-but-compact voice. No "Let's dive in".
- Phase 6 will wrap step headings in `<Steps>`; draft with markdown headings.

Verify:
- Every step's code runs (ideally you've actually run it).
- Every expected-output block matches reality.
- The tutorial takes approximately the stated time.
```

---

## Specialized agents — Migration agent

For migrating existing docs from another tool into Nextra.

```
Migrate the existing docs at {EXISTING_DOCS_PATH} (a {SOURCE_TOOL} site) to
{SITE_PATH}/content/. See subagents/migration-agent.md and
references/MIGRATION.md § ({SOURCE_TOOL}-specific section) for the mechanics.

Steps:
1. Inventory every file at {EXISTING_DOCS_PATH}; classify what needs
   conversion. Write phase_migration_inventory.json.
2. Apply mechanical conversion (file renames, syntax swaps per MIGRATION.md).
3. Translate sidebar config (sidebars.js / mkdocs.yml nav / etc.) to
   {SITE_PATH}/app/_meta.global.tsx.​‌‌​​​‌‌​‌‌​​‌​‌​‌‌​​‌​‌‍
4. Add redirects for every URL that moved to
   {SITE_PATH}/next.config.ts. Use `permanent: true` for moves.
5. Run `bun run build` from {SITE_PATH}. Fix MDX parse errors.
6. Write phase_migration_log.md listing files converted, files needing manual
   review, and redirect mappings.

Do NOT attempt to improve content during migration — migration preserves as-is.
Phases 2-6 handle polish afterward.

Do NOT discard files that don't fit Nextra patterns — flag them for manual
review and save them in content/_to-review/.
```

---

## Specialized agents — a11y auditor

For Phase 9 accessibility checks.

```
Audit the deployed docs site at {BASE_URL} for WCAG AA conformance.
See subagents/a11y-auditor.md.

Run ./scripts/a11y-check.sh {BASE_URL} / /overview/what-is-this
/overview/architecture /reference/<sample-entity>

For each critical or serious violation:
- Fix in the codebase.
- Typical fixes: alt text on images, skip-to-content link, color contrast on
  dark mode, semantic headings, focus indicators, keyboard reachability.

Re-run axe after fixes. Target: 0 critical, 0 serious.

Log to phase9_a11y_report.md with before/after numbers.

Cross-reference:
- WCAG AA targets: references/QUALITY-METRICS.md § Accessibility
- Fixes for common issues: references/ADVANCED-NEXTRA.md § 20
```

---

## Specialized agents — Performance auditor

For Phase 6c and Phase 9 performance budgets.

```
Measure and optimize performance for {SITE_PATH} (local) and {BASE_URL} (live).
See subagents/performance-auditor.md.

1. Bundle analysis: `cd {SITE_PATH} && ANALYZE=true bun run build`.
   Read first-load JS size. Budget: <100 KB gzipped.

2. Lighthouse: `bunx lighthouse {BASE_URL} --only-categories=performance,
   accessibility,best-practices,seo --output=json
   --output-path=./phase9_lighthouse.json`.
   Target: performance ≥90.

3. If bundle > 100 KB, common fixes (in order of leverage):
   - Disable Mermaid globally, lazy-load on pages that need it
   - Drop extra Shiki themes (keep 2: one light, one dark)
   - If latex unused, `latex: false` in next.config.ts
   - Lazy-load Sandpack via next/dynamic

4. Log results to phase9_performance.md with numbers + optimizations applied.
```

---

## Specialized agents — Security reviewer

For Phase 7 (content scan) and Phase 9 (deployed-site scan).

```
Security review for {SITE_PATH} and {BASE_URL}. See
subagents/security-reviewer.md.

Content scan (every .mdx in content/):
- API keys, tokens, connection strings, SSH keys (even fake-looking ones
  should be <PLACEHOLDERS>).
- Real internal hostnames / IPs → replace with placeholders.
- Real customer data in example payloads.
- Path leaks like /Users/name/... → replace with ~/ or <home>.

Grep git history for committed secrets:
  git -C {SITE_PATH} log --all -p | grep -iE 'api[_-]?key|secret|password|token'

Site scan:
- Security headers via `curl -I {BASE_URL}`. Expect HSTS, X-Content-Type-
  Options, Referrer-Policy. Add via next.config.ts headers() if missing.
- Probe /.git/config, /.env → should 404.
- Pagefind search index leak: `curl {BASE_URL}/_pagefind/pagefind-entry.json`
  → verify no internal-flagged pages indexed.

Dependency audit:
  cd {SITE_PATH} && bun audit

Log to phase9_security_report.md. No critical advisories at Phase 9 exit.
```

---

## Phase 10 — User-lens agent

Fresh agent, no context.

```
You are a senior engineer evaluating the documentation for the software project at {LIVE_URL}. Spend real time using these docs as if you were considering adopting this library (or contributing to it) for the first time.

After your session, produce a report at {WORKSPACE}/phase10_user_lens.md with EXACTLY these sections:

## What works (5 items)
## What's confusing, missing, or makes me lose confidence (5 items)
## Three concrete rewrites I'd suggest (be specific — section, page, what to change)
## The single biggest gap that would most improve onboarding

For each item, cite the specific URL path you're reacting to. Be specific about what made you stop, re-read, or get lost.

You are not implementing any fixes. This is an evaluation only. The main agent will file your items as follow-up issues.
```
