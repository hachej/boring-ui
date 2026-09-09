# Pi 0.84.3 core-adoption spike — report

Bead: `wt-391-forward-9n6w`. Spike worktree: `.worktrees/spike-piv2-core`
(branch `spike/piv2-core-adoption`, not pushed). Probe package:
`spikes/piv2-core/` — standalone `package.json`, deps
`@earendil-works/pi-agent-core@0.84.3` and `@earendil-works/pi-coding-agent@0.84.3`
from npm; no product package touched. Probes run against the real installed
npm package. `pi-framework` clone used only for source reading, pinned to
npm's own `gitHead` for 0.84.3: `bfb004d4418ff05c6f909eaaab856cbe75c1fde0`
(2026-08-24), and to `origin/dev` (`5507d76`) for the provisional lane read.

**Headline finding that reframes the spike:** at 0.84.3, `AgentHarness`'s
entire *operational* surface — `prompt`, `resume`, `abort`, `steer`,
`followUp`, `nextRun`, `watch`, `watchSession`, `compact`, `navigateTree`,
`lane`, `createLane`, `lanes` — is a compile-complete scaffold that
unconditionally rejects with `HarnessNotImplemented`
(`node_modules/@earendil-works/pi-agent-core/src/harness/agent-harness.ts:355-505`,
verified against the installed package, matches CHANGELOG 0.84.0's own
words). Only config getters/setters and `getLeafId`/`close` work. Only the
**storage** layer (`Session`/`JsonlSessionRepo`/`InMemorySessionRepo`) is
real, running code at 0.84.3. The runtime that drives prompts, resumes, and
lanes exists only on `origin/dev`, unpublished.

## Per-probe verdicts

| # | Probe | Verdict |
|---|---|---|
| 1 | V3 import | **FAILED** — v3-import (`legacy-v3.ts`) is `dev`-only, absent from published 0.84.3 |
| 2 | Restart/resume | **PARTIAL** — storage durability PROVEN; harness `resume()` UNVERIFIABLE (stub, not cost) |
| 3 | DTO mapping | **DONE (paper)** — table below, several gaps named |
| 4 | Host-volume identity | **PROVEN** — `sessionsRoot` fully caller-configurable |
| 5 | Ledger reconciliation | **DESIGN PROPOSAL** — protocol below, not run against live code |
| 6 | Lanes (dev-pin) | (a) YES pre-answered · (b) PARTIAL · (c) not re-verified · **POSTS-ONLY: FAILS** |
| 7 | Keep vs delegate | **DONE (paper)** — ~0 of ~1,704 lines deletable at 0.84.3; ≤1 of 4 Level-D cases ever |

---

## Probe 1 — V3 IMPORT: FAILED

`spikes/piv2-core/probes/01-v3-import.ts`, run live. Used a real 0.80.7-era
transcript from `~/.pi/agent/sessions/` — header
`{"type":"session","version":3,...}`, confirmed coding-agent legacy format.

`harness.md` Appendix B describes exactly the import contract the bead
pre-answered as existing (`legacy-v3.ts`, atomic first-write conversion, id
re-minting). That file is real — 539 lines on `pi-framework` `origin/dev`,
commits 2026-08-19..2026-08-24 — but **absent from what npm published as
0.84.3**: `git ls-tree -r bfb004d...` (the npm `gitHead`) lists
`codec.ts`/`errors.ts`/`repo.ts`/`storage.ts`/`types.ts` under
`harness/session/jsonl/` — no `legacy-v3.ts`, no reference to "v3" or
"legacy" anywhere in those files. The installed `node_modules` tree confirms
the same. The v4 header codec expects `{kind:"header",version:4,...}`, so a
v3 file is simply unrecognized, not normalized.

Type surface anticipates v3 (`JsonlSessionMetadata.sourceFormat: 3 | 4`,
`legacyParentSessionPath?`) — scaffolded ahead of implementation, same
pattern as probe 2's harness stubs. **"Open unchanged" / atomic-convert /
rollback cannot be demonstrated at 0.84.3 — the feature doesn't exist yet.**

---

## Probe 2 — RESTART/RESUME: PARTIAL

`spikes/piv2-core/probes/02-restart-resume.ts`, run live. No live model
calls needed or used (keys exhausted; turned out to be a capability blocker,
not a cost one).

**Part A — storage durability: PROVEN.** Created a session via
`JsonlSessionRepo`, appended a message, recorded the leaf id, then simulated
a process kill (discarded all in-memory state, built a fresh
`NodeExecutionEnv`+`JsonlSessionRepo` at the same `sessionsRoot`). Reopen
reproduced the identical leaf id and the exact entry, zero loss.

**Part B — harness resume: UNVERIFIABLE.** `AgentHarness.resume()`
(`agent-harness.ts:380-382`) is `return this.unavailable("resume")`,
unconditionally rejecting `HarnessNotImplemented`/`HarnessClosed` — same for
every operational method (see headline finding). No scripted-model path
exists to probe here because the capability itself is absent, not gated by
model cost. On `dev`, `harness/runtime/{harness,lane}.ts` do implement
`prompt`/`resume`/`lane`/`lanes` for real (source-read only, not run, per
the bead's dev-is-read-only framing). **Owner constraint #6 (ask-user
pending → restart → reattach → answer routable) is not falsifiable at
0.84.3.**

---

## Probe 3 — DTO MAPPING (paper)

Gateway: `packages/agent/docs/AGENT_GATEWAY_V0.md` +
`packages/agent/src/shared/gateway/types.ts`. Pi side: `Session`/
`SessionStorage` types — the only *running* surface at 0.84.3.

| Gateway method/DTO | Pi v4 source (0.84.3, storage only) | Gap |
|---|---|---|
| `listAgents` | none | Full gap — agent-type catalog is Boring's |
| `listSessions`→`AgentSessionPage` | `JsonlSessionRepo.list()` | No cursor/keyset pagination, no scope filter in pi |
| `createSession`→`AgentSessionRef` | `JsonlSessionRepo.create()` | No `{agentTypeId,sessionId}` shape; `AuthorizedAgentScope` has zero pi equivalent |
| `connectSession`→`AgentSessionConnection` | `Session.watchSession()` (STUB) | Even on `dev`, `WatchHandle<SessionSnapshot>` ≠ replay-with-cursor semantics |
| `readSessionState`→`JsonSafe<PiChatSnapshot>` | `getMetadata()`+`findEntries()`+`getStats()` | No single snapshot DTO in pi; assembled by hand |
| `renameSession`/`deleteSession` | `Session.setName()`/`JsonlSessionRepo.delete()` | Clean 1:1 |
| `AgentSessionActivity` | none (would be `dev`'s `LaneInfo.operation`) | Full gap today |
| Receipts (`CommandReceipt` etc.) | none — pi has intents/records, not client receipts | Full gap, confirms "orthogonal" from prior analysis |
| 14 gateway error codes | `HarnessBusy/Closed/NotImplemented`, `LaneBusy/Exists`, `SessionError` | No 1:1; auth/scope/idempotency codes have no pi source |

**Bottom line:** nothing to map operationally today (that layer doesn't
run); storage-level rename/delete/getMetadata map cleanly; auth, pagination
cursors, receipts, and activity stay Boring's regardless of pi adoption.

---

## Probe 4 — HOST-VOLUME IDENTITY: PROVEN

From probe 2's run: `JsonlSessionRepoOptions.sessionsRoot` is a required
constructor arg; the probe pointed it at an arbitrary tmp dir and pi wrote
there only. **Session storage root is fully caller-controlled**, no default
inside the harness path (default `~/.pi/agent/sessions` applies only to the
unrelated coding-agent CLI, never observed on this path).

Naming: `<sessionsRoot>/--<cwd-with-slashes-as-dashes>--/<timestamp>_<uuid>.jsonl`
(observed directly) — **cwd-scoped, not workspace-id-scoped**. Workspace
naming is possible by construction (point `sessionsRoot` per workspace, or
synthesize a `cwd`) but is entirely Boring's to impose. Satisfies hard rule
9 / `BORING_AGENT_SESSION_ROOT` with zero pi code changes.

---

## Probe 5 — LEDGER RECONCILIATION (design proposal, not run)

pi's invariant: one process owns one session — SQLite via a fenced
`writer_lease(owner_id, fence, expires_at_ms)` (two documented unfixed
races, their unwritten WP07); JSONL via *no* enforcement ("a JSONL session
opened twice is corrupt and undetected").

**Proposed protocol**, pi strictly as a private backend under D29:

1. **Single writer = Boring's gateway process, always.** Pi's `Session` is
   opened and driven only from inside the session-owning gateway process,
   never a second process concurrently. This satisfies pi's own
   single-writer assumption by construction, sidestepping both WP07's races
   (which are races between *pi's own* competing writers) and JSONL's
   undetected double-open.
2. **Boring's request ledger is the outer transaction; pi's session commit
   is the inner one.** A client command is admitted into Boring's ledger
   first (unchanged from today); only then does the gateway drive pi's
   `appendMessage`/`appendRecord`. Crash between the two: replay the ledger
   on restart, reopen pi, check `getLog({fromSeq})`/`getLeafId()` for
   evidence the write landed.
3. **Winners by conflict class:** ledger admitted + no pi entry → pi's store
   wins "did it happen" (not yet applied; replay from ledger's stored
   intent). Pi entry with no ledger admission (only reachable if rule 1 is
   violated) → **ledger wins**, orphan flagged and excluded from replay,
   corrective annotation appended (nothing deleted — pi's append-only
   invariant preserved). Both agree → resume normally. Mid-migration crash →
   pi's own chained-migration transactionality (`harness.md` §7.3) handles
   it, no gateway action needed.
4. **Repair on restart:** open pi's session (re-proves single-writer
   ownership) → diff ledger's last-admitted command against pi's leaf/log →
   apply the conflict rule → resume serving. Required regardless of pi
   adoption (Level D's admission/effect crash matrix, probe 7); adoption
   only changes what the inner commit targets.

---

## Probe 6 — LANES (dev-pin, provisional)

`spikes/piv2-core/probes/06-lanes.ts`, run live against the **published
0.84.3 storage layer** (the only lane mechanism that runs — the harness
runtime lane surface is stubbed, probe 2).

**(a)** pre-answered YES, not re-litigated.

**(b) seatId binding — PARTIAL.** `Session.createLane(lane: string, at:
string|null)` takes a bare string name; no object, ACL, or owner field. Our
`seatId` can be used *as* the lane name; pi contributes no identity
machinery beyond that string. Confirms the bead's prior read empirically.

**(c) lane→presentation routing — not re-verified.** No presentation/mini
code ships in the published packages this probe depends on; carried over
from the prior source-read in `pi-v2-alignment.md`.

**POSTS-ONLY PRIVACY TEST — FAILS.** Created a session, two lanes
(`seat-alpha`, `seat-beta`) forked from a shared root entry, appended
`SEAT-ALPHA-PRIVATE-SECRET-42` to `seat-alpha`'s view, then called
`session.findEntries()` with **no lane argument**. Both the shared root
entry and seat-alpha's "private" entry came back (verbatim from the run):
`id=... type=message content="SEAT-ALPHA-PRIVATE-SECRET-42"` alongside the
shared-context entry.

Lane scoping in pi's entry-tree/JSONL model is a **view-time filter**
(`session.view(lane)`, `findEntriesOnBranch`), not a storage-level access
boundary. Any caller holding a plain `Session` handle — which is what the
gateway backend process holds — reads every lane by construction. **Per
owner constraint #5: the lanes candidate plainly FAILS the posts-only
boundary.** Isolation would have to live entirely above pi, exactly as
Boring does today; pi lanes buy attribution naming convenience, not privacy
enforcement.

---

## Probe 7 — KEEP VS DELEGATE

Skimmed `packages/agent/src/server/events/eventStreamStore.ts` (412 lines,
`SqliteEventStreamStore`, offset/cursor pagination) and
`.../agent-host/testing/gatewayConformance.ts` (631 lines). The four named
Level-D cases, verbatim, all `it.skip(...)` (`:624-629`): (1) restart
preserves sequence continuity, (2) durable request ledger replays receipts
and creates tombstones, (3) durable admission/effect crash matrix, (4)
durable activity index reconciles non-quiescent states at start.

Against what runs at 0.84.3, **zero** are replaceable (nothing operational
to delegate to). Re-scoped against `dev`'s real runtime, the alignment doc's
original verdict still stands as the best available answer: **#1** is
candidate-replaceable — pi's `getLog({fromSeq})`/monotonic `seq` is
structurally similar to `eventStreamStore.ts`'s offset/cursor design, not
independently load-tested here. **#2/#3/#4 stay Boring's** — receipts,
admission, and activity-state are Boring gateway concepts with no pi source
(probe 3).

**Sizing:** of the ~1,704-line bespoke surface, at most the
sequence-continuity slice is ever deletable, and only once pi's runtime (not
just storage) ships publicly. **At pinned 0.84.3 the number is ~0 of
~1,704 lines** — more conservative than the alignment doc's framing implied
before this version-precision check.

---

## Recommendation (spike-scoped; not a DIRECTION change)

1. **Do not wire pi 0.84.3 under D29 now.** The operational harness that
   would sit behind the gateway doesn't exist in the published package.
2. **P1a's four Level-D cases stay entirely Boring's**, unblocked by this
   spike — none satisfied today; at most sequence-continuity is a future
   delegate, contingent on pi publishing its `dev` runtime.
3. **Lanes-as-seats fails the posts-only privacy boundary** as shipped — any
   future pursuit needs Boring-owned store-level isolation regardless.
4. **Re-run this spike against the next release** that ships `dev`'s
   Session/Branch/AgentLane separation and working
   `harness/runtime/{harness,lane}.ts` — probes 2, 3, 6(b)/(c), and 7's
   sequence-continuity claim become re-testable with running code then.
5. `docs/plans/durable-streams-plan.md` (draft r2) shares this spike's
   credentials blocker; no probe here ended up needing a live model, but a
   fuller `dev`-pinned conformance run would.

**Out of scope:** facet/RPC-layer assessment (design-input upstream); Probe
6(c) not independently re-verified. BYOK/model-authority (constraint #4): no
conflict found but no meaningful surface to test —
`getModel`/`setModel` at 0.84.3 are plain in-memory getters/setters, no
credential resolution attached.
