# PR-PLAN — #391 runtime refactor, implementation as a stacked PR series

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
| **BBD1-004** demo endpoint + deployment manifest | L/XL tenant provisioning slice | pr4a: demo endpoint config + exposure policy · pr4b: EU deployment manifest + host profile matrix — only if >2k |

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

**P1 total: 10 PRs (11 if pr2 splits).** Merge order pr1→pr5→pr2(→a,b)→pr3→pr4→pr6→prA→prB→prC→prD. **Gate to call rewritten P1 complete:** pr2..pr6 plus prA..prD merged. Runtime lanes must not consume capability facts until prA lands; input-asset consumers must not branch on `runtimeMode` after prB.

### M1 — Managed agent via MCP (outreach demo sidecar, after P1 pr2)

M1 is not a runtime-epic exit gate; it is the owner's outreach demo artifact. It still follows the outreach-week operating mode: additive/dark until smoke proof, e2e green, review-time estimate + review-focus notes on every PR, and explicit stack order.

| PR | beads | nature | net-new vs budget | test deliverables | gate |
| --- | --- | --- | --- | --- | --- |
| pr1-exposed-mcp-delegate | BBM1-001 | new | ~600–1000 | fake MCP client delegates one brief; one delegation creates one agent session via `createAgent().start`; progress notification or polling fallback works; secret canary absent | chosen host/package `test`; `audit:imports` |
| pr2-delivery-v0-demo-composition | BBM1-002 | new | ~300–700 | result carries final text + workspace-relative artifact refs (inline content for small text artifacts, documented cutoff); before P6a, `ManagedAgentVerticalConfig` is the local v0 demo-host config; after P6a, demo config mounts by `agentId` from `AgentDefinitionDeclaration` and the M1 config becomes a temporary lossless projection only; no raw workspace/session path in caller payload | host build/typecheck/test |
| pr3-stock-client-smoke | BBM1-003 | test/doc | 0 | stock MCP client proof: delegate brief -> progress -> result with resolvable artifact reference | documented smoke + affected e2e |
| pr2b-share-links (HARD GATED on #424) | BBM1-004 | new | ~150–400 | current-main public-share API cited; returned URL uses verified share route; share opens without exposing internals | host build/typecheck/test; share route smoke |

**M1 total: 3 PRs (v0) + 1 gated follow-up.** Preconditions: P1 pr2 façade merged. **Ruling 2026-07-06:** #424 verified unmerged on main at execution time; delivery v0 is decoupled (final text + artifact refs, no share links) and `pr2b-share-links` is HARD GATED on #424 merging — it is not part of the M1 v0 exit. M1 works on the P1 live-tail and has **no T1 dependency**; durable streams upgrade later.

### M2 — MCP as an agent surface (registry-driven, after P7 + T2)

M2 turns M1's sidecar shape into a committed surface backed by the canonical
agent definition registry. It is the ingress dual of E2: E2 exposes environments
over MCP; M2 exposes declared agents over MCP.

| PR | beads | nature | net-new vs budget | test deliverables | gate |
| --- | --- | --- | --- | --- | --- |
| pr1-mcp-exposure-config | BBM2-001 | new | ~250–450 | definition-derived `McpAgentExposureConfig`; `authMode: bearer\|public-demo`, `demoPolicy`, `exposureId`; unknown refs fail closed | agent/host `test` |
| pr2-mcp-surface-adapter | BBM2-002 | new | ~500–900 | fake MCP client drives a declared agent through T1/T2 transport; approval/progress path works | host build/typecheck/test |
| pr3-auth-demo-policy | BBM2-003 | new | ~300–600 | bearer invalid/foreign rejects; public-demo obeys demo policy and never widens environment facts | host `test`; secret canary |
| pr4-result-share-conformance | BBM2-004 | test + new | ~200–400 | result/share URL shape stable; no raw paths/secrets; stock-client smoke | documented smoke + affected e2e |

**M2 total: 4 PRs.** Preconditions: P7 registry/info endpoints and T1/T2 transport. M2 is a committed surface follow-up; it does not retroactively make M1 a runtime-exit gate.

### T1 — Durable event stream + on-stream approvals (Phase T1, off P1)

| PR | beads | nature | net-new vs budget | test deliverables | gate |
| --- | --- | --- | --- | --- | --- |
| pr1-eventstore ⚠split | BBT1-001 | new (vendor/adapt) | ~1000–1400 / 2000 — **at risk, split pre-declared** | `events.db`-backed `runEventStreamStoreConformance`: monotonic offsets, idempotent `appendEventOnce`, **transactional atomicity (no gap on mid-append throw)**, subscribe/unsubscribe; `:memory:` + temp-file | agent `test`; node:sqlite (no native dep) |
| pr2-envelope-tap | BBT1-002 | new | ~200–400 | `harnessPiChatService.eventStore.test`: N events, contiguous `eventIndex`, durable-before-delivery | `test` |
| pr3-ds-routes-stream | BBT1-003 | new | ~900–1300 / 2000 (port of `handle-stream-routes` ~594 + route + `stream`) | route test (GET/HEAD/304/SSE/abort); `stream` replay-from-index; SSE drop→re-GET lossless | `lint:invariants` (façade Fastify-free) |
| pr4-approvals-park-resume | BBT1-004 | new | ~700–1000 | `approval.test` (park/resolve/deny/cross-client); `state.db`-backed `pendingInputs.test` (redacted, durable, cross-session; not `events.db`) | `test` |
| pr5-askuser-onto-stream | BBT1-005 | move + delete | net-new ~150; deletes second channel | adapted ask-user e2e; `ask_user.execute` parks + resolves via `resolveInput`; grep `ask-user.v1.` → no live handler | `lint:invariants`; `audit:imports` |
| pr6-conformance | BBT1-006 | test | 0 | envelope-ordering, replay-from-index, **durable pending-request survival across restart** (seeded turn, no `WaitingTurn`) | `test` |

**T1 total: 6 PRs (7 if pr1 splits).** Blocks T2, S1, and any consumer of durable replay/approvals.

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
| pr4-mode-resolution-to-bash | BBP2-005 | move | budget-exempt (~1k churn) | `resolveMode.test` passes in **boring-bash** (resolves mode id → boring-sandbox provider value); mode→provider pairs covered; mode-private helpers (`createServerFileSearch`, template copy, artifact helpers) moved/injected; no agent value import in `boring-bash/modes`; **agent bin becomes pure-only (`runtime:'none'`), bash-enabled bin composition moves to `packages/cli` in THIS PR** | agent `test` (host repoint); `boring-bash test` |
| pr5-split-remote-worker | BBP2-006 | move | budget-exempt (~1k churn) | protocol → `boring-sandbox/shared`, client/adapter/workspace → `boring-sandbox/providers`; bytes round-trip; full-app worker import-graph has no agent-core dep; worker health remains `{ ok: true }`; **worker capabilities stay `'unknown'` — NO handshake here (handshake owned solely by BBP5-008)** | `audit:imports` |
| pr6-migrate-delete-invariants | BBP2-007 + BBP2-008 | move (delete origin exports) + new (invariant) | ~80 (invariant script) | static: agent old paths have no bash/sandbox value import / no re-export (including moved workspace helpers); boring-bash→sandbox value edge + sandbox→agent types-only edge both asserted; apps compile | `lint:invariants`; `audit:imports` |

**P2 total: 7 PRs** (adds pr0 scaffold). Precondition: P1 injection seam present (else STOP+report). No `@hachej/boring-agent` minor bump here; the relocation minor bump is P3 per `INDEX.md`/`08`. New package `@hachej/boring-sandbox` scaffolded in pr0 and populated across pr1–pr5.

### P3 — Move file/bash routes + tools → boring-bash (Phase 3, off P2)

| PR | beads | nature | net-new vs budget | test deliverables | gate |
| --- | --- | --- | --- | --- | --- |
| pr1-agent-subpath-feature | BBP3-010 | new | ~120 (`/agent` subpath + `createBashAgentFeature()` skeleton returning `{ tools, readinessRequirements, systemPromptFragment }`) | export-map `/agent`; bundle type includes prompt fragment; bundle marked as the environment-bundle source in tool/renderer resolution | `boring-bash check:invariants` |
| pr2-move-filesystem-tools ⚠ | BBP3-011 | move | budget-exempt (large; split by tool family if >4k) | moved fs-tool tests; spoof-guard + readonly-reject preserved; `disableDefaultFileTools` parity | `boring-bash test`; company_context no-leak green |
| pr3-move-bash-upload | BBP3-012 + BBP3-013 | move | budget-exempt | bash/isolated-code readiness+redaction; upload stable errors | `boring-bash test` |
| pr4-move-fs-git-routes ⚠ | BBP3-014 | move | budget-exempt (large; split by route family if >4k) | moved route tests; git-root == file-root == bash-cwd | `boring-bash test` |
| pr5-wire-composition | BBP3-015 | new (server plugin + direct-composer wiring) | ~300–500 (boring-bash server plugin; workspace-family hosts register internal/default plugin; direct composers hand-wire only if they bypass the plugin pipeline) | pure-mode composition has no file routes/tools or bash prompt fragment; bash-enabled workspace-family hosts get routes/tools and `systemPrompt` through the server plugin; any direct CLI/library composer has explicit library wiring including `systemPromptFragment` append; duplicate tools/renderers fail typed unless later source sets `overrides:true` | `lint:invariants`; `audit:imports`; `check:isolation` |
| pr6-sot-tests-invariants | BBP3-016 + BBP3-017 | test + new (invariant) | ~80 | source-of-truth regression; `disableDefaultFileTools` parity; boundary invariant | `lint:invariants` |

**P3 total: 6 PRs.** Precondition: P1 (`tools` injection, no `features`) + P2 present. `packages/agent` ends with **zero** boring-bash imports (bin included).

### P4 — Move filesystem front plugin → boring-bash/plugin (Phase 4, off P3)

| PR | beads | nature | net-new vs budget | test deliverables | gate |
| --- | --- | --- | --- | --- | --- |
| pr1-plugin-subpath-sdk | BBP4-010 | new | ~150 (`/plugin` entry + public workspace SDK imports; no adapter) | export-map `/plugin` front-safe; front-safe scan on `src/plugin/**` | `boring-bash check:invariants` |
| pr2-move-front-plugin ⚠split | BBP4-011 (+ BBP4-012) | move | budget-exempt (**far >4k — split into pr2a/b/c pre-declared**) | moved plugin `__tests__` pass; plugin imports public workspace SDK directly; tree fn returns current shape | `lint:invariants`; static edge gate |
| pr3-move-tool-renderers | BBP4-015 | move | ~300–600 (renderer split/move; tests move with it) | `definePlugin({ toolRenderers })` registers `bash`/`read`/`write`/`edit`/`find`/`grep`/`ls`; pure-mode front default renderer map has none of those ids | agent + boring-bash front tests |
| pr4-composer-providers | BBP4-016 | new + move | ~300–600 (generic composer provider seam + file provider move) | #26 `@file` mention provider, file slash commands, `@files:` enrichment, and upload affordance exist only with bash plugin attached; pure-mode front has no `/api/v1/files/search` request path | agent + boring-bash front tests |
| pr5-remove-static-registration | BBP4-014 | move (delete workspace export/static default registration) + new (guard) | ~60 | `exec_ui openFile` opens moved panel; `rg -n "from ['\"]@hachej/boring-bash|import\\(['\"]@hachej/boring-bash" packages/workspace/src` → 0 | `lint:plugin-invariants`; `audit:imports` |

**P4 total: 5 PRs (7 if pr2 splits into 3).** BBP4-013 document-authority write/edit override seam is **deferred out of this epic** (zero real consumers — arrives with #367/#226; filed at P8 BBP8-004) — **no PR here**. Precondition: P3 write/edit tools + routes in boring-bash. Cycle safety is the static workspace edge guard: `packages/workspace/src` must not import `@hachej/boring-bash`; `boring-bash/plugin` may import the public workspace plugin SDK because the host loads it dynamically through the plugin pipeline. Capability-residue closeout: detaching bash leaves no file prompt, API, renderer, or composer-provider residue in pure mode.

### E1 — Environment attachments (Phase E1, off P2 **and** P3)

| PR | beads | nature | net-new vs budget | test deliverables | gate |
| --- | --- | --- | --- | --- | --- |
| pr1-env-contracts | BBE1-001 | new (types) | ~150 | `.test-d` compile assertion: attachment narrows to `FilesystemBinding` selector | `boring-bash typecheck` |
| pr2-resolve-attachments | BBE1-002 | new | ~250–400 (reduction/delegation, **no registry/Map**) | two distinct attached runtimes with `RuntimeFilesystemBinding[]` filesystem facets plus matching methodless `ResolvedEnvironment[]` facts; no opaque handles returned; dispose evicts | `boring-bash test` |
| pr3-company-context-env | BBE1-003 | new (adapter) | ~200 | reference attachment == direct provider visible-path set; `execPolicy:'none'` | `readonlyCompanyContext*` green |
| pr4-scoped-view-jail | BBE1-004 | new | ~250–400 | subpath jail (sibling denied); `..` rejected; **symlink-escape denied (realpath-based)** | `boring-bash test` |
| pr5-agent-typeonly-conformance | BBE1-006 + BBE1-007 | new (type-only field + invariant) + test | ~80 | agent value-import fails / `import type` passes; scoped-view conformance mount `passed:true` | `audit:imports`; `lint:invariants` |

**E1 total: 5 PRs.** No edits to landed #416 declarations (additions only). BBE1-005 subagent seam **deferred to P7**.

### E2 — MCP environment projection (Phase E2, off E1)

| PR | beads | nature | net-new vs budget | test deliverables | gate |
| --- | --- | --- | --- | --- | --- |
| pr1-mcp-server-exec-gating | BBE2-001 + BBE2-004 | new | ~400–600 (+ pinned `@modelcontextprotocol/sdk@1.29.0`, `./mcp` subpath, address-by-id Map) | readonly attachment omits write/edit/exec; denied path → no leak; exec presence tracks `execPolicy`; no broker-secret leak | `boring-bash check:invariants`; build (`./mcp` bundles) |
| pr2-mcp-session-identity | BBE2-002 | new | ~250 (token-per-projection) | valid token → ctx; unknown rejected; two actors can't cross-read | `boring-bash test` |
| pr3-mcp-conformance-doc | BBE2-003 + BBE2-005 | test + doc | 0 | MCP-mount conformance `passed:true`, same visible-path set; remote-worker-as-transport filed as **P8** follow-up (doc); duality note confirms E2 exposes MCP and does not share machinery with boring-mcp consume | `boring-bash test` |

**E2 total: 3 PRs.** SDK pinned exact `1.29.0` (no caret).

### P5 — Provisioning / readiness / secrets / services (Phase 5, off P3)

| PR | beads | nature | net-new vs budget | test deliverables | gate |
| --- | --- | --- | --- | --- | --- |
| pr1-bash-requirement-normalizer | BBP5-001 | new | ~600–900 | merge-by-id; conflict/unsafe-id reject; capability-vs-provider reject; import-free proof; no raw secret | `boring-bash check:invariants`; `audit:imports` |
| pr2-repoint-callers | BBP5-002 | new (host wiring) | ~300–500 | existing provisioning tests unchanged; plugin `bash.nodePackages` reaches engine via normalizer | core/workspace/cli `test` |
| pr3-readiness-health | BBP5-003 + BBP5-004 | new | ~400–700 | `optional_failed` derived state; per-requirement detail; health gates dependent tool; timeout retryable | agent `test` |
| pr4-sdk-archive | BBP5-005 | new | ~300–500 | archive installs + fingerprint-skip; no host-path leak; runtime-visible rewrite | `test` |
| pr5-managed-service ⚠split | BBP5-006 | new | ~700–1000 — **split pre-declared if >2k** | start→health→port-grant; teardown kills tree; denied exec/ports blocks; no raw secret in env | `test` |
| pr6-secret-brokering | BBP5-007 | new | ~500–800 | status without value; **brokering negative test — no sandbox-side read of brokered secret**; no serialization to browser/model/log/artifact | `check:isolation`; `smoke:capability-readiness` |
| pr7-remote-worker-handshake | BBP5-008 (+ BBP5-010 mount) | new + test | ~300–500 | reported\|unknown facts; fail-closed on unknown/bad-contract; no silent downgrade; **BBP5-010** remote-worker no-leak conformance mount (the deferred remote-worker env mount) rides here, gated on this handshake | `full-app smoke:remote-worker`; `boring-bash test` |
| pr8-two-phase-fingerprint | BBP5-009 | new | ~400–600 | same fingerprint skips; changed source/contract re-provisions; onSession reruns; Vercel snapshot tests pass | `test` |

**P5 total: 8 PRs.** Preconditions: P3 + P2 `shared/providerMatrix.ts` (else STOP+report). Engine stays agent-owned; normalizer boring-bash-owned. Zero dangling `TODO(remove:*)`.

### X1 — S3/FUSE mounts for `@hachej/boring-sandbox` environments (Phase X1, off P2 **and** P5 **and** E1) — bash lane, parallel to E2

Adds the `@hachej/boring-sandbox/mounts` export (created package from P2) + the S3-backed environment. The 10 LOCKED DECISIONS in [`work/X1-s3-fuse-mounts/TODO.md`](work/X1-s3-fuse-mounts/TODO.md) are the spine. Reuses P5's `reported | unknown` fail-closed rule + host-side secrets-broker rule and consumes E1's `EnvironmentAttachment.mountPath` contract; without E1, X1 STOPs instead of inventing a parallel environment seam.

| PR | beads | nature | net-new vs budget | test deliverables | gate |
| --- | --- | --- | --- | --- | --- |
| pr1-rclone-mount-lifecycle | BBX1-001 + BBX1-002 | new | ~600–900 (`./mounts` export, concrete rclone mount module, per-session lifecycle) | rclone argv (`--vfs-cache-mode full` + tuned timeout/retry); no generic `MountDriver` interface; readiness gate (mountinfo + stat/readdir); lazy-unmount + reap; `ENOTCONN` re-mount vs `EIO` retry; per-session isolation | `boring-sandbox check:invariants`; `boring-sandbox test` |
| pr2-bind-capability | BBX1-003 + BBX1-004 | new | ~300–500 (bwrap bind + `mounts.fuseS3` fact) | host-mount→`--(ro-)bind`, no `/dev/fuse`/`fusermount3`/cred in arg set; un-ready bind refused; `vercel`/`unknown` fail closed | `boring-sandbox test`; `audit:imports` |
| pr3-cred-broker-env | BBX1-005 + BBX1-006 | new | ~700–1000 (STS broker + S3 `Environment` + no-leak mount) | prefix-scoped STS (sibling-prefix denied, MinIO); cred in mount-process env only + absent everywhere else; readonly-S3 no-leak conformance mount `passed:true`; `bash-sees-mount == file-routes-see-mount` | `check:isolation`; `boring-bash test` |
| pr4-eu-matrix | BBX1-007 | test + new | ~150–250 (EU matrix) | MinIO round-trip (adds `test:mounts:eu` script); secrets negative test; endpoint-config parity OVH/Scaleway/MinIO; fuse-overlayfs variant deferred, not built | `boring-sandbox run test:mounts:eu` (new script); `boring-sandbox test` |
| pr5-rclone-fuse-benchmark | BBX1-009 | test/bench | 0 code beyond bench harness | repeatable rclone-FUSE-vs-local edit/build benchmark over MinIO; locked thresholds encoded from `/home/ubuntu/projects/x1-bench/report.md` (`2026-07-05 12:22 UTC`): warm `rg <= 0.18s`, append-100 `<= 0.05s`, `git init+commit <= 4.7x local`, seq-write-50M `<= 4.40s`; caches-on-local-NVMe variant measured; readonly/backend-down semantics stay in BBX1-007 smoke tests | `boring-sandbox run bench:mounts` (new script); encoded numeric thresholds |

**X1 total: 5 PRs** (BBX1-008 overlay variant is deferred out of X1). Preconditions: P2 (`@hachej/boring-sandbox` + providers), P5 (capability-fact + secrets-broker), **and E1** (`Environment`/`EnvironmentAttachment.mountPath`) present, else STOP+report. Off the critical path (bash-lane parallel after P2/P5/E1); gates into P8 like every delivered phase. EU-sovereign: MinIO-in-CI, no US-hosted default (invariant 15).

### P6 — Plugin + child-app integration (Phase 6, off P5) — **split P6a / P6b**

**P6a — child-app-independent (dispatchable after P5).** Grep-gated: BBP6-002/003/004/009 contain **zero** `childAppId`/`workspaceKind`/`ChildApp`.

| PR | beads | nature | net-new vs budget | test deliverables | gate |
| --- | --- | --- | --- | --- | --- |
| pr1-agent-registry | BBP6-003 | new | ~150 (Map-backed) | register/get/list/has/delete; duplicate-id policy; grep-gate no child-app fields | agent `test` |
| pr2-agents-declaration | BBP6-009 | new | ~300–600 (definition schema + seed) | two-agent `AgentDefinitionDeclaration` seeds two registry entries + default; absent decl → one implicit `default`; dup/bad-default/unknown refs rejected; same-definition projection for P7/M1/M2/S1/S2/S3/S4/D1; grep-gate no child-app fields | workspace/core/cli `test` |
| pr3-manifest-requires-bash-skill-filters | BBP6-002 | new | ~450–800 | requirements evaluated against resolved environment facts; invalid `bash` rejected pre-import; import-free proof; raw-secret reject; skill `boring.requires`-style filter at loader boundary; generated skills-index prompt fragment uses the filtered set; grep-gate clean | `lint:plugin-invariants` |
| pr4-runtime-plugin-context | BBP6-004 | new | ~300–500 | context derived from policy (unspoofable); status-only secrets; dispatch unchanged | workspace `test` |
| pr5-hosted-fail-closed | BBP6-005 | new | ~400–600 | hosted mode fails closed; iframe sandbox/CSP asserted; symlink/special-file rejected | `test` |
| pr6-shared-workspace-runtime | BBP6-007 | new (unify) | ~300–500 | CLI/full-app/workspace share the runtime unit; reload + registry dispose on eviction | core/cli/full-app `test` |
| pr7-multitenant-reload | BBP6-008 | new | ~300–500 | reload per workspace; unauthorized → stable error; pure reload w/o bash; trusted routes diagnosed-not-hot | full-app `test` |

**P6b — child-app scoping (HARD BLOCKED until `docs/issues/376/plan.md`→`ResolvedChildAppContext`/#376 lands).**

| PR | beads | nature | net-new vs budget | test deliverables | gate |
| --- | --- | --- | --- | --- | --- |
| pr8-childapp-context 🚫blocked | BBP6-001 | new | ~300–500 (type-only import of platform type) | generic excludes child-app scope; narrows-never-widens; unknown id → stable error | `test` — **STOP+report if platform type absent** |
| pr9-macro-scoping 🚫blocked | BBP6-006 | new + fixture | ~250 | Macro context yields Macro reqs; generic excludes; no leakage | `test` |

**P6 total: 9 PRs (7 P6a + 2 P6b follow-up).** `AgentRegistry` (pr1) + the workspace `agents: [...]` declaration (pr2) are the P7 consumers that justify them. **P6b (pr8/pr9) is a tracked follow-up OUTSIDE the epic exit** — HARD BLOCKED on the shared child-app platform type; it does **not** gate P7 (P7 consumes P6a only) and does **not** gate P8. The epic ships on the 7 P6a PRs; the 2 P6b PRs land whenever `ResolvedChildAppContext`/#376 lands.

### P7 — Multi-agent routing/session/search + inspection (Phase 7, off P6a **and** E1 **and** T2)

| PR | beads | nature | net-new vs budget | test deliverables | gate |
| --- | --- | --- | --- | --- | --- |
| pr1-agentid-scope-namespace | BBP7-001 | new | ~250–400 | two agents/one workspace → distinct `scope.key` + `sessionNamespace`; default-agent namespace unchanged | agent `test` |
| pr2-agentid-addressing | BBP7-002 | new | ~200–350 (locked `/api/v1/agents/:agentId/…`) | declared resolves; undeclared → `AGENT_NOT_FOUND`; absent/empty → 404; explicit `/agents/default/` → default agent | `test` |
| pr3-per-agent-catalog-readiness | BBP7-003 | new | ~300–500 | per-agent catalog differs; reviewer readonly/no-exec vs coding bash vs pure concierge; no readiness bleed | `test` |
| pr4-session-search | BBP7-004 | new | ~500–800 (derived `state.db`; no fs requirement) | agent-scoped session index/search table (`sessionId`, `agentId`, `workspaceId`, `originSurface`, title/status/timestamps), content match, redaction, deep-link `includeId`, rebuild proof | `test` |
| pr5-agent-info-endpoint | BBP7-005 | new | ~250–400 (public, models.ts posture) | reports model/tools/readiness/channels/environments; **no key/secret field** | `test` |
| pr6-external-hook-target | BBP7-006 | new | ~300–500 (boring-bash-free) | valid resolves+emits on stream; foreign/unauth rejects; redacted; audited | `check:isolation` |
| pr7-surface-agent-binding | BBP7-007 | new | ~120 | two panes/threads → two scopes; one key never two `agentId` | `audit:imports` (guard green) |
| pr8-subagent-grant | BBP7-008 | new (lands E1 BBE1-005) | ~150 (boring-bash) | scoped-view grant isolated by `agentId`; shares no handle; no cwd inheritance | `boring-bash test` |
| pr9-two-surface-isolation | BBP7-009 | test | 0 | two-surfaces×two-agents namespace-isolation integration (bindings/catalog/transcript/readiness/approvals; `sessionId` remains runtime-global) | `test` |

**P7 total: 9 PRs (8 if pr7+pr8 combine).** Precondition: P6a `AgentRegistry` + E1 attachments + **T2** (the `sessionId`-only public transport + two-handles guard; the durable approvals/`resolveInput` the external-hook route and `/info` channel facts read arrive via T1→T2) (else STOP+report).

### D1 — Tenant provisioning command/API (factory lane, after P5 + P6a + M2)

| PR | beads | nature | net-new vs budget | test deliverables | gate |
| --- | --- | --- | --- | --- | --- |
| pr1-plan-command-api | BBD1-001 | new | ~400–700 | dry-run plan schema; unknown definition/host/secret refs fail closed | affected package `test` |
| pr2-tenant-roots | BBD1-002 | new | ~400–700 | tenant/workspace created once; DB/storage/session roots allocated outside container home/root; rerun idempotent | core/cli/full-app `test` |
| pr3-secrets-runtime-config | BBD1-003 | new | ~400–700 | raw secret canary absent; runtime config records selected EU host/tier facts | `audit:imports`; secret negative tests |
| pr4-demo-manifest ⚠split | BBD1-004 | new | ~700–1200 — split pre-declared if >2k | M2 exposure config generated; deployment manifest has image digest, roots, network policy, no raw secrets | affected host build/typecheck/test |
| pr5-apply-smoke-runbook | BBD1-005 | test/doc | ~150–300 | fake/local-provider apply smoke; rollback/runbook covers every resource category | provisioning smoke |

**D1 total: 5 PRs (6 if pr4 splits).** Preconditions: P5 provisioning/secrets, P6a definition registry, and M2 exposure config for demo endpoints. D1 is the repeatable tenant factory lane; LP/GTM/pricing/CTA assets remain outside platform scope.

### P8 — Verification + cleanup (Phase 8, gates on runtime lanes EXCEPT P6b, M1, M2, D1, S4; M2 may land after P8)

| PR | beads | nature | net-new vs budget | test deliverables | gate |
| --- | --- | --- | --- | --- | --- |
| pr1-marker-import-gates | BBP8-001 + BBP8-003 | new (invariant scripts) | ~150 | planted `TODO(remove:*)` fails + names bead; each P2/P3/P4/T1/T2 relocation gate green; X1 mount gates green | `lint:invariants`; `audit:imports` |
| pr2-surface-contract-docs | BBP8-002 | doc | 0 | referenced symbols (`createAgent`,`AgentEvent`,`AgentSendInput`,`ResolveInputResponse`) exist | doc/link check |
| pr3-track-remaining-prose | BBP8-004 | doc/tracking | 0 | filed issue/bead list; `00` coverage reconciled (no overclaim) | n/a |

**P8 total: 3 PRs.** BBP8-005 (final invariant+build/test sweep) is the **merge gate on this stack**, not a separate PR — any red gate reopens its owning phase. **Rule: a live `TODO(remove:*)` marker reopens its phase; P8 never absorbs it.** **P8 gates on every delivered runtime lane EXCEPT P6b, M1, M2, D1, and S4; M2 may land after P8 but must be tracked as a committed follow-up** — P1–P7, T1–T2, E1–E2, **X1**, S1–S3, Phase 5, and P6a must be green. P6b is a tracked follow-up (HARD BLOCKED on the child-app platform type), not an epic exit gate; P8 only **verifies P6b plus M2/D1/S4 follow-up or status tracking** (BBP8-004) and never waits on those lanes landing (this is the anti-deadlock guarantee). M1 is the outreach-demo sidecar and has its own smoke closeout; D1 is tenant/factory provisioning, and S4 is onboarding status on top of S3.

### S1 — Slack reference channel (Phase S1, off T2 + P6a + P1)

| PR | beads | nature | net-new vs budget | test deliverables | gate |
| --- | --- | --- | --- | --- | --- |
| pr1-hono-fastify-wrapper-doc | BBS1-001 + BBS1-007 | new (+ `packages/channels/*` in `pnpm-workspace.yaml` and root `build:packages`) + doc | ~200 | exact-byte passthrough + status/header round-trip; example typechecks; root aggregate includes Slack package | new-package `build`/`typecheck`; `pnpm run build:packages` |
| pr2-skeleton-ingress-store | BBS1-002 + BBS1-003 | new | ~350–550 | one `agent.start()` per message (admission; runtime allocates `sessionId`, adapter writes `originSurface:'slack'`); dedupe on `event_id`; bot ignored; `state.db`-backed `conversationKey→sessionId` isolation (`Map` tests only) | `audit:imports` (no boring-bash) |
| pr3-egress-batching | BBS1-004 | new | ~250–400 | egress via `agent.stream(sessionId,{startIndex})`: N deltas <1s → 1 post + bounded updates; turn-end flush; 429 backoff | `test` |
| pr4-approvals-slack | BBS1-005 | new | ~250–400 | button → `resolveInput` right session/request; cross-surface answer consistent | `test` |
| pr5-conformance-suite | BBS1-006 | new (neutral `@hachej/boring-agent/testing`) + test | ~200 (suite) | message-in→out, approval round-trip, addressing isolation; runs `runtime:'none'` + readonly `company_context` | agent `build` (`./testing` subpath) |

**S1 total: 5 PRs.** `@flue/slack` pinned to the **exact resolved `1.0.0-beta.<N>`** — resolve and record the version + date before coding (BBS1-002 first action); never ship a `.x`/range placeholder. No shared channel-core package yet (single consumer). **Amendment (2026-07-08):** S1 waits on P6a/BBP6-009 and consumes `AgentDefinitionDeclaration` or a lossless projection for agent binding; do not invent a Slack-local agent schema.

### S2 — Spreadsheet embed contract (Phase S2, off S1 + P6a)

| PR | beads | nature | net-new vs budget | test deliverables | gate |
| --- | --- | --- | --- | --- | --- |
| pr1-embed-doc-guard | BBS2-001 + BBS2-004 | doc + new (guard) | ~40 | audit fails on any boring-bash import from embed | `audit:imports` |
| pr2-reference-embed-conformance | BBS2-002 + BBS2-003 | new (`apps/spreadsheet-embed-playground`) + test | ~300–500 | `write_range` parks on approval → projects on approve / unchanged on deny; conformance `passed:true` via `@hachej/boring-agent/testing` | `typecheck`; `test` |

**S2 total: 2 PRs.** Embed deps = `@hachej/boring-agent` only. **Amendment (2026-07-08):** S2 inherits the S1/P6a same-definition dependency and consumes `AgentDefinitionDeclaration` or a lossless projection for agent binding; do not invent an embed-local agent schema.

### S3 — Control-plane UX (Phase S3, off T2 + P7) — **DELTA, extend existing surfaces**

| PR | beads | nature | net-new vs budget | test deliverables | gate |
| --- | --- | --- | --- | --- | --- |
| pr1-fleet-page | BBS3-001 | new (only genuinely-new surface) | ~350–550 (registers via existing `PanelRegistry` + `WorkspaceSourceRegistry`) | Fleet page fetches `GET /api/v1/agents`, enriches rows from `GET /api/v1/agents/:agentId/info`, and provides a read-only per-agent drill-down (sessions, pending approvals, environments); reviewer readonly+no-bash; pure=no envs; **no secret field**; `FleetPage` tests | workspace `test`; `lint:plugin-invariants` |
| pr2-crosssurface-sessions | BBS3-002 | new (rewire, not rebuild) | ~200–350 (`SessionSummary.originSurface` additive) | slack-origin badge + `origin:` filter; missing field defaults workspace; transcript reuses `PiChatPanel` by `sessionId` | agent+workspace `test` |
| pr3-central-approval-inbox | BBS3-003 | new (generalize ask-user `InboxOverlay`) | ~250–400 (front-only; source → T1 `agent.sessions.pendingInputs(ctx, { sessionId? })`) | two-session/two-surface inbox; `resolveInput` on answer; single source (no second channel) | `audit:imports`; **STOP+report if `agent.sessions.pendingInputs(ctx, { sessionId? })` absent** |
| pr4-controlplane-integration | BBS3-004 | test | 0 | one workspace inspects 2 agents + observes/approves 2 surfaces via public contracts only | workspace `test`; `workspace-playground test:e2e` |

**S3 total: 4 PRs.** Consumes P7 `GET /api/v1/agents` + `/info` + BBP7-004 search + T1 `agent.sessions.pendingInputs(ctx, { sessionId? })` (STOP+report if missing). No new registry/host; observe-only (agent-as-directory authoring deferred).

### S4 — Agent onboarding status (after S3 + M2 + D1)

| PR | beads | nature | net-new vs budget | test deliverables | gate |
| --- | --- | --- | --- | --- | --- |
| pr1-status-model-client | BBS4-001 | new | ~250–450 | normalized onboarding status per agent; missing refs render stable blocking codes; secret canary absent | workspace `test` |
| pr2-onboarding-panel | BBS4-002 + BBS4-003 | new | ~350–650 | read-only Fleet drill-down status for definition readiness, demo URL status, provisioning status, missing policy refs; no authoring controls | workspace `test`; plugin invariants |
| pr3-onboarding-integration | BBS4-004 | test | 0 | ready + blocked agent scenario; no create/configure controls; public contracts only | workspace `test` |

**S4 total: 3 PRs.** Consumes S3 Fleet/inspection, M2 demo exposure status, and D1 provisioning status. S4 is read-only onboarding/status; it does not turn S3 into an authoring UI.

---

## Totals

| Lane / TODO | PRs (base) | with pre-declared splits | blocked |
| --- | --- | --- | --- |
| P0 | 1 | 1 | — |
| P1 | 10 | 11 | — |
| T1 | 6 | 7 | — |
| T2 | 7 | 7 | — |
| P2 | 7 | 7 | — |
| P3 | 6 | 6 (moves split by family only if >4k) | — |
| M1 | 4 | 3 + 1 gated (pr2b on #424) | sidecar (not P8 gate) |
| M2 | 4 | 4 | committed surface follow-up |
| P4 | 5 | 7 | — |
| E1 | 5 | 5 | — |
| E2 | 3 | 3 | — |
| P5 | 8 | 9 | — |
| X1 | 5 | 5 | — |
| P6 | 9 | 9 | 2 (P6b) |
| P7 | 9 | 9 | — |
| D1 | 5 | 6 | factory lane |
| P8 | 3 | 3 | — |
| S1 | 5 | 5 | — |
| S2 | 2 | 2 | — |
| S3 | 4 | 4 | — |
| S4 | 3 | 3 | onboarding/status follow-up |
| **TOTAL** | **111** | **~117** | 2 follow-up (P6b) + M1 sidecar + factory/onboarding follow-ups |

**Expected overall: ~111 PRs (up to ~117 if every pre-declared split fires). The 2 P6b PRs are a tracked follow-up OUTSIDE the epic exit (hard-blocked on the shared child-app platform type) — they do not gate P7 or P8. M1 is an outreach-demo sidecar and does not gate P8. M2 is the committed MCP agent-surface follow-up; D1/S4 are factory/onboarding follow-ups. P1 now includes reopened-P1 follow-ups A-D; T2 includes BBT2-007 input-asset intake; M2 adds 4 PRs; D1 adds 5 PRs (6 if its manifest slice splits); S4 adds 3 PRs.**

### Critical-path PR sequence (longest serial chain)

```
P0(1) → P1(10) → P2(7) → P3(6) → P5(8) → P6a(7) → P7(9) → P8(3)   = 51 PRs serial
```

- **All-factory serial path if D1/S4 are included:** `P0(1) → P1(10) → P2(7) → P3(6) → P5(8) → P6a(7) → P7(9) → M2(4) → D1(5) → S4(3) = 60 PRs serial` (S4 also needs S3, but S3's P7+T2 path is shorter than D1).
- **Off the same P1 root, in parallel:** the M1 outreach-demo sidecar `M1(3)` after P1 pr2 (share-link slice is separately gated on #424/public-share API), the transport lane `T1(6) → T2(7) → { S1(5) → S2(2) ; S3(4) → S4(3) }` with **S1/S2 also waiting on P6a/BBP6-009 for the same definition/projection**, the environment lane `E1(5) → E2(3)` (E1 also needs P3; E2 feeds no critical successor except P8), the **mount lane `X1(5)`** (needs P2+P5+E1; bash-lane parallel after those preconditions; feeds no critical successor except P8), and the **MCP/factory lane `M2(4) → D1(5) → S4(3)`** after P7/T2.
- **P7 also needs E1 and T2** (T2 formalizes the `sessionId`-only transport + two-handles guard P7's addressing/binding rides, and carries the T1 durable approvals/`resolveInput` the external-hook route and `/info` channel facts read); **S3 needs T2 + P7**; **P8 gates on every delivered runtime lane EXCEPT P6b, M1, M2, D1, and S4**. M2 is a committed surface follow-up and may ship after P8 if the runtime exit is otherwise green.
- **P6b** is off the critical path (a tracked follow-up, hard-blocked) and gates **neither P7 nor P8** (P7 consumes P6a only; P8 only verifies P6b plus M2/D1/S4 follow-up or status tracking) — so P6b's block can never deadlock the epic exit.
- **Package minor bumps** on the path: `@hachej/boring-agent` at P3 (relocation) and at T2 (protocol).

Merge-order rule across lanes: M1 v0 may open after P1 pr2 and is independent of the runtime lanes; only M1 `pr2b-share-links` waits on #424/public-share API. Nothing in P2 opens until rewritten P1's required seams/facts are green; E1 waits on both P2 and P3; P5 dispatches off P3 (not P4); X1 waits on P2+P5+E1; P6a off P5; S1 waits on T2+P6a; S2 waits on S1+P6a; P7 off P6a+E1+T2; M2 waits on P7+T2; D1 waits on P5+P6a+M2; S4 waits on S3+D1+M2; P8 last for the runtime epic, only when zero `TODO(remove:*)` markers remain repo-wide and all delivered runtime-lane gates **except P6b, M1, M2, D1, and S4** are green (P6b is a tracked follow-up outside the epic exit — P8 verifies its follow-up issue is filed but never waits on P6b landing; M1 is the outreach-demo sidecar; M2 is the committed MCP agent-surface follow-up; D1/S4 are factory/onboarding follow-ups).
