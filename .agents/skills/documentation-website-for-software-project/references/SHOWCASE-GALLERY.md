# Showcases, Galleries, and Ecosystem Pages‍​‌‌​​‌‌​​‌‌​​​​‌​‌‌​​​‌​

The "social proof" side of documentation. Users who stay past the evaluation phase want to see others succeeding. Projects that skip this are harder to adopt even when the technical docs are perfect.

---

## The genres

| Page type | Purpose | Example (see [EXEMPLARS.md](EXEMPLARS.md)) |
|-----------|---------|--------------------------------------------|
| **Showcase** | "Who uses this?" — customer/project list | Nextra's /showcase |
| **Example gallery** | "What can I build?" — small demo projects | Astro's `/themes` |
| **Recipes / cookbook** | "Task-shaped how-tos, browseable" | Svelte's `/examples` |
| **Case studies** | "Deep dives on how one team uses it" | Vercel Customers |
| **Templates / starters** | "Scaffolded projects to fork" | Next.js examples |
| **Ecosystem / integrations** | "What tools plug into this?" | TanStack ecosystem |
| **Community** | "Where to go for help" | Astro community |
| **Sponsors / supporters** | "Who funds this?" | Astro sponsors |
| **Team / about** | "Who are you people?" | Supabase team |
| **Changelog** | "What's new?" | — |
| **Blog** | "Periodic project communication" | — |

Not every project needs every page. A solo-maintained library doesn't need a Team page. Pick the subset that matches the project stage.

---

## Showcase page

"Who's using this?"

### Structure

```mdx
---
title: Showcase
description: Projects built with <project>.
theme:
  typesetting: article
  layout: full
  toc: false
---

# Projects using <project>

From small open-source tools to global production systems, <project> powers
thousands of projects. Add yours by [opening a PR](https://github.com/.../showcase.yml).

<ShowcaseGrid />
```

Behind the scenes, `ShowcaseGrid` is a React component that reads from a manifest:

```yaml filename="data/showcase.yml"
- name: "Acme CRM"
  url: "https://acme-crm.com"
  logo: "/showcase/acme.svg"
  description: "B2B CRM built on <project>. 40k customers."
  tags: [saas, enterprise]
  highlight: true   # render bigger

- name: "WidgetCo"
  url: "https://widgetco.io"
  logo: "/showcase/widgetco.svg"
  description: "E-commerce widget platform."
  tags: [ecommerce]
```

### Curation

- Reach out to known users; don't farm for generic logos.
- Require explicit consent (a PR from the company or a confirmation email).
- Live link mandatory. Dead showcases hurt credibility.
- Logos at consistent height (60–80px), transparent background preferred.
- Grid order: by user-chosen prominence OR alphabetically; don't hide small users to highlight big ones — all-inclusive signaling more healthy ecosystems.

### Anti-patterns

- Fake/recycled logos (e.g., from a deck).
- Logos without consent → legal problems.
- Logo walls bigger than the product's actual user base → signal of insecurity.
- Letting showcase rot — dead companies still listed. Freshness CI: ping each URL quarterly.

---

## Example gallery

"What can I build?" — tight, runnable demos.

### Structure

```
content/examples/
  index.mdx                        # Gallery grid page
  _examples.data.ts                # Example manifest
  todo-app.mdx                     # One per example
  auth-flow.mdx
  realtime-chat.mdx
  ...
```

`content/examples/index.mdx`:

```mdx
---
title: Examples
description: Small projects demonstrating <project> features.
---

# Examples

Each example is a complete, runnable project. Click through for walkthrough,
code, and a StackBlitz link to try it live.

<ExampleCards />
```

Each individual example page combines:
- Short narrative
- Screenshot / GIF of the running app
- Live playground (Sandpack or StackBlitz — see [INTERACTIVE.md](INTERACTIVE.md))
- Code listing (filename-tagged)
- "Try this next" cross-links​​‌‌​​​​​‌‌​​‌​​​​‌‌​​‌‌

### Scope per example

- One concept per example.
- Minimum viable: the smallest thing that shows the concept.
- Copy-pasteable into a fresh project.
- No vestigial code ("we also added this because").

### Gotcha: stale examples

Examples rot faster than reference docs (they depend on more APIs). Add to freshness CI:

```sh
for ex in examples/*/; do
  (cd $ex && bun install && bun run build) || echo "BROKEN: $ex"
done
```

Run on every PR. Break the build when an example does.

### Anti-patterns

- 50 examples of varying quality → better with 15 curated.
- Example labels like "Simple example" — tell me WHAT it shows.
- Examples with lots of commentary in code → split into narrative + clean code.

---

## Recipes / cookbook

Task-shaped how-tos, highly browseable, one tiny page per recipe.

### Structure

Similar to example gallery but more focused on atomic tasks:

```
content/recipes/
  index.mdx                        # Searchable index
  authenticate-with-oauth.mdx
  paginate-large-result-sets.mdx
  implement-rate-limiting.mdx
  rotate-api-keys.mdx
  ...
```

### Recipe template

```mdx
---
title: Paginate large result sets
description: Use cursor pagination for result sets >10k rows.
tags: [query, performance]
---

# Paginate large result sets

## Problem

You need to page through a query result with more than ~10k rows. Offset
pagination (`LIMIT 100 OFFSET 10000`) gets slow for high offsets.

## Solution

Use cursor pagination:

```ts
const firstPage = await client.users.list({ first: 100 })
const nextPage = await client.users.list({
  first: 100,
  after: firstPage.pageInfo.endCursor
})
```

## Why this works

`after` uses the primary key index for O(log n) lookup, regardless of offset.

## Related

- [Query performance](../concepts/performance)
- [Pagination reference](../reference/pagination)
```

### Curation

- Keep recipes short. If one is >500 words, it's probably a concept page.
- Title starts with a verb ("Paginate", "Authenticate", "Rotate") — imperative.
- Don't duplicate reference material; link to it.
- Search-optimized titles — use the words users Google.

---

## Case studies

"How one team uses this" — longer than a showcase entry, shorter than a book chapter.

### Structure

```mdx
---
title: How Acme CRM scaled to 10M customers with <project>
description: A deep dive on Acme CRM's architecture.
theme:
  typesetting: article
---

# How Acme CRM scaled to 10M customers with <project>

## The team

<Who they are: size, relevant roles, domain.>

## The challenge

<The business problem that brought them to <project>.>

## The architecture

<Diagrams, component breakdowns. One mermaid at minimum.>

## What worked

<Concrete lessons. Numbers where possible ("we cut latency 60%").>

## What didn't

<Honest. Case studies that claim no challenges read like marketing.>

## Advice for others

<Transferable lessons.>

## References

- [Their blog post](https://acme.com/blog/scaling-with-x)
- [Conference talk](https://youtube.com/...)
```

### Sourcing

- Ask your largest / most interesting users.
- Conduct an interview (30–60 min). Have them review the draft before publishing.​‌‌​​‌​​​‌‌​​​​‌​‌‌​​​​‌
- Offer them visibility value: cross-promotion, conference talk slots.

### Anti-patterns

- Unverifiable claims ("100x faster"). Attach methodology.
- No "what didn't work" section → marketing.
- Case studies as the only substantive customer content. Also need showcase + social proof elsewhere.

---

## Templates / starters

"Scaffolded projects to fork."

### Structure

Host templates as separate repos:

```
github.com/org/project-template-nextjs
github.com/org/project-template-rust-cli
github.com/org/project-template-electron
```

Each template:
- README explains the use case.
- `create-<project>` CLI command (or `gh repo create --template`).
- CI working out of the box.

In docs:

```mdx
# Templates

## Official templates

| Template | Use case | Link |
|----------|----------|------|
| Next.js app | SaaS frontend + API | [Repo](https://github.com/org/project-template-nextjs) |
| Rust CLI | Standalone CLI tool | [Repo](https://github.com/org/project-template-rust-cli) |

## Community templates

<community list, reviewed periodically>

## Create your own

Templates should include:
- A working CI pipeline
- An example test
- ...
```

### Linking to `create-*` CLI

If the project has a scaffolder (`bunx create-my-app`), prominently feature it on the landing and the get-started page. It reduces friction from "docs → working code" to seconds.

---

## Ecosystem / integrations page

"What tools plug into this?"

### Structure

```mdx
---
title: Ecosystem
description: Tools, plugins, and integrations.
---

# Ecosystem

## Official integrations

- [X-connector](/integrations/x) — bridge to X (maintained by us).
- [Y-adapter](/integrations/y) — adapter for Y.

## Community integrations

<A curated list with "maintained", "last updated", "compatibility" columns.>

| Name | Author | Status | Last updated | Compatibility |
|------|--------|--------|--------------|---------------|
| [my-plugin](https://github.com/user/my-plugin) | @user | Active | 2026-04-10 | v4+ |

## Building integrations

See the [plugin authoring guide](../guides/plugins/authoring).

## Get listed

Submit a PR to [ecosystem.yml](https://github.com/.../ecosystem.yml) with
name, author, URL, and a one-line description. We review weekly.
```

### Curation

- Label maintenance status honestly (Active / Maintained / Archived).
- Cross-check last-updated monthly; auto-flag when >6 months without a commit.
- Don't hide competitors' adapters — if someone built a bridge to your competitor, listing it signals a mature ecosystem.

---

## Community page

"Where to go for help"

### Structure

```mdx
---
title: Community
description: Where to chat, help, and contribute.
---

# Community

Our community is where <project> lives. Here's where to go.

## Ask a question

- **[GitHub Discussions](https://github.com/.../discussions)** — best for
  questions that might benefit others. Searchable.
- **[Discord](https://discord.gg/...)** — real-time, good for quick questions.
- **[Stack Overflow (`<tag>` tag)](https://stackoverflow.com/questions/tagged/...)** —
  for "how do I..." that others will Google.

## Report a bug

- **[GitHub Issues](https://github.com/.../issues/new?template=bug.yml)**​‌‌​​​‌‌​‌‌​​‌​‌​‌‌​​‌​‌‍

## Propose a feature

- **[Feature requests](https://github.com/.../discussions/categories/ideas)** —
  discuss first, then a formal RFC if we agree.

## Contribute code

- See [Contributing](../overview/contributing).

## Contribute docs

- PRs welcome on [the docs repo](https://github.com/.../docs).

## Attend an event

- [Our calendar](...) — talks, office hours, meetups.
```

Routing matters: readers arrive here confused, leave knowing exactly where to go.

---

## Sponsors / supporters

For OSS projects that accept sponsorship.

### Structure

```mdx
---
title: Sponsors
description: Companies and individuals supporting <project>.
---

# Sponsors

<project> is made possible by our sponsors. Without them, it would not exist
in its current form.

## Platinum sponsors

<Logos at highest tier, linking to sponsor websites.>

## Gold sponsors

<Smaller logos.>

## Individual sponsors

<List of individual GitHub Sponsors, if desired.>

## Become a sponsor

- [GitHub Sponsors](https://github.com/sponsors/...)
- [Open Collective](https://opencollective.com/...)
```

### Tiers policy

Publish explicitly: "$500/mo = logo on site, Discord role, [etc.]". Opaque tiers feel extractive.

### Rotating the list

Fetch from GitHub Sponsors / Open Collective APIs at build time so it's always current:

```tsx filename="components/sponsors.tsx"
// Build-time fetch from Open Collective API
export async function Sponsors() {
  const data = await fetch('https://opencollective.com/<project>/members/all.json', {
    next: { revalidate: 86400 }
  }).then(r => r.json())
  // render
}
```

---

## Team / about page

### Structure

```mdx
---
title: About
description: Who we are, why we built <project>.
theme:
  typesetting: article
---

# About

<project> started in <year> when <team> was working on <thing> and hit <pain>.

## Team

<Headshots, names, roles, short bios. Link to personal sites.>

## Values

<What the project stands for: open source, performance, accessibility, etc.
Not marketing fluff — specific.>

## Timeline

- 2024 — Prototype built during <context>
- 2025 — First release
- 2026 — <milestone>
```

Honest "why this exists" stories humanize the project and anchor trust.

---

## Changelog and Blog

Changelog covered in [CONTENT-TEMPLATES.md](CONTENT-TEMPLATES.md). Blog is optional — only adopt if you'll actually maintain it.

If adopting a blog:
- Separate RSS feed at `/blog/rss.xml`.
- `theme: { typesetting: 'article' }` on blog posts.
- Author attribution.
- Publish dates visible.
- Old posts don't rot (add "published YYYY-MM-DD" banner if content is ≥2 years old).

---

## Integration with Nextra features

- [`_meta.global.tsx`](NEXTRA.md#_meta-file-global) exposes showcase/examples/community at the top nav level.
- [`<Cards>`](NEXTRA.md#cards) for gallery grids.
- [`theme: { layout: 'full' }`](NEXTRA.md#per-page-theme-override-keys) for showcase/gallery pages that need more width.
- [OG images](ADVANCED-NEXTRA.md#18-og-image-generation-with-nextog) for each showcase so social shares look right.

---

## Phase integration

These pages are usually written in Phase 3 (synthesis) OR later, once the core docs are solid. They're load-bearing for new-user acquisition but optional for first-run; add selectively based on project maturity.

If the user requests them at Phase 0 ("I want a full site with showcase, examples, sponsors"), spawn additional subagents or add to Phase 3 scope.

---

## Anti-patterns

- **Ghost towns**: a Community page with 3 dead Discord links. Worse than none.
- **Showcase without consent**: legal minefield.
- **Gallery of non-functional examples**: trust killer.
- **Ecosystem page that hides competitors' bridges**: insecure signal.
- **Team page with no photos**: signals remote-only or anonymity, fine for some projects but weird for mature ones.
- **Sponsors page that's just logos** with no "why this matters" framing.
- **Blog that hasn't posted in a year**: delete or unlist.
