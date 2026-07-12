# PR-PLAN — #391 runtime refactor, implementation as a stacked PR series

## Binding owner queue (2026-07-11)

This is the only current dispatch queue. Package tables later in this file are
historical estimates until this section or `INDEX.md` explicitly promotes a
recut. Shared policy below (one bead/PR, review budget, proof, no compatibility
shims) remains binding.

| Order | Work package | Dispatch state | Exact next slice |
| --- | --- | --- | --- |
| 1 | #631 + P1 readiness | **merged; ancestry verified** | Request-binding lifecycle and fail-closed readiness are complete; do not replay discarded/superseded stacks. |
| 2 | P6-R / BBP6-011 | **merged; ancestry verified** | The pure one-binding resolver is complete; D1 obtains N agents through N independent calls. |
| 3 | D1-R0 | **merged ([#649](https://github.com/hachej/boring-ui/pull/649)); dispatch D1-001…006** | [`D1-R0-SPEC.md`](work/D1-tenant-provisioning/D1-R0-SPEC.md) is merged; dispatch D1-001 through D1-006 in order. Historical dedicated/runsc beads remain non-dispatchable. |
| 4 | D1 composition producer -> A1-dev | D1-001 first | D1-001 implements the canonical redacted producer beside the real full-app composition; then recut A1 local dev against that exact host seam. A1-dev gates P8, not D1. |
| 5 | P5a | conditional inside D1 | Add only a demonstrated secret-ref or host-readiness seam; D1 owns apply/digest/rollback. |
| 6 | M1 -> AR1 -> M2/E2 | ordered priority 2 | Recut #549/#556 with authorized complete-byte artifact output and stable no-path rejection, accept AR1-001, then recut canonical MCP/artifact intake. |
| 7 | T1 -> T2 | ordered priority 3 | Recut after priority-2 consumer proof. |
| 8 | P2 -> X1 | ordered priority 4 | Sol P2 may prepare in isolation, but provider/mount work merges last. |

### P1-R readiness micro-contract — current dispatch slice

- **Never cherry-pick #576.** Salvage readiness reporting only; all eviction,
  disposal, pure-mode, and lifecycle code is superseded by #627/#630/#631.
- **Files:** update `shared/events.ts`, `core/createAgent.ts`,
  `server/createAgent.ts`, `server/registerAgentRoutes.ts`, and
  `server/createAgentApp.ts`; add `server/agentReadiness.ts`; add its focused
  test and extend `server/__tests__/createAgent.test.ts`. No cache, lifecycle,
  provisioning, route, or HTTP-ready-status behavior changes.
- **Core seam:** `AgentConfig`/`AgentCoreConfig` accept an optional concrete
  `AgentReadiness`. Core snapshots the requirement keys and wraps delegated
  `status()` with the existing active/disposed assertion both before and after
  the await. A missing reporter retains today's conservative false row for
  every configured key; it never becomes an empty optimistic result.
- **Adapter seam:** both static `createAgentApp` and request-scoped
  `registerAgentRoutes` derive readiness from their own final post-merge tool
  array and binding-local `ReadyStatusTracker`; Shape A must not stay empty
  while Shape B becomes honest. Request-scoped runtime checks reuse the current
  runtime-dependency state. Do not add a reporter registry or provider model.
- **Truth table:** preserve first-surviving order and dedupe requirements.
  `workspace-fs` is ready only when workspace capability is `ready`;
  `sandbox-exec` only when `sandboxReady`; `runtime-dependencies`/`runtime:*`
  only when runtime dependencies are `ready` (`not-started`, `preparing`, and
  `failed` are false); `ui-bridge` or any requirement without an owned fact is
  false. Requirements absent from surviving tools are absent, not invented.
- **Stable data/errors:** project existing readiness state, error/cause,
  retryability, workspace id, and messages through additive
  `AgentReadinessStatus` fields. Reuse `WORKSPACE_NOT_READY`,
  `SANDBOX_NOT_READY`, `AGENT_RUNTIME_NOT_READY`,
  `RUNTIME_PROVISIONING_FAILED`, and `AGENT_BINDING_DISPOSED`; add no new
  error code.
- **Proof:** helper truth-table, ordered-dedupe, unknown false, and two-binding
  no-bleed tests; core injected/fallback tests; disposed-before-probe and
  dispose-during-awaited-probe tests. Both adapters must typecheck with the
  reporter wired; add no production inspection callback solely for a test.
- **Review budget:** 30-40 minutes: 10m lifecycle wrapper, 10m truth table,
  10m adapter wiring, 5-10m focused tests/diff.

### BBP6-011 micro-contract — next cold-start package

- **Files:** add
  `packages/agent/src/server/agentDefinition/resolveAgentDeployment.ts` and its
  focused test; export from `packages/agent/src/server/index.ts`. Export the
  existing value-level `OpaqueRefSchema` and `Sha256DigestSchema` from
  `shared/agent-definition.ts` + `shared/index.ts`, with focused coverage in the
  existing agent-definition test. Do not modify runtime binding lifecycle,
  routes, workspace packages, or add a registry.
- **Input:** one verified `CompiledAgentBundle`, one validated
  `AgentDeployment`, and one unknown-at-runtime host-supplied authorized binding.
  A module-local `AuthorizedAgentDeploymentBindingSchema` composes the exported
  existing validators for opaque `workspaceId`/`defaultDeploymentId` and a canonical SHA-256
  `workspaceCompositionDigest`. No canonical producer exists in current code;
  P6-R binds this opaque attestation but does not claim to reproduce or verify
  workspace composition.
- **Validation:** recompute/verify the definition digest; validate the
  deployment and compute its digest; require the
  deployment definition tuple/digest to match the bundle, require
  `agentId === 'default'`, require the binding's default deployment id to match,
  and load exactly `instructionsRef` from the immutable assets. Use existing
  definition/deployment/binding validation reuses the fixed class/code/field matrix
  in BBP6-011; do not invent a resolution, readiness, policy, plugin,
  environment, or routing error taxonomy.
- **Output:** deeply immutable workspace/deployment/definition identities,
  instructions content, definition/deployment/composition digests, and one
  canonical resolved digest. No runtime handles, readiness, hostnames, roots,
  policies, catalogs, or mutable values.
- **Multiplicity:** one call resolves one already-authorized binding. D1 gets N
  bindings by N independent calls; P6-R owns no batch API, lookup, router,
  pointer, cache, persistence, lifecycle, or authorization decision.
- **Proof:** deterministic same-input result; changed composition changes the
  returned composition and resolved digests while definition/deployment/
  instructions remain unchanged; tampered bundle/ref/default mismatch rejects; two independent
  bindings have no shared state; shared/server import invariants remain clean.
- **Review budget:** 25-30 minutes; reject expansion beyond the resolver/test,
  two public entry exports, and the value-level validator export + focused
  shared test named above.

### D1-R0 planning tracer

The accepted output of this tracer is
[`D1-R0-SPEC.md`](work/D1-tenant-provisioning/D1-R0-SPEC.md). On merge it locks
exact files, stable errors, proof, and review budgets. Its host-revision design
keeps the current one-process N-binding composition: the first slice publishes
only additive/landing-only revisions, rejects active binding replacement, and
performs N independent P6-R calls; agents are not per-container. It also locks:
boot-time collection only; canonical host/proxy parsing; unique hostname,
workspace, deployment, and non-overlapping roots; explicit shared-host trust
profile; expected host revision; atomic active-collection publication; desired
digest separate from observed readiness; immutable rollback-as-new-revision;
OS-authorized local deployment CLI as the only host mutation boundary;
bound-host fencing for existing workspace list/create/switch/delete/default-
auto-provision paths; validation of definition capability/tool/skill/MCP refs
against the final activation;
identify the current composer inputs and specify the smallest canonical redacted
workspace-composition identity/digest producer before claiming reproducible
apply/rollback; and no wildcard/CRUD/hot-tenant control plane. Until that spec
is accepted, D1 implementation remains blocked. P5a remains conditional, not a
D1 or D1-R0 gate.

---

## Historical 2026-07-09 execution reset — non-dispatchable

The sections below retain earlier PR designs for provenance and rough sizing.
They are not a queue and cannot be dispatched without a current recut in the
binding owner queue above.

R0/M1 may prove one managed agent through a stock MCP client as an optional,
non-blocking outreach tracer. Version 1 adds a
minimal agent-directory compiler, separates reusable `AgentDefinition` from
tenant-specific `AgentDeployment`, and proves one dedicated EU deployment from
exact hostname -> landing -> authenticated workspace -> deployed default agent.
Shared tenancy, FUSE, external environment MCP projection, control-plane UX,
hosted child apps, advanced services, search/hooks, and subagent grants are
post-v1 increments.

## Historical 2026-07-10 workspace-first supersession — non-dispatchable

This section supersedes every later table where it conflicts. V1 has no public
no-environment or `runtime: 'none'` product mode. `headless` means no
presentation surface; every adapter still resolves an authorized workspace and
approved runtime. Keep the real `/core` boundary and injected composition, but
reuse the current workspace transport, boring-bash tools/routes, and workspace
plugin composition for v1.

Reduced merge path:

```txt
P0/accepted decision 21 -> P6-D -> A1-compile -----------┐
P0 -> P1 boundary -> P2(runsc minimum) -> P5a(minimum) --┼-> P6-R -> A1-dev -> D1 -> P8
                                                          ┘
```

T1/T2, full P3, E1, and true no-environment work are post-v1. Durable
admission/request idempotency stays with T1 unless a current v1 consumer proves
a smaller requirement. Freeze all current downstream stacks until their bases
are recut against this graph.

| PR | Binding disposition | Salvage boundary |
| --- | --- | --- |
| #543/#545/#547 | **historical/superseded** | do not revive the pure/no-environment stack |
| #616/#617/#622 | **landed** | workspace-first boundary and product correction; verified on main |
| #623/#624 | **landed** | minimal definition identities and deterministic A1 compiler |
| #626/#627 | **landed** | real `/core` move and terminal local binding disposal |
| next P1 lifecycle | **landed via #631** | request-binding/service teardown; no host-global ownership in core |
| next P1 readiness | **current-main slice** | fail closed from the binding-owned requirements source |
| #628 | **landed structural preflight** | `productionReady: false`; requires real EU lifecycle/security validation before D1 lock |
| #566/#568/#564 | **deferred/re-scope only** | revive only for a named workspace/environment-full consumer; no pure-mode contract |

The recovery leaves and lifecycle/teardown have landed. P1 now finishes only
fail-closed readiness. P6-D and A1 compile are already on main; P6-R and A1
local run wait for the remaining P1/runtime/readiness work. R0/M1 may proceed
only as an independently valuable current-main tracer and never blocks v1.

Binding execution plan that turns the [`work/`](work/) work orders into reviewable PRs. Derived from [`INDEX.md`](INDEX.md) (dispatch protocol + dependency graph + no-compat policy) and every `work/<pkg>/TODO.md`. Mirrors the #416 stacked convention shipped as `bclaw/416-pr1..pr7`.

---

## POLICY (binding — read first)

1. **One bead = one PR by default.** Small same-TODO beads MAY combine when the combined budget holds. A bead exceeding budget MUST pre-declare its split into stacked PRs (see the flagged beads).
2. **Budget: max 2,000 net-new LOC per PR, excluding tests and docs.** net-new = additions that are **not** rename-detected moves; tests = `*.test.ts` / `__tests__/**` / `testing/**`; docs = `*.md`.
3. **Pure code-move PRs** = rename-detected moves + import-path updates ONLY, zero logic change (review = rename verification). No hard LOC cap, but keep churn reviewable (**soft ~4k changed lines**; split by route/tool family when larger).
4. **Every code PR carries its bead's tests in the same PR** — no test-less code PRs.
5. **Branch naming:** `bclaw/391-<todo>-pr<N>-<slug>` (mirrors #416). One stack per TODO; each PR must be mergeable-green on its own.
6. **Every PR description cites:** bead id(s), plan file (`docs/issues/391/runtime-refactor/…`), migration phase ([`INDEX.md`](INDEX.md) phase table + the package's `PLAN.md`), and a LOC-accounting block from the script below.
7. **Every PR description carries review-budget metadata:** estimated review time, review-focus notes, and stacked merge order labels/notes when applicable (owner review budget: 1-2h/day).
8. **CI gate per PR:** the affected package test filter(s) + the root invariant scripts named per lane.

### LOC-accounting command (verified — run in the PR branch, prints net-new)

```bash
git diff --numstat -M origin/main...HEAD \
  -- ':(exclude)**/*.md' ':(exclude)**/*.test.ts' ':(exclude)**/__tests__/**' ':(exclude)**/testing/**' \
  | awk '$1!="-"{a+=$1} END{print (a+0)"  net-new added LOC (tests/docs/pure-moves excluded)"}'
```

`-M` makes a pure move a rename (`0  0` in numstat) so it contributes 0 net-new; a freshly-added file counts full additions. A result `> 2000` on a non-move PR = policy violation → split. (Verified: the pipeline executes clean in-worktree.)

### Root CI script names (verified in `package.json`)

`pnpm lint:invariants` (= agent `check-invariants.sh` + `@hachej/boring-bash check:invariants` + `lint:workspace-plugin-invariants`) · `pnpm audit:imports` · `pnpm check:agent-isolation` · `pnpm check:bundle-size` · `pnpm typecheck` · `pnpm test` · `pnpm e2e`.

Per-package command matrix (only scripts that exist in each `package.json` — verified):

| Package (filter) | Gate scripts that exist |
| --- | --- |
| `@hachej/boring-agent` | `build` · `typecheck` · `test` · `test:e2e` · `lint:invariants` · `check:isolation` · `smoke:capability-readiness` |
| `@hachej/boring-bash` | `build` · `typecheck` · `test` · `check:invariants` |
| `@hachej/boring-workspace` | `build` · `typecheck` · `test` · `check:bundle-size` · `lint:plugin-invariants` |
| `@hachej/boring-core` | `build` · `typecheck` · `test` · `check:bundle-size` |
| `@hachej/boring-ui-cli` (`packages/cli`) | `build` · `build:front` · `typecheck` · `test` |
| `full-app` (`apps/full-app`) | `build` · `typecheck` · `test` · `e2e` · `smoke:remote-worker` |
| `workspace-playground` (`apps/workspace-playground`) | `build` · `typecheck` · `test` · `test:e2e` |

Invoke as `pnpm --filter <package> run <script>`. There is **no** universal `{build,typecheck,test,lint:invariants,check:isolation}` set — e.g. `lint:invariants`/`check:isolation` exist only on `@hachej/boring-agent`, `check:invariants` only on `@hachej/boring-bash`, `check:bundle-size` only on workspace/core, and `e2e`/`test:e2e` names differ per app.

### Size heuristic used for estimates

S ≈ <300 net-new · M ≈ 300–900 · L ≈ 900–2000. Adjusted per bead nature. **Moves are budget-exempt** (listed with churn, not net-new). Doc/test-only beads are budget-exempt.

### Pre-declared splits (beads flagged at risk of busting 2k net-new or 4k move-churn)

| Bead | Reason | Declared split (only if the cap is hit) |
| --- | --- | --- |
| **BBP1-002** `createAgent()` façade | owner-flagged; new façade + `/core` subpath + shared types | pr2a: `createAgent.ts` + `/core` entry + `AgentConfig`/`AgentEvent`/`Agent` types + `AgentSendInput` reconcile · pr2b: `start`/`stream`/`send` producer-consumer wiring over `HarnessPiChatService` + `interrupt`/`stop` wrapping the existing `HarnessPiChatService` control methods + `resolveInput`/`stream` typed stubs |
| **BBT1-001** EventStreamStore vendoring | owner-flagged; ~982 LOC ported from Flue (adapted = net-new, not a rename) | pr1a: `eventStreamStore.ts` + `sqlStorage.ts` (transactional append fix) · pr1b: `schemaVersion.ts` + `runEventStreamStoreConformance` suite |
| **BBP4-011** filesystem front-plugin move | owner-flagged move-churn; whole `filesystemPlugin/front+shared` (editors + file-tree + data layer) far exceeds 4k soft | pr2a: `file-tree/*` + `shared/*` + `BBP4-012` tree fn · pr2b: `code-editor`+`markdown-editor`+`media/html/empty` panes · pr2c: `data/*` + `front/index.ts`+resolver+bindings rewire onto public workspace plugin SDK imports |
| **BBP3-011 / BBP3-014** tool + route moves | owner-flagged (P3 moves); each is a large **move** | kept as separate move PRs (never combined); split further by tool/route family only if >4k churn |
| **BBP5-006** managed-service supervisor | L, new supervisor+lifecycle | pr5a: supervisor (start/health/port-grant/teardown) · pr5b: readiness surface + host-caller passthrough — only if >2k |
| **BBD1-004a/004b** exact-host preparation then publication | mandatory dependency split | pr4 installs the reserved-host inactive guard before preparing artifacts/route/verifier with no publication · pr7 integrates the real BBD1-005/006 mint, bounded generation transition, pointer/process switch, and publication; no fake readiness producer |

---

## Per-TODO PR tables

Legend — nature: **new** = net-new code · **move** = rename-detected + import repoint (budget-exempt) · **doc/test** = budget-exempt. Gate = per-PR CI beyond `typecheck`+`test`.

### P0 — ADR + decision ratification (Phase 0, doc-only)

| PR | beads | nature | net-new vs budget | test deliverables | gate |
| --- | --- | --- | --- | --- | --- |
| pr1-adr-ratify | BBP0-001..005 | doc | 0 (docs exempt) | none (doc phase) | link-grep of new `docs/issues/391/*` refs resolve; `boring-bash check:invariants` (pack wording strings intact); `git diff --stat` only `docs/**` + `agent/docs/runtime.md` |

**P0 total: 1 PR.**

### P1 — Headless core `createAgent()` (Phase 1)

> **Superseded for v1 by the 2026-07-10 disposition above.** Rows pr4/pr5 and
> pure portions of pr6/prA are post-v1. prE's durable admission/request
> idempotency moves to T1. Recut only the workspace-composed core boundary,
> invariants, real core move, and lifecycle/readiness work described above.

| PR | beads | nature | net-new vs budget | test deliverables | gate |
| --- | --- | --- | --- | --- | --- |
| pr1-config-inventory | BBP1-001 | doc | 0 | none (inventory doc); records tool/renderer source provenance needed for environment-bundle -> plugins -> host duplicate checks | grep reproducers resolve |
| pr2-createagent-facade ⚠split | BBP1-002 | new | ~800–1200 / 2000 — **at risk, split pre-declared** | façade unit: 9-member API (`start`,`stream`,`send`,`resolveInput`,`interrupt`,`stop`,`sessions`,`readiness`,`dispose`) constructs w/o Fastify; `send` yields ≥1 event via live tail; historical `startIndex` throws `ERR_NOT_IMPLEMENTED_UNTIL_T1`; `interrupt`/`stop` wrap the existing `HarnessPiChatService` control methods | `lint:invariants`; `check:isolation` |
| pr3-adapters-thin | BBP1-003 | new (refactor) | ~400–800 / 2000 (mostly churn into façade) | parity guarded by existing suites + pr6 | full agent `test` + `test:e2e` (parity) |
| pr4-pure-runtime-none | BBP1-004 | new | ~300–600 | pure-mode route/tool exclusion; session round-trip under `sessionStorageRoot` w/ `workspaceId` undefined; no cwd leak | `lint:invariants` |
| pr5-pi-harness-audit | BBP1-005 | doc + new (seals) | ~150 seals | harness-construction spy (no host cwd); system-prompt snapshot (no cwd/AGENTS.md) | `test` |
| pr6-boundary-invariants | BBP1-006 (recut) | test | 0 (tests + script) | Fastify-graph check on `/core`; agent→bash value-import check; no no-environment execution smoke in v1 | `lint:invariants`; `check:isolation`; `boring-bash check:invariants` |
| prA-facts-projection | BBP1-007 | new | M | `ResolvedAgentCapabilities` projection through existing capability exposure; pure facts report `environments: []`, actual registered tools, empty skills/MCP; direct/local/vercel get coarse compatibility environment facts | agent `test`; capability route tests |
| prB-de-mode-gating | reopened-P1 follow-up | new | S/M | remove runtimeMode feature gating; derive input-asset intake from environment sinks/direct-provider policy; no behavior branches on `runtimeMode` except diagnostics/migration shims | agent `test`; T2 BBT2-007 alignment |
| prC-core-relocation | reopened-P1 follow-up | move + new | M/L | move/split core implementation under `src/core/createAgent.ts`; server wrapper injects Pi/defaults; `/core` graph imports no server/Pi defaults unless injected | `lint:invariants`; `check:isolation` |
| prD-readiness-honesty | reopened-P1 follow-up | new | S/M | readiness/lifecycle state is honest: no placeholder false-ready state; runtime binding eviction disposes agents or reports tracked lifecycle | agent `test`; readiness smoke |
| prE-admission-attribution **post-v1 T1** | former P1 reliability closeout | deferred | M | durable admission/request-idempotency work is not a P1/R0/v1 gate under accepted decision 21 | defer to T1 |

The legacy P1 table is not the active queue. #616/#622/#626/#627 have landed.
The active P1 queue is request-binding/service teardown lifecycle followed by
fail-closed readiness. prE and durable request idempotency remain post-v1 T1
work. No legacy pure-mode row is dispatchable.

### M1 — Managed agent via MCP (optional outreach sidecar, after P1 boundary)

M1 is an optional R0 tracer, not the v1 factory exit or business critical path.
Execute it only when its outreach value justifies a current-main recut. It
follows the outreach-week operating mode: additive/dark until smoke proof, e2e
green, review-time estimate + review-focus notes on every PR, and explicit
stack order.

| PR | beads | nature | net-new vs budget | test deliverables | gate |
| --- | --- | --- | --- | --- | --- |
| pr1-exposed-mcp-delegate | BBM1-001 | new | ~700–1100 | bearer/host policy proves current membership, resolves one concrete workspace, its bound deployment, and explicit `default` agent before start; tool args grant no routing; bounded process-local receipt key is `(subjectId, workspaceId, deploymentId, agentId, idempotencyKey)` and dedupes same-process retries only; foreign-workspace, non-member, and mismatched-binding negatives; explicitly no restart durability | chosen host/package `test`; `audit:imports` |
| pr2-delivery-v0-demo-composition | BBM1-002 | new | ~300–700 | byte caps: brief 32 KiB, key 128 B, final 96 KiB, Markdown 256 KiB, serialized total 384 KiB; stable rejects/no path; temporary config names A1 owner; actor/origin/request id reach core | host build/typecheck/test |
| pr3-stock-client-smoke | BBM1-003 | test/doc | 0 | authenticated stock client proof: membership -> concrete workspace -> bound deployment -> explicit default agent -> delegate -> progress -> inline result; foreign-workspace/non-member/mismatched-binding, auth/quota/size, and restart-limitation proof | documented smoke + affected e2e |
| pr2b-share-links (HARD GATED on #424) | BBM1-004 | new | ~150–400 | current-main public-share API cited; returned URL uses verified share route; share opens without exposing internals | host build/typecheck/test; share route smoke |

**M1 total: 3 PRs (v0) + 1 gated follow-up.** The only prerequisite
is the P1 workspace/Fastify boundary + P6-R. R0 is bearer-only, workspace-backed, and
self-contained. Current membership must resolve a concrete workspace plus its
bound deployment and explicit `default` agent before start. Its bounded
process-local receipt key is `(subjectId, workspaceId, deploymentId, agentId,
idempotencyKey)`; foreign-workspace, non-member, and mismatched bindings reject,
and restart durability is explicitly absent. Durable admission/streams remain
T1.

### A1 — Minimal agent-directory authoring (v1, after P6-D)

| PR | beads | nature | net-new vs budget | acceptance | gate |
| --- | --- | --- | --- | --- | --- |
| pr1-directory-compiler | BBA1-001 | new | ~300–500 | `agents/<name>/agent.json` + `instructions.md` compile import-free to self-contained `CompiledAgentBundle`; deterministic digest covers canonical definition + immutable assets; unknown keys/refs fail with stable codes | CLI/core typecheck + unit |
| pr2-validate-dev | BBA1-002 | new | ~250–450 | `agent validate` checks the bundle; `agent dev` creates/selects an authorized local workspace and approved runtime (`bwrap` default when available; direct only by explicit trusted policy), then resolves through P6-R; one local scripted turn; zero platform-source edits | CLI smoke |
| pr3-migrate-r0-config | BBA1-003 | move/delete | ~150–300 | only when shipped D1 consumes duplicated M1 behavior configuration, resolve it from the compiled bundle; temporary `ManagedAgentVerticalConfig` projection is removed or reduced to a documented host-only deployment adapter | D1 path + M1 stock-client smoke |

**A1 v1 total: 2 PRs, plus one conditional R0 migration PR.** BBA1-001 and its
P6-D prerequisite have landed via #624/#623. BBA1-002 waits for P6-R so it uses the normal host resolver.
BBA1-003 is a P8 gate only when the shipped D1 path still consumes duplicated
M1 behavior configuration. Keep v1 conventions deliberately small: one schema,
one instructions file, reference ids rather than executable discovery, and no
pricing, hostname, exposure, tenant, or runtime-image fields in the definition.

### M2 — MCP as an agent surface (registry-driven)

M2 turns M1's sidecar shape into a committed surface backed by immutable
`ResolvedAgent` behavior plus deployment/host-owned exposure config. It is the ingress dual of E2: E2 exposes environments
over MCP; M2 exposes declared agents over MCP.

| PR | beads | nature | net-new vs budget | test deliverables | gate |
| --- | --- | --- | --- | --- | --- |
| pr1-mcp-exposure-config | BBM2-001 | new | ~250–450 | `ResolvedAgent` behavior + `AgentDeployment`/host-owned `McpAgentExposureConfig`; `authMode: bearer\|public-demo`, `demoPolicy`, `exposureId`; unknown deployment refs fail closed; definition alone exposes nothing | agent/host `test` |
| pr2-mcp-surface-adapter | BBM2-002 | new | ~500–900 | subject/demo-principal scoped caller key maps to T1 receipt and dedupes before quota; lost-response/new-call-id starts once; M1 byte budgets; approval/progress works | host build/typecheck/test |
| pr3-auth-demo-policy | BBM2-003 | new | ~300–600 | bearer invalid/foreign rejects; public-demo obeys demo policy and never widens environment facts | host `test`; secret canary |
| pr4-result-share-conformance | BBM2-004 | test + new | ~200–400 | bounded aggregate result/share shape stable; exact size boundaries; retry proof; no raw paths/secrets | documented smoke + affected e2e |

**M2 total: 4 PRs.** Preconditions: M1 (landed #650) + AR1 Lane W. A tracer/demo M2 slice (authMode: public-demo behind existing membership auth) may precede ID1; PUBLIC/open M2 requires ID1 (Decision 22). AC1 contracted-mode only where farm actions need it. P7 inspection is optional post-v1, not a gate. M2 is a committed surface follow-up; it does not retroactively make M1 a runtime-exit gate.

### T1 — Durable event stream + on-stream approvals (Phase T1, off P1)

| PR | beads | nature | net-new vs budget | test deliverables | gate |
| --- | --- | --- | --- | --- | --- |
| pr1-eventstore ⚠split | BBT1-001 | new (vendor/adapt) | ~1000–1400 / 2000 — **at risk, split pre-declared** | `agent.db`-backed stream conformance: monotonic offsets, idempotent append, no gap on throw, subscribe/unsubscribe; schema can atomically include pending/idempotency tables | agent `test`; node:sqlite |
| pr2-envelope-tap | BBT1-002 | new | ~200–400 | `harnessPiChatService.eventStore.test`: N events, contiguous `eventIndex`, durable-before-delivery | `test` |
| pr3-ds-routes-stream | BBT1-003 | new | ~900–1300 / 2000 (port of `handle-stream-routes` ~594 + route + `stream`) | route test (GET/HEAD/304/SSE/abort); `stream` replay-from-index; SSE drop→re-GET lossless | `lint:invariants` (façade Fastify-free) |
| pr4-approvals-park-resolve | BBT1-004 | new | ~700–1000 | `approval.test` (park/resolve/deny/cross-client); pending-input rows and approval events live in `agent.db` and mutate in one transaction; restart exposes or explicitly expires the request, never claims in-memory continuation | `test` |
| pr5-askuser-onto-stream | BBT1-005 | move + delete | net-new ~150; deletes second channel | adapted ask-user e2e; `ask_user.execute` parks + resolves via `resolveInput`; grep `ask-user.v1.` → no live handler | `lint:invariants`; `audit:imports` |
| pr6-conformance | BBT1-006 | test | 0 | envelope ordering, replay-from-index, transactional pending-request survival; seeded recovery is named recovery, not resume | `test` |
| pr7-native-history-recovery | BBT1-007 | new + test | ~200–400 | fault after Pi JSONL commit and before stream append; restart deterministically reconciles replay or records a durable terminal failure, never silently omits committed conversation content | fault-injection test |
| pr8-durable-request-receipts | BBT1-008 | new | ~250–450 | trusted-scope+requestId receipt survives restart; same payload returns original receipt; mismatch conflicts; admission crash never duplicates a model run | fault-injection + agent test |
| pr9-production-agent-db-wiring | BBT1-009 | new + host wiring | ~300–550 | standalone `createAgentApp()` + CLI/core/workspace/full-app open/migrate file DB; routes reject memory/absence; restart/backup/close ownership | host restart integration |

**T1 total: 9 PRs (10 if pr1 splits).** Blocks T2 and any consumer of durable replay/approvals. Existing #559 must split approval durability from ask-user deletion; the second channel is removed only after migration or an explicit deployment drain. **Amendment (2026-07-08):** S1 is relocated out of #391 active scope.

### T2 — Transport adapters (Phase T2, off T1)

| PR | beads | nature | net-new vs budget | test deliverables | gate |
| --- | --- | --- | --- | --- | --- |
| pr1-contract-conformance | BBT2-001 | new (contract) + test | ~150 (`transport.ts`) | `runTransportConformance` suite (send/reconnect/approval/interrupt/dedupe) | `test` |
| pr2-inprocess-transport | BBT2-002 | new | ~150–300 | `inProcessTransport.test` via shared suite | `check:isolation` |
| pr3-http-ds-transport | BBT2-003 | new | ~700–1000 (+ pinned `@durable-streams/client`) | `dsHttpTransport.test` via suite vs injected fastify; forced-close lossless replay | `check:bundle-size`; `audit:imports` |
| pr4-refit-twohandles-lint | BBT2-004 | new (guard) | ~200 + `transport.md` | platform-addressing guard test (negative: surface id fails, `SessionCtx` allowlisted passes) | `lint:invariants`; `audit:imports` |
| pr5-headless-consumer | BBT2-005 | test + script | ~100 (`headless-consumer.mts`) | interleaved in-process×HTTP shared-session test | `exec tsx scripts/headless-consumer.mts` |
| pr6-delete-legacy-cursor | BBT2-006 | delete + move | net-new ~50 (grep gate) | route tests migrated to DS; grep gate: no `?cursor=`/`PiChatReplayBuffer`/`piChatStream.ts` | `lint:invariants`; workspace playground unmodified |
| pr7-input-asset-intake | BBT2-007 | new | ~150–300 | writable accepting env sink, provider-direct asset path, and stable rejection covered; no `runtimeMode` gating | agent `test`; transport tests |

**T2 total: 7 PRs.** pr6 lands **last** for the legacy cursor deletion (after DS conformance + playground green); pr7 may land after the shared input-asset type exists and before P4 composer/upload consumers rely on it. Bumps `@hachej/boring-agent` minor (protocol change).

### P2 — Dedicated runsc minimum (Phase 2, off P1)

Active queue: #628 has landed the structural runsc config/preflight seam with
`productionReady: false`. Next is a time-boxed real-EU validation spike, then
only the lifecycle/security/provider work that its evidence shows D1 needs.
Unknown facts fail closed. The broad relocation table below is historical and
non-dispatchable unless a named post-v1 consumer reopens a row.

**Package re-target (00 open decision 3 RESOLVED; 08 decision 11):** concrete providers move to the **new `@hachej/boring-sandbox`** package (`packages/boring-sandbox/src/providers`), **not** `boring-bash/providers`; runtime-mode resolution (`resolveMode`) lands in `@hachej/boring-bash`. Acyclic: `boring-sandbox → agent(types)`; `boring-bash → boring-sandbox(values) + agent(types)`.

| PR | beads | nature | net-new vs budget | test deliverables | gate |
| --- | --- | --- | --- | --- | --- |
| pr0-sandbox-scaffold | BBP2-000 (new package) | new | ~150 (package.json, tsup, `/shared`+`/providers` export maps, `check-invariants.mjs`; `pnpm-workspace.yaml` already has `packages/*`, verify not duplicate) | new-package `build`/`typecheck`; export-map resolves; invariant script asserts agent-types-only import boundary | new-package `build`; `audit:imports` |
| pr1-providers-subpath-matrix | BBP2-001 + BBP2-002 | new | ~250 (capability contract + matrix in `boring-sandbox/shared`) | export-map `boring-sandbox/shared` + `boring-sandbox/providers`; per-fixed-provider matrix rows live in shared; `remote-worker` worker-dependent fields are static `'unknown'`; fail-closed runtime validation/tests deferred to BBP5-008 | `boring-sandbox check:invariants` |
| pr2-move-direct-bwrap | BBP2-003 | move | budget-exempt (~1.5k churn) | moved direct/bwrap conformance + snapshot pass under **boring-sandbox**; `createNodeWorkspace`/`getNodeWorkspaceHostRoot`/path helper importers migrated with the slice | `boring-sandbox test` |
| pr3-move-vercel-sandbox | BBP2-004 | move | budget-exempt (~2.5–3k churn, <4k) | vercel-sandbox unit tests pass under boring-sandbox; `createVercelSandboxWorkspace` owned/exported by boring-sandbox providers; no provider adapter value-imports agent provisioning helpers | `boring-sandbox test` |
| pr3b-sandbox-publish-parity | BBP2-009 (Amendment 2026-07-06) | chore | ~30–60 (five publish lists + cohort version bump; lands BEFORE pr4's bash→sandbox value edge) | `node scripts/audit-publish-manifests.mjs` passes with sandbox listed; grep gate: sandbox present in all five lists, ordered before `packages/boring-bash` | `audit:imports`; publish-manifest audit |
| pr4-mode-resolution-to-bash **post-v1** | BBP2-005 | deferred | n/a | former pure-only-bin/mode cutover is void; re-specify from current main only for a named post-v1 consumer | do not dispatch |
| pr5-split-remote-worker | BBP2-006 | move | budget-exempt (~1k churn) | protocol → `boring-sandbox/shared`, client/adapter/workspace → `boring-sandbox/providers`; bytes round-trip; full-app worker import-graph has no agent-core dep; worker health remains `{ ok: true }`; **worker capabilities stay `'unknown'` — NO handshake here (handshake owned solely by BBP5-008)** | `audit:imports` |
| pr6-migrate-delete-invariants | BBP2-007 + BBP2-008 | move (delete origin exports) + new (invariant) | ~80 (invariant script) | static: agent old paths have no bash/sandbox value import / no re-export (including moved workspace helpers); boring-bash→sandbox value edge + sandbox→agent types-only edge both asserted; apps compile | `lint:invariants`; `audit:imports` |
| pr7-hardened-runsc-provider | BBP2-010 | new | ~600–1000 | #628 landed structural preflight only; remaining slice requires runsc systrap lifecycle, OCI digest, netns/nftables metadata/private/cross-workspace denial, cgroup/pid/CPU/memory limits, no broker secret, exact cleanup, and real EU evidence | time-boxed EU spike first; then `boring-sandbox test` + real-target smoke |

The nine-row table records the old full migration, not the active v1 count.
Current v1 planning begins at #628 plus the evidence-led EU spike and smallest
D1-consumed follow-up. No `@hachej/boring-agent` minor bump occurs here; the
broader relocation remains P3/post-v1.

### P3 — Move file/bash routes + tools → boring-bash (Phase 3, off P2)

| PR | beads | nature | net-new vs budget | test deliverables | gate |
| --- | --- | --- | --- | --- | --- |
| pr1-agent-subpath-feature | BBP3-010 | new | ~120 (`/agent` subpath + `createBashAgentFeature()` skeleton returning `{ tools, readinessRequirements, systemPromptFragment }`) | export-map `/agent`; bundle type includes prompt fragment; bundle marked as the environment-bundle source in tool/renderer resolution | `boring-bash check:invariants` |
| pr2-move-filesystem-tools ⚠ | BBP3-011 | move | budget-exempt (large; split by tool family if >4k) | moved fs-tool tests; spoof-guard + readonly-reject preserved; `disableDefaultFileTools` parity | `boring-bash test`; company_context no-leak green |
| pr3-move-bash-upload | BBP3-012 + BBP3-013 | move | budget-exempt | bash/isolated-code readiness+redaction; upload stable errors | `boring-bash test` |
| pr4-move-fs-git-routes ⚠ | BBP3-014 | move | budget-exempt (large; split by route family if >4k) | moved route tests; git-root == file-root == bash-cwd | `boring-bash test` |
| pr5-wire-composition | BBP3-015 | new (server plugin + direct-composer wiring) | ~300–500 (boring-bash server plugin; workspace-family hosts register internal/default plugin; direct composers hand-wire only if they bypass the plugin pipeline) | pure-mode composition has no file routes/tools or bash prompt fragment; bash-enabled workspace-family hosts activate routes/tools/`systemPrompt` as one contribution through the server plugin; filtering the contribution removes its prompt; any direct CLI/library composer has the same atomic library wiring; duplicate tools/renderers fail typed unless later source sets `overrides:true` | `lint:invariants`; `audit:imports`; `check:isolation` |
| pr6-sot-tests-invariants | BBP3-016 + BBP3-017 + BBP3-018 | test + new (invariant/error) | ~80 | source-of-truth regression; `disableDefaultFileTools` parity; boundary invariant; dedicated `MODEL_NOT_ALLOWED` 403 code | `lint:invariants` |
| pr7-capability-gate-filesystem-ui | BBP3-019 | new (non-move gating) | ~150–300 | pure composition registers no filesystem plugin/providers/renderers and makes no file/tree/search/upload UI API requests; capable workspace behavior unchanged | workspace plugin/front tests; `lint:plugin-invariants` |
| pr8-atomic-default-plugin-contribution | BBP3-020 | new (existing plugin-pipeline closeout) | ~350–650 | one verified boot-time record supplies tools/routes/Pi resources+prompt + versioned front artifact; additive `scopedRoutes` receives bound Workspace/scoped repositories and raw routes fail D1 readiness; indirect foreign session/project ids reject; disable/pre-registration failure supplies none; browser failure keeps previous UI; snapshot binds route mode/contract plus host-app/source/manifest/redacted inputs; no `pluginRefs` | workspace/core/CLI plugin tests; `lint:plugin-invariants` |

**P3 total: 8 PRs.** Precondition: P1 (`tools` injection, no `features`) + P2 present. `packages/agent` ends with **zero** boring-bash imports (bin included). BBP3-019 closes v1 filesystem capability residue without pulling the P4 ownership move into v1; BBP3-020 gives existing trusted workspace plugins the same no-prompt-residue rule without pulling post-v1 per-agent plugin policy into v1.

### P4 — Filesystem presentation extraction (post-v1, off P3)

**2026-07-09 ruling:** do not move the workspace's editor/tree bundle merely
for ownership purity. V1 capability-gates the existing workspace-owned plugin
from resolved environment facts. Re-open the move PRs only when a second host
needs the complete presentation bundle or a package boundary is otherwise
impossible to enforce.

| PR | beads | nature | net-new vs budget | test deliverables | gate |
| --- | --- | --- | --- | --- | --- |
| pr1-plugin-subpath-sdk | BBP4-010 | new | ~150 (`/plugin` entry + public workspace SDK imports; no adapter) | export-map `/plugin` front-safe; front-safe scan on `src/plugin/**` | `boring-bash check:invariants` |
| pr2-move-front-plugin ⚠split | BBP4-011 (+ BBP4-012) | move | budget-exempt (**far >4k — split into pr2a/b/c pre-declared**) | moved plugin `__tests__` pass; plugin imports public workspace SDK directly; tree fn returns current shape | `lint:invariants`; static edge gate |
| pr3-move-tool-renderers | BBP4-015 | move | ~300–600 (renderer split/move; tests move with it) | `definePlugin({ toolRenderers })` registers `bash`/`read`/`write`/`edit`/`find`/`grep`/`ls`; pure-mode front default renderer map has none of those ids | agent + boring-bash front tests |
| pr4-composer-providers | BBP4-016 | new + move | ~300–600 (generic composer provider seam + file provider move) | #26 `@file` mention provider, file slash commands, `@files:` enrichment, and upload affordance exist only with bash plugin attached; pure-mode front has no `/api/v1/files/search` request path | agent + boring-bash front tests |
| pr5-remove-static-registration | BBP4-014 | move (delete workspace export/static default registration) + new (guard) | ~60 | `exec_ui openFile` opens moved panel; `rg -n "from ['\"]@hachej/boring-bash|import\\(['\"]@hachej/boring-bash" packages/workspace/src` → 0 | `lint:plugin-invariants`; `audit:imports` |
| pr6-mount-discovery | BBP4-017 (Amendment 2026-07-06; #550 gap 5) | new | ~100–200 (capability-gated file-tree affordance via `/governance/me`) | labeled mount node / empty-state hint with a governed mount; no affordance and no `/governance/me` request without governance; visible set unchanged (single `getFilesystemBindings` path) | boring-bash front tests; `lint:plugin-invariants` |

**P4 total: 6 PRs (8 if pr2 splits into 3; Amendment 2026-07-06 adds pr6-mount-discovery).** BBP4-013 document-authority write/edit override seam is **deferred out of this epic** (zero real consumers — arrives with #367/#226; filed at P8 BBP8-004) — **no PR here**. Precondition: P3 write/edit tools + routes in boring-bash. Cycle safety is the static workspace edge guard: `packages/workspace/src` must not import `@hachej/boring-bash`; `boring-bash/plugin` may import the public workspace plugin SDK because the host loads it dynamically through the plugin pipeline. Capability-residue closeout: detaching bash leaves no file prompt, API, renderer, or composer-provider residue in pure mode.

### E1 — Environment attachments (Phase E1, off P2 **and** P3)

| PR | beads | nature | net-new vs budget | test deliverables | gate |
| --- | --- | --- | --- | --- | --- |
| pr1-env-contracts | BBE1-001 | new (types) | ~150 | `.test-d` compile assertion: attachment narrows to `FilesystemBinding` selector | `boring-bash typecheck` |
| pr2-resolve-attachments | BBE1-002 | new | ~350–550 (lifetime owner + reduction, **no registry/Map**) | stable lifetime key excludes request id; `prepareAttachmentLifetime` returns facts + auth-gated contributions only; each operation enters callback-scoped `withAuthorizedView`; unauthorized/expired lease rejects; exact reuse and dispose-once | `boring-bash test` |
| pr3-company-context-env | BBE1-003 | new (adapter) | ~200 | reference attachment == direct provider visible-path set; `execPolicy:'none'` | `readonlyCompanyContext*` green |
| pr4-scoped-view-jail | BBE1-004 | new | ~250–400 | subpath jail (sibling denied); `..` rejected; **symlink-escape denied (realpath-based)** | `boring-bash test` |
| pr5-agent-typeonly-conformance | BBE1-006 + BBE1-007 | new (type-only field + invariant) + test | ~80 | agent value-import fails / `import type` passes; scoped-view conformance mount `passed:true` | `audit:imports`; `lint:invariants` |

**E1 total: 5 PRs.** No edits to landed #416 declarations (additions only). BBE1-005 subagent seam **deferred to P7**.

### E2 — MCP environment projection (Phase E2, off E1 + P6-R)

| PR | beads | nature | net-new vs budget | test deliverables | gate |
| --- | --- | --- | --- | --- | --- |
| pr1-mcp-server-exec-gating | BBE2-001 + BBE2-004 | new | ~400–600 (+ pinned SDK, `./mcp`) | factory derives one ref-bound lifetime from the future E1 host attachment lookup; no P6-R catalog, mismatched contribution injection, raw ops/lease, or secret; per-call E1 auth | `boring-bash check:invariants`; build |
| pr2-mcp-session-identity | BBE2-002 | new | ~250 (token-per-projection) | per-call validation; revoked/expired/foreign and invalidated lifetime reject after connect; two actors isolated | `boring-bash test` |
| pr3-mcp-conformance-doc | BBE2-003 + BBE2-005 | test + doc | 0 | MCP-mount conformance `passed:true`, same visible-path set; remote-worker-as-transport filed as **P8** follow-up (doc); duality note confirms E2 exposes MCP and does not share machinery with boring-mcp consume | `boring-bash test` |

**E2 total: 3 PRs.** SDK pinned exact `1.29.0` (no caret). E1 dependency dropped
in the recut (INDEX: graduate M2/E2 without generic E1); the E1-derived
lifetime lookup will be replaced by a direct binding-scoped lookup.

### P5 — Provisioning / readiness / secrets (P5a v1 core; P5b post-v1)

| PR | beads | nature | net-new vs budget | test deliverables | gate |
| --- | --- | --- | --- | --- | --- |
| pr1-bash-requirement-normalizer | BBP5-001 | new | ~600–900 | merge-by-id; conflict/unsafe-id reject; capability-vs-provider reject; import-free proof; no raw secret | `boring-bash check:invariants`; `audit:imports` |
| pr2-extract-engine-repoint-callers | BBP5-002 | move + host wiring | move churn + ~300–500 | existing engine/fingerprint behavior preserved in boring-bash/server; every caller migrated; no agent origin/export; plugin requirement reaches engine via normalizer | boring-bash/core/workspace/cli `test`; import audit |
| pr3-readiness-health | BBP5-003 + BBP5-004 | new | ~400–700 | host-run health check; agent consumes methodless status; `optional_failed` derived state; dependent tool gate; timeout retryable | boring-bash + agent readiness `test` |
| pr4-sdk-archive **post-v1 P5b** | BBP5-005 | new | ~300–500 | archive installs + fingerprint-skip; no host-path leak; runtime-visible rewrite | `test` |
| pr5-managed-service **post-v1 P5b** ⚠split | BBP5-006 | new | ~700–1000 — **split pre-declared if >2k** | start→health→port-grant; teardown kills tree; denied exec/ports blocks; no raw secret in env | `test` |
| pr6-secret-brokering | BBP5-007 | new | ~500–800 | status without value; **brokering negative test — no sandbox-side read of brokered secret**; no serialization to browser/model/log/artifact | `check:isolation`; `smoke:capability-readiness` |
| pr7-authenticated-worker-handshake **P5a v1** | BBP5-008 | new + test | ~300–500 | authenticated nonce/freshness-bound worker identity; reported runsc/network/limit/image facts; fail-closed unknown/bad-contract/stale/replay; real EU worker parity; no silent downgrade | `full-app smoke:remote-worker`; real-target smoke |
| pr7b-remote-worker-attachment-mount **post-v1 P5b** | BBP5-010 | test | ~100–200 | remote-worker attachment joins readonly no-leak conformance when that generalized consumer is scheduled | `boring-bash test` |
| pr8-two-phase-fingerprint | BBP5-009 | new | ~400–600 | same fingerprint skips; changed source/contract re-provisions; onSession reruns; Vercel snapshot tests pass | `test` |
| pr9-governance-550-hardening | BBP5-011 + BBP5-012 (Amendment 2026-07-06; #550 gaps 2 + 7) | new | ~100–200 | governance-disabled readiness/diagnostics signal with stable code; non-dev missing `BORING_GOVERNANCE_COMPANY_CONTEXT_ROOT` fails closed (no cwd fallback); dev fallback preserved | governance plugin tests |

**P5a v1:** pr1, pr2, pr3, pr6, pr7, pr8, and the non-dev governance fail-closed slice of pr9. **P5b post-v1:** SDK archives, managed services, and remote-worker attachment/mount generality. Preconditions: P3 + P2 matrix/runsc provider + E1 attachment lifetime. Orchestration is host-owned; the agent consumes normalized bound inputs. Zero dangling `TODO(remove:*)`.

### X1 — S3/FUSE mounts (post-v1; do not merge before a native-mount consumer)

Adds the `@hachej/boring-sandbox/mounts` export (created package from P2) + the S3-backed environment. The 10 LOCKED DECISIONS in [`work/X1-s3-fuse-mounts/TODO.md`](work/X1-s3-fuse-mounts/TODO.md) are the spine. Reuses P5's `reported | unknown` fail-closed rule + host-side secrets-broker rule and consumes E1's `EnvironmentAttachment.mountPath` contract; without E1, X1 STOPs instead of inventing a parallel environment seam.

| PR | beads | nature | net-new vs budget | test deliverables | gate |
| --- | --- | --- | --- | --- | --- |
| pr1-rclone-mount-lifecycle | BBX1-001 + BBX1-002 | new | ~600–900 (`./mounts` export, concrete rclone mount module, per-session lifecycle) | rclone argv (`--vfs-cache-mode full` + tuned timeout/retry); no generic `MountDriver` interface; readiness gate (mountinfo + stat/readdir); lazy-unmount + reap; `ENOTCONN` re-mount vs `EIO` retry; per-session isolation | `boring-sandbox check:invariants`; `boring-sandbox test` |
| pr2-bind-capability | BBX1-003 + BBX1-004 | new | ~300–500 (bwrap bind + `mounts.fuseS3` fact) | host-mount→`--(ro-)bind`, no `/dev/fuse`/`fusermount3`/cred in arg set; un-ready bind refused; `vercel`/`unknown` fail closed | `boring-sandbox test`; `audit:imports` |
| pr3-cred-broker-env | BBX1-005 + BBX1-006 | new | ~700–1000 (STS broker + S3 `Environment` + no-leak mount) | prefix-scoped STS (sibling-prefix denied, MinIO); cred in mount-process env only + absent everywhere else; readonly-S3 no-leak conformance mount `passed:true`; `bash-sees-mount == file-routes-see-mount` | `check:isolation`; `boring-bash test` |
| pr4-eu-matrix | BBX1-007 | test + new | ~150–250 (EU matrix) | MinIO round-trip (adds `test:mounts:eu` script); secrets negative test; endpoint-config parity OVH/Scaleway/MinIO; fuse-overlayfs variant deferred, not built | `boring-sandbox run test:mounts:eu` (new script); `boring-sandbox test` |
| pr5-rclone-fuse-benchmark | BBX1-009 | test/bench | 0 code beyond bench harness | rerun the rclone-FUSE-vs-local benchmark after correcting the recorded PATH/ordering defects; existing numeric thresholds are provisional evidence only and must not be locked until the corrected readonly/backend-down and performance runs agree | `boring-sandbox run bench:mounts` (new script); publish corrected raw results before thresholds |

**X1 total: 5 post-v1 PRs.** Preconditions remain P2, P5a, E1, and a named native-mount consumer. X1 does not gate P8/v1. Open PR #581 remains draft/deferred until attachment integration, secret brokering, identical bash/file visibility, no-leak proof, and credential canaries are present.

### P6 — Definition/resolution v1; plugin + child-app expansion post-v1

**P6-D identities are landed via #623 under accepted decision 21.** The v1
surface owns only the minimal `AgentDefinition` and `AgentDeployment`
schemas/digests and immutable definition assets. **P6-R waits for P6-D, the P1
workspace boundary, and narrow P5a**, then resolves statelessly through the
existing authorized workspace composer. P6-R creates no deployment, registry,
generation store, plugin snapshot, attachment catalog, or scoped registrar.

| PR | beads | nature | net-new vs budget | test deliverables | gate |
| --- | --- | --- | --- | --- | --- |
| pr1-definition-deployment-schema | BBP6-009 | new | ~300–500 | behavior-only definition; minimal deployment identity + pinned definition reference; canonical digests; runtime/environment/plugin/prompt/pricing/host/exposure fields reject | core/cli `test` |
| pr2-definition-registry | BBP6-003 | new | ~200 (Map-backed) | `(definitionId,version)` verified bundle register/get/list; same digest idempotent, conflicting digest stable error; asset tamper/traversal rejects; works after checkout removal | agent `test` |
| pr3-resolved-agent | BBP6-011 | new | ~250–450 | statelessly combines verified definition/deployment with existing authorized workspace composition and narrow runtime/readiness facts; same inputs return the same digest/result; no persistence or loader | core/agent `test` |
| pr2b-remote-worker-image-support **post-v1** | BBP6-009b | new | ~60–120 | remote-worker image support follows the P5b handshake and reads deployment/runtime facts, never definition behavior | boring-sandbox/host readiness `test` |
| pr4-manifest-requires-bash-skill-filters **post-v1** | BBP6-002 | new | ~450–800 | requirements validate against active authority and resolved environment facts; invalid `bash` rejected pre-import; raw-secret reject | `lint:plugin-invariants` |
| pr4-runtime-plugin-context | BBP6-004 | new | ~300–500 | context derived from policy (unspoofable); status-only secrets; dispatch unchanged | workspace `test` |
| pr5-hosted-fail-closed | BBP6-005 | new | ~400–600 | hosted mode fails closed; iframe sandbox/CSP asserted; symlink/special-file rejected | `test` |
| pr6-shared-workspace-runtime | BBP6-007 | new (unify) | ~300–500 | CLI/full-app/workspace share the runtime unit; reload + registry dispose on eviction | core/cli/full-app `test` |
| pr7-multitenant-reload | BBP6-008 | new | ~300–500 | reload per workspace; unauthorized → stable error; pure reload w/o bash; trusted routes diagnosed-not-hot | full-app `test` |
| pr8-per-agent-plugin-composition **post-v1, after P7 routing** | BBP6-010 | new | ~350–650 | additive schema version introduces `pluginRefs` with resolver; declaring agent gets plugin tools/skills/MCP/renderers; sibling does not; UI/routes use trusted `agentId`; duplicates fail unless an explicit validated override policy exists | workspace/core/cli `test`; `lint:plugin-invariants` |

**P6b — child-app scoping (HARD BLOCKED until `docs/issues/376/plan.md`→`ResolvedChildAppContext`/#376 lands).**

| PR | beads | nature | net-new vs budget | test deliverables | gate |
| --- | --- | --- | --- | --- | --- |
| pr9-childapp-context 🚫blocked | BBP6-001 | new | ~300–500 (type-only import of platform type) | generic excludes child-app scope; narrows-never-widens; unknown id → stable error | `test` — **STOP+report if platform type absent** |
| pr10-macro-scoping 🚫blocked | BBP6-006 | new + fixture | ~250 | Macro context yields Macro reqs; generic excludes; no leakage | `test` |

**P6 v1 total: 3 PRs** (definition/deployment schema, Map lookup, stateless
resolution). A1 and D1 are the real consumers. P6-R consumes the existing
authorized workspace composition and adds no plugin loader, per-agent refs, or
requirement policy. Manifest requirements/per-agent/hosted/reload/remote-worker-
image work and P6b child-app scoping are post-v1; P6b remains blocked on #376.

### P7 — Multi-agent routing and inspection (post-v1, off P6-R, E1, T2)

| PR | beads | nature | net-new vs budget | test deliverables | gate |
| --- | --- | --- | --- | --- | --- |
| pr1-agentid-scope-namespace | BBP7-001 | new | ~250–400 | two agents/one workspace → distinct `scope.key` + `sessionNamespace`; default-agent namespace unchanged | agent `test` |
| pr2-agentid-addressing | BBP7-002 | new | ~200–350 (locked `/api/v1/agents/:agentId/…`) | declared resolves; undeclared → `AGENT_NOT_FOUND`; absent/empty → 404; explicit `/agents/default/` → default agent | `test` |
| pr3-per-agent-catalog-readiness | BBP7-003 | new | ~300–500 | per-agent catalog differs; reviewer readonly/no-exec vs coding bash vs pure concierge; no readiness bleed | `test` |
| pr4-session-search **later P7 increment** | BBP7-004 | new | ~500–800 (derived `agent.db` index; no fs requirement) | trusted structured session scope, content match, redaction, deep-link, rebuild proof | `test` |
| pr5-agent-info-endpoint | BBP7-005 | new | ~250–400 (public, models.ts posture) | reports model/tools/readiness/channels/environments; **no key/secret field** | `test` |
| pr6-external-hook-target | BBP7-006 | new | ~300–500 (boring-bash-free) | valid resolves+emits on stream; foreign/unauth rejects; redacted; audited | `check:isolation` |
| pr7-surface-agent-binding | BBP7-007 | new | ~120 | two panes/threads → two scopes; one key never two `agentId` | `audit:imports` (guard green) |
| pr8-subagent-grant | BBP7-008 | new (lands E1 BBE1-005) | ~150 (boring-bash) | child lifetime isolated by `agentId`; auth-gated callback per operation; no raw handle/cwd; expired/foreign lease rejects | `boring-bash test` |
| pr9-two-surface-isolation | BBP7-009 | test | 0 | two-surfaces×two-agents namespace-isolation integration (bindings/catalog/transcript/readiness/approvals; `sessionId` remains runtime-global) | `test` |

**P7 total: 9 PRs (8 if pr7+pr8 combine).** Precondition: the stateless P6-R resolved-value contract + E1 attachments + **T2**. P7, not P6-R, owns any registry-backed multi-agent routing/lookup it introduces. The `sessionId`-only public transport + two-handles guard and durable approvals/`resolveInput` arrive via T1→T2; otherwise STOP and re-specify.

### D1 — Multi-agent Docker host revisions (v1, after A1 + P6-R; D1-R0-SPEC.md merged #649)

Preconditions are P6-D/A1, the P1 boundary, and stateless P6-R. **P2/runsc and
P5a are not D1 gates (D1-R0 §1).** P3, E1, T1/T2, M2, plugin snapshots,
attachment catalogs, and P6 generation/session-retirement machinery are not
dependencies. The table below is the D1-S1 vertical slice exactly as specified
in [D1-R0-SPEC.md §8](work/D1-tenant-provisioning/D1-R0-SPEC.md); it replaces
the earlier pr1…pr8/BBD1-001…007 tracer table.

| Bead | Files | Budget | Deliver |
| --- | --- | --- | --- |
| D1-001 — plan and composition identity | new `apps/full-app/src/server/deployment/d1Plan.ts`, `workspaceComposition.ts`, focused tests; minimal descriptor exports from `plugins.ts` and host composition wiring only | <= 400 net lines; 25 min | strict plan validation, canonical redacted composition snapshot/digest, final requirement inventory validation, exact stable errors; no filesystem mutation, Compose, routing, or CLI yet |
| D1-002 — immutable revision store and local CLI | new `apps/full-app/src/server/deployment/hostRevisionStore.ts`, `deployment/cli.ts`, tests, one private script entry in `apps/full-app/package.json` | <= 400 net lines; 25 min | plan/apply dry-run, OS lock, expected-revision CAS, immutable candidate/COMPLETE records, atomic pointer, audit, destructive confirmation, rollback-as-new-revision; no HTTP management route |
| D1-003 — stable-process Compose adapter | new `deploy/d1/compose.yml`, `deploy/d1/collection.example.json`, `apps/full-app/src/server/deployment/composeAdapter.ts`, focused tests | <= 400 net lines; 25 min | one ingress plus one full-collection core process; pinned image, external `databaseRef`, durable workspace/session roots, per-binding env plus external tmpfs secret inputs; no `--force-recreate`, blanket rollback, secret values, or source-checkout mounts |
| D1-004a — trusted host surface | new `deployment/hostSurface.ts`, landing handler, focused tests, minimal `main.ts` wiring, trusted-proxy config in `createCoreApp.ts`/config schema | <= 400 net lines; 25 min | explicit proxy CIDR/hop parsing (never generic `trustProxy: true`), active-revision site map, bounded escaped landing, fixed same-origin auth return, scope derivation, internal readiness |
| D1-004b — workspace authority fences | shared optional scope contract in core app server types; surgical updates/tests in `workspaces.ts`, `postSignupHook.ts`, managed-workspace membership/account-deletion paths | <= 400 net lines; 30 min | member-only bound list; create/foreign switch/delete/default auto-provision denial; operator-owned managed lifecycle; generic-host behavior preserved byte-for-byte |
| D1-004c — remaining selector conformance | inventory full-app agent/MCP/plugin/pane/WorkspaceBridge selectors first; split one PR per route family if over budget | <= 400 net lines per PR; 25 min | every selector rejects a foreign caller value before lookup/effects and derives default deployment from scope; no generic policy framework |
| D1-004d — durable admission ledger | one Drizzle migration + schema export; new `deployment/admissionLedger.ts`; focused tests; narrow first-effect hook through D1 host scope | <= 300 net lines; 20 min | insert/read-only `(hostId, bindingId)` admission rows with DB-allocated monotonic sequence; transaction commit before first agent effect; idempotent concurrent admission; restart recovery; no update/delete API |
| D1-005 — collection boot and atomic publication | new `deployment/{bootCollection,preloadSignal}.ts`; integrate D1-001/002/003/004 seams in `main.ts`; focused integration tests | <= 400 net lines; 30 min | read one immutable revision, perform N independent P6-R calls, preload all bindings through root-owned pending pointer/signal, wait for all-ready ack, atomically publish additive/landing-only pointer; invalid pending state and one failed binding leave old collection active |
| D1-006 — EU-host proof and runbook | `work/D1-tenant-provisioning/RUNBOOK.md`, narrow proof script under `scripts/`, `golden-path.json` evidence path (owned by P8) | <= 300 net lines; 20 min | boot/add-agent/apply/rollback/cleanup commands; three distinct agents/workspaces/hostnames in one EU deployment; three independent P6-R digests; setup-to-first-success timing; idempotent additive apply; N+1 continuity; exact rollback as a new revision; secret canary |

**D1 total: 9 beads (D1-001…006, with D1-004 split a–d) per D1-R0-SPEC.md §8.**
D1-001…006 are dispatched. D1 is the
repeatable multi-agent Docker host lane. Its generic landing/auth/workspace handoff is
v1; bespoke marketing pages, pricing/GTM, and shared tenancy remain outside v1.

### D2 — Shared-deployment subdomain tenancy (post-v1)

**Amendment (2026-07-08):** D2 is the shared subdomain tier, sibling to D1's dedicated/sovereign tier. It is a factory-lane sidecar work package, not a P8 runtime gate.

| PR | beads | nature | net-new vs budget | test deliverables | gate |
| --- | --- | --- | --- | --- | --- |
| pr1-host-tenant-router | BBD2-001 | new | ~500–900 | trusted host adapter resolves `TenantContext { tenantId, workspaceId, principal }`; unknown/malformed/foreign host fails closed; caller `SessionCtx` is not authority | affected host `test` |
| pr2-live-tenant-registry | BBD2-002 | new | ~700–1200 | valid tenant spec installs one binding; rerun idempotent; duplicate host/workspace and unknown declaration refs fail closed; no raw secrets in snapshots/logs | affected host build/typecheck/test |
| pr3-hot-tenant-seeding | BBD2-003 | new | ~500–900 | hot new-tenant roots/env-pool/skills/context seeding; missing seed ref fails closed; rerun applies safe delta; no broker secret enters tenant files/sandbox env | provisioning tests; secret canary |
| pr4-isolation-conformance | BBD2-004 | test + new | ~400–800 | two live subdomain tenants in one process; no cross-read of sessions/files/pending-inputs/search/artifacts/governance; unknown host and no-secret-cross-tenant canaries | `TenantIsolationConformance`; affected e2e |
| pr5-lifecycle-demo-gate | BBD2-005 | new | ~400–700 | suspend/archive/delete behavior; public-demo obeys per-tenant `demoPolicy`/`exposureId` and never widens data scope | host `test`; policy tests |
| pr6-authoring-tool | BBD2-006 | new | ~300–600 | `plan_tenant` dry-run no side effects; `register_tenant` apply; `tenant_status` redacted readiness; invalid YAML/unknown refs fail closed | agent/host `test` |
| pr7-tier-reconciliation-smoke | BBD2-007 | test/doc | ~150–300 | `tier:'shared'` uses D2 hot path; `tier:'dedicated'` uses D1 manifest path; fake-provider smoke covers both | fake-provider smoke |

**D2 total: 7 PRs.** Hard start gate: successful unchanged D1 delivery to at
least two distinct tenants, trusted `TenantContext` proof, and written owner GO.
Then requires P6-D + separate E1 catalog + P6-R, BBP6-010, P1 tenancy roots,
P5, P7 routing/info, T1 structured durable scope, and M2 exposure policy. D2 is
independent of #376 child-app hostname resolver.

### P8 — Version 1 verification + cleanup

| PR | beads | nature | net-new vs budget | test deliverables | gate |
| --- | --- | --- | --- | --- | --- |
| pr1-reduced-invariant-gates | BBP8-001 + BBP8-003 recut | new (invariant scripts) | ~100 | v1-owned removal-marker check plus applicable core/package/#416 import boundaries; residual grep for `runtime.*none|pure.*mode` across product code and non-historical docs with explicit rejection/history allowlist; no T1/T2/P3/E1 relocation gate | `lint:invariants`; `audit:imports` |
| pr2-shipped-contract-docs | BBP8-002 recut | doc | 0 | document workspace-backed core, minimal definition/deployment bundle, local workspace/runtime, and D1 path only | doc/link check |
| pr3-golden-path-and-followups | BBP8-006 + BBP8-004 | test/doc/tracking | ~200–400 | measure and break down compile/local/D1 exact-host/member/workspace/default-agent setup-to-first-run on real EU runsc; compare with the provisional 15-minute target; selector/lifecycle denials, no-op reapply, complete-snapshot rollback, secret proof | CLI/D1 smoke + elapsed-time report — **pull-forward slice landed via [#664](https://github.com/hachej/boring-ui/pull/664): golden-path script+json+CI gates** |

**P8 total: 3 PRs.** BBP8-005 remains the final sweep rather than a separate
PR. P8 gates only P1, P6-D/A1, narrow P2/P5a, stateless P6-R, and D1. T1/T2,
full P3, E1, and every later lane are tracked but not awaited or documented as
shipped.

### S3 — Control-plane UX (Phase S3, off T2 + P7) — **DELTA, extend existing surfaces**

| PR | beads | nature | net-new vs budget | test deliverables | gate |
| --- | --- | --- | --- | --- | --- |
| pr1-fleet-page | BBS3-001 | new (only genuinely-new surface) | ~350–550 (registers via existing `PanelRegistry` + `WorkspaceSourceRegistry`) | Fleet page fetches `GET /api/v1/agents`, enriches rows from `GET /api/v1/agents/:agentId/info`, and provides a read-only per-agent drill-down (sessions, pending approvals, environments); reviewer readonly+no-bash; pure=no envs; **no secret field**; `FleetPage` tests | workspace `test`; `lint:plugin-invariants` |
| pr2-crosssurface-sessions | BBS3-002 | new (rewire, not rebuild) | ~200–350 (`SessionSummary.originSurface` additive) | slack-origin badge + `origin:` filter; missing field defaults workspace; transcript reuses `PiChatPanel` by `sessionId` | agent+workspace `test` |
| pr3-central-approval-inbox | BBS3-003 | new (generalize ask-user `InboxOverlay`) | ~250–400 (front-only; source → T1 `agent.sessions.pendingInputs(ctx, { sessionId? })`) | two-session/two-surface inbox; `resolveInput` on answer; single source (no second channel) | `audit:imports`; **STOP+report if `agent.sessions.pendingInputs(ctx, { sessionId? })` absent** |
| pr4-controlplane-integration | BBS3-004 | test | 0 | one workspace inspects 2 agents + observes/approves 2 surfaces via public contracts only | workspace `test`; `workspace-playground test:e2e` |

**S3 total: 4 PRs.** Consumes P7 `GET /api/v1/agents` + `/info` + BBP7-004 search + T1 `agent.sessions.pendingInputs(ctx, { sessionId? })` (STOP+report if missing). No new registry/host; observe-only (agent-as-directory authoring deferred).

### S4 — Agent onboarding status (after S3 + M2 + D1 + D2)

| PR | beads | nature | net-new vs budget | test deliverables | gate |
| --- | --- | --- | --- | --- | --- |
| pr1-status-model-client | BBS4-001 | new | ~250–450 | normalized onboarding status per agent; missing refs render stable blocking codes; secret canary absent | workspace `test` |
| pr2-onboarding-panel | BBS4-002 + BBS4-003 | new | ~350–650 | read-only Fleet drill-down status for definition readiness, demo URL status, provisioning status, missing policy refs; no authoring controls | workspace `test`; plugin invariants |
| pr3-onboarding-integration | BBS4-004 | test | 0 | ready + blocked agent scenario; no create/configure controls; public contracts only | workspace `test` |

**S4 total: 3 PRs.** Consumes S3 Fleet/inspection, M2 demo exposure status, D1 dedicated provisioning status, and D2 shared-tier tenant readiness. S4 is read-only onboarding/status; it does not turn S3 into an authoring UI.

---

## Milestone accounting

Do not sum every future plan into one project estimate. Each increment is
estimated and accepted independently.

| Milestone | Remaining/open program | Exit |
| --- | --- | --- |
| **R0 vertical tracer** | optional workspace-backed recut of #549/#556 after P1 boundary | stock MCP client completes one bounded workspace-backed run; no prE/T1 gate |
| **V1 definition/authoring** | P6-D and A1 compiler landed; workspace-backed dev remains | directory validates, runs in an explicit workspace/runtime, emits deterministic digest |
| **V1 runtime minimum** | #628 structural preflight landed; P1 lifecycle/readiness, EU spike, and P5a D1 facts remain | approved EU runsc path, authenticated readiness, no secret/scope leak |
| **V1 dedicated delivery** | stateless P6-R, reduced D1, reduced P8 | measured dedicated URL -> landing -> authorized workspace -> default agent, idempotent rerun, rollback; evaluate the 15-minute target from evidence |
| **Post-v1** | T1/T2, full P3, E1, P4, E2, X1, P5b, P6 expansion, P7, M2, D2, S3/S4 | separately scheduled against their own consumer and risk trigger |

There is no truthful single serial PR count. The current ancestry and remaining
legacy PR dispositions are below; stack order is not execution authority:

| Open PR(s) | Current disposition |
| --- | --- |
| #543/#545/#547 | historical/superseded; do not revive no-environment work |
| #616/#617/#622 | landed workspace-first boundary and correction |
| #623/#624 | landed minimal identities and deterministic compiler |
| #626/#627 | landed core relocation and terminal local binding disposal |
| #628 | landed structural preflight only; `productionReady: false` |
| #566 | defer; capability projection belongs only in the actual stateless P6-R consumer |
| #568 | defer until a named workspace/runtime input-asset consumer exists |
| #575/#576 | superseded by focused current-main lifecycle and readiness slices |
| #546, #559 | freeze post-v1 with all T1/T2 descendants |
| #548 | superseded by #628 structural seam; add only evidence-led D1 follow-ups |
| #558 | defer the Vercel provider move; it is not in the dedicated EU runsc minimum |
| #564 | close/defer; no pure-only binary or broad mode/provider cutover in v1 |
| #549, #556 | optional R0 outreach leaf; rebase/review only as workspace-backed, with no prE/T1 dependency |
| #581 | keep draft/deferred until E1/P5a and a real native-mount consumer reopen X1 |

Next P1 work is request-binding/service teardown lifecycle, followed by
fail-closed readiness. Next P2 evidence is the real-EU validation spike. Do not
append to or revive superseded stacks.

Across moved-code stacks, each vertical PR migrates consumers and removes the
old origin atomically. A temporary bridge is allowed only with a named deletion
owner and cannot outlive its increment.
