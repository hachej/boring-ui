# INDEX — ordering authority (#391 runtime refactor v2)

**THE single source of truth for phase ordering, dependencies, dispatch, and binding policies.** The vision is in [`VISION.md`](VISION.md); the binding architecture in [`architecture/`](architecture/); the per-phase deliverables/exit detail in each [`work/<pkg>/PLAN.md`](work/); the stacked-PR execution plan in [`PR-PLAN.md`](PR-PLAN.md). Where any file disagrees with this INDEX on ordering or policy, this file wins.

Each `work/<pkg>/` holds three files: **TODO.md** (the package coordinator containing multiple beads), **PLAN.md** (that phase's deliverables + exit criteria + governing architecture links), **HANDOFF.md** (the tickable closeout checklist). The autonomous assignment unit is **one bead/PR row**. Do not dispatch an entire multi-PR TODO as one task. The legacy `todos/TODO-00..07` are **non-canonical** wherever they conflict with this pack — consult only for historical bead intent the v2 files reference.

## Execution operating mode — outreach weeks

The running app is the owner's sales demo. Every PR is **behavior-frozen for the live app** unless its work order explicitly changes a documented invariant: existing e2e stays green, risky cutovers land dark/additive, and defaults flip only after conformance proves parity. Merge continuously as small independently-safe PRs; never hold the risk for an end-loaded mega-merge. Every PR description must include a review-time estimate and review-focus notes for the owner's 1-2h/day review budget. Stacked PRs carry labels or title notes that make merge order unambiguous.

## Delivery gates and live status

Status reflects `main` plus open PRs as of 2026-07-09. Architecture may remain
documented before implementation; only rows marked **v1 gate** block v1.

| Milestone | Work package | Depends on | Live status | Exit gist |
| --- | --- | --- | --- | --- |
| P0 — decisions | [P0](work/P0-adr/) | — | **merged** (#521/#522) | v2 pack and amended decisions are canonical |
| P1 — safe headless core | [P1](work/P1-headless-core/) | P0 | **partial; open stack #543/#545/#547/#566/#568/#575/#576 + PR E required** | real `/core` boundary, honest lifecycle/readiness, serialized admission, idempotency, attribution, deterministic tool merge |
| R0 — managed MCP tracer | [M1](work/M1-mcp-managed-agent/) | P1 admission/attribution gate | **partial; #549/#556 open** | bearer-authenticated stock client ships one configured vertical agent with bounded self-contained output |
| P6-D — minimal definition | [P6](work/P6-plugin-child-app/) | P1 | **v1 gate; pending** | verified bundle registry plus separately versioned behavior definition and deployment digest rules |
| A1 — agent-directory authoring | [A1](work/A1-agent-authoring/) | P6-D for compile; P6-R for local run | **v1 gate; pending** | `agents/<name>/` emits one self-contained content-addressed bundle used by local dev and D1 without platform-source edits |
| T1 — durable events/approvals | [T1](work/T1-durable-events/) | P1 | **v1 gate; partial; #546/#559 need rebase/amendment** | one SQLite authority, authenticated-subject-scoped durable caller receipts, transactional approvals, explicit crash recovery |
| T2 — transports | [T2](work/T2-transport/) | T1 | **v1 gate; pending** | in-process and HTTP transports share admission, replay, attribution, and approval semantics |
| P2 — sandbox providers | [P2](work/P2-sandbox-providers/) | P1 | **v1 gate; partial; #548/#557/#558/#564 open** | atomic provider extraction plus one real hardened runsc/systrap provider; no silent direct fallback |
| P3 — routes/tools + contribution residue | [P3](work/P3-routes-tools/) | P2 | **v1 gate; partial** | optional working environment owns file/bash tools/routes; filesystem UI is capability-gated; trusted default-agent plugins project tools/routes/Pi prompt+resources/front atomically without P4/P6 expansion |
| E1 — environment attachments | [E1](work/E1-environment-attachments/) | P2, P3 | **v1 gate; pending** | stable lifetime key excludes request id; authorized tools/routes/UI share one host-owned prepared view |
| P5a — minimum provisioning | [P5](work/P5-provisioning-secrets/) | P2, P3, E1 | **v1 gate; pending** | host orchestration/readiness/fingerprint/secret brokerage plus authenticated fail-closed runsc-worker hardening facts |
| P6-R — definition resolution | [P6](work/P6-plugin-child-app/) | P6-D, E1, P5a, P3 BBP3-020 | **v1 gate; pending** | host verifies bundle assets and resolves deployment plus the workspace activated-plugin snapshot to an immutable digest; requirements validate authority |
| D1 — dedicated EU site delivery | [D1](work/D1-tenant-provisioning/) | A1, P2 runsc, P5a, P6-R | **v1 gate; pending** | exact hostname -> bounded landing -> auth -> authorized workspace -> deployed `default` agent, plus crash-safe EU apply/rollback; no M2 dependency |
| P8 — v1 proof/cleanup | [P8](work/P8-verification/) | all v1 gates above | **pending** | zero removal markers plus the timed 15-minute user-visible golden-path proof |

## Post-v1 increments

These plans are retained, but they do not block R0 or v1.

| Increment | Work package | Earliest dependency | Reason deferred |
| --- | --- | --- | --- |
| P4 presentation extraction | [P4](work/P4-file-ui/) | P3 | moving workspace editors into a runtime package is disproportionate; capability-gate the existing plugin first |
| E2 foreign-agent environment projection | [E2](work/E2-mcp-projection/) | E1, P6-R | consumes injected deployment attachment lookup; second environment consumer after v1 |
| X1 S3/FUSE | [X1](work/X1-s3-fuse-mounts/) | P2, P5a, E1 | no current native-mount consumer; performance and operations risk |
| P5b advanced provisioning | [P5](work/P5-provisioning-secrets/) | P5a | SDK archives, managed services, and remote-worker generality need real consumers |
| P6 plugin/child-app expansion | [P6](work/P6-plugin-child-app/) | P6-R, P7 where agent routing is required | per-agent plugin routes/UI require `agentId`; child apps remain blocked on #376 |
| P7 multi-agent/control APIs | [P7](work/P7-multi-agent-inspection/) | P6-R, E1, T2 | agent routing/info first; search, hooks, and subagent grants split into later beads |
| M2 canonical MCP surface | [M2](work/M2-mcp-agent-surface/) | P7, T2 | R0 proves MCP delivery without making exposure policy part of the definition |
| D2 shared tenancy | [D2](work/D2-shared-tenant-mesh/) | dedicated D1 repeated and trusted tenant context designed | v1 deliberately avoids a shared multi-tenant control plane |
| S3/S4 control plane/onboarding | [S3](work/S3-control-plane-ux/), [S4](work/S4-agent-onboarding/) | P7 and delivery status APIs | product UX after the kernel and dedicated path are proven |

## Dependency graph

```txt
Release 0:
P0 -> P1 -> M1 stock-client tracer

Version 1:
P0 -> P1 -> P6-D -> A1-compile --------------------------┐
         ├-> T1 -> T2 -----------------------------------┤
         └-> P2 -> P3 -> E1 -> P5a -> P6-R -> A1-dev -> D1 -> P8

Post-v1:
P4 | E2 | X1 | P5b | P6 plugin/child-app | P7 | M2 | D2 | S3/S4
```

P1 precedes both extraction and delivery because it establishes lifecycle,
admission, attribution, and the real dependency boundary. P6-D moves early
because A1 and D1 are real consumers; plugin/runtime resolution stays later in
P6-R. D1 adds one exact-host landing/auth binding over the existing
HTTP/workspace delivery surface and therefore does not wait for M2 or D2's
shared-host router. Work already landed via #416 is reused and must not be
redone.

## Parallel and background tracks

Parallel work is allowed only when ownership and merge gates stay explicit.
"Background" never means "merge without its prerequisites" or "invent a
temporary version of a frozen contract."

| Track | Can run in parallel | Frozen boundary | Merge/integration gate | Action now |
| --- | --- | --- | --- | --- |
| R0/M1 tracer | after P1 admission/attribution; beside every v1 lane | additive bearer sidecar only; no canonical definition or exposure-policy ownership | stock-client smoke, bounded output, no v1 dependency | run after P1 PR E |
| P6-D -> A1 compile | beside T1/T2 and P2/P3 after P1 | definition/compiler only; no E1, plugin resolution, tenant, or runtime lifecycle | deterministic self-contained bundle | run as an isolated critical lane |
| T1 -> T2 | beside P2/P3 and P6-D/A1 | no provider/filesystem work; one event/approval authority | crash recovery then transport conformance | run as an isolated critical lane |
| P2 -> P3 -> E1 -> P5a | beside T1/T2 and P6-D/A1 | P1 public boundary and #416 contracts stay frozen | hardened runsc, no-leak attachment, readiness/secret-broker proof | run in dependency order |
| X1 S3/FUSE | draft/background worktree only until P2 + P5a + E1 + a named native-mount consumer exist | package-local `boring-sandbox/mounts`, MinIO proof, and benchmark only; no D1 storage, E1/P5 contract, agent/workspace API, or `company_context` change | full E1 integration, bash/file visibility parity, credential canary, EU MinIO matrix, numeric benchmark | keep #581 draft/deferred; never gate v1 |
| E2 environment MCP | after E1 + P6-R; beside later D1/P7 follow-up | reuse attachment/projection authority; no new environment owner | MCP no-leak, identity, and exec gating | later clean leaf |
| M2 agent MCP | after P7 + T2 | thin surface adapter only; no runtime ownership | exposure/auth/result conformance | later clean leaf |

P4, P5b, P6 expansion/P7, D2, and S3/S4 are not safe background work today:
they either overlap live v1 ownership seams, lack a real consumer, or depend on
the dedicated path being proven first. Keep them documented and undispatched.

## Dispatch protocol

1. **One bead/PR = one agent assignment.** A package TODO coordinates multiple
   assignments; never dispatch the entire multi-PR TODO as one run.
2. **Respect the dependency graph.** Parallel lanes are safe to dispatch concurrently.
3. **Every PR must cite** (implementation rule — do not implement from only one file): the TODO bead id; the global ISA + the relevant area subplan (`architecture/00`–`architecture/10`); the migration phase (this INDEX + the package's PLAN.md); and the acceptance/test section ([`architecture/07-tests-review-acceptance.md`](architecture/07-tests-review-acceptance.md)).
4. **Every PR description includes review budget metadata:** estimated review time, review-focus notes, and stacked merge order when applicable.
5. **Work happens on a dedicated branch per bead/PR.** Never on main or in a shared checkout.
6. **Behavior freeze** unless the bead explicitly changes a documented invariant. The landed #416 contracts (`packages/boring-bash/src/shared`) are load-bearing for the governance PR line — extending is fine, breaking is not.
   **Amendment (2026-07-06):** since #552, `@hachej/boring-bash` and `@hachej/boring-governance` are published to npm (cohort-versioned) with an external consumer (Constellation). The frozen surface is therefore not only `packages/boring-bash/src/shared` but every `@hachej/boring-bash/server` export that `@hachej/boring-governance` imports (`COMPANY_CONTEXT_FILESYSTEM_ID`, `ScopedFilesystemRuntimeBindingManager`, `createReadonlyProjectionOperations`, the projection error codes/types). In-repo same-PR importer migration remains the rule, but changes to these exports must keep the bash+governance pair compatible at equal cohort versions; a breaking change requires a coordinated cohort bump with both packages migrated in the same PR.
7. **A bead is done when Verification commands AND Review gates pass**, not when code compiles. Each TODO ends with both; the package HANDOFF.md is the tickable closeout.

**Review rule (thermo, before coding each file).** A clean review means: no package import cycle; no duplicated provisioning/readiness system; no filesystem/bash split brain; no hidden cwd/filesystem leak in pure agent mode; no child-app or multi-agent scope leak; no claim that unrelated backlog issues are solved by this abstraction.

## Binding policies

### No-compat / simplicity (binding on every TODO)

Unpublished internal paths have no external migration audience: migrate their
in-repo consumers atomically with no deprecated aliases or legacy stubs.
Published `@hachej/boring-bash`/governance exports do have an external audience;
they require coordinated cohort/semver policy and rollback as described above.

1. **Migrate every importer in the same PR** that moves or renames a thing. Grep is the migration tool, not a shim.
2. **Transitional code has a deadline.** If an old path must stay alive while the new one lands, it carries a `// TODO(remove:<bead-id>)` marker + a deletion bead. A phase is not done while any of its markers remain. **Cross-TODO cutover carve-out:** the deletion bead a marker names may live in a **later** TODO **as long as the marker explicitly names that owner** (canonical: the `?cursor=` NDJSON path kept alive across T1, deletion owned by `BBT2-006` in T2). Every marker names a real deletion bead; no marker outlives its named owner's phase. Phase 8 verifies zero markers remain repo-wide.
3. **No abstraction without two real consumers in the same phase** (or one named consumer in the immediately following phase). No speculative parameters/generics/registries/config indirection beyond the one typed config object.
4. **No parallel implementations past their cutover.** When the DS transport passes conformance, the bespoke replay dies in the same PR stack. When tools/routes move to boring-bash, the origin files are deleted, not stubbed.
5. **New options never grow env-var fallbacks.** Env/file parsing lives in host/CLI composition only (P1).
6. **If a bead seems to need a compat shim for anything outside this repo — stop and ask.**

The only legitimate compat surfaces (do NOT break): on-disk pi session JSONL (existing user sessions must load), the landed #416 shared contracts (`packages/boring-bash/src/shared`), server↔front within one release train, and — **Amendment (2026-07-06), since #552** — the `@hachej/boring-bash/server` exports consumed by the npm-published `@hachej/boring-governance` (the pair must stay compatible at equal cohort versions; see rule 6).

### Versioning & flagging (how cutovers ship)

No feature-flag framework. Version is carried where it already exists:

- **Wire:** `AgentEvent.v` is the protocol version (starts at 1); DS stream routes are **new paths** added in T1 alongside the old `?cursor=` route, so old front + new server coexist during development. That additive window *is* the flag — T2 flips the front, then deletes the old route in the same phase (rule 2).
- **Dark-launch seam:** the front transport is injectable (`usePiSessions({ createRemoteSession })`). T2 may land the DS transport dark behind that injection for at most one PR, then flip the default and delete the legacy path. No user-facing toggle.
- **Package:** bump `@hachej/boring-agent` minor at the T2 cutover (protocol change) and at P3 (tool/route relocation). Server and front ship together in the CLI package, so no long-lived skew exists.

### Global non-negotiables (apply to every TODO)

- `@hachej/boring-agent` keeps **zero value imports** from `@hachej/boring-bash` **or `@hachej/boring-sandbox`** (agent defines the contracts both consume and imports neither; enforced by `packages/boring-bash/scripts/check-invariants.mjs` + the boring-sandbox invariant scripts — extend, don't bypass). Acyclic layering: `boring-sandbox → agent(types)`; `boring-bash → boring-sandbox(values) + agent(types)`.
- Surfaces never own the loop; surface packages import only the public agent contract (+ their channel ingress package).
- **Two handles:** `sessionId` runtime-owned; platform addressing surface-owned; public agent APIs never accept platform addressing.
- **One approval channel:** HITL declared on the tool, travels as stream events.
- `filesystem + path + operation + actor` is the resource identity; path alone never selects a filesystem.
- Existing workspace behavior and company_context no-leak conformance stay green in every phase.
- **EU-sovereign defaults** (00 invariant 15): no bead may introduce a US-hosted service as a default or hard dependency; US-hosted providers are optional providers behind the capability matrix — never the default path.
