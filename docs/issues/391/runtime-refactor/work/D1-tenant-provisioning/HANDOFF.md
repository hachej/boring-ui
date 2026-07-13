# D1-tenant-provisioning - Handoff checklist

## Binding multi-agent Docker v1 handoff (2026-07-11)

### Prerequisites

- [ ] P6-D + A1 compile are complete.
- [ ] P1 lifecycle/readiness and stateless P6-R are complete.
- [ ] [`D1-R0-SPEC.md`](./D1-R0-SPEC.md) is accepted; dispatch uses D1-001
      through D1-006 and not the historical dedicated/runsc beads.
- [ ] One ingress plus one stable full-collection core process is implemented;
      it performs N independent P6-R calls and agents are not containers.
- [ ] D1-R0 identified the current composer inputs and specified a canonical
      redacted workspace-composition identity/digest producer; the host no
      longer supplies an unverifiable arbitrary digest.
- [ ] P2/runsc and X1 mounts are absent from the D1 dependency path.
- [ ] D1-R0 recorded either no P5a code is needed or the exact demonstrated
      P5a readiness/secret slice required.
- [ ] No P3, E1, T1/T2, M2, plugin-snapshot, attachment-catalog, or generation-
      store prerequisite remains.

### Active proof

- [ ] One command plans/applies one Docker host with at least three exact-host
      bindings, distinct deployed agents, managed workspaces/defaults, and
      durable workspace/session roots.
- [ ] Applying additive N+1 leaves retained bindings byte-identical while an
      in-flight request and reconnect complete in the same process. Active
      binding replacement/removal and runtime-input rotation fail before effects.
- [ ] The root-owned pending-pointer/signal preload verifies every candidate
      binding and returns all-ready before the active pointer changes; app HTTP
      credentials cannot trigger candidate activation.
- [ ] Compose uses one file, idempotent `up -d`, service-specific `--no-deps`,
      an external database ref, per-binding env plus external tmpfs secret
      inputs, and never `--force-recreate` or blanket old-file rollback.
      Additive publication does not invoke Compose.
- [ ] Existing-member auth and membership are the only workspace authority;
      landing content grants none.
- [ ] On a bound hostname, existing workspace list/create/switch/delete and
      default auto-provision paths are fenced: members see only the bound
      workspace, non-members fail before effects, and only D1 operator
      lifecycle can remove the managed workspace.
- [ ] The auth proxy strips caller-supplied workspace scope and installs only
      the canonical host-resolved scope. Spoofed/direct-auth variants cannot
      synthesize it. Post-signup accepts only an exact-bound invite; scoped
      foreign/invalid invites set the existing non-enumerating failure cookie
      and create no default workspace, while generic invalid-invite behavior
      remains unchanged. Legacy invite paths reject a foreign workspace before
      token lookup; public token-only routes allow one read-only hash lookup,
      then return the same non-enumerating 404 as an unknown token before
      application effects. Bound workspace rename and all
      generic-host workspace behavior remain unchanged.
- [ ] Every scoped existing-owner demotion/removal fails before mutation, even
      when another owner remains. Every scoped existing-owner account deletion
      also fails before mutation. Non-owner account deletion removes only that
      member's data/membership; editor/viewer removal and owner addition/
      promotion still work; generic ownership/account behavior remains unchanged.
- [ ] Scoped member add is atomic create-if-absent, and owner demotion/removal
      evaluates the committed target role under the same store lock/transaction
      as mutation. Scoped account deletion checks the locked membership inside
      its serializable deletion transaction. Controlled real-Postgres
      interleavings prove both orderings for create/promotion versus demote/
      remove/delete; no route pre-read, process mutex, or route SQL is authority.
- [ ] Plan/apply/publish/rollback exists only through the OS-authorized local
      deployment CLI. Ordinary members, app credentials, and hostname holders
      have no host-mutation route; operator/ref/revision audit is recorded.
- [ ] The existing authorized workspace composer selects the deployed agent as
      `default`; caller workspace/agent selectors cannot choose another target.
- [ ] Cross-hostname/workspace server/front/plugin selectors fail before
      effects; authorized navigation within the selected workspace still works.
- [ ] Invite, embedded/browser, Boring MCP, signed WorkspaceBridge runtime/
      refresh, and managed-agent MCP selectors each enforce trusted scope at the
      named c1-c5 choke point. Public token-only invites perform only the one
      read-only hash lookup needed to discover workspace before a foreign invite
      receives the existing non-enumerating `invite_not_found` denial;
      Boring MCP keeps generic limiting exact when unscoped, while scoped
      onRequest limiting charges every request using only user/IP plus trusted
      workspace before admission; Bridge verifies signature/
      claims, asserts host scope, then loads definition/capabilities, and D1
      mismatch escapes as HTTP 421 rather than RPC error. No caller agent/deployment selector or
      generic selector framework was added.
- [ ] Canonical trusted-proxy/Host parsing and uniqueness reject duplicate or
      ambiguous hostname/workspace/deployment/default bindings and overlapping
      workspace/session roots before effects.
- [ ] A host-resolved immutable runtime-profile ref/content/attestation digest
      proves sibling-root/process denial; plan input cannot self-assert it. Trusted-
      direct is allowed only for local development or a single-workspace
      dedicated composition; it is never valid for the shared N-workspace
      host, regardless of operator trust. Otherwise apply fails or uses
      dedicated-VM variant 2. No silent direct/fake fallback occurs.
- [ ] Any demonstrated P5a slice proves only its readiness/secret seam; when
      existing seams suffice, no P5a code is required. P5a never selects or
      abstracts sandbox providers.
- [ ] Bundle materialization works without source-checkout access.
- [ ] Final activated capability/tool/skill/MCP inventories satisfy every
      non-empty definition requirement before composition identity/publication;
      missing inventory and mismatches fail the one stable composition error.
- [ ] Before candidate/all-ready, a root-owned approved-release record binds
      core/ingress artifacts and commands, Caddyfile digest, redacted host-
      security-config digest, and the immutable merged
      c1-c5 plan/evidence plus execution-policy revisions; the app/apply command
      cannot write it.
      Before Compose mutation, intended desired == approved artifact/command.
      The strict env schema requires the exact approved key set and classifies
      each key as fixed or redacted nonsecret; unknown or secret-bearing env keys
      reject. Secret-ref identities stay in approved state and values stay only
      in the tmpfs file-provider mount. It pins
      `NODE_ENV=production`, forbids five loader keys, and binds owner/mode/roots/
      proxy, auth URL, CORS, CSP, cookie security, and D1/MCP route identity.
      First boot proves core/ingress absent or stopped. Create and inspect the
      exact one-shot migration container with DB-only access and no data/state
      mounts, exact `node .../migrate.js`, `User=10001:10001`, and no web
      entrypoint/capabilities/privileged mode before running it to zero exit.
      Reject inherited web entrypoint and root user. Its deterministic host/revision id
      resumes created/running/exited-zero states, quarantines nonzero/drift, writes
      durable redacted completion before exact-id cleanup, and survives crashes
      at every boundary. Create core stopped, inspect observed ==
      approved artifact/command, `ReadonlyRootfs: true`, and exactly the two data
      volumes plus read-only host-state and host-tmpfs input binds before
      preload/pointer/ingress or lazy first-effect admission. Observed env and
      redacted host-security-config digest satisfy the same policy without logging
      values. A materialized canary is absent from full Docker inspect/config;
      bytes never leave the read-only tmpfs file-provider mount or enter metadata/
      digest/capability/error/evidence. Rotation requires maintenance restart.
      Bind the stopped
      core id, start only that exact id, and wait for health; direct non-Caddy
      application traffic remains scope-rejected. Security/config drift rejects;
      mismatch stops/quarantines core
      while ingress stays stopped. Only verified all-ready/published initial state
      starts ingress. Before that, create ingress stopped and inspect the landed
      D1-003a image/command/Caddyfile contract, read-only root, sole read-only
      config mount, edge/port identity, exact approved image env with no Compose-
      added env, and no command drift. The capability binds verified core and
      stopped ingress ids; publication starts only the exact ingress id.
      Running hosts keep the stable core/ingress and validate observed
      state before N+1 candidate effects.
      The effective process command is the unoverridden full-app Docker web command
      for `apps/full-app/dist/server/main.js`; generic core launchers and app env/
      self-report are not evidence. That approved artifact/command pair freezes
      the complete static c1-c5 workspace-selector-bearing route set:
      `externalPlugins: false` makes plugin-authoring env inert;
      external/raw/runtime plugin gateways and hot reload remain unavailable;
      conditional static MCP families stay in c3/c5; and composition descriptors
      cannot register routes. Each
      candidate composition separately equals its own resolved/preloaded
      composition; sibling digests may differ. Workspace-selector-bearing change requires a
      renewed c1-c5 inventory, a new root-approved release, and maintenance restart.
      Writable code/package roots, mounts over executable paths, or code-loader
      env injection reject.
- [ ] Apply is idempotent. One redacted host snapshot/digest pins the complete
      site-binding collection and every binding's hostname, landing, authority,
      workspace/default, roots/runtime/storage, pinned host artifact,
      composition, definition/deployment, and secret-reference identities
      without secret values or volatile status.
- [ ] Apply/rollback requires the expected host revision; stale writers fail.
      The active collection advances atomically only after full readiness, and
      full-snapshot rollback publishes a new revision. A destructive diff that
      removes/replaces later bindings requires explicit confirmation of the
      exact ids against the current revision; CAS alone is not preservation.
- [ ] Fresh observed readiness/secret status gates publication but is not part
      of desired digest, rollback identity, or P6-R input.
- [ ] Online rollback removes only an added binding with no durable admission
      row, matches the prior host snapshot/digest, and reproduces every P6-R
      digest without a P6 generation registry. Other runtime rollback is an
      explicit maintenance stop/reapply, never an online continuity claim.
- [ ] The external database stores the insert/read-only admission ledger; its
      transaction commits before first agent effect, survives process/revision
      cleanup, and is reloaded before destructive diff or restart recovery. One
      session advisory fences keyed by host/binding serialize first-use active
      recheck+admission commit against rollback. D1-004e locks the exact sorted
      removal set, appends durable `prepared`, publishes the pointer, appends
      `committed`, then releases. Append-only recovery finalizes/resumes/aborts
      every crash phase. Real-Postgres tests race first/last removal keys and
      overlapping sets without deadlock.
- [ ] Preload/all-ready is non-effectful and creates no admission row; failed
      preload leaves zero new rows. An unused published addition rolls back; the
      first actual agent effect commits admission before executing, and a used
      addition thereafter rejects removal. If rollback wins the full fence set,
      first use on every removed key observes removal and creates no row/effect;
      if any admission wins, the whole rollback rejects.
- [ ] DNS/TLS publication occurs only after workspace/default-agent/runtime/
      secret readiness; partial state is not externally reachable.
- [ ] Proof records setup-to-first-run time and stage breakdown against the
      provisional 15-minute target, plus all three hostnames, definition/deployment
      digests, workspace/default bindings, reapply, collection mutation/full
      restoration, rollback digests, selector denials, and secret canary.

### Exit

- [ ] Three exact hosts -> landing -> existing-member sign-in -> distinct
      managed workspaces -> their deployed `default` agents succeed in one EU
      Docker host.
- [ ] Reapply, rollback, cross-binding denial, shared-host sibling isolation,
      and no-secret proofs pass. The dedicated-VM variant has a documented
      configuration render but does not require a second live host.

## Historical dedicated-site D1 handoff — non-dispatchable for v1

The checklist below is design history and cannot close active D1.

Derived strictly from [TODO.md](./TODO.md) and [PLAN.md](./PLAN.md). Tick each
before calling D1 done. Invent nothing.

## Prerequisites

- [ ] P5 provisioning/secrets seams merged.
- [ ] P6-D/P6-R definition/deployment resolver merged.
- [ ] A1 compiler/validator/local-dev path and self-contained bundle merged.
- [ ] Chosen EU host profile is supported by architecture 10 or owner-approved.
- [ ] P2 hardened runsc provider and P5a authenticated worker handshake are
      merged; a direct/bwrap/fake/unverified worker is not a production proof.
- [ ] EU host profile pins the worker HTTPS server identity; an internal caller
      token without server-authenticated TLS is not accepted as worker proof.
- [ ] V1 deployment is bound to `agentId:'default'`; non-default fails with the
      stable route-unsupported code until P7 lands.

## Beads

- [ ] BBD1-001 - Provisioning plan schema + CLI/API entry.
- [ ] BBD1-002 - Tenant/workspace + DB/storage/session roots.
- [ ] BBD1-003 - Secrets and runtime config materialization.
- [ ] BBD1-004a - Bundle materialization + earliest reserved-host inactive
      guard + unpublished endpoint preparation + prepublication manifest; no
      fake readiness producer.
- [ ] BBD1-005 - One managed workspace enforced across server/front selectors.
- [ ] BBD1-006 - Exact-host landing + sign-in + authorized workspace with
      deployed agent as `default`.
- [ ] BBD1-004b - Consume the real BBD1-005/006 capability, append completion,
      CAS pointer, then activate the exact host.
- [ ] BBD1-007 - Apply smoke + rollback notes.

## Verification commands

- [ ] Affected package build/typecheck/test commands.
- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm audit:imports`
- [ ] Provisioning smoke added by this package.

## PR-PLAN reconciliation

- [ ] `pr1-plan-command-api` completed BBD1-001.
- [ ] `pr2-tenant-roots` completed BBD1-002.
- [ ] `pr3-secrets-runtime-config` completed BBD1-003.
- [ ] `pr4-endpoint-preparation` completed BBD1-004a.
- [ ] `pr5-dedicated-workspace-scope` completed BBD1-005.
- [ ] `pr6-dedicated-site-journey` completed BBD1-006.
- [ ] `pr7-publication-integration` completed BBD1-004b.
- [ ] `pr8-apply-smoke-runbook` completed BBD1-007.

## Review gates

- [ ] One command/API creates every required provisioning artifact.
- [ ] Exact hostname and app id bind on first apply and cannot be retargeted in
      v1; unknown/mismatched hosts and untrusted forwarded-host input fail
      closed.
- [ ] The D1 store atomically and uniquely reserves normalized hostname and app
      id to one target before provider side effects; a cross-target race has one
      winner and the loser performs no DNS/TLS/provider mutation.
- [ ] Public landing content is bounded escaped text, grants no authority, and
      has no arbitrary HTML/JS, secret, internal id, or external redirect.
- [ ] D1 resolves an opaque workspace-owner principal ref in the trusted host;
      plan/manifest/log output contains no raw principal/email identity.
- [ ] CTA signs in an existing member through current same-origin auth. Existing
      invite links remain the separate onboarding path; D1 adds no signup/auth-
      policy lifecycle. Post-auth resolution requires membership and ignores/
      validates caller-supplied workspace or agent selectors against trusted
      D1 site state.
- [ ] Dedicated scope intersects every workspace-bearing server route and front
      selection. List returns only the bound workspace; create/switch/delete are
      disabled; a foreign id rejects even when the user is its member. Generic
      behavior exists only on its configured listener; dedicated composition
      rejects every non-bound host, reserved/no-pointer fails inactive, and a
      complete reserved host never falls through to the generic app.
- [ ] Full-app MCP, runtime-plugin/plugin-front, pane-status, and WorkspaceBridge
      selectors/claims consume the same scope before handler/lookup/token mint.
      D1 mounts only P3 `scopedRoutes` over bound Workspace/scoped repositories;
      raw plugin routes fail readiness and indirect foreign session/project ids
      reject before effects.
- [ ] Dedicated scope reaches the existing post-signup workspace hook:
      non-invite signup creates no personal workspace or membership; only an
      invite for the exact bound workspace is accepted. A scoped foreign or
      invalid invite sets the existing non-enumerating failure cookie and
      creates no default workspace; generic invalid-invite signup keeps its
      existing failure cookie plus default creation. Public invite resolve/
      accept selectors are fenced in D1-004c1.
- [ ] Account deletion and member-role/remove paths cannot delete, transfer,
      demote, or orphan the D1-managed workspace. Every existing-owner account
      deletion fails before mutation; non-owner deletion cannot touch the
      workspace; generic behavior remains unchanged.
- [ ] The bound workspace selects the deployment as agent `default`; first chat
      records the same definition/deployment/resolved identity as the active
      complete generation.
- [ ] DNS/TLS publication and complete-pointer CAS require host-produced
      `DedicatedSiteCapability` readiness for both workspace scope and site
      journey, bound to current target/fence, staged desired state, exact site/
      workspace/default-agent binding, and host-app/plugin snapshot. In-process
      issuance is an unexported opaque mint; remote issuance is consumed
      directly from P5a's fresh-nonce pinned-TLS worker channel with issuer,
      audience, expiry, and contract version. Missing, forged, stale, cross-
      target, or cross-generation readiness replay leaves the endpoint
      unpublished.
- [ ] Dry-run and idempotent rerun are tested.
- [ ] `desiredStateDigest` covers all redacted desired inputs: definition and
      deployment identity, attachment refs, immutable host-app artifact and
      activated-plugin snapshot digests, canonical static-host-prompt input,
      host/tier, root policy,
      secret refs/requested grants, opaque owner ref, exact hostname/app id,
      landing/auth origin, endpoint/network, image, and commands;
      no raw secret/identity and no predicted resolved/readiness observation.
- [ ] After materialization D1 appends one immutable completion from staged P6-R with
      resolved-snapshot digest, redacted observed state, and completion digest;
      only then does CAS advance the current-complete pointer.
- [ ] On first apply, route/certificate state is prepared but external exact-
      host activation occurs only after pointer CAS and a final pointer/fence
      recheck. Crash after CAS/before publication leaves the host unreachable
      and resumable. A reserved host without a matching pointer returns
      `D1_SITE_NOT_ACTIVE` before every generic route family.
- [ ] The inactive-host guard lands in BBD1-004a before endpoint preparation;
      BBD1-005 extends that same earliest hook with workspace scope. A partial
      PR stack cannot expose a reserved host, and a dedicated process rejects
      every direct-origin missing/non-bound Host instead of falling through to
      the generic app.
- [ ] P6-R stages but never publishes. Registry routing reads the D1 complete
      pointer; crash after staging/completion append but before CAS keeps the
      prior generation live.
- [ ] Durable apply store is append-only by immutable generation, with desired/
      observed step digests, provider ids, fencing/CAS, and one atomic
      `currentCompleteGeneration` pointer.
- [ ] Exactly one route binding/publication/fence chain exists per tenant+agent.
      Deployment id plus resolved worker/endpoint/server-pin/region/account
      identity digest plus exact hostname/app id/owner ref bind on first apply;
      replacement/relocation/retargeting rejects before side effects even if
      the profile id is unchanged.
- [ ] Every provider create/update/delete accepts the monotonic target fence and
      stable logical resource key; native conditional mutation or the serialized
      target executor rejects stale tokens before side effects.
- [ ] Fault injection at every step boundary resumes/compensates without
      duplicate resources; conflicting concurrent apply rejects.
- [ ] Lease-expiry/takeover fault resumes the old worker before every mutation;
      it gets `DEPLOYMENT_FENCE_STALE` with zero effects, and takeover waits for
      already in-flight work to quiesce.
- [ ] No raw secrets in generated outputs, logs, or docs.
- [ ] Session roots are durable host-volume roots, not container home/root.
- [ ] Deployment manifest follows architecture 10 EU host constraints.
- [ ] Target materializes and verifies the bundle, pinned host-app artifact,
      and activated-plugin snapshot without source-checkout access; mutable
      directory-only plugin sources reject before apply.
- [ ] Manifest/status/session identity carries definition, deployment, and
      resolved-snapshot digests plus desired-state/generation, host-app, and
      activated-plugin snapshot identity plus desired/resolved static-prompt
      digests; rollback appends a new generation from the complete immutable
      prior snapshot.
- [ ] Rollback reproduces the prior host-app/plugin snapshot and prior desired/
      resolved digests, while recording current observed versions and a new
      completion digest; it never copies stale completion observations.
- [ ] Incomplete generations remain inspectable and never replace the last
      complete pointer; same-state reapply converges on the existing generation.
- [ ] P6 staging lease transfers atomically to active/rollback refs at completion;
      active, staged, session, and rollback generations cannot be GC'd. Fenced
      terminal abandonment and history pruning release only their own refs.
- [ ] A different resolved digest prepares a verified inactive app process,
      gates admission, bounded-drains, atomically commits pointer +
      `switch_pending`, switches ingress, then terminalizes prior-generation
      sessions before reopening. Pre-CAS failure preserves old sessions and
      post-CAS recovery completes forward. The same desired-state digest is a
      no-op only after fresh P6-R reproduction of the current resolved digest;
      changed resolved facts transition or fail closed. A desired-only/same-
      resolved delta publishes without process or session churn. The old
      listener is unbound/stopped and direct stale-digest admission rejects
      before `switch_complete` reopens the replacement. V1 has no multi-
      generation session router.

## Exit criteria

- [ ] A tenant/workspace can be provisioned from one invocation.
- [ ] Runtime config, roots, secret refs, existing-surface endpoint binding, and deployment manifest exist.
- [ ] The dedicated URL serves its landing and an authorized member reaches the
      bound workspace with the deployed agent selected as default; a non-member
      learns no workspace or agent detail.
- [ ] Timed golden path RECORDS timing vs the provisional 15-minute target
      (target, not gate — D1-R0 §9.10) with preconfigured infrastructure;
      reapply is idempotent and rollback selects the prior complete deployment
      snapshot and verifies its resolved digest.
- [ ] Smoke proof confirms the provisioned shape is usable.

## Closeout

- [ ] Zero unowned `TODO(remove:*)` markers for this package.
- [ ] PRs merged per [PR-PLAN.md](../../PR-PLAN.md).
