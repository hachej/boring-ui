> **#391 status (2026-07-17): historical reference / non-dispatchable.**
>
> Active authority: `docs/issues/391/plan.md` and Decision 25 in
> `docs/DECISIONS.md`. Where this file conflicts, the active authority wins.

# TODO-P8 — Verification and cleanup (zero deferred deletions)

## Binding reduced v1 work order (2026-07-11)

Dispatch only these verification slices:

1. **Reduced invariant/marker gate:** zero markers owned by the reduced v1
   slices; core/package boundary and #416 invariants remain green. Add a
   residual `runtime.*none|pure.*mode` grep for product code and non-historical
   docs, with explicit rejection/history allowlists. Do not add T1/T2/P3/E1
   old-path gates for work that did not ship.
2. **Shipped-contract docs:** document the workspace-backed core boundary,
   minimal definition/deployment bundle, explicit local workspace/runtime, and
   D1 multi-agent-host/default-agent paths. Do not claim the four-part durable surface
   contract as v1.
3. **Golden path:** measure the proof defined in PLAN.md on one EU Docker host
   using the D1-R0-specified canonical workspace-composition identity producer;
   record stage timing and compare it
   with the provisional 15-minute target; capture two-binding selector/root and
   secret negatives, no-op reapply, then apply changed collection values and
   roll back. Compare every prior redacted host field/digest, including pinned
   host artifact/storage inputs, hostnames, landings, auth/membership/owner and
   workspace/default bindings, roots/runtime, composition, definition/
   deployment, and secret ref identities only; reproduce all P6-R digests and
   never record secret values or volatile readiness in desired identity.
   Prove spoofed and direct-auth scope cannot reach signup; foreign/malformed
   workspace paths return generic 421 before store access; membership precedes
   lookup; and the bound member list has exactly one workspace. Only an exact-
   bound post-signup invite succeeds; scoped foreign/invalid invites set
   `boring_invite_failed=invite_not_found` and create no default workspace;
   generic invalid invites retain the failure cookie plus default creation.
   Legacy invite paths reject foreign scope before token lookup; public token-
   only routes allow one read-only hash lookup, then return the same non-
   enumerating 404 as an unknown token before application effects. Bound rename
   and generic workspace behavior remain unchanged. Prove
   every scoped existing-owner demotion/removal/account deletion fails before mutation with
   `D1_MANAGED_WORKSPACE_MUTATION_FORBIDDEN`, while non-owner account deletion
   removes only that member's data/membership and editor/viewer removal, owner
   add/promotion, and generic ownership/account behavior still work.
   Exercise all c1-c5 boundaries: invite's sole read-only hash lookup, embedded/
   pane selector conflicts, Boring MCP global auth and unauthenticated 401 before
   route admission and generic-exact behavior. Prove the four POSTs keep their
   existing limiters, while `GET /sources` uses the same Fastify route mechanism
   and skips unscoped requests. All five scoped routes must charge every
   authenticated valid/malformed/conflicting/foreign/nonmember request by
   `request.user.id` + frozen `requestScope.workspaceId` before the shared first-
   preHandler admission and any workspace/member/user-store/provider/transport
   effect, with no manual D1 limiter, second budget store, or raw-selector key/
   bypass;
   signed Bridge claims scope-
   asserted before registry/definition with HTTP 421 before runtime/refresh
   effects, and managed-agent MCP trusted scope/default dispatch. Prove any
   workspace-selector-bearing change requires renewed inventory, a new root-
   approved release, and maintenance restart. Prove the root-owned release record
   binds core/ingress artifacts, commands, and Caddyfile digest to the immutable
   merged c1-c5 plan/evidence and
   execution-policy revisions plus redacted route/trust-boundary config digest.
   Prove the strict intended/observed env schema has the exact approved nonsecret
   key set; unknown or secret-bearing env keys reject. Secret-ref identities stay
   in approved state and raw values stay in tmpfs file inputs. Pin
   `NODE_ENV=production`, forbid the five loader keys, and prove owner/mode/roots/
   proxy, auth URL, CORS, CSP, cookie security, MCP enablement, and managed-target
   drift reject. Prove core/ingress absent or stopped. Create/inspect the exact
   DB-only one-shot migration container without data/state mounts, exact Node
   migration process, `User=10001:10001`, and no web entrypoint/root/capabilities/
   privileged mode, then run it to zero exit. Prove deterministic host/revision identity resumes created/running/
   exited-zero, quarantines nonzero/drift, writes durable redacted completion
   before exact-id cleanup, and survives every crash boundary. Create core
   stopped; then prove observed == approved, read-only root,
   exact four mounts, and matching env/config before preload/pointer/ingress or
   lazy mutation/direct-operation admission. Prove a materialized canary is absent from full
   Docker inspect/config, raw bytes remain only in the read-only tmpfs file-
   provider mount, and maintenance restart plus fresh attestation follows
   rotation. Bind the stopped
   core id, start only that exact id, wait for health, and prove direct non-Caddy
   app traffic remains scope-rejected. Unapproved digest, command override, code-loader env, writable root, or
   executable-path mount stops/quarantines core while ingress stays stopped;
   only verified all-ready/published state starts ingress. Create ingress stopped,
   inspect the landed D1-003a image/command/config identity, read-only root, sole
   read-only config mount, edge/port mapping, exact approved image env with no
   Compose-added env, and no command drift; bind verified core and stopped ingress
   ids and prove publication starts only that exact ingress id. Running-host drift
   rejects before N+1 candidate effects. Preload/all-ready creates no admission
   row; failed preload leaves zero new rows. A D1-004d2 mutation or any D1-004d3
   direct operation, including a read-like operation, commits admission before
   execution. D1-004d2 service/facade reads/list/subscribe and cache population,
   D1-004d3 token refresh, and D1-005c preload/all-ready do not admit. First use
   locks one host/binding; rollback locks
   the exact sorted removal set with session locks, appends prepared, publishes
   the pointer, appends committed, then releases. Prove finalize/resume/abort at
   every crash boundary plus real-Postgres first/last-key and overlapping-set/no-
   deadlock races. This proof is independent of generic core launchers/app self-
   report and separate from per-binding candidate/preload equality; siblings may
   differ. Prove a fresh D1-005c-minted `AttestedD1DatabaseConnection` for
   production core boot and each CLI destructive-diff read by comparing the one
   root-owned expected identity with values queried on the live handle; no
   registry/table substitutes. All transaction/
   advisory commands use its one reserved physical handle. Under that fence,
   recheck the exact binding/workspace/default-deployment triple while allowing
   an unchanged triple in an additive revision. Enumerate every D1-004d2 facade/
   service/slash/reload mutation and prove reload admission precedes reprovision,
   `beforeReload`, and `reloadSession`. D1-004e runs only after d1/d2/d3 are
   complete.
   Use controlled real-Postgres interleavings in both lock orders to prove a
   concurrent scoped owner create/promotion cannot be overwritten by member
   add/demote/remove or account deletion; route pre-reads are not proof.
   The same proof records isolated-profile sibling filesystem/process denial
   for the shared N-workspace host. Trusted-direct is accepted only for local
   development or a single-workspace dedicated composition and never as this
   shared-host proof.
4. **Follow-up ledger:** keep M1/AR1/M2/E2, T1/T2, P2/X1, full P3, E1, no-environment, and
   wider P6/D2/S3/S4 work explicitly tracked post-v1.

Prerequisites are P1, P6-D, A1, stateless P6-R, D1, and any P5a slice D1-R0
actually demonstrated. Zero P5a code is a valid recorded outcome.
M1 config cleanup gates P8 only if the shipped D1 path actually consumes that
duplicate behavior source. No generic generation, generic/per-agent plugin-
snapshot, attachment,
durable-event, approval, or transport proof belongs here.

## Historical 2026-07-09 work order — non-dispatchable for v1

### Former binding v1 gate

Required: P1, T1/T2, P2/P3, E1, P5a, P6-D/P6-R, A1, D1, zero
removal markers, and the timed exact-URL-to-default-agent product proof. Not
required: P4, E2, X1, P5b,
P6 plugin/child-app expansion, P7, M2, D2, S3, or S4.

Coordinator: never assign this whole file. Dispatch one bead/PR with this
file's context, dependencies, and non-negotiables included in the assignment.

## Context (read first)

- Plan: `docs/issues/391/runtime-refactor/INDEX.md` § "Phase 8 — Verification + cleanup" — the v2 rewrite: **Phase 8 is a VERIFICATION phase, not a deferred-deletion dump.** Assert zero `TODO(remove:*)` markers repo-wide (add to invariant scripts); update package docs; convert remaining plan tasks into beads/issues. There is no "migration window" — all import migrations happened in-PR per the no-compat policy. Additional exit criterion: `@hachej/boring-agent` README documents the four-part surface contract (`08`) as the stable public API.
- Plan: `docs/issues/391/runtime-refactor/INDEX.md` — the BINDING "Simplicity & no-compat policy". Rule 2 is the one P8 enforces: "Transitional code has a deadline … carries a `// TODO(remove:<bead-id>)` marker and a deletion bead. A phase is not done while any of its markers remain. **Phase 8 verifies zero markers — it is not a dumping ground for deferred deletions.**" Rule 4: no parallel implementations past their cutover. **Cross-TODO owners are legitimate:** rule 2's cutover carve-out lets a marker name a deletion bead that lives in a **later** TODO than the one that introduced the transitional code (canonical case: the `?cursor=` legacy path's `TODO(remove:BBT2-006)` is owned by `TODO-T2`, not the T1-era code that planted it). P8 does not care *which* TODO owns a marker — it enforces that **every surviving marker names a real deletion bead and that its named owner's phase has landed** (i.e. zero markers repo-wide at exit); a marker whose named owner is a later, still-in-flight TODO simply means that owner phase is not done yet, not that P8 must absorb it.
- Plan: `docs/issues/391/runtime-refactor/architecture/08-pluggable-agent-surfaces.md` § "What every framework converges on" — the **four-part surface contract** to be documented as stable public API: (1) message in (`AgentSendInput`), (2) indexed replayable event stream out (`AgentEvent`), (3) approvals as request→response events on the same stream (`resolveInput` / `ResolveInputResponse`), (4) runtime-owned `sessionId` + surface-owned addressing (two handles). Also § "The headless façade: `createAgent()`" (the full public runtime API) and § "Decisions this file locks".
- Plan: `docs/issues/391/runtime-refactor/architecture/00-global-isa.md` invariants (all must be green at exit) and § "Issue coverage posture" (what this plan is allowed to claim vs merely support with extension points).

### Depends on

- **Every v1 gate named above.** P8 must not land while any owning v1
  phase's removal marker is live. Post-v1 plans do not enter this gate.
- **R0 M1 is a separate delivery milestone; D1 is a v1 gate.** M2/D2/S3/S4,
  P6b, and the other post-v1 rows are tracked but never awaited here.
- **Conditional cleanup:** A1 BBA1-003 is a v1 gate only when the shipped D1
  path actually consumes duplicated M1 behavior configuration. Optional M1's
  mere existence does not create this gate.

### Current repo reality this bead verifies (verified paths)

- **No `TODO(remove:` markers exist yet** — `! rg -n "TODO\\(remove:" packages apps plugins scripts` exits 0 today. Markers are introduced by earlier phases (T1's `?cursor=` window, T2's front cutover, P2's provider move, etc.) and deleted in-phase. P8 asserts the count is back to **zero** across the whole repo.
- Invariant script wiring to extend (do NOT bypass — `README.md` global non-negotiable): root `pnpm lint:invariants` = `pnpm --dir packages/agent run lint:invariants && pnpm --filter @hachej/boring-bash run check:invariants && pnpm lint:workspace-plugin-invariants` (verified `package.json`). Root `pnpm audit:imports` = `pnpm tsx scripts/audit-imports.ts`. Agent invariants = `bash scripts/check-invariants.sh .` (ripgrep-based `run_check` pattern helper, verified `scripts/check-invariants.sh`). `scripts/audit-imports.ts` holds the `FORBIDDEN_PATTERNS` array (verified) — the natural home for old-path-import gates.
- **Moved-path gates to assert empty** (each was migrated + deleted in-PR by its phase; P8 proves no straggler importer resurfaced):
  - P2/P3: no `@hachej/boring-agent/server` value import of moved providers (`createDirectSandbox`, `createBwrapSandbox`, `createRemoteWorker*`, `createVercelSandboxWorkspace`) — they live under `@hachej/boring-sandbox/providers` now — nor of `resolveMode`/`autoDetectMode`/`hasBwrap` — those live under `@hachej/boring-bash/modes` now. Also assert agent has zero value import from `@hachej/boring-sandbox`.
  - P4 is post-v1 and has no v1 relocation gate.
  - T1/T2: no live `ask-user.v1.*` WorkspaceBridge handler (deleted in BBT1-005); no `?cursor=` NDJSON front path / `schedulePiChatReconnect` / `replay_gap` recovery (removed in T2 BBT2-003); `piChatReplayBuffer.ts` gone if T2 removed it.
- README to update: verified current package reality is that `packages/agent/package.json` has **no** `"readme"` field and ships `files: ["dist", "docs"]`; the canonical package README is therefore `packages/agent/README.md`, with `packages/agent/docs/runtime.md` as the runtime deep-dive. P8 must document the four-part surface contract + `createAgent()` public API in those docs. Do not put contract authority in a front entrypoint header.

## Goal / exit criteria

Match [`../../INDEX.md`](../../INDEX.md) Phase 8 (v2):

1. **Zero `TODO(remove:*)` markers repo-wide**, asserted by a check wired into `pnpm lint:invariants` (fails CI if any marker survives).
2. `@hachej/boring-agent` package docs document the **four-part surface contract** (`08`) + the `createAgent()` public runtime API as the stable public surface.
3. Remaining plan tasks (anything in `00`–`09` not yet a landed bead, plus the explicitly deferred boundaries) converted into tracked beads/issues — nothing left only in prose.
4. No code imports old moved paths for delivered P2/P3/T1/T2 relocations.
5. All `00` invariants + package invariant scripts + `audit:imports` green; full build+test green.
6. Prompt composition proves that `instructionsRef` is the only agent-authored
   prompt reference and that disabling a capability/plugin removes its prompt
   fragment together with its tools and other surfaces.
7. The dedicated hostname serves its bounded landing page, authenticates an
   authorized member into the bound workspace, and that workspace selects the
   deployed definition as agent `default`; forged workspace/agent selection
   fails closed.

## Non-negotiables

- **The rule (state it, enforce it): a surviving `TODO(remove:*)` marker reopens the phase of its NAMED deletion-bead owner** (which, per rule 2's cross-TODO carve-out, may be a *later* TODO than the one that planted the marker — e.g. `TODO(remove:BBT2-006)` reopens T2, not the T1-era code that carries it). P8 does NOT delete other phases' transitional code and does NOT convert a live marker into a new "cleanup later" bead. If the marker is still live, its named owner's phase is not done — file it back to that owner phase, do not absorb it here ([`../../README.md`](../../README.md) rule 2; [`../../INDEX.md`](../../INDEX.md) Phase 8: "not a dumping ground for deferred deletions").
- Extend the existing invariant scripts; do NOT add a parallel lint framework (`README.md` global non-negotiable: "extend, don't bypass").
- Documentation states the **stable** public API only — the four-part contract, `createAgent()`, the two-handles rule. Do not document internal/transport internals as public.
- Do NOT relax any `00` invariant to make the gate pass. If an invariant genuinely cannot hold, that is a finding to escalate, not to weaken.
- Respect the legitimate compat surfaces that MUST stay (never "clean these up"): on-disk pi session JSONL, the landed #416 shared contracts (`packages/boring-bash/src/shared`), server↔front within one release train (`README.md` / `08` decision 10).

## Do NOT

- Do NOT touch `/home/ubuntu/projects/boring-ui-v2`. Work on a dedicated branch/worktree per the PR-PLAN branch naming; never commit to main directly; every bead lands as a PR per INDEX.
- Do NOT delete another phase's transitional code to make the marker count zero — reopen that phase instead.
- Do NOT introduce a new deferred-deletion marker or a "Phase 9" dumping ground.
- Do NOT remove the #416 shared contracts, the JSONL session compat, or any still-in-train server↔front seam.
- Do NOT re-add old-path re-export shims to "fix" a gate — the fix is migrating the straggler importer.

## Beads

### BBP8-001 — Repo-wide `TODO(remove:*)` marker gate (zero-tolerance) · size S
- **Title**: A check that fails if any `TODO(remove:<bead-id>)` marker remains, wired into `pnpm lint:invariants`.
- **Files create/touch**: create `scripts/check-no-remove-markers.mjs` (repo-wide ripgrep/glob scan for the literal `TODO(remove:` across `packages/`, `plugins/`, `apps/`, `scripts/` — excluding `node_modules`, `dist`, and this `docs/issues/391/**` plan folder, which legitimately *describes* the marker regime). Print each offending file:line and the owning bead id parsed from the marker, then exit non-zero. Wire it into root `package.json`: add to the `lint:invariants` chain (or `lint`) so `pnpm lint:invariants` runs it. Do not put it in `check-invariants.sh` (that is scoped to a single package root; the marker gate is repo-wide).
- **Notes**: The scan must extract the bead id inside `TODO(remove:<id>)` and print it, so a surviving marker names the phase to reopen (enforces "the rule"). Zero markers exist today → the gate passes on introduction; it only bites when an earlier phase left one live.
- **Tests**: `scripts/__tests__/check-no-remove-markers.test.mjs` (or inline) — a temp fixture containing `TODO(remove:BBX-001)` makes the script exit non-zero and print `BBX-001`; a clean tree exits 0. Assert the real repo is currently clean.
- **Acceptance**: `pnpm lint:invariants` includes the marker gate; a planted marker fails it naming its bead; the repo is clean (0 markers).

### BBP8-002 — Document the four-part surface contract as stable public API · size M
- **Title**: `@hachej/boring-agent` package docs describe the four-part surface contract + `createAgent()` as the stable public API.
- **Files touch/create**: document `AgentSendInput { sessionId?, content,
  inputAssets?, actor?, ctx?, originSurface?, requestId }`; request idempotency,
  actor/origin attribution, indexed events, one approval channel, two handles,
  and the nine-member façade. Link executable conformance suites.
- **Notes**: This is the [`../../INDEX.md`](../../INDEX.md) Phase 8 additional exit criterion and README Phase 8 delta. Keep it a description of what shipped (P1/T1/T2/S3) — do not spec new API. If the `AGENTS.md`/`DECISIONS.md` ADR from Phase 0 needs a back-reference, add a one-line pointer, do not duplicate.
- **Tests**: doc build/lint if the repo has one (`pnpm check:generated-artifacts` if docs are generated); otherwise a link-check that the referenced symbols exist (`createAgent`, `AgentEvent`, `AgentSendInput`, `ResolveInputResponse`) as exports.
- **Acceptance**: the four-part contract + `createAgent()` are documented as stable public API; referenced symbols exist.

### BBP8-003 — Old-moved-path import gates (delivered P2/P3/T1/T2 relocations) · size M
- **Title**: Assert no importer of any relocated symbol/path resurfaced; each relocation gate is green.
- **Files touch**: `scripts/audit-imports.ts` `FORBIDDEN_PATTERNS` (and/or the package `check-invariants` scripts) — add patterns proving the migrations are complete and no straggler exists:
  - agent old provider exports: `createDirectSandbox`/`createBwrapSandbox`/`createRemoteWorker*`/`createVercelSandboxWorkspace` (now in `@hachej/boring-sandbox/providers`) and `resolveMode`/`autoDetectMode`/`hasBwrap` (now in `@hachej/boring-bash/modes`) are not exported from `@hachej/boring-agent/server` and not imported from there. Agent has zero value import from either `@hachej/boring-bash` or `@hachej/boring-sandbox`; the sandbox→agent edge is type-only.
  - P3 BBP3-019 keeps `filesystemPlugin` workspace-owned but capability-gated:
    without resolved filesystem facts there is no plugin/provider/renderer
    registration and no file/tree/search/upload UI API request; capable
    workspace behavior remains intact. P4 owns any later relocation.
  - no live `ask-user.v1.*` bridge handler; no `?cursor=` NDJSON front transport / `schedulePiChatReconnect` / `replay_gap` recovery; `piChatReplayBuffer.ts` absent if T2 removed it.
- **Notes**: confirm gates from delivered v1 relocation phases. P4 has not moved
  and therefore contributes no old-path gate.
- **Tests**: run the gates against the repo; deliberately add a banned import in a scratch file → gate fails; revert. Each relocation has a corresponding passing assertion.
- **Acceptance**: every delivered P2/P3/T1/T2 relocation gate is present and green.

### BBP8-004 — Convert remaining plan prose into tracked beads/issues · size S
- **Title**: Nothing actionable left only in `00`–`09` prose; everything is a landed bead or a tracked follow-up issue.
- **Files touch**: create tracking issues/beads (per the repo's `br`/beads workflow) for the explicitly deferred items and any un-beaded plan task. Known deferrals to file as future issues (do NOT implement here):
  - richer executable/file-convention authoring beyond A1's v1 `agent.json` + `instructions.md`;
  - `FileTreeDataProvider` pluggable boundary (deferred to `#295`, P4 BBP4-012);
  - the **document-authority write/edit override seam** (the whole seam — not just a registry — deferred out of this epic; arrives with its first real authority implementation #367/#226, P4 BBP4-013);
  - **governed-context-in-embeds** (injecting a readonly `company_context` binding into a spreadsheet/product embed) — relocated to pi-for-excel issue #551;
  - **P6b — child-app scoping** (BBP6-001 consume `ResolvedChildAppContext`, BBP6-006 Macro scoping) — HARD BLOCKED on the shared child-app platform type (`ResolvedChildAppContext`, #376); a **tracked follow-up OUTSIDE the epic exit**. **P8 files this follow-up issue and confirms it is filed — it does not wait on P6b landing**;
  - **M2 — MCP agent surface** (`work/M2-mcp-agent-surface/`) — committed follow-up that may land after P8; P8 verifies it is tracked with its registry/exposure/conformance scope;
  - **D1 — dedicated tenant provisioning** is a v1 gate and must include the
    timed exact-host landing/auth/workspace/default-agent plus
    definition-digest/rollback proof;
  - **D2 — shared subdomain tenancy** (`work/D2-shared-tenant-mesh/`) — factory sidecar lane outside the runtime epic exit; P8 verifies it is tracked with P1/P5/P6a/P7/T1/M2 prerequisites;
  - **S4 — agent onboarding status** (`work/S4-agent-onboarding/`) — onboarding/status follow-up outside the runtime epic exit; P8 verifies it is tracked with S3/M2/D1/D2 prerequisites;
  - `00` still-open decisions 5 (provisioning sharing defaults) and 7 (surface addressing store location); decision 3 (providers package location) is already resolved by `08` decision 11 and must not be reopened;
  - any Phase 5 (provisioning/readiness) and Phase 6a task not yet beaded.
- **Notes**: This bead **catalogs and files**, it does not build. Cross-check each `00` § "Issue coverage posture" item: mark which acceptance actually landed (so the plan does not overclaim) and file the rest. It also runs the plan-pack navigability gate from `07`: canonical files outside legacy `todos/` must not reference old nonexistent TODO filenames or the removed architecture-six file; every cross-work-package pointer should be a real relative link, with `INDEX.md` as the single ordering authority.
- **Tests**: n/a (tracking artifacts). Acceptance is the filed issue list referenced from the plan or a `docs/issues/391/runtime-refactor/BACKLOG.md`-style index if the repo prefers in-repo tracking.
- **Acceptance**: every post-v1 task has a tracked package/bead and none is silently treated as a v1 gate.

### BBP8-006 — Execute and record the v1 agent-factory golden path · size M

- **Title:** One executable proof runs scaffold -> validate -> local turn ->
  dedicated apply -> exact URL -> landing -> member workspace -> default agent
  -> reapply -> rollback.
- **Files touch/create:** consume the D1 BBD1-007 smoke as
  `pnpm --filter @hachej/boring-ui-cli run smoke:agent-factory-v1 -- <host-profile>`
  (or the exact equivalent name landed by D1); add a versioned redacted evidence
  schema/output path under the existing proof-of-work convention. P8 does not
  create another deployment harness.
- **Run conditions:** infrastructure/provider credentials and host profile are
  preconfigured before the timer. The target is the real EU
  runsc/systrap provider from BBP2-010 selected only after the pinned-HTTPS P5a
  worker handshake; direct/bwrap/Vercel/fake is not accepted. Scaffold into an external temp directory,
  use a deployment bound to `agentId:'default'` (the only v1 route),
  snapshot the repo worktree before/after, compile the bundle, run one local
  scripted turn, apply to a target with no source-checkout access, open the
  exact HTTPS hostname, verify the landing, authenticate a provisioned member,
  enter the bound workspace, and complete one turn through its server-selected
  `default` agent. Restart the real dedicated app process without changing the
  active pointer, then send a follow-up on that completed session and prove the
  same resolved, host-app, plugin, static-prompt, route, and default-agent
  identity. Prove workspace list returns only that workspace and direct
  create/switch/delete/foreign-workspace requests fail; a non-invite dedicated
  signup creates no workspace. Exercise foreign selectors/claims through
  full-app MCP, runtime-plugin/plugin-front, a P3 scoped-route fixture with
  explicit and indirect foreign session/project ids, pane-status, and
  WorkspaceBridge; prove a raw-route plugin fails D1 readiness before mount.
  Prove every existing-owner account deletion and owner demotion/removal fails
  before mutation; non-owner account deletion removes no managed workspace.
  Verify the target loaded the pinned host-app artifact and exact P3 activated-
  plugin snapshot; disable or alter one plugin contribution and prove it cannot
  reuse the prior desired/resolved identity.
  Run identical desired-state reapply and prove the process/session stay
  untouched only after fresh P6-R reproduction of the resolved digest. Change
  one authenticated provider/environment/grant fact without changing desired
  input and prove apply cannot false-no-op: it transitions to the new resolved
  identity or fails closed. Apply one
  changed immutable plugin or static-prompt input to create a second complete
  generation; prove the bounded transition admits from only one process and the
  old session now rejects follow-up with `SESSION_GENERATION_RETIRED`. Start a
  new session on generation two, then CAS rollback by appending a new
  generation from the previous complete immutable desired-state snapshot.
  Prove generation-two's session is likewise retired and a fresh session uses
  the restored generation-one identity.
  Fault a changed-generation transition before pointer/`switch_pending` commit
  and prove the old process/session resume untouched. Fault after that atomic
  commit but before ingress switch and prove the site stays gated until recovery
  completes forward to the new process and only then retires the old session.
  Probe the old origin directly after pointer/ingress switch; immutable boot-
  digest mismatch must reject before old plugin routes, and the replacement must
  not reopen until the old listener is unbound/stopped.
  Attempt site-capability replay from another target and from the previous
  generation/fence; both must leave DNS/TLS and the complete pointer unchanged.
  Attempt to inject a caller-fabricated capability and reject it before side
  effects. Fault first apply after route preparation and after pointer CAS but
  before external activation; the former exposes no host, the latter leaves the
  host unreachable and resumable. Direct-origin requests with the reserved host
  and no complete pointer fail inactive across every route family. Direct-origin
  requests to the dedicated process with a missing or non-bound host fail before
  generic auth/routing and never expose the multi-workspace app.
- **Evidence:** machine-readable start/end/elapsed seconds; exact CLI/version and
  host-profile id; definition id/version/digest; deployment id/version/digest;
  host-app artifact and activated-plugin snapshot digests; resolved-snapshot
  static-host-prompt input, resolved static-prompt, and desired-state digests;
  apply generation/current-complete
  pointer/resource ids (redacted); exact hostname, TLS/route identity, landing
  content digest, authenticated membership result, bound workspace id
  (redacted), fixed-workspace API/front/plugin-route-scope results, and proof the turn used
  agent `default`; remote asset
  verification; identical desired-state reapply reports no resource change;
  pre-CAS old-session preservation and post-CAS forward-recovery evidence;
  rollback target
  and reproduced resolved/desired-state digests; proof that the prior complete
  host-app/plugin snapshot was reproduced; proof that the prior complete
  pointer survived an injected incomplete generation; same-generation real-
  process restart/session-follow-up result; changed-generation transition
  timing, single-admitter proof, and both durable session-retirement outcomes;
  changed platform-source
  file list (must be empty); secret-canary scan result.
- Evidence also records worker TLS identity/pin, authenticated hardening facts,
  runsc version/platform, network/limit probes, and an old-generation takeover
  probe showing `DEPLOYMENT_FENCE_STALE` with zero provider side effects.
- **Failure conditions:** elapsed >900 seconds, any platform-source edit,
  source-checkout dependency on target, missing/mismatched digest, duplicate
  resource on reapply, host-app/plugin snapshot drift, mutable plugin source,
  accepted fabricated/cross-target/generation site-capability, a reachable
  first-apply host before complete-pointer CAS, generic routing for a reserved
  host with no pointer, static host prompt drift under an unchanged digest,
  unknown-host acceptance, landing-based authority grant,
  workspace creation/switch/deletion, workspace/agent selector escape,
  incomplete rollback, or any raw secret fails the bead.
- **Acceptance:** a reviewer runs one command and receives complete product
  evidence; component tests alone cannot satisfy this bead.

### BBP8-005 — Final invariant + build/test sweep · size S
- **Title**: The whole pack's guarantees hold simultaneously.
- **Files touch**: none (verification bead); fix-forward only if a gate fails (each fix is a finding routed to its owning phase, not patched here).
- **Notes**: Run the full gate set (Verification section). Any red gate that traces to an earlier phase is escalated to that phase (reopen), consistent with "the rule". P8 lands only when everything is green with zero markers.
- **Tests**: the Verification commands below.
- **Acceptance**: all `00` invariants green; zero markers; full build+test green; no old-path importer.

## Verification — exact commands verified against package.json scripts

```bash
# the marker gate (new — BBP8-001) + all existing invariants + import audit (root package.json)
pnpm lint:invariants        # agent check-invariants.sh + boring-bash check:invariants + workspace plugin invariants + (new) marker gate
pnpm audit:imports          # tsx scripts/audit-imports.ts — old-moved-path gates (BBP8-003)
node scripts/check-no-remove-markers.mjs   # BBP8-001 direct run: expect 0 markers, exit 0
pnpm --filter @hachej/boring-ui-cli run smoke:agent-factory-v1 -- <preconfigured-host-profile> # BBP8-006

# per-package invariants (confirm each relocation boundary)
pnpm --filter @hachej/boring-bash run check:invariants
pnpm --filter @hachej/boring-workspace run lint:plugin-invariants
pnpm --filter @hachej/boring-agent run lint:invariants
pnpm --filter @hachej/boring-agent run check:isolation

# full build + test (root package.json: build:packages then per-pkg)
pnpm typecheck              # build:packages then -r typecheck
pnpm test                   # build:packages then -r test

# spot-checks: no live moved-path importer / legacy approval or cursor path (each should print nothing)
! rg -n -U "import\\s*\\{[^}]*\\b(resolveMode|autoDetectMode|hasBwrap|createDirectSandbox|createBwrapSandbox|createRemoteWorkerModeAdapter|createRemoteWorkerSandbox|createVercelSandboxWorkspace)\\b[^}]*\\}\\s*from\\s*['\"]@hachej/boring-agent/server['\"]" packages apps plugins -g '!**/*.md'
! rg -n "ask-user\\.v1\\." packages apps plugins -g '!**/*.md'
! rg -n "\\?cursor=|schedulePiChatReconnect|replay_gap|PiChatReplayBuffer" packages apps plugins -g '!**/*.md'
```

## PR-PLAN reconciliation

Matches [`../../PR-PLAN.md`](../../PR-PLAN.md) P8 rows exactly:

- `pr1-marker-import-gates` → BBP8-001 + BBP8-003.
- `pr2-surface-contract-docs` → BBP8-002.
- `pr3-golden-path-and-followups` → BBP8-006 + BBP8-004.
- BBP8-005 is the final merge gate on the stack, not a separate PR. Any red gate reopens its owning phase; P8 does not absorb it.

## Review gates

- `pnpm lint:invariants` runs the `TODO(remove:*)` gate; the repo has **zero** markers; a planted marker fails the gate and names its owning bead.
- No surviving marker was "absorbed" into a P8 cleanup bead — any live marker reopened its owning phase instead.
- Four-part surface contract + `createAgent()` documented as stable public API; referenced symbols exist.
- Every delivered P2/P3/T1/T2 relocation import gate present and green.
- Every deferred/un-beaded plan task filed as a tracked issue/bead; `00` coverage posture reconciled (no overclaim).
- BBP8-006 evidence exists and proves timing, zero source edits, remote bundle
  materialization, all identity digests, no-op reapply, full rollback, and no
  secret leak.
- Full `pnpm typecheck` + `pnpm test` + `pnpm audit:imports` green; all `00` invariants hold; #416 contracts + JSONL session compat untouched.
