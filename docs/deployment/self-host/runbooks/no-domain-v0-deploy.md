# No-domain v0 deploy runbook

Status: live-test runbook. The current OVH App VM now runs a GHCR image built by GitHub Actions and deployed with Kamal. Do not call this final public production until `prod-*` tag protection, full restore drill, and deployd automation are complete.

## Shape

```txt
operator creates protected prod-* tag
GitHub Actions builds/smokes/pushes GHCR image
GitHub Actions attests image digest and uploads deploy manifest
operator/deployd verifies tag + CI + provenance + digest
App VM runs Kamal
Cloudflare proxied dev hostname points at App VM; final hostname deferred
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
- Legacy temporary branch auto deploy script: `scripts/self-host/auto-deploy-from-github.sh`
- Legacy temporary systemd templates: `config/self-host/boring-auto-deploy.service.template`, `config/self-host/boring-auto-deploy.timer.template`

## Current live-test GitHub + Kamal deploy

The current App VM has the old branch poller disabled and runs a Kamal-managed container from a GitHub Actions-built GHCR image:

```txt
operator pushes prod-* tag
  -> GitHub Actions builds/smokes GHCR image
  -> GitHub Actions uploads deploy manifest
  -> operator verifies manifest digest
  -> operator runs migrations using the tagged GHCR image
  -> Kamal deploy --skip-push --version <prod-tag>
  -> /health must pass
```

Live-tested tag:

```txt
prod-ovh-test-20260624193633
commit 0b7c2e202fc0d3f7fff6e220537add0a3f3fa808
digest sha256:4397044ca0b121e7b41964e69ed34bf0068f0b76930db61b25108d9d4928505c
```

Important live-test caveats:

- The operator still runs Kamal manually; deployd/webhook automation is not installed yet.
- `gh attestation verify` was attempted with GitHub CLI 2.95.0, but the operator token was denied access to the requested GHCR/attestation resource. The manifest digest gate passed; full attestation verification still needs a token/package visibility fix or alternate verifier.
- Current dev hostname v0 publishes origin HTTP `80:3000` with `proxy: false`; nginx terminates origin TLS on `443` for Cloudflare Full mode and proxies to port `80`. Replace this with managed Cloudflare/Kamal proxy routing before final `app.senecaapp.ai` cutover.

## Manual/protected v0 flow

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
8. Probe `/health` over Tailscale and, when a dev hostname exists, through Cloudflare HTTPS.
9. Keep old deployment available for rollback until DB migration risk is known.

## Not allowed in v0

- No production secrets in GitHub Actions.
- No final public Cloudflare hostname yet; `dev.senecaapp.ai` is a live-test hostname only.
- No public PostgreSQL ingress.
- No unverified mutable image tag deploy.
- No destructive DB migration without a separate maintenance plan.

## Later public cutover

When final public hostname is chosen, switch from `dev.senecaapp.ai` to `app.senecaapp.ai` and add the reviewed edge policy/tunnel/proxy shape. Do not treat the dev hostname as final production cutover.
