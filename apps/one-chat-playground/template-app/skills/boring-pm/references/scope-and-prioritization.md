# 05 — Choose a small complete product

## Source-backed principle

Story mapping preserves a user's overall activity while organizing smaller pieces of functionality [S09](sources.md#s09). Shape Up's appetite sets a budget for a solution and makes scope adjustable [S10](sources.md#s10). RICE combines reach, impact, confidence, and effort to compare opportunities when credible estimates exist [S11](sources.md#s11).

## Boring PM application

Map the user's route from trigger to useful result. Select a release slice that crosses the necessary steps of that route. For an expert review tool, a first slice might import one supported input, identify review items, let the expert decide, and export the result. A database and an empty chat window do not yet complete that task.

Keep four separate lists: necessary for the first outcome, later opportunities, explicitly excluded behaviors, and unknowns that might invalidate the plan. Do not disguise unbounded scope with labels such as “MVP.” State the supported user, input format, decision, output, and environment.

## Compare alternatives

Follow [solution exploration](solution-exploration.md) before committing to a feature set. Compare meaningful approaches to the same task using the relevant [user profiles](user-profile.md), while respecting explicit platform constraints. Judge alternatives by outcome, error consequences, user effort and control, setup and learning burden, operating ownership, cost, implementation work, and reversibility. Recommendation rationale must explain why the selected approach fits the actual users and available support.

An attractive alternative can be rejected because its data is inaccessible or its operator burden is too high. Record why, so the same argument does not have to be repeated later.

## Use scoring only when it helps

RICE is `(reach × impact × confidence) / effort`. Keep a common reach period and effort unit. Use estimated ranges and record the basis of each input. If evidence is thin, a precise score adds little; order the opportunities qualitatively and choose the experiment that would change that order.

Separate a feature's priority from an assumption's test priority. A small uncertain dependency can deserve testing first because every candidate solution requires it. Requirements necessary for the complete user task cannot be removed merely because they score poorly in isolation.

## Set boundaries and cut intelligently

Record the available time or effort appetite without presenting it as an engineering estimate. If the slice does not fit, narrow users, formats, integrations, or workflow variants. Keep correctness and recovery necessary to the selected task. Put deferred scope in the decision log with a trigger for reconsideration.

## Exit and failure patterns

Exit with a demonstrable first outcome, inclusions, exclusions, dependencies, and a reason for the choice. Avoid feature voting without a shared outcome, numerical prioritization from invented inputs, and a first release that cannot finish any task. Use [scope](../assets/templates/04-opportunity-and-scope.md).
