# Diátaxis — Information Architecture for Docs‍​‌‌​​‌‌​​‌‌​​​​‌​‌‌​​​‌​

Diátaxis (by Daniele Procida, https://diataxis.fr/) is the one IA framework that has earned its way into serious open-source docs (Django, Cloudflare, Gatsby, GitLab, NumPy, Backstage, many more). Use it as the default partition of your `content/` tree.

---

## The four quadrants

```
                         │ PRACTICAL          │ THEORETICAL        │
                         │ (action)           │ (understanding)    │
─────────────────────────┼────────────────────┼────────────────────┤
  STUDY                  │                    │                    │
  (acquisition of        │     TUTORIALS      │    EXPLANATION     │
   skill/knowledge)      │                    │                    │
─────────────────────────┼────────────────────┼────────────────────┤
  WORK                   │                    │                    │
  (application of        │     HOW-TO GUIDES  │    REFERENCE       │
   skill/knowledge)      │                    │                    │
─────────────────────────┴────────────────────┴────────────────────┘
```

The two axes — **practical ↔ theoretical** and **study ↔ work** — give four distinct documentation shapes. Every page belongs to exactly one quadrant; mixing them is the most common doc failure.

---

## The quadrants, in practice

### 1. Tutorials — *learning-oriented, practical*

**Job:** teach a beginner by doing. The reader ends the tutorial feeling *capable*.

**Shape:**
- Start from zero, assume no prior knowledge.
- Linear: step 1 → step 2 → step 3, no side quests.
- Concrete scenario ("Build a TODO app"), not abstract features.
- Show checkpoints so the reader verifies they're on track ("You should see…").
- End with "What you built" and "Next steps" pointing at how-to guides.

**Tone:** encouraging, peer-level, "we". Technical precision still matters; no infantilizing.

**Nextra shape:** wrap in `<Steps>`. Put prerequisites in a `<Callout type="info">` at top. Add a `<Callout type="important">` for verification failures.

**Anti-pattern:** a "tutorial" that's really a pile of how-to snippets with no arc. Tutorials have a beginning, middle, and end.

**File location:** `content/tutorials/<topic>.mdx` or `content/get-started/<topic>.mdx`.

---

### 2. How-to guides — *task-oriented, practical*​​‌‌​​​​​‌‌​​‌​​​​‌‌​​‌‌

**Job:** help a competent user accomplish a specific goal. The reader knows what they want; show them the way.

**Shape:**
- Problem-scoped title: "How to add authentication", "How to deploy to Cloudflare Pages".
- Assume the user knows the basics.
- Linear, but the goal is *doing the thing*, not learning.
- Show only one way — the recommended way. Don't list 5 alternatives.

**Tone:** direct, imperative. "Do X. Then Y. Then Z."

**Nextra shape:** `<Steps>` or numbered lists. `<Callout type="warning">` for gotchas. One or two cross-links at the end.

**Anti-pattern:** turning a how-to into a tutorial ("First, let's understand what authentication is…"). The user doesn't need concept; they need steps.

**File location:** `content/guides/<task>.mdx` or `content/how-to/<task>.mdx`.

---

### 3. Reference — *information-oriented, theoretical*

**Job:** be a complete, accurate, authoritative description of the thing. The reader arrives looking for a specific fact.

**Shape:**
- Exhaustive (every flag, every return type, every error code).
- Consistent format across entries.
- Austere. No opinions. No "you might want to…".
- Organized by the structure of the thing itself (alphabetical, by command, by module), not by user journey.

**Tone:** neutral, factual, technical. Like a dictionary.

**Nextra shape:** tables. `<TSDoc>` for auto-generated TypeScript API tables. `<Table>` for flags. Consistent heading structure: one heading per API/command, then standard subsections (Parameters, Returns, Errors, Example).

**Anti-pattern:** reference that tries to teach ("Use this when you want to…"). Reference *describes*, it doesn't *advise*. Move opinions to explanation or how-to.

**File location:** `content/reference/<area>.mdx`.

---

### 4. Explanation — *understanding-oriented, theoretical*

**Job:** deepen understanding. The reader already knows how to use the thing; they want to know *why it works* or *why it's designed this way*.

**Shape:**
- Discursive. Not step-based.
- Explores context, history, trade-offs, architecture, design choices.
- Can be opinionated ("We chose Postgres over X because…").
- Longer-form prose.

**Tone:** thoughtful, essay-like. Can use first-person plural for design decisions.

**Nextra shape:** prose-heavy with mermaid diagrams for architecture. Set `theme: { typesetting: 'article' }` in `_meta` for a more article-like font size/line-height. `toc.float` helps on long explanations.

**Anti-pattern:** using explanation pages as marketing ("Our innovative approach…"). Explanation should reason, not sell.​‌‌​​‌​​​‌‌​​​​‌​‌‌​​​​‌

**File location:** `content/concepts/<topic>.mdx` or `content/overview/<topic>.mdx`.

---

## Mapping this skill's outputs to Diátaxis

Our Phase 2/3 default structure lives under the hood as:

| Page | Quadrant |
|------|----------|
| `content/index.mdx` | landing (gateway; not Diátaxis-quadrant itself) |
| `content/overview/what-is-this.mdx` | Explanation |
| `content/overview/architecture.mdx` | Explanation |
| `content/overview/data-flow.mdx` | Explanation (with hints of Reference for file:line citations) |
| `content/overview/contributing.mdx` | How-to |
| `content/overview/glossary.mdx` | Reference |
| `content/get-started.mdx` (if present) | Tutorial |
| `content/<section>/overview.mdx` | Explanation |
| `content/<section>/<module>.mdx` | typically Explanation + Reference (split if large) |
| `content/guides/<task>.mdx` | How-to |
| `content/reference/<entity>.mdx` | Reference |
| `content/tutorials/<scenario>.mdx` | Tutorial |

Phase 4 polish should check every page against its quadrant and flag pages that are mixing two.

---

## The mixing antipatterns (biggest failure modes)

### Tutorial + Reference

"Here's how to install. And here are all 47 config flags." Readers learning get overwhelmed; readers scanning can't find the specific flag.

**Fix:** keep tutorial focused on one config; link to Reference for the full flag list.

### How-to + Explanation

"How to add caching. First, let's understand the LRU algorithm…"

**Fix:** assume background knowledge; link to the Explanation page for readers who need it.

### Reference + Opinion

API reference that says "This method is slow, use X instead." Reference should *describe* X and Y; the Explanation page or a How-to can *advise*.

**Fix:** move recommendation to Explanation; if Reference must mention deprecation, use a plain factual statement ("Deprecated in v4; see [X](link).").

### Explanation that refuses to explain​‌‌​​​‌‌​‌‌​​‌​‌​‌‌​​‌​‌‍

Explanation pages full of marketing adjectives ("elegant", "powerful") without ever actually explaining *how* or *why* something works.

**Fix:** every "X is powerful" claim needs a follow-up paragraph showing *why* — architecture, math, measurement.

---

## Quadrant classification rubric (for Phase 4 polishers)

For every page, ask: **who is the reader, and what do they have in front of them?**

| Reader has | Reader wants | Quadrant |
|------------|--------------|----------|
| Nothing (never used this before) | To gain skill | Tutorial |
| A clear goal (needs to do X) | To accomplish it | How-to |
| Code running already | To find a specific fact | Reference |
| A working system | To understand how/why it works | Explanation |

If you can't answer "who is the reader", the page isn't pulling its weight — decompose it or delete it.

---

## The navigation implication

Diátaxis is IA, which means your sidebar should reflect it. Options:

**Option A — top-level quadrant sections** (recommended for libraries with depth):
```
Docs
├── Tutorials
├── Guides (how-to)
├── Reference
└── Concepts (explanation)
```

**Option B — by topic, with quadrant tags** (recommended when topics dominate):
```
Docs
├── Authentication
│   ├── Get started (tutorial)
│   ├── Enable OAuth (guide)
│   ├── AuthProvider API (reference)
│   └── How auth works (concept)
└── Storage
    ├── ...
```

Option A is cleaner when teaching a reader-mental-model matters. Option B is better when the user arrives with "I need auth" and doesn't care about the quadrants.

Our `_meta.global.tsx` defaults to Option A because it maps cleanly to Phase 0 partitions; switch to B if the project is small and each topic fits on a single page.

---

## Phase integration

- **Phase 3 (synthesis)**: explicitly decide quadrant layout (A or B) and document in `phase3_ia_decision.md`.
- **Phase 4 (polish)**: the polisher prompt includes a "Diátaxis tag each page" step — any page tagged with two quadrants goes on the rework list.
- **Phase 5 (harmonize)**: verify every page has one and only one quadrant tag.
- **Phase 6b (nextra-ify)**: apply quadrant-appropriate theme overrides (`typesetting: 'article'` for Explanation; standard for others).

---

## Further reading

- https://diataxis.fr/ — the canonical source
- https://diataxis.fr/how-to-use-diataxis/ — deeper usage guide

This is the only framework we reference this heavily. Everything else we use (Polish Bar, Operator Library) sits *inside* Diátaxis — they tell you *how* to write a page of a given quadrant well.
