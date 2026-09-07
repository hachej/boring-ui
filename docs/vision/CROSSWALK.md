# Crosswalk — edition 2026-09-07 → rulings

Ruling-neutrality check: every statement in the edition maps to a ruling in
force. If a reviewer finds a sentence with no row here, it is a defect in the
edition, not a new ruling. Status column: **built** · **partial** · **bead** (queued
in epic #1562 or Wave A) · **open** (no bead).

| Chapter § | Claim | Source of authority | Status |
|---|---|---|---|
| 1 journey | create → release → install → run → adapt → maintain is the first complete journey | RECONCILIATION §13(a) | bead (nc-1…nc-7) |
| 1 first proof | Seneca math tutor for a second learner, then a nontechnical curator | §13(g) | bead nc-7 |
| 1 metric | founder interventions per accepted retained adaptation | native-creation README §"Success"; DIRECTION 2026-09-07 done-bar | open (Activity projection) |
| 1 non-goals | marketplace, universal generators, DSL, self-modifying repo, untrusted host code | ratified VISION §8 + 2026-09-05/07 amendments | — |
| 2 Thread/Session | Thread = job root, 0..n Sessions; Session ≤ 1 Thread | RECONCILIATION §9a | bead nc-t |
| 2 shape open | timeline stream vs projection undecided | §9a; DIRECTION [thread-storage-spike] | spike .13.2 |
| 2 no session keys | product records bind to workspace/installation/thread | DIRECTION 2026-09-07 binding rule; §11(f) | bead nc-1/2/3/d |
| 2 Run/request key | admission ledger, settled retries, outcome-unknown | §11(c); ARCH-PLAN D-c; D31 addendum | partial (request ledger built; C6 open) |
| 2 Level D first | durable stream + paused-turn resume before the engine | §8(c)(1); DIRECTION [durable-streams] | partial (A1/A2 landed, flag off) |
| 2 staffing | grow-as-needed default; predefined fleet | §10(a) | naming |
| 2 presence | hidden·ambient·drawer·page·roster; ambient default | §10(b) | naming |
| 2 approvals | agents cannot mint approvals; decisions reachable outside chat | V2-PORT-HANDBOOK Approval; §11(f) | partial (#1348 open) |
| 2 boundaries | no A2A loopback, no shared room; host-mediated posts | §7, §9, §10 explicit non-changes | — |
| 3 View set | descriptor+resolver+host+context+ref as a set; no lookalike | §8(c)(3); premises P4 | bead nc-v |
| 3 renderer rule | agents never reason over renderer concepts | VISION invariant 4; §13(e) narrowing for builders | — |
| 3 Experiences | independent composition choices; recipes not modes | §11(f), §12(a) | — |
| 3 Meridian | flagship, not mandatory; other Experiences valid | §8(a) scope clause | chrome slices dispatchable |
| 3 no global chat | conversation contextual; multi-author transcript | §8(a); §9b | fixture |
| 3 Library placement | installed product in Library → Thread in Work | DIRECTION 2026-09-07 | bead nc-l |
| 3 generated UI | isolated frame, brokered bridge, via ViewRef | §11(e), §13(c) | bead nc-5 |
| 4 three layers | host / product runtime / sandbox | §13(b); D33 | bead nc-4a |
| 4 runtime unit | per installed product | §13(b) | — |
| 4 modes | embedded (default off, single-tenant) / local / remote; host policy | §13(c); D33 | beads nc-0, nc-4b |
| 4 composition layers | host contract · packages · workspace overlay · personal overlay · private modules · business data | §11(b); LIFECYCLE | — |
| 4 release | immutable manifest, digests, provenance, evidence refs, agent digests | §11(c) step 2; §13(d); nc-a | bead nc-1 |
| 4 installation | scope, bindings, grants, mode, generation; personal-scope = separate consumer | §13(d); DIRECTION 2026-09-07 defaults | bead nc-2 |
| 4 activation | CAS on generation, request-keyed, prepared→committed/aborted; undo = activation | §11(c) steps 4–5; §13(d) | bead nc-2 |
| 4 standing authorization | change class + budget; default preview/keep | §13(d) | open |
| 4 change loop | capture → candidate → verify/preview → activate → observe; builder proposes, host decides | §11(c) | beads nc-6, nc-3 |
| 4 candidate privacy | digest/URL is not a grant; revocation | §11(c) step 3 | open |
| 4 lanes | preference → composition → behavior → module → trusted release | §11(d); LIFECYCLE | — |
| 4 three loops | private adaptation / downstream maintenance / shared improvement | §11(d) | — |
| 4 reconciliation | compat before activation; conflicts; copy-on-write state; quarantine | §11(c); LIFECYCLE | bead nc-r |
| 4 E0–E6 | acceptance ladder; second consumer for cross-domain; Rule of Three | §11, §12(e)(f) | nc-7 = E1 |
| 5 agent package | instructions, skills, knowledge, digest; boot-time install today | #1107/#1202 lane; PORT-HANDBOOK Agent | built; nc-a |
| 5 Seats | participation not identity; additive specialist | VISION inv 5; D32 | built |
| 5 fleet | deployment-static; products separate tier | D28; D33 | built / bead |
| 5 builder class | own type, own catalog, edits candidates, never activates; typed brief | §13(e); nc-6 prior-work note | bead nc-6, nc-x |
| 5 teams | multi-author; orchestrator Seat; audit-grade seatId | §9b; §8(c)(2) | beads .14.1/.14.2 |
| 5 delegation | host-mediated call; no loopback | V2 spec L3; §7 | partial |
| 5 improvement | promote on evidence; no live self-rewriting; candidate without objective | VISION inv 10, 11; 2026-08-27 amendment | — |
| 6 funnel | one gateway; host mints scope; actor∩installation∩job∩policy | D29; D33; §13(d) | built / bead nc-3 |
| 6 context & capability | six questions; effect classes; fail closed; intersection | PORT-HANDBOOK Supporting types, Capability | bead nc-x |
| 6 request-bound authority | short-lived, bound tokens; revocation; epochs | ARCH-PLAN §6, A8; WORKSPACE_BRIDGE_V1 | partial (A8 open) |
| 6 model credentials | per-invocation capability; no raw key across boundary | ARCH-PLAN A7; D27 | bead nc-c |
| 6 sandboxes | leases; several per session; Firecracker floor; env allowlist | D31 + addenda; A4 | partial (A4 open) |
| 6 untrusted tier | isolation + promotion; frame for UI; server inside product runtime | ARCH-PLAN D-b superseded by §13(c); P0.6 | beads nc-0, nc-4b, nc-5 |
| 6 local floor | bwrap/runsc accepted for first proof; microVM before shared tenants | DIRECTION 2026-09-07 defaults | — |
| 6 sovereignty | operator-controlled storage; publication control-plane enforced | D31 | partial |
| 7 state | owned or connected; four meanings | §12(b) | — |
| 7 learner data | own lifecycle; bound to installation/thread/release; schema in compat | §11(b); §13; binding rule | bead nc-d |
| 7 operations | defined once, projected everywhere; agents propose | §12(c) | built (bridge) |
| 7 evidence | bound to exact release; forks don't inherit; four facts distinct | native-creation README; §13; Q3 dataset | bead nc-e |
| 7 optimization optional | attaches where objective+signal exist | VISION 2026-08-27 amendment; DIRECTION 2026-08-26 | — |
| 7 cost | usage per Run attributable to installation | #819 plan; nc-c | bead nc-c |
| 8 split | substrate platform-side; offers tenant-side | DIRECTION 2026-08-08 premises; §13(h) | — |
| 8 Seneca | first consumer; pulls by digest | §13(g); DIRECTION 2026-09-07 defaults | open (cross-repo path) |
| 8 execution home | this repo; port demoted; lane 2 deferred | §13(f); DIRECTION 2026-09-07 | done |
| 8 factory | DoR beads, DIRECTION-only dispatch, two gates, curator never operates beads | factory VISION; `.agents/factory/README.md`; reassessment §6 | partial (Beadle unbuilt) |
| 8 honesty | no guarantee before demonstration; false close reopened | AGENTS.md rule 8; §11(g) | — |
