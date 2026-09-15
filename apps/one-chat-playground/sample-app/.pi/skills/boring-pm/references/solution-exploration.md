# 10 — Explore solutions for this user

## Source-backed principle

Product Talk recommends generating alternatives for one opportunity and comparing evidence about their critical assumptions [S30](sources.md#s30). Its opportunity/solution distinction separates learning about needs from evaluating proposed approaches [S07](sources.md#s07), [S08](sources.md#s08). Task observation helps establish usability beyond interview reactions [S16](sources.md#s16), [S31](sources.md#s31).

The following loop and fit criteria are Boring PM's original application of those principles. It produces a revisable recommendation among explored options, not proof of a globally optimal solution.

## 1. Frame the decision

Recover one real task, the desired outcome, existing workaround, and consequential failure. Use [the interview guide](expert-interviews.md) and [tacit-knowledge probes](tacit-knowledge.md). Read the [profile](user-profile.md) to decide how to explore with this person. Identify separately who will use, build, approve, and operate the result.

Separate hard constraints from preferences and unknowns. A user who cannot code may have a capable implementation team; a developer may have no time for maintenance. Ask about the missing fact only when it would change the comparison. Do not require a complete profile before useful work.

## 2. Diverge across meaningful approaches

Generate a small set of genuinely different ways to complete the same task. Two or three are usually enough to start; this is a convenience, not a required count. Candidate families include improving the current manual process, configuring an existing tool, bounded automation with human review, and custom software. Different technology stacks implementing the same workflow are not automatically different product solutions.

Give options stable `OPT-` IDs. For each, describe the user's input, actions, output, retained decisions, setup, failure/recovery, and operating owner. Identify the critical assumption. Compare options with the same representative case and comparable detail; do not make the preferred option vivid and the alternatives vague.

Preserve an explicit Boring UI requirement. Within that boundary, explore alternatives such as a guided document, a structured workflow, or bounded automation in Boring UI. If an existing tool or manual path is a useful baseline but violates the fixed implementation constraint, label it a baseline or a proposal to revisit that constraint. Do not silently substitute platforms. Do not assume Canva, Craft, Figma, a chat UI, or an AI agent must be part of every solution.

## 3. Make tradeoffs understandable

Show each option in the form the person can inspect: an everyday scenario, a sketch, sample records, a configuration, or an interface contract. Use generic tools or clearly hypothetical costs until named provider capabilities and prices are verified. Do not require a nontechnical participant to choose a framework or database to advance discovery.

Ask a question that reveals a tradeoff, such as “In this example, which part would you want to review yourself?” or “What would make this difficult to use next week?” Do not ask only whether an idea sounds good. Keep their preference separate from evidence that they can use it successfully.

Use [the scope template](../assets/templates/04-opportunity-and-scope.md) to compare:

- Outcome coverage, correctness, and consequential failures.
- Fit for actual product users, including explanation and interaction needs.
- User effort, desired control, and acceptable learning/setup burden.
- Builder and operator ability, available help, and ongoing maintenance.
- Data/integration access, cost and time within known constraints.
- Reversibility, uncertainty, and the evidence that could change the choice.

Use qualitative judgments tied to evidence and profile facts. Reject a violated hard constraint or identify how it can be met; do not let an average score conceal it. Do not invent numerical reach, proficiency, ROI, or weighted precision from thin evidence.

## 4. Test what could reverse the recommendation

Choose the unresolved assumption most likely to change the ranking. A task walkthrough or small prototype can test interaction; a real sample can test whether rules and inputs are expressible; a feasibility spike can test an interface. Use [the experiment template](../assets/templates/05-experiment.md), with a decision and success/failure criteria stated before execution.

Match the task participant and permitted support to the intended use. Record coaching; success with unplanned help does not show independent usability. If another person or team is expected to maintain the product, verify that support is actually available. Do not treat a friendly reaction, self-rating, agent simulation, or unrun scenario as proof of user fit.

Under a short timebox, name the retained assumption and recommend a bounded prototype or next evidence step. In a spec-only task, specify the test and mark it unrun.

## 5. Recommend, then specify the selected slice

Give a clear recommendation: the chosen `OPT-` ID, why it fits this user's outcome and profile, its main compromise, the decisive evidence, remaining uncertainty, and what would change the decision. Briefly explain why the other candidates were deferred or rejected. If no option meets a hard constraint, explain the conflict and recommend the next way to resolve it instead of inventing a winner.

Do not reopen a settled choice solely to satisfy a candidate count. A user may explicitly choose an approach; respect that decision and explore within it, while surfacing material unresolved constraints. A request to build immediately authorizes progress within its scope, not a forced discovery ceremony.

Carry the selected fit requirements into the product and Boring UI specifications: interaction depth, defaults, review/override, onboarding, operating ownership, and failure recovery. A user-friendly explanation can accompany a precise technical handoff. Include a representative acceptance task at the intended level of assistance.

Save option statuses, evidence/profile links, the decision, and the next useful test in project state. A changed preference, new audience, failed task trial, or unavailable operator can reopen the affected decision without discarding the rest of the discovery history.
