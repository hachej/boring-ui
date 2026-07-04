# Corpus Export: Docs as Reusable Source Material‍​‌‌​​‌‌​​‌‌​​​​‌​‌‌​​​‌​

## Contents
- [Export targets](#export-targets-what-the-script-produces) — JSONL, llms.txt, docset.
- [Chunk schema](#chunk-schema).
- [Chunking rules](#chunking-rules).
- [Exemplar bundle](#the-exemplar-bundle) — style anchors for future projects.
- [Glossary JSON](#glossary-json).
- [Kernel seeds](#kernel-seeds-for-operationalizing-expertise).
- [Dash/Zeal docset](#dashzeal-docset-optional).
- [Licensing](#licensing-considerations).
- [Versioning](#versioning-the-export).
- [Distribution targets](#distribution-targets).
- [Re-import](#re-import-workflow).
- [Validation](#validation-of-exports).

## Overview

Once a docs site is polished, the corpus itself is a reusable asset. This file describes how to export it in machine-friendly shapes that feed:

- **Retrieval systems** (Pagefind, embeddings, RAG) — see [AI-SEARCH.md](AI-SEARCH.md).
- **Other projects' exemplar libraries** — next time you build docs for a sibling project, exemplar snippets anchor style.
- **The `operationalizing-expertise` skill** (Track A) — your concept pages become the quote-bank, your reference pages become the kernel.
- **Downstream distribution** — docsets for Dash, Zeal, offline bundles.

Integrates with:
- [ORCHESTRATION.md §CASS-mining](ORCHESTRATION.md) — the rationale for treating the corpus as mineable.
- [AI-SEARCH.md](AI-SEARCH.md) §chunking — chunk format compatible with embedding pipelines.
- [EXEMPLARS.md](EXEMPLARS.md) — target schema for exemplar extraction.

---

## Export targets (what the script produces)

`scripts/corpus-export.mjs` reads `content/**/*.mdx` and writes multiple outputs to `dist/corpus/`:

| Target | Filename | Consumer |
|---|---|---|
| Retrieval chunks (JSONL) | `chunks.jsonl` | RAG / embedding pipelines |
| Full concatenation | `llms-full.txt` | Long-context LLMs |
| Index | `llms.txt` | LLM entry point |
| Per-page plaintext | `pages/<slug>.txt` | Dash/Zeal, offline tools |
| Exemplar bundle | `exemplars.json` | Future doc projects' anchors |
| Glossary | `glossary.json` | Other projects / translation |
| Kernel seeds | `kernel.json` | `operationalizing-expertise` Track A |
| Docset | `<project>.docset/` | Dash viewer (optional) |

All targets are deterministic — rerunning on unchanged input produces byte-identical output. This matters for CI diffing.

---

## Chunk schema

The canonical chunk shape, shared across retrieval and embedding:

```json
{
  "id": "getting-started/install#macos",​​‌‌​​​​​‌‌​​‌​​​​‌‌​​‌‌
  "url": "https://docs.project.io/getting-started/install#macos",
  "title": "Install — macOS",
  "breadcrumb": ["Getting started", "Install", "macOS"],
  "text": "...",
  "tokens": 412,
  "metadata": {
    "audience": "first-time-user",
    "quadrant": "how-to",
    "archetype": "sdk",
    "version": "2.1",
    "last_modified": "2026-04-22",
    "terms": ["tier", "cache", "edge-runtime"]
  },
  "prev_id": "getting-started/install",
  "next_id": "getting-started/install#linux"
}
```

Notes:

- `id` is the URL path + fragment. Anchor fragments point to H2/H3 headings.
- `breadcrumb` enables UI display of "where am I" without parsing the tree.
- `tokens` is the GPT-4 tokenizer count — most retrieval systems assume this.
- `metadata.terms` is extracted via a lightweight entity-extraction pass (regex over glossary + capitalized noun phrases).
- `prev_id`/`next_id` enable "next chunk" retrieval for context expansion.

---

## Chunking rules

The shipped `scripts/corpus-export.mjs` is a minimal starter that implements rule 1 only — one chunk per H2, H1 as breadcrumb prefix. For retrieval quality in production, extend the script to enforce the full rule set below. A more sophisticated chunker using `remark` AST traversal is the clean way to get there.

Target rules:

1. **One chunk per H2**, with H1 as breadcrumb prefix. *(implemented)*
2. **H3s under H2 stay in the same chunk** unless the combined chunk exceeds ~800 tokens; then split at the next H3. *(extension)*
3. **Code blocks stay attached** to the prose block they follow (never a standalone chunk). *(extension — the starter uses a simple regex `^##\s` match that can be fooled by `##` appearing inside a code block; remark-AST traversal fixes that)*
4. **Tables stay attached** to the preceding prose. *(extension)*
5. **Callouts stay attached** — never split a `<Callout>` across chunks. *(extension)*
6. **Frontmatter** is metadata, not chunk text. *(implemented)*
7. **Glossary** is its own one-chunk-per-term export, not mixed into the main chunks. *(extension — requires glossary convention)*
8. **~50-token overlap** between adjacent chunks to avoid boundary-loss. *(extension)*

Don't ship the extended chunker until you've measured retrieval recall without it — the H2-based simple chunker is often good enough for medium-size docs.

---

## The exemplar bundle

For future projects, you want not only chunks but curated *style anchors*. Format:

```json
{
  "project": "<source project>",
  "exported_at": "2026-04-22",
  "exemplars": [
    {
      "id": "EX-101",
      "pattern": "quickstart-with-expected-output",
      "source_url": "https://docs.project.io/getting-started/quickstart",
      "snippet": "### First request\n\n```ts\nconst result = await client.ping();\nconsole.log(result.status); // 'ok'\n```\n...",
      "why": "Quickstart that shows expected output inline — readers verify success without scrolling.",
      "tags": ["quickstart", "how-to", "code-with-output"]
    },
    {
      "id": "EX-102",
      "pattern": "disambiguation-glossary-entry",​‌‌​​‌​​​‌‌​​​​‌​‌‌​​​​‌
      "source_url": "https://docs.project.io/glossary#session",
      "snippet": "...",
      "why": "Splits a homograph into two clear sub-entries instead of merging.",
      "tags": ["glossary", "disambiguation"]
    }
  ]
}
```

Curation happens at Phase 10 of the pipeline. The main agent picks ~20 exemplars from the polished site that represent patterns worth replicating. See [EXEMPLARS.md](EXEMPLARS.md) for the §EX-NN numbering scheme.

---

## Glossary JSON

Extracted from the in-content glossary export (see [GLOSSARY-CRAFT.md §machine-readable](GLOSSARY-CRAFT.md)):

```json
{
  "project": "<source project>",
  "version": "2.1",
  "terms": {
    "reconciler": {
      "term": "Reconciler",
      "definition": "A background loop that observes current state and converges to desired state.",
      "aliases": ["reconciliation loop"],
      "related": ["controller", "resource", "tick"],
      "see": "/reference/reconciler",
      "first_use_locations": [
        "concepts/state#overview",
        "reference/controller#reconciler-interface"
      ]
    }
  }
}
```

Drop into the target system's translation pipeline, glossary inheritance, or embeddings. For projects with translations, the `translations: {fr: "Réconciliateur", ja: "..."}` field extends this.

---

## Kernel seeds for operationalizing-expertise

The `operationalizing-expertise` skill (Track A) produces a kernel of invariants extracted from expert practice. Your polished docs contain exactly this kind of material — invariants stated as explanations, constraints stated as warnings, conventions stated as patterns. Extract them:

```json
{
  "kernel": [
    {
      "id": "K-001",
      "source": "concepts/consistency#strong-vs-eventual",
      "claim": "Writes to the primary are visible on replicas within ~100ms under normal load.",
      "stance": "empirical",
      "confidence": 0.9
    },
    {
      "id": "K-002",
      "source": "concepts/caching#eviction",
      "claim": "LRU eviction outperforms FIFO when the access pattern is recency-biased (≥70% hits on top 10%).",
      "stance": "design-decision",
      "confidence": 1.0
    }
  ]
}
```

Extraction is half-automated: the Phase 8 fresh-eyes agent tags candidate sentences; the main agent curates.

---

## Dash/Zeal docset (optional)

For developer tools where readers live in offline docset browsers:

```
<project>.docset/
  Contents/
    Info.plist
    Resources/
      docSet.dsidx      # SQLite index
      Documents/
        *.html          # HTML rendered from MDX
```

`scripts/build-docset.sh` uses `next export` to pre-render HTML, then populates the SQLite `searchIndex` table with `(name, type, path)` tuples per page/symbol.

Most docs sites don't need this — but API reference projects benefit.

---

## Licensing considerations

Export flags the license of each chunk:

```json
{
  "id": "...",
  "license": "CC-BY-4.0",
  "license_source": "docs/LICENSE"​‌‌​​​‌‌​‌‌​​‌​‌​‌‌​​‌​‌‍
}
```

This lets downstream RAG consumers respect source terms. If your docs are under different licenses in different sub-trees (e.g., the blog is proprietary, the reference is Apache-2.0), the exporter reads a per-directory `LICENSE` file and stamps each chunk accordingly.

Always ship a `dist/corpus/LICENSES.md` summary — makes downstream trust easy.

---

## Versioning the export

Every export is tagged with:

- `project_version` — the software release the docs describe (e.g., `2.1.0`).
- `docs_sha` — git SHA of the docs commit.
- `exporter_version` — semver of `corpus-export.mjs` itself.
- `exported_at` — ISO 8601 UTC timestamp.

Included in every output file's metadata header. Downstream consumers pin against this when caching.

---

## Distribution targets

Once exported, common destinations:

- **`dist/corpus/`** in the repo (for local consumers).
- **GitHub release asset** (tag the release with `docs-2.1.0`, upload `corpus.tar.gz`).
- **CDN** (S3/R2/CloudFlare Pages — makes `chunks.jsonl` retrievable by URL).
- **Public `llms.txt` / `llms-full.txt`** — see [AI-SEARCH.md](AI-SEARCH.md).
- **Package registry** (rare, but: publish `@project/docs-corpus` to npm with a CLI that re-emits chunks).

The right target depends on who consumes it. For public projects, CDN + GitHub release is the usual combo.

---

## Re-import workflow

When building docs for a *new* project that's similar to an existing one:

1. Download the existing project's `exemplars.json`.
2. Point the Phase 5 polish subagents at it as a style anchor.
3. Optionally import `glossary.json` for shared terms.
4. At the end, the new project emits its own exemplars bundle.

The skill's bootstrap script `scripts/import-corpus.sh <url>` pulls an existing corpus and stages it in `workspace/imported-corpus/`, ready for reference.

---

## Validation of exports

`scripts/validate-corpus.mjs` runs after export:

- Chunk IDs unique.
- Every chunk's `url` resolves (live site check optional).
- Token counts sum reasonable (>= sum of page word counts × 1.3).
- Glossary terms match content references (each term appears in ≥1 chunk).
- No stripped callouts (sampling).

Fails the build if corpus is malformed. Same bar as the rest of the site.

---

## See also

- [AI-SEARCH.md](AI-SEARCH.md) — how chunks feed retrieval.
- [ORCHESTRATION.md](ORCHESTRATION.md) §CASS-mining — why the corpus is accretive.
- [EXEMPLARS.md](EXEMPLARS.md) — exemplar numbering.
- [GLOSSARY-CRAFT.md](GLOSSARY-CRAFT.md) §machine-readable — glossary source-of-truth.
- [TESTING-DOCS.md](TESTING-DOCS.md) — validation layers.
