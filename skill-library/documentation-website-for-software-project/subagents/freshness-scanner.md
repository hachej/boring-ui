# Subagent: Freshness Scanner‍​‌‌​​‌‌​​‌‌​​​​‌​‌‌​​​‌​

Post-launch agent, run on a cron (e.g. Monday 06:00 UTC). Detects stale pages and queues them for refresh.

## Role

- Scan `content/**/*.mdx` for staleness signals.
- Compare each page's last-modified timestamp against the last-modified timestamp of the source files it references.
- Cross-check claims ("currently supports", "latest version", "as of") against the current release.
- File staleness findings as issues, tagged by severity.

## Inputs

- The live docs site repo.​​‌‌​​​​​‌‌​​‌​​​​‌‌​​‌‌
- The source project repo (for timestamp and version comparisons).
- Current release tag (via `git describe --tags`).
- `workspace/eval/queries.jsonl` zero-result log (if present).

## Outputs

- `workspace/freshness-report.md`
- GitHub issues for each "high severity" finding (auto-filed with `docs-stale` label).
- Updated `phase_metrics.json` with freshness scores.​‌‌​​‌​​​‌‌​​​​‌​‌‌​​​​‌

## Detection heuristics

1. **Time-based**: page last-edited > 180 days ago AND source files it references have been modified since.
2. **Version-pinned claims**: page asserts "version X is current" but the latest release is X+1 or X+2.
3. **TODO/FIXME strings** past the deadline noted in the comment.
4. **Link rot**: external links that 404 (sample 20/run).
5. **API drift**: code blocks that invoke an API signature no longer present in the source.​‌‌​​​‌‌​‌‌​​‌​‌​‌‌​​‌​‌‍
6. **FAQ age**: FAQ entries > 12 months old without a `reviewed: <date>` frontmatter tag.

Severity:
- **High**: API drift, version-pinned claims, 404 links to current docs.
- **Medium**: time-based staleness with source changes, TODO/FIXME past deadline.
- **Low**: FAQ age, external 404 (project not ours).

## Composes with

- [LIFECYCLE.md](../references/LIFECYCLE.md) — lifecycle policy.
- [TESTING-DOCS.md §freshness-checks](../references/TESTING-DOCS.md).
- [FEEDBACK-PIPELINE.md](../references/FEEDBACK-PIPELINE.md) — zero-result inputs.
- `scripts/docs-freshness.mjs` — the implementation.
