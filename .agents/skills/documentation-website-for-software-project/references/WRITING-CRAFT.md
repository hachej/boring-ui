# Writing Craft: Technical Writing Deep Dive‍​‌‌​​‌‌​​‌‌​​​​‌​‌‌​​​‌​

The [OPERATOR-LIBRARY.md](OPERATOR-LIBRARY.md) codifies 12 cognitive moves. This file goes under the hood of *how to write well inside those moves* — the craft of technical prose itself, distinct from structural or Nextra choices.

Use this file when a polish pass has hit the structural targets (heading budget, link density, callout use) but still reads flat, generic, or confusing.

---

## 1. Defeating the curse of knowledge

The single biggest failure mode of technical writing is **you, the author, know too much**. You cannot see what a reader doesn't yet know because you've forgotten not knowing it.

Tactics:

- **The 24-hour rule.** Draft, walk away, return. Read as if someone else wrote it. What sentences assume something you haven't told the reader yet?
- **Name what's invisible.** If you feel a sentence is "obvious", ask *to whom?* If the answer is "anyone who's worked with X for a year", and your audience hasn't, spell it out.
- **The pronoun test.** Circle every "it", "this", "they", "the one". For each, ask: can a reader with your audience's background, starting fresh on this page, say with certainty what that pronoun refers to? If not, replace with an explicit noun.
- **The first-principle check.** Pick any sentence with a verb. Can the reader infer why that verb, not any other? If "we *cache* the result", why not *store*, *memoize*, *persist*? If the distinction matters, make it explicit; if not, use the most common word.

Codified in operator `⊙DE-SLOP` — but specifically, de-slop against the curse of knowledge, not against AI-generated patterns alone.

---

## 2. Progressive disclosure

Every doc page has tiers of detail. The reader chooses their tier. You control how easily they can.

The good shape:

1. **One-sentence answer**, hopefully in the first 20 words.
2. **A three-to-five-sentence version** answering *why* and *when*.
3. **A section-length version** with examples.
4. **A reference-length version** with every edge case.

Nextra helps: `<Callout type="info">` for tier 2 summaries, `<Tabs>` or `<Accordion>` for tier 4 detail. But the *sequencing* has to come from you.

Don't merge tiers into one long paragraph. A reader who only needs tier 1 bounces off tier 4 prose.

---

## 3. One concept per paragraph

If you can summarize a paragraph in one sentence, it has one concept. If you need two sentences to summarize, it has two concepts. Split.

Signal: a paragraph that opens with "and also", "additionally", or "furthermore" is a two-concept paragraph refusing to accept itself. Split. Each concept gets its own opener.

Signal: any paragraph longer than 5 sentences is almost always two concepts. Split.

---

## 4. Scaffolding: the bait-hook-reveal shape

Technical sections live or die by whether the reader *wants* the next sentence. A strong section has three beats:

- **Bait** (1–2 sentences) — something the reader cares about: a problem, a question, a consequence.
- **Hook** — a specific, narrow claim you're about to justify. Ideally, mildly counterintuitive.
- **Reveal** — the mechanism, detail, or explanation.

Example, weak:

> The cache layer is important. It stores frequently accessed data in memory. This reduces database load. It uses an LRU eviction policy.

Example, scaffolded:

> A cold query against our primary dataset takes ~400ms. Repeated a thousand times a second, that's every time a user refreshes. **The cache layer is what makes that manageable** — and the choice of LRU eviction, rather than the FIFO our predecessor tried, was deliberate: we observed that 80% of queries were for the 5% most recent writes, a pattern FIFO eviction actively punished.

The second version has the same information, structured as *problem → claim → mechanism*.

Not every paragraph needs this shape — but every *section* should open with one.

---

## 5. Rhythm: sentence-length variation

Flat prose has uniform sentence length. Alive prose varies. Three short sentences in a row create urgency. A long one after three short ones feels like the conclusion it deserves to be.

Rule of thumb: if three consecutive sentences are all in a 5-word range (say 15–20 words), rewrite one of them. Usually the middle one, because cutting it short creates the rhythm change readers notice.

Compare:

> The API returns a JSON response. The response contains a list of results. Each result has an ID and a timestamp. You can paginate with the cursor parameter.

vs.

> The API returns JSON. Each response has a list of results; each result has an `id` and a timestamp. To paginate, pass the cursor.

Second version: 3 words, 15 words, 6 words. Reads faster despite saying the same thing.

---

## 6. Voice: the second-person trap

"You" is the default voice for how-to. It's warm, specific, action-oriented. But over-used, it nags.

Guidelines:

- **How-to and tutorial: second person ("you"),** because you're guiding the reader through steps.​​‌‌​​​​​‌‌​​‌​​​​‌‌​​‌‌
- **Reference: third person,** because you're describing what the system does, not what the reader does.
- **Concept/explanation: first-person plural ("we"),** because you're reasoning alongside the reader about why things are.

Mixing voices in a single section is fine *if the mode shifts*. Mixing within a paragraph is jarring.

Never use "one" ("one might configure…"). Archaic, cold.

---

## 7. Signposting without scaffolding-noise

Good signposts tell the reader where they are. Bad signposts announce the obvious.

**Good**: "This section assumes you've completed the [Setup](./setup)."

**Bad**: "In this section, we will discuss how to configure the server. First, we'll look at environment variables. Then, we'll cover configuration files."

The bad version *previews* what section headers and the reader's eyes already told them. Cut it. If you need preview text, make it one sentence that adds a *motivation*, not a table of contents.

Signposts that add value:
- Prerequisites (what the reader should have done first).
- Audience narrowing ("If you're on managed hosting, skip to…").
- Scope disclaimers ("This page covers retry; for timeout, see…").

---

## 8. Precision vs accessibility

Technical writing has a tension: *precise* terms are necessary for correctness; *accessible* terms invite readers in. The bad resolution is to pick one and ignore the other.

The good resolution: use the accessible term in the body, link the precise term.

Weak: "Use the reducer pattern to transform state."
Better: "Take the current state and return a new one — this is called a **[reducer](../glossary#reducer)**."

You taught the idea before you named it. The reader who already knows "reducer" skims past; the reader who doesn't has the concept before the vocabulary, and a link for when they want more.

---

## 9. Examples: show, don't just tell

Every non-trivial claim deserves an example. The example should:

- **Run.** It must be executable against the current version of the software. `scripts/validate-examples.mjs` (see [TESTING-DOCS.md](TESTING-DOCS.md)) extracts code blocks and runs them.
- **Be minimal.** No boilerplate beyond what's strictly necessary to show the point.
- **Have one purpose.** If an example shows three features, readers lose what they were there for.
- **Include the expected output** (or the expected visible effect). `// expected: "hello world"` comments are a heuristic check the reader can confirm.

Anti-pattern: the **foo-bar-baz** example. Use realistic domain values (`user.email`, `order.total`, `/api/v2/users/:id`), not `foo.bar.baz`. Abstract names signal "I couldn't be bothered to find a real example."

---

## 10. The error-to-doc pipeline

Every error message a user hits in production is evidence you failed to document something. Treat error strings as doc inputs:

1. Collect error strings from support channels, GitHub issues, telemetry.
2. For each, add to the [TROUBLESHOOTING.md](TROUBLESHOOTING.md) template or to a per-error FAQ entry.
3. Ideally, link the error message *from the code* to the doc entry — embed the URL in the error string.

Example:

```go
return fmt.Errorf("config: invalid cache policy %q (see https://docs.project.io/errors/cache-policy)", p)
```

Now every future instance of this error is self-documenting. This is high-ROI; prioritize it.

See [FEEDBACK-PIPELINE.md](FEEDBACK-PIPELINE.md) for the logging-to-doc loop.

---

## 11. Anti-patterns beyond AI slop

The `⊙DE-SLOP` operator catches patterns common to AI-generated prose. There's a broader class of human-written bad habits:

- **The "simply" tic.** "Simply configure the server." If it were simple, the reader wouldn't be reading docs. "Simply" is almost never true; delete or replace with a real description of the effort.
- **The "just" tic.** Same as above. "Just set the flag." Delete "just."
- **Hedging stacks.** "It's generally recommended in most cases that you probably should…" — pick one. "Set X." If context matters, say "when Y, set X."​‌‌​​‌​​​‌‌​​​​‌​‌‌​​​​‌
- **Wall-of-text definitions.** A concept opens with three sentences of throat-clearing before getting to the point.
- **Unqualified superlatives.** "The fastest way to…", "The best practice is…". Compared to what? Replace with a *specific* comparison or drop the superlative.
- **Nested parentheticals.** "(For more (see also the footnote), but not on managed hosting (unless tier-2+))." Rewrite as a normal sentence.
- **The "as we saw earlier" chain.** References to earlier sections made without page anchors. If it mattered enough to cite, cite the anchor.
- **"In conclusion" / "To summarize".** Written in drafts, deleted in edits. Don't announce you're about to conclude; just conclude.

---

## 12. Transitions

A section that reads well moves the reader from one idea to the next without jolt. Techniques:

- **Forward reference**: end a section with a question the next section answers. `So how does the cache know when to invalidate? See [Invalidation](#invalidation).`
- **Backward reference**: open a section by acknowledging what we just established. "We've seen that caches invalidate on write; the mechanism is…"
- **Shift-marker**: an explicit "Now that…", "Given…", "Before…" that tells the reader the perspective is changing.

Avoid abrupt topic changes within a page. If the topic changes enough to jolt, it's probably two pages.

---

## 13. The last sentence problem

A section's last sentence is its most important — it's what the reader remembers. Make it count:

- A takeaway ("If you remember one thing: the cache is eventually consistent.")
- A forward pointer ("Next: handling invalidation.")
- A practical action ("For most apps, the default tier is correct.")

What it should NOT be:

- A restatement of what the section said. Readers just read it.
- Filler ("Caching is an important technique.") — readers feel the vacuum.
- A new unexplored idea. File it for the next section.

---

## 14. Tables

Tables are underused. Use them when:

- Comparing 3+ options across 2+ dimensions.
- Listing flag/option names with description + default + type.
- Showing input → output mappings.

Don't use them when:

- The "cells" are paragraphs. That's a bulleted list pretending to be a table.
- There's only one column of content (it's a list).
- You want to show a code example. It's a code block.

Table hygiene:

- **Every header row has a type.** "Flag | Default | Description" is better than "Name | Default | What it does".
- **Sort alphabetically unless semantic order matters** (e.g., sequential states, tier order).
- **Be consistent with cell content length.** Don't mix one-word cells with three-sentence cells in the same column.

---

## 15. Reading level and Flesch

Run periodic `textstat` / Flesch-Kincaid checks on prose. Target:

| Content type | Target Flesch reading ease |
|---|---|
| Landing page / quickstart | 60–70 (reads like good blog posts) |
| Tutorial | 55–65 |
| How-to | 50–60 |
| Concept pages | 45–55 (technical, but not wall-of-jargon) |
| Reference | 40–50 |
| Research notes / RFCs | 30–40 |

Below 30 Flesch usually means your prose is cluttered with long jargon-heavy sentences. Above 70 means it's skimming too shallow; add precision.

`scripts/audit-content.mjs` computes these; [QUALITY-METRICS.md](QUALITY-METRICS.md) lists the thresholds.

---

## 16. The search box as writing target​‌‌​​​‌‌​‌‌​​‌​‌​‌‌​​‌​‌‍

Readers don't read docs start-to-finish — they search. Write headings and opening sentences as **search results**.

For each H2/H3:

- Could someone who needed that section type 2–4 words into search and find it?
- Does the first 160 characters under the heading *answer* the likely search intent?
- Is the heading keyword-rich without being keyword-stuffed?

See [AI-SEARCH.md](AI-SEARCH.md) for more on search-as-UX.

---

## 17. Glossary craft

The craft of defining terms is enough of a topic to deserve its own file. See [GLOSSARY-CRAFT.md](GLOSSARY-CRAFT.md).

Key principle this file contributes: **define terms when you first use them non-trivially, not when you first mention them**. First mention might be "Reconciler-based systems are common now"; don't stop to define. The first *non-trivial* use — "the reconciler re-reads desired state each tick" — is where a definition (or glossary link) earns its keep.

---

## 18. Docs-as-corpus for LLM retrieval

When the target audience includes LLM-driven assistants (Cursor, Claude Code, Copilot, or a user's RAG stack), writing craft shifts slightly:

- **Keep each section self-contained.** A chunk that requires 5 cross-reference reads to make sense is a bad retrieval unit.
- **Repeat the vocabulary.** Human readers hate repetition; retrievers need the term in every chunk to match it.
- **State prerequisites in-line.** "This requires Node ≥20" in the tutorial chunk, even if it's on a Prerequisites page. Retrieval doesn't follow sibling links.
- **Named entities in headings.** A heading "Setting up the edge runtime" is more retrievable than "Setup".

See [AI-SEARCH.md](AI-SEARCH.md) for `llms.txt`, retrieval-chunk format, and embeddings.

---

## 19. Calibrating to your project's voice

Not every project wants the same voice. A fintech library wants formal, cautious prose; a game engine wants personality.

Indicators a project wants formal:
- Regulated domain (health, finance, security).
- Enterprise target audience.
- Existing brand voice that's formal.

Indicators a project wants casual:
- Developer-tool or library for indie/hobby use.
- Brand voice elsewhere (blog, Twitter, conference talks) is casual.
- Small, known maintainers whose personalities are part of the appeal.

Phase 2 research captures voice samples from brand-adjacent materials (README, blog posts, CONTRIBUTING) and Phase 5 polish checks new drafts against that voice. Operator `✦MOTIVATE` opens sections in the project's voice; consistency is part of the craft.

---

## 20. When to break every rule above

Rules exist for default cases. Breaking them can be the right call:

- **Opening a tutorial with a long paragraph** is fine if the paragraph is *doing something other than throat-clearing* — setting stakes, naming a problem unique to the project.
- **Flat prose** is fine for short reference blurbs — rhythm variation is a tool for longer reads.
- **"Simply"** is fine when the reader *has* done the setup and the next action is trivially one-line.
- **Mixing voices** in a single paragraph is fine when introducing a how-to *within* a concept page.

The rules are heuristics. When a good writer breaks one, it's because they see a specific reason. When a bad writer breaks one, it's an accident. The difference is intent.

---

## See also

- [OPERATOR-LIBRARY.md](OPERATOR-LIBRARY.md) — the 12 cognitive operators.
- [DIATAXIS.md](DIATAXIS.md) — how these techniques vary by quadrant.
- [QUALITY-METRICS.md](QUALITY-METRICS.md) — thresholds the lint pipeline enforces.
- [AUDIENCE.md](AUDIENCE.md) — how voice and difficulty shift per persona.
- [AI-SEARCH.md](AI-SEARCH.md) — retrievability as a craft concern.
- [GLOSSARY-CRAFT.md](GLOSSARY-CRAFT.md) — term-definition craft.
