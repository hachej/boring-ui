# Governance architecture cleanup

## Goal

Make `@hachej/boring-governance` the sole owner of company-context policy and storage capabilities, keep `@hachej/boring-agent` as the sole filesystem HTTP implementation, and reduce Constellation to composition and deployment configuration.

## Phase 1 — canonical mutable binding

- [x] Add a typed `companyContextAccessForUser()` decision to `GovernanceService`.
- [x] Add a canonical `CompanyContextStore` with contained, symlink-safe, atomic writes.
- [x] Return `readwrite` company-context bindings for verified tenant admins.
- [x] Keep ordinary policy users on filtered readonly projections.
- [x] Add bound-read `mtimeMs` to the generic agent filesystem contract and HTTP response.
- [x] Add governance store/binding tests for admin, readonly, unknown, traversal, symlink, conflict, write, delete, move, and mkdir.
- [x] Add canonical agent route and tool tests for mutable binding reads, writes, edits, and conflicts.

## Phase 2 — remove Constellation fork

- [ ] Publish the fixed governance/agent/core packages.
- [ ] Replace Constellation adapters with `governance.getFilesystemBindings()`.
- [ ] Delete `src/server/governance/httpFiles.ts`.
- [ ] Delete `src/server/governance/filesystemBindings.ts`.
- [ ] Remove `beforeAgentRoutes` and `patches/@hachej__boring-core@0.1.71.patch`.
- [ ] Remove patch-only `pnpm-workspace.yaml` and Docker patch copying.
- [ ] Run the full deployed access matrix through generic agent routes.

## Phase 3 — matrix maintainability

- [ ] Split the matrix into config, scenarios, transport, runner, and reporter modules.
- [ ] Keep the executable wrapper below roughly 30 lines.
- [ ] Resolve actor, target workspace, observer, and cleanup identity once per case.
- [ ] Use an idempotent cleanup registry.
- [ ] Add deterministic unit tests for configuration, timeouts, side-effect checks, cleanup, partial sign-in, and sign-out.

## Phase 4 — runtime isolation

- [ ] Run Bubblewrap only in the secret-minimized worker container.
- [ ] Keep the credential-bearing web process unprivileged.
- [ ] Commit the exact seccomp, namespace, PID, CPU, memory, network, and concurrency limits used in production.
- [ ] Add a built-container remote-worker write/read smoke.

## Release gate

- [ ] Clean registry install with no local tarballs or patched dependencies.
- [ ] Governance, agent, core, and Constellation tests green.
- [ ] Full access matrix green.
- [ ] Admin stale-write conflict verified.
- [ ] Admin delete/move/mkdir verified.
- [ ] Web and worker image digests match the deployment manifest.
- [ ] Rollback image retained until the compatibility bridge is removed successfully.
