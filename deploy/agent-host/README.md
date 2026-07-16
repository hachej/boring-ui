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

## Database namespace decision

Migrations `0018`–`0021` retain their D1 filenames and SQL as immutable
migration history. Forward migration `0022_agent_host_namespace` renames the
admission and destructive-publication tables, constraints, indexes, sequences,
function, and triggers to `agent_host_*`. There are no compatibility aliases:
this is the owner-approved pre-v1 clean rename, and rollback is the normal
migration rollback/restore path before any live agent-host proof.
