Line references below are to the [architecture plan](/tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/2f6c6143-73be-4a87-886b-e8dd7fb126e0/scratchpad/docs-research/ARCHITECTURE-PLAN.md:1), [pass-1 review](/tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/2f6c6143-73be-4a87-886b-e8dd7fb126e0/scratchpad/sol-adversarial.md:1), and [recall report](/tmp/claude-1000/-home-ubuntu-projects-boring-ui-v2/2f6c6143-73be-4a87-886b-e8dd7fb126e0/scratchpad/sol-recall.md:1).

### Pass-1 discharge table

| # | Pass-1 plan breaker | Disposition | Evidence |
|---|---|---|---|
| 1 | R3 cannot reconstruct current state | **DISCHARGED** | L393 adds missing record events; L452–459 narrows recovery to safe checkpoints and explicit `unknown-outcome`, withdrawing the invalid equality premise. |
| 2 | A2 conflates transcript and event stores | **PARTIALLY** | L394 separates A2a/A2c and requires dual-read/rollback, but “cursors/idempotency move to envelope or die” leaves cutover, dual-write, quiescence, and authoritative compatibility behavior undecided. |
| 3 | Distributed commit between ledger and record | **PARTIALLY** | L395/L428–429 put C6 before C4; L452–459 defines recovery semantics, but no concrete admission/ACK/deduplication/reconciliation protocol makes exactly-once terminal recording achievable across the split. |
| 4 | Untrusted agent becomes ownership oracle | **PARTIALLY** | L396 introduces C7, but “signed or ledger-derived” remains an unresolved authority design; L450 then calls C7 a derived read model, and the graph has no C7→C4 edge. |
| 5 | Track B creates package cycles | **PARTIALLY** | L397/L426 correctly put B1+B3 before B4, but omit pass-1’s A1/B2 prerequisites and never explain how B1 first sheds its Agent/Workspace-private contract imports. |
| 6 | Plugin-host role is unassigned | **DODGED** | L398 creates a task to “name” the host “in workspace-as-composer or its own process”; that preserves the original unresolved ownership choice rather than deciding it. |
| 7 | Arbitrary plugin RCE is not retired | **PARTIALLY** | L399 adds immediate default-deny and L485–491 defines an isolated tier, but agent-writable-root refusal, existing-plugin migration, compatibility, and the B7/C4 final-removal join remain unspecified. |
| 8 | No deployment topology for relocated records | **DODGED** | No §10 disposition addresses it; §11 adds placement metadata and compatibility manifests but still omits volumes, routing/discovery, backup/restore, staged coexistence, GC, and tenant-repository rollout. |
| 9 | Release/CI topology absent | **DISCHARGED** | L401 creates an A0/B0 release gate covering tooling, major sequencing, and peer ranges; L525 adds persisted/config compatibility manifests. |
| 10 | C1 precedes required authority/protocol | **DISCHARGED** | L400 and L428–429 place C3/C5/C6 before C1 and require merging or explicitly deprecating the legacy exec protocol. |
| 11 | A3 product grounding/cost is false | **PARTIALLY** | L407–408 admits real packaging work, while L461–467/L529 add A7 and first-run constraints; storage configuration, upgrades, asset distribution, and production distribution tests remain absent. |

### Internal contradictions

New v3 contradictions with unedited §§1–9:

- **Provenance:** L3 says every claim was file:line verified; L441–442 retracts that and requires per-claim provenance.
- **Convergence:** L191–197 and L226 claim complete recommendation/learning convergence; L512–515 says roughly 250 candidates remain and makes re-extraction a blocking pre-phase.
- **Durability shard:** L16, L117, L167, L207, and L222 repeatedly specify a physical per-agent record; L446–450 changes the physical unit to per-session.
- **Backend choice:** L214 says A2 eliminates persistence-backend choice; L416 and L536 say the backend remains a trusted composition seam. This does not reopen the rejected finding—the stale sentence simply needs replacement.
- **Recovery semantics:** L240–266 and L331–334 require general kill-9 equality and full replay recovery; L452–459 limits equality to safe checkpoints and requires `unknown-outcome`.
- **Tool-catalog conclusion:** L272–300 says R3 repairs catalog dispatch through post-hoc identity logging; L469–474 says that was half-wrong and requires pre-call authorization, immutable plans, and first-class child events.
- **D27 ownership:** L144 says D27 lands in C3; L461–467 removes it from transport scope and assigns it to A7.
- **Collision work:** L109 says one line on `collisionPolicy` fixes collisions; L476–483 says that code is off the production path and replaces it with a three-stage runtime-path change.
- **Credential vault:** L109 permits deleting it; L516–518 requires wiring it into A7 or explicitly replacing it.
- **R-33-12:** L212 marks it absorbed; L476–483 explicitly says it was not absorbed and creates a new deliverable.
- **Authored executable selection:** L165–166 prohibits it universally; L485–491 permits it in the isolated, explicitly promoted untrusted tier.
- **Competitive/security claim:** L174–179 retains the “ahead” and “paid-tier-only” thesis; L501–505 says those claims were withdrawn.
- **Environment coverage:** L69/L119 claim zero filtering and enforcement at all spawn sites; L531 downgrades this to all traced sites.
- **Track independence:** L93 says tracks are independently shippable; L532 withdraws that claim.
- **P0 scope:** L102 calls P0 “days, no design”; v3 places the mount-namespace design in P0.4 and calls the critical A7 implementation “P0-adjacent.”

Still-stale v2 corrections:

- L50/L176/L214 say the sandbox registry landed or is frozen; L374–376 says PR #1256 was still open.
- L33–35 gives the wrong ledger key; L384–387 corrects it.
- L136 says B4 is first, pure, and zero risk; L397 withdraws that.
- L147–149 says C4 alone retires the RCE class; L399 says it does not.
- L350–354 calls A3 cheap once literals are fixed; L407–408 retracts that estimate.

### Dependency ordering and remaining blockers

The v2/v3 ordering is not coherent:

- **A7:** absent from the supposedly canonical §10 graph; “P0-adjacent” is not an edge. At minimum, A7→A3 is required, and model-invoking remote/plugin paths need an explicit A7 gate.
- **C7:** stated as a C4 prerequisite, but its graph branch dead-ends. The plan must select the authoritative source/signing design, distinguish it from its derived read model, and draw C7→C4.
- **B7:** bundled with B1 despite its ownership still being undecided. “Full removal with B7/C4” has no B7→C4 join.
- The blocking register/evidence pre-phase, A1/B2 prerequisites for B extraction, and verifier/revocation→D-1 ordering are also absent from the canonical graph.

Remaining plan breakers are the undefined A2c cutover, undefined C6 cross-host commit protocol, unresolved C7/B7 authority ownership, missing C4 deployment topology, and the graph’s omission of v3 gates.

**NOT CONVERGED — minimally: rewrite §§1–9 into one canonical v3 text; replace the graph with a complete item-level DAG including the blocking pre-phase and A7/C7/B7 joins; specify A2c migration/cutover and C6 commit/reconciliation protocols; decide C7/B7 ownership; and add C4 deployment plus A3 production acceptance criteria.**