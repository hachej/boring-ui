# Self-host App VM + DB VM with Vercel Sandbox — detailed todo list

Status: task breakdown for the approved near-term direction. Checkboxes describe remaining/target work; initial safe implementation slices may already exist in this worktree.

Parent plan: `docs/plans/self-host-app-db-with-vercel-sandbox-plan.md`

Goal: self-host boring-ui app + PostgreSQL using App VM + DB VM while keeping `BORING_AGENT_MODE=vercel-sandbox` for agent execution.

## Definition of done

The todo list is complete when:

- App VM is provisioned reproducibly with Ansible.
- DB VM is provisioned reproducibly with Ansible.
- GitHub Actions builds/publishes GHCR images without production runtime secrets; App VM deployd deploys verified `prod-*` image digests with Kamal.
- PostgreSQL runs natively on DB VM.
- pgbackrest backups and WAL archive are working.
- Managed Postgres migration/cutover path is rehearsed.
- Restore drill has passed.
- Vercel Sandbox still works after self-hosting app/DB.
- Client-facing Vercel `/workspace` durability promise is explicit.
- Monitoring/alerts exist for the critical failure modes.

## Phase 0 — owner decisions and environment contract

### 0.1 Choose first target environment

Tasks:

- [x] Decide first target: public full-app production.
- [x] Document that there is no hosted staging for v1; local/dev machine is the rehearsal environment.
- [x] Pick production domain/subdomain: none for v0. Owner says a domain exists in Cloudflare, but public hostname is deferred until public cutover.
- [ ] Name the owner who can approve cutover/rollback.

Acceptance:

- Target environment and owner are documented.
- If client production, no runbook-only setup is allowed.

### 0.2 Choose providers, sizes, and DB capacity baseline

Tasks:

- [x] Choose App VM provider: OVH France / Gravelines, confirm exact OVH region code during provisioning.
- [x] Choose DB VM provider: OVH France / Gravelines, confirm exact OVH region code during provisioning.
- [x] Choose App VM size: small baseline, about 2 vCPU, 4 GB RAM, 40 GB disk; exact OVH flavor TBD.
- [x] Choose DB VM size: small baseline, about 2 vCPU, 4-8 GB RAM, 80 GB disk; exact OVH flavor TBD.
- [ ] Choose DB disk size/type.
- [ ] Decide whether DB VM uses a separate data disk.
- [ ] Decide whether DB data disk uses LUKS.
- [ ] Choose PostgreSQL major version.
- [ ] Choose WAL/archive retention target.
- [ ] Choose Postgres `max_connections`.
- [ ] Choose per-app pool size.
- [ ] Decide PgBouncer yes/no for v1.
- [ ] Choose backup retention values for full/diff/WAL.

Initial recommendation:

```txt
App VM: 2-4 vCPU, 4-8 GB RAM, 40+ GB disk
DB VM: 2-4 vCPU, 8-16 GB RAM, 80+ GB disk, separate data disk if provider supports it
```

Acceptance:

- VM sizing is written down with upgrade path.
- Disk alert threshold is chosen.

### 0.3 Choose secrets system

Tasks:

- [x] Choose 1Password, GitHub Environments, SOPS/age, or hybrid: vault for Cloudflare/deploy/runtime/backup secrets; GitHub Actions remains build-only.
- [ ] Choose where break-glass secrets live.
- [ ] Choose who can access production secrets.
- [ ] Choose rotation policy after bootstrap.

Recommendation:

```txt
1Password for runtime/deploy/backup secrets.
GitHub Environments for CI bootstrap only.
```

Acceptance:

- Every secret has a source of truth.
- No secret is planned to live in git or plaintext docs.

### 0.4 Choose backup target and RPO/RTO

Tasks:

- [x] Choose R2/B2/S3/Healio-style AWS S3: Cloudflare R2 if EU jurisdiction bucket is available; otherwise choose another EU-compatible S3 target.
- [ ] Choose object-lock/immutable replica requirement for R2/EU or fallback target.
- [x] Choose pgbackrest retention: start with 4 weekly full backups + 14 daily differentials; WAL archive target remains continuous.
- [ ] Choose file-state backup retention.
- [ ] Set RPO target.
- [ ] Set RTO target.
- [ ] Name backup/restore owner.
- [x] Name alert recipient: Slack webhook, stored in vault.

Initial recommendation:

```txt
RPO: <= 5 min for DB after WAL archive is flowing.
RTO: <= 1 hour for DB VM loss after runbook is proven.
Retention: 4 weekly full backups + 14 daily differentials.
Immutable replica/object lock for client production.
```

Acceptance:

- Backup target and recovery goals are explicit before DB implementation starts.

### 0.5 Decide Vercel Sandbox data promise

Tasks:

- [ ] Choose one for client production:
  - [ ] Vercel sandbox `/workspace` files are ephemeral/non-backed-up.
  - [ ] Export/sync from Vercel Sandbox to durable app storage will be built before client production.
  - [ ] Client waits for self-hosted remote sandbox backend.
- [ ] Add chosen promise to product/client docs.

Acceptance:

- No hidden durability caveat remains.

### 0.6 Choose Cloudflare and edge baseline

Tasks:

- [ ] Choose Cloudflare TLS/proxy mode. Cloudflare account credential is in vault.
- [x] Choose hostname routing shape: no public hostname for v0; owner says domain exists in Cloudflare, but app/deploy hostnames are deferred.
- [ ] Choose WAF baseline.
- [ ] Choose rate-limit baseline for auth/API routes.
- [ ] Choose trusted proxy / forwarded-header behavior for the app.
- [ ] Decide whether any temporary origin bypass is allowed for break-glass.

Acceptance:

- Public ingress policy is explicit before App VM is exposed through Cloudflare Tunnel.

## Phase 1 — repository planning artifacts

### 1.1 Add deployment docs skeleton

Tasks:

- [ ] Add `docs/deployment/self-host/README.md` or equivalent.
- [ ] Link the focused plan.
- [ ] Link this todo list.
- [ ] Add glossary: App VM, DB VM, Vercel Sandbox, pgbackrest, Kamal, Tailscale, Cloudflare Tunnel.

Acceptance:

- A new operator can find the self-host docs from the docs index.

### 1.2 Add environment inventory template

Tasks:

- [ ] Create template for environment metadata:
  - domain;
  - App VM hostname/Tailscale name;
  - DB VM hostname/Tailscale name;
  - Cloudflare tunnel name;
  - backup bucket/repo;
  - alert endpoints;
  - deploy branch;
  - GitHub environment;
  - restore owner.

Acceptance:

- No environment-specific secret values are included.

### 1.3 Add explicit env/secrets inventory template

Tasks:

- [ ] Create a non-secret inventory table with columns: name, purpose, source of truth, consumed by, rotation notes, recovery notes.
- [ ] Include app runtime secrets:
  - `DATABASE_URL`;
  - `BETTER_AUTH_SECRET`;
  - `BETTER_AUTH_URL`;
  - `CORS_ORIGINS`;
  - `WORKSPACE_SETTINGS_ENCRYPTION_KEY`;
  - `MAIL_FROM`;
  - `MAIL_TRANSPORT_URL` or `RESEND_API_KEY`;
  - `BORING_AGENT_DEFAULT_MODEL_PROVIDER`;
  - `BORING_AGENT_DEFAULT_MODEL_ID`;
  - model provider tokens such as `INFOMANIAK_API_TOKEN`, Anthropic key, or OpenAI-compatible provider key;
  - provider-specific model config such as `BORING_AGENT_INFOMANIAK_PRODUCT_ID` and `BORING_AGENT_INFOMANIAK_MODEL` when used;
  - `BORING_AGENT_MODE`;
  - `BORING_AGENT_WORKSPACE_ROOT`;
  - `BORING_AGENT_SESSION_ROOT`.
- [ ] Include Vercel Sandbox secrets/config:
  - `VERCEL_TEAM_ID`;
  - `VERCEL_PROJECT_ID`;
  - `VERCEL_TOKEN` only where OIDC unavailable;
  - `BORING_AGENT_VERCEL_SANDBOX_TIMEOUT_MS`;
  - `BORING_AGENT_SNAPSHOT_KEEP`.
- [ ] Include migration/admin secrets:
  - `DATABASE_MIGRATION_URL`;
  - `DATABASE_ADMIN_URL` only if required;
  - break-glass DB admin credential reference.
- [ ] Include infra/deploy/backup secrets:
  - GHCR/GitHub permissions;
  - Tailscale operator/admin credential location for humans/App VM bootstrap; no Tailscale OAuth secret is needed in GitHub Actions for v1;
  - Cloudflare tunnel token/credentials;
  - pgbackrest object-storage key/secret;
  - pgbackrest cipher passphrase;
  - backup healthcheck URLs;
  - alert webhook.

Acceptance:

- Every env var/secret needed for app, DB, Vercel Sandbox, deploy, and backup has an owner and source of truth.
- No secret values are committed.

## Phase 2 — Ansible foundation

### 2.1 Create Ansible layout

Tasks:

- [ ] Create infra directory, e.g. `infra/ansible/` or `apps/infra-ansible/`.
- [ ] Add inventory structure for production first; optional staging inventory can be added later if hosted staging is introduced.
- [ ] Add `group_vars` for app/db/common.
- [ ] Add `host_vars` templates.
- [ ] Add `requirements.yml` for required Ansible collections.
- [ ] Add `.env.example` for secret references, not secret values.

Acceptance:

- `ansible-playbook --syntax-check` works on placeholder inventory.
- Secret placeholders are clearly marked.

### 2.2 Common role

Tasks:

- [ ] Install base packages.
- [ ] Set timezone UTC.
- [ ] Set locale.
- [ ] Configure non-root deploy/admin user.
- [ ] Disable SSH password auth where applicable.
- [ ] Configure firewall defaults: deny inbound, allow outbound.
- [ ] Allow Tailscale interface traffic.
- [ ] Install/configure unattended-upgrades.
- [ ] Add notification hook for upgrades/reboots.
- [ ] Add boot notification service if using Slack/email webhook.

Acceptance:

- Re-running role is idempotent.
- Public inbound remains closed after run.
- Unattended-upgrades config includes only approved origins.

### 2.3 Tailscale bootstrap and break-glass policy

Tasks:

- [ ] Document manual Tailscale bootstrap command.
- [ ] Document required tags for App VM and DB VM.
- [ ] Document disabling key expiry or tagged auth-key policy.
- [ ] Document Tailscale ACLs:
  - GitHub Actions CI does not SSH/Tailscale into App VM for v1;
  - App VM can reach DB VM on 5432;
  - operators can SSH as approved users;
  - DB admin tunnel path documented.
- [ ] Add check command for direct peering vs DERP.
- [ ] Document provider-console access path.
- [ ] Document Tailscale control-plane loss procedure.
- [ ] Document time-bounded public SSH exception if ever used:
  - who can approve;
  - source IP allowlist;
  - time limit;
  - audit/log note;
  - exact closure command/checklist.
- [ ] Document post-incident closure checklist.

Acceptance:

- Tailscale access model is explicit before DB port opens on tailnet.
- Break-glass does not require inventing steps during an outage.

## Phase 3 — DB VM provisioning

### 3.1 Native PostgreSQL role

Tasks:

- [ ] Add PGDG apt repository and signing key.
- [ ] Install pinned PostgreSQL major version.
- [ ] Install psycopg dependency for Ansible modules.
- [ ] Create cluster with data checksums.
- [ ] Configure `postgresql.conf`:
  - memory settings;
  - WAL settings;
  - `archive_mode=on`;
  - `archive_command` for pgbackrest;
  - `archive_timeout=60` or chosen value;
  - `listen_addresses` appropriate for Tailscale/private access;
  - `shared_preload_libraries='pg_stat_statements'`.
- [ ] Configure `pg_hba.conf`:
  - local peer;
  - App VM Tailscale IP;
  - monitoring role from localhost if used;
  - no broad CIDR.
- [ ] Enable and start PostgreSQL.

Acceptance:

- DB is not reachable publicly.
- App VM can reach DB after ACL and `pg_hba` are set.
- `pg_stat_statements` exists in app database.

### 3.2 DB roles and database

Tasks:

- [ ] Create app database.
- [ ] Create break-glass/admin role.
- [ ] Create migration role.
- [ ] Create runtime role.
- [ ] Create monitoring role if using metrics.
- [ ] Set runtime role as non-superuser.
- [ ] Set connection limits if chosen.
- [ ] Document exact credential names in secret store.

Acceptance:

- App runtime cannot perform admin-only actions.
- Migration role is not used by normal web runtime.

### 3.3 Optional LUKS data disk

Tasks:

- [ ] Detect stable disk identifier.
- [ ] Configure LUKS if selected.
- [ ] Mount at Postgres data path or dedicated mount.
- [ ] Ensure PostgreSQL systemd unit requires mount.
- [ ] Document recovery/key handling.

Acceptance:

- Reboot test proves DB starts after mount.
- LUKS recovery key is stored safely.

## Phase 4 — pgbackrest backup system

### 4.1 Backup repository resources

Tasks:

- [ ] Create bucket/repo in selected provider.
- [ ] Create scoped backup credentials.
- [ ] Configure immutable replica/Object Lock if selected.
- [ ] Store repo credentials and cipher passphrase in secret store.
- [ ] Store offline copy of cipher passphrase.

Acceptance:

- Backup credentials are least-privilege enough for pgbackrest needs.
- Losing operator laptop does not lose backup key.

### 4.2 pgbackrest role

Tasks:

- [ ] Install pgbackrest.
- [ ] Template `/etc/pgbackrest/pgbackrest.conf`.
- [ ] Set mode `0640 root:postgres` or equivalent.
- [ ] Create/check stanza.
- [ ] Reload PostgreSQL to activate WAL archiving.
- [ ] Run initial full backup.
- [ ] Add full backup schedule.
- [ ] Add differential backup schedule.
- [ ] Add Healthchecks/dead-man pings.

Acceptance:

- `pgbackrest check` passes.
- `pgbackrest info` shows stanza and backup.
- WAL archive is flowing.
- Backup failure triggers alert.

### 4.3 Restore runbook

Tasks:

- [ ] Write DB corruption restore procedure.
- [ ] Write DB VM loss/full rebuild procedure.
- [ ] Write PITR procedure.
- [ ] Write production restore safety rules.
- [ ] Add test restore command path.

Acceptance:

- Test restore to isolated DB/path succeeds before production.

## Phase 5 — App VM provisioning

### 5.1 Docker/Kamal host role

Tasks:

- [ ] Install Docker from official repo.
- [ ] Install Docker compose plugin if needed.
- [ ] Add deploy user to docker group only if accepted.
- [ ] Configure Docker log rotation.
- [ ] Confirm no public Docker API.
- [ ] Install Kamal prerequisites if deploy host needs them.

Acceptance:

- `docker ps` works for deploy user if required.
- Docker logs cannot fill disk unbounded.

### 5.2 cloudflared role

Tasks:

- [ ] Create Cloudflare tunnel manually or via external-resource automation.
- [ ] Store tunnel token/credentials in secret store.
- [ ] Install cloudflared.
- [ ] Install cloudflared systemd service.
- [ ] Configure ingress:
  - primary app hostname;
  - wildcard if needed;
  - dedicated deploy webhook hostname/path, e.g. `deploy.example.com/github` -> `localhost:<deployd-port>`;
  - default 404.
- [ ] Decide TLS/proxy mode.
- [ ] Document trusted proxy/forwarded header expectations.

Acceptance:

- Cloudflare URL reaches App VM service.
- Deploy webhook route reaches only deployd, not the web app.
- Direct origin bypass is not possible through public IP.
- `cloudflared` restart recovers service.

### 5.3 App VM file-state backups and recovery artifacts

Tasks:

- [ ] Choose restic/kopia/rclone+tar.
- [ ] Configure encrypted off-box backup for `/data/pi-sessions`.
- [ ] Include uploads/app state if used.
- [ ] Exclude caches/temp files.
- [ ] Add schedule and alerting.
- [ ] Add restore procedure.
- [ ] Store/snapshot Kamal config without secret values.
- [ ] Store Cloudflare tunnel recovery notes: tunnel name/id, hostnames, token location, recreate steps.
- [ ] Store Tailscale recovery notes: tailnet, tags, ACL references, key-expiry policy.

Acceptance:

- Test restore of `/data/pi-sessions` succeeds.
- Backup failure alerts.
- App VM rebuild does not depend on undocumented tunnel/Tailscale/Kamal knowledge.

## Phase 6 — Kamal app deployment

### 6.1 Kamal config

Tasks:

- [ ] Add Kamal config for production destination.
- [ ] Keep optional local/dev destination separate; no hosted staging is required for v1.
- [ ] Use GHCR image by immutable digest for deployd-triggered production deploys.
- [ ] Configure server host as App VM Tailscale hostname.
- [ ] Configure healthcheck `/health`.
- [ ] Configure env clear/secret lists.
- [ ] Mount `/data/pi-sessions` and `/data/workspaces`.
- [ ] Ensure app/proxy does not expose a public origin when Cloudflare Tunnel is only ingress.
- [ ] Add `no-new-privileges:true` where compatible.
- [ ] Do not mount Docker socket.

Acceptance:

- `kamal setup` works on App VM during first production rehearsal/cutover.
- `kamal deploy` can deploy an explicit GHCR image digest.
- Failed healthcheck does not switch traffic.

### 6.2 App image/env alignment

Tasks:

- [ ] Clean up `apps/full-app/Dockerfile` structure so production web image builds are unambiguous:
  - preferred: web runtime is the default/final production stage;
  - worker image uses explicit `--target worker-runtime`; or
  - alternatively, CI always uses explicit `--target runtime` and this is enforced by workflow/tests.
- [ ] Add OCI labels/metadata for expected role/stage, source, commit SHA, and revision.
- [ ] Verify `apps/full-app/Dockerfile` supports VM deployment env.
- [ ] Update/verify production image runs the web app as a non-root user.
- [ ] Block public production launch until the web image runs as non-root.
- [ ] Verify local/direct mode cannot be used in this production profile; keep bwrap packages only if existing image needs them for non-production compatibility.
- [ ] Add/confirm boot guard rejecting `BORING_AGENT_MODE=direct/local` for this production profile.
- [ ] Verify `BORING_AGENT_SESSION_ROOT=/data/pi-sessions`.
- [ ] Verify `BORING_AGENT_WORKSPACE_ROOT=/data/workspaces`.

Acceptance:

- App starts with Vercel Sandbox mode.
- Production web image build target/stage is unambiguous and tested.
- Production container runs as non-root.
- Local/direct sandbox mode cannot be accidentally enabled.

### 6.3 Vercel Sandbox production checklist

Tasks:

- [ ] Validate `VERCEL_TEAM_ID`.
- [ ] Validate `VERCEL_PROJECT_ID`.
- [ ] Decide OIDC vs `VERCEL_TOKEN` for this environment.
- [ ] Set `BORING_AGENT_VERCEL_SANDBOX_TIMEOUT_MS`.
- [ ] Set `BORING_AGENT_SNAPSHOT_KEEP=2` unless owner approves otherwise.
- [ ] Confirm no idle sandbox pool is configured.
- [ ] Confirm proactive sandbox stop-on-session-end behavior if supported; document if not supported.
- [ ] Add sandbox usage/cost monitoring or at least a weekly usage report.
- [ ] Add smoke check proving Vercel command execution works from self-hosted app.

Acceptance:

- Vercel Sandbox config is explicit and cost controls are visible before production.

## Phase 7 — GitHub build workflow and App VM deployd

### 7.1 GitHub CI/build workflow

Tasks:

- [ ] Split workflows by trust boundary:
  - PR workflow: read-only permissions, build/test only, Docker build with no push, no production provenance.
  - Protected `main`/safe branch workflow: trusted CI; optional non-production/cache image only if needed.
  - Protected `prod-*` tag workflow: production image build/push/provenance only.
- [ ] Add GitHub ruleset/protection for `prod-*` tags so only approved maintainers can create/move them.
- [ ] Ensure no `pull_request_target` workflow can publish trusted production artifacts from untrusted code.
- [ ] Production tag workflow permissions are narrowly elevated only where needed: `contents: read`, `packages: write`, and attestation/provenance write permission if using GitHub attestations.
- [ ] Checkout.
- [ ] Setup Node/pnpm.
- [ ] Frozen install.
- [ ] Typecheck.
- [ ] Focused tests.
- [ ] Build full-app.
- [ ] Migration command dry-run/check when available.
- [ ] Docker build web image explicitly using the intended web target/stage.
- [ ] Smoke-test produced web image in CI by running the container and checking `/health` before push/provenance.
- [ ] Label image with commit SHA, repo, ref, workflow run id, build timestamp, and role/stage.
- [ ] Push image to GHCR only from trusted safe branch/tag workflow.
- [ ] Emit immutable image digest.
- [ ] Publish mandatory provenance for the production image:
  - preferred: GitHub artifact attestation / SLSA provenance for the OCI digest; or
  - acceptable v1: signed immutable deploy manifest/check-run artifact mapping tag -> commit SHA -> image digest -> workflow run id.
- [ ] Include migration classification and rollback compatibility statement in the signed manifest/attested release metadata.
- [ ] Ensure no runtime/deploy secrets are used as Docker build args or written into image layers.
- [ ] Do **not** connect Tailscale.
- [ ] Do **not** load deploy/runtime/DB/backup/Vercel secrets.
- [ ] Do **not** run production migrations.
- [ ] Do **not** run Kamal.

Acceptance:

- Untrusted PRs cannot publish deployable artifacts, trusted manifests, or production provenance.
- CI/build can run for public repo without exposing production runtime secrets.
- Production image is addressable by immutable digest.
- Image metadata/provenance can be verified against commit SHA by deployd.

### 7.2 App VM deployd service

Tasks:

- [ ] Add deployd as a separate App VM systemd service, not inside the web app container.
- [ ] Add deployd read-only GitHub/GHCR credential to App VM secret store, not GitHub Actions:
  - contents/read;
  - actions/workflow runs read;
  - checks/statuses read;
  - attestations/provenance read if using attestations;
  - packages/GHCR read if needed.
- [ ] Document deployd credential rotation and revocation.
- [ ] Ensure deployd fails closed if credential is missing, expired, revoked, or under-permissioned.
- [ ] Bind deployd to localhost/private port behind Cloudflare Tunnel.
- [ ] Accept only one webhook path.
- [ ] Allowlist exact GitHub event types needed for production tag deploys.
- [ ] Enforce maximum request body size.
- [ ] Enforce request timeout.
- [ ] Verify GitHub HMAC signature or GitHub App signature from raw body with constant-time compare.
- [ ] Add replay window/timestamp handling where supported.
- [ ] Persist event-id dedupe across deployd restarts.
- [ ] Enforce allowed repository.
- [ ] Enforce allowed ref pattern: `prod-*` tags only for production.
- [ ] Verify tag creator/pusher actor is authorized. This is mandatory; reject deploy if actor lookup fails.
- [ ] Verify tagged commit is ancestor of protected `main` or approved release branch.
- [ ] Queue valid webhook event as `pending_verification` while CI/build may still be running.
- [ ] Poll GitHub until CI/check suite for commit is green or timeout/failure.
- [ ] Poll for mandatory attestation or signed deploy manifest until available or timeout/failure.
- [ ] Verify immutable attestation/manifest maps tag -> commit SHA -> image digest -> workflow run id.
- [ ] Verify GHCR image digest exists.
- [ ] Verify image labels/provenance match repo/ref/commit SHA/workflow run id and expected role/stage, e.g. `boring.role=web`.
- [ ] Pull/deploy exact verified digest, not a mutable tag.
- [ ] Serialize deploys with a lock.
- [ ] Reject duplicate event ids using persistent dedupe store that survives deployd restarts.
- [ ] Treat duplicate deliveries for an already pending event as the same deploy request, not a new deploy.
- [ ] Rate-limit webhook attempts.
- [ ] Run only a fixed deploy script; no arbitrary command from payload.
- [ ] Run deployd as an unprivileged systemd user.
- [ ] Add systemd hardening where practical: restricted filesystem, private temp, no new privileges.
- [ ] If sudo is needed, allow only exact fixed deploy command in sudoers.
- [ ] Add Cloudflare WAF/rate-limit rule specifically for deploy webhook hostname/path.
- [ ] Record deploy log: event id, actor, repo, ref, commit, digest, start/end, result, rollback hint.
- [ ] Optionally post GitHub commit/deployment status if credentials are available; not required for v1.

Acceptance:

- Invalid signature, event type, actor, repo, ref, commit, digest, provenance, or CI status cannot trigger deploy.
- Missing/expired deployd GitHub credential causes fail-closed, not partial deploy.
- Tag/build race resolves by queue/poll until verified success/failure/timeout.
- Concurrent deploys serialize or reject safely.
- Replay/duplicate events cannot trigger repeated deploys.
- deployd can be restarted without losing current deployed state, pending event, or event dedupe state.

### 7.3 Migration execution from App VM

Tasks:

- [ ] Add script/command on App VM or Kamal flow that runs migrations with migration credentials.
- [ ] Ensure migration command runs from the same verified image digest deployd is about to deploy, or from a separately verified migration artifact/digest in the same manifest/attestation.
- [ ] Ensure migration command uses `DATABASE_MIGRATION_URL` injected only into the one-shot migration container/process.
- [ ] Ensure runtime app uses `DATABASE_URL` runtime role and never receives migration credentials.
- [ ] Add pre-migration backup check.
- [ ] Add migration classification for each release: `none`, `backward-compatible`, or `maintenance-required`.
- [ ] Block `maintenance-required` migrations in normal deployd flow unless separate maintenance approval marker exists.
- [ ] Require rollback compatibility statement for normal releases.
- [ ] Record exact DB restore point before risky approved maintenance migrations.
- [ ] Add migration logs.
- [ ] Add acceptance check: migration command source is immutable and matches the verified deploy digest/manifest.

Acceptance:

- DB connection originates from App VM.
- Migration fails closed before app rollout if migration fails.

## Phase 8 — Managed Postgres migration rehearsal

### 8.1 Source inventory

Tasks:

- [ ] Identify current source DB provider.
- [ ] Capture source Postgres version.
- [ ] Capture extensions.
- [ ] Capture database size.
- [ ] Capture table counts.
- [ ] Capture migration version.

Acceptance:

- DB VM version/extension compatibility is known.

### 8.2 Rehearsal restore

Tasks:

- [ ] Take source backup/dump.
- [ ] Restore to local/dev DB copy. No hosted staging or temporary DB VM is required for v1.
- [ ] Run validation queries:
  - migration table/version;
  - critical table counts;
  - auth users/sessions/accounts sanity;
  - workspace/member/settings sanity;
  - sequence values not behind max IDs where sequences exist;
  - login/signup works;
  - workspace boot works;
  - agent chat starts with Vercel Sandbox.
- [ ] Run migrations if needed.
- [ ] Deploy/run app against restored DB in local/dev rehearsal or temporary rehearsal target.
- [ ] Run smoke tests.

Acceptance:

- Rehearsal can be repeated from scratch.
- Validation queries pass.

### 8.3 Production cutover runbook

Tasks:

- [ ] Define maintenance window.
- [ ] Define write-freeze mechanism.
- [ ] Define final dump/restore command.
- [ ] Define validation queries.
- [ ] Define deploy command.
- [ ] Define rollback command/path.
- [ ] Define old-provider retention period.

Acceptance:

- A tired operator can follow the cutover without inventing steps.

## Phase 9 — Smoke, monitoring, recovery

### 9.1 Post-deploy smoke

Tasks:

- [ ] Health endpoint check.
- [ ] Auth page loads.
- [ ] Test user login/signup.
- [ ] Workspace boot.
- [ ] Agent chat starts.
- [ ] Vercel Sandbox command execution.
- [ ] Pi session persists after app restart.
- [ ] DB migration version check.

Acceptance:

- Smoke fails deployment visibly when any required check fails.

### 9.2 Monitoring, alerts, and operational views

Tasks:

- [ ] App health alert.
- [ ] DB health alert.
- [ ] App VM disk alert.
- [ ] DB VM disk alert.
- [ ] WAL archive stalled alert.
- [ ] pgbackrest failure alert.
- [ ] file-state backup failure alert.
- [ ] cloudflared/tunnel alert.
- [ ] Tailscale/key expiry alert or calendar reminder.
- [ ] unattended-upgrades failure/reboot alert.
- [ ] smoke failure alert.
- [ ] SSL/TLS/domain routing alert or check.
- [ ] Operational view/runbook for app logs via Kamal.
- [ ] Operational view/runbook for DB service status.
- [ ] Operational view/runbook for pgbackrest `info` and `check`.
- [ ] Operational view/runbook for last successful DB backup timestamp.
- [ ] Operational view/runbook for last successful file backup timestamp.
- [ ] Operational view/runbook for disk usage.
- [ ] Operational view/runbook for Cloudflare Tunnel status.
- [ ] Operational view/runbook for Tailscale status.
- [ ] Operational view/runbook for latest deployed image/tag and rollback command.

Acceptance:

- Alert recipient receives a test alert before production.
- A tired operator can find health, backup, tunnel, Tailscale, and rollback status without guessing.

### 9.3 Recovery tests

Tasks:

- [ ] Restart app container and verify recovery.
- [ ] Reboot App VM and verify recovery.
- [ ] Reboot DB VM and verify app reconnects.
- [ ] Restart cloudflared and verify recovery.
- [ ] Restore latest DB backup to isolated path/DB.
- [ ] Restore latest file-state backup to temp path.

Acceptance:

- Recovery evidence is recorded.

## Phase 10 — Production cutover

Tasks:

- [ ] Confirm all owner decisions complete.
- [ ] Confirm Ansible re-run clean.
- [ ] Confirm backups green.
- [ ] Confirm restore drill passed.
- [ ] Confirm CI on main passed for the release commit.
- [ ] Confirm local/dev rehearsal smoke passed if performed; no hosted staging is required for v1.
- [ ] Freeze writes on old provider/app.
- [ ] Take final source DB backup.
- [ ] Restore to DB VM.
- [ ] Validate DB:
  - migration table/version;
  - critical table counts;
  - auth users/sessions/accounts sanity;
  - workspace/member/settings sanity;
  - sequence values not behind max IDs where sequences exist.
- [ ] Run migrations from App VM/Kamal host with `DATABASE_MIGRATION_URL` if needed.
- [ ] Abort before app rollout if migration fails.
- [ ] Verify runtime `DATABASE_URL` points to DB VM using non-superuser runtime role.
- [ ] Deploy app.
- [ ] Smoke production.
- [ ] Run first production DB backup.
- [ ] Run first production file-state backup.
- [ ] Test-restore first production backup.
- [ ] Keep old provider recoverable until owner accepts decommission.

Acceptance:

- Owner signs off cutover.
- Old provider is not removed until production backup restore passes.

## Phase 11 — After launch

Tasks:

- [ ] Schedule recurring restore drills.
- [ ] Add dependency/update policy doc:
  - unattended-upgrades for approved VPS package origins;
  - PostgreSQL minor updates allowed automatically;
  - PostgreSQL major updates require maintenance runbook;
  - app dependency patch/minor rollups through PR/CI/main; production deploy only by approved `prod-*` tag and deployd;
  - app major updates require explicit review;
  - no app dependency auto-merge to production.
- [ ] Schedule dependency rollup cadence.
- [ ] Schedule OS/VPS update review cadence.
- [ ] Track actual VM, backup, and Vercel Sandbox costs.
- [ ] Track sandbox usage and decide when to spike Daytona/gVisor remote sandbox.
- [ ] Document incidents/surprises.

Acceptance:

- We know whether the self-host move actually lowered cost without increasing unacceptable ops risk.

## Explicit non-tasks for this phase

- [ ] Do not build a full SingleServer clone; only build the narrow deployd webhook needed for full-app production deploys.
- [ ] Do not build `boring-host` wrapper.
- [ ] Do not self-host sandbox execution.
- [ ] Do not deploy Daytona/E2B/BoxLite for production.
- [ ] Do not put Postgres in Docker for serious client production.
- [ ] Do not share one VM across unrelated clients.
