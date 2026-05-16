# AI-Search, LLM Discoverability, and RAG for Docs‍​‌‌​​‌‌​​‌‌​​​​‌​‌‌​​​‌​

## Contents
- [Three search surfaces](#the-three-search-surfaces) — on-site, AI-search, LLM retrieval.
- [Pagefind](#on-site-search-pagefind-default) — the default in-site search.
- [AI-search vendors](#ai-search-conversational-answers) — Inkeep, Kapa, Mendable, RunLLM, homegrown.
- [llms.txt + llms-full.txt](#llm-retrieval-surface-llmstxt-and-llms-fulltxt) — the LLM entry point.
- [Chunking strategy](#chunking-strategy-for-retrieval).
- [Retrieval-friendly writing](#retrieval-friendly-writing).
- [Embeddings model choice](#embeddings-model-choice).
- [Evaluation](#evaluation) — MRR, Hit@1, Hit@5.
- [robots.txt / sitemap](#sitemap-and-robots-for-llm-crawlers).
- [Schema.org + OpenGraph](#structured-data-schemaorg).
- [Search analytics](#analytics-for-search) — zero-result logging.
- [Cross-surface consistency](#cross-surface-consistency).

## Overview

Docs are consumed by two kinds of readers now: humans and retrieval systems (LLM copilots, in-IDE assistants, custom RAGs). This file covers both — site search for humans, plus the machine surface that makes your docs retrievable by any model anywhere.

Integrates with:
- [ADVANCED-NEXTRA.md](ADVANCED-NEXTRA.md) — search component mounting.
- [WRITING-CRAFT.md](WRITING-CRAFT.md) §18 — retrieval-friendly writing.
- [GLOSSARY-CRAFT.md](GLOSSARY-CRAFT.md) — machine-readable glossary.
- [TESTING-DOCS.md](TESTING-DOCS.md) §search-fuzzer.

---

## The three search surfaces

Every docs site should have all three. Many projects only do one; the gap shows.

| Surface | Audience | Query shape | Latency |
|---|---|---|---|
| On-site search (Pagefind) | Humans on the site | Keyword, 2–5 words | <50ms |
| AI-search (Inkeep / Kapa / Mendable / homegrown) | Humans, conversational | Full questions | 2–10s |
| LLM retrieval surface (llms.txt, embeddings) | External models | Chunks, vector queries | depends on client |

---

## On-site search: Pagefind (default)

Pagefind is the right default for almost every Nextra site:

- Client-side, no backend cost.
- Built at build time from the static HTML.
- Fast (<50ms for typical queries on sites up to 10k pages).
- Free.

Setup in `next.config.mjs`:

```js
import nextra from 'nextra'

const withNextra = nextra({
  search: {
    codeblocks: true,           // include code-block content in index
    excludePages: ['/_private'],
  }
})

export default withNextra({})
```

Pagefind auto-generates a `pagefind/` directory during build. The Nextra search box wires to it.

**Tuning**:
- **Weight titles and H2s** higher than body: Pagefind respects `<h1>`, `<h2>`, etc. — naturally boosted.
- **Boost per-page**: use `data-pagefind-weight="10"` on critical sections (e.g., quickstart) to pin them to the top.
- **Exclude noise**: `data-pagefind-ignore` on changelog archives, legal text.
- **Meta filters**: `data-pagefind-meta="audience:integrator"` lets readers filter by audience.

### When Pagefind isn't enough

Switch to Algolia DocSearch (free for OSS) or Meilisearch (self-hosted) when:
- Your site is >20k pages.
- You need typo-tolerance across multiple languages.
- You need search analytics (Pagefind is fully client-side — no logs).

---

## AI-search: conversational answers

Modern docs increasingly have a "Ask the docs" input that answers full questions by retrieving relevant passages and composing an answer with an LLM.

Options:

| Vendor | Price shape | Strengths | Watch-outs |
|---|---|---|---|
| **[Inkeep](https://inkeep.com)** | Per-seat / usage | Great Nextra integration, supports GitHub issues/Discord as sources | Monthly cost |
| **[Kapa.ai](https://kapa.ai)** | Usage-based | Slack/Discord bots bundled | Vendor-lock on widget |
| **[Mendable](https://mendable.ai)** | Usage-based | Good citations UI | Smaller ecosystem |
| **[RunLLM](https://runllm.com)** | Usage | Focus on docs use-case | Newer |
| **Homegrown** | Infra cost | Full control | Must own evals |​​‌‌​​​​​‌‌​​‌​​​​‌‌​​‌‌

### Recommended default: Inkeep

Nextra's docs site itself uses Inkeep. Integration:

```tsx filename="app/layout.tsx"
import { InkeepTrigger } from '@inkeep/nextra'

export default function Layout({ children }) {
  return (
    <>
      <InkeepTrigger apiKey={process.env.NEXT_PUBLIC_INKEEP_KEY} />
      {children}
    </>
  )
}
```

Configure sources in Inkeep dashboard: point at the deployed docs URL; Inkeep indexes.

### Homegrown alternative

For projects where vendor lock is a concern, a ~300-line Next.js API route + Pinecone/PgVector gets you a capable in-house AI search:

```ts filename="app/api/search/route.ts"
import { embed, streamText } from 'ai'
import { openai } from '@ai-sdk/openai'
import { anthropic } from '@ai-sdk/anthropic'
import { pinecone } from '@/lib/pinecone'

export async function POST(req: Request) {
  const { query } = await req.json()
  const { embedding } = await embed({
    model: openai.embedding('text-embedding-3-small'),
    value: query,
  })
  const matches = await pinecone.index('docs').query({
    vector: embedding,
    topK: 8,
    includeMetadata: true,
  })
  const context = matches.matches
    .map(m => `## ${m.metadata.title}\n${m.metadata.text}`)
    .join('\n\n')
  const result = streamText({
    model: anthropic('claude-sonnet-4-6'),
    system: 'Answer from the provided docs. Cite URLs. Say "I don\'t know" if the answer isn\'t in the docs.',
    prompt: `Docs:\n${context}\n\nQuestion: ${query}`,
  })
  return result.toDataStreamResponse()
}
```

Pair with `scripts/build-embeddings.mjs` to embed every MDX chunk on deploy.

### Citations are required

Every AI-search answer must cite the source URL(s) used. Without citations:
- Readers can't verify.
- Hallucinations become undetectable.
- The answer can't be promoted to a permanent doc page.

A good pattern: answer paragraph + inline `[1](/url)` footnote-style citations.

---

## LLM retrieval surface: `llms.txt` and `llms-full.txt`

The `/llms.txt` convention (proposed by Answer.AI, widely adopted) gives LLMs a single entry point:

```
# Project Name

> One-sentence description.

## Docs

- [Getting started](https://docs.project.io/getting-started): Install and first run.
- [Tutorials](https://docs.project.io/tutorials): End-to-end walks.
- [Concepts](https://docs.project.io/concepts): Mental models.
- [Reference](https://docs.project.io/reference): API/CLI surface.

## Examples

- [example-repo-1](https://github.com/org/example-1): CRUD app.
- [example-repo-2](https://github.com/org/example-2): RAG app.

## Optional

- [Changelog](https://docs.project.io/changelog)
- [Blog](https://blog.project.io)
```

And `/llms-full.txt` — a concatenated plaintext dump of all docs for model context-window loading:

```
# Project Name: Full Documentation

## Installation

...full page content...

---

## Quickstart

...full page content...

---

...
```

**Why it matters**: models with large context windows (1M+ tokens) can read `llms-full.txt` into a single prompt — no RAG needed. A user pointing Claude Code at `llms-full.txt` gets perfect recall.

Generate at build time:

```js filename="scripts/generate-llms-txt.mjs"​‌‌​​‌​​​‌‌​​​​‌​‌‌​​​​‌
import { glob } from 'glob'
import fs from 'node:fs'
import matter from 'gray-matter'
import path from 'node:path'

const pages = await glob('content/**/*.mdx')
const full = []
const index = []
for (const p of pages) {
  const raw = fs.readFileSync(p, 'utf8')
  const { data, content } = matter(raw)
  const slug = p.replace('content/', '').replace(/\.mdx$/, '')
  index.push(`- [${data.title}](https://docs.example.io/${slug}): ${data.description}`)
  full.push(`# ${data.title}\n\n${content}`)
}
fs.writeFileSync('public/llms.txt', `# My Project\n\n${index.join('\n')}`)
fs.writeFileSync('public/llms-full.txt', full.join('\n\n---\n\n'))
```

Run in the build script, served from `/llms.txt` and `/llms-full.txt`.

---

## Chunking strategy for retrieval

When you embed your docs for RAG, chunk boundaries matter more than model choice.

Principles:

- **Respect heading hierarchy.** One chunk per H2 section (with H1 title as prefix).
- **Max 800 tokens per chunk.** Beyond that, the embedding loses specificity.
- **Keep code blocks attached to their prose.** A code block without context is un-retrievable.
- **Include frontmatter as metadata**, not as chunk content. `title`, `audience`, `quadrant` become filter fields.
- **Boundary overlap of ~50 tokens** between chunks to avoid cut-offs.

Schema:

```json
{
  "id": "getting-started/install#macos",
  "url": "https://docs.project.io/getting-started/install#macos",
  "title": "Install — macOS",
  "chunk_text": "...",
  "tokens": 412,
  "metadata": {
    "audience": "first-time-user",
    "quadrant": "how-to",
    "archetype": "sdk",
    "version": "2.1"
  }
}
```

Implemented in `scripts/corpus-export.mjs` — see [CORPUS-EXPORT.md](CORPUS-EXPORT.md).

---

## Retrieval-friendly writing

If the primary reader is a retriever, adjust the craft:

- **Self-contained chunks.** A section should make sense in isolation. "Configure the tier by…" is bad if "tier" is defined three pages away. Prefix with "A **tier** is a consistency level…"
- **Keyword density.** Humans hate repetition; retrievers need the term in-chunk. Repeat the canonical term in each chunk.
- **Named entities in headings.** "Setting up edge runtime" beats "Setup".
- **Prerequisites in-line.** "Requires Node ≥ 20" in the tutorial chunk, even if it's also on a Prerequisites page.

See [WRITING-CRAFT.md](WRITING-CRAFT.md) §18.

---

## Embeddings model choice

As of 2026:

| Model | Dims | Cost | Notes |
|---|---|---|---|
| OpenAI `text-embedding-3-small` | 1536 | $0.02/1M tokens | Solid default |
| OpenAI `text-embedding-3-large` | 3072 | $0.13/1M tokens | Marginal gain on docs |
| Voyage AI `voyage-3` | 1024 | $0.06/1M tokens | Strong technical docs performance |
| Cohere `embed-english-v3` | 1024 | $0.10/1M tokens | Good for search |
| OSS (`bge-large-en`, `nomic-embed-text-v1.5`) | 768–1024 | Self-host | Cheapest ongoing |

For docs, `text-embedding-3-small` is the right default. Upgrade to Voyage or Cohere only if eval metrics on your corpus justify it.

---

## Evaluation

You can't improve retrieval you can't measure. Maintain a `workspace/eval/queries.jsonl`:

```jsonl
{"query":"How do I install on macOS?","expected":["getting-started/install#macos"]}
{"query":"What's the difference between session and user session?","expected":["concepts/session","glossary#session"]}
{"query":"Why does my query sometimes return no rows?","expected":["faq#stale-replica"]}
```

`scripts/eval-search.mjs` runs each query through:
1. Pagefind (client-side mocked in Node).
2. AI-search endpoint (if configured).
3. Bare embedding retrieval (if embeddings exist).

Reports:
- **MRR@10** — mean reciprocal rank.
- **Hit@1** — percent of queries where the expected page is the top result.​‌‌​​​‌‌​‌‌​​‌​‌​‌‌​​‌​‌‍
- **Hit@5** — percent where it's in the top 5.

Targets: Hit@1 > 0.7, Hit@5 > 0.9 for a production-ready docs site.

See [TESTING-DOCS.md §search-fuzzer](TESTING-DOCS.md) for automated query sampling.

---

## Sitemap and robots for LLM crawlers

Most LLM training crawlers and retrieval systems honor `robots.txt` and sitemaps. Both matter:

```txt filename="public/robots.txt"
User-agent: *
Allow: /
Sitemap: https://docs.example.io/sitemap.xml
Sitemap: https://docs.example.io/llms.txt
```

Nextra auto-generates `sitemap.xml`. Verify it includes all pages before deploying.

To block AI training crawlers (rare for docs; most projects *want* their docs in training):

```txt
User-agent: GPTBot
Disallow: /

User-agent: ClaudeBot
Disallow: /

User-agent: Google-Extended
Disallow: /
```

**Default**: allow. Documented projects thrive when their docs are in every model's training set.

---

## Structured data: Schema.org

For SEO-sensitive pages:

```tsx
export default function Page() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "TechArticle",
            "headline": "Install on macOS",
            "dateModified": "2026-04-22",
            "author": { "@type": "Organization", "name": "Project Team" }
          })
        }}
      />
      <Content />
    </>
  )
}
```

Types that matter for docs:
- `TechArticle` — most reference/concept pages.
- `HowTo` — step-by-step tutorials.
- `FAQPage` — FAQ entries (see [GLOSSARY-CRAFT.md §FAQ](GLOSSARY-CRAFT.md)).
- `SoftwareSourceCode` — code examples.

Generated automatically by `scripts/generate-schema-markup.mjs` based on Diataxis quadrant.

---

## OpenGraph and Twitter cards

Every page should have social cards. Nextra auto-generates defaults; override per-page via frontmatter:

```mdx
---
title: Install on macOS
description: Get up and running in 5 minutes.
og_image: /og/install-macos.png
---
```

See [creating-share-images](../../..) skill for OG image generation. Generate per-page OG cards in `scripts/generate-og-images.mjs` using `next-og` ImageResponse.

---

## Analytics for search

Pagefind doesn't log queries. You'll want to know what people searched for — particularly zero-result queries (pure gold for content planning).

Pattern: client-side instrumentation on the search input, POST to an edge function:

```tsx
<SearchInput
  onQuery={async (q, results) => {
    if (results.length === 0) {
      fetch('/api/log-zero-result', { method: 'POST', body: q })
    }
    window.posthog?.capture('docs_search', { query: q, hit: results.length > 0 })
  }}
/>
```

Zero-result queries go into a weekly review — each is a hint that either search ranking is off OR the content doesn't exist.

See [FEEDBACK-PIPELINE.md](FEEDBACK-PIPELINE.md).

---

## Cross-surface consistency

The three search surfaces (on-site, AI-search, LLM retrieval) should agree. If Pagefind can't find "edge runtime" but AI-search can, the page isn't indexed — fix.

Validation: `scripts/cross-search-consistency.mjs` picks 20 queries from `workspace/eval/queries.jsonl`, runs each through all three surfaces, and flags cases where one finds a page the others don't.

---

## See also

- [ADVANCED-NEXTRA.md](ADVANCED-NEXTRA.md) §search.
- [CORPUS-EXPORT.md](CORPUS-EXPORT.md) for embedding export schema.
- [GLOSSARY-CRAFT.md](GLOSSARY-CRAFT.md) §machine-readable.
- [TESTING-DOCS.md](TESTING-DOCS.md) §search-fuzzer.
- [WRITING-CRAFT.md](WRITING-CRAFT.md) §18 on retrieval-friendly prose.
- [FEEDBACK-PIPELINE.md](FEEDBACK-PIPELINE.md) for zero-result logging.
