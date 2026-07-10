# PR-PLAN — #391 runtime refactor, implementation as a stacked PR series

## 2026-07-09 execution reset

This file retains post-v1 PR designs, but only the milestone graph in
[`INDEX.md`](INDEX.md) determines what blocks delivery. The immediate review
queue is the already-open P1/M1/T1/P2 work; X1 is deferred. New implementation
assignments contain one bead/PR, not an entire package TODO.

Release 0 proves one managed agent through a stock MCP client. Version 1 adds a
minimal agent-directory compiler, separates reusable `AgentDefinition` from
tenant-specific `AgentDeployment`, and proves one dedicated EU deployment from
exact hostname -> landing -> authenticated workspace -> deployed default agent.
Shared tenancy, FUSE, external environment MCP projection, control-plane UX,
hosted child apps, advanced services, search/hooks, and subagent grants are
post-v1 increments.

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

| PR | beads | nature | net-new vs budget | test deliverables | gate |
| --- | --- | --- | --- | --- | --- |
| pr1-config-inventory | BBP1-001 | doc | 0 | none (inventory doc); records tool/renderer source provenance needed for environment-bundle -> plugins -> host duplicate checks | grep reproducers resolve |
| pr2-createagent-facade ⚠split | BBP1-002 | new | ~800–1200 / 2000 — **at risk, split pre-declared** | façade unit: 9-member API (`start`,`stream`,`send`,`resolveInput`,`interrupt`,`stop`,`sessions`,`readiness`,`dispose`) constructs w/o Fastify; `send` yields ≥1 event via live tail; historical `startIndex` throws `ERR_NOT_IMPLEMENTED_UNTIL_T1`; `interrupt`/`stop` wrap the existing `HarnessPiChatService` control methods | `lint:invariants`; `check:isolation` |
| pr3-adapters-thin | BBP1-003 | new (refactor) | ~400–800 / 2000 (mostly churn into façade) | parity guarded by existing suites + pr6 | full agent `test` + `test:e2e` (parity) |
| pr4-pure-runtime-none | BBP1-004 | new | ~300–600 | pure-mode route/tool exclusion; session round-trip under `sessionStorageRoot` w/ `workspaceId` undefined; no cwd leak | `lint:invariants` |
| pr5-pi-harness-audit | BBP1-005 | doc + new (seals) | ~150 seals | harness-construction spy (no host cwd); system-prompt snapshot (no cwd/AGENTS.md) | `test` |
| pr6-invariants-smoke | BBP1-006 | test | 0 (tests + script) | Fastify-graph check on `/core`; agent→bash value-import check; plain-Node pure smoke turn | `lint:invariants`; `check:isolation`; `boring-bash check:invariants` |
| prA-facts-projection | BBP1-007 | new | M | `ResolvedAgentCapabilities` projection through existing capability exposure; pure facts report `environments: []`, actual registered tools, empty skills/MCP; direct/local/vercel get coarse compatibility environment facts | agent `test`; capability route tests |
| prB-de-mode-gating | reopened-P1 follow-up | new | S/M | remove runtimeMode feature gating; derive input-asset intake from environment sinks/direct-provider policy; no behavior branches on `runtimeMode` except diagnostics/migration shims | agent `test`; T2 BBT2-007 alignment |
| prC-core-relocation | reopened-P1 follow-up | move + new | M/L | move/split core implementation under `src/core/createAgent.ts`; server wrapper injects Pi/defaults; `/core` graph imports no server/Pi defaults unless injected | `lint:invariants`; `check:isolation` |
| prD-readiness-honesty | reopened-P1 follow-up | new | S/M | readiness/lifecycle state is honest: no placeholder false-ready state; runtime binding eviction disposes agents or reports tracked lifecycle | agent `test`; readiness smoke |
| prE-admission-attribution | new P1 reliability closeout | new | M | `start`/`send` share one admission rule; request idempotency keys by trusted scope + authenticated subject; cross-subject ids isolate; actor/origin persist; duplicate tools fail; caches bounded | agent `test`; managed-delegate regression |

**P1 total: 11 PRs (12 if pr2 splits).** Merge order pr1→pr5→pr2(→a,b)→pr3→pr4→pr6→prA→prB→prC→prD→prE. **Gate to call rewritten P1 complete:** pr2..pr6 plus prA..prE merged. Runtime lanes must not consume capability facts until prA lands; input-asset consumers must not branch on `runtimeMode` after prB. T1/T2 and multi-surface delivery do not proceed until prE fixes admission, retry, attribution, and catalog semantics.

### M1 — Managed agent via MCP (outreach demo sidecar, after P1 prE)

M1 is the Release 0 vertical tracer, not the v1 factory exit. It establishes a measured delivery baseline while the generic authoring path is built. It still follows the outreach-week operating mode: additive/dark until smoke proof, e2e green, review-time estimate + review-focus notes on every PR, and explicit stack order.

| PR | beads | nature | net-new vs budget | test deliverables | gate |
| --- | --- | --- | --- | --- | --- |
| pr1-exposed-mcp-delegate | BBM1-001 | new | ~700–1100 | bearer binds subject/tenant/agent; required subject-scoped caller idempotency key dedupes before quota; lost-response/new-tool-call-id retry starts once; bounded progress/polling; auth/quota negatives | chosen host/package `test`; `audit:imports` |
| pr2-delivery-v0-demo-composition | BBM1-002 | new | ~300–700 | byte caps: brief 32 KiB, key 128 B, final 96 KiB, Markdown 256 KiB, serialized total 384 KiB; stable rejects/no path; temporary config names A1 owner; actor/origin/request id reach core | host build/typecheck/test |
| pr3-stock-client-smoke | BBM1-003 | test/doc | 0 | authenticated stock client proof: delegate -> progress -> inline result; same key under new tool-call id returns original; auth/quota/size negatives | documented smoke + affected e2e |
| pr2b-share-links (HARD GATED on #424) | BBM1-004 | new | ~150–400 | current-main public-share API cited; returned URL uses verified share route; share opens without exposing internals | host build/typecheck/test; share route smoke |

**M1 total: 3 PRs (v0) + 1 gated follow-up.** Preconditions: P1 through prE admission/idempotency/attribution closeout. R0 is bearer-only and self-contained (final text + bounded inline Markdown); public-demo and general artifact download wait for M2/#424. M1 has no T1 dependency; durable streams upgrade later.

### A1 — Minimal agent-directory authoring (v1, after P6-D)

| PR | beads | nature | net-new vs budget | acceptance | gate |
| --- | --- | --- | --- | --- | --- |
| pr1-directory-compiler | BBA1-001 | new | ~300–500 | `agents/<name>/agent.json` + `instructions.md` compile import-free to self-contained `CompiledAgentBundle`; deterministic digest covers canonical definition + immutable assets; unknown keys/refs fail with stable codes | CLI/core typecheck + unit |
| pr2-validate-dev | BBA1-002 | new | ~250–450 | `boring-ui agent validate <dir>` and `boring-ui agent dev <dir>` use the same compiled bundle later materialized by D1; one local scripted turn; zero platform-source edits | CLI smoke |
| pr3-migrate-r0-config | BBA1-003 | move/delete | ~150–300 | when M1 exists, it resolves the compiled bundle; temporary `ManagedAgentVerticalConfig` projection is removed or reduced to a documented host-only deployment adapter | M1 stock-client smoke |

**A1 v1 total: 2 PRs, plus one conditional R0 migration PR.** BBA1-001 may
start after P6-D; BBA1-002 waits for P6-R so it uses the normal host resolver.
BBA1-003 is a P8 gate when M1/R0 exists on main; only proven absence removes
that gate. Keep v1 conventions deliberately small: one schema,
one instructions file, reference ids rather than executable discovery, and no
pricing, hostname, exposure, tenant, or runtime-image fields in the definition.

### M2 — MCP as an agent surface (registry-driven, after P7 + T2)

M2 turns M1's sidecar shape into a committed surface backed by immutable
`ResolvedAgent` behavior plus deployment/host-owned exposure config. It is the ingress dual of E2: E2 exposes environments
over MCP; M2 exposes declared agents over MCP.

| PR | beads | nature | net-new vs budget | test deliverables | gate |
| --- | --- | --- | --- | --- | --- |
| pr1-mcp-exposure-config | BBM2-001 | new | ~250–450 | `ResolvedAgent` behavior + `AgentDeployment`/host-owned `McpAgentExposureConfig`; `authMode: bearer\|public-demo`, `demoPolicy`, `exposureId`; unknown deployment refs fail closed; definition alone exposes nothing | agent/host `test` |
| pr2-mcp-surface-adapter | BBM2-002 | new | ~500–900 | subject/demo-principal scoped caller key maps to T1 receipt and dedupes before quota; lost-response/new-call-id starts once; M1 byte budgets; approval/progress works | host build/typecheck/test |
| pr3-auth-demo-policy | BBM2-003 | new | ~300–600 | bearer invalid/foreign rejects; public-demo obeys demo policy and never widens environment facts | host `test`; secret canary |
| pr4-result-share-conformance | BBM2-004 | test + new | ~200–400 | bounded aggregate result/share shape stable; exact size boundaries; retry proof; no raw paths/secrets | documented smoke + affected e2e |

**M2 total: 4 PRs.** Preconditions: P7 registry/info endpoints and T1/T2 transport. M2 is a committed surface follow-up; it does not retroactively make M1 a runtime-exit gate.

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

### P2 — Scaffold `@hachej/boring-sandbox` + move providers into it; `resolveMode` → boring-bash (Phase 2, off P1)

**Package re-target (00 open decision 3 RESOLVED; 08 decision 11):** concrete providers move to the **new `@hachej/boring-sandbox`** package (`packages/boring-sandbox/src/providers`), **not** `boring-bash/providers`; runtime-mode resolution (`resolveMode`) lands in `@hachej/boring-bash`. Acyclic: `boring-sandbox → agent(types)`; `boring-bash → boring-sandbox(values) + agent(types)`.

| PR | beads | nature | net-new vs budget | test deliverables | gate |
| --- | --- | --- | --- | --- | --- |
| pr0-sandbox-scaffold | BBP2-000 (new package) | new | ~150 (package.json, tsup, `/shared`+`/providers` export maps, `check-invariants.mjs`; `pnpm-workspace.yaml` already has `packages/*`, verify not duplicate) | new-package `build`/`typecheck`; export-map resolves; invariant script asserts agent-types-only import boundary | new-package `build`; `audit:imports` |
| pr1-providers-subpath-matrix | BBP2-001 + BBP2-002 | new | ~250 (capability contract + matrix in `boring-sandbox/shared`) | export-map `boring-sandbox/shared` + `boring-sandbox/providers`; per-fixed-provider matrix rows live in shared; `remote-worker` worker-dependent fields are static `'unknown'`; fail-closed runtime validation/tests deferred to BBP5-008 | `boring-sandbox check:invariants` |
| pr2-move-direct-bwrap | BBP2-003 | move | budget-exempt (~1.5k churn) | moved direct/bwrap conformance + snapshot pass under **boring-sandbox**; `createNodeWorkspace`/`getNodeWorkspaceHostRoot`/path helper importers migrated with the slice | `boring-sandbox test` |
| pr3-move-vercel-sandbox | BBP2-004 | move | budget-exempt (~2.5–3k churn, <4k) | vercel-sandbox unit tests pass under boring-sandbox; `createVercelSandboxWorkspace` owned/exported by boring-sandbox providers; no provider adapter value-imports agent provisioning helpers | `boring-sandbox test` |
| pr3b-sandbox-publish-parity | BBP2-009 (Amendment 2026-07-06) | chore | ~30–60 (five publish lists + cohort version bump; lands BEFORE pr4's bash→sandbox value edge) | `node scripts/audit-publish-manifests.mjs` passes with sandbox listed; grep gate: sandbox present in all five lists, ordered before `packages/boring-bash` | `audit:imports`; publish-manifest audit |
| pr4-mode-resolution-to-bash | BBP2-005 | move | budget-exempt (~1k churn) | `resolveMode.test` passes in **boring-bash**; deployed/tenant composers fail closed when no approved provider is available; `direct` requires explicit trusted-local policy; mode-private helpers moved/injected; no agent value import in `boring-bash/modes`; **agent bin becomes pure-only**, bash-enabled bin composition moves to CLI | agent `test` (host repoint); `boring-bash test` |
| pr5-split-remote-worker | BBP2-006 | move | budget-exempt (~1k churn) | protocol → `boring-sandbox/shared`, client/adapter/workspace → `boring-sandbox/providers`; bytes round-trip; full-app worker import-graph has no agent-core dep; worker health remains `{ ok: true }`; **worker capabilities stay `'unknown'` — NO handshake here (handshake owned solely by BBP5-008)** | `audit:imports` |
| pr6-migrate-delete-invariants | BBP2-007 + BBP2-008 | move (delete origin exports) + new (invariant) | ~80 (invariant script) | static: agent old paths have no bash/sandbox value import / no re-export (including moved workspace helpers); boring-bash→sandbox value edge + sandbox→agent types-only edge both asserted; apps compile | `lint:invariants`; `audit:imports` |
| pr7-hardened-runsc-provider | BBP2-010 | new | ~600–1000 | runsc systrap preflight/lifecycle; OCI digest; netns/nftables metadata/private/cross-workspace denial; cgroup/pid/CPU/memory limits; no broker secret; exact cleanup; real EU worker evidence | `boring-sandbox test`; real-target smoke |

**P2 total: 9 PRs** (adds pr0 scaffold, pr3b publish parity, and the v1
hardened runsc provider). BBP2-009 must merge before pr4. Precondition: P1
injection seam present (else STOP+report). No `@hachej/boring-agent` minor bump
here; the relocation minor bump is P3 per `INDEX.md`/`08`.

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
| pr1-mcp-server-exec-gating | BBE2-001 + BBE2-004 | new | ~400–600 (+ pinned SDK, `./mcp`) | factory derives one ref-bound lifetime from P6-R catalog; no mismatched contribution injection; per-call E1 auth; no raw ops/lease/secret | `boring-bash check:invariants`; build |
| pr2-mcp-session-identity | BBE2-002 | new | ~250 (token-per-projection) | per-call validation; revoked/expired/foreign and invalidated lifetime reject after connect; two actors isolated | `boring-bash test` |
| pr3-mcp-conformance-doc | BBE2-003 + BBE2-005 | test + doc | 0 | MCP-mount conformance `passed:true`, same visible-path set; remote-worker-as-transport filed as **P8** follow-up (doc); duality note confirms E2 exposes MCP and does not share machinery with boring-mcp consume | `boring-bash test` |

**E2 total: 3 PRs.** SDK pinned exact `1.29.0` (no caret).

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
| pr5-rclone-fuse-benchmark | BBX1-009 | test/bench | 0 code beyond bench harness | repeatable rclone-FUSE-vs-local edit/build benchmark over MinIO; locked thresholds encoded from `/home/ubuntu/projects/x1-bench/report.md` (`2026-07-05 12:22 UTC`): warm `rg <= 0.18s`, append-100 `<= 0.05s`, `git init+commit <= 4.7x local`, seq-write-50M `<= 4.40s`; caches-on-local-NVMe variant measured; readonly/backend-down semantics stay in BBX1-007 smoke tests | `boring-sandbox run bench:mounts` (new script); encoded numeric thresholds |

**X1 total: 5 post-v1 PRs.** Preconditions remain P2, P5a, E1, and a named native-mount consumer. X1 does not gate P8/v1. Open PR #581 remains draft/deferred until attachment integration, secret brokering, identical bash/file visibility, no-leak proof, and credential canaries are present.

### P6 — Definition/resolution v1; plugin + child-app expansion post-v1

**P6-D is dispatchable after P1.** It owns only schemas, digesting, and the Map
registry. **P6-R follows E1/P5a plus P3 BBP3-020** and resolves a definition,
deployment, and workspace-level activated-plugin snapshot to one immutable
`ResolvedAgent`. This snapshot consumption is the narrow v1 plugin exception;
per-agent plugin UI/routes wait for P7's agent-aware routing and the remaining
plugin generality below is post-v1.

| PR | beads | nature | net-new vs budget | test deliverables | gate |
| --- | --- | --- | --- | --- | --- |
| pr1-definition-deployment-schema | BBP6-009 | new | ~300–500 | behavior-only definition; deployment has sorted opaque attachment refs and no E1 import; canonical digests; pricing/host/exposure absent; v1 `pluginRefs` rejects | core/cli `test` |
| pr2-definition-registry | BBP6-003 | new | ~200 (Map-backed) | `(definitionId,version)` verified bundle register/get/list; same digest idempotent, conflicting digest stable error; asset tamper/traversal rejects; works after checkout removal | agent `test` |
| pr3-resolved-agent | BBP6-011 | new | ~500–800 | consumes P3 activated-plugin snapshot; source-labeled static prompt plan/digest; one deterministic artifact-pin owner and per-digest mutation CAS reconcile pin-before-record, delete-before-release, and concurrent stage/delete; host complete-pointer; boot-digest admission check; atomic session pin; same-generation restart; changed-generation retirement (D1 owns switch) | core/agent `test` |
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

**P6 v1 total: 3 PRs** (definition/deployment schema, Map registry, resolved
snapshot). A1 and D1 are the real consumers. P6-R consumes P3 BBP3-020's
workspace-level snapshot but adds no plugin loader, per-agent refs, or
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

**P7 total: 9 PRs (8 if pr7+pr8 combine).** Precondition: P6-R `ResolvedAgentRegistry` + E1 attachments + **T2** (the `sessionId`-only public transport + two-handles guard; the durable approvals/`resolveInput` the external-hook route and `/info` channel facts read arrive via T1→T2) (else STOP+report).

### D1 — Dedicated tenant provisioning (v1, after A1 + P5a + P6-R)

| PR | beads | nature | net-new vs budget | test deliverables | gate |
| --- | --- | --- | --- | --- | --- |
| pr1-plan-command-api | BBD1-001 | new | ~550–900 | tenant+agent selector binds deployment + immutable host-app/plugin snapshot + worker/endpoint/TLS-pin/app/hostname identity; atomic cross-target hostname/app uniqueness; bounded landing + opaque owner ref; retarget rejects; desired digest/generation/fence | affected package `test` |
| pr2-tenant-roots | BBD1-002 | new | ~400–700 | tenant/single owner-bound workspace created once; owner identity redacted; DB/storage/session roots allocated outside container home/root; rerun idempotent | core/cli/full-app `test` |
| pr3-secrets-runtime-config | BBD1-003 | new | ~400–700 | raw secret canary absent; runtime config records selected EU host/tier facts and exact auth origin/callback allowlist | `audit:imports`; secret negative tests |
| pr4-endpoint-preparation | BBD1-004a | new | ~400–700 | install trusted host-mode guard before route work: generic reserved/no-pointer deny and dedicated exact-bound-host-only; materialize/verify bundle + pinned host-app/plugin/static-prompt inputs; prepare route/certificate and verifier consumer; stage P6-R; emit prepublication manifest; no fake readiness, pointer CAS, or external activation | affected host build/typecheck/test |
| pr5-dedicated-workspace-scope | BBD1-005 | new | ~800–1400 | extend pr4's guard: generic behavior only on its configured listener; dedicated non-bound host rejects; reserved/complete derives fixed scope; D1 mounts only P3 scoped routes and rejects raw routes; cover explicit/indirect selectors, full-app MCP/plugins/UI/Bridge, post-signup provisioning, account deletion and ownership mutation; create/switch/delete disabled | core/workspace/full-app build/typecheck/test |
| pr6-dedicated-site-journey | BBD1-006 | new | ~300–600 | exact-host bounded landing; existing-member sign-in; membership-gated trusted workspace handoff; forged workspace/agent selectors reject; first chat uses deployed `default` identity | core/full-app build/typecheck/test + focused e2e |
| pr7-publication-integration | BBD1-004b | new | ~350–650 | consume real BBD1-005/006 capability; no-op requires same desired + fresh current-resolved reproduction; resolved fact drift transitions/fails closed; desired-only/same-resolved publishes without restart; changed resolved commits pointer+switch_pending, switches, retires, disables old listener, then reopens; pre-CAS preserves old, post-CAS completes forward | affected host build/typecheck/test |
| pr8-apply-smoke-runbook | BBD1-007 | test/doc | ~300–500 | real URL -> landing -> member workspace -> default agent; same-generation real restart preserves session; changed apply/rollback each retire replaced sessions; staged/pre-CAS crash keeps old routed; stale worker zero effects; rollback reproduces host-app/plugin + desired/resolved identity with new observed completion digest | provisioning smoke |

**D1 total: 8 PRs.** Preconditions: A1, P2 hardened runsc,
P5a authenticated worker facts, and P6-R. M2 is not a dependency. D1 is the
repeatable dedicated factory lane. Its generic landing/auth/workspace handoff is
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
| pr1-marker-import-gates | BBP8-001 + BBP8-003 | new (invariant scripts) | ~150 | planted removal marker fails + names bead; delivered P2/P3/T1/T2 relocation gates green; no P4/X1 gate | `lint:invariants`; `audit:imports` |
| pr2-surface-contract-docs | BBP8-002 | doc | 0 | referenced symbols (`createAgent`,`AgentEvent`,`AgentSendInput`,`ResolveInputResponse`) exist | doc/link check |
| pr3-golden-path-and-followups | BBP8-006 + BBP8-004 | test/doc/tracking | ~200–400 | timed A1->D1 on real EU runsc via pinned worker TLS; exact host/landing/member/fixed workspace/default agent; scoped-route/host denials; fresh-resolved no-op and resolved-fact drift; old-origin stale rejection; capability replay rejection; pointer-before-publication; identity/stale-fence/rollback/secret proof | CLI/D1 smoke |

**P8 total: 3 PRs.** BBP8-005 remains the final sweep rather than a separate PR. A live `TODO(remove:*)` reopens its owner. P8 gates only P1, T1/T2, P2/P3, E1, P5a, P6-D/P6-R, A1, and D1. It explicitly does not wait for P4, E2, X1, P5b, P6 plugin/child-app expansion, P7, M2, D2, S3, or S4.

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
| **R0 vertical tracer** | finish current P1 stack + P1 prE; rebase #549/#556 | stock MCP client completes one attributed/idempotent vertical run |
| **V1 definition/authoring** | P6-D (2), A1 (3) | directory validates, runs locally, emits deterministic digest |
| **V1 reliable transport** | remaining T1 + T1 recovery; T2 | in-process/HTTP parity, transactional approvals, explicit crash recovery |
| **V1 optional runtime** | remaining P2; P3; E1; P5a | one attached environment, honest provider selection, no secret/scope leak |
| **V1 dedicated delivery** | P6-R (1), D1 (8), P8 (3) | timed <=15-minute dedicated URL -> landing -> authorized workspace -> default agent, idempotent rerun, digest rollback |
| **Post-v1** | P4, E2, X1, P5b, P6 expansion, P7, M2, D2, S3/S4 | separately scheduled against their own consumer and risk trigger |

There is no truthful single serial PR count because the transport, runtime, and
definition lanes join at D1/P8 and several current branches must be rebased or
split. Review and merge the active queue in this order:

1. `#557` publish prerequisite.
2. P1: `#543 -> #545 -> #547 -> #566 -> #568 -> #575 -> #576`, then P1 prE.
3. R0 when needed for outreach: `#549 -> #556`.
4. T1 after P1: `#546`, then split/correct `#559`, then crash recovery.
5. P2 after P1: `#548 -> #558`, then split/correct `#564`.
6. Keep `#581` draft/deferred until E1/P5a and a real native-mount consumer.

Across moved-code stacks, each vertical PR migrates consumers and removes the
old origin atomically. A temporary bridge is allowed only with a named deletion
owner and cannot outlive its increment.
