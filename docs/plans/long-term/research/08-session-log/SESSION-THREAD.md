# The W33 Session Thread — full narrative

Session 2f6c6143, 2026-08-10 → 2026-08-19. One continuous thread (with
compactions) that produced everything in this research tree. Written so a
reader can follow not just what was concluded, but how each conclusion was
forced — including the reversals.

## Phase 1 — celld & Flue (08-10 → 08-11)

Started from one question: is celld (Deno's self-hosted Durable Objects) "the
ultimate solution" for an agent cloud? Answer after scouting + spike: **no —
copy the pattern, defer the dependency.** celld is deployment-static (no
multi-tenant placement), its durability is inseparable from moving the brain
into an isolate, `process.env` arrives empty, and cold start measured 435ms vs
the advertised ~4ms. Flue (withastro; built on OUR pi harness) proved the more
important thing: **pi runs fine on host-supplied storage** — Flue injects its
own record writer and pi keeps only an in-memory array. `spike-flue-celld`
deployed Flue on celld with a working AgentGateway→Flue shim driving the real
ChatPanel; `spike-pi-storage` reproduced the storage seam on our pinned 0.80.7
(two PIDs, one host-owned JSONL). First big lesson: our "three sources of
truth" reconciliation (`Math.max(persisted.seq, liveSeq)`) exists only because
the record was never the single owner.

## Phase 2 — the research cycle (08-11 → 08-13)

9+ codex (gpt-5.6-sol xhigh) workers mined Flue, eve, opencode, Anthropic
Managed Agents, and 7 more frameworks (~28k lines of reports). The owner
ratified breaking changes ("just move forward"). Spikes accumulated:
durable-pause (SIGKILL survival), migration (4,229-line transcript
round-trip), wire changes (opaque cursors break the current front — 12 files
to fix), l0-schema (**refuted twice** — and its 17 green tests survived
deleting the constraints they tested: the mutation-testing lesson),
tool-catalog (**refuted #1226's own premise**: pi emits `toolName:"call_tool"`,
wire identity lost; but measured summary-exposure at −72% bytes).
Recommendations were reorganized owner-style: **1 reco = 1 folder =
claim + research + spike**, after the owner caught the register being
under-mined ~5× ("this is suspicious, why such compression??" — ~250 candidate
findings still unextracted; that became blocking pre-phase P-1).

## Phase 3 — DeepSeek scout & the seam question (08-14)

DeepSeek Harness v0.1 shipped ("everything is a plugin", vendored Cordis) —
the first competitor at OUR layer, not pi's. Its review rules indicted us
precisely: "capability seams ship Owner+Impl+Consumer together" (we had
mechanism-built-never-wired FIVE times: collision policy, credential vault,
D27 BYOK, and more), "model-visible means logged" (third independent
derivation), "runtime invariants over static checks" (our scope brand emits no
runtime value). Owner asked "are we at par with everything-is-a-plugin?" —
census answer: **we have the seams; none is selectable at composition time.**
"We build the seam, then hard-wire past it." Two of my claims were corrected
by the census itself (sandbox HAS a registry; MCP grants ARE wired) — the
corrections were recorded in place. PR #1256 review followed: the reviewer
rejected my env-field and NODE_ENV-enforcement proposals with arguments I
accepted (my enforcement proposal violated my own authority rule).

## Phase 4 — authority vs mechanism (08-14)

Owner's crux: "authority is a security problem; everything-as-a-plugin is a
tech capacity — navigate this." The navigation became R-33-15's test: *can
this unit widen what the agent may do?* Yes → singular, host-owned. No →
pluggable. The refutation attack ("could a swappable loop defeat approval?")
half-fired in the most instructive way: there IS no approval gate to defeat
(the front's approval states are dead code, zero producers), a loop CANNOT
widen capability (tools are handed in pre-attenuated) — but a loop CAN elide
records (single writer, harness-fed, store optional). That forced the
record/envelope split: the loop is mechanism only once the host owns an
envelope it doesn't rely on the agent's record for.

## Phase 5 — the deep audit (08-14 → 08-15)

Four parallel Sonnet censuses: workspace contents (~30% of 93k LOC is neither
composition nor view), agent standalone-readiness (zero runtime reverse
imports; `shared` leaf-clean; standalone bin runs but is E2E-grade), env/exec
(~15 spawn sites, zero filtering, exec wire vocabulary already exists), and
security (four scope verifiers exist — correcting my earlier "none found";
CLI hub mints scope from a self-asserted header; approval states confirmed
dead). Synthesis → ARCHITECTURE-PLAN. Then the owner demanded the full
adversarial loop: **Sol pass 1 found 11 plan-breaking issues** (including that
I'd claimed PR #1256 "landed" while it was open, and that A2 was the cost
bomb); the **transcript-recall pass found 29 forgotten learnings** (three
owner-ratified designs had vanished: the third-party plugin trust model, the
UI/runtime addendum, VFS-first; the shard is per-SESSION not per-agent;
F-33-G15 was VERIFIED not "reported"); **pass 2: NOT CONVERGED** (canonical
rewrite demanded); **pass 3: four mechanical edits** (including a real
rollback bug — dual-read without dual-write loses post-cutover writes);
edits applied and grep-verified. Convergence was geometric: 11 → 5 → 4 → 0.

## Phase 6 — ratification & the product stack (08-16)

Owner ratified with rulings: two standalone shapes as an additive ladder
(bare agent stays agent-package-internal); Track B demoted to a ratchet;
**RunId := RequestKey** (branded projection, never a second UUID); B2 split by
semantic ownership ("can boring-agent execute this without knowing a Workspace
UI?"); seatId P0-required, AgentRef opportunistic; fifth invariant added
(**a Seat grants participation, not identity**); AgentState reserved-empty;
**freeze** — next input is implementation. Then the product documents arrived
from parallel threads: the agent-native direction doc (reconciled — the
runId/requestKey identity was independently derived, seats = C7 catalog rows)
and the Sovereign Recursive Optimization Platform doc (12-noun kernel; merged
into VISION — 9 of 12 nouns mapped to built/scheduled machinery; the genuinely
new layer is Objective/Candidate/Evaluation/Outcome). Owner ruled **new repo,
interface-first, port the mechanisms** (overruling my in-place recommendation
— my fork concerns became the six-point port protocol instead). The full spec
went through: runtime-only M0-M3 → owner demanded full product → 7-layer
spec, M0-M8 → owner questioned `packages/` → single package, folders +
dependency-cruiser, extraction on publish pressure.

## Phase 7 — Part 1 review & consolidation (08-17 → 08-19)

The owner's meta plan (Part 1, three-LLM hybrid, 4,700 lines) was reviewed
against everything above: **no structural error found** — third independent
convergence on the same invariants. Nine enhancements filed with diffs, led by
E1 (payer binding at admission — the only one backed by a live verified
defect) and one adoption flowing back (their 5-class effect taxonomy beats our
4). Provenance split: 3 enhancements purely from our audits/spikes, 2 purely
from scouts, 4 from the join — the value concentrated where a verified defect
in our code met a proven mechanism in someone else's. Everything was then
committed to `docs/long-term-plan-pack` (PR #1317) as this research tree, the
cross-product synthesis was written (5 invariants, X1-X13), and the spike
working trees were archived-then-removed.

## The reversals (kept deliberately)

Wrong and corrected in-thread: "pi can't run in an isolate" · "sandbox has no
registry" · "MCP grants unwired" · "no scope verifier implementations" ·
"PR #1256 landed" · "3,700 lines of reconciliation" (arithmetic) · "OTel
redacted by default" (reversed — captures content) · my NODE_ENV enforcement
proposal (violated my own rule) · my isolation/ergonomics taxonomy (hid
security weight) · per-agent WAL (recreates contention) · "R3 repairs the
tool-catalog refutation" (audit yes, authorization no) · packages/-by-default
in v2 · R-a in-place recommendation (owner overruled with better arguments).
Two spikes refuted their own recommendations (l0-schema ×2, tool-catalog).
The method held because the reversals were cheap and recorded.

## What it all reduces to

One system, three altitudes, five invariants, thirteen cross-product
recommendations, a frozen plan with a DAG, a full-product spec, and a port
protocol — plus the two open debts named honestly: the P-1 register
re-extraction and the re-verification of file:line grounding against current
main before execution. The next unit of information is a paying user's second
completed cycle.
