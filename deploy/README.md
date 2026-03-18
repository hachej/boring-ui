# Deployment

boring-ui now deploys via Fly.io. Legacy Modal, Docker Compose, Go backend, and edge-mode artifacts have been removed.

## Fly.io (core mode)

Configs live in `deploy/fly/`:
- `deploy/fly/fly.toml` — core mode app config
- `deploy/fly/fly.secrets.sh` — reads Vault secrets and sets Fly secrets

Typical flow:

```bash
# Validate config
fly config validate -c deploy/fly/fly.toml

# Set secrets (requires Vault + flyctl auth)
bash deploy/fly/fly.secrets.sh

# Deploy
fly deploy -c deploy/fly/fly.toml
```

## Dockerfiles

- `deploy/shared/Dockerfile.backend` — backend image used by Fly builds
- `deploy/shared/Dockerfile.frontend` — frontend dev image (local usage)

## Notes

Backend-agent mode and multi-machine Fly configs (control plane + workspaces) are documented alongside their Fly configs as they land.
