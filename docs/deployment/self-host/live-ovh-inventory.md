# Live OVH self-host inventory

Do not put secret values in this file.

Status: live test environment for `full-app` self-hosting. Cloudflare public hostname is deferred.

## Environment

| Field | Value |
| --- | --- |
| Environment name | ovh-vps-live-test |
| Purpose | public `full-app` self-host live test without Cloudflare hostname |
| Deploy source | GitHub branch `plan/self-host-vm-boring` |
| Auto deploy | App VM systemd timer `boring-auto-deploy.timer` polling every 2 minutes |
| Current public URL | `http://51.91.54.122:3000` |
| Production domain | deferred |
| Backup bucket | Cloudflare R2 EU jurisdiction bucket `boring-ui-full-app-pgbackrest-eu` |
| Backup status | pgBackRest enabled; initial full backup and isolated restore materialization drill passed on 2026-06-24 |

## App VM

| Field | Value |
| --- | --- |
| Provider | OVH VPS |
| Hostname | `vps-05c8f985.vps.ovh.net` |
| Public IP | `51.91.54.122` |
| Tailscale hostname | `boring-vps.tail6ddfe5.ts.net` |
| Tailscale IP | `100.127.254.28` |
| OS/version | Debian GNU/Linux 13 (trixie) |
| Docker image | `boring-full-app:self-host-test` |
| Container | `full-app-web-1` |
| Health endpoint | `http://51.91.54.122:3000/health` |
| Workspace path | `/data/workspaces` |
| Pi session path | `/data/pi-sessions` |

## DB VM

| Field | Value |
| --- | --- |
| Provider | OVH VPS |
| Hostname | `vps-58d20042.vps.ovh.net` |
| Public IP | `51.91.54.123` |
| Tailscale hostname | `boring-vps2.tail6ddfe5.ts.net` |
| Tailscale IP | `100.115.45.64` |
| OS/version | Debian GNU/Linux 13 (trixie) |
| PostgreSQL major version | 17 |
| Database | `boring_full_app` |
| Runtime role | `boring_full_app_runtime` |
| Migration role | `boring_full_app_migrator` |
| Checksums | on |
| Network | PostgreSQL allowed from App VM Tailscale `/32`; public PostgreSQL ingress closed |
| pgbackrest stanza | `boring_full_app` |
| pgbackrest status | enabled; `pgbackrest check` passes; WAL archiving active; initial full backup label `20260624-084334F` |
| pgbackrest schedule | weekly full backup Sunday 02:00 UTC; daily differential Monday-Saturday 02:00 UTC via postgres crontab |

## GitHub

| Field | Value |
| --- | --- |
| PR | https://github.com/hachej/boring-ui/pull/370 |
| Branch | `plan/self-host-vm-boring` |
| Current deployed revision | tracked on VM at `/opt/boring/full-app/last-deployed-revision`; last verified E2E revision `6861c3f0545d4cf6723f0101d3af29add9f99b2e` |
| Required checks | passing at time of inventory update |
| Self-host image workflow | passing at time of inventory update |

## Remaining before final production

- Replace branch-tip poller with protected `prod-*` tag + GHCR digest + deployd/Kamal verification.
- Confirm `PGBACKREST_CIPHER_PASS` has an offline recovery copy outside vault.
- Run a fuller restore drill that starts PostgreSQL from the restored data directory on an isolated host/alternate port.
- Add Cloudflare hostname/TLS later when chosen.
