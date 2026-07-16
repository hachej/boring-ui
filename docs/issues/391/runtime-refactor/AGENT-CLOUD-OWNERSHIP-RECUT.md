# Implementation Plan

## Revision Summary

This final narrow revision resolves two execution blockers without changing the settled architecture:

1. Controller relocation now uses one atomic, compile-complete R0/R1 contracts-and-foundations cluster followed by closed R2, R3, and R4 clusters. Exact module membership and the necessary type-only import moves are listed; byte-preserving clusters may be large.
2. The release boundary is absolute: before S4 completes, only inventory/provenance planning may occur. No controller copy, relocation branch, compilation, or integration work may start until the exact Core/Agent release is published, pinned in Seneca, and migration adoption passes.

## Goal

Make Seneca the only agent-cloud and production host authority while preserving `apps/full-app` as a lean standalone, multi-user/multi-workspace application for one primary agent product and keeping Core multi-agent-capable only at the durable product-selection boundary.

## Problem

The agent-host controller accumulated under `apps/full-app/src/server/deployment/**` across merged history; PR #789 adds three later authority/security commits but did not originate the controller. Its current placement makes full-app appear to own root host/fleet lifecycle, while Seneca PR #10 emulates authority around a pinned external checkout rather than owning the real controller.

Core migrations 0018–0022 are immutable release history. Migrations 0018–0020 created/extended D1-named host operational tables, 0021 added rollback-source provenance, and 0022 renamed the objects to `agent_host_*`. Forward ownership must transfer through a packaged Seneca adoption migration and explicit single-writer handoff, without history rewriting, database reset, dual writers, or hidden down migrations.

## Solution

### Ownership matrix (normative)

| Concern | `@hachej/boring-core` | Agent package / workspace runtime | `apps/full-app` | Seneca |
|---|---|---|---|---|
| Product records | Owns durable definition refs, deployment refs, workspace-agent bindings, authorized selection, and immutable selected identity. | Owns definition/deployment schemas, digest validation, resolved-agent contract, runtime construction, and Pi session identity. Workspace owns normal authorized plugin/runtime composition. | Bootstraps one configured `primary` product into applicable workspaces and always selects it. | Authors many products and writes tenant bindings through Core’s public store contract. |
| Composition | No workspace-composition snapshot, host revision, or execution manager. | Receives host-injected runtime facts and validates selected identity. | Uses a lean static primary adapter, not an agent-host collection. | Sole owner of canonical agent-host workspace-composition snapshots/digests. |
| Multi-agent boundary | Can bind several named agents per workspace and atomically name one default. | Can execute a selected named agent. Cooperating-agent behavior is not implemented here. | One primary product across many users/workspaces. | Many definitions/products mapped to tenant workspaces/hostnames. |
| Database | Owns Core product schema. Historical host migrations/declarations remain frozen compatibility history, unused by Core runtime; no future host migration lands in Core. | DB-free except injected stores and host-owned Pi files. | Runs released Core plus legitimate app migrations only. | Owns PostgreSQL provisioning, credentials, backup/monitoring, migration execution, active host declarations, adoption journal, and future host migrations. |
| Host/fleet lifecycle | Forbidden: hostname, Compose/Caddy/runsc, root command/path, publication, fleet, billing operations. | Forbidden: hostname/fleet/root-host authority. | Forbidden: host/fleet controller, root socket/CLI, hostname map, Compose/Caddy/runsc orchestration. | Sole owner of provisioning, production host lifecycle, publication/rollback/recovery, hostname/TLS, fleet, billing/governance. |

### Minimal Core contract

Core adds no composition service, `execution.ts`, fleet abstraction, or cooperating-agent implementation. The active family is only `packages/core/src/server/agentProducts/{types.ts,store.ts,selectWorkspaceAgent.ts,index.ts}`.

The next available Core migration (expected `0023_workspace_agent_products.sql`, but implementation uses the actual next journal index) creates:

1. `agent_definition_refs`
   - PK `(definition_id, definition_version)`.
   - `definition_digest NOT NULL`, `created_at`.
   - Unique `(definition_id, definition_version, definition_digest)`.
   - Existing opaque-ref validation at the application edge and SHA-256 DB check.
2. `agent_deployment_refs`
   - PK `(deployment_id, deployment_version)`.
   - `agent_id`, `deployment_digest`, `definition_id`, `definition_version`, `definition_digest`, `created_at`.
   - FK exact definition tuple -> `agent_definition_refs`, `ON DELETE RESTRICT`.
   - Unique `(deployment_id, deployment_version, agent_id, deployment_digest)`.
3. `workspace_agent_bindings`
   - PK `(workspace_id, agent_id)`.
   - Exact deployment tuple fields and `bound_at`.
   - FK workspace -> `workspaces(id) ON DELETE NO ACTION`.
   - FK exact deployment tuple -> `agent_deployment_refs ON DELETE RESTRICT`.
4. `workspace_default_agents`
   - PK `workspace_id`; field `agent_id` and `selected_at`.
   - Composite FK `(workspace_id,agent_id)` -> workspace binding, `ON DELETE RESTRICT`.
   - This pointer cannot reference a missing binding and cannot represent two defaults.

`bootstrapPrimaryAgent` locks the workspace row, upserts/verifies immutable definition/deployment tuples, inserts `(workspaceId,'primary') ON CONFLICT DO NOTHING`, verifies existing bytes, and inserts the default pointer if absent in the same transaction. It never replaces an existing different default. `backfillPrimaryAgent(appId, identity)` walks non-deleted workspaces in stable UUID order using the same idempotent transaction. New workspace provisioning calls the same operation. Promotion proves every targeted workspace has one valid primary binding/default.

`selectWorkspaceAgent(workspace, {agentId}|{default:true})` receives an already authorized `Workspace` and returns frozen refs/digests only. It cannot select by hostname, host ID, raw path, or caller-supplied workspace ID.

### Agent named selection and Pi execution identity

This separate Agent slice is required for full-app `primary` and Seneca named products; it adds no cooperating-agent behavior.

- `packages/agent/src/server/agentDefinition/resolveAgentDeployment.ts` accepts the new binding `{workspaceId,selectedAgentId,selectedDeploymentId,workspaceCompositionDigest}`. The old `{workspaceId,defaultDeploymentId,workspaceCompositionDigest}` remains for one compatibility window and maps to `default`. Named inputs require deployment agent/deployment equality. Legacy/default digest golden output remains unchanged through an explicit compatibility branch; named identity uses a versioned digest domain.
- `packages/agent/src/shared/session.ts` defines frozen validated `AgentSessionExecutionIdentityV1`: workspace, agent, definition/version/digest, deployment/version/digest, and resolved digest.
- Identity is host/runtime supplied, never accepted from prompt/tool/client input:
  - `packages/agent/src/core/piChatSessionService.ts` adds it to host-internal session initialization.
  - `packages/agent/src/core/createAgent.ts` copies it from resolved runtime into `createSession`; public send input cannot override it.
  - `packages/agent/src/server/registerAgentRoutes.ts` carries it in `getRuntimeScopeContribution`, validates it, includes it in the binding cache key, and passes it to the harness.
  - `packages/agent/src/server/harness/pi-coding-agent/createHarness.ts` fixes it for the binding’s `PiSessionStore`.
  - `packages/agent/src/server/harness/pi-coding-agent/sessions.ts` writes `boringAgentExecution` into the Pi JSONL `type:'session'` header and rejects mismatched current identity before effects. Legacy missing identity is readable only via the legacy default path and is not rewritten.
  - `packages/agent/src/server/pi-chat/{harnessPiChatService.ts,piSessionIdentity.ts}` preserves the metadata without exposing an override.
- Tests: shared session validation/type tests; `core/__tests__/createAgent.test.ts`; `server/agentDefinition/__tests__/resolveAgentDeployment.test.ts`; harness `sessions.load.test.ts` and `sessionMapping.conformance.test.ts`; `server/__tests__/registerAgentRoutes.test.ts` for named binding isolation.

### Workspace composition

`workspaceComposition.ts` remains entirely Seneca-owned for the host controller. It is not extracted to Core. Seneca combines Core’s selected immutable product identity with Seneca-owned runtime/plugin/provisioning/filesystem/host facts and composition digest before Agent resolution. Full-app uses only its lean normal static composition adapter.

## Migration and release packaging

### Core/Agent release gate

1. Land the minimal Core contract and Agent named/session identity slices.
2. Publish an exact Core/Agent release containing immutable migrations 0021/0022, the selected-product migration, export maps, compiled code, `drizzle/*.sql`, and `drizzle/meta/_journal.json`.
3. Verify the published tarballs, not only the checkout. Run the immediately previous full-app/Core release against the expanded schema: auth, workspace list/create, settings read/write, and legacy/default session create/read must pass.
4. Seneca pins exact coupled Boring versions without caret/range and commits `pnpm-lock.yaml`.

### Seneca migration ownership

- `postgres` and `drizzle-orm` are direct runtime dependencies; any `drizzle-kit` generation tool is an exact pinned dev dependency.
- Package SQL as `drizzle/agent-host/0000_adopt_core_0018_0022.sql`, later numbered files, and `drizzle/agent-host/meta/_journal.json`; Docker/build assertions prove inclusion.
- Active host declarations live at `src/server/agent-host/db/schema.ts`. Any Core host declarations remain compatibility-only/deprecated and unused; future removal is owner-gated. No future host migration enters Core.
- `src/server/migrations/core.ts` runs the exact pinned Core migrations; `agentHost.ts` runs Seneca adoption/future host migrations; `migrate.ts` composes them.
- Journal is `seneca_migrations.agent_host_migrations`, recording migration hash, exact Core version, observed Core journal maximum, and adopted shape digest, never data/secrets.
- Fixed lock order:
  1. deployment/operator host lock;
  2. Seneca composition PG lock `1936027237`;
  3. existing Core lock `1651470949`;
  4. Seneca host migration lock `1634234227`.
- A one-shot pre-app migration job from the exact image digest runs after verified backup and before app/controller/ingress. Failure leaves mutation and ingress disabled.

Adoption verifies existing objects and records ownership; it does not recreate, rename, truncate, copy, or alter rows. Migration is forward-only. Code rollback is allowed only after previous-release read/write proof. Database rollback means isolated restore and explicit promotion, not down SQL.

PostgreSQL 16/17/18 matrix:

1. fresh DB -> Core through 0022/product migration -> Seneca adoption;
2. 0018–0020 fixture -> 0021/0022/product -> adoption;
3. 0018–0022 fixture -> product -> adoption;
4. historical nonempty admissions and prepared/terminal journal rows -> upgrade/adopt with unchanged canonical row digest;
5. independently restored production-like DB -> previous/new release read/write smoke.

Only test-created, uniquely prefixed ephemeral databases may be cleaned, guarded by `NODE_ENV=test` plus server/database identity assertions. Production exposes no reset/drop/truncate path.

## Hard pre-relocation gate

**Nothing beyond inventory/provenance planning may occur before S4 completes.** Specifically, before the exact Core/Agent release is published, pinned in Seneca, locked in `pnpm-lock.yaml`, and Seneca migration adoption/matrix passes:

- do not copy any controller source or test into Seneca;
- do not create a controller relocation or integration branch;
- do not compile relocated controller code in Seneca;
- do not modify Seneca controller imports;
- do not begin R0–R4 or controller integration.

Permitted pre-S4 work is read-only inventory: merged-history and PR #789 commit/file provenance, dependency graph, source/destination mapping, content hashes, and PR descriptions. This gate prevents relocation from binding to an unpublished or ambiguous Core/Agent contract.

## Provenance and PR disposition

Close/supersede Boring PR #789 and Seneca PR #10; use fresh branches and no force-push assumption. Inventory all merged controller history plus PR #789’s exactly three commits. Reuse a commit only if it applies cleanly to the correct owner; otherwise byte-copy with `Source-Repo:` and `Source-Commit:` trailers and source/destination SHA-256 hashes in the PR. Large copy commits are allowed when review is hash/provenance verification. PR #787 is merged context, not replay work.

## Compile-complete relocation clusters

After S4 only, relocate in the following strict topological order. Every cluster includes corresponding unit tests and import rewrites, builds/typechecks/tests independently atop prior clusters, but is mutation-disabled: no `main.ts` import, package command, production socket/service/volume, or ingress route. Prefer these larger closed clusters over artificial micro-slices.

### R0/R1 — Atomic foundations, contracts, artifact/revision storage, and DB fencing

R0 and R1 are one compile-complete relocation cluster and one review unit. They must not be presented as independently compiling commits. A preliminary byte-copy staging commit is allowed only when the copied files are excluded from the Seneca TypeScript project and runtime; the single activation commit adds the entire graph and tests atomically.

Exact modules:

- `agentHostPlan.ts`
- new `agentHostContracts.ts`
- `agentHostRuntimeInputs.ts`
- `agentHostBindingEnv.ts`
- `workspaceComposition.ts`
- `agentHostAuthority.ts`
- `agentHostIngressArtifacts.ts`
- `edgeNetworkPreflight.ts`
- `agentHostCommandCliProtocol.ts`
- `agentHostCommandLockPolicy.ts`
- `agentHostFileRuntimeInputsProvider.ts`
- `agentHostAgentArtifactSnapshot.ts`
- `agentHostRevisionCodec.ts`
- `hostRevisionStore.ts`
- `activeCollectionReader.ts`
- `destructivePublicationJournal.ts`
- `admissionLedger.ts`
- `fencedDestructivePublication.ts`
- `agentHostSecretMaterializer.ts`
- `agentHostRootDesiredResolver.ts`
- `agentHostCommand.ts`
- `src/server/agent-host/db/schema.ts`

`agentHostContracts.ts` receives, by move rather than duplicate definition:

- `AgentHostCollectionLimits` and `AGENT_HOST_V1_COLLECTION_LIMITS` from `bootCollection.ts`;
- `AgentHostDesiredResolver`, `AgentHostApplyEffects`, `AgentHostRuntimeInputsInspectionV1`, and `AgentHostMutationGuard` from `agentHostCommand.ts`;
- `AgentHostRootPublicationClient` from `agentHostPublicationControl.ts`;
- `AgentHostFencedDestructivePublication` from `fencedDestructivePublication.ts`, whose implementation moves in this same atomic cluster;
- `AgentHostBindingSecretProvider`, `AgentHostProvidedBindingInspectionV1`, `AgentHostProvidedSecretV1`, and `AgentHostResolvedBindingSecretsV1` from `agentHostSecretMaterializer.ts`.

The contracts module may use `import type` from sibling data-only definitions in this same atomic cluster, including `AgentHostActiveEnvelopeV1`, `AgentHostPublicationStatusV1`, `AgentHostDestructivePublicationIdentity`, desired/observation/runtime-input identities, stored candidate/complete records, and loaded artifact types. It must have no runtime value import from a behavioral controller module. Value constants and callable interfaces move into contracts, while DTO definitions retain one canonical declaration.

This atomic graph closes the real dependencies: active reader gets its limit constant from contracts and revision/store/artifact behavior from the same cluster; artifact and root resolver receive file-provider, collection, command, and revision dependencies in the same activation; command and fenced publication receive their mutual callable interfaces from contracts; fenced publication gets journal/ledger/store behavior in-cluster; and publication-control types needed by fencing are type-only contracts.

Acceptance: the entire listed graph and its focused tests compile in Seneca in one activation commit; no listed file imports an implementation from a later R2–R4 cluster; no contract/interface is duplicated; artifact snapshot, revision codec/store, active reader, runtime input/file/secret provider, admission ledger, destructive journal, fenced publication, root resolver, command/CLI-protocol, and real-Postgres fencing tests pass. There is no intermediate compiling claim for a partial R0 or R1.

### R2 — Collection and publication runtime

Exact modules:

- `agentHostUserNeutralPreloader.ts`
- `agentHostAgentRuntimeRecipe.ts`
- `bootCollection.ts`
- `agentHostPublicationControl.ts`
- `agentHostProductionAuthority.ts`
- `agentHostLanding.ts`
- `hostSurface.ts`
- `agentHostReadiness.ts`

Why closed: boot collection takes command/collection contracts and active/revision/store/journal dependencies from the atomic R0/R1 cluster; publication control takes apply/publication contracts plus authority/revision/store/journal dependencies from R0/R1; runtime recipe and preloader are present together; production authority depends only on R0/R1–R2.

Tests moved together: user-neutral preloader, runtime recipe, boot collection/activation, publication control, production authority/dependencies, landing/surface/readiness, crash/lost-signal/lost-ack tests.

### R3 — Operator entry, server wiring, Compose, and dormant attestation

Exact modules:

- `composeAdapter.ts`
- `agentHostCommandEntry.ts`
- `agentHostCommandWrapper.ts`
- `agentHostServerWiring.ts`
- `agentHostCaddyfileAuthority.ts`
- `agentHostCoreEnvAuthority.ts`
- `approvedHostRelease.ts`
- `approvedHostReleaseFile.ts`
- `approvedHostArtifactEvidence.ts`
- `hostSecurityConfig.ts`
- `approvedHostReleaseCapability.ts`

Why closed: command entry now has all command, DB, publication, provider, resolver, collection, Compose, and authority dependencies from R0/R1–R3; server wiring has all active/collection/surface/runtime-recipe dependencies from R0/R1 and R2; dormant approved-release capability and every authority/evidence dependency are moved in this same cluster.

Tests moved together: command entry/CLI/wrapper/lock, Compose and Docker-boundary unit tests, server wiring/scope/ingress tests, Caddy/core-env authority, approved release/file/capability/evidence, and host-security tests. The wrapper binary is built for tests but is not exposed in package scripts or production images yet.

### R4 — Integration and proof activation gate

Exact modules/assets:

- `agentHostCoreProof.ts`
- `agentHostDrProof.ts`
- all integration test support files (`agentHostAuthorityEntryHarness.ts`, `agentHostAuthorityFixture.ts`, `agentHostAuthorityIntegrationSupport.ts`)
- authority integration, namespace migration, migration-evidence, live activation, Docker/ingress proof tests
- Seneca `src/server/main.ts` integration adapter
- Seneca `src/server/migrate.ts` final composition wiring
- operator package scripts, Compose/Caddy controller assets, and fresh proof-harness entry points

R4 connects Core authorized selection + Agent named/session identity + Seneca workspace composition. It adds migration-ready checks and the local control socket. Mutation remains disabled unless both `SENECA_AGENT_HOST_MUTATION_ENABLED=1` and a valid transferred authority capability exist; ingress remains gated until handoff acceptance. Unit/integration proof may use isolated test authorities only.

R4 acceptance: the complete controller compiles/tests in Seneca; production default starts the lean app without controller mutation; a static reachability test proves mutation and ingress gates; no full-app runtime path is changed yet.

## Single-writer authority handoff

After R4:

1. Gate new ingress publication and host mutation; drain accepted work.
2. Quiesce the old full-app socket/process while retaining source files. Acquire host and DB composition locks.
3. Prove `pendingOperation=null`, served equals durable, no unterminated prepared journal event, and no migration lock.
4. Stop old socket/process; prove connection refusal and an old command cannot acquire authority or change revision/DB digests.
5. Transfer root-owned authority descriptor/capability through the reviewed ownership/FD procedure; record only descriptor, host, revision, and lock digests.
6. Start Seneca read-only; reproduce and validate current state and exact descriptor/migration identity.
7. Enable Seneca mutation; run no-op then approved additive tracer. Resume ingress only after served acknowledgement and health.
8. Record Seneca as sole writer; old full-app authority env remains disabled/unreachable.

Reverse handoff is rehearsed: gate/drain Seneca, prove no pending operation and served/durable equality, disable/stop it, transfer capability back, validate old controller read-only, then enable it only if previous-release schema smoke permits. Otherwise restore the pre-migration backup; never run concurrent failover.

## Full-app non-destructive contraction

After successful handoff proof:

- Add `apps/full-app/src/server/primaryAgent.ts` for immutable primary registration, idempotent bootstrap/backfill, Core selection, and Agent identity threading.
- Change normal `main.ts`/`migrate.ts` so they import no controller, open no publication socket, accept no host authority, write no operational host table, and run no Compose/Caddy/runsc command.
- Leave `apps/full-app/src/server/deployment/**`, tests, proof scripts, and historical docs physically present but dormant/unreachable. Invariant scans prove zero value import/build/script/route reachability.
- Prove two users/two workspaces receive the same immutable primary product, non-members reject, Pi headers carry selected identities, and standalone local/Docker/Fly-style start needs no Seneca.

Physical cleanup/archival is a future owner-gated action. Directory absence is not acceptance.

## Proof and recovery

Automated proof includes:

- Core exact PK/FK/default-pointer and concurrent bootstrap/backfill tests.
- Agent legacy digest, named resolution, immutable Pi header, restart/mismatch, no client override, binding-cache isolation.
- Published tarball/image SQL/meta/export checks and exact Seneca lockfile.
- PG 16/17/18 fresh, 0018–20, 0018–22, historical nonempty, restored fixture, lock races, row-digest preservation, previous-release read/write.
- Every relocation cluster’s compile/type/test and provenance hashes.
- R4 default mutation/ingress denial and isolated controller integration.
- Handoff/reverse-handoff single-writer proof.
- Full-app zero reachability and standalone primary behavior.

Operator proof includes exact release verification; backup and independent restore; migration/adoption; authority handoff; three definitions/deployments/workspaces/hostnames; landing/auth/membership/selected identity; in-flight N+1; unused rollback and admitted-removal denial; real EU runsc filesystem/process/network isolation; secret canary; HTTPS/app/Caddy/DB/served-durable health; and alerts.

Independent recovery evidence covers database, workspace root, session root, and host revision/control state through separate backup channels. Restore into an isolated network, verify cross-component digests, readable sessions, admission/journal history, authorization denials, and health before a separate publication action.

Local/unit/Compose/structural runsc evidence is not live EU evidence.

## Stories

1. Full-app operator runs one complete primary product for many users/workspaces with no active fleet controller.
2. Seneca operator manages many products/tenants/hostnames through the sole production authority.
3. Session auditor proves immutable executed identity from Pi JSONL after restart.
4. Migration operator upgrades historical nonempty DBs without changing host facts and retains declared previous-release compatibility.
5. Handoff operator proves old/new controllers cannot write concurrently and can reverse safely while schema-compatible.

## Slices and exact dependency chain

Use `expand -> migrate batches -> contract`.

1. **S0 Ownership ratification:** approve this dispatch contract and fresh-branch/PR dispositions.
2. **S1 Core durable refs/selection:** schema, store, authorization, primary bootstrap/backfill.
3. **S2 Agent named/session identity:** compatible resolver and Pi header identity.
4. **S3 Core/Agent release:** package/tarball, previous-release smoke, exact publish.
5. **S4 Seneca exact pin and migration adoption:** lockfile, direct DB deps, packaged SQL/meta, pre-app migration, PG matrix.
6. **Inventory gate output:** finalize read-only provenance/hash/dependency inventory. This may have been prepared earlier, but no source was copied.
7. **R0/R1 Atomic foundations/contracts/artifact/revision/storage/DB-fencing relocation.**
8. **R2 Collection/publication relocation.**
9. **R3 Operator/wiring/dormant attestation relocation.**
10. **R4 Integration/proof activation gate.**
11. **S5 Authority handoff/reverse-handoff tracer.**
12. **S6 Full-app non-destructive wiring contraction.**
13. **S7 Fresh proof recut; PR #10/#789 remain superseded.**
14. **S8 EU/independent DR proof** (owner live/runtime-profile gate).
15. **S9 `d3y`.**
16. **Future cleanup** (separate written owner permission).

Critical path: **S0 ownership -> S1 Core + S2 Agent -> S3 exact release -> S4 Seneca pin/adoption -> atomic R0/R1 -> R2 -> R3 -> R4 -> S5 handoff -> S6 full-app contraction -> S7 proof recut -> S8 EU proof -> S9 d3y**.

There is no relocation parallelism before S4. Inventory planning does not authorize copying or a relocation branch.

## Beads

- `utb`: verify #787 complete; no replay.
- `xyd`: supersede with R4 controller integration and S5 single-writer handoff beads.
- `3vt`: split into EU three-binding and independent DR restore proof after S7.
- `d3y`: retain after EU result.
- New chain: ownership; Core refs; Agent identity; Core release; Seneca adoption; atomic R0/R1 then R2–R4; handoff; full-app contraction; proof recut; EU/DR; d3y. Cleanup remains separately blocked.

## Flag and rollback rules

- Expand-only SQL; no automatic down migration.
- Migration failure keeps controller mutation and ingress disabled.
- Candidate remains dark until ready; ingress last.
- Code rollback only with previous-release read/write proof.
- Host rollback is a new complete revision.
- Database recovery is isolated restore plus explicit promotion.
- Authority rollback is reverse handoff, never concurrent writers.
- Pending operation, descriptor/lock/digest mismatch, secret canary, or authorization failure aborts before mutation.

## Acceptance

Non-destructive implementation is accepted when:

- Core contains only durable refs/bindings/default/authorized immutable identity.
- Agent supports named selection compatibly and persists immutable execution identity automatically.
- Exact Core/Agent release is published and Seneca pin/adoption passes before any relocation begins.
- The atomic R0/R1 cluster compiles/tests as one activation, followed by independently compiling R2, R3, and R4 in strict order with mutation disabled until integration/handoff.
- Single-writer and reverse-handoff proofs pass.
- Full-app has zero controller runtime/build reachability while old files remain untouched.
- Fresh proof invokes the real Seneca controller; PR #789 and PR #10 are closed/superseded.

## Non-goals / Anti-complexity budget

No Core execution manager or cooperating-agent feature; Kubernetes/Terraform/autoscaling/multi-region; broker/queue/reconciler/registry/cache; fleet admin UI/wildcard API; per-agent containers; new public host package; dual writer/automatic failover; compatibility emulator; dormant attestation activation; force-push; destructive DB operation; or physical source/test/doc cleanup.

## Open owner gates

1. Physical cleanup/archival requires future written permission.
2. Live migration and production authority handoff require owner approval after restore and handoff evidence.
3. EU runtime profile requires owner acceptance of real isolation/privilege evidence.
4. Replacement/removal of a used agent binding requires future product/data policy.

## Files to Modify

- Core product migration/schema and `packages/core/src/server/agentProducts/*`.
- Agent resolver/session/core/routes/harness/Pi identity files and named tests.
- Seneca package/lockfile/Docker/migration files after S3, then controller modules only after S4.
- Full-app `primaryAgent.ts`, `main.ts`, and `migrate.ts` only after authority handoff proof.

## New Files

- Core minimal agent-product modules.
- Agent execution identity schema additions.
- Seneca packaged adoption SQL/meta and migration composition.
- Seneca `agentHostContracts.ts` plus the atomic R0/R1 cluster and R2–R4 relocated modules after S4.
- Full-app lean primary adapter after handoff.

## Dependencies

S0 is the dispatch gate. S1/S2 follow ratification; S3 requires both; S4 requires S3. Before S4 only read-only provenance inventory is allowed. The atomic R0/R1 activation starts only after S4; R2 -> R3 -> R4 are strict. Handoff -> full-app contraction -> proof recut -> EU/DR -> d3y follow. Cleanup is not a dependency.

## Risks

- A missing type extraction could recreate a cross-cluster import; each cluster’s static import closure is a required review item.
- Published package/image contents may differ from checkout; tarball/image assertions remain mandatory.
- Historical Core ownership remains visibly imperfect but cannot be safely rewritten.
- A missed script/socket/import can preserve dual authority; reachability plus handoff proof is mandatory.
- Live EU, migration/handoff execution, and cleanup remain owner gates.

**State recommendation: `ready-for-agent` only after S0 ratification, and then only along the explicit dependency chain.** Before S0 there is no dispatch authority; before S4 controller work is limited to read-only inventory/provenance planning. Cleanup, live migration/handoff execution, and EU runtime-profile acceptance remain future owner-gated.
