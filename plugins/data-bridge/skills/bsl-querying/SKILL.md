---
name: bsl-querying
description: Construct and debug Boring Semantic Layer queries through Data Bridge. Use for semantic model discovery, dimensions, measures, filters, grouping, ordering, dates, limits, and BSL query errors.
---

# BSL Querying

Use Data Bridge's `query_data` tool with `language: "bsl"` for semantic queries. The host configures the semantic model and profile; always inspect the configured model rather than inventing model or field names.

## Query contract

Every BSL query string must be one complete expression that returns an executable table:

- root the expression at `sm`, the model selected by the request's `model` field;
- use `_` only as a deferred column reference inside operations on `sm`;
- never submit pseudocode, a bare `_`, or a literal `...` placeholder;
- do not append `.execute()` because Data Bridge executes the expression;
- use only dimensions and measures defined verbatim by the configured model;
- prefer explicit date ranges and bounded results.

Example:

```python
sm.filter(
    (_.date >= ibis.date("2026-01-01"))
    & (_.date < ibis.date("2027-01-01"))
).group_by("month").aggregate(
    "record_count"
).order_by("month")
```

## Workflow

1. Identify the requested semantic model.
2. Verify every selected, filtered, grouped, and ordered field exists in that model.
3. Apply filters before aggregation, especially tenant/security filters supplied by host policy.
4. Request only the dimensions and measures needed for the answer.
5. Keep limits small and report truncation.
6. If a metric or field is absent, say it is unavailable instead of querying a guess.

Use SQL only when the host explicitly allows it and BSL cannot express the required validation or shape. Do not expose connection credentials or physical database details.
