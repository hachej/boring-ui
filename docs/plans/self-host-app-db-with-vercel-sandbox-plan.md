# Self-host App VM + DB VM while keeping Vercel Sandbox

Status: focused near-term plan. Initial safe implementation slices may live in the same worktree; this file remains the planning contract.

Intent: get boring-ui off managed app hosting / managed Postgres first, while keeping agent execution on Vercel Sandbox for now. This avoids solving self-hosted sandbox isolation before the app/database move is stable.

## Decision

Near-term architecture:

```txt
GitHub Actions
  -> CI only
  -> build boring-ui Docker image
  -> push GHCR image + immutable digest
  -> no Tailscale, DB, runtime, backup, or Kamal secrets

GitHub prod-* tag webhook
  -> Cloudflare Tunnel deploy route
  -> deployd on App VM
  -> verify repo/tag/commit/CI/digest/provenance
  -> run fixed Kamal deploy flow on App VM

Cloudflare Tunnel
  -> App VM / Kamal proxy -> boring-ui web app
  -> App VM / deployd webhook route

App VM
  -> deployd systemd service
  -> Kamal deploy host
  -> /data/pi-sessions
  -> /data/workspaces host anchors
  -> talks to DB VM over Tailscale
  -> talks to Vercel Sandbox for agent execution

DB VM
  -> native PostgreSQL
  -> pgbackrest backups
  -> Tailscale-only access

Vercel Sandbox
  -> actual agent shell/files runtime
  -> remote /workspace
```

Keep:

```txt
BORING_AGENT_MODE=vercel-sandbox
BORING_AGENT_WORKSPACE_ROOT=/data/workspaces
BORING_AGENT_SESSION_ROOT=/data/pi-sessions
```

Important caveat: in Vercel Sandbox mode, actual agent-edited files live in Vercel's `/workspace`, not in App VM `/data/workspaces`. `/data/workspaces` is a host/control-plane anchor. Backing up App VM `/data/workspaces` does not back up actual sandbox file trees.

## What this phase solves

- Removes Fly/app-host dependency.
- Removes Neon/managed Postgres dependency.
- Establishes Kamal deployment.
- Establishes Cloudflare Tunnel ingress.
- Establishes Tailscale-only admin/deploy/private DB access.
- Establishes native Postgres + pgbackrest backup/restore.
- Keeps sandbox risk out of the first migration.

## What this phase does not solve

- Does not remove Vercel Sandbox cost.
- Does not self-host actual agent execution.
- Does not locally back up Vercel sandbox `/workspace` contents.
- Does not provide microVM isolation under our control.
- Does not make `/data/workspaces` the source of truth for agent files.

## Container decision

### Should the boring-ui app use Docker?

Yes. Use Docker for the app layer.

Reasons:

- `apps/full-app` already has a production Dockerfile.
- Kamal expects/containerizes the app cleanly.
- Docker gives reproducible app builds, fast rollback to prior images, and a clean boundary between app runtime and host provisioning.
- App containers should be mostly stateless; durable state lives in Postgres and explicit `/data` mounts.
- Docker keeps Node/pnpm/build dependencies out of the host OS.

App runtime shape:

```txt
GHCR image -> Kamal -> web container
                     -> optional worker container later
                     -> explicit /data mounts only
```

Do **not** use Docker as an excuse to put everything in containers. For this phase:

| Component | Docker? | Rationale |
| --- | --- | --- |
| boring-ui web app | **Yes** | Reproducible deploys, Kamal, rollback, matches existing app Dockerfile. |
| boring-ui job/worker role if added | **Yes** | Same image/role split, stateless runtime. |
| Postgres | **No for serious client prod** | Native Postgres gives cleaner pgbackrest/PITR, systemd, LUKS/data-disk ownership, and lower backup complexity. |
| cloudflared | Prefer host service | Stable tunnel lifecycle independent of app deploys. |
| Tailscale | Host service | Private network substrate for deploy/admin/DB. |
| pgbackrest | Host service on DB VM | Needs direct Postgres/WAL/data-path integration. |
| Vercel Sandbox | External managed service | Keep out of VM for now. |

Docker rules for the app:

- production app container runs as a non-root user;
- no Docker socket mounted into app containers;
- no privileged app containers;
- `no-new-privileges:true` where compatible;
- explicit healthcheck;
- explicit `/data` mounts only;
- app runtime DB user is non-superuser;
- migration credentials are not kept in the normal request runtime if avoidable.

## VM provisioning decision

### Should we use Ansible?

Recommended target: **yes, Ansible-style idempotent provisioning**, copied from Healio's approach.

Why:

- VM state must be reproducible.
- DB and backup setup has many sharp edges.
- Manual setup drifts.
- Re-running should safely repair config.
- It doubles as on-prem/client install documentation.

But do not overbuild day one. Acceptable staged path:

```txt
v0: runbook + carefully reviewed shell commands for local spike/internal rehearsal only
v1: Ansible playbooks for App VM and DB VM before any client/production cutover
v2: optional thin wrapper/CLI that calls Ansible/Kamal
```

Production rule: runbook-only setup is not acceptable for client production. Before production cutover, App VM, DB VM, pgbackrest, firewall, users, cloudflared, Tailscale, and unattended-upgrades must be represented in Ansible and re-run cleanly from a fresh-ish VM state or documented rehearsal.

### Alternatives considered

| Alternative | Fit | Why not default |
| --- | --- | --- |
| Shell scripts only | Good for first spike | Not idempotent enough; drift-prone; hard to audit repairs. |
| cloud-init | Good for first boot | Poor for ongoing config changes and re-runs. |
| Terraform/OpenTofu | Good for cloud resources | Weak when provider has no useful VPS API; not ideal for inside-VM package/config management. |
| Pulumi | Same as Terraform | Better for cloud infra than host config. |
| NixOS | Very reproducible | Bigger adoption cost; harder for normal client/on-prem operators. |
| Docker Compose for everything | Simple demo | Bad fit for native Postgres + pgbackrest + host networking/tunnels. |
| Kamal hooks only | Useful app deploy hooks | Wrong layer for base OS, Postgres, cloudflared, Tailscale, unattended-upgrades. |
| Chef/Puppet/Salt | Capable | Heavier ecosystem than needed; Ansible is simpler and already proven in Healio. |

Decision:

- Use **Kamal** for app deploys.
- Use **Ansible as the standard tool for VM provisioning/configuration** after the VM exists.
- Use **Terraform/OpenTofu/CDK only for external resources** if needed: VM creation when provider API is good, volumes, firewall rules, S3/R2 buckets, IAM users, DNS records, monitoring resources.
- Do not force Terraform into inside-the-VM configuration. Terraform creates resources; Ansible configures machines.
- First version can create VMs manually/provider-dashboard first, then run Ansible, then deploy with Kamal.
- Keep a manual escape hatch documented for every automated step.

Operational split:

```txt
Provider UI / Terraform / OpenTofu:
  create VM, disks, firewall, DNS, buckets, IAM if provider supports it well

Ansible:
  install/configure Docker, Tailscale, cloudflared, firewall, users,
  native PostgreSQL, pgbackrest, unattended-upgrades, systemd services

Kamal:
  build/pull/deploy/rollback boring-ui app containers
```

Longer term, a `boring-host` wrapper may orchestrate these layers, but it should call the standard tools instead of replacing them.

## Required infrastructure

### App VM

Purpose:

- run boring-ui web container;
- run Kamal proxy;
- run cloudflared;
- store durable Pi sessions;
- hold workspace host anchors;
- connect privately to DB VM;
- invoke Vercel Sandbox.

Required packages/services:

- Docker;
- Tailscale;
- cloudflared;
- unattended-upgrades;
- non-root deploy user;
- firewall with no public inbound app/SSH ports.

Persistent paths:

```txt
/data/pi-sessions
/data/workspaces
/data/uploads                  # only if app uses local uploads
/data/apps/<child-app>/...     # future child app state
```

### DB VM

Purpose:

- native PostgreSQL;
- pgbackrest backups and WAL archive;
- private DB endpoint for App VM.

Required packages/services:

- PostgreSQL from PGDG apt repo;
- pgbackrest;
- Tailscale;
- unattended-upgrades;
- optional LUKS data volume;
- Healthchecks.io or equivalent backup alerting.

Postgres baseline:

- pinned major version;
- data checksums enabled;
- `pg_stat_statements` enabled;
- app runtime user is non-superuser;
- separate migration user;
- `pg_hba.conf` allows App VM Tailscale IP only;
- no public DB port.

### Vercel Sandbox

Purpose:

- remote agent execution;
- shell/files for agent sessions;
- Firecracker isolation managed by Vercel.

Required env/secrets:

```txt
BORING_AGENT_MODE=vercel-sandbox
VERCEL_TEAM_ID=...
VERCEL_PROJECT_ID=...
VERCEL_TOKEN=... # only where OIDC is unavailable
BORING_AGENT_VERCEL_SANDBOX_TIMEOUT_MS=...
BORING_AGENT_SNAPSHOT_KEEP=2
```

Cost controls:

- keep snapshot retention low, e.g. `BORING_AGENT_SNAPSHOT_KEEP=2`;
- stop sandboxes proactively when session ends if supported;
- avoid idle pools;
- monitor sandbox usage separately from VM cost.

## Deployment flow

Decision: use a **SingleServer-inspired webhook deploy model** for production so GitHub holds as few secrets as possible.

```txt
PR from any source
  -> GitHub Actions with read-only permissions
  -> frozen install + typecheck + tests + full-app build
  -> docker build web image locally with no push
  -> no production attestations/manifests

push to protected main / safe branch
  -> GitHub Actions may run trusted CI
  -> optional non-production/cache image only if needed

protected prod-* release tag from safe branch
  -> GitHub Actions with narrowly elevated package/provenance permissions
  -> build full-app web image explicitly
  -> smoke-test image /health before publishing
  -> push GHCR image with commit labels/digest
  -> publish mandatory provenance/manifest

prod-* release tag
  -> GitHub webhook through Cloudflare Tunnel
  -> deployd on App VM verifies event
      -> GitHub signature / webhook secret
      -> allowed repo
      -> allowed prod-* tag
      -> commit SHA
      -> CI status for commit is green
      -> GHCR image digest exists and labels match commit SHA
      -> deploy lock is free
  -> deployd runs fixed deploy flow on App VM
      -> pre-migration DB backup check
      -> migration command runs from App VM using migration credentials
      -> Kamal deploys exact image digest
      -> post-deploy smoke against Cloudflare URL
      -> deploy log/status recorded
```

GitHub Actions builds and publishes the image, but does **not** connect to Tailscale, does **not** receive DB credentials, and does **not** run Kamal. GitHub only needs enough permission to run CI/build, publish the image, and send the webhook event.

The deploy control plane lives on the App VM in a separate `deployd` systemd service, not inside the boring-ui web app container. `deployd` must only run fixed deploy commands; it must never be a generic remote command runner.

Migration decision: **run production migrations from the App VM/Kamal host**, not directly from GitHub Actions to the DB VM.

Reason:

- DB `pg_hba.conf` can stay narrow: App VM Tailscale IP only.
- CI does not need direct Postgres network access.
- Migration audit/logs stay tied to the deployment host.
- The App VM already has the intended private DB path.
- Runtime/deploy/migration secrets stay on the App VM/secret store path, not in GitHub Actions.

If a future flow needs CI-to-DB access, that must be a separate approved design with scoped Tailscale identity, scoped DB role, `pg_hba.conf` entry, audit, and short-lived credentials.

Kamal must not receive DB superuser credentials for normal runtime. Migration credentials are separate from runtime credentials.

## CI quality gates

Minimum gates before building/pushing a production image:

- frozen package install;
- typecheck;
- focused unit/integration tests for touched packages;
- `apps/full-app` build;
- Docker image build;
- migration command dry-run/check when available;
- post-deploy smoke script available for the target env.

For production promotion:

- commit is on the allowed repository history;
- CI status for the commit is green;
- production deploy tag matches the approved pattern, e.g. `prod-*`;
- `prod-*` tags are protected by GitHub ruleset or equivalent process;
- deployd verifies the tag creator/pusher actor is authorized; actor verification is mandatory because this is a public-repo attack vector;
- deployd fails closed if it cannot query/verify the actor, tag, commit, CI status, or provenance;
- tagged commit is an ancestor of protected `main` or an approved release branch;
- GHCR image digest exists and mandatory provenance/manifest matches the commit SHA;
- backup health is green;
- no pending DB destructive migration unless approved maintenance window exists.

## Production tag and image provenance policy

Public repo production deploys depend on strict tag/digest verification.

Rules:

- Only `prod-*` tags can trigger production deploy.
- `prod-*` tags must be protected/restricted to approved maintainers.
- Deployd must reject tags not pointing to protected `main` or an approved release branch.
- Deployd must verify the tag creator/pusher actor is authorized. This is mandatory; if actor lookup fails, deploy is rejected.
- Deployd must reject mutable tag-only deploys; production deploys use immutable GHCR digests.
- GitHub Actions must use strict trust separation:
  - PR workflows run read-only and never push deployable images or production provenance;
  - only protected `main`/approved safe branches and protected `prod-*` tag workflows can publish trusted artifacts;
  - no `pull_request_target` path may build/publish trusted production artifacts from untrusted code.
- The production tag workflow is the only workflow that may receive `packages: write` and attestation/provenance write permissions.
- Deployd trusts only artifacts produced by allowed workflow names/IDs on protected refs.
- GitHub Actions must publish image labels containing repo, ref, commit SHA, workflow run id, build timestamp, and expected role/stage.
- GitHub Actions must publish one mandatory provenance source before deploy is allowed:
  - preferred: GitHub artifact attestation / SLSA provenance for the OCI digest; or
  - acceptable v1: signed immutable deploy manifest/check-run artifact mapping `prod-*` tag -> commit SHA -> workflow run id -> image digest.
- Deployd verifies the attestation or signed manifest before deploying. Image labels alone are not sufficient.
- Deployd verifies the digest it pulls matches the verified digest; it does not trust a mutable tag lookup alone.
- No secrets may be passed as Docker build args or baked into image layers.

## Docker image build policy

The current `apps/full-app/Dockerfile` has multiple stages. Production web image builds must not rely on Docker's implicit final stage.

Required policy:

- Production full-app web image build must explicitly target the web runtime stage, e.g. `--target runtime`, or the Dockerfile must be refactored so the default final stage is the web app and worker builds use an explicit target.
- Preferred implementation cleanup: split or reorder Dockerfile so stage intent is obvious:
  - `web-runtime` final/default for public web app;
  - `worker-runtime` explicit target for agent/background worker image;
  - both run as non-root;
  - both carry OCI labels including role/stage, commit SHA, and source.
- CI must smoke-test the produced web image before pushing/provenance by running the container and checking `/health`.
- Deployd must verify the image has expected role/stage label, e.g. `boring.role=web`, before deploying.

## Migration artifact policy

Production migrations must come from the same verified release artifact as the app deploy.

Rules:

- Normal production migrations run from the same verified image digest that deployd is about to deploy, or from a separately verified migration artifact/digest listed in the same signed manifest/attestation.
- `DATABASE_MIGRATION_URL` is injected only into the one-shot migration container/process.
- Normal runtime containers receive only `DATABASE_URL` for the non-superuser runtime role.
- Migration classification (`none`, `backward-compatible`, `maintenance-required`) and rollback compatibility statement must be part of the verified release manifest/attested artifact.
- Deployd rejects releases whose migration metadata is missing or says `maintenance-required` unless a separate approved maintenance marker exists.

## Deployd credential model

Deployd needs read-only credentials on the App VM to verify public-repo deploy events safely.

Required shape:

- Use a GitHub App or fine-scoped read token stored on the App VM / chosen secret store, not in GitHub Actions.
- Required permissions, as applicable:
  - repository contents: read;
  - actions/workflow runs: read;
  - checks/statuses: read;
  - artifact attestations/provenance: read, if using attestations;
  - packages/GHCR: read, if the package is private or verification needs authenticated GHCR API.
- Deployd fails closed if the credential is missing, expired, revoked, or lacks required permissions.
- Rotation and revocation procedure is documented.
- Credential is not exposed to the boring-ui web app container.

## Tag/build race handling

A `prod-*` tag can trigger both the image build and the deploy webhook. Deployd must handle this race safely.

Decision for v1: deployd queues the event and polls verification state until success/failure/timeout.

Rules:

- On valid webhook, deployd records the event and enters `pending_verification`.
- It polls GitHub for CI/check completion and the required attestation/manifest/digest.
- It deploys only after CI is green and provenance verification succeeds.
- It fails the event after a bounded timeout with no partial deploy.
- Duplicate webhook deliveries attach to the existing pending event and do not start another deploy.

## Deployd hardening policy

Deployd is security-sensitive because it is a public webhook receiver with local deploy authority.

Required hardening:

- strict GitHub event type allowlist;
- raw-body HMAC verification with constant-time compare;
- maximum request body size;
- request timeout;
- replay window/timestamp handling where supported;
- persistent event-id dedupe across deployd restarts;
- repo allowlist;
- ref/tag allowlist;
- mandatory authorized tag actor verification;
- deploy lock;
- no arbitrary command execution from payload;
- fixed script allowlist only;
- unprivileged systemd user;
- minimal sudoers rule, if sudo is needed, for exact deploy command only;
- restricted filesystem access via systemd hardening where practical;
- Cloudflare WAF/rate-limit rule specifically for the deploy webhook hostname/path;
- deploy logs with event id, actor, repo, ref, commit SHA, digest, result, and rollback hint.
- GitHub webhooks do not provide a universally reliable timestamp for replay defense; persistent delivery-id dedupe across restarts is mandatory.

## Managed Postgres → DB VM migration

This phase explicitly includes moving from managed Postgres/Neon-style hosting to the DB VM.

### Migration method

Default: maintenance-window dump/restore.

```txt
old managed Postgres
  -> final logical backup/dump
  -> restore into native Postgres on DB VM
  -> validate
  -> deploy app pointing at DB VM
```

Logical replication can be considered later for lower downtime, but do not start there unless downtime is unacceptable.

### Pre-migration checklist

- Source provider backup/export exists.
- DB VM PostgreSQL major version is chosen and compatible.
- Required extensions are available.
- Roles/databases exist on DB VM.
- `pg_hba.conf` allows App VM only.
- pgbackrest initial full backup exists before migration rehearsal.
- Backup encryption key recovery is tested.
- Maintenance/write-freeze window is approved.
- Old provider rollback window is defined.

### Migration sequence

1. Announce maintenance/write-freeze if production.
2. Stop or freeze writes on old app.
3. Take final source backup/dump.
4. Restore into DB VM.
5. Run validation queries.
6. Run migrations from App VM using migration credentials if needed.
7. Point app runtime `DATABASE_URL` to DB VM.
8. Deploy via Kamal.
9. Run smoke tests.
10. Run first DB VM production backup.
11. Test-restore first DB VM backup before old provider is decommissioned.

### Validation queries/checks

At minimum:

- migration table/version is expected;
- table counts match source for critical tables;
- auth users/sessions/accounts tables sanity-check;
- workspace/member/settings tables sanity-check;
- sequence values are not behind max IDs where sequences exist;
- app can login/signup in the target env;
- workspace boot succeeds;
- agent chat starts with Vercel Sandbox.

### Rollback

Until first production backup restore passes, keep old managed Postgres paused/recoverable.

Rollback path before cutover completes:

1. Stop App VM app.
2. Restore previous app env pointing at old provider.
3. Kamal rollback or redeploy previous image if needed.
4. Re-open old app if writes were frozen.

Do not decommission old provider until:

- production app is healthy;
- first DB VM backup completed;
- first DB VM backup was test-restored;
- owner accepts the cutover.

## Migration and rollback rules

Docker rollback is not enough if DB schema changed. Production migrations must follow expand/contract discipline.

Rules:

- Backward-compatible migrations only in normal deploys.
- Deployd must block destructive/risky migrations unless a separate maintenance approval marker exists.
- Destructive migrations require a separate approved maintenance plan.
- Each release must classify migrations as `none`, `backward-compatible`, or `maintenance-required`.
- Pre-migration pgbackrest backup/restore point is required for risky migrations.
- App rollback compatibility must be stated before deploy.
- If migration fails before app rollout, abort deploy and keep old app serving.
- If app rollout fails after successful backward-compatible migration, `kamal rollback` to the prior image is allowed.
- If a destructive migration has run, rollback is a data restore operation, not just a Kamal rollback.

## Environment and secrets inventory

Choose the secret system before implementing deploy workflows. Preferred: 1Password like Healio, with GitHub environment secrets only for CI bootstrap/OIDC where needed.

App runtime secrets:

```txt
DATABASE_URL                         # runtime user, non-superuser
BETTER_AUTH_SECRET
BETTER_AUTH_URL
CORS_ORIGINS
WORKSPACE_SETTINGS_ENCRYPTION_KEY
MAIL_FROM
MAIL_TRANSPORT_URL or RESEND_API_KEY
BORING_AGENT_DEFAULT_MODEL_PROVIDER
BORING_AGENT_DEFAULT_MODEL_ID
model provider tokens, e.g. INFOMANIAK_API_TOKEN / Anthropic / OpenAI-compatible
BORING_AGENT_MODE=vercel-sandbox
BORING_AGENT_WORKSPACE_ROOT=/data/workspaces
BORING_AGENT_SESSION_ROOT=/data/pi-sessions
VERCEL_TEAM_ID
VERCEL_PROJECT_ID
VERCEL_TOKEN only where OIDC is unavailable
BORING_AGENT_VERCEL_SANDBOX_TIMEOUT_MS
BORING_AGENT_SNAPSHOT_KEEP=2
```

Migration-only secrets:

```txt
DATABASE_MIGRATION_URL               # migration role, not app runtime
DATABASE_ADMIN_URL                   # only if required by migration/bootstrap; never normal runtime
```

Infrastructure/deploy secrets:

```txt
GHCR/GITHUB_TOKEN permissions
Tailscale operator/admin credentials stay outside GitHub Actions; GitHub Actions does not need Tailscale OAuth for v1 deployd model
Cloudflare tunnel token/credentials
pgbackrest S3/R2/B2 access key
pgbackrest cipher passphrase
backup healthcheck URLs
alert webhook
```

Rules:

- DB admin/break-glass credentials stay in the secret store, not app runtime.
- Backup encryption key has offline recovery copy.
- Secrets used during bootstrap are rotated if pasted through local terminals.
- Owner knows how to recover Cloudflare/Tailscale/backup access.

## Backup scope in this phase

### Must back up

DB VM:

```txt
Postgres via pgbackrest
WAL archive
pgbackrest config metadata, without secret values
```

App VM:

```txt
/data/pi-sessions
/data/uploads if used
/data/apps/<app> state if used
Kamal config snapshot without secrets
cloudflared tunnel recovery notes
Tailscale recovery notes
```

### Must document as not backed up locally

```txt
Vercel Sandbox /workspace contents
Vercel-managed sandbox snapshots beyond provider retention
```

If agent workspace files become client-critical before self-hosted sandbox exists, add one of these before production promise:

1. export/sync files from Vercel sandbox to durable app storage;
2. switch that client/workspace to self-hosted remote sandbox;
3. explicitly mark agent workspace files as ephemeral/non-backed-up.

## Restore gates

Before production cutover:

- pgbackrest initial full backup exists;
- WAL archive is flowing;
- test restore to isolated DB/path succeeds;
- App VM file-state backup restore succeeds for `/data/pi-sessions` at minimum;
- backup encryption key recovery is tested;
- restore owner and alert recipient are named.

After production cutover:

- first production DB backup completes;
- first production file-state backup completes;
- first production backup is test-restored before old provider is decommissioned;
- recurring restore cadence is scheduled, at least quarterly for client production and after backup-system changes.

## Smoke tests

Post-deploy smoke must verify:

- `/health` through Cloudflare URL;
- auth page loads;
- login/signup path works for test user;
- workspace boot works;
- agent chat can start;
- Vercel sandbox command execution works;
- Pi session transcript persists after app container restart;
- DB migration version is current.

Mandatory production-readiness recovery tests:

- restart app container and confirm app recovers;
- reboot App VM and confirm app recovers;
- reboot DB VM during maintenance window and confirm app reconnects;
- run restore drill from latest backup;
- confirm Cloudflare Tunnel recovers after `cloudflared` restart;
- confirm Tailscale SSH/deploy path works after reboot.

## Security rules

- App VM has no public SSH.
- App VM has no public app port; Cloudflare Tunnel only.
- Kamal proxy/app should bind only to the local/tunnel-facing interface required by cloudflared, not expose a public origin.
- DB VM has no public DB port.
- DB accepts only App VM Tailscale IP and admin tunnel path.
- App runtime uses non-superuser DB credentials.
- Backup keys are not available to app runtime.
- Vercel token/OIDC credentials are treated as sandbox-provider secrets.
- No local/direct agent shell execution in web container.
- Production boot should reject `BORING_AGENT_MODE=direct` and reject `BORING_AGENT_MODE=local` unless explicitly approved for that deployment.
- Production app container must run as non-root; if a temporary root exception is needed, it requires explicit risk acceptance and compensating controls before public launch.
- Break-glass access is documented: provider console path, Tailscale loss procedure, time-bounded public SSH exception if ever used, and post-incident closure checklist.
- `deployd` is a separate App VM systemd service, not part of the web app.
- `deployd` webhook is exposed only through Cloudflare Tunnel on a dedicated hostname/path.
- `deployd` verifies GitHub signature/webhook secret, repo allowlist, `prod-*` tag allowlist, commit SHA, CI status, and GHCR image digest labels before deploy.
- `deployd` serializes deploys with a lock and rate-limits/rejects duplicate event IDs.
- `deployd` runs only fixed deploy scripts; no arbitrary command execution from webhook payload.
- `deployd` logs event id, repo, ref, commit SHA, image digest, result, and rollback hint.

## Monitoring before production

Production is not ready until alerts exist for:

- app health endpoint failure;
- post-deploy smoke failure;
- DB down/unreachable from App VM;
- DB disk usage threshold;
- App VM disk usage threshold;
- WAL archive stalled or pgbackrest check failed;
- full/differential backup failed;
- file-state backup failed;
- cloudflared down or tunnel unhealthy;
- Tailscale down/key expiry risk;
- unattended-upgrades failure/reboot required;
- SSL/TLS/domain routing failure if Cloudflare config changes.

Minimum observability views/runbooks:

- app logs via Kamal;
- DB service status;
- pgbackrest `info` and `check`;
- last successful DB backup timestamp;
- last successful file backup timestamp;
- disk usage;
- Cloudflare Tunnel status;
- Tailscale status;
- latest deployed image/tag/digest and rollback command;
- deployd event log, current deploy lock status, and last deploy result.

## Client data promise for Vercel Sandbox phase

Before any client production deployment, make one explicit written choice:

1. Vercel sandbox `/workspace` files are ephemeral/non-backed-up and the product/client docs say so; or
2. export/sync from Vercel sandbox to durable app storage exists and is tested; or
3. that client/workspace waits for a self-hosted remote sandbox backend.

Do not hide this as an internal caveat. It affects what data we can promise to restore.

## Implementation tasks, once approved

1. Add App VM Kamal config for `apps/full-app` using Docker/GHCR.
2. Add App VM Ansible role/playbook plus runbook: Docker, Tailscale, cloudflared, unattended-upgrades, firewall, non-root deploy user.
3. Add DB VM Ansible role/playbook plus runbook inspired by Healio: native PostgreSQL, roles, `pg_hba.conf`, `pg_stat_statements`, optional LUKS.
4. Add pgbackrest backup/restore Ansible role/playbook plus runbook.
5. Add managed Postgres → DB VM migration/cutover runbook with validation and rollback.
6. Add migration execution path from App VM/Kamal host, not direct CI-to-DB.
7. Add GitHub Actions build workflow: CI gates, Docker build, GHCR push, image labels/digest output. No Tailscale, DB, Kamal, or runtime secrets in GitHub Actions.
8. Add `deployd` design/implementation plan: Cloudflare Tunnel route, webhook verification, repo/tag/actor allowlist, mandatory provenance/digest verification, deploy event queue/polling for tag/build race, deploy lock, fixed Kamal deploy script, logs/status, rollback hints.
9. Add deployd read-only GitHub/GHCR credential plan on App VM with rotation/revocation and fail-closed behavior.
10. Add explicit production env/secrets inventory and chosen secret-store wiring.
11. Add production env checklist for Vercel Sandbox mode.
12. Add post-deploy smoke script/env for VM deployment.
13. Add monitoring/alerting setup and runbook.
14. Add backup restore drill checklist and recurring restore cadence.
15. Add production cutover checklist.
16. Add explicit docs caveat/client promise: Vercel sandbox `/workspace` is not backed up by App VM `/data/workspaces` unless export/sync/self-hosted sandbox is added.
17. Add dependency/update policy: unattended VPS package updates; app dependency rollups through PR/CI/main, production deploy by approved `prod-*` tag only.
18. Add production Docker hardening task: app container runs as non-root.

## Owner decisions needed

1. VM provider and size for App VM.
2. VM provider and size for DB VM.
3. Postgres major version, DB disk size/type, backup retention, WAL retention, max connections, and whether PgBouncer is needed.
4. Backup storage target: R2, B2, S3, or existing Healio-style AWS/S3.
5. Secrets system: 1Password like Healio, GitHub environments, or SOPS/age.
6. RPO/RTO target.
7. Whether first deployment is personal/internal or client production.
8. Alert recipient for backup/update/health/smoke failures.
9. Vercel Sandbox client data promise: ephemeral/non-backed-up, export/sync, or wait for self-hosted sandbox.
10. Cloudflare TLS/proxy mode and WAF/rate-limit baseline.
11. Production deploy tag pattern, e.g. `prod-*`, and who may create those tags.
12. Deployd webhook secret/GitHub App verification model and where that secret is stored on App VM.

## Stop rule

Do not start self-hosted sandbox work until this phase is boring:

- app deploys cleanly;
- DB backups restore;
- Vercel sandbox still works;
- no unexpected data-loss caveat remains hidden;
- operational runbooks are good enough for a tired human at 2am.
