# UX criteria (generic: every target is graded on these)

A target is a layout (a shell arrangement over a realistic page) or one component on a neutral surface; each has a scenario in `ux/scenarios/` that lists its states and flows. The scenario may add target-specific notes; these criteria do not change.

Grades are out of 10, integers or halves. **9 means a senior product designer would ship it as is.** Most real work sits between 5 and 8. A criterion's grade is capped by its worst state or flow at any viewport: one broken state holds the grade below 7. Grade what the pictures and numbers show, not what the code intends. Same components, same contract: never grade "should be another product".

What the judge gets, in the captured folder: `states/<viewport>-<nn>-<name>.png` (static states), `flows/<id>/strip-<viewport>.png` (one flow, frames left to right: before, each step, and two frames about 80 and 200 ms into a transition, each with the measured first change, settled time and layout shift), `flows/<id>/<viewport>/metrics.json` (per step: ok, first change ms, settled ms, layout shift, where the watched boxes moved, where focus is, scroll before and after, size of what was tapped, controls offscreen or overlapping, text cut off, console errors), `result.json`.

Criteria that do not apply to a target are switched off in its scenario (`"criteria": { "phone": false }`) and are not graded.

## 1. Clarity and hierarchy
On every state it is obvious what the screen is for and what the one primary action is; nothing competes with it.
- 5: understandable after a moment's study; two or more elements fight for attention; the primary action weighs the same as secondary ones.
- 7: the primary action is findable in most states; a few states carry extra chrome or ambiguous controls.
- 9: in every state the eye lands on the right thing first, secondary controls are quieter, labels say what a control does, nothing is duplicated.
- Look at: all states, both viewports.

## 2. Layout, spacing and density
One spacing rhythm and alignment grid; nothing cramped, clipped, overlapping or floating; the component never covers what the person needs; consistent across viewports.
- 5: visible misalignments, uneven paddings, text cut mid-line, content hidden behind the component.
- 7: mostly aligned; one or two cramped or uneven spots; what is behind stays usable.
- 9: edges line up across states, gaps come from one scale, nothing is truncated without need (see `truncated`, `overlaps`, `offscreen` in the metrics), the viewports feel like one design.
- Look at: the open, expanded and docked states; `truncated` and `overlaps` in metrics.

## 3. States and feedback
Every static state (rest, focus, working, reply, question, error, empty, read-only, listening) is legible at a glance and says in plain words what is happening.
- 5: some states are hard to tell apart or have no visible words (a spinner alone); the error is easy to miss; the empty state is blank.
- 7: all states exist and read; wording is generic or small; a state loses context.
- 9: each state has a clear plain line, an obvious next action (retry, answer, stop), calm focus and error treatment, and the component keeps its place from one state to the next.
- Look at: `states/`, and the first and last frame of each flow.

## 4. Phone ergonomics
(Only for targets with a touch viewport.) Thumb reach, touch targets of at least 44 px (see `target` in the metrics), the keyboard case, no sideways scroll, the page usable behind the component.
- 5: small or crowded targets, the field under the keyboard or out of reach, the page unusable behind it.
- 7: targets mostly fine; one or two small or crowded; the keyboard case works but leaves little room.
- 9: every tapped control is at least 44 px with room around it, the field sits on the keyboard with the last text visible, home-bar inset respected, sheets close with one thumb, `horizontalScroll` never true.
- Look at: every phone state and flow.

## 5. Visual polish and coherence
One type scale, tokens only, consistent radius, borders and shadows, light and dark both right, icons of one family, no "generic AI" look.
- 5: mixed sizes and weights with no scale, inconsistent radii, placeholder art, a dark theme with low contrast or leftovers from light.
- 7: coherent in light; a few inconsistencies; dark mostly right.
- 9: sizes come from one scale, radii and borders are consistent, icons match, contrast is comfortable in both themes, the whole looks designed rather than assembled.
- Look at: light and dark states side by side; zoom into the smallest text and the icons.

## 6. Flows and interactions
Each interaction does what a person expects in the fewest steps; the result appears where they are looking; nothing jumps; everything can be closed or undone and returns them exactly where they were; focus and scroll are kept; transitions are quick and calm; keyboard and touch both work.
- 5: some flows need a repeated gesture or fail; layout shifts or jumps during actions; focus is lost (`focusAfter` is `body`); closing does not return to the prior state; no keyboard path; transitions over 500 ms or abrupt.
- 7: every flow completes; small shifts (layout shift 0.02 to 0.1) or a missing focus return in a few steps; first visible response 100 to 300 ms; the close works but loses scroll or selection.
- 9: every flow completes first time (`repeats` 0), layout shift under 0.02 per step, nothing watched moves unless the flow says so (`moved`), focus always lands in the right place, close returns to the exact prior state (focus, scroll, selection), first visible response under about 100 ms and settled under about 300 ms for local actions, keyboard and touch paths both work. A step the kit cannot do (`gap` in the scenario) is graded as missing: it caps this criterion at 7 until the kit offers it.
- Look at: every flow strip and `metrics.json`; name the flow id for each problem. Grade from what happened, not from the plan.
