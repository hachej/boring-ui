# 07 — Test framework, review, acceptance (v2)

Status: v2 rewrite. This is the **test framework** for the pluggable-agent pack (00–09 + `../work/`). It defines the five test layers, the canonical contract suites, the shared fixtures, the per-phase exit gates a dispatching orchestrator checks, the review gates, and the issue-coverage posture. It supersedes the v1 07 where they conflict; the v1 split-brain / issue-coverage / thermo-review content is carried forward, re-vocabularied to v2.

**Runner facts (verified against `package.json`):** every package tests with **Vitest** (`test: vitest run`, boring-bash `vitest run --passWithNoTests`). There is **no `node:test` and no Jest** anywhere. E2E is **Playwright** in two places: `packages/agent/e2e/` (`test:e2e`) and `apps/workspace-playground/e2e/` + `apps/full-app/e2e/`. Invariant gates are ripgrep/Node scripts (`scripts/check-invariants.sh`, `packages/boring-bash/scripts/check-invariants.mjs`, `scripts/audit-imports.ts`, `packages/agent/scripts/check-agent-isolation.ts`). Per-package invocation is `pnpm --filter <pkg> run test`; root aggregate is `pnpm run test` (builds packages then `pnpm -r run test`).

---

## 1. Test architecture — five layers

| Layer | What | Where | When it runs |
| --- | --- | --- | --- |
| **L1** | Invariant / boundary gates | `scripts/*`, per-package `check-invariants` | per-PR CI, fast |
| **L2** | Unit tests (colocated) | `packages/*/src/**/__tests__/*.test.ts` | per-PR |
| **L3** | **Contract conformance suites** (the backbone) | exported factories, run at each mount | per-PR for the touched contract; all mounts at phase exit |
| **L4** | Integration / e2e | `packages/agent/e2e`, `apps/*/e2e` (Playwright) | per-phase exit |
| **L5** | Cross-phase regression pins | reuse of L3 suites + named regressions | always-on, any PR touching the area |

### L1 — invariant gates (per-PR, fast)

Enforced by scripts, not test files. Extend them, never bypass (`../INDEX.md` global non-negotiables).

- **Package-edge invariants** — package `check-invariants` scripts own package-boundary assertions: `@hachej/boring-agent` has **zero value import** from `@hachej/boring-bash` or `@hachej/boring-sandbox`; boring-bash may import boring-sandbox values + agent types; boring-sandbox imports agent types only.
- **Import audit** — `pnpm audit:imports` (`scripts/audit-imports.ts`, `FORBIDDEN_PATTERNS`) owns repo-wide old-path and surface import gates: surface packages import only the public agent contract (+ their channel ingress package); no old-path imports survive a relocation (P2/P3/P4/T1/T2 add rules here). Do not rely on this collector alone for package-edge proofs unless its scanned roots are expanded in the same PR.
- **Agent package invariants** — `pnpm --dir packages/agent run lint:invariants` → `bash scripts/check-invariants.sh .` (ripgrep scan). Adds the **Fastify-free façade** rule (P1 BBP1-006: no Fastify in the `createAgent()` / `@hachej/boring-agent/core` module graph) and the **no `?cursor=` / `PiChatReplayBuffer` server-side** rule (T2 BBT2-006).
- **boring-bash invariants** — `pnpm --filter @hachej/boring-bash run check:invariants` → `packages/boring-bash/scripts/check-invariants.mjs`: required exports (`.`/`./shared`/`./server`, `./mcp` after E2), agent→boring-bash + Fastify-graph checks, and the pack-doc `(filesystem, path)` / named filesystem binding string presence.
- **Agent isolation** — `pnpm check:agent-isolation` → `packages/agent/scripts/check-agent-isolation.ts` (dist scan; requires a build first).
- **Workspace plugin invariants** — `pnpm lint:workspace-plugin-invariants`.
- **`TODO(remove:*)` marker gate** — `node scripts/check-no-remove-markers.mjs` (P8 BBP8-001), wired into `pnpm lint:invariants`. Repo-wide scan of `packages/ plugins/ apps/ scripts/` (excludes `node_modules`, `dist`, `docs/issues/391/**`). **Zero markers today**; a surviving marker names and reopens its owning phase.
- **Bundle-size** — `pnpm check:bundle-size` (T2 adds the `@durable-streams/client` front dep; must stay under gate).
- **Plan-pack navigability** — P8 adds a markdown link/stale-reference gate over the canonical pack (excluding legacy `todos/`): no unresolved old TODO filename references, no references to the removed architecture-six file, and `INDEX.md` remains the single ordering authority.

Root aggregate for L1: `pnpm lint:invariants` (= agent `check-invariants.sh` + boring-bash `check:invariants` + workspace-plugin invariants + the marker gate) and `pnpm audit:imports`.

### L2 — unit tests (per-PR, colocated)

Vitest, colocated under `__tests__/`. Per package: `pnpm --filter @hachej/boring-agent run test`, `pnpm --filter @hachej/boring-bash run test`, `pnpm --filter @hachej/boring-workspace run test`. These cover behavior a conformance suite does not (e.g. `resolveAttachments` reduction). **Amendment (2026-07-08):** Slack and spreadsheet/embed implementation tests are relocated out of #391 active scope.

### L3 — contract conformance suites (the backbone)

**One canonical suite per contract, exported as a reusable factory, run against every implementation.** House pattern = `checkReadonlyProjectionConformance` in `packages/boring-bash/src/server/testing/readonlyProjectionConformance.ts` (a `Subject` interface + a `check*/run*` function returning `{ passed, failures }`). Every new suite follows it: framework-agnostic, no runner assertions inside the factory, driven by a per-mount `test.ts` that supplies the subject.

**The "one suite, N mounts" rule:** a contract has exactly one suite. Each new implementation is a **mount** — a thin subject adapter over the same suite — not a forked copy. A mount is added by the phase that introduces the implementation.

#### 3a. Harness conformance (#12) — canonical: the #12 harness suite + durable-stream additions

- **Where:** the existing harness conformance under `packages/agent/src/server/harness/pi-coding-agent/__tests__/*conformance*.ts` (e.g. `sessionMapping.conformance.test.ts`), extended by T1.
- **Covers:** text/tool chunks, abort, sessions, follow-up (existing #12) **plus** (T1 BBT1-006): `AgentEvent` **envelope ordering**, **replay-from-index/offset**, **approval park+resume**, and **durable pending-request survival across restart** (rebuild the service against the same `state.db` while `events.db` remains the replay log; `resolveInput` continues via a *new seeded harness turn*, never a rehydrated in-memory turn).
- **Sub-suite:** `runEventStreamStoreConformance(makeStore)` — `packages/agent/src/server/events/__tests__/eventStreamStore.conformance.test.ts` (T1 BBT1-001): monotonic offsets, catch-up read from arbitrary offset, no-gap-after-mid-append-throw (transactional `node:sqlite` append).
- **Command:** `pnpm --filter @hachej/boring-agent run test`.

#### 3b. Transport conformance — canonical: `runTransportConformance`

- **Where:** `packages/agent/src/shared/__tests__/transport.conformance.ts` (T2 BBT2-001), signature `runTransportConformance(makeTransport, driveAgent)`. Layers on the harness suite (T1 exports it as a reusable factory for exactly this).
- **Rule (08 conformance item 3):** in-process (`createAgent()` direct) and HTTP+SSE (DS adapter) are **behaviorally identical** — same event order, same reconnect-replay, same approval round-trip.
- **Mounts:** in-process — `inProcessTransport.test.ts` (BBT2-002); HTTP/DS — `dsHttpTransport.test.ts` (BBT2-003, in-memory Fastify app mounting T1's DS route + `createAgent()`; reconnect after forced stream close replays losslessly).
- **Command:** `pnpm --filter @hachej/boring-agent run test`.

#### 3c. Environment / no-leak conformance — canonical: `checkReadonlyProjectionConformance` (**one suite, N mounts — delivered: in-process, scoped-view, MCP; deferred: remote-worker provider**)

- **Where:** `packages/boring-bash/src/server/testing/readonlyProjectionConformance.ts` (landed #416). Do not fork it; add mounts.
- **The mounts a bead actually delivers (by name):**
  - **in-process** readonly `company_context` — landed (#416).
  - **scoped-view + symlink-escape** — E1 BBE1-007 `scopedViewConformance.test.ts` (mount) + E1 BBE1-004 `scopedView.test.ts` (explicit **symlink-escape** test: realpath-based containment with symlink denial, hardening the lexical-`resolve()`-only projection).
  - **MCP projection** — E2 BBE2-003 `mcpProjectionConformance.test.ts` (subject drives the projected `McpServer` via an in-memory MCP client pair; identical expected visible-path set to the in-process mount).
- **Deferred mount — remote-worker (provider) attachment:** **gated on the P5 remote-worker handshake work** (owning bead: `../work/P5-provisioning-secrets/TODO.md` BBP5-010). Remote-worker stays a *provider* in this epic (P2/P5); the mount lands when its handshake-backed attachment does, not before.
- **Guarantees:** named filesystem bindings with `(filesystem, path)` identity; denied files physically **absent** (no leak through read/list/find/grep/search/shell/UI/transcript/metadata); readwrite management projections are distinct policy-granted bindings; `execPolicy: 'none'` default for non-`user` attachments; no broker secret in any client-reachable payload (E2 BBE2-004).
- **Command:** `pnpm --filter @hachej/boring-bash run test`.

#### 3d. Surface-adapter conformance — canonical transport substrate

- **Amendment (2026-07-08):** concrete Slack and spreadsheet/embed conformance mounts are relocated out of #391 active scope. S1 becomes the separate "Slack via flue channels" story; S2 belongs to pi-for-excel issue #551.
- **#391 obligation:** T1/T2 keep the reusable transport and two-handles substrate green. Future concrete surfaces consume that substrate from their own stories/issues.
- **Command:** covered by T1/T2/S3 package tests in this pack.

### L4 — integration / e2e (per-phase exit)

- **Agent Playwright e2e** — `pnpm --filter @hachej/boring-agent run test:e2e` (`playwright test -c e2e/playwright.config.ts`). Parity guard for P1's adapter refactor and T2's transport cutover. Load-bearing specs: `m2-modeflip`, `m3a-sessions`, `m3b-chat`, `m3c-interrupt-queue`, `bridge-protocol`, `pi-native-replay-gap`, `pi-native-multi-session-cold-reload`, `pi-native-long-transcript-reload`, `streaming-bash`, `pi-projection-ui`, `bombadil/`. Bombadil chat soak: `pnpm --filter @hachej/boring-agent run test:bombadil:chat`.
- **Workspace-playground Playwright drive** — `pnpm --filter workspace-playground run test:e2e` (`build:deps` then `playwright test`, `apps/workspace-playground/playwright.config.ts`): file tree/editor, cmd-palette, resize-persistence, deck-plugin. The T2 front cutover must run this **unmodified** before the legacy `?cursor=` path is deleted.
- **Full-app e2e** — `pnpm --filter full-app run e2e`.
- **Plugin e2e** — ask-user: `plugins/ask-user/e2e/ask-user.spec.ts` (T1 BBT1-005 migrates its expectations onto on-stream `data-approval-request`).

### L5 — cross-phase regression pins (always-on)

Any PR touching the area must keep these green; most are re-mounts of L3 suites plus named regressions:

- **company_context no-leak** — `checkReadonlyProjectionConformance` (all delivered mounts: in-process / scoped+symlink / MCP; the remote-worker mount is deferred to P5) stays green in every phase.
- **Source-of-truth parity (route ↔ bash ↔ git)** — split-brain tests (see §4): a file-route write is visible to bash; a bash-created file is visible to file routes/search; git/status routes use the same source of truth; readonly façade exposes no exec; partial view physically excludes denied files.
- **Secret non-exposure in sandbox** — brokered secrets are host-side handles consumed only by trusted-core tools, never present in any sandboxed environment, exec output, tool metadata, or the model transcript (P5 credential-brokering rule; E2 BBE2-004; the `direct` provider is a host process, not a sandbox — nothing is injected there).
- **Symlink escape** — E1 `scopedView.test.ts` symlink-escape test (realpath-based, not lexical).
- **Session JSONL back-compat load** — existing on-disk pi session JSONL must keep loading; the SQLite `EventStreamStore` is the replay authority, JSONL remains the conversation-state authority (T1 keeps them separate). `pnpm --filter @hachej/boring-agent run test:regression` (`system-prompt-size.regression.test.ts`) also rides here.

---

## 2. Shared fixtures (canonical — no per-TODO reinvention)

| Fixture | Canonical name / location | Used by |
| --- | --- | --- |
| Scripted/fake harness | `scriptedPiHarness` — `packages/agent/src/server/testing/scriptedPiHarness.ts` (exists; `BORING_AGENT_E2E_SCRIPTED_PI*`) | P1 `createAgent()` smoke (BBP1-006), harness/transport conformance drivers |
| Company-context readonly fixture | `FixtureCompanyContextBindingProvider`, `COMPANY_CONTEXT_FILESYSTEM_ID`, `COMPANY_CONTEXT_SENTINEL` — `packages/boring-bash/src/server/testing/companyContextFixtureProvider.ts` (exists) | env/no-leak conformance (all delivered mounts; remote-worker mount deferred to P5), surface-adapter governed-context subject |
| In-memory `EventStreamStore` | test double supplied as `makeStore` to `runEventStreamStoreConformance` — `packages/agent/src/server/events/__tests__/` (T1) | transport tests, surface-adapter tests needing a store without SQLite |
| Fake channel payloads / Slack signature fixtures | signed `event_callback` / `block_actions` bodies — `packages/channels/slack/src/__tests__/` (S1; signature verification itself comes from `@flue/slack`, tests only produce signed bodies) | Slack ingress/egress/approval/conformance tests |

Rule: a bead needing one of these **imports the canonical fixture**; it does not hand-roll a parallel one.

---

## 3. Phase exit gates

A phase exits only when its named suites + commands are green. This is the table a dispatching orchestrator checks (beads cite the phase per `../INDEX.md` dispatch protocol). Every phase additionally keeps the **always-on L1 gate** green: `pnpm lint:invariants && pnpm audit:imports`.

| Phase | Must-be-green suites (beyond L1) | Commands |
| --- | --- | --- |
| **P0** (ADR) | `docs/DECISIONS.md` has every 08 decision (1–11) + north star + invariant 15 with a status; pack `(filesystem, path)` strings intact | `pnpm --filter @hachej/boring-bash run check:invariants` |
| **P1** (headless core) | `createAgent.pure.test.ts` smoke (plain-Node turn, no Fastify/cwd leak); invariant tests (no boring-bash value import, no Fastify in graph); **existing agent unit + Playwright e2e pass unchanged** (parity guard) | `pnpm --filter @hachej/boring-agent run test` · `run test:e2e` · `run lint:invariants` · `pnpm check:agent-isolation` |
| **T1** (durable events/approvals) | harness conformance additions (envelope ordering, replay-from-index, approval park/resume, restart survival); `runEventStreamStoreConformance`; ask-user on-stream approval | `pnpm --filter @hachej/boring-agent run test` · `run lint:invariants` · `pnpm check:agent-isolation` · `pnpm audit:imports` |
| **T2** (transport adapters) | `runTransportConformance` green for **both** in-process and HTTP mounts; workspace-playground e2e unmodified; legacy `?cursor=`/`PiChatReplayBuffer` deleted (invariant asserts zero matches) | `pnpm --filter @hachej/boring-agent run test` · `run lint:invariants` · `pnpm --filter workspace-playground run test:e2e` · `pnpm check:bundle-size` |
| **P2** (sandbox pkg/providers + bash mode resolution) | `@hachej/boring-sandbox` package builds/types/tests/invariants; boring-bash mode-resolution tests/invariants; agent remains isolated; provider move leaves no old-path importer; composer packages typecheck | `pnpm --filter @hachej/boring-sandbox run build` · `run typecheck` · `run check:invariants` · `run test` · `pnpm --filter @hachej/boring-bash run build` · `run typecheck` · `run check:invariants` · `run test` · `pnpm --filter @hachej/boring-agent run build` · `run typecheck` · `run test` · `run lint:invariants` · `pnpm --filter @hachej/boring-agent run check:isolation` · `pnpm audit:imports` · `pnpm typecheck` |
| **P3** (routes/tools move) | split-brain suite green per provider; no old-path import; workspace file tree/editor e2e | `pnpm --filter @hachej/boring-bash run test` · `pnpm --filter @hachej/boring-agent run test:e2e` · `pnpm audit:imports` |
| **P4** (file UI plugin) | boring-bash plugin package builds/types/tests/invariants; workspace registration/plugin invariants green; fs-event delta → tree; file panes/surface-resolver ids unchanged; playground proof | `pnpm --filter @hachej/boring-bash run build` · `run typecheck` · `run test` · `run check:invariants` · `pnpm --filter @hachej/boring-workspace run typecheck` · `run test` · `run lint:plugin-invariants` · `pnpm lint:invariants` · `pnpm audit:imports` · `pnpm typecheck` |
| **E1** (env attachments) | env/no-leak conformance **scoped-view mount** + **symlink-escape** test; company-context behavioral-equivalence test; no diff to landed #416 signatures | `pnpm --filter @hachej/boring-bash run test` · `run check:invariants` · `pnpm audit:imports` · `pnpm lint:invariants` |
| **E2** (MCP projection) | env/no-leak conformance **MCP mount**; MCP identity (`BoundFilesystemContext`) test; exec-gating + broker-secret-unreachable test; `./mcp` export bundles | `pnpm --filter @hachej/boring-bash run build` · `run typecheck` · `run check:invariants` · `run test` |
| **P5** (provisioning/secrets) | boring-bash normalizer gates; agent provisioning/readiness/secrets gates; composer packages still green; two-tier readiness (`ReadyState`/`CapabilityState`); remote-worker fail-closed handshake; **credential-brokering** regression (no secret in sandbox); SDK artifacts leak no host paths | `pnpm --filter @hachej/boring-bash run build` · `run typecheck` · `run check:invariants` · `run test` · `pnpm --filter @hachej/boring-agent run build` · `run typecheck` · `run test` · `run lint:invariants` · `run check:isolation` · `run smoke:capability-readiness` · `pnpm --filter @hachej/boring-core run test` · `pnpm --filter @hachej/boring-workspace run typecheck` · `pnpm --filter @hachej/boring-ui-cli run test` · `pnpm --filter full-app run typecheck` · `pnpm --filter full-app run smoke:remote-worker` · `pnpm audit:imports` · `pnpm typecheck` |
| **X1** (S3/FUSE mounts) | `@hachej/boring-sandbox/mounts` build/types/invariants/tests; MinIO EU matrix + no-leak S3 mount + secrets negative; rclone-FUSE-vs-local benchmark recorded with numeric thresholds; boring-bash consumes mount values without agent import | `pnpm --filter @hachej/boring-sandbox run build` · `run typecheck` · `run check:invariants` · `run test` · `run test:mounts:eu` · `run bench:mounts` · `pnpm --filter @hachej/boring-bash run test` · `run check:invariants` · `pnpm lint:invariants` · `pnpm audit:imports` · `pnpm typecheck` |
| **P6a** (plugin core, child-app-independent — **epic gate**) | import-free manifest validation; hosted plugin fail-closed before code exec; managed-service lifecycle; `AgentRegistry` + `agents` declaration seeded; grep-gate: zero `childAppId`/`workspaceKind`/`ChildApp` in the plugin-runtime context contracts | `pnpm --filter @hachej/boring-workspace run test` · `pnpm --filter full-app run e2e` · `pnpm --filter workspace-playground run test:e2e` |
| **P6b** (child-app/Macro scoping — **follow-up, NOT an epic gate**) | child-app/workspace-kind requirement narrowing; Macro requirements do not leak into a generic workspace — **HARD BLOCKED on the shared child-app platform type (#376)**; runs when unblocked and never gates P7/P8 (P8 only verifies the P6b follow-up plus M2/D1/S4 follow-up or status tracking) | (when unblocked) `pnpm --filter @hachej/boring-workspace run test` · `pnpm --filter full-app run e2e` |
| **P7** (multi-agent/inspection) | two agents/two surfaces no namespace collision: no shared binding/transcript/catalog/readiness/approvals; `sessionId` is runtime-global and store/replay remains keyed by `sessionId` only; `agentId` in binding scope key + `sessionNamespace` + session metadata; per-agent readiness/catalogs; session search scoped by workspace+agent; scrubbed agent-list endpoint + per-agent inspection endpoint | `pnpm --filter @hachej/boring-agent run test` · `run test:e2e` |
| **P8** (verification/cleanup) | **zero `TODO(remove:*)` markers repo-wide**; all 00 invariants green; no old-path importer; README documents the four-part surface contract; **every delivered runtime lane green EXCEPT P6b, M1, M2, D1, D2, and S4; M2 may land after P8 as a committed follow-up** (all P1–P7, T1–T2, E1–E2, **X1**, S3, Phase 5, P6a must be green; P8 verifies P6b/M2/D1/D2/S4 follow-up or status tracking and never waits on those lanes landing). **Amendment (2026-07-08):** S1/S2 are relocated and are not P8 gates. | `pnpm lint:invariants` (incl. marker gate) · `node scripts/check-no-remove-markers.mjs` · `pnpm run test` · `pnpm audit:imports` |
| **M2** (MCP agent surface — committed follow-up, may land after P8) | per-agent MCP endpoint mounts from the P6a definition registry; bearer/public-demo auth modes; demo policy/exposure id/result/share URL shape; conformance against P7 registry + T1/T2 transport; M1 projection remains temporary | affected package build/typecheck/test · `pnpm audit:imports` |
| **D1** (tenant provisioning — factory follow-up, not P8 gate) | one command/API creates tenant/workspace, runtime config, DB/storage/session roots, secrets refs, demo endpoint config, and EU deployment manifest; dry-run/idempotency/no-secret canary/fake-provider smoke green | affected package build/typecheck/test · provisioning smoke · `pnpm audit:imports` |
| **D2** (shared subdomain tenancy — factory sidecar follow-up, not P8 gate) | one shared EU deployment hot-registers subdomain tenants from `WorkspaceAgentsDeclaration`; unknown hosts fail closed; cross-tenant isolation conformance proves no sessions/files/pending-inputs/search/artifacts/governance leakage; no broker secret crosses tenant boundary | affected package build/typecheck/test · fake-provider smoke · `TenantIsolationConformance` · `pnpm audit:imports` |
| **S3** (control-plane UX) | Fleet page lists every declared agent from `GET /api/v1/agents` and enriches/drills down via `/info`; cross-surface observation by `sessionId`; central approval answering | `pnpm --filter @hachej/boring-workspace run test` · `pnpm --filter workspace-playground run test:e2e` |
| **S4** (agent onboarding — onboarding follow-up, not P8 gate) | Fleet drill-down shows definition readiness, demo URL status, D1 dedicated provisioning status, D2 shared-tier readiness, and missing policy refs; unknown refs fail closed; no authoring controls; no secret/policy/model key leakage | `pnpm --filter @hachej/boring-workspace run typecheck` · `run test` · `run lint:plugin-invariants` · `pnpm audit:imports` |

---

## 4. Review gates

Carried over from v1 07, re-vocabularied to v2. Applied per plan file and per PR before merge.

### Thermo review protocol (per plan file)

1. Review each plan/TODO file independently.
2. Review the pack as a whole for contradictions across 00–09 + `../work/`.
3. Patch accepted blockers.
4. Rerun blocker-only review.
5. Record review artifacts in `.tmp/boring-bash-plan-reviews/`.

Review prompt (unchanged intent):

```txt
You are an extremely strict thermo architecture reviewer. Review only. Do not edit files.
For the target plan/TODO file, find blockers, contradictions with sibling files, missing tests,
package-boundary risks, split-brain risks, two-handles violations, no-compat-policy violations,
and implementation traps.
Output: verdict, blockers, concrete edits, non-blocking concerns.
```

### Approval bar (v2)

- **No import cycle** — `@hachej/boring-agent` keeps zero value import from `@hachej/boring-bash` or `@hachej/boring-sandbox`; surfaces import only the public agent contract; workspace/core compose both without cycles (package invariant scripts + `audit:imports` old-path gates).
- **No split brain** — for each provider, file route ↔ bash ↔ git/status share one source of truth; readonly façade exposes no exec; partial view physically excludes denied files. A missing split-brain test is a blocker.
- **No Fastify in the façade graph** — `createAgent()` has no Fastify import, no env-var reads, no file-based config discovery (P1 invariant).
- **Two-handles respected** — public agent APIs never accept platform addressing; `SessionCtx { workspaceId?, userId? }` is allowlisted tenancy, a surface-native id (Slack `ts`, workbook/sheet id, pane id) is not; no surface synthesizes a fake `workspaceId`.
- **One approval channel** — HITL declared on the tool, travels as stream events; no second approval path.
- **No greenfield duplication of existing seams; no speculative abstraction** — no abstraction without two real consumers in the same phase (or one named consumer in the immediately following phase); no registry/plugin system for a single entry (README rule 3).
- **No parallel implementations past cutover** — the bespoke replay dies in the same PR stack that lands DS transport; moved origin files are deleted, not stubbed (README rule 4).
- **No `TODO(remove:*)` marker without a named deletion-owner bead** — the owner may live in a later TODO only when the marker explicitly names it per [`../INDEX.md`](../INDEX.md); no marker outlives its named owner's phase, and P8 verifies zero markers repo-wide.
- **No session/agent/child-app scope leak; no vague provider capability claim; no unreviewed pure-mode cwd assumption; no overclaim about open issues.**

---

## 5. Issue coverage

Do not close unrelated backlog issues just because this abstraction lands.

**Can close or materially advance:**

- #391 (the pack);
- #12 if harness pluggability + the harness/transport conformance suites (3a/3b) pass;
- #242 if route composition (P3) lands;
- #16/#223 if provider capability abstraction + adapter composition (P2/P5) land;
- #26/#220/#221 if file API/UI ownership (P3/P4) lands;
- #416 filesystem-binding governance is **landed** — the env/no-leak conformance suite (3c) is its acceptance surface and stays green cross-phase;
- parts of #357/#254/#256 if plugin capability declaration (P6) lands;
- parts of #243/#211 if multi-agent session routing/search (P7) lands.

**Must remain separate unless explicitly implemented:** #376 child-app platform product/deployment/billing; #381/#197 product plugin specs; #377/#361/#363/#362 multi-project nav UI; #375/#358/#308 visual/theme/pane polish; #318 desktop wrapper; #267 performance; #127/#51/#27 billing/auth/database; #122 docs annotation UI; #95 dependency migration; #5 event bus typing.

### Final acceptance

The pack is ready for beads/implementation when: all files pass blocker-only thermo review; issue #391 body points to the pack; open decisions are resolved or explicitly deferred (P0); every phase has the exit gates in §3; and every suite named in §1 has one canonical name matching the TODOs.
