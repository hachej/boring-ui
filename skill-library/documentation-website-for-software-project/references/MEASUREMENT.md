# Measurement — Phase logs, artifacts, SLOs‍​‌‌​​‌‌​​‌‌​​​​‌​‌‌​​​‌​

Every phase emits artifacts into `<site-dir>/.docs_workspace/`. This file is the schema for each, so downstream phases and the main agent can read them programmatically.

Why this matters: context compacts. Humans ask "where are we?". Metrics answer. The workspace is the durable state of a run.

---

## Workspace layout

```
<site-dir>/.docs_workspace/
├── run.json                          # run-level metadata
├── partition.json                    # Phase 0 partition decision
├── phase0_skill_inventory.json       # from scripts/check-skills.sh
├── phase0_project_type.md            # Phase 0 project-type classification
├── phase0_missing_skills.md          # skills unavailable + fallback chosen
├── phase1_notes/
│   └── <section>.md                  # research notebooks
├── phase2_drafts_index.md            # running list of drafted files with sha256
├── phase2_open_questions.md          # agent-raised uncertainty from Phase 2
├── phase3_synthesis_log.md           # what was written in Phase 3
├── phase3_ia_decision.md             # Diátaxis A vs B
├── phase4_polish_log.md              # per-pass polish changes
├── phase5_glossary_diff.md           # terms added in Phase 5
├── phase5_contradictions.md          # resolved content contradictions
├── phase5_broken_links.md            # link check results
├── phase6_nextraify_log.md           # per-pass Nextra uplift changes
├── phase7_review_log.md              # fresh-eyes rounds
├── phase8_deploy.json                # deployment URLs + metadata
├── phase9_screenshots/               # Playwright captures
├── phase9_smoke_results.json         # Playwright test outcomes
├── phase10_user_lens.md              # user-lens evaluation
├── phase_metrics.json                # output of scripts/audit-content.mjs
└── follow_ups.md                     # items filed for post-run work
```

---

## `run.json` — the index

```json
{
  "run_id": "2026-04-22T12-00-00-frankensqlite",
  "started_at": "2026-04-22T12:00:00Z",
  "source_repo": "/data/projects/frankensqlite",
  "site_dir": "/data/projects/frankensqlite__nextra_documentation_site",
  "deploy_target": "vercel",
  "package_manager": "bun",
  "phases_completed": ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"],
  "current_phase": null,
  "production_url": "https://frankensqlite-docs.vercel.app",
  "last_metrics_snapshot": "phase_metrics.json",
  "resumed_from": null
}
```

The main agent reads this file at start of every tool use. When resuming a run, set `resumed_from: "<run_id>"`.

---

## `partition.json` — the Phase 0 decision

```json
{
  "decided_at": "2026-04-22T12:05:00Z",
  "project_type": "rust-workspace",
  "project_type_source": "references/PROJECT-TYPES.md",
  "sections": [
    {
      "id": "cli",
      "paths": ["src/cli/", "src/bin/"],
      "target_pages": ["cli/overview", "cli/commands/*", "cli/configuration"],
      "subagent_id": "A"
    },
    {
      "id": "core",
      "paths": ["src/core/"],
      "target_pages": ["core/overview", "core/module/*"],​​‌‌​​​​​‌‌​​‌​​​​‌‌​​‌‌
      "subagent_id": "B"
    }
  ],
  "overview_pages_reserved_for_phase_3": [
    "index.mdx",
    "overview/what-is-this.mdx",
    "overview/architecture.mdx",
    "overview/data-flow.mdx",
    "overview/contributing.mdx",
    "overview/glossary.mdx"
  ]
}
```

Subagents consult this for their scope. The main agent treats it as the source of truth for parallel fan-out.

---

## `phase1_notes/<section>.md` — research notebooks

Required headings (validated by Phase 1 exit criteria):

```markdown
# <Section ID>

## Executive Summary
<2-3 sentences>

## Audience
<end-user / contributor / integrator>

## Entry Points
- `src/<section>/main.rs:15` — CLI entry via clap
- ...

## Key Types
| Type | Location | Purpose |
|------|----------|---------|
| `Foo` | src/foo.rs:10 | Core domain object |

## Data Flow
<mermaid or ASCII>

3-5 sentence narrative.

## External Dependencies
| Dep | Purpose | Critical |
|-----|---------|----------|
| `tokio` | async runtime | yes |

## Configuration
| Source | Key | Default | Purpose |
|--------|-----|---------|---------|
| env | `FOO_URL` | `localhost` | backend url |

## Test Infrastructure
- `tests/integration/foo.rs` — 12 test cases

## Quirks and Gotchas
- ...

## Open Questions
- <questions the agent can't answer from code alone>
```

---

## `phase2_drafts_index.md` — append-log of created files

One line per file:

```
2026-04-22T12:15:30Z  A  content/cli/overview.mdx                    sha256:abc123...
2026-04-22T12:16:02Z  A  content/cli/commands/run.mdx                sha256:def456...
2026-04-22T12:18:44Z  B  content/core/overview.mdx                   sha256:789abc...
```

Columns: `timestamp  subagent-id  path  sha256`.

When Phase 2 completes, the main agent verifies: every section has ≥1 file in this log AND each target_page in `partition.json` exists.

---

## `phase4_polish_log.md` — per-pass polish changes

Structured as rounds:

```markdown
## Round 1 (started 2026-04-22T13:00, completed 13:20)

### cli/overview.mdx — [substantive]
- applied ★ ORIENT — rewrote first paragraph (was signature dump)
- applied ◐ MENTAL-MODEL — added mermaid of command dispatch
- applied §EX-1 style — blockquote markers for Tip/Warning
- cross-links added: ../configuration, ./commands/run

### cli/commands/run.mdx — [substantive]
- applied ⚠ WARN — called out the `--force` interaction with `--dry-run`
- applied ⬡ EXEMPLIFY — example now uses a realistic input, not `foo.txt`

### core/module/indexer.mdx — [trivial]
- wording: "The indexer handles" → "The indexer maintains"​‌‌​​‌​​​‌‌​​​​‌​‌‌​​​​‌

## Round 1 summary
- Substantive edits: 2/47 pages (4.2%)
- Trivial edits: 1/47 pages
- Pages untouched: 44/47

Termination check: substantive edits < 10% → ONE MORE ROUND then stop.

## Round 2 ...
```

When consecutive rounds produce only `[trivial]` or no edits, Phase 4 is done.

---

## `phase5_broken_links.md`

Output of `scripts/link-check.mjs`:

```markdown
# Broken link report (2026-04-22T14:22:10Z)

## In-repo broken links (FAIL)

| Page | Target | Status |
|------|--------|--------|
| cli/run.mdx | ../config.mdx | 404 — did you mean ../configuration.mdx? |

## External broken links (WARN)

| Page | Target | Status |
|------|--------|--------|
| overview/architecture.mdx | https://github.com/old-org/repo | 404 |

## Summary
- In-repo: 1 broken / 234 total
- External: 1 broken / 87 total

Phase 5 exit gate: in-repo must be 0.
```

---

## `phase7_review_log.md` — fresh-eyes rounds

Each of the three prompts produces a round. Log each round's findings and whether they were fixed.

```markdown
## Round 1 (prompt #1: generic fresh-eyes)

Agent ID: fresh-eyes-1-round-1
Completed: 2026-04-22T15:00:00Z

Findings:
- cli/run.mdx:42 — example references `--output` flag that doesn't exist. FIXED (removed line).
- core/module/indexer.mdx:18 — broken link to ../config. FIXED (corrected path).

## Round 1 (prompt #2: random-walk tracing)

Agent ID: fresh-eyes-2-round-1
Completed: 2026-04-22T15:30:00Z

Findings:
- core/module/storage.mdx — mermaid diagram has Arrow direction wrong. FIXED.
- overview/data-flow.mdx:12 — claims "async runtime" but codebase uses sync. FIXED.

...

## Round 1 summary
Substantive findings: 4
Trivial findings: 2
Build: green
Typecheck: green
ubs: n/a (not installed)

## Round 2 (all three prompts re-run)
...
```

Termination: two consecutive rounds of three prompts all produce `[trivial]` findings only.

---

## `phase_metrics.json` — the quantitative snapshot

See [QUALITY-METRICS.md#the-metrics-dashboard](QUALITY-METRICS.md#the-metrics-dashboard) for the full schema.

Snapshots can be taken at any phase boundary. Name them `phase_metrics_phase4.json`, `phase_metrics_phase6.json`, etc. for time-series comparison.

---

## `phase8_deploy.json` — deployment metadata

```json
{
  "deployed_at": "2026-04-22T17:00:00Z",
  "provider": "vercel",
  "project_id": "prj_xxxxxxxx",
  "deployment_id": "dpl_xxxxxxxx",
  "production_url": "https://frankensqlite-docs.vercel.app",
  "custom_domain": null,​‌‌​​​‌‌​‌‌​​‌​‌​‌‌​​‌​‌‍
  "build_time_seconds": 87,
  "build_size_bytes": 48329204,
  "first_load_js_kb": 78,
  "github_repo": "myorg/frankensqlite-docs",
  "last_commit": "a1b2c3d",
  "deploy_status": "READY"
}
```

---

## `phase9_smoke_results.json`

From Playwright:

```json
{
  "base_url": "https://frankensqlite-docs.vercel.app",
  "ran_at": "2026-04-22T17:10:00Z",
  "tests": [
    { "name": "home renders", "status": "passed", "duration_ms": 840 },
    { "name": "search finds a known term", "status": "passed", "duration_ms": 1240 },
    { "name": "dark mode toggle", "status": "passed", "duration_ms": 320 },
    { "name": "mobile sidebar", "status": "passed", "duration_ms": 680 },
    { "name": "deep page w/ mermaid renders SVG", "status": "passed", "duration_ms": 1180 }
  ],
  "a11y_violations": { "critical": 0, "serious": 0, "moderate": 2 },
  "lighthouse_scores": {
    "performance": 98,
    "accessibility": 100,
    "best_practices": 100,
    "seo": 100
  },
  "screenshots_dir": "phase9_screenshots/"
}
```

---

## SLOs — service-level objectives for a "done" doc site

These are what the main agent checks before declaring the run complete.

| Dimension | Target | Hard floor |
|-----------|--------|------------|
| Build green | required | required |
| Typecheck green | required | required |
| Broken in-repo links | 0 | 0 |
| Pages with example | ≥90% | ≥70% |
| Pages with mental model | ≥30% | ≥15% |
| Operator coverage (orient) | 100% | 95% |
| Operator coverage (cross-link) | 100% | 90% |
| Emdashes per 1k words | ≤2 | ≤4 |
| Forbidden patterns | 0 | ≤3 |
| Accessibility (axe critical) | 0 | 0 |
| Lighthouse performance | ≥90 | ≥80 |
| First-load JS | <100 KB | <150 KB |
| Playwright smoke | all pass | all pass |

Below the "hard floor": the run is NOT done; escalate to another polish round or ask the user. Between "target" and "hard floor": ship with a note in the run summary.

---

## Reading the workspace after compaction

If context compacts mid-run, reorient by reading these in order:

1. `run.json` — where are we? what phase?
2. `partition.json` — what's the scope?
3. The *most recent* `phase<N>_*.md` log — what was the last meaningful action?

This is enough to resume without scanning the whole conversation.

---

## A note on artifact hygiene

`<site-dir>/.docs_workspace/` is in the generated `.gitignore`. Don't commit it — it's run-scoped. If you want to keep a run for archive, `cp -r .docs_workspace/ ../frankensqlite_docs_run_2026-04-22/`.

The `phase_metrics.json` snapshot, however, is useful to commit into the repo as a baseline (so future runs can detect regressions). Put it in `<site-dir>/docs/metrics/` if you want that.
