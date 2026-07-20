# #391 Decision 26 planning-reset proof

> **Historical evidence for the 2026-07-17 reset.** PR #846 and Decision 26's
> 2026-07-20 clarification supersede this file's singular-agent A1 graph,
> authored-tool-catalog direction, and next-action command. Use
> [`plan.md`](plan.md) and the current #805 A1 plan for dispatch.

Date: 2026-07-17

Branch: `issue-391-plan-realignment`

Scope: planning, durable decisions, work-package authority, Bead reconciliation, and the matching golden-path invariant labels only. No product runtime source, package manifest, migration, release, or deployed behavior changes in this reset.

## Owner-approved outcome

The active sequence is now:

```text
Step 1A domain-routed single-agent workspace products
-> Step 1B authenticated external MCP
-> Step 2 several agents in one workspace + native delegation
-> Step 3 durable events/external A2A/runtime expansion
-> later contracted agents/marketplace/mounts
```

Only Step 1A is implementation-decomposed. Its product chain is:

```text
exact trusted domain
-> persisted workspaceTypeId
-> authentication/current-app membership
-> authorized matching workspace
-> exactly one trusted server-only agent behavior
```

Full-app remains typed-mode-disabled with compatibility `default -> primary`. Seneca is the first real two-domain/two-type/two-agent product proof.

## Canonical artifacts

- Dispatch authority: `docs/issues/391/plan.md`.
- Durable ruling: `docs/DECISIONS.md` Decision 26 (one unique heading).
- Consumption modes: `docs/issues/391/AGENT-CONSUMPTION-MODES.md`.
- Every prebuilt work package: `docs/issues/391/ROADMAP-ALIGNMENT.md`.
- Ownership: `docs/issues/391/OWNERSHIP.md` and child indexes #805–#809.
- Concise strategy/status: `runtime-refactor/VISION.md` and `INDEX.md`.
- Historical D1/AgentHost plan: `runtime-refactor/FORWARD-PLAN.md`, explicitly non-dispatchable.

Decision 26 supersedes Decision 25's same-workspace-first sequence and optional compiled-provenance language while retaining workspace authority, static/no-controller composition, one Workspace+Sandbox owner, full-app compatibility, package layering, protocol-at-edges, and EU-self-hostable principles.

## Work-package alignment proof

The 74 physically redistributed canonical documents remain under #805–#809. Their owner indexes now map them to Step 1A, 1B, 2, 3, later, or retired status.

All 74 canonical child work-package documents that carried the old generic dispatch banner now state:

```text
retained research and non-dispatchable until the child canonical plan
and Bead graph are recut under Decision 26
```

The central matrix covers every prior work package:

- #805 A1/P5/P6/P8 narrow inputs to Step 1A; P7 Step 2; P1/P3/P4/E1 later.
- #806 M1/M2 Step 1B; AR1/E2 Step 3/later.
- #807 T1/T2 Step 3; channels later.
- #808 P2 Step 3 and X1 later.
- #809 AC1 split into local Step 2, external A2A Step 3, contractor later; ID1 public-access gated; billing/catalog/control-plane later.

The mode contract distinguishes:

1. web/MCP ingress to the caller's own authorized workspace;
2. native same-workspace agent delegation;
3. external agent A2A ingress to our workspace;
4. contracted/service delegation to an agent in its own workspace using governed readonly input plus returned artifacts.

## Step 1A implementation graph

Epic: `wt-391-forward-o0b`.

```text
o0b.11  1A.0 plan reset
o0b.12  1A.1 persist workspace type safely
o0b.13  1A.2a static declarations/domain resolution
o0b.22  1A.2b two-domain auth topology
o0b.14  1A.3a typed context/inventory/Core selection
o0b.23  1A.3b route-wide enforcement
o0b.15  1A.4a durable typed-create admission
o0b.24  1A.4b idempotent provisioning/retry
o0b.16  1A.5 typed workspace frontend
o0b.17  1A.6a sole behavior/runtime lifecycle
o0b.25  1A.6b authored materializer/tool catalog
o0b.18  1A.7 session/history compatibility
o0b.19  1A.8a conformance/full-app freeze
o0b.26  1A.8b typed-aware rollback floor
o0b.20  1A.9 exact package release
o0b.21  1A.10a Seneca exact-pin integration
o0b.27  1A.10b production proof/executed rollback
```

Every implementation Bead has a tracker acceptance field and `## Acceptance Criteria` description section. The graph is linear because these slices touch overlapping Core/Workspace/Agent/full-app/Seneca authority and must establish security/rollback seams in order.

Old `o0b.2`–`o0b.10` were closed with an explicit Decision 26 supersession reason. Stale AR1/MCP (`wt-391-forward-8yz`, `wt-391-forward-eq8`, `wt-391-forward-few`) and public ID1 (`wt-391-forward-zwt`) Beads were deferred behind their child-plan recut triggers.

After this planning bead closes, only `o0b.12` is intended to become ready within the #391 epic.

## Active A1 authoring recut

The former D1/deployment-oriented A1 work package is now fully recut under #805:

- canonical plan: `docs/issues/805/runtime-refactor/work/A1-agent-authoring/PLAN.md`;
- epic: `wt-391-forward-c0u`;
- slices: `.1` planning, `.2` materialized source, `.3` tool allowlists/collision policy, `.4` validate CLI, `.5` embeddable dev seam, `.6` dev CLI, `.7` conformance/docs;
- old D1 A1 bead `wt-391-forward-d3y` is closed;
- #391 `o0b.25` is retained only as thin `.17 + c0u.3` runtime integration;
- `o0b.20` exact release depends on both typed rollback proof and `c0u.7` A1 completion.

A1 removes AgentDeployment/default-resolution/digest-provenance authority while retaining the import-free compiler. It adds a frozen server materialized-source contract, per-agent trusted tool allowlist, collision-safe merge, exact validate JSON/error envelopes, sandbox-default local dev, packed consumer proof, and no authored executable imports.

A1 review convergence:

1. Gemini 3.1 Pro: **APPROVED/CLEAN**.
2. Sol xhigh found and drove corrections for runtime-integration ownership, tool collision semantics, unsupported reference families, dev lifecycle/security defaults, stable errors, rollback/release gating, and self-contained Bead proof.
3. Final Sol-high review against docs and live graph: **CLEAN**.

## Review revisions integrated

Strong independent review rounds found and the plan integrated:

- duplicate Decision 26 and dead anchor;
- stale proof/tracker authority;
- persisted workspace type versus static ID/classifier alternatives;
- typed-mode/legacy request-scope mutual exclusion;
- route-wide—not chat-only—workspace-type enforcement;
- two-domain Better Auth/cookie/origin/CSRF topology;
- explicit creation authority and user UX;
- durable create idempotency and provider retry/crash semantics;
- unsafe rollback to a pre-typed app after non-default data exists;
- review-budget splits for auth, route guards, creation/provisioning, behavior/authoring, conformance/rollback, and Seneca deployment;
- authored-directory-to-runtime derivation rather than hand-duplicated behavior;
- exact workspace-type grammar, session namespace collision safety, and no persisted singular agent mapping;
- stale Decision 19/21/22/25 scope notes;
- required acceptance fields and self-contained Beads;
- stale Decision 25 navigator/review/architecture/roadmap banners across all 74 canonical child work-package documents;
- typed post-signup no-create and invite membership/type validation ownership.

## Final convergence

Review sequence:

1. Initial Sol xhigh architecture review rejected the same-workspace-first active plan and identified the persisted workspace-type/product-order reset.
2. Independent Opus/Gemini/Oracle-style reviews found duplicate authority, route-wide auth, multi-domain auth, creation idempotency, rollback, authored-behavior, and Bead-quality gaps; all were integrated.
3. Fresh Gemini 3.1 Pro final review: **APPROVED/CLEAN**.
4. Fresh read-only Pi CLI `gpt-5.6-sol` xhigh found remaining stale Decision 25 banners/Beads and post-signup ownership overlap; those were corrected.
5. Final fresh Pi CLI `gpt-5.6-sol` xhigh verdict against the complete diff and live graph: **CLEAN**.

No reviewer edits were accepted blindly; the coordinator grounded and applied each accepted finding.

## Validation commands

Run from the planning worktree:

```bash
git diff --check
pnpm check:golden-path
grep -n '^## 26\.' docs/DECISIONS.md
br lint wt-391-forward-o0b.11 wt-391-forward-o0b.12 \
  wt-391-forward-o0b.13 wt-391-forward-o0b.22 \
  wt-391-forward-o0b.14 wt-391-forward-o0b.23 \
  wt-391-forward-o0b.15 wt-391-forward-o0b.24 \
  wt-391-forward-o0b.16 wt-391-forward-o0b.17 \
  wt-391-forward-o0b.25 wt-391-forward-o0b.18 \
  wt-391-forward-o0b.19 wt-391-forward-o0b.26 \
  wt-391-forward-o0b.20 wt-391-forward-o0b.21 wt-391-forward-o0b.27
br dep cycles
bv --robot-insights | jq '{cycle_count:(.Cycles|length),status:.status.Cycles}'
br dep tree wt-391-forward-o0b.27
br ready --json
```

Expected before closing `o0b.11`:

- one Decision 26 heading;
- no diff whitespace errors;
- no Bead template warnings;
- zero dependency cycles;
- `o0b.11` in progress and all implementation children blocked;
- no old S1/AR1/ID1 #391 dispatch candidate.

Expected after closing `o0b.11`:

- `o0b.12` is the sole ready child inside `wt-391-forward-o0b`;
- all later Step 1A children remain transitively blocked.

## Runtime-proof waiver

This reset changes planning/docs/tracker data plus the golden-path check's expected planning-stage labels only. Runtime typecheck/test/E2E/image gates are otherwise intentionally waived here; each implementation Bead names its required proof. `pnpm check:golden-path`, `git diff --check`, link/authority inspection, Bead lint/cycles/robot graph, and independent plan review are the relevant gates.

## Residual risks and stop conditions

- Better Auth may not support the chosen host-local multi-domain callback shape without additional configuration; 1A.2b must prove it before typed selection work.
- The surviving legacy `requestScopeResolver` is executable compatibility residue; 1A.2a must make it mutually exclusive with typed mode or stop.
- Provider operations may not support true exactly-once replay; 1A.4b must narrow the guarantee rather than claim it falsely.
- No production non-default workspace may be created before 1A.8b qualifies the typed-aware rollback floor.
- Retyping existing workspaces with history is out of scope; Seneca creates new non-default product workspaces.
- Public MCP/A2A, same-workspace multi-agent, and contractor features require later canonical recuts and do not enter Step 1A.

Tomorrow's exact implementation action, after plan merge/close, is:

```text
/exec wt-391-forward-o0b.12
```
