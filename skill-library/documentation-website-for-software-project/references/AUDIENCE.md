# Audience Strategy — Who the Docs Serve‍​‌‌​​‌‌​​‌‌​​​​‌​‌‌​​​‌​

Software projects don't have one reader. They have five. Docs that work for all five are rare; docs that work for none are the norm. This file classifies audiences, maps content to them, and gives routing patterns so every reader lands somewhere useful fast.

---

## The five personas

Every software project's readers fall into one of these buckets. Often a reader wears multiple hats over time (a student becomes a contributor); the persona is the ROLE AT THIS MOMENT, not the human identity.

### 1. Curious evaluator

**What they want:** "Should I use this?" They have 90 seconds. They're comparison-shopping.

**Reading location:** Landing page, "What is this?", one deep page they picked at random to spot-check quality.

**What they're allergic to:** Marketing copy, long intros, dependencies they can't install, features that don't exist yet.

**What they reward:** A working example inside 30 seconds; a clear statement of what this is *and isn't*; a benchmark or comparison table with a competitor they already know.

**Doc surface:** `content/index.mdx` (landing), `content/overview/what-is-this.mdx`, `content/comparison.mdx` (if warranted).

### 2. First-time user

**What they want:** "Can I make this work?" They've decided to try it. They want to avoid the humiliation of giving up at step 2.

**Reading location:** Tutorial. Install page. Getting started.

**What they're allergic to:** Missing prerequisites, unstated assumptions, steps that silently fail, references to concepts they haven't learned yet.

**What they reward:** Prerequisites stated up front, verification steps after each action, copy-paste-and-it-works.

**Doc surface:** Tutorials (Diátaxis), `content/get-started.mdx`, `content/guides/<first-task>.mdx`.

### 3. Daily integrator

**What they want:** "How do I do X?" They're already using the tool. They have a specific task in front of them.

**Reading location:** How-to guides. Reference via Ctrl+F. Example galleries.

**What they're allergic to:** Preamble, motivation, "let's first understand", theoretical concepts.

**What they reward:** Search that surfaces the right page in one query; a copy-pasteable snippet; a signature-first reference format; cross-links to adjacent tasks.

**Doc surface:** `content/guides/`, `content/reference/`, `content/recipes/` (cookbook-style).

### 4. Contributor / maintainer

**What they want:** "How does this work internally? How do I change it safely?"

**Reading location:** Architecture pages. Contributing guide. Design decision records. Code navigation via edit-links.

**What they're allergic to:** Hand-wavy architecture, diagrams that don't match the code, contributor docs that assume they've been on the team for years.

**What they reward:** ADRs with reasoning preserved, sequence diagrams that match actual code paths, a clear "start reading here" pointer in the repo, internal terminology mapped to the glossary.

**Doc surface:** `content/overview/architecture.mdx`, `content/concepts/`, `content/adr/`, `content/overview/contributing.mdx`.

### 5. Operator / on-call

**What they want:** "It's broken. How do I fix it?" Usually urgent, often context-impaired.

**Reading location:** Troubleshooting. Runbooks. Error-code pages. Observability guides.

**What they're allergic to:** Tutorial-shaped content when they're triaging; error pages that only describe the error without a fix.

**What they reward:** Error codes as searchable first-class pages; runbook steps that work without deep context; dashboards linked to symptoms; "this has fired before" incident summaries.

**Doc surface:** `content/ops/runbook.mdx`, `content/ops/errors/<code>.mdx`, `content/troubleshooting.mdx`.

---

## Audience → content-type mapping

| Persona | Preferred Diátaxis quadrant | Surface tone | Scan behavior |
|---------|------------------------------|--------------|----------------|
| Curious evaluator | Explanation + a Tutorial teaser | Honest, direct | 90s, top-to-bottom |
| First-time user | Tutorial | Encouraging, peer-level | Linear |
| Daily integrator | How-to + Reference | Terse, imperative | Search-driven, Ctrl+F |
| Contributor | Explanation + Reference | Technical peer | Tree traversal |
| Operator | How-to (task-shaped) + Reference | Urgent, procedural | Keyword-search from a symptom |

Phase 4 polishers: every page should identify which persona(s) it primarily serves, written at top of frontmatter:

```yaml
---
title: Configure database connection
description: Connect your app to Postgres with Drizzle.​​‌‌​​​​​‌‌​​‌​​​​‌‌​​‌‌
personas: [first-time-user, daily-integrator]
---
```

Content-lint reports pages with no `personas` tag after Phase 5.

---

## Persona routing patterns

Good doc sites *route* readers to the right content quickly. Three patterns:

### Pattern A: persona-branded entry (landing-page)

On `content/index.mdx`, offer four paths:

```mdx
<Cards>
  <Cards.Card title="I'm evaluating" href="/overview/what-is-this" icon="👀" arrow>
    Two-minute overview. No install required.
  </Cards.Card>
  <Cards.Card title="I want to try it" href="/get-started" icon="🚀" arrow>
    Install and get something working in 10 minutes.
  </Cards.Card>
  <Cards.Card title="I'm integrating" href="/guides" icon="🔧" arrow>
    Task-oriented guides for common integrations.
  </Cards.Card>
  <Cards.Card title="I want to contribute" href="/overview/contributing" icon="🛠️" arrow>
    Dev setup, architecture, ADRs.
  </Cards.Card>
</Cards>
```

Used by: Kubernetes, Supabase, Astro.

### Pattern B: persona-adaptive intro paragraphs

Inside a page, acknowledge multiple readers:

```mdx
# Authentication

Authentication is how <project> verifies who's calling it.

- **First-time user?** Start with [the OAuth tutorial](./tutorials/oauth).
- **Integrating into an existing app?** Jump to [Adding auth to your app](./guides/add-auth).
- **Customizing the auth backend?** See [the AuthProvider interface](../reference/auth-provider).
- **On-call?** See [Auth errors](./ops/auth-errors) first.

The rest of this page explains the conceptual model for readers who want the full picture.
```

Used by: Next.js, Django, Stripe.

### Pattern C: persona-adaptive sidebar

Top-level sidebar entries already are persona-branded (Tutorials / Guides / Reference / Concepts / Ops). The sidebar is the route. This works when your IA is pure Diátaxis (Option A from [DIATAXIS.md](DIATAXIS.md)).

Used by: Django, TanStack, SvelteKit.

---

## Persona-specific anti-patterns

### Curious-evaluator anti-patterns

- Marketing adjectives ("elegant", "powerful", "blazingly fast") without evidence.
- Features listed without clarifying if they're shipped, planned, or experimental.
- No comparison. "It's like X, but Y" is the single most useful sentence you can write.
- No concrete example on the landing page.

### First-time-user anti-patterns

- Unstated prerequisites. "You need Node.js" isn't enough — which version, why, where to get it.
- Steps with no verification. The reader can't tell if step 2 worked until step 5 fails.
- Jumping to advanced config in the first tutorial.
- Example code that uses `foo` / `bar` / `baz` or never-defined helpers.

### Daily-integrator anti-patterns

- Opening every how-to with "First, let's understand how X works." They know.
- Buried imports. The reader copy-pastes the fenced example and then it breaks because the imports were three paragraphs up.
- "Return to the previous section" — broken flow.
- No "see also" at the end. They'll want the next task.​‌‌​​‌​​​‌‌​​​​‌​‌‌​​​​‌

### Contributor anti-patterns

- Architecture docs written once and never updated. Out-of-date architecture is worse than none.
- CONTRIBUTING.md as the only contributor doc. Insufficient. Needs architecture + key concepts + dev setup.
- "Ask on Discord" as the only escalation path for non-obvious decisions.
- No ADRs. Design decisions forgotten within a year.

### Operator anti-patterns

- Error messages that describe the error but not the fix.
- Runbooks assuming access to internal wikis/dashboards an external reader doesn't have.
- Mixing operational runbooks into end-user guides.
- No error-code schema. "Error occurred" in the docs is worse than Python's "NameError: name 'foo' is not defined".

---

## How to research your actual audience

Before writing, spend 30 minutes finding real evidence of who reads this project:

### Signals from the source repo

- Open issues with the `question` label — shows what stumps people.
- Commits with "docs" in the subject — what's been asked-and-answered.
- Issues mentioning "I couldn't find…" — the holes.
- PRs that touched README.md — what's contentious.
- `CONTRIBUTING.md` views vs `README.md` views (if analytics available).

### Signals from the community

- StackOverflow tag volume (if tagged).
- Subreddit / Discord / Slack channel messages (mined via the `cass` skill if relevant to a past Claude session).
- Competitor docs — what content their readers praise in reviews.

### Signals from the existing docs

- Highest-traffic pages (Google Analytics / Plausible / Umami).
- Search queries with zero results.
- Pages with highest bounce rate.
- Pages with "was this helpful: no" feedback.

Log findings to `phase0_audience_notes.md`:

```markdown
# Audience notes — frankensqlite

## Observed personas (highest to lowest volume)
1. Rust developers evaluating SQLite alternatives (~45% of issues)
2. Users hitting ON CONFLICT edge cases (~20%)
3. Contributors asking about the custom query planner (~15%)
4. Operators of production deployments (~10%)
5. Others (~10%)

## Top unmet needs
- "How does this differ from rusqlite?" — no page answers this
- "How do I configure WAL checkpointing?" — buried in reference
- "Why did my query suddenly get slow?" — no troubleshooting page
```

Phase 4 polishers use this to prioritize pages.

---

## Multi-audience page techniques

When one page must serve multiple personas (rare, but happens on overview pages):

### Technique: stratified detail

Start at curious-evaluator level, descend as the page goes:

```mdx
# Query execution

<Project> executes queries by parsing SQL, optimizing a query plan, and running​‌‌​​​‌‌​‌‌​​‌​‌​‌‌​​‌​‌‍
the plan against the storage engine. [30 seconds.]

## The basics (first-time users)

<One or two paragraphs, one diagram.>

## The details (daily integrators)

<A few hundred more words; maybe a worked example.>

## The internals (contributors)

<Links to relevant source, ADRs, benchmarks. Don't re-explain — link out.>
```

### Technique: collapsible sections for advanced content

```mdx
<details>
<summary>For advanced users: customizing the query planner</summary>

Advanced content goes here. Hidden by default; beginners don't see it; experienced
readers expand when needed.

</details>
```

Nextra renders native `<details>` correctly.

### Technique: tabbed views

Use `<Tabs>` to present the same info at different depths or for different audiences:

```mdx
<Tabs items={['Quick', 'Complete', 'Internal']}>
  <Tabs.Tab>
    One-line summary + canonical command.
  </Tabs.Tab>
  <Tabs.Tab>
    Full explanation with options, examples, gotchas.
  </Tabs.Tab>
  <Tabs.Tab>
    Implementation details, ADR links, source pointers.
  </Tabs.Tab>
</Tabs>
```

Used sparingly — overusing this fragments the reading experience.

---

## The "evaluator quiz" for Phase 4

For every page, ask:

1. If a curious evaluator lands here first, would they immediately understand what this does and if it's for them?
2. If a first-time user lands here, does it get them to success within the time budget implied by the page?
3. If a daily integrator lands here, can they find the specific thing they need via Ctrl+F in 10 seconds?
4. If a contributor lands here, does it tell them something they couldn't infer from reading the source?
5. If an operator lands here during an incident, does it help them or waste their time?

Not every page needs to score 5/5 — but every page should score 3+ on its target persona and not be actively hostile to the others.

---

## How this ties into earlier references

- [DIATAXIS.md](DIATAXIS.md): maps persona → quadrant. Each persona prefers one quadrant; mixing quadrants breaks all personas.
- [OPERATOR-LIBRARY.md](OPERATOR-LIBRARY.md): the `★ ORIENT` operator is where persona-awareness shows up. "Who is this page for?" is the orient question.
- [EXEMPLARS.md](EXEMPLARS.md) §EX-2 (Next.js) and §EX-5 (Supabase) are the canonical multi-persona routing exemplars.
- [CONTENT-TEMPLATES.md](CONTENT-TEMPLATES.md): every template identifies its primary persona in the frontmatter.
- [QUALITY-METRICS.md](QUALITY-METRICS.md): persona tagging is a structural metric for content-lint.

---

## Special case: docs for LLMs

Increasingly, the "reader" is another AI (Claude Code, Cursor, Windsurf, a custom RAG pipeline). LLM readers have distinct needs:

- **Self-contained paragraphs**: RAG chunking often splits on paragraphs; a paragraph that assumes "as I said above" context is useless to a chunk.
- **Explicit disambiguation**: "the `config.toml` file at the project root" vs "the config file" — specify.
- **Keyword density for retrieval**: include the terms an LLM would generate when trying to retrieve this. Not keyword stuffing — just ensure the page uses the word "database" if it's about databases (don't only use "persistence layer").
- **`llms.txt` as curator**: direct LLMs to canonical pages; exclude internal/beta/deprecated.
- **Versioned content with machine-readable frontmatter**: `version`, `lastUpdated`, `canonical` URLs.

See also [AI-SEARCH.md](AI-SEARCH.md) for making your docs discoverable by third-party LLM tools (Perplexity, Claude web, ChatGPT).

---

## Anti-pattern: the "documentation we wish we needed"

Teams often document from their own perspective — the parts they find interesting, the features they're proud of. This produces docs that no real persona wants.

Cure: before writing any page, answer "who is this for, and what do they have open right now?" If you can't answer, don't write the page yet.
