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
first-journey acceptance script over a math-tutor fixture product.

## Decisions

- Execution home is this repo (§13f). No boring-v2.
- Three layers host / product runtime / sandbox; runtime unit = installed product; modes are host policy (§13b, c).
- Release and Installation are product-module records under `packages/workspace/src/server/productLifecycle/`, DB-free; core injects Postgres stores (coding invariant: workspace stays DB-free).
- Activation receipts mirror the two-phase `agent_host_destructive_publication_events` shape.
- Builder tools never call activate; the host activates through the bridge.
- First consumer proof runs on a playground fixture; the live Seneca tutor product is tenant-side acceptance after nc-7.

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
- nc-7 script passes end to end with zero founder edits; receipt committed.

## Proof

- Exact commands: see each bead's "Proof path" (`br show <id>`); epic-level `pnpm --filter workspace-playground first-journey` after nc-7.
- Screenshot/demo: nc-5 UI Review gate; nc-7 receipt under `docs/issues/1562/`.

## Slices

Order = spine first (owner, 2026-09-07 evening): identity records → creation → placement; isolation gates a shared-host second consumer.

| # | Slice | Bead | Blocked by | File scope (summary) |
|---|---|---|---|---|
| 1 | release manifest | `wt-391-forward-nc-1-release-manifest-6xyh` | — | productLifecycle/releases*, core migration 0028 + store |
| 2 | Thread identity + session bindings | `wt-391-forward-nc-t-thread-identity-iohz` | — | server/threads/**, core migration 0030, thread.v1 bridge reads |
| 3 | installation + activation (binds thread, never session) | `wt-391-forward-nc-2-installation-activation-z4pa` | 1, 2 | productLifecycle/installations*, activation*, core migration 0029 |
| 4 | builder seat → candidates in the release store | `wt-391-forward-nc-6-builder-agent-seat-7bqx` | 1, 3 | plugins/product-builder/**, playground fleet |
| 5 | product.v1 bridge ops | `wt-391-forward-nc-3-product-bridge-ops-vqa3` | 2, 3 | productLifecycle/bridge.ts, server option wiring, WORKSPACE_BRIDGE_V1.md |
| 6 | first View slice (record, dashboard) | `wt-391-forward-nc-v-first-view-slice-oaal` | 5 | shared/views, server/views, front/views/ViewHost |
| 7 | Library entry + Thread canvas | `wt-391-forward-nc-l-library-entry-job-canvas-uw98` | 2, 5, 6, [shell-layout] | front/shell/library, front/shell/work, playground e2e |
| ∥ | embedded runtime gate | `wt-391-forward-nc-0-embedded-runtime-gate-y6ke` | — | workspace server composition, runtimeBackend/, PLUGIN_SYSTEM.md |
| 8 | runtime seam + embedded adapter | `wt-391-forward-nc-4a-product-runtime-seam-mlrv` | ∥, 5 | productRuntime/{types,embedded,brokeredOps}, conformance suite |
| 9 | local adapter | `wt-391-forward-nc-4b-local-sandbox-runtime-r37r` | 8 | productRuntime/{local,runtimeEntry,protocol} |
| 10 | isolated View renderer (iframe) | `wt-391-forward-nc-5-isolated-front-component-qm7x` | 5, 6 | front/productRuntime/**, frontAssets route, fixture + e2e |
| 11 | first journey | `wt-391-forward-nc-7-first-journey-acceptance-sdnl` | 7, 4, 9, 10 | playground fixture product + acceptance script + receipt |

Binding rule on 1, 3, 5: no persisted row or bridge input carries a session id; a test asserts it.

Review budget: each bead stays inside the 1500-line PR budget; 6, 9 and 10 are the largest and may split.

## Out of Scope

- Remote (microVM) product runtime adapter — after nc-4b proves the seam.
- Upstream reconciliation beyond the single fixture update in nc-7 (E5 full proof).
- Public packaging, marketplace, pricing, creator agreements (tenant-side).
- Thread **timeline storage shape** (`.13.2`) and durable-streams Level D (Wave A, unchanged). Thread *identity* is in scope (slice 2).
- Saved Views in Library beyond the product's own descriptors (rest of P4).

## Open Questions

None blocking dispatch of nc-0/nc-1. Deferred to nc-4b: exact dispatch protocol (stdio JSON lines vs local HTTP) — the bead may choose, the conformance suite is the contract.

## Graph Validation

- `br dep cycles --blocking-only`: 0 cycles (2026-09-07).
- `br ready`: nc-1, nc-t (P0) and nc-0 (P1) appear, status open, unassigned.

## Gate 1

Owner decision: pending. The owner may pre-approve by including the literal
text "Gate 1 pre-approved" in the Factory orchestrator request, per
`apps/factory-playground/README.md`.
