# Self-host environment inventory template

Do not put secret values in this file.

## Environment

| Field | Value |
| --- | --- |
| Environment name |  |
| Purpose | public full-app / internal / rehearsal |
| Owner |  |
| Cutover approver |  |
| Restore owner |  |
| Alert recipient(s) | Slack webhook (vault reference only) |
| Deploy branch/source | protected main + protected prod-* tags |
| Production domain | none for v0; Cloudflare hostname deferred until public cutover |
| Deploy webhook hostname/path | none for v0; local/Tailscale-only deploy control until hostname is chosen |

## App VM

| Field | Value |
| --- | --- |
| Provider | OVH |
| Region/datacenter | France / Gravelines, confirm exact OVH region code |
| VM size | small baseline: about 2 vCPU, 4 GB RAM, 40 GB disk |
| Public IP |  |
| Tailscale hostname |  |
| Tailscale IP |  |
| Tailscale tag |  |
| OS/version |  |
| Docker version |  |
| cloudflared tunnel name |  |
| cloudflared tunnel id |  |
| Kamal destination |  |
| `/data/pi-sessions` path | `/data/pi-sessions` |
| `/data/workspaces` path | `/data/workspaces` |
| File-state backup target |  |

## DB VM

| Field | Value |
| --- | --- |
| Provider | OVH |
| Region/datacenter | France / Gravelines, confirm exact OVH region code |
| VM size | small baseline: about 2 vCPU, 4-8 GB RAM, 80 GB disk |
| Public IP |  |
| Tailscale hostname |  |
| Tailscale IP |  |
| Tailscale tag |  |
| OS/version |  |
| PostgreSQL major version |  |
| DB disk size/type |  |
| Separate data disk? | yes/no |
| LUKS enabled? | yes/no |
| pgbackrest stanza |  |
| pgbackrest repo/bucket | Cloudflare R2 EU jurisdiction if available; otherwise choose EU-compatible S3 target |
| Backup retention | 4 weekly full + 14 daily differential initially |
| WAL archive timeout |  |
| max_connections |  |
| PgBouncer? | yes/no |

## Cloudflare

| Field | Value |
| --- | --- |
| Zone | deferred; domain exists in Cloudflare but unused for v0 |
| App hostname(s) | none for v0 |
| Deploy webhook hostname/path | none for v0 |
| Tunnel name |  |
| TLS/proxy mode |  |
| WAF baseline |  |
| Rate-limit baseline |  |

## GitHub/GHCR

| Field | Value |
| --- | --- |
| Repository |  |
| Protected production tag pattern | `prod-*` |
| Allowed tag creators |  |
| Trusted production workflow name/id |  |
| GHCR package |  |
| Provenance mechanism | artifact attestation / signed manifest |

## Vercel Sandbox

| Field | Value |
| --- | --- |
| Vercel team id ref |  |
| Vercel project id ref |  |
| Auth method | OIDC / token |
| Sandbox timeout |  |
| Snapshot keep | 2 |
| Workspace durability promise | best-effort provider persistence; not VM-backed |

## Recovery

| Field | Value |
| --- | --- |
| RPO |  |
| RTO |  |
| Last DB restore drill |  |
| Last file restore drill |  |
| Old provider decommission date |  |
| Break-glass provider console path |  |
| Tailscale loss procedure path |  |
