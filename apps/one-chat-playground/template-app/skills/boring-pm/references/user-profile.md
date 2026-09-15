# 09 — Understand the person and adapt the conversation

## Source-backed principle

GOV.UK distinguishes digital skills, confidence, access, and support needs, and cautions that self-assessed ability can be inaccurate [S29](sources.md#s29). Its interview guidance supports adapting to the participant's pace and pursuing concrete examples [S02](sources.md#s02). NN/g distinguishes what an interviewee reports from behavior observed during a task [S31](sources.md#s31).

The profile, opening question, dimensions, and adaptation rules below are Boring PM design choices. They are not a validated assessment of ability or a substitute for professional user research.

## Open with a useful calibration

When technical comfort is unknown, ask the opening question in [SKILL.md](../SKILL.md). Give examples of activities, not a compulsory beginner/intermediate/expert ranking. Accept a short self-description, record it as reported, and continue to a recent case. If the answer is a label only, an example of something they used, configured, or built can clarify the relevant capability as the case unfolds. Do not administer a programming quiz.

If their message or available profile already provides the answer, use it. If they want immediate recommendations or no questions, produce a provisional comparison with unknowns. If they decline profiling, adapt within the conversation without creating a persistent profile.

Ask the next relevant follow-up, not every question here: “How much of the setup and maintenance would you want to handle yourself?” Ability, willingness, and available help are different. Recheck a preference if the person changes it or a new task requires different skills.

## Build the profile progressively

| Dimension | Record when relevant | What it changes |
| --- | --- | --- |
| Domain experience | Work they know deeply; cases and judgments | Depth of domain questions; terminology to preserve |
| Software tasks | Apps, spreadsheets, configuration, code, data, APIs; concrete examples | How to illustrate and explore an option |
| Deployment and operations | Installation, hosting, debugging, maintenance they can handle | Feasibility of self-operation and need for support |
| Desired involvement | Use a finished tool, configure, build, learn, delegate; time available | Division of work and acceptable ongoing effort |
| Explanation preferences | Everyday examples, visuals, configurations, technical detail; pace | How to present comparable options and check understanding |
| Support context | Actual builder/operator and available help | Which complexity can be supported by someone else |

Keep budget, environment, data access, deadlines, and hard product constraints in the project brief; do not silently turn a project-specific limit into a permanent personal trait. Record task-relevant access or communication needs only when supplied or needed, without inferring diagnoses or demographics.

An interviewee may be the builder while the product users do not code. Record those as different participants or explicitly labeled audience hypotheses. One person's profile is not evidence about a whole market. Keep audience assumptions in the brief until supported by appropriate participants.

## Make adaptation observable

| Current preference or capability | Useful exploration format | Still establish |
| --- | --- | --- |
| Wants everyday language | Walk through an input, action, result, and failure; use a sketch if helpful | Rules, consequences, setup owner, and recovery |
| Comfortable configuring tools | Show fields, a sample table, workflow steps, permissions, and edits | Who repairs broken connections and maintains configuration |
| Wants implementation detail | Discuss contracts, sample data, state, integration and failure boundaries | Actual user workflow, value, and operating appetite |
| Can code but wants no operations | Offer technical detail on request and compare managed delivery/support | Supported operating owner and ongoing cost |
| Wants to learn | Offer a small learning step alongside a usable path | Time available and whether learning is an explicit outcome |

These are response formats, not fixed user classes. Never equate low coding experience with a need for an inferior product, or high coding experience with a need to build custom infrastructure. Change the representation without hiding important tradeoffs or weakening the implementation specification.

## Save, correct, and reuse

Use [12-user-profile.json](../assets/templates/12-user-profile.json) in the designated private project workspace. Store one profile per participant and link its path, ID, and revision from [session state](../assets/templates/10-session-state.json). A shared user profile across projects is optional and requires an available, authorized private host store and a reliable mapping to the same person; the skill does not supply an identity or storage service. Do not put real profiles in the installed skill or public repository.

Each fact uses a stable `PF-` ID and contains `dimension`, `value`, `status`, `basis`, and `updated_at`. Use the existing observed/reported/inferred/assumed/unknown statuses. The basis points to an evidence ID or an actual message/task location. A self-description remains reported; a limited demonstration supports only that task. Keep unknown fields null, without invented numeric proficiency or confidence scores.

Keep each fact in one authoritative place. Session state should index profiles, evidence, decisions, and the next action, not repeat their complete contents in several sections. If there is no separate evidence ledger, one compact evidence list is sufficient; do not add parallel summaries and full message transcripts containing the same facts.

Show a short profile summary when it affects a recommendation and invite correction as part of normal discussion. Current explicit preferences override older ones. Increment the profile revision, record what changed and why, and revisit affected option/requirement decisions. Do not silently overwrite contradictory observations; resolve the context or retain both with their sources. Honor requests to omit or remove profile facts.

On resume, confirm that the available profile refers to the same participant and context. Ask only about missing or stale facts that could change the next decision. For a version 1.0 session state, add the new profile/option fields as empty or unknown while preserving its stage, history, and next question; do not restart onboarding. If persistent storage is unavailable, provide portable state without promising automatic recall.
