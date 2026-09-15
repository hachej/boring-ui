# Worked example — from performance expert to review tool

**Entirely fictional.** Dialogue, cases, measurements, decisions, and product requirements below illustrate the skill. No participant was interviewed, no application was implemented, and no acceptance check was executed.

## 0. Establish the person's technical comfort

Boring PM: “What are you comfortable doing with software today—for example, using apps, setting up workflows, or writing code?”

Expert: “I write Python and use command-line tools for performance work.”

During the discussion of delivery, the expert adds: “I want to review files and keep control of release decisions. I do not want to maintain a new service.”

Save a fictional project profile `P-001`, revision 1, for participant `U-001`. Record `PF-001`, dimension `software_tasks`, value “Python and command-line performance work,” status `reported`, basis `E-005`. Record `PF-002`, dimension `desired_involvement`, value “review files; no new service maintenance,” status `reported`, basis `E-006`. Domain expertise and the availability of an operator are separate facts; do not infer them from coding experience. Link the profile from session state.

The interview can use precise benchmark terminology, but the proposed product must respect the person's wish to avoid maintenance. If this context were already supplied, skip the opening question.

## 1. Begin with the work

Expert: “I want an AI dashboard that tells us if a release is fast enough.”

Boring PM: “What happened during the most recent release review that made you want this?”

Expert: “I compared benchmark summaries from two builds. One test looked slower, but I later noticed the candidate ran on another machine. I spent the review chasing the wrong issue.”

Boring PM: “What did you check before deciding whether the comparison was meaningful?”

Expert: “The machine class, benchmark version, and workload. Then I compared the elapsed times. A missing baseline needs investigation; it is not a pass.”

Boring PM: “Who would use the first version?”

Expert: “Me. I can supply two CSV summaries. I still want to make the release decision.”

The request now describes a specific user's review task. It does not establish demand for a commercial dashboard.

## 2. Capture evidence and interpretation separately

| ID | Fictional evidence | Label within the fictional case |
| --- | --- | --- |
| E-001 | Expert reports that mismatched machine classes caused an unhelpful comparison | reported |
| E-002 | Expert reports checking machine class, benchmark version, and workload before elapsed time | reported |
| E-003 | Expert wants missing baselines left unresolved and retains release authority | reported |
| E-004 | Expert can provide two CSV summaries and is the first intended user | reported |
| E-005 | Expert reports writing Python and using command-line performance tools | reported |
| E-006 | Expert wants file review and retained release authority without maintaining a new service | reported |

O-001, **inferred**: make it easy to identify comparable benchmark changes and record review decisions without losing the input context. Basis: E-001–E-004. A second incident or actual artifacts would test this interpretation.

## 3. Probe the rules and choose a slice

Follow-up: “If the inputs are comparable, how should a change be flagged? What happens exactly at the boundary?”

Fictional product decision D-001: flag an elapsed-time increase **strictly greater than 10%** for attention in the prototype. Ten percent is a proposed review threshold chosen for this example, not a research finding or statistical significance rule.

D-002: support paired CSV inputs and manual review notes. Exclude CI ingestion, automatic release approval, other performance measures, and significance testing. First outcome: the expert can identify candidates for investigation and export their review.

| Rule | Statement | Basis |
| --- | --- | --- |
| R-001 | Compare rows only when case ID, machine class, benchmark version, and workload match | E-001, E-002; application to CSV is proposed |
| R-002 | For comparable positive baseline/candidate values in milliseconds, calculate `(candidate - baseline) / baseline × 100` | D-001; mathematical definition |
| R-003 | Missing, zero, negative, or invalid elapsed-time inputs produce an unresolved comparison | E-003 plus proposed input-validation decision |
| R-004 | Software may flag attention; the expert records the review decision | E-003, D-002 |

Open question Q-001: how are duplicate case keys handled? Treat duplicate keys as unresolved for the prototype, pending an actual artifact review; do not silently choose a row. Open assumption A-001: the supplied CSVs will contain the required fields. Resolve with a small fixture before implementation.

### Compare ways to deliver that outcome

For this example, Boring UI is an explicit implementation constraint. Compare the same mismatched-machine case in each candidate:

| Option | User experience | Fit and tradeoff | Status |
| --- | --- | --- | --- |
| OPT-001 — Guided review document | Expert follows a checklist and calculates changes manually | Small implementation, but most comparison work stays with the expert | Deferred |
| OPT-002 — CSV comparison with human review | Expert supplies two files, inspects flagged/unresolved rows, records decisions, and exports notes | Supports the stated file workflow and control; needs input parsing and a supported Boring UI host | Recommended for a bounded prototype |
| OPT-003 — CI-connected review workflow | Results arrive automatically for each build; expert reviews exceptions | Reduces repeated import steps, but adds integration and operating dependencies not established for this first slice | Deferred |

D-003 recommends OPT-002 based on E-001–E-006 and PF-001–PF-002. Coding ability alone does not justify assigning the expert server maintenance. Operating support remains unknown (`A-002`), so delivery readiness depends on verifying an available operator/host. Revisit the recommendation if that support is unavailable or repeated imports become the dominant burden.

The next comparison uses one realistic input pair to check whether required fields exist and the proposed review is understandable. It is a planned check, not evidence that OPT-002 works.

## 4. Write observable requirements and checks

| Requirement | Behavior | Basis | Acceptance specification |
| --- | --- | --- | --- |
| FR-001 | Mark rows with mismatched comparison context as unresolved and explain the differing fields | O-001, E-001, R-001, D-002 | AC-001: differing machine classes produce an unresolved row with the mismatch shown |
| FR-002 | Flag a comparable elapsed-time increase strictly above 10% | O-001, R-002, D-001 | AC-002: 100 ms to 111 ms is flagged; 100 ms to 110 ms is not |
| FR-003 | Present invalid/missing baselines as unresolved without a numeric change result | E-003, R-003, D-002 | AC-003: missing or zero baseline yields no valid percentage and identifies the input problem |
| FR-004 | Let the expert record a review decision and note for an item | E-003, R-004, D-002 | AC-004: reopening a saved review displays the entered decision and note |
| FR-005 | Export all review items with their comparison status and review notes | O-001, D-002 | AC-005: exported review contains unresolved and reviewed items with their original case IDs |

All acceptance results: **not_run**. FR-004 implies persistence and recovery work; the developer must specify and verify that boundary.

## 5. Map it to Boring UI

Chat accepts the review intent and identifies two supplied inputs. A workbench document or a proposed comparison panel shows items, context, status, and notes. A proposed comparison operation implements R-001–R-003. A proposed review-save operation implements FR-004. Existing workspace primitives can support artifact access; the target host's exact interfaces must be inspected before coding.

Do not invent an existing Boring UI “benchmark reviewer” API. The framework provides the surrounding runtime and UI surfaces; these domain operations still need to be implemented. See [the framework reference](boring-ui.md).

## 6. Validate and deliver only when authorized

Next useful step: inspect a representative pair of CSVs to check A-001 and duplicate-key behavior. Then build a slice with the five requirements and run the acceptance examples against real boundaries. Ask the expert to review a fresh representative case without coaching and check whether the output helps their actual release review.

Candidate outcome measure: elapsed time from valid input selection to a complete review export, accompanied by unresolved-item and mistaken-comparison counts. Baseline and target: unknown until measured or deliberately chosen. This example makes no time-saving claim.

Product-in-hand evidence would include an accessible entry point, real input support, recoverable saved notes, successful expert task completion, and an export. Until that exists, report the result as a proposed specification and handoff.

The fit check also requires the expert to complete a review without unplanned command-line setup or maintenance work. Record any coaching and confirm the actual operating owner before claiming the hands-off delivery requirement is met.
