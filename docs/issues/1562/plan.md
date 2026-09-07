---
github: https://github.com/hachej/boring-ui/issues/1562
issue: 1562
state: ready-for-agent
updated: 2026-09-07
flag: flag:BORING_PRODUCT_RUNTIME_EMBEDDED (nc-0 only); later slices are additive stores/seams behind host options
track: owner
---

# gh-1562 Native creation: first Seneca product journey

## Problem

An expert cannot create, install for a separate consumer, adapt and maintain
software inside Seneca without a founder editing source and redeploying. No
release, installation or activation record exists. The only generated-server
path today hot-loads plugin code into the host process, which the ratified
security rules forbid.

## Solution

Build the ruled contracts of RECONCILIATION §13 / DECISIONS D33 on the
existing packages, in this repository: an immutable release manifest, an
installation record with compare-and-set activation receipts, trusted
`product.v1.*` bridge operations, a `ProductRuntimeHost` seam with `embedded`
(gated, default off) and `local` (bwrap/runsc) adapters, an isolated iframe
front for generated components, a `product-builder` agent seat, and a
first-journey acceptance path that uses a math-tutor playground fixture for deterministic supporting proof and requires the live Seneca mathematics tutor before epic closure.

## Decisions

- Execution home is this repo (§13f). No boring-v2.
- Three layers host / product runtime / sandbox; runtime unit = installed product; modes are host policy (§13b, c).
- Release and Installation are product-module records under `packages/workspace/src/server/productLifecycle/`, DB-free; core injects Postgres stores (coding invariant: workspace stays DB-free).
- Activation receipts mirror the two-phase `agent_host_destructive_publication_events` shape.
- Builder tools never call activate; the host activates through the bridge.
- The playground math-tutor fixture supplies deterministic supporting proof only. nc-7 cannot close the epic until the live Seneca mathematics tutor, created by the Seneca curator and installed for a second authorized learner, passes tenant-side acceptance.

## Flag / Abstraction

- Needed?: nc-0 introduces `BORING_PRODUCT_RUNTIME_EMBEDDED` (default off). Other slices are new, opt-in host options (`productLifecycle`, `productRuntime`) with no behavior change when absent.
- Path: additive; no existing route or table changes.
- Rollback: revert the bead commit; migrations 0028/0029 are additive tables.

## Test Seams

- Highest public seam: `createWorkspaceAgentServer` options + WorkspaceBridge `product.v1.*` ops; `ProductRuntimeHost` conformance suite.
- Existing prior art: `runtimeBackendReload.test.ts`; workspace bridge tests; core pg store tests (skip without DB); boring-sandbox provider tests (skip without provider).
- Avoid testing: Dockview internals; model output text.

## Acceptance

- Default boot never imports a runtime plugin's server module (nc-0).
- A Thread with zero sessions exists; a session binds to at most one Thread; no product row or bridge input carries a session id (nc-t, nc-1..3).
- A record View and a dashboard View render from validated descriptors in two mounts; agents never see renderer ids (nc-v).
- The installed product appears in Library for the second user and opens/resumes one Thread in Work (nc-l).
- Release digest deterministic and immutable; stale-generation activation rejected; request-key replay idempotent (nc-1, nc-2).
- Bridge denies unauthorized and cross-workspace callers; embedded refused when gated (nc-3).
- Conformance suite green for embedded and local; runtime process cannot read host env (nc-4a, nc-4b).
- Generated component renders in a sandboxed iframe and reaches only brokered ops (nc-5).
- Builder produces a candidate manifest and cannot activate (nc-6).
- nc-7 fixture script passes end to end with zero founder edits and supplies deterministic supporting evidence; its receipt is committed.
- Before nc-7 closes the epic, the live Seneca mathematics tutor created by the Seneca curator is installed for a second authorized learner and proves live domain identity/operations plus a bounded Job Thread with a result/decision after chat/browser closure. Fixture-only evidence cannot satisfy this bar.

## Proof

- Exact commands: see each bead's "Proof path" (`br show <id>`); epic-level `pnpm --filter workspace-playground first-journey` provides deterministic support during nc-7 but is not sufficient to close the epic.
- Screenshot/demo: nc-5 UI Review gate; nc-7 fixture and live Seneca acceptance receipts under `docs/issues/1562/`.

## Slices

Second re-cut (360 sweep, 2026-09-07 night). Order = spine first.

| Order | Slice | Bead | Gate |
|---|---|---|---|
| 1 | Release manifest record + stores (pins agent definition digests, stateCompat) | `wt-391-forward-nc-1-release-manifest-6xyh` | **now** |
| 2 | Thread identity record + session bindings | `wt-391-forward-nc-t-thread-identity-iohz` | **now** |
| 3 | Shared ExecutionContext / Authority + effect-classed Capability | `wt-391-forward-nc-x-execution-context-capability-tsqh` | **now** |
| ∥ | Ground truth: gate the embedded runtime default-off | `wt-391-forward-nc-0-embedded-runtime-gate-y6ke` | **now**, parallel |
| 4 | Installation record + CAS activation receipts (personal-scope install = the separate consumer) | `wt-391-forward-nc-2-installation-activation-z4pa` | after 1, 2 |
| 5 | Learner data store + schema versioning + catalog adapter | `wt-391-forward-nc-d-learner-data-store-axqb` | after 1, 2 |
| 6 | Tutor agent package (persona, skills, knowledge) pinned by digest | `wt-391-forward-nc-a-tutor-agent-package-767r` | after 1 |
| 7 | Evaluation/Outcome record bound to releaseDigest | `wt-391-forward-nc-e-evaluation-record-akcu` | after 1 |
| 8 | `product-builder` seat: typed brief → candidate + evidence, never activates | `wt-391-forward-nc-6-builder-agent-seat-7bqx` | after 1, 4, 6, 7 |
| 9 | `product.v1.*` bridge operations through defineCapability | `wt-391-forward-nc-3-product-bridge-ops-vqa3` | after 2, 3, 4 |
| 10 | First ratified View slice (record, dashboard) | `wt-391-forward-nc-v-first-view-slice-oaal` | after 9; UI surface |
| 11 | Library entry + Thread canvas in Work (consumes shell L3b) | `wt-391-forward-nc-l-library-entry-job-canvas-uw98` | after 2, 9, 10, `shell-ngfs.6`; UI surface |
| 12 | `ProductRuntimeHost` seam + embedded adapter + conformance | `wt-391-forward-nc-4a-product-runtime-seam-mlrv` | after ∥, 3, 9 |
| 13 | Model credentials: scoped, request-bound issuance; usage per installation | `wt-391-forward-nc-c-model-credentials-rzh1` | after 3 |
| 14 | Reconciliation: compatibility, precise conflict, quarantine, undo | `wt-391-forward-nc-r-reconciliation-he4u` | after 4, 9, 12 |
| 15 | `local` sandbox runtime adapter | `wt-391-forward-nc-4b-local-sandbox-runtime-r37r` | after 12 |
| 16 | Isolated generated View renderer (iframe; resurrects #1499) | `wt-391-forward-nc-5-isolated-front-component-qm7x` | after 9, 10; UI surface |
| 17 | First journey acceptance (deterministic fixture support + mandatory live Seneca tutor receipt generated from evidence and usage records) | `wt-391-forward-nc-7-first-journey-acceptance-sdnl` | after 5, 8, 11, 13, 14, 15, 16, `9p50.2`, `shell-ngfs.14.1` — **the only bead that can close the epic, and only after live Seneca acceptance** |

Binding rule on 1, 4, 5, 9: no persisted row or bridge input carries a session id; a test asserts it. Each bead's PRIOR WORK note names the design or PR to reuse (see `../../plans/native-creation/360-GAP-MAP.md`).

Review budget: each bead stays inside the 1500-line PR budget; 10, 15 and 16 are the largest and may split.

## Out of Scope

- Remote (microVM) product runtime adapter — after nc-4b proves the seam.
- Upstream reconciliation beyond the single fixture update in nc-7 (E5 full proof).
- Public packaging, marketplace, pricing, creator agreements (tenant-side).
- Thread **timeline storage shape** (`.13.2`) and durable-streams Level D (Wave A, unchanged). Thread *identity* is in scope (slice 2).
- Saved Views in Library beyond the product's own descriptors (rest of P4).

## Open Questions

Owner defaults recorded in the DIRECTION amendment (separate consumer = personal-scope install; tutor persona on the agent-package path for the first proof; bwrap/runsc floor for `local`; A1 owns session ids; Seneca pulls by digest). None blocks dispatch of the four ready beads. Deferred to nc-4b: exact dispatch protocol (stdio JSON lines vs local HTTP) — the bead may choose, the conformance suite is the contract.

## Graph Validation

- `br dep cycles --blocking-only`: 0 cycles (2026-09-07).
- `br ready`: nc-1, nc-t (P0), nc-x and nc-0 (P1) appear, status open, unassigned; 18 beads, 0 cycles.

## Gate 1

Owner decision: pending. The owner may pre-approve by including the literal
text "Gate 1 pre-approved" in the Factory orchestrator request, per
`apps/factory-playground/README.md`.
