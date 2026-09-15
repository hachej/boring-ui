# Interview-to-product workflow

**Status:** original Boring PM protocol informed by the [source register](sources.md). Gates are evidence checks, not mandatory approval meetings. Adapt effort to the product's stakes and the user's time.

## Choose the next stage

| Stage | Learn or accomplish | Artifact | Enough to move forward |
| --- | --- | --- | --- |
| Frame | Technical comfort, desired involvement, roles, task, outcome, constraints | Provisional user profile and brief | Enough context to adapt the conversation, one concrete task, and an identified beneficiary; remaining profile facts can stay unknown |
| Reconstruct | A recent normal case and a difficult case | Evidence ledger and task narrative | Triggers, steps, outputs, handoffs, and pain are understandable |
| Extract | Cues, rules, uncertainty, exceptions, human judgment | Domain model | The first slice's decisions have examples and defined unknowns |
| Choose | Compare solutions for this user and select a complete first outcome | Option comparison, scope, and decision log | Recommendation links to evidence, profile facts, constraints, tradeoffs, and a reconsideration trigger |
| Test | Resolve the uncertainty most likely to change the recommendation | Experiment record | Evidence supports user fit and feasibility, or a bounded risk is explicitly retained |
| Specify | Observable behavior and framework mapping | Product spec and Boring UI spec | First-slice requirements are traceable, feasible, and testable |
| Build | Integrate a working vertical slice | Running product and check results | Required behavior works through real boundaries, not only mocks |
| Try | Intended user performs a representative task | Acceptance and feedback record | Task succeeds; important failures have a recovery path |
| Deliver | Access, instructions, ownership, and outcome follow-up | Delivery record | User has the product and knows how to use and recover it |

If a stage reveals an invalid assumption, return to the affected earlier stage. Do not silently rewrite the history. A spec can be ready for a prototype while still not ready for a production build; record that intended use.

## Conduct the first session

Start with the technical-comfort question in [SKILL.md](../SKILL.md) if it is unanswered, then explore the person's actual work. Reuse existing answers and keep the [profile](user-profile.md) provisional; completing it is not an interview gate. Adapt [solution exploration](solution-exploration.md) to the user's preferred depth and desired involvement.

A suggested 45-minute format, adjustable rather than a research standard:

| Time | Focus | Useful move |
| --- | --- | --- |
| 0–5 min | Technical comfort, role, goal, session expectations | Calibrate if needed; establish the task and whether the expert is also its user |
| 5–20 min | Recent concrete incident | Reconstruct the sequence without pitching a solution |
| 20–30 min | Difficult decisions | Probe one or two important judgment points and a counterexample |
| 30–40 min | Opportunity and alternative solutions | Compare concrete approaches at the right depth and identify the decisive uncertainty |
| 40–45 min | Corrections and next evidence | Save the useful artifacts and choose one next action |

A ten-minute session can capture a task, one incident, and the highest-impact unknown. It should produce a provisional brief, not a claim that discovery is complete.

## Question selection policy

Keep an ordered queue of uncertainties. Ask about the item with the strongest combination of consequence if wrong, current uncertainty, and relevance to the first slice. Prefer a question the current participant can answer. This is a qualitative Boring PM heuristic; do not manufacture numerical scores.

| Signal in the answer | Next move |
| --- | --- |
| Technical comfort unknown | Ask the concrete opening question once, unless the user wants no questions |
| Self-rating only ("I'm advanced") | Recover an example relevant to this task; keep the rating reported |
| Capable but unwilling to maintain software | Separate ability from desired involvement and identify a supported operating model |
| Interviewee differs from product users | Keep profiles distinct and investigate the actual audience's needs |
| Changed preference or failed user task | Update profile/decision history and revisit only affected options |
| Abstract claim (“we always check quality”) | Ask for the most recent example and the specific signal they checked |
| Feature request (“add a dashboard”) | Recover the decision or action the feature should enable |
| Rule (“over 20 means reject”) | Ask for units, context, equality boundary, missing input, and exceptions |
| Intuition (“I just know”) | Compare two similar cases that led to different decisions |
| Generalization about other people | Record its source and identify who could corroborate it |
| Conflicting answers | Preserve both; compare contexts before asking for a ruling |
| Unknown answer | Identify a document, observation, experiment, or other expert; continue unaffected work |
| Fatigue or repetition | Summarize, save state, and stop asking low-value questions |
| Request to build immediately | State provisional assumptions, choose a reversible prototype slice, and proceed within authorization |

## When to stop interviewing

Stop this round when additional answers would not change the next implementation or experiment, or when the timebox expires. Do not impose a universal interview count. For a market-facing product, document which important user and buyer perspectives remain untested. For a personal tool, direct observation of its user's task may be sufficient for a first prototype.

## State and transitions

Use [session state](../assets/templates/10-session-state.json). Record the next stage with `basis`, `open_questions`, `blocking_unknowns`, and a `next_question`. Link private profile paths and revisions, considered option IDs, and the selection decision. On resume, read the saved state, relevant profile, and latest artifacts before asking anything. Preserve earlier state when adding new fields; see [profile reuse](user-profile.md#save-correct-and-reuse). Summaries may shorten evidence; they must retain source IDs and disagreements.

For exploration-only work, save the comparison, profile, evidence links, and next step. Do not expand the session-state file into an unrequested specification or backlog; write each detailed artifact when the task actually reaches that stage.

“Ready for build” means the chosen slice has no unresolved unknown that prevents safe implementation of that slice. “Accepted” means its stated checks were actually run with recorded results. “Delivered” adds usable access and operating ownership. These labels never advance just because a document exists.
