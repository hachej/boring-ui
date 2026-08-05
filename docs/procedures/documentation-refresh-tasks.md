# Documentation Refresh Tasks

The nightly [documentation refresh procedure](procedures/documentation-refresh.md)
runs only tasks whose cadence is due. A task remains here only while it gates a
named capability.

| ID | Cadence | Gate | Targets | Primary sources | Validation |
| --- | --- | --- | --- | --- | --- |
| `internal-links` | nightly | navigable canonical docs | changed canonical Markdown | repository paths | resolve relative links |
| `model-pricing` | weekly | cost-aware model routing | [`MODEL-CARD.md`](MODEL-CARD.md) price snapshot | official model and pricing pages linked from the card | verify base/cached/output units, qualifiers, links, and `git diff --check` |
| `model-capabilities` | weekly | valid worker/reviewer routing | [`MODEL-CARD.md`](MODEL-CARD.md) defaults and roles | official model pages plus repository eval evidence | factual update or `policy-review-needed` |
| `repo-commands` | weekly | executable contributor guidance | command-bearing Kanzen/package docs | workspace scripts and CI workflows | run or resolve each changed command |
| `version-references` | monthly | accurate release/install guidance | version-bearing canonical docs | manifests and release metadata | compare exact versions and links |

## Model-pricing task

For every explicitly priced model:

1. Record the UTC check date and official URLs.
2. Compare base input, cached input, and output prices per million tokens.
3. Record long-context multipliers, cache-write premiums, batch discounts, tool
   fees, and fast/priority premiums when they qualify a quoted price.
4. Keep API pricing separate from subscription quotas or credit accounting.
5. Update the snapshot only when a quoted value or qualifier changed.
6. Do not promote or demote a model on price alone. Routing changes require
   repository evidence such as first-pass success, review findings, retries,
   elapsed time, and total cost per accepted change.
7. Treat model renames, retirements, context changes, and tool-support changes as
   `model-capabilities`, not silent pricing edits.

A successful no-change result is a run report, not a repository commit.
