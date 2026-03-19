# Deploy To Hetzner

This runbook covers the boring-ui production path on a Hetzner VPS using Docker Compose, Caddy, GHCR, and `bui deploy`.

## Current Target

- Server: `boring-ui`
- IPv4: `46.225.19.111`
- Public hostname for certificate bootstrap: `46.225.19.111.sslip.io`
- Remote deploy directory: `/opt/boring-ui`
- Persistent workspace mount: `/data/workspaces`

Replace the `sslip.io` hostname with a real domain once DNS is ready. The compose stack and `boring.app.toml` use the hostname from `[deploy.docker].host`.

## Prerequisites

- Hetzner server exists and is reachable over SSH.
- Hetzner block volume is formatted, mounted at `/data/workspaces`, and present in `/etc/fstab`.
- Docker Engine and Docker Compose plugin are installed on the host.
- Ports `80` and `443` are open.
- Vault contains:
  - `secret/agent/app/boring-ui/prod`
- GitHub Actions secrets contain:
  - `VAULT_ADDR`
  - `VAULT_TOKEN`
  - `HETZNER_SSH_KEY`

Optional:
- `secret/agent/hetzner-ssh` if you want `bui deploy` to fetch the SSH key from Vault instead of using `BUI_DEPLOY_SSH_KEY` or a local `~/.ssh/id_ed25519`

Optional for private GHCR pulls on the server:
- use `GHCR_USERNAME` and `GHCR_TOKEN` in the deploy environment. The workflow already forwards `${{ github.actor }}` and `${{ secrets.GITHUB_TOKEN }}`.
- local GHCR publish token is stored in Vault at `secret/agent/github-registry-hachej` (KV API path `secret/data/agent/github-registry-hachej`), field `pat`

## boring.app.toml Contract

`bui deploy` reads:

```toml
[deploy]
platform = "docker"

[deploy.docker]
registry = "ghcr.io/hachej"
compose_file = "deploy/docker-compose.prod.yml"
dockerfile = "deploy/python/Dockerfile"
caddy_file = "deploy/python/Caddyfile.prod"
host = "46.225.19.111.sslip.io"
ssh_key_vault = "secret/agent/hetzner-ssh"
remote_dir = "/opt/boring-ui"
```

The CLI falls back to `deploy_host` and `deploy_user` from the app Vault record for the SSH target.
SSH key resolution order is:
- `BUI_DEPLOY_SSH_KEY_PATH`
- `BUI_DEPLOY_SSH_KEY`
- `deploy.docker.ssh_key_vault`
- `~/.ssh/id_ed25519`

## One-Time Host Bootstrap

```bash
HCLOUD_TOKEN=$(vault kv get -field=hcloud_token secret/agent/services/hetzner)
export HCLOUD_TOKEN

hcloud server list
hcloud volume list

ssh root@46.225.19.111
lsblk
findmnt /data/workspaces
docker --version
docker compose version
ufw status
```

Expected state:
- `/data/workspaces` is mounted from the Hetzner block volume
- `/data/workspaces` is writable by UID `10001` inside the app container
- `/opt/boring-ui` exists
- Docker is active

## Local Deploy

Use this for manual deployments from a trusted operator machine:

```bash
export VAULT_ADDR=...
export VAULT_TOKEN=...
export GHCR_USERNAME="$(gh api user --jq .login)"
export GHCR_TOKEN="$(vault kv get -field=pat secret/agent/github-registry-hachej)"
export BUI_DEPLOY_SSH_KEY="$(cat ~/.ssh/id_ed25519)"

go run ./bui deploy --env prod
curl --fail https://46.225.19.111.sslip.io/healthz
curl --fail https://46.225.19.111.sslip.io/api/capabilities
```

What `bui deploy` does in Docker mode:
- builds the frontend
- resolves app secrets from Vault
- builds and pushes `ghcr.io/hachej/boring-ui:latest`
- fetches the SSH key from Vault
- copies the prod compose file, prod Caddyfile, and backend env file to `/opt/boring-ui`
- ensures `/data/workspaces` exists and is owned by UID `10001`
- runs `docker compose pull` and `docker compose up -d --remove-orphans` remotely

## GitHub Actions Deploy

Workflow: [.github/workflows/deploy.yml](/home/ubuntu/projects/boring-ui/.github/workflows/deploy.yml)

Trigger:
- push to `main`
- manual `workflow_dispatch`

The workflow:
- logs into GHCR
- installs Vault CLI
- runs `go run ./bui deploy --env prod`
- checks `https://<host>/healthz`

## BoxLite Production Mode

When deploying with BoxLite instead of nsjail:

1. Build and publish the guest image from [deploy/python/Dockerfile.boxlite-guest](/home/ubuntu/projects/boring-ui/deploy/python/Dockerfile.boxlite-guest)
2. Publish it to GHCR, for example:

```bash
docker build -f deploy/python/Dockerfile.boxlite-guest \
  -t ghcr.io/hachej/boring-ui-boxlite-guest:latest .
docker push ghcr.io/hachej/boring-ui-boxlite-guest:latest
```

3. Set `BORING_UI_BOXLITE_IMAGE` in the backend env file to that published tag
4. Start the stack with the KVM override:

```bash
docker compose \
  -f deploy/docker-compose.prod.yml \
  -f deploy/docker-compose.kvm.yml \
  up -d --remove-orphans
```

The KVM override does two things:
- attaches `/dev/kvm`
- switches `SANDBOX_BACKEND=boxlite`

The guest image intentionally includes `git`, `procps`, and `pandas` so the BoxLite sandbox matches the tool assumptions used by the backend and benchmark suite.

## DNS And TLS

Short term:
- `46.225.19.111.sslip.io` resolves to the current server IP
- Caddy can obtain a real certificate without waiting for manual DNS

Long term:
1. Create an `A` record for the final hostname pointing to `46.225.19.111`
2. Update `[deploy.docker].host`
3. Re-run `bui deploy`

The production Caddy config lives at [deploy/python/Caddyfile.prod](/home/ubuntu/projects/boring-ui/deploy/python/Caddyfile.prod).

## Verification

Minimum:

```bash
curl --fail https://46.225.19.111.sslip.io/healthz
curl --fail https://46.225.19.111.sslip.io/api/capabilities
```

Full smoke:

```bash
python3 tests/smoke/smoke_edge_mode.py \
  --base-url https://46.225.19.111.sslip.io \
  --sandbox-url https://46.225.19.111.sslip.io \
  --auth-mode neon \
  --skip-signup \
  --email '<existing-user-email>' \
  --password '<existing-user-password>'
```

`--skip-signup` is recommended until the final production hostname is added to all downstream auth/email redirect settings.
