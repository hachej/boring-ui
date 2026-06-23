# Self-host secrets inventory template

Do not put secret values in this file. Use secret-store references only.

Recommended columns:

| Name | Purpose | Source of truth | Consumed by | Rotation notes | Recovery notes |
| --- | --- | --- | --- | --- | --- |
| `DATABASE_URL` | App runtime DB access, non-superuser |  | web container |  |  |
| `DATABASE_MIGRATION_URL` | One-shot migrations |  | deployd migration container/process |  |  |
| `DATABASE_ADMIN_URL` | Bootstrap/break-glass only if required |  | operator/deployd only if approved |  |  |
| DB admin/break-glass credential | Emergency DB access |  | operator only |  |  |
| `BETTER_AUTH_SECRET` | Auth signing/encryption |  | web container |  |  |
| `BETTER_AUTH_URL` | Public auth base URL |  | web container |  |  |
| `CORS_ORIGINS` | Allowed browser origins |  | web container |  |  |
| `WORKSPACE_SETTINGS_ENCRYPTION_KEY` | Encrypt workspace settings |  | web container |  | Losing blocks decrypt |
| `MAIL_FROM` | Email sender |  | web container |  |  |
| `MAIL_TRANSPORT_URL` / `RESEND_API_KEY` | Email transport |  | web container |  |  |
| `BORING_AGENT_DEFAULT_MODEL_PROVIDER` | Default model provider |  | web container |  |  |
| `BORING_AGENT_DEFAULT_MODEL_ID` | Default model id |  | web container |  |  |
| `INFOMANIAK_API_TOKEN` / model token | Model provider auth |  | web container |  |  |
| `BORING_AGENT_INFOMANIAK_PRODUCT_ID` | Infomaniak product config if used |  | web container |  |  |
| `BORING_AGENT_INFOMANIAK_MODEL` | Infomaniak model config if used |  | web container |  |  |
| `BORING_AGENT_MODE` | Must be `vercel-sandbox` for v1 |  | web container |  |  |
| `BORING_AGENT_WORKSPACE_ROOT` | Host workspace anchors |  | web container |  | `/data/workspaces` |
| `BORING_AGENT_SESSION_ROOT` | Durable Pi transcripts |  | web container |  | `/data/pi-sessions` |
| `VERCEL_TEAM_ID` | Vercel Sandbox |  | web container |  |  |
| `VERCEL_PROJECT_ID` | Vercel Sandbox |  | web container |  |  |
| `VERCEL_TOKEN` | Vercel auth where OIDC unavailable |  | web container |  | Avoid if possible |
| `BORING_AGENT_VERCEL_SANDBOX_TIMEOUT_MS` | Sandbox lifetime/cost |  | web container |  |  |
| `BORING_AGENT_SNAPSHOT_KEEP` | Snapshot retention |  | web container |  | Default 2 |
| Deployd GitHub App private key / read token | Verify actor/CI/provenance/GHCR |  | deployd only |  | Fail closed if invalid |
| GitHub webhook secret / GitHub App webhook secret | Verify deploy webhook |  | deployd only |  | Rotate on leak |
| OVH API credentials | VM provisioning/operator API access | `secret/shared/ovh` fields: `application_key`, `application_secret`, `consumer_key` | operator/local provisioning only | Rotate after bootstrap or on operator change | Never expose to GitHub Actions |
| Cloudflare tunnel token/credentials | App/deploy webhook ingress | Vault | App VM cloudflared | Rotate after bootstrap or on operator change | Never expose to GitHub Actions |
| pgbackrest object storage key | Cloudflare R2 EU jurisdiction bucket if available | R2/vault | DB VM pgbackrest | Rotate after restore drill confirms new key | Required for restore |
| pgbackrest object storage secret | Cloudflare R2 EU jurisdiction bucket if available | R2/vault | DB VM pgbackrest | Rotate after restore drill confirms new key | Required for restore |
| pgbackrest cipher passphrase | Backup encryption, Healio-style defense in depth | Vault + offline copy | DB VM pgbackrest/operator | Rotate only with planned re-encryption | Offline copy required; if lost, backups are unrecoverable |
| Backup healthcheck URL(s) | Backup alert pings | Vault | DB VM/App VM backup jobs | Rotate on leak | Alerts route to Slack |
| Slack alert webhook | Ops alerts | Vault | unattended-upgrades/backup/deployd | Rotate on leak/channel change | Primary alert recipient is Slack |
| Tailscale operator/admin credential location | Human/App VM bootstrap | Current owner tailnet/admin console | operator only | Use current tailnet access controls | No GitHub Actions Tailscale OAuth in v1 |

## Rules

- GitHub Actions must not receive production runtime, DB, backup, Vercel, Tailscale, or Kamal secrets.
- Deployd credentials stay on App VM / chosen secret store and are not exposed to the web container.
- Backup cipher passphrase must have an offline recovery copy.
- Rotate any secret pasted through a terminal during bootstrap.
