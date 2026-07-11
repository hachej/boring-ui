# P8-verification — Handoff checklist

## Binding reduced v1 handoff (2026-07-11)

### Prerequisites

- [ ] P1 workspace/Fastify boundary is complete.
- [ ] P6-D schemas/digests and A1 compile are complete; no false BBP6-003
      lookup prerequisite remains.
- [ ] A1 local dev proves an explicit authorized workspace and approved runtime.
- [ ] Stateless P6-R and multi-agent D1 are complete. Any D1-R0-demonstrated
      P5a slice is complete, or explicit evidence records no P5a code was
      needed. P2 is not a gate.
- [ ] M1/AR1/M2/E2, T1/T2, P2/X1, full P3, E1, plugin snapshots/scoped registrars, attachment
      catalogs, and P6 generation stores are not treated as prerequisites.

### Review/proof

- [ ] V1-owned `TODO(remove:*)` markers are zero; a live marker reopens its
      reduced-slice owner rather than becoming P8 cleanup.
- [ ] Applicable core/package/import invariants and #416 contracts are green;
      no gates are invented for deferred relocations.
- [ ] Residual `runtime.*none|pure.*mode` grep rejects public/product pure-mode
      acceptance in code and non-historical docs; explicit rejection tests and
      marked historical sections are the only allowlist.
- [ ] Package docs describe only what shipped: workspace-backed core,
      definition/deployment bundle, explicit local workspace/runtime, and D1.
- [ ] One command measures compile -> local workspace-backed turn ->
      D1 apply -> at least two exact HTTPS landings -> existing-member sign-in
      -> distinct authorized workspaces -> their deployed `default` agents in
      one real EU Docker host, records
      stage timings, and compares them with the provisional 15-minute target.
- [ ] Evidence records source-independent bundle/host materialization, foreign-
      selector and workspace-lifecycle denial, and idempotent reapply. It then
      mutates collection-level desired values and proves rollback restores every
      field in the prior complete redacted D1 host snapshot/digest: hostnames,
      landings, auth/membership/owner and workspace/default bindings, roots/storage/
      runtime, host artifact, composition, definition/deployment, and secret
      reference identities only. Fresh observed status is recorded separately;
      the prior P6-R digests are reproduced and no secret value appears.
- [ ] The shared N-workspace D1 trust path proves isolated-profile sibling
      filesystem/process denial. Trusted-direct is accepted only for local
      development or a single-workspace dedicated composition, never as the
      shared-host proof.
- [ ] P2 provider selection and X1 mounts are absent from the v1 proof.
- [ ] Post-v1 lanes are tracked and do not block closeout.

### Exit

- [ ] The exact workspace-first product journey succeeds and all reduced
      negative proofs pass.
- [ ] No T1/T2/full-P3/E1/generation/plugin-snapshot acceptance is claimed.

## Historical 2026-07-09 handoff — non-dispatchable for v1

Derived strictly from [TODO.md](./TODO.md) and [PLAN.md](./PLAN.md). Tick each before calling this package done. Invent nothing.

## Prerequisites (packages + gates)
P8 gates only the v1 set: P1, T1/T2, P2/P3, E1, P5a, P6-D/P6-R,
A1, and D1. Post-v1 lanes are tracked but not awaited.
- [ ] P1-headless-core merged — [../P1-headless-core/HANDOFF.md](../P1-headless-core/HANDOFF.md)
- [ ] T1-durable-events merged — [../T1-durable-events/HANDOFF.md](../T1-durable-events/HANDOFF.md)
- [ ] T2-transport merged — [../T2-transport/HANDOFF.md](../T2-transport/HANDOFF.md)
- [ ] P2-sandbox-providers merged — [../P2-sandbox-providers/HANDOFF.md](../P2-sandbox-providers/HANDOFF.md)
- [ ] P3-routes-tools merged — [../P3-routes-tools/HANDOFF.md](../P3-routes-tools/HANDOFF.md)
- [ ] E1-environment-attachments merged — [../E1-environment-attachments/HANDOFF.md](../E1-environment-attachments/HANDOFF.md)
- [ ] P5a v1 beads merged — [../P5-provisioning-secrets/P5A-HANDOFF.md](../P5-provisioning-secrets/P5A-HANDOFF.md) (do not wait for P5b)
- [ ] P6-D/P6-R v1 beads merged — [../P6-plugin-child-app/P6-V1-HANDOFF.md](../P6-plugin-child-app/P6-V1-HANDOFF.md) (do not wait for plugin/P6b expansion)
- [ ] A1-agent-authoring merged — [../A1-agent-authoring/HANDOFF.md](../A1-agent-authoring/HANDOFF.md)
- [ ] If the shipped D1 path consumes duplicated M1 behavior configuration,
      A1 BBA1-003 removed it; optional M1's mere existence does not create this
      gate.
- [ ] D1 dedicated delivery merged — [../D1-tenant-provisioning/HANDOFF.md](../D1-tenant-provisioning/HANDOFF.md)
- [ ] Do NOT land while any earlier phase's `TODO(remove:*)` marker is still live — a surviving marker reopens the phase of its named deletion-bead owner (do not absorb it here)
- [ ] P4/E2/X1/P5b/P6 expansion/P7/M2/D2/S3/S4 are explicitly post-v1.

## Owner questions / verdict
- OWNER-QUESTIONS: none.
- GO/NO-GO: GO only after every v1 prerequisite and the timed product proof; NO-GO if a v1 gate/marker/import boundary is unresolved.

## Beads
- [ ] BBP8-001 — Repo-wide `TODO(remove:*)` marker gate (zero-tolerance)
- [ ] BBP8-002 — Document the four-part surface contract as stable public API
- [ ] BBP8-003 — Old-moved-path import gates for delivered v1 relocations (P2/P3/T1/T2)
- [ ] BBP8-004 — Convert remaining plan prose into tracked beads/issues
- [ ] BBP8-006 — Execute and record the v1 agent-factory golden path
- [ ] BBP8-005 — Final invariant + build/test sweep

## Verification commands
- [ ] `pnpm lint:invariants`
- [ ] `pnpm audit:imports`
- [ ] `node scripts/check-no-remove-markers.mjs` (after BBP8-001 creates/wires it)
- [ ] `pnpm --filter @hachej/boring-ui-cli run smoke:agent-factory-v1 -- <preconfigured-host-profile>`
- [ ] `pnpm --filter @hachej/boring-bash run check:invariants`
- [ ] `pnpm --filter @hachej/boring-workspace run lint:plugin-invariants`
- [ ] `pnpm --filter @hachej/boring-agent run lint:invariants`
- [ ] `pnpm --filter @hachej/boring-agent run check:isolation`
- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `! rg -n -U "import\\s*\\{[^}]*\\b(resolveMode|autoDetectMode|hasBwrap|createDirectSandbox|createBwrapSandbox|createRemoteWorkerModeAdapter|createRemoteWorkerSandbox|createVercelSandboxWorkspace)\\b[^}]*\\}\\s*from\\s*['\"]@hachej/boring-agent/server['\"]" packages apps plugins -g '!**/*.md'`
- [ ] `! rg -n "ask-user\\.v1\\." packages apps plugins -g '!**/*.md'`
- [ ] `! rg -n "\\?cursor=|schedulePiChatReconnect|replay_gap|PiChatReplayBuffer" packages apps plugins -g '!**/*.md'`

## PR-PLAN reconciliation
- [ ] `pr1-marker-import-gates` completed BBP8-001 + BBP8-003
- [ ] `pr2-surface-contract-docs` completed BBP8-002
- [ ] `pr3-golden-path-and-followups` completed BBP8-006 + BBP8-004
- [ ] BBP8-005 completed as the final stack merge gate, not a separate PR; any red gate reopened its owning phase

## Review gates
- [ ] `pnpm lint:invariants` runs the `TODO(remove:*)` gate; the repo has **zero** markers; a planted marker fails the gate and names its owning bead.
- [ ] No surviving marker was "absorbed" into a P8 cleanup bead — any live marker reopened its owning phase instead.
- [ ] Four-part surface contract + `createAgent()` documented as stable public API; referenced symbols exist.
- [ ] Every delivered P2/P3/T1/T2 relocation import gate present and green; no old-path importer.
- [ ] P3 BBP3-019 proves pure mode registers no filesystem UI/providers/renderers
      and makes no related API calls; P4 relocation is not required.
- [ ] P3 BBP3-020 proves trusted v1 plugin tools/routes/Pi prompt+resources/front
      derive from one verified boot-time record; disabled/scan-only/pre-
      registration-failed plugins leave no server/prompt residue, while browser
      failure preserves previous-good UI with diagnostics. P6/D1 retain the
      immutable host-app/plugin snapshot and P8 proves restart/rollback
      reproduction. D1 rejects raw plugin routes and scoped-route fixtures reject
      explicit and indirect foreign ids. Per-agent refs/requirements remain post-v1.
- [ ] Every deferred/un-beaded plan task filed as a tracked issue/bead; `00` coverage posture reconciled (no overclaim).
- [ ] Golden-path evidence records <=900 seconds, zero source edits, remote
      materialization, definition/deployment/resolved digests, no-op reapply,
      desired-state and static-prompt input/resolved digests, append-only
      generation/current pointer behavior, complete new-generation rollback,
      and secret-canary absence.
- [ ] The real dedicated app is restarted with an unchanged pointer and the
      completed session continues on the exact pinned host/plugin/prompt
      identity. A changed apply and rollback each bounded-drain and durably
      retire the replaced generation's sessions; only one process admits and a
      fresh session uses the new active identity. Same-desired no-op first
      reproduces the current resolved digest; changed authenticated facts cannot
      false-no-op. Old-origin boot-digest mismatch rejects before old routes and
      the replacement reopens only after the old listener is stopped/unbound.
- [ ] Golden-path evidence opens the exact HTTPS host, verifies bounded landing
      content, signs in an existing member, enters only the D1-managed
      workspace, and records the deployed `default` agent identity.
- [ ] Fixed-workspace evidence covers list/create/switch/delete plus foreign
      selectors/claims through core workspace/runtime/agent/session/file/UI,
      full-app MCP, runtime-plugin/plugin-front, scoped plugin routes, pane-
      status, and WorkspaceBridge. Raw plugin routes fail D1 readiness; indirect
      foreign session/project ids reject; non-invite dedicated signup creates no
      workspace or membership.
- [ ] Bound creator/last-owner account deletion and owner demotion/removal fail
      before mutation; non-owner account deletion and generic mode cannot remove
      the D1-managed workspace.
- [ ] Missing/stale `DedicatedSiteCapability` causes zero DNS/TLS publication
      and no complete-pointer advance; the intermediate D1 stack cannot expose
      the generic multi-workspace app at the dedicated hostname. Cross-target
      and prior-generation/fence replay plus caller fabrication are rejected
      with the same zero-effect result. First-apply publication follows pointer
      CAS; reserved-host/no-pointer direct-origin requests fail inactive across
      all route families, and a dedicated process rejects missing/non-bound hosts
      without generic fallback.
- [ ] The golden path used the real EU runsc/systrap target through pinned-HTTPS
      worker authentication and proved stale-generation provider fencing; fake
      provider evidence is supplemental only.
- [ ] Full `pnpm typecheck` + `pnpm test` + `pnpm audit:imports` green; all `00` invariants hold; #416 contracts + JSONL session compat untouched.

## Exit criteria
- [ ] Zero `TODO(remove:*)` markers repo-wide, asserted by a check wired into `pnpm lint:invariants` (fails CI if any marker survives).
- [ ] `@hachej/boring-agent` package docs document the four-part surface contract (08) + the `createAgent()` public runtime API as the stable public surface.
- [ ] Post-v1 P4/E2/X1/P5b/P6 expansion/P7/M2/D2/S3/S4 remain explicitly tracked.
- [ ] No code imports old moved paths for delivered v1 relocations.
- [ ] Existing workspace filesystem UI is capability-gated with zero pure-mode
      residue; ownership relocation remains post-v1 P4.
- [ ] Executable v1 product proof is recorded; component/invariant results alone
      do not close P8.
- [ ] Product proof includes exact host -> landing -> existing-member sign-in ->
      one managed workspace -> deployed agent as `default`, with selector escape
      and ordinary workspace lifecycle denied.
- [ ] D1 uses durable local/provider volume storage; X1 FUSE/S3 remains tracked
      post-v1 and is not silently required by the proof.
- [ ] All `00` invariants + package invariant scripts + `audit:imports` green; full build+test green.

## Closeout
- [ ] Zero unowned `TODO(remove:*)` markers for this phase (and zero markers repo-wide)
- [ ] `@hachej/boring-agent` README documents the four-part surface contract
- [ ] PRs merged per [PR-PLAN.md](../../PR-PLAN.md) (this package's section)
