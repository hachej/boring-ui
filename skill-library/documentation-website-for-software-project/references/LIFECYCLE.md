# Documentation Lifecycle — Post-Launch‍​‌‌​​‌‌​​‌‌​​​​‌​‌‌​​​‌​

The 10-phase pipeline ships a docs site. That's the beginning, not the end. Docs rot. Source evolves, features deprecate, UIs change. This file covers what happens *after* Phase 10 — keeping the docs current, coupling them to releases, detecting staleness, and knowing when to re-run parts of the pipeline.

---

## The lifecycle stages

```
  ┌─────────────┐   ┌──────────┐   ┌──────────┐   ┌────────────┐   ┌──────────┐
  │   INITIAL   │→  │ LAUNCH   │→  │ STEADY   │→  │ DECLINE    │→  │ SUNSET   │
  │ (phases 0-9)│   │ (phase   │   │ STATE    │   │ (feature   │   │ (archive │
  │             │   │  10)     │   │          │   │  freeze)   │   │  or kill)│
  └─────────────┘   └──────────┘   └──────────┘   └────────────┘   └──────────┘
        ↑                                                                  │
        └──────────── major redesign (re-enter phase 2+) ──────────────────┘
```

Most projects live in **steady state** for years. Steady state has its own cadence, independent of the initial run.

---

## The update triggers

When to re-run what.

| Event | What re-runs | Why |
|-------|--------------|-----|
| New feature ships | Add a Tutorial + How-to + Reference entry; run Phase 4 polish on affected section only | New content needs full bar; don't re-polish untouched sections |
| Breaking change released | Update Reference entries; add Migration section to Changelog; add `<Callout type="warning">` to affected pages | Broken docs are worse than no docs |
| Deprecation | Add `Deprecated` label to Reference entry; add `<Callout type="warning">` with deprecation timeline; link to replacement | Don't remove until sunset |
| Bug fix that changes behavior | Update Reference + any Tutorial whose output changed | Silent changes = broken examples downstream |
| Library version bump that changes install command | Update Install page only | Localized change |
| New supported platform / runtime | Add Tabs variant to install / quickstart | Additive |
| New SDK / client library | New section under `content/clients/<language>.mdx`; add to landing Cards | See `CONTENT-TEMPLATES.md` client-library template |
| Architecture refactor | Re-run Phase 1 research (archaeology) + regenerate `content/overview/architecture.mdx` | Big arch changes invalidate mental model diagrams |
| UX overhaul of the product | Re-screenshot every tutorial; re-run Phase 9 Playwright | Screenshots drift silently |
| Customer support ticket patterns shift | Update FAQ; add Troubleshooting entries; revise problem-framing in how-tos | Real-world signal of doc gaps |
| Quarterly | Full freshness scan (`scripts/docs-freshness.mjs`); review top-10 analytics pages for edits | Routine hygiene |

---

## Coupling docs to releases

The release-train pattern:

```
  source repo       docs site
     ↓                 ↓
  v1.4.0 RC  →  docs-preview (branch deploy)
     ↓                 ↓
  v1.4.0     →  docs-main (production)
```

**Mechanics:**

- Every source repo PR that touches public API must also touch `content/reference/` in the docs repo (or the same repo if monorepo'd).
- The source repo's `CHANGELOG.md` feeds `content/releases.mdx` via the `changelog-writer` subagent.
- The docs site has a per-version build (see [ADVANCED-NEXTRA.md § 10](ADVANCED-NEXTRA.md#10-versioned-docs)).
- Release notes auto-generate from commits between tags; human edits them before publishing.

**CI wiring:** the docs repo has a workflow that:
1. On PR: deploy preview.
2. On `main` merge: deploy production.
3. On tag `v*`: create a new version branch, freeze it, link from the version menu.

See [TEAM-WORKFLOWS.md](TEAM-WORKFLOWS.md) for the full CI patterns.

---

## Staleness detection​​‌‌​​​​​‌‌​​‌​​​​‌‌​​‌‌

Docs rot silently. You need passive signals.

### Signal 1: file:line citations drift

If `content/reference/query.mdx` cites `src/query.rs:42` and that line no longer contains the referenced function, the doc is stale.

Automated check (`scripts/docs-freshness.mjs`):

```bash
node scripts/docs-freshness.mjs content/ ../source-repo/
```

For every `file:line` reference in docs, verify the line exists and the function/type/struct name at that line still matches what the doc cites.

### Signal 2: example code no longer compiles/runs

Take every fenced code block with a language tag. Attempt to compile (Rust: `cargo check`; TypeScript: `tsc --noEmit`; Python: `python -c`). If it fails, the example is stale.

For rarely-runnable examples (shell commands, SQL), heuristic check: does the referenced tool/binary/command still exist?

### Signal 3: last-updated > N months

Every page has a `lastUpdated` via Nextra's built-in feature. Pages unchanged for 12+ months (for fast-moving projects) or 24+ months (for stable projects) get flagged.

```bash
find content/ -name '*.mdx' -mtime +365 | xargs -I{} echo "stale: {}"
```

Being old isn't *proof* of staleness — reference for a stable API can legitimately be old. But old + never-updated should trigger human review.

### Signal 4: version mismatch

If `content/install.mdx` says "requires Node 18+" and the source repo's `package.json` now says `"engines": { "node": ">=22" }`, the doc is wrong.

### Signal 5: referenced-URL rot

External links in docs break over time. Run `scripts/link-check.mjs --external` monthly; flag 404s.

### Signal 6: analytics-driven decay

In analytics, pages whose "was this helpful?" rate drops over quarters signal content is aging out.

---

## Staleness SLA

Define for each section how current it must be:

| Section | SLA | Rationale |
|---------|-----|-----------|
| Install / Get started | Updated within 1 week of any install-command change | First-time users' first impression |
| Reference | Updated on every release | Primary lookup surface |
| Tutorials | Updated within 1 month of any change that breaks a step | Stale tutorials poison adoption |
| Architecture | Updated with every major refactor | Stale arch = wrong mental model |
| ADRs | Never edited after acceptance; append only | ADRs are historical record |
| Changelog | Updated on every release | Required by users |
| FAQ | Reviewed quarterly | Reflects shifting support patterns |

Track these in `phase_sla.json` at the doc site root. A GitHub Action fails builds when SLA is violated.

---

## Versioning strategy over time

### Year 0–1: single version

Keep one version. Breaking changes documented in Changelog. Simplest.

### Year 1+: multi-version

Three strategies (detail in [ADVANCED-NEXTRA.md § 10](ADVANCED-NEXTRA.md#10-versioned-docs)):

- **Menu dropdown** → multiple deploys, linked from `_meta.global.tsx`. Easiest maintenance.
- **Path-based** → `content/v3/`, `content/v4/`. Single deploy. Hard to maintain both branches simultaneously.
- **Git-branch** → each version is its own branch. Best when major versions diverge significantly.

**Decision rule:** default to menu dropdown unless you have >3 simultaneously-supported major versions and the teams differ.​‌‌​​‌​​​‌‌​​​​‌​‌‌​​​​‌

### Version deprecation policy

Publish it on `content/overview/support-policy.mdx`:

- Major versions supported for N years after release.
- Security fixes backported for N+1 years.
- After EOL, docs stay online as reference, marked as unsupported.
- Users directed to migration guide.

---

## Decline / sunset patterns

Projects die. Their docs shouldn't vanish — but they also shouldn't waste the budget of current readers.

### The deprecation banner

Add a site-wide banner when a version or feature is deprecating:

```tsx
<Banner dismissible storageKey="v3-eol-2027" type="warning">
  <Link href="/support-policy">
    ⚠️ v3 reaches end-of-life on 2027-06-30. Upgrade to v4.
  </Link>
</Banner>
```

See [ADVANCED-NEXTRA.md § 12](ADVANCED-NEXTRA.md#12-banner--dismissible--persistent).

### The unsupported-version archival mode

Archived doc sites should:
1. Redirect landing to the current version's landing (with a "you're viewing archived docs" banner).
2. Strip "Edit on GitHub" (no new contributions expected).
3. Keep search working (old content is still useful).
4. Pin a banner: "These docs describe v2, which reached end-of-life on 2026-01-01. For current docs, see [link]."

### Project sunset (whole project)

Move to read-only:
- Freeze repo, tag final release.
- Docs site: banner at top of every page, "This project is no longer maintained. Last updated YYYY-MM-DD. [Alternative: ...]"
- Sunset date on landing.
- Don't delete — archive. URLs people linked still work.

---

## The "living docs" invariant

Three rules we bake into the CI:

1. **Every public-API change needs a docs change** — enforced via PR labels. A `public-api` label requires a matching `docs` label.
2. **Every release updates Changelog** — `scripts/changelog-writer` runs on tag and opens a PR.
3. **No doc page is older than the feature it describes** — freshness CI compares frontmatter `lastUpdated` against last git-blame of the referenced code.

---

## Re-running phases post-launch

Each phase has a specific re-run trigger:

| Phase | When to re-run (post-launch) |
|-------|------------------------------|
| 0 (Partition) | Architecture refactor; new major section added |
| 1 (Research) | Per-section — when that section's source changes substantially |
| 2 (Draft) | New feature in a section |
| 3 (Synthesis) | Anything big that changes the overview story |
| 4 (Polish) | Quarterly; also after any Phase 2 that added pages |​‌‌​​​‌‌​‌‌​​‌​‌​‌‌​​‌​‌‍
| 5 (Glossary) | When new domain terms introduced; quarterly cleanup |
| 6 (Nextra-ify) | Rarely; only for framework upgrades |
| 7 (Fresh eyes) | Before every major release |
| 8 (Deploy) | Continuously via CI |
| 9 (Smoke) | On every deploy |
| 10 (User lens) | Biannually; also before major marketing pushes |

Smart re-run: use `scripts/docs-freshness.mjs` to identify sections flagged as stale, and re-run phases 1–4 only on those.

---

## Maintenance modes

Different projects want different cadences. Pick one, document it in `content/overview/docs-maintenance.mdx`:

### Mode: active development

- Docs updated in the same PR as the code change.
- Weekly freshness scan.
- Quarterly Phase-4 polish sweep.
- Biannual Phase-10 user-lens review.

### Mode: mature / maintenance

- Docs updated per release (monthly/quarterly).
- Quarterly freshness scan.
- Annual Phase-4 sweep.

### Mode: archived

- Docs frozen. Banner communicates this.
- Freshness scans disabled.
- Only security advisories updated.

---

## Monitoring signals to wire up

To make lifecycle management data-driven, hook up:

| Signal | Source | Use |
|--------|--------|-----|
| Page views | Plausible/GA/Umami | Priority list for polish |
| Search queries | Pagefind logs + analytics | Find missing content |
| "Was this helpful" | Feedback widget (see [FEEDBACK-PIPELINE.md](FEEDBACK-PIPELINE.md)) | Flag pages for rewrite |
| 404s | Server logs | Redirect table additions |
| Slow-loading pages | Lighthouse in CI | Optimize large pages |
| Broken external links | `scripts/link-check.mjs --external` | Monthly |
| Stale file:line refs | `scripts/docs-freshness.mjs` | Per-release |
| Issue tracker docs label volume | `gh issue list --label docs` | Aggregate demand signal |

Aggregate into a `phase_lifecycle_dashboard.md` that the team reviews monthly.

---

## Corpus export — the last (first?) step

When a project ends, the docs are a corpus worth preserving. See [CORPUS-EXPORT.md](CORPUS-EXPORT.md) for how to package the content + the phase artifacts so:

- A future agent can learn from this project's doc patterns.
- A related project can bootstrap faster by importing glossary + ADR + architecture patterns.
- Institutional knowledge isn't lost.

This closes the loop — the skill's output feeds future skill runs.
