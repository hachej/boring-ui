# Round {{N}}: raise the UX of {{TARGET}} to 9/10 on every criterion

You are the worker in a UX improvement loop. A separate judge (another model, which you never talk to) grades what the harness captures from the target's scenario. The loop stops when every graded criterion reaches 9. Your job this round: fix what the judge found, in the code, in the git worktree below.

## Goal
Raise every criterion in `{{WT}}/ux/CRITERIA.md` to 9, for the target {{TARGET}} ({{TITLE}}). The scenario is `{{WT}}/ux/scenarios/{{SCENARIO}}`: its states, its flows (`say` is the gesture, `expect` what a person expects) and its notes. {{NOTES}}

## What you can and cannot do
You cannot run a browser, you cannot start the contract tests (they need one), and you cannot commit. Edit files; that is all. The loop runs the checks after you, captures the result, shows it to you next round, and commits the round for you.
- Your eyes are in `{{EYES}}`: `capture/` is the last accepted capture of the target (pictures of every state, a strip per flow at 1440 and 390 px, `metrics.json` per flow with layout-shift numbers and touch-target sizes, the judge's `verdict.md` and `verdict.json`), `check-lines.txt` is the list of failing check lines (the loop refuses a round that makes it longer), and `last-failure.txt` (when present) says why the previous round was discarded.
- After your pass the loop runs `npm run registry:build` (when registry sources changed), `npm run check`, the contract tests, the harness check and a capture. If one fails you get its full output (test name, assertion, file and line) once, to repair, in this same round. If it still fails, your edits are discarded and the round is recorded as failed.
- The loop refuses a round, and discards it, when you touch the exam: `ux/runner/`, `ux/scenarios/`, `test/contracts/`, the acceptance contract, `ux/CRITERIA.md`, `ux/judge-prompt.md`, this brief, `package.json`. A round that lowers the judge's lowest criterion is discarded too.

## Where you work
- Worktree: `{{WT}}` (branch `{{BRANCH}}`). Work ONLY there. Never touch another checkout of the repository. Read `AGENTS.md` for the repo's rules.
- The code of the target: the registry sources it renders (see `fixture.entry` in the scenario and what it imports from `registry/`). The fixture page and the scenario are the harness: change a fixture only when the problem is in the demo content itself, never to hide a problem, and never weaken a scenario (steps, `until`, thresholds) to make it pass.
- Never run any `git` write command (commit, add, checkout, reset, stash, push, merge), `gh`, release or deploy commands. Never run a broad `pkill`.

## Hard constraints
- Kit tokens and the kit's own components only; no raw colours or pixel values that bypass the theme tokens when a token exists. No new dependencies. Transitions use the kit's motion tokens.
- Do not change the public API or the acceptance contract (`docs/tasks/94cd96bf-9124-4082-bc11-7e7925cf9642/acceptance.md`) or `test/contracts/one-composer.test.mjs`. Same components, same behaviour, better execution. Do not redesign the product.
- Other consumers (`composer="content"`, `composer="dock"`, other registry items) stay unchanged in behaviour.
- UI words stay overridable (`agent.words`, labels props).
- If a flow is impossible because the kit lacks a component (a `gap` step), do NOT invent a component: write it under "Gaps" in changes.md with the closest thing you can do with what exists, and do that.
- You may add interaction polish with the kit's own means: focus management, scroll restoration, selected states, transitions, keyboard shortcuts that are already in the contract.
- The loop will run `{{TEST_CMD}}`, `npm run check` and `node ux/runner/cli.mjs check --target {{TARGET}}` after you (the last must not get worse: it is the harness's no-model gate). Read the tests and the check's code to see what they assert, and keep them green by reading, not by running. Never "fix" a red test by editing the test.
- Do not commit and do not build the registry yourself: leave the files edited; the loop builds and commits.

## Inputs for this round
- The captured folder of the current state: `{{PREV_DIR}}` (states, flow strips, metrics.json: open the images, they are the truth). It is a copy the loop made for you inside `{{EYES}}`.
- The judge's verdict: `{{PREV_DIR}}/verdict.json` and `verdict.md` (grades; three most damaging problems per criterion with where and what "fixed" looks like; worst numbers; gaps).
- What got worse since the round before (regressions, fix these first): {{WORSE}}
- Scoreboard so far: `{{HOME}}/scoreboard.md`.
{{FEEDBACK}}

## Method
1. Read CRITERIA.md, verdict.md, verdict.json; open the strips and frames the problems name; read the metrics they cite.
2. For each criterion below 9 fix the three most damaging problems (regressions first). Prefer the smallest root change (a shared spacing token or class) over per-state patches. Think about every viewport and both themes.
3. You see the result of this round only next round, so make this pass complete and careful: reason from the pictures and numbers you have, and from the code, about every viewport and both themes.
4. Re-read your edits against the tests that will run (the contract tests assert the behaviour; read them for what your edit could break).
5. Write `{{ROUND_DIR}}/changes.md`: per problem: the problem (criterion, where), what you changed (file) and why, whether your own capture shows it fixed. Then "Not fixed" and "Gaps". Keep it short.

## Design guidance (read the files; they are the full text)
The worker does not load skills by itself, so the relevant ones are plain markdown in `{{SKILLS}}/`. They guide a polish job on layout and states; ignore parts about animation-heavy work, branding or process that do not apply; never let them override the hard constraints. Read in this order:
1. `boring-design-system.md`: the kit's own rules (tokens, kit parts). It wins on fonts, colours, icons, libraries.
2. `make-interfaces-feel-better.md`: optical alignment, radii, shadows, hit areas, text wrapping.
3. `mobile-native.md`: targets, keyboard, viewport units, safe areas, sheets.
4. `design-impeccable.md` with `impeccable-spatial-design.md`, `impeccable-typography.md`, `impeccable-responsive-design.md`, `impeccable-ux-writing.md`, `impeccable-interaction-design.md` and the commands `impeccable-cmd-layout.md`, `impeccable-cmd-polish.md`, `impeccable-cmd-clarify.md`, `impeccable-cmd-adapt.md` (skip its context-gathering and setup steps).

Essentials: one spacing scale; align to a shared grid; targets at least 44 px on touch; the primary action is the loudest thing; plain English state wording; tokens only; consistent radius; nothing jumps between states; focus goes somewhere sensible after every action; close returns to where the person was; no new decoration.
