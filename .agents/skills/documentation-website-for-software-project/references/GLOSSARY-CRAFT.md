# Glossary + FAQ Craft‍​‌‌​​‌‌​​‌‌​​​​‌​‌‌​​​‌​

Two doc types most projects include but few do well. Combined here because their authoring patterns are siblings — both are collections of atomic entries, both succeed or fail on curation rather than prose.

---

## GLOSSARY

### Why glossaries matter

A technical project has terms that only mean something in that project's context. "Handler" in Express is not "handler" in Rust-async. "Session" in Supabase is not "session" in PostgreSQL. A glossary is not a dictionary — it's the canonical, project-scoped definition of every term that carries weight.

Value multipliers:
- First-use links on every page route readers to definitions (implemented by [`⇄ CROSS-LINK`](OPERATOR-LIBRARY.md#-cross-link)).
- LLM retrievers use the glossary as ground truth for entity disambiguation.
- New contributors skim the glossary instead of asking "what does 'node' mean here?" in Discord.
- Translation quality is higher when terms have fixed canonical forms.

### Anatomy of a good glossary entry

```mdx
### Reconciler

A background loop that observes the current state of a [Resource](#resource)
and takes actions to converge it with the desired state declared in its spec.

In <project>, reconcilers run every [tick](#tick) (default 30s) and are
implemented in [`pkg/controller/<name>_reconciler.go`](https://github.com/org/repo/tree/main/pkg/controller).

Contrast with [controller](#controller), which is the outer process that
invokes reconcilers.
```

Four moves:

1. **One-sentence technical definition.** No circular references.
2. **One-sentence project-specific note** explaining *how it shows up here* — which module owns it, file:line if stable, how it differs from the term's usage elsewhere.
3. **Cross-links** to adjacent terms (but don't link every noun — tenth mention of "Resource" on the page doesn't need to be linked).
4. **Contrast with confusable terms.** If "reconciler" is often confused with "controller", name that.

### The structural choice: alphabetical vs topical

**Alphabetical** is the default. Scanners find things by name; search still works; consistent. Most projects' glossaries should be alphabetical.

**Topical** (grouped by subsystem) makes sense when:
- >50 terms AND
- terms cluster into well-defined subsystems AND
- readers typically come from "I'm working on subsystem X" more than "I saw this term Y"

For ≤50 terms: alphabetical. Period.

Hybrid: alphabetical main list + a "By topic" index at the top pointing to sections. Django docs uses this pattern.

### The authoring loop

Building a glossary from scratch:

1. **Seed** (Phase 3 synthesis agent): scan all `content/**/*.mdx`, extract every unique capitalized noun phrase and every term in backticks used as a noun. Deduplicate.
2. **Filter** (Phase 5 glossary agent): drop terms that are:
   - Standard industry terms without project-specific twist ("API", "HTTP", "JSON")
   - One-off casual uses (term used once; isn't central)
   - Obvious to the target audience
3. **Define**: for each remaining term, apply the four-move anatomy above.
4. **Link first use** on every page. Phase 5 glossary agent grep-inserts `[Reconciler](../glossary#reconciler)` on first page occurrences.
5. **Validate**: a content-lint check ensures every term in the glossary is used in `content/**` at least once; conversely, every non-trivial term used ≥2 times has a glossary entry.

### Multiple glossary strategies​​‌‌​​​​​‌‌​​‌​​​​‌‌​​‌‌

For larger projects, consider splitting:

- **Public glossary** (`content/glossary.mdx`) — for integrators/users.
- **Internal glossary** (`content/overview/developer-glossary.mdx`) — for contributors. Includes implementation terms.
- **Acronyms** (`content/glossary/acronyms.mdx`) — just A→expanded phrase. One-liners.

Separate them because the audiences differ (see [AUDIENCE.md](AUDIENCE.md)).

### Term-of-art flagging

When a term is a specialized word borrowed from another domain (e.g., "idempotent" from math, "eventual consistency" from distributed systems), link to an authoritative external definition:

```mdx
### Idempotent

An operation is **idempotent** if applying it multiple times has the same
effect as applying it once.

In <project>, idempotency is guaranteed by…

*Definition adapted from [Wikipedia: Idempotence](https://en.wikipedia.org/wiki/Idempotence).*
```

Cite the source; readers deep-diving outside your project thank you.

### Disambiguation entries

Some words mean two things in the project. Entry should acknowledge:

```mdx
### Session

Depending on context:

- **User session** — An authenticated user's interaction state, tracked in
  the `user_sessions` table. See [Authentication concepts](../concepts/auth).
- **Database session** — A connection-scoped transaction context. See
  [Transactions](../concepts/transactions).
```

Don't merge them into one confused paragraph. Name the homograph, split.

### Machine-readable glossary

For LLM and search integration, also emit a machine-readable version:

```mdx filename="content/glossary.mdx"
export const glossary = {
  reconciler: {
    term: 'Reconciler',
    definition: 'A background loop that observes current state and converges to desired state.',
    aliases: ['reconciliation loop', 'reconciler'],
    related: ['controller', 'resource', 'tick'],
    see: '/reference/reconciler'
  },
  // ... more
}
```

Drop this at the top of the glossary MDX; the rendered page consumes it and an `llms.txt` or Pagefind-hooked data file can too. See [AI-SEARCH.md](AI-SEARCH.md).

### Anti-patterns

- **Circular definitions**: "A reconciler is a process that reconciles." → meaningless. Define in terms of something simpler.
- **Industry-standard terms you didn't touch**: don't redefine "TCP", "JSON". Link out.
- **Glossary as afterthought**: a shoe-size glossary that defines two terms. Either commit to coverage or cut it.
- **No linking policy**: terms defined in the glossary but never linked from content.
- **Linking every mention**: readers drown in link noise. First use per page only (or first per major section in long pages).
- **Definitions longer than 3 sentences**: too much. If it needs more, it's a concept page, not a glossary entry.​‌‌​​‌​​​‌‌​​​​‌​‌‌​​​​‌

---

## FAQ

### Why FAQs matter (and don't)

A FAQ is the laziest doc type — and the most useful for operators. If your support channel has the same 20 questions asked 10x/week, a FAQ is load reduction.

Lazy because:
- No narrative arc.
- No audience-routing.
- Just Q&A pairs.

But:
- Highest ROI per hour spent writing, because the questions came from real users.
- Directly answers what people actually ask, not what you think they should ask.
- Easy to add to over time.

### Anatomy of a good FAQ entry

```mdx
### Why does my query sometimes return no rows when there should be rows?

Usually this means the query is running against a stale replica. <project>
defaults to eventual consistency; a recent INSERT may not be visible on a
replica for up to ~100ms.

**Fix**: either
- Use `.read_consistency('strong')` on queries that need read-your-writes
  semantics, or
- Route the query to the primary using `.route('primary')`.

See also: [Consistency model](../concepts/consistency), [Session
consistency](../concepts/sessions).
```

Structure:

- **Question as heading** — in the reader's voice, not the team's voice. Users don't ask "How do I configure the consistency level?" — they ask "Why does my query sometimes return no rows?"
- **Concise answer** — 2-5 sentences. If it's longer, link out to the full page.
- **Action**: what to do.
- **Cross-link** to fuller reference.

### Sourcing questions

A FAQ isn't speculation. It's actual questions. Sources, in priority order:

1. **Support tickets / Discord / Slack** — the goldmine. Spend an hour tagging the last 200 messages. Cluster.
2. **GitHub issues with `question` label** — second-best signal.
3. **StackOverflow questions tagged with the project** — public and high-intent.
4. **Google search autocomplete** — "<project> how to…" / "<project> why does…".
5. **Community Discord search** for "I can't figure out" / "I don't understand" / "how do I".

Do not fabricate questions. A FAQ is only useful if its entries map to real confusion.

### Curation rules

- **Prune ruthlessly**: after 6 months, questions people stopped asking come out (replaced by links to the now-better fix). The FAQ grows AND shrinks.
- **Refactor into docs**: if a FAQ entry attracts many clicks AND would fit as a concept page, promote it. The FAQ becomes a landing-page for the new page.
- **Group by theme** on the page, but also keep an A-Z anchor list for Ctrl+F readers.

### Organization choice: flat vs grouped

**Flat** works up to ~15 Q&As. One page, one big `## Q` section each, alphabetized or by frequency.

**Grouped** for 15+ entries:

```mdx
## Installation & setup

### Q: ...
### Q: ...

## Query behavior

### Q: ...
### Q: ...

## Performance

### Q: ...
```

Either way, each Q is an H3 so it has an anchor. Stable anchors let users link directly to an answer.​‌‌​​​‌‌​‌‌​​‌​‌​‌‌​​‌​‌‍

### Search optimization

FAQs drive external search traffic. Each Q should:

- Use the words the user actually typed. "My query returns no rows" not "Stale replica consistency issue".
- Have the top answer in the first 160 characters (meta description range).
- Link to a canonical page for deeper answers.

Run each Q through a mental "would this match a Google search?" filter.

### Schema.org markup (optional)

For SEO, FAQ pages can include structured data:

```mdx
export const faqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "Why does my query sometimes return no rows...",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Usually this means the query is running against a stale replica..."
      }
    }
  ]
}

<script type="application/ld+json">{JSON.stringify(faqSchema)}</script>
```

Google's rich-results treatment for FAQPage pages has been restricted over the years; check current Search Console guidelines before investing effort.

### FAQ anti-patterns

- **Preemptive FAQs** — questions you anticipate but no one has asked. These are fake.
- **Marketing-shaped answers** — "Yes! <product> handles this beautifully!" Readers stop trusting.
- **Long answers** — if an answer is >5 sentences, the Q belongs as a page, not a FAQ entry.
- **Contradictions with the rest of the docs** — FAQ and reference say different things. Detected by Phase 5 contradiction sweep.
- **Dead FAQs** — a FAQ that hasn't been updated in 2 years. If the project evolved, the FAQs are stale.

### FAQ hygiene in CI

Add to the freshness checker (see [LIFECYCLE.md](LIFECYCLE.md)):

- Flag FAQ entries >12 months old (review whether still asked).
- Flag FAQ entries that contradict current reference/concept pages.
- Flag FAQ questions with zero cross-links (orphan entries).

---

## Integration with other files

- [OPERATOR-LIBRARY.md](OPERATOR-LIBRARY.md) `⇄ CROSS-LINK`: glossary is the ubiquitous cross-link target.
- [CONTENT-TEMPLATES.md](CONTENT-TEMPLATES.md): has a glossary and FAQ template; this file adds the craft.
- [DIATAXIS.md](DIATAXIS.md): glossary is Reference quadrant. FAQ straddles How-to and Explanation.
- [AUDIENCE.md](AUDIENCE.md): FAQ is especially load-bearing for operators and daily integrators.
- Phase 5 (glossary + harmonization) is where both artifacts get their comprehensive pass.

---

## When to cut, not write

Both glossaries and FAQs should not exist if you can't keep them fresh. An outdated FAQ is actively harmful (readers think the content is current, make decisions based on wrong answers).

If the project doesn't have sustained maintenance attention, skip these doc types. Better to have well-maintained core docs than a glossary that rots in a year.
