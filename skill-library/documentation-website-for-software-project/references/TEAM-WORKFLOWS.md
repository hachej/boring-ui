# Team Workflows — Docs-as-Code‍​‌‌​​‌‌​​‌‌​​​​‌​‌‌​​​‌​

When more than one person maintains the docs, workflow matters. This file covers the CI/CD, review, and ownership patterns that keep multi-contributor docs healthy.

---

## The docs-as-code principle

Documentation lives in git. Pull requests are the review unit. CI runs tests. Releases are tags. Every engineering practice we apply to code, we apply to docs.

The opposite — a CMS (Notion, Confluence, Contentful) — optimizes for non-technical editors but breaks code-doc coupling. If the docs describe an API that lives in code, they should live next to the code (or at least in git so changes can be PR'd alongside code).

---

## Repo layout options

### Option A: docs in the source repo

```
my-project/
├── src/
├── tests/
└── docs/              # Nextra site
    ├── app/
    ├── content/
    └── ...
```

Pros: code and docs in one PR; impossible to forget docs updates.
Cons: docs repo history noisy; large source-repo checkouts; docs deploy triggers on unrelated code changes.

Best for: small-to-medium projects, libraries.

### Option B: docs in a sibling repo

```
my-project/               (code)
my-project-docs/          (Nextra site)
```

Pros: clean separation; docs can deploy independently; different CODEOWNERS.
Cons: docs updates decoupled from code PRs → drift risk.

Best for: large projects, docs team separate from engineering.

### Option C: monorepo with docs as a workspace

```
my-monorepo/
├── packages/
│   └── core/
├── apps/
│   └── docs/             # Nextra site
└── turbo.json
```

Pros: everything in one place; Turborepo can orchestrate build.
Cons: turbo/nx learning curve; monorepo CI complexity.

Best for: projects already monorepo-shaped.

**This skill defaults to Option A for small projects and Option B for anything serious.**

---

## CODEOWNERS for docs

Even in a monorepo, docs sections can have different owners:

```
# .github/CODEOWNERS

docs/content/reference/     @platform-team
docs/content/guides/        @devrel-team
docs/content/adr/           @architects
docs/content/api/           @api-team

# Everything else
docs/                        @docs-team
```

PRs touching these paths auto-request review from the corresponding team.

---

## PR templates

```markdown filename="docs/.github/pull_request_template.md"
## What this PR changes

<One paragraph. What's new / fixed / reorganized?>

## Which personas benefit

- [ ] Curious evaluator
- [ ] First-time user
- [ ] Daily integrator
- [ ] Contributor
- [ ] Operator

## Pre-merge checklist

- [ ] `bun run build` passes locally
- [ ] `bun run typecheck` passes
- [ ] `./scripts/content-lint.mjs content/` passes
- [ ] `./scripts/link-check.mjs content/` passes
- [ ] Added to `content/releases.mdx` if user-facing change
- [ ] Preview deploy reviewed (link below)
- [ ] Screenshots updated if UI changed

## Preview

<Vercel/Cloudflare will post a preview URL here>
```

---

## CI pipeline

```yaml filename="docs/.github/workflows/ci.yml"
name: Docs CI

on:
  pull_request:
    paths:
      - 'docs/**'
      - '.github/workflows/docs-ci.yml'
  push:
    branches: [main]
    paths:
      - 'docs/**'

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
        working-directory: docs​​‌‌​​​​​‌‌​​‌​​​​‌‌​​‌‌
      - name: Content lint (Polish Bar)
        run: node scripts/content-lint.mjs content/
        working-directory: docs
      - name: Content audit (quality metrics snapshot)
        run: node scripts/audit-content.mjs content/ --out phase_metrics.json
        working-directory: docs
      - name: In-repo link check
        run: node scripts/link-check.mjs content/
        working-directory: docs

  build:
    runs-on: ubuntu-latest
    needs: lint
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
        working-directory: docs
      - run: bun run build
        working-directory: docs
      - run: bun run typecheck
        working-directory: docs

  freshness:
    runs-on: ubuntu-latest
    needs: lint
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
        working-directory: docs
      - name: Check file:line citations against source
        run: node scripts/docs-freshness.mjs content/ ../src
        working-directory: docs

  deploy-preview:
    runs-on: ubuntu-latest
    needs: build
    if: github.event_name == 'pull_request'
    steps:
      # Vercel handles this automatically via GitHub integration
      # OR manually:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bunx vercel pull --yes --token=${{ secrets.VERCEL_TOKEN }}
        working-directory: docs
      - run: bunx vercel build --token=${{ secrets.VERCEL_TOKEN }}
        working-directory: docs
      - run: bunx vercel deploy --prebuilt --token=${{ secrets.VERCEL_TOKEN }}
        working-directory: docs
```

---

## Preview deployments

Every PR gets its own URL. This is THE most important DX lever for doc PRs — reviewers click, read, and verify rendering before approving.

### Vercel (automatic)

Enable the Vercel GitHub integration on the docs repo. Every PR automatically gets a URL posted as a PR comment:

```
Preview: https://my-docs-git-pr-42-acme.vercel.app
```

No extra config needed beyond Vercel setup. See [DEPLOY.md](DEPLOY.md).

### Cloudflare Pages

Same with Cloudflare Pages git integration.

### GitHub Pages

No built-in preview deploys. Use a separate preview target (Netlify/Cloudflare) and only use GH Pages for production.

---

## Review culture

### The "verify locally or in preview" rule

**Never approve a docs PR without loading the preview URL and clicking through the changed pages.** Content that looks right in the diff can break in rendering (busted JSX, missing imports, broken anchors).

### Review checklist

Reviewers check, in order:

1. **Build green** (CI). Non-negotiable.
2. **Preview loads** the changed pages.
3. **Content accuracy**: does it match the code/product behavior?
4. **Structural correctness**: headings hierarchy, components closed, imports present.
5. **Voice consistency**: matches the rest of the site?
6. **Polish Bar**: does the page satisfy the rubric?​‌‌​​‌​​​‌‌​​​​‌​‌‌​​​​‌
7. **Cross-links**: target URLs resolve; no dead-ends.

### Reviewer assignment

- **Accuracy reviewer**: the engineer who wrote/owns the feature being documented. Required.
- **Craft reviewer**: someone with strong writing skills. Optional but lifts quality.
- **Fresh-eyes reviewer**: someone unfamiliar with the feature. Catches curse-of-knowledge issues.

For critical pages (landing, tutorials), require at least 2 of the 3. For small fixes, 1 is fine.

### Review voice

- Be specific: "This paragraph is confusing" → "This paragraph mentions `Session` before it's introduced. Add a link to the glossary or define it first."
- Suggest, don't mandate: "Consider rephrasing as…" unless you're the authority on the topic.
- Review the writing, not the writer.

---

## Merge strategy

Squash-merge docs PRs by default. Rationale: most docs PRs are "fix typos / rewrite paragraph / add example" — a detailed internal history adds no value. The squashed commit message preserves what matters.

Exception: ADRs, where each decision deserves its own commit.

---

## Release-train coupling

If docs are in Option B (sibling repo), couple releases:

### Option I: same-version tag

Source repo tags `v1.4.0`. Docs repo tags `docs-v1.4.0` (or `v1.4.0-docs`) when the matching docs are complete. Don't announce the release until both tags exist.

### Option II: GitHub Actions cross-repo trigger

Source repo's tag-workflow posts to docs repo via `repository_dispatch`:

```yaml filename="src-repo/.github/workflows/on-tag.yml"
on:
  push:
    tags: ['v*']

jobs:
  bump-docs:
    steps:
      - uses: peter-evans/repository-dispatch@v3
        with:
          token: ${{ secrets.DOCS_REPO_TOKEN }}
          repository: myorg/docs
          event-type: new-release
          client-payload: '{"version": "${{ github.ref_name }}"}'
```

Docs repo:

```yaml filename="docs/.github/workflows/on-release.yml"
on:
  repository_dispatch:
    types: [new-release]

jobs:
  update-changelog:
    steps:
      - uses: actions/checkout@v4
      - name: Generate release notes from source
        run: |
          curl -s "https://api.github.com/repos/myorg/src/releases/tags/${{ github.event.client_payload.version }}" \
            | jq -r '.body' > /tmp/release-notes.md
          # Apply changelog-writer logic
      - name: Open PR
        uses: peter-evans/create-pull-request@v5
        with:
          branch: release/${{ github.event.client_payload.version }}
          title: "Docs for ${{ github.event.client_payload.version }}"
```

---

## Content-freeze periods

Before major releases or external announcements:

1. **Freeze date** announced to docs team.
2. `main` branch protected; only approved release PRs merge.
3. Pre-freeze polish sprint (Phase 4 pass over the most-changed sections).
4. After release: unfreeze, resume normal cadence.

Freeze lasts 1–2 weeks. Longer breeds pent-up change debt.

---

## Style consistency via shared lint

Keep a shared style guide in `docs/STYLE.md`. Automate the enforceable parts:

### Vale (prose linter)

```yaml filename=".vale.ini"
StylesPath = styles
MinAlertLevel = warning

Packages = Google, write-good

[*.mdx]
BasedOnStyles = Google, write-good, Vocab, Microsoft
```

Configure a project-specific vocabulary:

```
# styles/Vocab/MyProject/accept.txt
Nextra
Pagefind
SQLite
...
```

Run in CI; fail on errors. Configure per-project threshold.

### Alex (inclusive-language linter)

```sh
bunx alex content/
```

Catches gendered / ableist / exclusionary wording.

### Markdownlint (structural)​‌‌​​​‌‌​‌‌​​‌​‌​‌‌​​‌​‌‍

```sh
bunx markdownlint '**/*.mdx'
```

---

## Docs in code review of source PRs

A culture pattern, not a tool: source-repo PR reviewers **flag missing docs**.

Example PR comment from a reviewer:

> This adds a new public function `query.batch()` but doesn't update `docs/reference/query.mdx`. Can you add the reference entry before merging?

The cost of enforcing this is low; the cost of not enforcing it is silent API drift.

---

## Centralized doc ownership vs. distributed

### Centralized

A dedicated docs team owns everything. Engineers file issues; docs team writes.

Pros: consistent voice, dedicated expertise.
Cons: docs team becomes bottleneck; engineers disengage from docs.

### Distributed (recommended for most)

Engineers own the docs for their area. A small docs team (or even one person) owns overall site, cross-cutting content, and style enforcement.

CODEOWNERS enforces routing. CI enforces baseline quality.

### Hybrid

Distributed for Reference + How-to; centralized for Tutorials + Explanation + site polish.

This matches reality: engineers know their API best (Reference); the docs team knows how to explain concepts across modules (Explanation).

---

## Onboarding new doc contributors

A minimal onboarding doc at `docs/CONTRIBUTING.md`:

```mdx
# Contributing to the docs

## Setup (5 minutes)

```sh
git clone <repo>
cd docs
bun install
bun dev
```

Open http://localhost:3000.

## Make your change

- Edit any `.mdx` file under `content/`.
- Hot-reload should show changes instantly.

## Local checks before PR

```sh
bun run build                            # must pass
bun run typecheck                        # must pass
node scripts/content-lint.mjs content/   # must pass
node scripts/link-check.mjs content/     # must pass
```

## Submit PR

Use the PR template. Someone from CODEOWNERS will review within 2 business days.

## Style

We follow [our style guide](./STYLE.md).

## First good issues

See [`good first issue` label](https://github.com/.../issues?q=label:docs+label:good+first+issue).
```

Keep it one page. Longer onboarding docs get skipped.

---

## Metrics for team health

Track monthly:

- **PR velocity** (docs PRs merged / month). Growing = healthy contribution culture.
- **PR review time** (median hours to first review). <24h is good; >72h is a crisis.
- **Docs-sourced source changes** (bugs / questions that prompted doc fixes). Signals whether docs are mining real feedback.
- **CI failure rate** (% of PRs that fail build). Rising = stale local-dev setups or bad changes.
- **Contributor diversity** (number of distinct committers / quarter). Rising = docs opening up beyond the core team.

Report in `phase_team_health.md` at the docs-site root quarterly.

---

## Emergency patches

When a critical bug in the docs needs immediate fix (wrong install command leading users astray, security advisory missing):

1. Short-circuit review: 1 approver, 10-min timeout.
2. Merge and deploy immediately.
3. Post-mortem the failure mode within 24 hours.
4. Add a regression test (content-lint rule, CI assertion) so it doesn't recur.

---

## Anti-patterns

- **No preview deploys**: reviewers can't verify rendering. Get them.
- **Docs team as gatekeepers** that slow every PR to a crawl.
- **Docs-last culture**: docs PR'd weeks after the code change. Drift guaranteed.
- **No style guide**: voice drifts; readers feel it.
- **No CODEOWNERS**: unclear ownership; PRs rot.
- **CI that only builds, doesn't lint**: typos and broken links ship.
- **Review via Slack**: no audit trail; mistakes recur.

---

## Integration

- [LIFECYCLE.md](LIFECYCLE.md): the team workflows are the machine that keeps the lifecycle running.
- [DEPLOY.md](DEPLOY.md): preview deploys and production deploy patterns.
- [QUALITY-METRICS.md](QUALITY-METRICS.md): what CI enforces vs. what humans review.
- [FEEDBACK-PIPELINE.md](FEEDBACK-PIPELINE.md): triaged feedback enters the team workflow as labeled issues.
