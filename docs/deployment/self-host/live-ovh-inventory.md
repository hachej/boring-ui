# Live OVH self-host inventory

Do not put secret values in this file.

Status: live test environment for `full-app` self-hosting. Dev Cloudflare hostname is active; final `app.senecaapp.ai` cutover is deferred.

## Environment

| Field | Value |
| --- | --- |
| Environment name | ovh-vps-live-test |
| Purpose | public `full-app` self-host live test behind Cloudflare dev hostname |
| Deploy source | GitHub `prod-*` tag built by `Self-host full-app image` workflow into GHCR |
| Deploy executor | Manual Kamal deploy from verified deploy manifest; legacy branch poller disabled |
| Current public URL | `https://dev.senecaapp.ai` |
| Direct origin health | `http://51.91.54.122/health` |
| Future production domain | `app.senecaapp.ai` deferred |
| Backup bucket | Cloudflare R2 EU jurisdiction bucket `boring-ui-full-app-pgbackrest-eu` |
| Backup status | pgBackRest enabled; initial full backup and isolated restore materialization drill passed on 2026-06-24; post-Neon-cutover full backup `20260626-090739F` passed |

## App VM

| Field | Value |
| --- | --- |
| Provider | OVH VPS |
| Hostname | `vps-05c8f985.vps.ovh.net` |
| Public IP | `51.91.54.122` |
| Tailscale hostname | `boring-vps.tail6ddfe5.ts.net` |
| Tailscale IP | `100.127.254.28` |
| OS/version | Debian GNU/Linux 13 (trixie) |
| Docker image | `ghcr.io/hachej/boring-ui-full-app:prod-ovh-test-20260624193633` |
| Image digest | `sha256:4397044ca0b121e7b41964e69ed34bf0068f0b76930db61b25108d9d4928505c` |
| Container | `boring-full-app-web-prod-ovh-test-20260624193633` |
| Deploy tool | Kamal 2.11.0 (`proxy: false`, host publish `80:3000`) |
| Origin TLS | nginx terminates 443 with local/self-signed certificate for Cloudflare Full mode, proxies to app on port 80 |
| Health endpoint | `https://dev.senecaapp.ai/health` |
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
| Database | `boring_full_app` migrated from Neon production on 2026-06-26 |
| Runtime role | `boring_full_app_runtime` |
| Migration role | `boring_full_app_migrator` |
| Checksums | on |
| Network | PostgreSQL allowed from App VM Tailscale `/32`; public PostgreSQL ingress closed |
| pgbackrest stanza | `boring_full_app` |
| pgbackrest status | enabled; `pgbackrest check` passes; WAL archiving active; latest verified full backup label `20260626-090739F` after Neon cutover |
| pgbackrest schedule | weekly full backup Sunday 02:00 UTC; daily differential Monday-Saturday 02:00 UTC via postgres crontab |

## GitHub

| Field | Value |
| --- | --- |
| PR | https://github.com/hachej/boring-ui/pull/370 |
| Branch | `plan/self-host-vm-boring` |
| Current deployed revision | `0b7c2e202fc0d3f7fff6e220537add0a3f3fa808` via tag `prod-ovh-test-20260624193633` |
| Required checks | passing at time of inventory update |
| Self-host image workflow | passing at time of inventory update |

## Remaining before final production

- Add deployd/webhook automation so verified `prod-*` tag manifests trigger Kamal without manual operator steps.
- Confirm `PGBACKREST_CIPHER_PASS` has an offline recovery copy outside vault.
- Run a fuller restore drill that starts PostgreSQL from the restored data directory on an isolated host/alternate port.
- Replace dev hostname with final `app.senecaapp.ai` when ready.
