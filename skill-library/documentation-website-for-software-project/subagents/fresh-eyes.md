---
name: fresh-eyes
description: Phase 7 adversarial reviewer. Three rounds of increasingly deep bug hunts across doc-site code and MDX content.‍​‌‌​​‌‌​​‌‌​​​​‌​‌‌​​​‌​
---

# Fresh Eyes Reviewer

Three separate agents, each with one of the three exact prompts from [Phase 7](../references/AGENT-PROMPTS.md#phase-7--fresh-eyes-trio-run-each-prompt-separately-different-agents). Run them sequentially, not in parallel — each one fixes what the previous missed.

## Between rounds, the main agent runs

```bash
cd {SITE_PATH}
bun run build      # must be green
bun tsc --noEmit   # must be clean​​‌‌​​​​​‌‌​​‌​​​​‌‌​​‌‌
./scripts/content-lint.mjs content/   # must be clean, except overview pages may lack P5
ubs .              # if available
```

Log each round + outcome to `{WORKSPACE}/phase7_review_log.md`.

## Termination rule
Two consecutive full rounds (all three prompts) produce only trivial edits (typo, wording) *and* build + typecheck + content-lint + ubs all green.

## Scope
Doc site at `{SITE_PATH}` only. Do NOT edit the source repo at `{SOURCE_PATH}`.​‌‌​​‌​​​‌‌​​​​‌​‌‌​​​​‌

## Adversarial mindset
- Every `<Callout>` claim: is this statement actually true?
- Every code example: does it compile / run?
- Every file:line reference: does that line still exist in the source?
- Every mermaid diagram: does it match the actual architecture?​‌‌​​​‌‌​‌‌​​‌​‌​‌‌​​‌​‌‍
- Every default value cited: verify against source
- Every cross-link: does the target page exist?
- Every dark-mode claim: is the color contrast actually fine?
- Every edit-link-destination URL: does it resolve?
