# Testing Documentation‍​‌‌​​‌‌​​‌‌​​​​‌​‌‌​​​‌​

## Contents
- [Six layers of validation](#the-six-layers-of-docs-validation) — the pyramid overview.
- [Layer 1: Build-time](#layer-1-build-time-validation) — MDX, frontmatter.
- [Layer 2: Links & anchors](#layer-2-link-anchor-and-orphan-validation).
- [Layer 3: Code-in-docs](#layer-3-code-in-docs-testing-golden--conformance--real-service) — extract+run, golden, conformance.
- [Layer 4: Polish/lint](#layer-4-polish--lint) — de-slopify + quality metrics.
- [Layer 5: Fresh-eyes in CI](#layer-5-agentic-fresh-eyes-in-ci).
- [Layer 6: User-lens](#layer-6-user-lens-persona-simulation).
- [Metamorphic tests](#metamorphic-tests-for-docs).
- [Fuzzing](#fuzzing).
- [Freshness checks](#freshness-checks).
- [Per-release gates](#per-release-gates).
- [Property-based tests](#property-based-tests-docs-edition).
- [Test pyramid](#test-pyramid-for-docs).
- [Failure telemetry](#failure-telemetry).

## Overview

Docs rot faster than code. A page that was right at release N is wrong at N+1, and nothing in the normal test suite catches it. This file describes the testing regime that keeps a docs site correct.

Informed by the testing family of skills:
- `testing-golden-artifacts` — freeze known-good outputs, fail loudly on drift.
- `testing-conformance-harnesses` — verify that docs match a spec.
- `testing-metamorphic` — check invariants that should hold across reformulations.
- `testing-real-service-e2e-no-mocks` — run example code against the real software.
- `testing-fuzzing` — mutate inputs, check output invariants.

Integrates with:
- [QUALITY-METRICS.md](QUALITY-METRICS.md) — numeric targets the tests enforce.
- [MEASUREMENT.md](MEASUREMENT.md) — workspace artifacts for CI consumption.
- [LIFECYCLE.md](LIFECYCLE.md) — test cadence across release cycles.
- [TEAM-WORKFLOWS.md](TEAM-WORKFLOWS.md) — where these run in CI.

---

## The six layers of docs validation

| Layer | What it catches | Signal-to-noise |
|---|---|---|
| 1. Build-time | Broken MDX, missing imports, invalid frontmatter, bad JSX | High |
| 2. Static link/anchor | 404s, missing anchors, orphan pages, dangling refs | High |
| 3. Code-in-docs | Examples that no longer run | High |
| 4. Polish/lint | Style drift, slop re-introduction, missing callouts | Medium |
| 5. Fresh-eyes (agentic) | Curse of knowledge, audience mismatch, logic gaps | Medium-low |
| 6. User-lens (agentic) | Task-failure, dead-ends per persona | Low-but-high-value |

All six run in CI. Layers 1–3 block PR merge. Layers 4–5 produce annotations on the PR. Layer 6 runs nightly.

---

## Layer 1: Build-time validation

Nextra's `next build` already:
- Type-checks MDX (with tsconfig strict).
- Validates imports.
- Catches invalid JSX.
- Verifies frontmatter schema (if you run `scripts/validate-frontmatter.mjs`).

Add `bun run lint` to the CI script. The default Next lint covers most MDX hygiene; extend with:
- `eslint-plugin-mdx` — MDX-specific rules.
- `remark-lint-no-dead-urls` — runs link check on MDX.
- Custom ESLint rules for required frontmatter fields.

Frontmatter schema (`.github/workflows/docs-validate.yml`):

```yaml
- name: Validate frontmatter
  run: bun scripts/validate-frontmatter.mjs
```

`scripts/validate-frontmatter.mjs`:

```js
// Enforces: every content MDX has title, description, and audience fields.
// Exit 1 on any violation.
import { glob } from 'glob';
import fs from 'node:fs';​​‌‌​​​​​‌‌​​‌​​​​‌‌​​‌‌
import matter from 'gray-matter';

const files = await glob('content/**/*.mdx');
let errors = 0;
for (const f of files) {
  const { data } = matter(fs.readFileSync(f, 'utf8'));
  for (const field of ['title', 'description', 'audience']) {
    if (!data[field]) {
      console.error(`${f}: missing frontmatter.${field}`);
      errors++;
    }
  }
}
process.exit(errors ? 1 : 0);
```

---

## Layer 2: Link, anchor, and orphan validation

`scripts/link-check.mjs` (already part of the skill). Extend with:

- **Internal links** must resolve to a real page.
- **Internal anchors** (`#section`) must resolve to a real heading on that page.
- **Glossary links** (`/glossary#term`) must match an entry in the glossary.
- **Source-code links** (e.g., `github.com/org/repo/tree/main/pkg/x.go`) must resolve — with a caveat: if Main moves, these break. Pin to a release tag or commit SHA when stable.
- **Orphan pages**: a page that no other page links to (except from `_meta.tsx`) is a probable error. Warn.
- **Orphan anchors**: anchors defined but never linked. Warn, don't block.

Run in CI with `--strict` in `main` branch and `--warn` in PRs (strict would block every PR that introduces a draft page).

---

## Layer 3: Code-in-docs testing (golden + conformance + real-service)

This is where most docs rot lives: a code example in a tutorial uses an API signature that's since changed.

### Strategy A: Extract and run

`scripts/validate-examples.mjs` extracts every `bash`, `ts`, `js`, `py` code block with a `{ "test": true }` meta flag and runs it:

```mdx
    ```ts {"test": true}
    import { createClient } from '@project/sdk';
    const client = createClient({ apiKey: process.env.API_KEY });
    const result = await client.users.list();
    console.assert(Array.isArray(result.items));
    ```
```

The script:
1. Extracts matched code blocks to `workspace/examples/<slug>.<ext>`.
2. Runs each with the real SDK pinned to the docs' stated version.
3. Fails CI if any example errors or its assertions fail.

See `testing-real-service-e2e-no-mocks` for the no-mock principle: examples must hit the real service (a staging env or ephemeral test project), because mocks mask the exact API drift we're trying to catch.

### Strategy B: Golden artifact

For CLI output, `scripts/golden-cli.sh`:

```bash
# For each code block tagged {"golden": true}, run the command and compare
# to the rendered output in the doc.
for example in workspace/examples/cli/*.txt; do
  expected="$(grep -A 999 '# expected:' "$example")"
  actual="$(bash "$example")"
  diff <(echo "$expected") <(echo "$actual") || fail
done
```

When the actual output drifts (often trivially — timestamps, IDs), either:
- Scrub non-deterministic fields before comparison.
- Accept the new golden with an explicit `--update-golden` flag (reviewed in PR).

### Strategy C: Conformance

If your docs make statements like "the API returns a field `createdAt` in ISO-8601", a conformance test:
1. Queries the real API.
2. Asserts the response matches the shape the docs claim.
3. Fails CI if not.

Automate by embedding a JSON Schema in the doc:

````mdx
The response has this shape:

```json schema
{
  "type": "object",
  "required": ["id", "createdAt"],
  "properties": {
    "id": { "type": "string" },
    "createdAt": { "type": "string", "format": "date-time" }
  }
}
```
````

Then `scripts/validate-schema.mjs` extracts every `json schema` block, calls the real endpoint, and validates.

This is maximally accretive: every time you document a response shape, you gain a conformance test for free.

---

## Layer 4: Polish / lint​‌‌​​‌​​​‌‌​​​​‌​‌‌​​​​‌

`scripts/content-lint.mjs` (already in skill). Enforces [QUALITY-METRICS.md](QUALITY-METRICS.md) thresholds:

- Heading budget (no page > 8 H2s unless reference).
- Link density (≥1 internal link per 200 words, unless reference).
- Callout hygiene (no `<Callout>` >3 sentences; `type="info"` is default abuse).
- Code-block hygiene (every non-trivial block has a language tag).
- Slop detection (de-slopify-style patterns — see `de-slopify` skill).

Run as `bun scripts/content-lint.mjs --threshold=warn` in PRs, `--threshold=error` in main.

### Slop regression

Once you've de-slopified a page, guard against regression:

```bash
scripts/content-lint.mjs --slop-check --baseline=.slop-baseline
```

Saves per-file slop scores; fails if any score rises. Prevents a future edit from re-introducing "It's important to note that..." constructions.

---

## Layer 5: Agentic fresh-eyes in CI

A scheduled workflow (nightly or weekly) spawns a fresh-eyes agent over the diff since the last run:

```yaml
name: Docs fresh-eyes
on:
  schedule: [{ cron: '0 6 * * 1' }]  # Mondays 06:00 UTC
jobs:
  fresh-eyes:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run fresh-eyes agent
        run: |
          bun scripts/fresh-eyes-ci.mjs \
            --since=${{ github.event.before }} \
            --out=workspace/fresh-eyes-report.md
      - name: Post as issue comment
        run: gh issue comment ${{ env.DOCS_TRACKING_ISSUE }} \
          --body-file workspace/fresh-eyes-report.md
```

The `fresh-eyes-ci.mjs` script wraps a subagent call with the [AGENT-PROMPTS.md §Fresh-Eyes](AGENT-PROMPTS.md) prompt plus the diff.

Signal-to-noise: ~70%. Each finding needs triage, but the 30% valid finds are high-value.

---

## Layer 6: User-lens persona simulation

The most expensive and highest-value. See [AGENT-PROMPTS.md §User-lens](AGENT-PROMPTS.md).

Nightly, spawn one subagent per audience persona ([AUDIENCE.md](AUDIENCE.md)). Each receives:
- Only the landing URL.
- Only the persona description.
- A goal ("you are persona X; here is what you're trying to accomplish").

Each emits `workspace/userlens/<persona>-<date>.md`:

```
## Curious evaluator @ 2026-04-22

Landed on /. Spent 40 seconds trying to find "what does this do".
The headline said "platform for X"; unclear what X is without prior knowledge.
Scrolled past a hero to find "Key concepts" — 4 clicks to understand the value.

Action: needs a concrete "example" above the fold, not another CTA.
Dead-end at: /features → /pricing → /contact. Expected /try.
```

These are triaged into the FAQ pipeline ([FEEDBACK-PIPELINE.md](FEEDBACK-PIPELINE.md)) or the Phase 3 drafter queue.

---

## Metamorphic tests for docs

A metamorphic test asserts: **transform X of the input should produce transform Y of the output**.

Applied to docs:

- **Reformulation invariance**: if we rename a feature, every mention of the old name should be gone (or mapped via an alias file). Script: grep for old name, fail if present without alias annotation.
- **Version upgrade**: if the SDK version in docs bumps from 2.0 to 2.1, every code example's import version must also bump. Script checks version pinning coherence.
- **Canonical URL**: every anchor `#foo` mentioned in cross-links should have a canonical definition on exactly one page. Duplicate definitions cause ambiguity.
- **Diataxis quadrant coherence**: a "tutorial" frontmatter should contain "steps" (numbered list or `<Steps>` component). A "reference" should contain no narrative passages. Heuristic, not strict.

`scripts/metamorphic.mjs` runs these invariants.

---

## Fuzzing

Rare in docs, but:

- **Link fuzzer**: randomly sample 50 internal links per run; full-crawl them (follow the link, assert the landing page has the correct anchor highlighted).
- **Search fuzzer**: generate 20 random 2–3-word queries from the glossary; assert each returns the canonical page in the top 5 Pagefind results.
- **Example-arg fuzzer**: for CLI examples, randomly mutate one flag value; assert the tool errors cleanly rather than panicking.

Low priority. Add once the higher layers are stable.

---

## Freshness checks

`scripts/docs-freshness.mjs` scans for staleness. See [LIFECYCLE.md](LIFECYCLE.md) for the full spec. Key checks:​‌‌​​​‌‌​‌‌​​‌​‌​‌‌​​‌​‌‍

- Last-modified date on each page vs last git commit to referenced source files.
- Pages referring to version N when the current release is N+2.
- Pages with "coming soon" / "TODO" / "FIXME" strings past a deadline.
- FAQ entries older than 12 months without a review tag.

Fails with warning severity. Produces `workspace/freshness-report.md` for triage.

---

## Per-release gates

Before cutting a new release of the software, docs tests must pass:

1. All Layer 1–3 checks green on `release/*` branch.
2. `scripts/version-coherence.mjs` confirms every "currently" claim in docs matches release N+1.
3. Release-notes page auto-generated from changelog; matches actual commits.
4. `scripts/migration-check.mjs` confirms there's a migration page from N to N+1 if there are breaking changes.

See [LIFECYCLE.md §release-train-coupling](LIFECYCLE.md) for the workflow.

---

## Property-based tests (docs edition)

Adapted from `testing-metamorphic`:

- **Property**: every documented flag has an example OR a default.
- **Property**: every public API symbol in the reference appears in at least one tutorial or how-to.
- **Property**: every term defined in glossary appears in ≥1 content page.
- **Property**: every ADR is either "accepted" and referenced in at least one page, or "superseded" and linked to its successor.

Each property becomes a lint rule in `scripts/content-lint.mjs`.

---

## Test pyramid for docs

The docs equivalent of a test pyramid:

```
              ┌──────────────────────┐
              │ User-lens / persona  │  ← few, slow, most valuable
              └──────────────────────┘
           ┌────────────────────────────┐
           │  Fresh-eyes / agentic      │  ← few, medium cost
           └────────────────────────────┘
        ┌──────────────────────────────────┐
        │  Code-in-docs / real-service     │  ← moderate count
        └──────────────────────────────────┘
     ┌────────────────────────────────────────┐
     │  Polish/lint + metamorphic             │  ← many, fast
     └────────────────────────────────────────┘
  ┌───────────────────────────────────────────────┐
  │  Build + static links + frontmatter            │  ← most, fastest, blocking
  └───────────────────────────────────────────────┘
```

A healthy docs project has 200–500 static checks running on every PR in <30s, 5–20 example-code tests running on main-branch push in 2–5m, and ~5 agentic checks running nightly.

---

## Failure telemetry

Every Layer emits `workspace/test_report.json`:

```json
{
  "run_at": "2026-04-22T14:00:00Z",
  "layer1": { "passed": 147, "failed": 0, "elapsed_ms": 4523 },
  "layer2": { "passed": 523, "failed": 2, "elapsed_ms": 9812 },
  "layer3": { "passed": 38, "failed": 1, "elapsed_ms": 62104 },
  "layer4": { "warnings": 6, "blocking": 0, "elapsed_ms": 2104 },
  "layer5": { "findings": 4, "severity_max": "medium", "elapsed_ms": 38291 },
  "layer6": { "personas_run": 5, "dead_ends": 2, "elapsed_ms": 241089 }
}
```

Phase 10 of the pipeline produces this; CI consumes it as the single source of truth for "are the docs healthy".

---

## See also

- [QUALITY-METRICS.md](QUALITY-METRICS.md) — the numeric thresholds.
- [LIFECYCLE.md](LIFECYCLE.md) — release-train integration.
- [TEAM-WORKFLOWS.md](TEAM-WORKFLOWS.md) — CI configuration.
- [AGENT-PROMPTS.md](AGENT-PROMPTS.md) — fresh-eyes and user-lens prompts.
- [MEASUREMENT.md](MEASUREMENT.md) — workspace artifact layout.
