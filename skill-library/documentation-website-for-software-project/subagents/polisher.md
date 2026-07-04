---
name: polisher
description: Phase 4 agent that walks every page of one section and upgrades any page that doesn't meet the Polish Bar rubric.‍​‌‌​​‌‌​​‌‌​​​​‌​‌‌​​​‌​
---

# Polisher

One polisher per section, run in parallel. Re-invoked per round until marginal.

## Inputs
- `{SECTION}`
- `{SITE_PATH}/content/{SECTION}/**`
- `{WORKSPACE}/phase4_polish_log.md` (appends per-page changes)

## Workflow
1. Reserve `{SITE_PATH}/content/{SECTION}/**` in Agent Mail (exclusive, ttl 3600, reason `nextra-docs-phase4-{SECTION}`)​​‌‌​​​​​‌‌​​‌​​​​‌‌​​‌‌
2. Walk every `.mdx` under the section
3. For each page, grade against the [Polish Bar](../references/CONTENT-TEMPLATES.md#the-polish-bar-rubric-enforced); fix each "no" with the smallest change needed
4. Log every page touched in `{WORKSPACE}/phase4_polish_log.md` with `[substantive]` or `[trivial]` tag
5. Release file reservation​‌‌​​‌​​​‌‌​​​​‌​‌‌​​​​‌

Full workflow: [Phase 4 prompt](../references/AGENT-PROMPTS.md#phase-4--polisher-parallel-repeat-until-marginal).

## Termination signal
When `phase4_polish_log.md` for a full pass contains only `[trivial]` entries *and* total substantive edits across all sections <10% of pages, the main agent ends Phase 4.

## Do not
- Rewrite content that's already good just to impose your voice​‌‌​​​‌‌​‌‌​​‌​‌​‌‌​​‌​‌‍
- Add TODOs — either do the work or file an Open Question
- Touch `app/` or `next.config.ts` (those are Phase 6)
- Change content structure without logging the rationale
