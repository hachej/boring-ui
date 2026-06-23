# No-domain v0 deploy runbook

Status: live-test runbook. The current OVH App VM uses a temporary VM-owned GitHub branch poller for auto deploy. Do not use for final public production until `prod-*` tag protection, restore drill, and deployd/GHCR digest verification are complete.

## Shape

```txt
operator creates protected prod-* tag
GitHub Actions builds/smokes/pushes GHCR image
GitHub Actions attests image digest and uploads deploy manifest
operator/deployd verifies tag + CI + provenance + digest
App VM runs Kamal over Tailscale only
no public domain / no Cloudflare Tunnel for v0
```

## Preconditions

- OVH App VM and DB VM exist in France / Gravelines or the exact chosen OVH region code.
- Both VMs are joined to the current owner Tailscale network.
- DB VM PostgreSQL is reachable only from the App VM Tailscale `/32`.
- Cloudflare R2 EU jurisdiction backup bucket exists: `boring-ui-full-app-pgbackrest-eu`.
- pgbackrest repo encryption is configured with `repo1-cipher-type=aes-256-cbc` and vault/offline `PGBACKREST_CIPHER_PASS`.
- GitHub ruleset protects `prod-*` tags.
- GHCR package access is available to the App VM/deployd credential.
- Runtime env values are materialized from vault on the App VM/deployd host, not in GitHub Actions.

## Files

- Kamal template: `config/self-host/deploy.full-app.yml.template`
- Runtime env template: `config/self-host/full-app.env.template`
- Environment decisions: `docs/deployment/self-host/owner-decisions.md`
- Ansible scaffold: `infra/ansible/`
- Temporary GitHub branch auto deploy script: `scripts/self-host/auto-deploy-from-github.sh`
- Temporary systemd templates: `config/self-host/boring-auto-deploy.service.template`, `config/self-host/boring-auto-deploy.timer.template`

## Current live-test GitHub auto deploy

The current App VM intentionally uses a narrow, VM-owned branch poller while Cloudflare hostname/webhook and GHCR digest deployd are deferred:

```txt
GitHub branch plan/self-host-vm-boring
  -> App VM systemd timer every 2 minutes
  -> git fetch/reset
  -> docker build apps/full-app/Dockerfile --target web-runtime
  -> run migrations with DATABASE_MIGRATION_URL from VM secrets
  -> docker compose up -d --force-recreate
  -> require /health before recording last deployed revision
```

Installed live-test units on the App VM:

```bash
sudo install -m 0755 scripts/self-host/auto-deploy-from-github.sh /usr/local/bin/boring-auto-deploy
sudo cp config/self-host/boring-auto-deploy.service.template /etc/systemd/system/boring-auto-deploy.service
sudo cp config/self-host/boring-auto-deploy.timer.template /etc/systemd/system/boring-auto-deploy.timer
sudo systemctl daemon-reload
sudo systemctl enable --now boring-auto-deploy.timer
sudo systemctl start boring-auto-deploy.service
```

This keeps production secrets on the VM and out of GitHub Actions, but it is still a temporary live-test mechanism because it deploys a mutable branch tip rather than a verified GHCR digest.

## Future manual/protected v0 flow

1. Create a `prod-*` tag only after local checks and review pass.
2. Wait for `Self-host full-app image` workflow to pass.
3. Download the `full-app-deploy-manifest-*` artifact.
4. Run the local manifest gate:

   ```bash
   node scripts/self-host/verify-deploy-manifest.mjs \
     --manifest deploy-manifest.json \
     --repository hachej/boring-ui \
     --image ghcr.io/hachej/boring-ui-full-app \
     --workflow "Self-host full-app image"
   ```

   Add `--verify-attestation` only when the host has `gh` auth and network access; this explicitly calls GitHub to verify the artifact attestation.
5. Verify remaining deployd/operator gates:
   - manifest commit is the tagged commit;
   - image digest matches GHCR digest;
   - tag creator is trusted by repo ruleset;
   - CI/check status is green for the tagged commit;
   - no incompatible DB migration is included.
6. On the App VM/deployd host, fill Kamal/env files from vault.
7. Deploy the commit tag only after digest/provenance verification passes.
8. Probe `/health` over Tailscale.
9. Keep old deployment available for rollback until DB migration risk is known.

## Not allowed in v0

- No production secrets in GitHub Actions.
- No public Cloudflare hostname yet.
- No public PostgreSQL ingress.
- No unverified mutable image tag deploy.
- No destructive DB migration without a separate maintenance plan.

## Later public cutover

When public hostname is chosen, add Cloudflare Tunnel ingress and edge policy in a separate reviewed slice. Do not infer public hostname from this no-domain v0 runbook.
