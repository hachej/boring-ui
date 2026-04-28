# @boring/core changelog

## v7 - 2026-04-28

Reference: [`docs/plans/core-gap-closure-spec.md`](docs/plans/core-gap-closure-spec.md)

### Shipped

- Managed workspace runtime seam: `WorkspaceProvisioner`, `createFsProvisioner({ rootDir })`, runtime retry semantics, and `volumePath` / `lastErrorOp` persistence.
- Multi-user workspace UI inside `<BoringApp>`: `/w/:id/settings`, `/w/:id/members`, `/w/:id/invites`, and `/invites/:token`.
- Invite flow completion: resolve and accept token endpoints, invite breaker columns, `features.inviteTtlDays`, and idempotent invite creation.
- Last-owner protection on member role changes and removals.
- Workspace command-palette builder: `getWorkspaceCommands(workspaceId, navigate)`.
- Workspace settings crypto audit coverage and documented rotation procedure.
- The v7 substrate migration: `idempotency_keys`, invite lock columns, runtime state narrowing, and removal of deferred Fly columns from `workspaces`.

### Deferred

- Async/cloud provisioner drivers still need a richer state machine, worker orchestration, and fencing before they should be shipped.
- Fly-specific runtime orchestration remains deferred; `machine_id`, `volume_id`, and `fly_region` were intentionally removed by the v7 substrate migration.
- No dedicated v0/v1 user migration guide exists because there are no in-flight production users to migrate.
