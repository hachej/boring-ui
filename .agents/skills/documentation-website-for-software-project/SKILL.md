---
name: documentation-website-for-software-project
description: >-
  Generate a polished Nextra documentation site from any source repo. Use when
  building a docs site, "docs site for this repo", MDX docs, or deploying docs
  to Vercel.
---

<!-- TOC: One Rule | Inputs | Skill Bootstrap | Phases | Parallelism | Polish Bar | Operator Library | Information Architecture | Anti-Patterns | Checklist | References -->

# Documentation Website For Software Project

> **The One Rule:** Documentation is *narrative plus reference*, not a method dump. Before typing any MDX, build a mental model of the codebase; write prose that explains *why* and *how it fits*; only then drop into parameter tables.

---

## What This Skill Produces

A deployable [Nextra 4](https://nextra.site) (App Router) documentation site in a sibling directory `<project>__nextra_documentation_site/`, optionally deployed to Vercel. Drafted by parallel subagents across 10 phases, polished until agents stop making substantive changes.

**Inputs**
- Source repo path (e.g. `/data/projects/frankensqlite`), or
- Git URL (clone into `/tmp/` first, then treat as path), or
- Current working directory if nothing specified.

**Outputs**
- `<repo>__nextra_documentation_site/` — initialized Nextra project
- `content/` tree populated with narrative MDX (App Router `content/` convention)
- Theme-polished Navbar / Footer / Banner, working search, mermaid + KaTeX, dark mode, edit link, OG image generation
- Vercel deploy with `gh` integration, or self-host via `bun start` / `next start`
- Playwright smoke-test run against the deployed URL

---

## Up-Front User Confirmations (Ask Before Starting)

1. **Target project path?** Confirm absolute path or clone URL.
2. **Site directory name?** Default: `<basename>__nextra_documentation_site` as a sibling. Confirm OK to create & `git init`.
3. **Deploy target?** Vercel (recommended; works on free tier for internal docs) or self-hosted via bun. If Vercel — do they have an account + CLI? If not, walk them through setup (see [DEPLOY.md](references/DEPLOY.md)).
4. **Package manager?** Prefer `bun` if available. If missing, offer to install via `curl -fsSL https://bun.sh/install | bash` (ask first). Fall back to `pnpm` or `npm`.
5. **Fresh run or resuming?** If the site directory already exists, confirm whether to re-enter the phase loop (idempotent) or treat as new.

Missing skills that we reference (`/operationalizing-expertise`, `/codebase-archaeology`, `/codebase-report`, `/ui-polish`, `/ux-audit`, `/ubs`, `/gh-cli`, `/vercel`, `/idea-wizard`): if the user has `jsm` installed and authenticated, offer to `jsm install <name>` for each missing one. Don't block the phase if a polish skill is missing — note it and proceed.

---

## Skill Bootstrap (Phase 0.5 — right after inputs, before partition)

The pipeline composes many helper skills. Before fanning out:

```bash
./scripts/check-skills.sh <site-dir>/.docs_workspace
# Prints an inventory table and writes phase0_skill_inventory.json
```

If missing skills and `jsm` is installed + authenticated:

```bash
./scripts/install-referenced-skills.sh <site-dir>/.docs_workspace
# Reads inventory, runs `jsm install <name>` for each missing skill
```

If `jsm` isn't installed, offer to install it via the official installer:

```bash
# Linux/macOS
curl -fsSL https://jeffreys-skills.md/install.sh | bash

# Windows (PowerShell)
irm https://jeffreys-skills.md/install.ps1 | iex
```

Then `jsm login` (browser OAuth). Requires a paid [jeffreys-skills.md](https://jeffreys-skills.md) subscription ($20/month) to install premium skills. If the user doesn't have one, the pipeline uses inline fallbacks for every referenced skill and continues without blocking.

Full bootstrap detail (including headless OAuth, subscription checks, offline fallback): **[SKILL-INSTALLATION.md](references/SKILL-INSTALLATION.md)**.

---

## The Phase Loop (Mandatory)

```
Phase 1  RESEARCH        archaeology + report, per subtree (parallel agents)
Phase 2  DRAFT           same agent that researched a section writes its MDX
Phase 3  SYNTHESIZE      merge + cross-section docs only possible after the parts
Phase 4  POLISH          repeat until marginal: missing intuition, examples, pitfalls
Phase 5  GLOSSARY+INDEX  fresh-eyes harmonization pass
Phase 6  NEXTRA-IFY      convert MDX + wire theme + advanced components (repeat)
Phase 7  FRESH EYES      the three review prompts, ubs, build clean, twice
Phase 8  DEPLOY          Vercel (or bun self-host); give the user the URL
Phase 9  E2E             Playwright smoke + visual pass against the live URL
Phase 10 USER-LENS       fresh agent or /idea-wizard suggests clarity wins
```

**Phases 4 and 6** are *reapply-until-quiet* — keep spawning polish passes until an entire pass produces only trivial edits (whitespace, typo-level). Phase 7's two review rounds are the explicit termination gate.

### Mode variants

The skill ships three run modes. Pick based on time budget and stakes (see [PHASES.md §Mode variants](references/PHASES.md) for the full matrix):

| Mode | Typical wall time | Omits | When |
|---|---|---|---|
| **Quick** | 30–60m | Triangulation, Phase 10 user-lens, deep testing | Internal docs, small lib, draft for review |
| **Standard** | 2–4h | Extended exemplar import, multi-model triangulation (optional) | Most OSS libraries, SDKs |
| **Comprehensive** | half-day to full day | Nothing — all 10 phases, all triangulation, all audits | Flagship projects, paid products, public platforms |

Mode is chosen during Up-Front Confirmations. Default: Standard.

Full per-phase playbook with exact prompts for each parallel subagent: **[PHASES.md](references/PHASES.md)** and **[AGENT-PROMPTS.md](references/AGENT-PROMPTS.md)**.

---

## Parallelism Model

Research and drafting are the large, parallelizable phases. The partition is the repo's module boundary — usually `src/<module>` or top-level folder.

```
┌─────────────────────────────────────────────────────────────┐
│  PARTITION (once, by main agent)                            │
│  ─> list top-level modules; assign one subagent each        │
└────────────────┬────────────────────────────────────────────┘
                 │
    ┌────────────┴─────────────┐
    │                          │
    ▼                          ▼
┌──────────────┐          ┌──────────────┐
│ Agent A      │   ...    │ Agent N      │
│ Phase 1 res. │          │ Phase 1 res. │
│ Phase 2 MDX  │          │ Phase 2 MDX  │  (same agent owns research+draft)
└──────┬───────┘          └───────┬──────┘
       │                          │
       └──────────┬───────────────┘
                  ▼
       ┌─────────────────────────┐
       │ Phase 3 SYNTHESIS       │  single agent; reads all drafts;
       │ (cross-cutting docs)    │  produces overview, architecture,
       └──────────┬──────────────┘  data-flow, contributor-guide
                  ▼
         Phase 4 POLISH swarm (parallel again, per section)
```

**Coordination:** use [MCP Agent Mail](../agent-mail/SKILL.md) file reservations when multiple agents could touch the same MDX file (e.g., Phase 4 polish + Phase 7 fresh-eyes overlap). Thread id = `nextra-docs-<run-id>-<phase>-<section>`.

**Orchestration tier** — pick based on repo size (see [ORCHESTRATION.md](references/ORCHESTRATION.md)):

| Tier | Shape | When |
|---|---|---|
| Solo | 1 worker, serial phases | <20 source files |
| Pair | 2 workers, small fan-out | Typical OSS lib |
| Squad | 4–6 workers, multi-model polish | SDK / framework |
| Swarm | 8–12+ workers, issue-driven + triangulation | Platform / monorepo |

Triangulation (Claude + Codex + Gemini) is reserved for Phase 4 polish and Phase 7 fresh-eyes, where independent reads produce the highest signal. Prompt diversification ("modes of reasoning" — literal/skeptical/junior/expert/adversarial readers) composes with model diversification; see [ORCHESTRATION.md §Modes-of-reasoning](references/ORCHESTRATION.md).

---

## Audience, Lifecycle, and Feedback

Docs are not a one-shot deliverable. The skill plans for three cross-cutting concerns:

- **Audience.** Every page declares its primary persona (evaluator / first-time user / daily integrator / contributor / operator). Headings, voice, and depth vary per persona. See [AUDIENCE.md](references/AUDIENCE.md).
- **Lifecycle.** The pipeline emits `scripts/docs-freshness.mjs` wired to CI. Pages flagged stale are re-queued through Phase 4. Release-train coupling: every SDK release bumps docs versioned snapshot. See [LIFECYCLE.md](references/LIFECYCLE.md).
- **Feedback.** Every page ships with a thumbs widget and zero-result search logging. Signals feed the FAQ pipeline and the fresh-eyes queue. See [FEEDBACK-PIPELINE.md](references/FEEDBACK-PIPELINE.md).

These are wired into Phase 10 (user-lens) and the post-deploy machinery — not bolted on.

---

## The Polish Bar (Non-Negotiable)

A "great" doc site isn't a method dump. Every page must satisfy:

| Dimension | Test |
|-----------|------|
| **Orientation** | First 3 paragraphs: what is this, who is it for, where does it fit |
| **Motivation** | Why does this module/function exist? What problem is it solving? |
| **Mental model** | A diagram or ASCII sketch showing the object relationships |
| **Narrative flow** | Prose that walks the reader from context → detail, not a ref dump |
| **Concrete example** | At least one copy-pasteable code example that actually runs |
| **Pitfalls** | "Common mistakes", "Gotchas", or a `<Callout type="warning">` block |
| **Tips / tricks** | A "beyond the basics" or non-obvious insight when applicable |
| **Cross-links** | Link to related pages; don't leave the reader dead-ended |

If a page only has a method table and a one-line intro, **it fails the bar** — that's a Phase 4 rework target.

Full rubric + section-type checklists: **[CONTENT-TEMPLATES.md](references/CONTENT-TEMPLATES.md)**.

---

## Operator Library (the moves, not just the rules)

The Polish Bar says *what* great pages have. The **[OPERATOR-LIBRARY.md](references/OPERATOR-LIBRARY.md)** says *how* to produce it. Each operator is a cognitive move (`★ ORIENT`, `✦ MOTIVATE`, `◐ MENTAL-MODEL`, `⬡ EXEMPLIFY`, `⚠ WARN`, `✧ TIP`, `⇄ CROSS-LINK`, `⤵ DECOMPOSE`, `⊕ SYNTHESIZE`, `⊙ DE-SLOP`, `⊞ NEXTRA-UPLIFT`, `⌘ REDUCE`) with explicit triggers, failure modes, and a prompt module. Polishers pick operators per failing dimension.

Why this matters: reduces "polish this page" into "apply these 3 operators". Dramatically more reproducible than vibes-based editing. Adapted from [operationalizing-expertise](../operationalizing-expertise/SKILL.md) Track A.

Operator pipelines per page type (what to apply in what order): [OPERATOR-LIBRARY.md § Operator composition cheat-sheet](references/OPERATOR-LIBRARY.md#operator-composition-cheat-sheet).

---

## Information Architecture — Diátaxis

Every page belongs to exactly one of four quadrants: **Tutorial**, **How-to**, **Reference**, **Explanation**. Mixing them is the single most common doc failure mode.

- **Tutorial** — teach by doing. Linear. Has a concrete end state.
- **How-to** — accomplish a named task. For readers who know what they want.
- **Reference** — authoritative, exhaustive, austere. For lookup.
- **Explanation** — discursive. For readers who want to understand *why*.

Sidebar mirrors this by default (top-level Tutorials / Guides / Reference / Concepts sections). See **[DIATAXIS.md](references/DIATAXIS.md)** for the full framework, classification rubric, and mixing antipatterns.

Phase 3 decides the site's IA (Option A: quadrant-first; Option B: topic-first with quadrant tags) and records the decision in `phase3_ia_decision.md`.

---

## Project-type-specific defaults

The Phase 0 partition pattern-matches on the source repo and picks a template. See **[PROJECT-TYPES.md](references/PROJECT-TYPES.md)** for Rust library / Rust CLI / Rust workspace / Python library / Python web framework / TypeScript library / TypeScript CLI / TypeScript monorepo / Go / frontend SPA / backend service / IaC / ML pipeline / polyglot patterns. Each has a default partition, doc mix, and list of Nextra features to emphasize.

---

## Nextra Feature Budget

Use, don't just know about:

- `<Callout type="info|warning|error|important">` — orient the reader in-line
- `<Tabs>` + `npm2yarn` — language/runtime switchers
- `<Steps>` — multi-step tutorials
- `<FileTree>` — directory layouts
- `<Cards>` — landing pages, section indexes
- Mermaid code blocks — architecture + sequence diagrams
- KaTeX (`latex: true`) — if project has any math
- `filename="..."`, `{1,3-5}`, `showLineNumbers`, `/highlight/` on code fences
- Dynamic OG images via `next/og` — one per top-level page
- `_meta.global.tsx` (App Router) — sidebar order, menus, separators, external links, per-page theme overrides (`layout: 'full'`, `toc: false`, `typesetting: 'article'` for blog/about-style pages)
- `editLink`, `feedback`, `lastUpdated`, `toc.float` on `<Layout>` — polish table-stakes

Canonical, paste-ready code for every one of these: **[NEXTRA.md](references/NEXTRA.md)**.

---

## Anti-Patterns (Never Do)

| ✗ | Why |
|---|-----|
| Generate docs without reading the code | You'll hallucinate APIs |
| "List every public function" structure | That's a reference, not docs — users want narrative |
| Dump AGENTS.md into a page | AGENTS.md is for agents, not human readers |
| Skip Phase 3 (synthesis) | Cross-cutting views are what separate docs from autogen |
| Ship before Phase 7 runs clean twice | Fresh-eyes catches the embarrassing bugs |
| Use Pages Router (`pages/`) on a new site | Nextra 4 is App Router (`app/` + `content/`); legacy only |
| Inline giant JSON/stub config dumps in body | Put them in `<details>` or a sibling `.json` |
| Ignore dark mode | Broken contrast is immediately visible polish failure |
| Skip `editLink` + `feedback` | Contributors/readers expect them on modern doc sites |
| Copy `theme.config.tsx` from the Pages-Router template | Wrong surface for v4; use `<Layout>` props in `app/layout.tsx` |

---

## Pre-Flight & End Checklist

- [ ] Source repo path confirmed; sibling site dir named & `git init`-ed
- [ ] Missing helper skills offered via `jsm install` (non-blocking)
- [ ] Module partition posted to user before Phase 1 fan-out
- [ ] Phase 1 produced per-section archaeology notes (survives compaction)
- [ ] Phase 2 drafts every module page; no empty stubs left
- [ ] Phase 3 produced: overview, architecture, data-flow, contributor-guide, glossary seed
- [ ] Phase 4 ran until marginal (≥2 passes, last one noted as trivial)
- [ ] Phase 5 produced glossary + index; contradiction sweep done
- [ ] Phase 6 Nextra-ified; built clean (`bun run build` green); `_meta.global.tsx` sane
- [ ] Phase 7 fresh-eyes ran ≥2 times clean; `ubs` clean (if available); `bun tsc --noEmit` green
- [ ] Phase 8 deploy succeeded; URL reported to user
- [ ] Phase 9 Playwright smoke green; dark mode + search verified
- [ ] Phase 10 user-lens notes filed as follow-ups (not blockers)

---

## Reference Index

### Core playbooks
| Need | File |
|------|------|
| Phase-by-phase playbook with exit criteria | [PHASES.md](references/PHASES.md) |
| Exact prompts for each parallel subagent | [AGENT-PROMPTS.md](references/AGENT-PROMPTS.md) |
| Per-doc-type content templates & rubric | [CONTENT-TEMPLATES.md](references/CONTENT-TEMPLATES.md) |

### Methodology
| Need | File |
|------|------|
| Cognitive moves: operator cards + prompt modules | [OPERATOR-LIBRARY.md](references/OPERATOR-LIBRARY.md) |
| Diátaxis framework for info architecture | [DIATAXIS.md](references/DIATAXIS.md) |
| Quote-bank of world-class doc sites | [EXEMPLARS.md](references/EXEMPLARS.md) |
| Per-language / per-framework defaults | [PROJECT-TYPES.md](references/PROJECT-TYPES.md) |
| Measurable quality: coverage, density, slop | [QUALITY-METRICS.md](references/QUALITY-METRICS.md) |

### Framework
| Need | File |
|------|------|
| Nextra 4 usage (config, components, theme, gotchas) | [NEXTRA.md](references/NEXTRA.md) |
| Advanced Nextra (TSDoc, i18n, versioning, analytics, custom search, etc.) | [ADVANCED-NEXTRA.md](references/ADVANCED-NEXTRA.md) |

### Craft deep-dives
| Need | File |
|------|------|
| Technical-writing craft (curse of knowledge, progressive disclosure, rhythm, voice) | [WRITING-CRAFT.md](references/WRITING-CRAFT.md) |
| Per-audience content strategy (5 personas, routing, narrowing) | [AUDIENCE.md](references/AUDIENCE.md) |
| Diagramming (Mermaid, D2, PlantUML, Excalidraw, ASCII, dark-mode) | [DIAGRAMS.md](references/DIAGRAMS.md) |
| Glossary + FAQ authoring craft | [GLOSSARY-CRAFT.md](references/GLOSSARY-CRAFT.md) |
| ADR / design-decision records embedded in docs | [ADR-PATTERNS.md](references/ADR-PATTERNS.md) |
| Showcase, gallery, recipes, case studies, community genres | [SHOWCASE-GALLERY.md](references/SHOWCASE-GALLERY.md) |
| Interactive playgrounds (Sandpack, VHS, asciinema, live demos) | [INTERACTIVE.md](references/INTERACTIVE.md) |
| On-site + AI + LLM search/retrieval surfaces | [AI-SEARCH.md](references/AI-SEARCH.md) |

### Process & lifecycle
| Need | File |
|------|------|
| Multi-agent orchestration (tiers, fan-out, triangulation, NTM+mail+issues) | [ORCHESTRATION.md](references/ORCHESTRATION.md) |
| Six-layer validation regime (build/link/code-in-docs/lint/fresh-eyes/user-lens) | [TESTING-DOCS.md](references/TESTING-DOCS.md) |
| Post-launch maintenance, staleness, release-train coupling, sunset | [LIFECYCLE.md](references/LIFECYCLE.md) |
| Docs-as-code team workflows (CI, CODEOWNERS, preview deploys, freeze) | [TEAM-WORKFLOWS.md](references/TEAM-WORKFLOWS.md) |
| Reader feedback pipeline (widgets, comments, zero-result triage) | [FEEDBACK-PIPELINE.md](references/FEEDBACK-PIPELINE.md) |
| Docs corpus export (chunks, llms.txt, exemplars, kernel, docset) | [CORPUS-EXPORT.md](references/CORPUS-EXPORT.md) |
| Extended archetypes (firmware, K8s, protocol, game engine, blockchain…) | [EXTENDED-PROJECT-TYPES.md](references/EXTENDED-PROJECT-TYPES.md) |

### Operations
| Need | File |
|------|------|
| Installing jsm + referenced skills, subscription setup | [SKILL-INSTALLATION.md](references/SKILL-INSTALLATION.md) |
| Vercel + Cloudflare Pages + bun self-host + Playwright smoke | [DEPLOY.md](references/DEPLOY.md) |
| Migrating from Docusaurus/GitBook/MkDocs/Sphinx/etc. | [MIGRATION.md](references/MIGRATION.md) |
| Workspace artifacts + SLOs per phase | [MEASUREMENT.md](references/MEASUREMENT.md) |
| Common issues, symptoms, fixes | [TROUBLESHOOTING.md](references/TROUBLESHOOTING.md) |

## Scripts

| Script | Purpose |
|--------|---------|
| `scripts/scaffold-nextra.sh` | Create Nextra App Router project with our opinionated defaults |
| `scripts/generate-meta.mjs` | Walk `content/` and emit `_meta.global.tsx` preserving existing ordering |
| `scripts/content-lint.mjs` | Pass/fail gate: every page meets the Polish Bar rubric |
| `scripts/audit-content.mjs` | Full quality snapshot to `phase_metrics.json` (coverage, density, slop, readability, operator coverage) |
| `scripts/link-check.mjs` | In-repo + optional external link validation |
| `scripts/check-skills.sh` | Detect installed referenced skills + jsm state; write inventory |
| `scripts/install-referenced-skills.sh` | Bulk-install missing skills via jsm |
| `scripts/a11y-check.sh` | Run axe-core against deployed site |
| `scripts/seo-check.sh` | Validate sitemap, robots, OG tags, canonical |

## Subagents

| Subagent | Purpose |
|----------|---------|
| `subagents/section-writer.md` | Owns research + draft for one module subtree (Phase 1+2) |
| `subagents/synthesizer.md` | Phase 3 cross-cutting writer |
| `subagents/polisher.md` | Phase 4 rubric-driven polish pass |
| `subagents/fresh-eyes.md` | Phase 7 adversarial reviewer |
| `subagents/tutorial-writer.md` | Writes Tutorial-quadrant content (Diátaxis) |
| `subagents/api-reference-writer.md` | Writes austere Reference-quadrant pages (TSDoc-integrated where applicable) |
| `subagents/changelog-writer.md` | Builds release notes from git log + tags + GitHub releases |
| `subagents/migration-agent.md` | Migrates existing docs from Docusaurus/GitBook/MkDocs/Sphinx/etc. |
| `subagents/a11y-auditor.md` | Phase 9 accessibility audit with axe-core + Nielsen heuristics |
| `subagents/performance-auditor.md` | Phase 6c/9 performance budget enforcement (bundle + Lighthouse) |
| `subagents/security-reviewer.md` | Phase 7/9: scans for leaked secrets, bad security headers, indexed-leak via Pagefind |

## Self-Test

Trigger phrases that should activate this skill:
- "Build a documentation site for this project"
- "Generate Nextra docs for `<repo>`"
- "Make a docs site for frankensqlite"
- "Spin up docs for this repo and deploy to Vercel"
- "Add MDX documentation to this project"
- "Migrate our Docusaurus docs to Nextra"
- "Write API reference docs for this TypeScript library"
- "Polish the docs site — add diagrams, examples, and cross-links"
- "Set up a versioned Nextra docs site with i18n"
- "Generate a docs site and deploy it to Cloudflare Pages"
- "Audit this docs site for accessibility and performance"

Full trigger list + end-to-end smoke test on a tiny repo: [SELF-TEST.md](SELF-TEST.md).
