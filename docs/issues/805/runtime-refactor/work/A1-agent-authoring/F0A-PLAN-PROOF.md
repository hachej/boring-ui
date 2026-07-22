# F0a Decision-28 authority and Bead-reset proof

Date: 2026-07-21  
Epic: `wt-391-forward-step1a-current-xn9`  
Planning branch: `plan/391-agent-fleet-realignment`

## Result

Decision 28, the #391 product plan, and the #805 normative fleet/Environment
plan converge on the owner-approved architecture, including the later native
named-Environment simplification. The old Decision-26 R1–R6 and
C1–C4 open descendants are deferred and non-dispatchable. Closed R0/R4 evidence
remains closed and related to the refreshed F0b inventory.

The replacement graph contains 21 active ordered nodes plus one deferred,
conditional Human Intention:

```text
F0a → F0b → F1a → F1b
                    ├→ F2a → F2b-i → F2b-ii ─┐
                    └→ F3a ─┬→ F4a ──────────┤
                             └→ F4b ──────────┤
                              └────────────────┴→ F3b-i → F3b-ii
                                                         ├→ F5a → F5b ─┐
                                                         └→ F6 ────────┤
                                                                       ▼
                                          F7 → H2c → F2c → F8a → H8 → F8b
```

`H4a` (`.26`) is deferred and related to F4a. It becomes an active blocker only
if the #844 audit finds semantic non-default `workspaceTypeId` data.

## Replacement Beads

| Symbol | Bead | State at F0a |
| --- | --- | --- |
| F0a | `wt-391-forward-step1a-current-xn9.5` | `in_progress` until this plan PR merges |
| F0b | `.6` | blocked by F0a |
| F1a / F1b | `.7` / `.8` | blocked |
| F2a / F2b-i / F2b-ii | `.9` / `.10` / `.11` | blocked |
| F3a | `.12` | blocked |
| F4a / F4b | `.13` / `.14` | blocked |
| F3b-i / F3b-ii | `.15` / `.16` | blocked |
| F5a / F5b | `.17` / `.18` | blocked |
| F6 / F7 | `.19` / `.20` | blocked |
| H2c / F2c | `.21` / `.22` | blocked Human gate then contraction |
| F8a / H8 / F8b | `.23` / `.24` / `.25` | blocked qualification, Human gate, publication |
| conditional H4a | `.26` | deferred/non-blocking unless audit triggers |

Every replacement Bead repeats Decision-28 invariants and includes exact scope,
`## Acceptance Criteria`, proof artifact, named review, rollback, and the rule to
remain `in_progress` until its implementation PR merges.

## PR #845 disposition ledger

Reviewed URL: <https://github.com/hachej/boring-ui/pull/845>  
Base: `main` at `a553c17aefde1b9a540dc140c2ea04f79135628a`  
Head: `e6bd0e7239eea85ed8ce867c7326a28fc2531fec`  
Observed at F0a: open, mergeable/clean, labeled `ready-for-agent`, but explicitly
not semantically mergeable under Decision 28.

No file is cherry-picked wholesale. F5a/F5b recreate approved behavior from the
then-current merged main.

| #845 file | Decision-28 disposition |
| --- | --- |
| `.beads/issues.jsonl` | Discard old C1 authority/tracker delta; this F-series recut replaces it. |
| `docs/issues/391/plan.md` | Discard typed-product additions; replaced by Decision-28 product plan. |
| `packages/core/SIZE.md` | Recompute from F5a/F5b output; do not transplant. |
| `packages/core/docs/README.md` | Rewrite for signup-only default initialization and shared auth; discard Workspace-type API mode. |
| `packages/core/package.json` | Re-add only dependencies proven necessary by recreated host/cookie validation. |
| `packages/core/src/app/server/__tests__/createCoreWorkspaceAgentServer.test.ts` | Recreate only peer-consumer composition/no-CLI and valid host-root tests; discard type-policy graph tests. |
| `packages/core/src/app/server/createCoreWorkspaceAgentServer.ts` | Discard Workspace-type composition; F5a composes Core as an independent Workspace consumer. |
| `packages/core/src/app/server/index.ts` | Re-export only final F5a/F5b supported adapters. |
| `packages/core/src/server/__tests__/productDeclarations.test.ts` | Discard typed product declarations; recreate exact hostname-to-initial-Agent validation in F5a/F5b. |
| `packages/core/src/server/app/__tests__/productDeclarations.integration.test.ts` | Discard type-routing integration; recreate signup initializer plus auth-host integration. |
| `packages/core/src/server/app/createCoreApp.ts` | Recreate only bounded host/shared-auth wiring; no typed product mode. |
| `packages/core/src/server/app/types.ts` | Discard typed-product/API-mode fields; add only Decision-28 consumer-root ports. |
| `packages/core/src/server/auth/__tests__/createAuth.test.ts` | Recreate shared sibling cookie, exact Origin/CSRF/logout and hostile-host coverage in F5b. |
| `packages/core/src/server/auth/__tests__/postSignupHook.requestScope.test.ts` | Discard request-scoped Workspace type; replace with pre-auth reserved signup intent crash matrix in F5a. |
| `packages/core/src/server/auth/createAuth.ts` | Recreate PSL-safe cookie/origin/logout behavior in F5b; no domain authorization or type selection. |
| `packages/core/src/server/auth/postSignupHook.ts` | Replace with F5a reserve→user bind→atomic Workspace/member/default→retire flow. |
| `packages/core/src/server/index.ts` | Re-export only final recreated host/auth/signup surfaces. |
| `packages/core/src/server/productDeclarations.ts` | Do not retain product/type registry. Recreate a narrow trusted exact-host→initial-Agent mapping at the Core composition edge. |
| `packages/core/src/server/routes/__tests__/workspaces.test.ts` | Discard type-filtered portfolio assertions; retain ordinary membership and add no-domain-filter negatives. |
| `packages/core/src/server/routes/workspaces.ts` | Discard type-filtering/routing; ordinary membership remains sole authority. |
| `packages/core/src/shared/errors.ts` | Reuse stable shared-auth/host configuration concepts where still exact; discard typed-mode/type-policy errors. |
| `pnpm-lock.yaml` | Regenerate from current main after approved dependency changes. |
| `scripts/c1-shared-auth-browser-proof.mjs` | Recreate as F5b browser proof with guaranteed browser/row/DB cleanup; no typed Workspace assertions. |

F5b closes/supersedes #845 only after recreated current-main proof passes and the
GitHub comment links this ledger and the replacement PR(s).

## Review convergence

| Round | Reviewer/verdict | Material findings | Resolution |
| --- | --- | --- | --- |
| Fable R1 | not ready | provider canonical-data and physical-enforcement honesty; Agent API edge; lifecycle/session/default gaps | Added logical resolver, provider eligibility, no-copy rules, dedicated application entrypoint, generation/session/lifecycle contracts. |
| Fable R2 | ready after two P1s | terminal compatibility contraction owner; distinguish CLI local conflict check from rejected publication CAS | Added F2c and explicit CLI wording; later moved contraction before release-candidate proof. |
| Round 3 oracle | not ready | F7 lacked real internal second-Agent path; model issuer owner; signup first crash; nullable rollback; CLI initializer; authority/table gaps | Added F3b-ii conformance seam, consumer issuers, pre-auth intent reserve, writer fence, initializer rule, repaired authority and per-node table. |
| Round 3 spec | revise | stale decision annotations/archive/proof, broken link, unsafe constraint wording, per-slice proof/rollback gaps | Updated Decisions 19/21/22/23/25/27, historical banners and proof index; fixed links; forbade NOT NULL; added exact acceptance matrix. |
| Round 3 thermo | ready after localized P1s | F4 breadth and hosted network enforcement honesty | Split F4a/F4b and F2b-i/F2b-ii; added physical/advisory/unsupported network matrix and negatives. |
| Round 4 oracle | not ready on two P1s | Decision-27 issuer matrix absent from F5a row; F4a writer activation ambiguous | Added all five hosted-key cases and made writer dark until a stored-default-aware serving/rollback cohort. |
| Fable R3 pre-simplification | **READY** | No P0/P1. Verified authority, graph edges, historical state, gates, and representative Beads. | Established the correct fleet/default/consumer graph before the later Environment simplification. |
| Code-grounded Fable unknown-unknown review | direction right; simplify | Workspace risked a god runtime; Agent needed streaming/control; session ownership blurred Pi mechanics; Environment lease/grant/reuse/secret abstractions were premature | Split Workspace internally; specified streaming/control; retained Pi session runtime; removed speculative Environment machinery. |
| Owner abstraction review | approved simpler native model | Existing Pi tools should consume Environment directly; backend reuse optional; command credentials/watch/concurrency stay current; greenfield final state required | Locked native named Environments, direct tools, per-open v1, no broker/journal/transactions, and F2c deletion. |
| Flue/Eve source comparison | supporting evidence | Flue exposes a native session environment to tools and hides provider lifecycle; Eve separates Agent-facing sandbox session from internal backend handle and uses one namespace | Adopted operations-only Agent Environment plus Workspace-runner cleanup and one root/name. |
| Simplified-bundle Fable | **ACCEPT WITH CHANGES** | Preserve trusted-only service reachability; separate pure identity from cancellation; physically confine exec; keep lifecycle outside Agent; define path/operation authority | Integrated `AuthorizedInvocation` + `EnvironmentAccess` + open request; hidden backend; Workspace terminal cleanup; direct tools; operation∩path enforcement; no lease/token/broker/refcount nouns. |
| Final code-ground reviews R1–R4 | not ready, progressively | Streaming lifetime, multi-Environment tool selection, owned delegation admission, stale tracker authority, member operations, full tool catalog, cleanup crash window, real delegation guards, trusted-local model sources | Added terminal fence, exact named selection, internal delegation seam/lineage, root+child tracker rewrite, member handle matrix, full tool ledger, pre-allocation cleanup intent/reconciliation, F0b executor matrix, one Workspace completion of missing guards, and sole CLI issuer. |
| Final successful Fable pass | **READY** | No P0/P1; verified context, direct named tools, one-Environment exec, delegation authority, terminal cleanup, graph, contraction and real simplification | No architecture change requested; later code-ground fixes only tightened full-catalog/member/cleanup/provider evidence. |
| Final code-ground R5 | **READY** | No P0/P1 after exact owner-finally endpoint matrix and crash-safe survivor acquisition | Current local plan revision declared dispatch-ready; remaining notes are validation/push mechanics. |

The pre-simplification R3 review verified all 22 replacement Beads, the full
blocks graph, H2c/H8 placement, deferred H4a, and the Decision-27/F4a fixes. The
post-R3 reviews simplified and then code-grounded the Environment/session/tool/
lifecycle contracts without changing the active delivery DAG. The epic plus all
22 replacement Beads now carry current authority; both final successful Fable
and final code-ground review report no P0/P1.

## Validation

Executed from `.worktrees/391-agent-fleet-realignment`:

```text
git diff --check
  PASS

changed-Markdown relative-link scan
  48 changed Markdown files; 0 broken relative links

pnpm check:golden-path
  PASS; Decision-28 pending gates, shared invariants, and raw-route checks

br lint wt-391-forward-step1a-current-xn9.5 ... .26
  PASS; 22 issues, no template warnings

br dep cycles
  PASS; no dependency cycles

normative #805 DAG/table check
  PASS; 21 active symbols, one active DAG entry F0a, no unknown blocker, no cycle

replacement Bead graph check
  PASS; 22 nodes = 21 active + deferred H4a; 24 blocking edges;
  only F0a is in_progress and every later active node is blocked

bv --robot-insights
  PASS; graph analytics computed and no cycle reported

pnpm audit:imports
  PASS using the canonical checkout's tool binary path; 37 app source files,
  no forbidden imports

pnpm lint:invariants
  PARTIAL/ENVIRONMENT-BLOCKED (exit 1): Agent scan and boring-bash export/shared/
  import/docs checks passed. Artifact verification then used the canonical
  checkout's binaries against an uninstalled worktree and hit the known
  dependency-link mismatch in UI DTS (`clsx` named export). The first direct run
  also confirmed the worktree has no local node_modules. No runtime source is
  changed by F0a; GitHub CI is the clean dependency-backed gate.
```

### Post-simplification current-tree revalidation

Executed after the native named-Environment, member-handle, full-tool-ledger,
streaming-terminal, delegation, model-source, and crash-safe cleanup refinements:

```text
git diff --check
  PASS

changed-Markdown relative-link scan
  PASS; 10 changed Markdown files, 0 broken relative links

active-authority stale-noun scan
  PASS; no positive EnvironmentAdmission/EnvironmentLease/InvocationView/
  ExecutionGrantBroker/invocation-view/shell-grant/Workspace-owns-Pi-session
  residue in active authority or Decision-28 tracker nodes

pnpm check:golden-path
  PASS; all Decision-28 pending-gate and repository invariant checks

br lint root epic + .5 ... .26
  PASS; 23 issues, no template warnings

br dep cycles
  PASS; no dependency cycles

normative/tracker DAG replay
  PASS; 21 active nodes, exact blocker edges, F0a sole active DAG entry;
  H4a deferred and related-only until its fail-closed activation procedure

bv --robot-insights
  PASS; graph analytics computed

PATH=<canonical-node_modules> pnpm audit:imports
  PASS; 37 app source files, no forbidden imports

pnpm lint:invariants
  PARTIAL/ENVIRONMENT-BLOCKED: Agent and boring-bash source/export/import/docs
  checks passed; artifact build then failed because this isolated docs worktree
  intentionally has no node_modules (`tsup: not found`). GitHub CI remains the
  dependency-backed merge gate.

latest successful Fable pass
  READY; no P0/P1. A later repeat request hit the provider session quota after
  further code-ground tightening, not an architecture verdict.

final current-tree code-ground review R5
  READY; no P0/P1
```

Runtime implementation tests are waived for F0a: this PR changes durable
planning authority, validation metadata/script, and Bead tracker state—not
application runtime behavior. GitHub CI remains required and is expected to run
the dependency-backed import/invariant checks unavailable in this worktree.

## Dispatch state

Do not dispatch F0b until this updated authority PR merges. Keep F0a `.5`
`in_progress` until merge; then close it with the PR and run:

```text
/exec wt-391-forward-step1a-current-xn9.6
```
