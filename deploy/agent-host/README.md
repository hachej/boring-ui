# Agent-host deployment

`agent-host` is the canonical pre-v1 EU deployment namespace. Start the
revision command with `pnpm --filter full-app agent-host:revision`; use the
`proof:agent-host-*` scripts for the local proof harnesses.

The Compose project is `boring-agent-host`. Its required operator inputs are
`AGENT_HOST_INGRESS_IMAGE`, `AGENT_HOST_CORE_APP_IMAGE`, `AGENT_HOST_ID`,
`AGENT_HOST_STATE_ROOT`, `AGENT_HOST_MATERIALIZED_HOST_ROOT`, and
`AGENT_HOST_CONTROL_ROOT`. The core process receives only
`BORING_AGENT_HOST_*` settings.

Runtime roots are `/opt/boring/agent-host`, `/var/lib/boring/agent-host`, and
`/run/boring/agent-host`; the publication control socket root is
`/run/boring/agent-host/control`.

## Operator-only isolated proof authority

Set `BORING_AGENT_HOST_AUTHORITY_FILE` only for an isolated proof. The file is
a canonical one-line JSON object (newline terminated) with exact keys in this
order:

`schemaVersion`, `domain`, `mode`, `authorityRoot`, `hostId`, `operatorUid`,
`composeProject`, `configRoot`, `stateRoot`, `materializedRoot`, `controlRoot`,
`lockRoot`, `secretRoot`, `workspaceRoot`, `sessionRoot`, `databaseUrlFile`,
`databaseRef`, `runtimeProfile`.

The fixed values are schema `1`, domain `boring-agent-host-authority:v1`, mode
`isolated-proof`, and runtime profile
`{ref:<plan-ref>,id:"runsc",launcher:"docker-runsc",privilegeModel:"docker-runsc-nonroot",composeRuntime:"runsc"}`.
The host ID and Compose project start with `agent-host-proof-`; the database
reference, database name, and database user start with `agent_host_proof_`.
All selected roots are distinct canonical descendants of the owner-only
`authorityRoot` and may not overlap normal production roots. `databaseUrlFile`
is exactly `<secretRoot>/database-url` and is the only CLI database URL source.
The descriptor and protected files are bounded, no-follow, single-link files.

`configRoot` contains protected `compose.yml`, `compose.isolated.yml`,
`Caddyfile`, and `core.env`. The isolated overlay binds the selected workspace,
session, state, materialized, control, and secret roots, publishes ingress only
on `127.0.0.1:18080`, and assigns `runtime: runsc` to both services. After each
start the authoritative adapter inspects the effective service container and
rejects runtime/project/service drift. Cleanup is enabled only for an isolated
proof descriptor and addresses that descriptor's project.

Workspace and session directories have an explicit two-state lifecycle: before
first start they are operator-owned mode `0700`; the unchanged root entrypoint
recursively transfers them to UID/GID `10001:10001` before dropping privileges.
Repeated preflight accepts only operator UID or app UID `10001` at mode `0700`.
Normal named-volume ownership and runtime defaults are unchanged when no
isolated descriptor is supplied.

Rollback is the revision command, not Compose cleanup. Retain proof evidence
and database backups before invoking isolated cleanup. This seam does not attest
operator-supplied host artifacts and does not itself constitute live EU or DR
evidence.

## Database namespace decision

Migrations `0018`–`0021` retain their D1 filenames and SQL as immutable
migration history. Forward migration `0022_agent_host_namespace` renames the
admission and destructive-publication tables, constraints, indexes, sequences,
function, triggers, and PostgreSQL 18 named NOT NULL constraints to
`agent_host_*`. There are no compatibility aliases: this is the owner-approved
pre-v1 clean rename. Migration 0022 is not rollback-compatible with old
binaries; rollback requires restoring the pre-migration image and database
snapshot before any live agent-host proof.
