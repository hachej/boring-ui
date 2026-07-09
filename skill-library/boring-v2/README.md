# Boring Skills v2 Draft

Scratch area for redesigning the Boring workflow from Matt Pocock raw skills plus Kanzen safety rules.

## Raw Matt Pocock sources

Stored unchanged under `raw-mattpocock/`:

- `ask-boring` -> source for the Boring workflow router
- `triage` -> source for future `triage`
- `to-spec` -> source for future `plan` spec mode
- `to-tickets` -> source for future `plan` ticket/slice mode
- `implement` -> source for future `implement`
- `tdd` -> reference for implementation/test seam rules
- `code-review` -> reference for two-axis review
- `code-review-thermo` -> reference for strict maintainability / code-judo review

No active skills live here. Copy/adapt one into `.agents/skills/` only when ready to test.


## Draft Boring v2 skills

Stored under `skills/`:

- `ask-boring` — router only
- `feedback` — issue creation only, with redaction and simple labels
- `triage` — issue/PR state classification and next action
- `plan` — `to-spec` first, `to-tickets` only when slicing is needed
- `implement` — build one ready issue/slice with proof, review, and PR handoff

Implementation proof must name at least one of: exact command, screenshot/demo, manual steps, or an explicit waiver with residual risk.


## Model/reviewer policy

See `MODEL-CARD.md` for model selection, escalation, and adversarial reviewer triggers.

Loop skills are aliases/reference flows, not separate heavy workflows by default:

- `plan-loop` = `plan` plus adversarial plan review for the first pass when risk is non-trivial.
- `implement-loop` = `implement` plus review/fix/re-review/proof until the PR handoff is safe.
