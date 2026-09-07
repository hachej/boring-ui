# Crosswalk — edition 2026-09-07 → rulings → status

Ruling-neutrality check: every statement in the edition maps to a ruling in
force. A sentence with no row here is a defect in the edition, not a new
ruling. One claim per row. **Status** is exactly one of:
**built** (on `main`, proof named) · **partial** (named subset built) ·
**fixture** (proved only in a playground/spike) · **bead** (queued: epic #1562
`nc-*` or Wave A id) · **open** (no bead, no code) · **ruled** (policy only,
nothing to build).

| Ch. | Claim | Authority | Status | Proof / bead |
|---|---|---|---|---|
| 1 | The journey create → release → install → run → adapt → maintain is the first complete product journey | RECONCILIATION §13(a) | bead | epic #1562 |
| 1 | First proof = Seneca math tutor for a second learner, then a nontechnical curator | §13(g) | bead | `nc-7` |
| 1 | Founder interventions per accepted retained adaptation is the standing metric | native-creation README; DIRECTION 2026-09-07 done-bar | open | needs Activity projection |
| 1 | Product ladder bare agent → +workspace → app → +seats → product; additive upgrades | RECONCILIATION §6 Q1 | ruled | — |
| 1 | Non-goals: marketplace, universal generators, DSL, self-modifying repo, untrusted host code | ratified VISION §8 + amendments | ruled | — |
| 2 | Thread = durable job root; 0..n Sessions; a Session binds to ≤1 Thread | §9a | bead | `nc-t` |
| 2 | Timeline storage shape undecided | §9a; DIRECTION [thread-storage-spike] | bead | `shell-ngfs.13.2` |
| 2 | Product records never keyed by session; Thread binding only when produced in a job | DIRECTION 2026-09-07 binding rule; §11(f); §12(c) | bead | `nc-1/2/3/d` tests |
| 2 | Run identified by request key; settled retries; outcome-unknown never replayed | §11(c); ARCH-PLAN D-c; D31 addendum | partial | request ledger built (`packages/agent/.../requestLedger.ts`); C6 accepted-effect protocol open |
| 2 | Level D durable stream + paused-turn resume before the engine | §8(c)(1); DIRECTION [durable-streams] | partial | A1, A2 landed flag-off; A3–A5, P1-B, P1-C open (`9p50.*`); conformance restart cases skipped |
| 2 | Staffing modes: grow-as-needed default, predefined fleet | §10(a) | ruled | — |
| 2 | Presence vocabulary; ambient default; roster = Meridian | §10(b) | ruled | — |
| 2 | Agents cannot mint approvals; decisions reachable outside chat | PORT-HANDBOOK Approval; §11(f) | partial | ask_user inbox built; restart-safe pause open (#1348) |
| 2 | No A2A loopback, no shared room; addressed posts are a proposal only | §7, §9, §10 non-changes; research proposal banner | ruled | — |
| 2 | Session history lives on the host's durable volume | AGENTS.md rule 9 | built | `BORING_AGENT_SESSION_ROOT` |
| 3 | View contract ships as a set; no lookalike descriptor | §8(c)(3); premises P4 | bead | `nc-v` |
| 3 | Agents never reason over renderer concepts (builders excepted inside candidates) | VISION invariant 4; §13(e) | ruled | — |
| 3 | Experiences compose independent choices; recipes not runtime modes | §11(f); §12(a) | ruled | — |
| 3 | Meridian is the flagship, not mandatory | §8(a) scope clause | partial | chrome slices L1/L1.5/L2a dispatchable; `workspace-shell` layout not built |
| 3 | No global chat column | §8(a) | ruled | — |
| 3 | Installed product in Library; opens a Thread in Work; one job = one Thread, many jobs allowed | DIRECTION 2026-09-07; §9a | bead | `nc-l` (needs `shell-ngfs.6`) |
| 3 | Generated UI isolated in a frame, reached via ViewRef | §11(e); §13(c) | bead | `nc-5` (resurrect PR #1499) |
| 4 | Host / product runtime / sandbox; runtime unit = installation | §13(b); D33 | bead | `nc-4a` |
| 4 | Modes embedded (default off, single-tenant) / local / remote; host policy | §13(c); D33 | bead | `nc-0`, `nc-4b` |
| 4 | Composition layers; typed preferences; fork is an escape path | §11(b) | ruled | — |
| 4 | Release manifest fields; dependency admission | §11(c) step 2; §13(d); review additions | bead | `nc-1` |
| 4 | Candidate → release only via a host op that verifies published bytes; bytes retained | §11(c) step 3; review additions | bead | `nc-p` |
| 4 | Installation: scope, bindings, grants, mode, generation; requirements resolution and consent | §13(d); review additions | bead | `nc-2` |
| 4 | Separate consumer = member with a personal-scope installation; same-workspace isolation | DIRECTION 2026-09-07 defaults; review additions | bead | `nc-2`, `nc-3` tests |
| 4 | Activation CAS against the generation vector of every affected scope; request-keyed; undo = activation | §11(c) step 4–5; §13(d) | bead | `nc-2` |
| 4 | Retirement stops runtime, revokes bindings, retains records and shared artifacts | review additions (§13(b) corollary) | bead | `nc-2`, `nc-3` uninstall |
| 4 | Standing authorization within change class and budget; default preview/keep; founder not the default approver | §13(d) | open | field on `nc-2`, no op |
| 4 | Change loop: builder proposes, host verifies and activates; protected checks outside the candidate | §11(c) | bead | `nc-6`, `nc-3` |
| 4 | Candidate privacy; digest/URL not a grant; revocation | §11(c) step 3 | open | — |
| 4 | Preview namespace isolation; no mutate/external effects in preview | LIFECYCLE release contract step 3; review additions | bead | `nc-6` |
| 4 | Mutation lanes | §11(d) | ruled | — |
| 4 | Three loops kept apart | §11(d) | ruled | — |
| 4 | Local intent recorded over semantic targets; three-way reconciliation | LIFECYCLE "Comparison, upgrades"; review additions | bead | `nc-o`, `nc-r` |
| 4 | Compatibility before activation; copy-on-write state; quarantine | §11(c); LIFECYCLE | bead | `nc-r` |
| 4 | Admitted work keeps its pinned release; drain on activation | §11(c) "already admitted work"; review additions | bead | `nc-4a`, `nc-r` |
| 4 | E0–E6 ladder; nc-7 = E1 + one bounded E5 case, not E5 | §11, §12(e)(f); plan.md | bead | `nc-7` |
| 4 | Schema migration execution | LIFECYCLE; review | open | follow-up bead when needed |
| 5 | Agent package = instructions, skills, knowledge, digest | #1107/#1202 lane; PORT-HANDBOOK Agent | partial | digest covers instructions + knowledge; authored capability refs rejected; install is boot-time (`AGENT_PACKAGES.md`) |
| 5 | Release pins agent definition digests | review of nc-6; §13 | bead | `nc-a` |
| 5 | Seats grant participation, not identity; additive specialist Seat | VISION inv 5; D32 | built | `workspace_agent_seats` (0026) |
| 5 | Deployment-static fleet; installed products a separate tier | D28; D33 | partial | fleet built; product tier bead `nc-1/2` |
| 5 | Builder = distinct class; authority boundary not tool omission; typed brief preferred | §13(e); review additions | bead | `nc-6`, `nc-x` |
| 5 | Multi-author transcript; orchestrator Seat; audit-grade seatId | §9b; §8(c)(2) | fixture | beads `shell-ngfs.14.1/.14.2` |
| 5 | Delegation host-mediated | V2 spec L3; §7 | partial | MCP delegate exists; kernel noun absent |
| 5 | Promote on evidence; no live self-rewriting; candidate without objective | VISION inv 10, 11; 2026-08-27 amendment | ruled | — |
| 6 | One gateway/funnel; host mints scope; actor∩installation∩job∩policy | D29; D33; §13(d) | partial | gateway built; product path `nc-3`, `nc-x` |
| 6 | ExecutionContext six questions; effect-classed capabilities; fail closed; intersection | PORT-HANDBOOK Supporting types, Capability | bead | `nc-x` |
| 6 | Bridge tokens: workspace-scoped, short-lived, refresh revocation only; installation/job/op/digest binding and live-call epochs open | WORKSPACE_BRIDGE_V1; ARCH-PLAN A8 | partial | `runtimeToken.ts`, `refreshTokenStore.ts` (in-memory revocation) |
| 6 | Model credentials per invocation; no raw key across boundary | ARCH-PLAN A7; D27 | bead | `nc-c`; BYOK persistence #1145 open |
| 6 | Sandbox leases; several per session; Firecracker floor | D31 + addenda | partial | providers built; sovereign fleet spike unmerged (#1081) |
| 6 | Spawned processes get an allowlisted environment | ARCH-PLAN A4 | open | all traced sites pass full env |
| 6 | Local runtime binds hardened profile (no egress, quotas) | review additions; D31 | bead | `nc-4b` |
| 6 | Untrusted tier via isolation + promotion; server code inside product runtime; P0.6 default-deny | D-b as superseded by §13(c); P0.6; D33 | bead | `nc-0`, `nc-4b`, `nc-5` |
| 6 | local floor accepted for first proof; microVM before shared tenants | DIRECTION 2026-09-07 defaults | ruled | — |
| 6 | Data sovereignty; control-plane publication | D31 | partial | design merged; M0 not confirmed shipped |
| 7 | State owned or connected; four meanings distinct | §12(b) | ruled | — |
| 7 | Learner data lifecycle; installation-bound; schema in compat | §11(b); §13; binding rule | bead | `nc-d` |
| 7 | Operations defined once, projected to entry points; agents propose | §12(c) | partial | WorkspaceBridge is a typed RPC registry with caller/capability checks; no effect class, no authorize/execute split, no projection — `nc-x`, `nc-3` |
| 7 | Provenance on every Run/outcome; evaluation fields where an evaluation ran; forks don't inherit | native-creation README; VISION 2026-08-27 amendment; §13 | bead | `nc-e` |
| 7 | Optimization loop optional | VISION 2026-08-27 amendment | ruled | — |
| 7 | Usage attributable to installation | #819 plan; review | bead | `nc-c` |
| 7 | Knowledge in packages or connected corpora | #1107 lane; §12(b), §12(e) | partial | package knowledge built; corpus adapters per consumer |
| 8 | Substrate platform-side; offers tenant-side | DIRECTION 2026-08-08 premises; §13(h) | ruled | — |
| 8 | Seneca first consumer; pulls by digest; deployment ownership unruled | §13(g); DIRECTION defaults | open | cross-repo delivery path |
| 8 | Execution home this repo; port demoted; lane 2 deferred | §13(f); DIRECTION 2026-09-07 | ruled | done |
| 8 | Factory: DoR beads, DIRECTION-only dispatch, gates at protected boundaries, curator never operates beads | factory VISION; `.agents/factory/README.md` | fixture | hub runs epics; Beadle/automatic admission not enabled; live driver answers gates itself |
| 8 | Honesty rules | AGENTS.md rule 8; §11(g) | ruled | — |

## Open obligations (no bead, no code)

| Obligation | Why it matters | Where it is named |
|---|---|---|
| Standing authorization op and enforcement | §13(d) default preview/keep needs the opt-in path to exist | ch. 4 |
| Candidate privacy and revocation on previews | a digest or URL must not be a grant | ch. 4 |
| Schema migration execution with backup and recovery | any compatible update that transforms data stops at declaration | ch. 4 |
| Environment allowlist at every spawn site (A4) | `local` runtime isolation depends on it | ch. 6 |
| Bridge token binding to installation/job/op/digest; live-call revocation epochs (A8) | revocation promises in §11(c) | ch. 6 |
| Founder-intervention metric source (Activity projection) | the epic's standing metric has no producer | ch. 1 |
| Cross-repo delivery to Seneca and deployment ownership | live acceptance on the tenant | ch. 8 |
| Thread timeline storage shape | engine storage decision | ch. 2 |
