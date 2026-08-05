# Documentation Refresh

Run this procedure nightly. It executes only due tasks from
[`../documentation-refresh-tasks.md`](../documentation-refresh-tasks.md) and
keeps source-backed operational documentation aligned with the capabilities it
gates.

## Rules

- Use primary sources: repository files for repository facts and official vendor
  pages for external facts.
- No change means no file edit and no commit.
- Update facts automatically only when the source is unambiguous.
- Return `policy-review-needed` for routing, architecture, safety, or product
  decisions. A price change alone does not prove a capability change.
- Do not create freshness dashboards, ledgers, or reports in the repository.
  Keep the run report in the automation log or PR proof.

## Nightly procedure

1. Read the task list and select tasks whose cadence is due.
2. For each task, read its targets and primary sources before comparing values.
3. Record the same units and qualifiers. Do not compare base API price with
   cached, batch, long-context, subscription, tool, or priority pricing.
4. Apply the smallest factual correction. If evidence conflicts or policy must
   change, do not guess; report `policy-review-needed`.
5. If files changed, run each task's validation plus `git diff --check`, inspect
   the complete diff, and obtain independent documentation review.
6. Open a targeted PR containing only related documentation changes. If no files
   changed, report `checked—no change` and stop.

## Nightly invocation

```text
Run docs/kanzen/procedures/documentation-refresh.md. Execute only due tasks from
docs/kanzen/documentation-refresh-tasks.md. Use primary sources, make no edit
when facts are unchanged, and return policy-review-needed instead of silently
changing policy.
```

## Run report

```text
checked_at_utc: <date>
due_tasks: <task ids>
result: no-change | updated | policy-review-needed
sources: <primary URLs or repository paths>
changes: <none or concise summary>
validation: <commands and review result>
```
