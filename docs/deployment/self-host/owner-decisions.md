# Self-host owner decisions

Status: living decision record for the first public `full-app` self-host deployment. Do not put secret values in this file.

## Confirmed by owner

| Topic | Decision | Notes / next action |
| --- | --- | --- |
| Alert recipient | Slack | Store the webhook URL in the secret store; docs/scripts should refer to it as a secret-store reference only. |
| Cloudflare credential location | Vault | The Cloudflare API key/token exists in the vault. Do not copy it into GitHub Actions or repo files. |
| Tailscale network | Current owner tailnet | VM bootstrap joins the existing Tailscale network. No Tailscale OAuth secret in GitHub Actions for v1. |
| VM provider | OVH France / Gravelines | Use OVH for App VM and DB VM. OVH API credentials are stored in vault at `secret/shared/ovh` with `application_key`, `application_secret`, and `consumer_key`. Keep the first deployment small; exact OVH flavor can be adjusted during provisioning. |
| Domain | No public domain for now | Domain exists in Cloudflare, but v0 should not depend on a public hostname. Pick app/deploy hostnames later before public cutover. |
| Backup object store | Cloudflare R2 EU jurisdiction bucket | Created bucket `boring-ui-full-app-pgbackrest-eu` in the Cloudflare R2 EU jurisdiction. Use pgbackrest encryption like Healio: repo encryption via `repo1-cipher-type=aes-256-cbc` plus a vault/offline `PGBACKREST_CIPHER_PASS`. R2 also encrypts at rest, but pgbackrest encryption is still required. |

## Still needed before real provisioning

| Topic | Needed decision |
| --- | --- |
| OVH region/datacenter | France / Gravelines for both App VM and DB VM. Confirm exact OVH region code during provisioning. |
| App VM size | Small baseline: about 2 vCPU, 4 GB RAM, 40 GB disk. Confirm exact OVH flavor. |
| DB VM size | Small baseline: about 2 vCPU, 4-8 GB RAM, 80 GB disk. Confirm exact OVH flavor and upgrade path. |
| DB disk | Confirm disk size/type, separate data disk, and LUKS yes/no. |
| R2 bucket details | Bucket exists: `boring-ui-full-app-pgbackrest-eu` in EU jurisdiction. Still need scoped S3 Access Key ID / Secret Access Key from Cloudflare R2 token UI/API-token flow, object-lock/immutability/replica story, and lifecycle policy. |
| Production hostnames | Deferred: no domain for now. Pick app hostname and deploy webhook hostname later from the Cloudflare zone. |
| GitHub tag protection | Configure ruleset for `prod-*` so only trusted maintainers can create production tags. |
| RPO/RTO | Confirm DB RPO/RTO targets after backup target is chosen. |
| Restore owner | Name the person responsible for restore drills. |

## Guardrails

- GitHub Actions builds and attests images only; it must not receive production runtime, DB, backup, Tailscale, Cloudflare, Vercel, Kamal, or deployd secrets.
- App VM-owned deployd is the only production deploy executor.
- `BORING_AGENT_MODE=vercel-sandbox` remains mandatory for v1 public production.
- DB VM is private/Tailscale-shaped; no public PostgreSQL ingress.
