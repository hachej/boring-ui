# Historical Decision 25 owner review card

> **Status: historical / non-dispatchable.** This card reviews the superseded
> same-workspace-first S1–N1 plan. Current review gates live in
> [`../plan.md`](../plan.md), Decision 28, and the active F-series Beads. Nothing below
> authorizes implementation.

## P0 approval

Approve the planning reset only if:

- Decision 25 and the canonical plan agree;
- every former ordering document points to the canonical plan;
- AgentHost/D1/CAS/controller continuation is explicitly non-dispatchable;
- tracker status matches PR #794 as merged;
- only S1 becomes ready after P0 merge;
- graph checks have no cycles;
- issue #391 no longer advertises the retired product exit.

## Every implementation slice

1. Authenticate and verify workspace membership before exact agent selection.
2. Keep one Workspace + Sandbox lifecycle per workspace.
3. Treat same-workspace agents as one runtime trust domain.
4. Keep route, session, prompt, tool, readiness, receipt, log, and provenance
   identity agent-scoped.
5. Preserve unscoped primary routes and historical full-app sessions.
6. Reject browser/body/header attempts to select authority outside the trusted
   route/host composition.
7. Keep Workspace front/shared free of Agent value imports.
8. Keep `UiBridge.postCommand` as the only UI dispatch source.
9. Use stable canonical errors.
10. Do not restore controller, revision, publication, CAS, dynamic registry, or
    a second runtime composer.

## Slice-specific gates

### S1

- Reuse existing definition/deployment identities only as validated provenance; static selection invokes no deployment resolver.
- Freeze a complete route-ownership table before route work.
- Catalog exposure defaults off; no function-valued behavior enters browser DTOs.
- No mutation/persistence surface.

### S2

- Primary preserves exact `fullAppAgentSessionNamespace` output and sees legacy sessions.
- Non-primary namespaces are collision-safe; optional new context carries agent identity.
- Bounded configured-namespace lookup distinguishes confirmed mismatch from not-found without an index.
- Cross-agent session load fails before effects.
- Historical provenance is not inferred from current prompt/config.

### S3

- The existing physical workspace-keyed runtime remains the sole owner; no package move is implied.
- Same Workspace and Sandbox object identities are proven.
- Agent-owned registrar extraction leaves shared routes mounted once.
- Agent-local teardown does not kill shared runtime; final workspace teardown disposes once.

### S4

- Only routes classified Agent-owned in S1 are prefixed.
- Unknown IDs do not leak before authorization and do not fall back.
- Catalog route is absent when disabled and safe when enabled.
- Existing primary behavior remains available through legacy aggregate routes.

### S5

- Full-app has one hidden primary and no selector.
- Two-agent package proof covers shared W and isolated W2.
- Production output contains no deleted AgentHost subtree.

### R1/N1

- Exact package cohort is derived, not guessed.
- S5 tarballs pass a clean Seneca consumer qualification before publish.
- Registry artifacts repeat the same clean consumer proof after publish.
- Seneca pins registry versions and records rollback.
- Product proof shows shared runtime and distinct agent identity without
  claiming same-workspace isolation.

## Stop signs

Stop and return to plan review if a slice appears to require:

- runtime mutation or persistent registry;
- per-agent sandbox lifecycle;
- duplicate Workspace/Core/plugin routes;
- a session-format rewrite;
- breaking a published API without consumer/semver evidence;
- client-controlled roots, handles, behavior bindings, or workspace authority;
- restoration of any removed AgentHost asset.
