# Self-hosted boring-ui VM deployment plan

Status: planning only — no implementation in this worktree yet.

Owner intent: reduce Fly/Neon/Vercel-adjacent hosting costs by running boring-ui and selected child apps on Linux VMs, using SingleServer as product inspiration and the local Healio project as the proven deployment/operations reference.

## Executive summary

Do **not** build a SingleServer clone first. Start with a production-safe, boring deployment profile:

```txt
GitHub Actions -> GHCR image -> Tailscale SSH -> Kamal deploy -> Cloudflare Tunnel -> App VM
                                                          |
                                                          +-> native PostgreSQL + pgbackrest on DB VM or same VM
                                                          +-> encrypted off-box backups + restore drills
                                                          +-> optional separate agent-worker for local bwrap sandboxes
```

For the first client-safe version, copy the **Healio shape** more than SingleServer:

- Kamal for deploys and zero-downtime app rollouts.
- Cloudflare Tunnel for public HTTPS, with no public app ports.
- Tailscale for SSH/private admin/deploy access.
- GitHub Actions builds images and deploys over Tailscale.
- GHCR image registry.
- 1Password or GitHub environments for secrets.
- Native PostgreSQL managed by Ansible-style idempotent config.
- pgbackrest with continuous WAL archiving, encrypted S3-compatible storage, immutable replica/Object Lock where possible.
- unattended-upgrades for safe OS/VPS package minor/security releases.

Use SingleServer as inspiration for later convention/wrapper work: app allowlists, `doctor`, setup repair, signed webhooks, serialized deploys, generated config, and one-command onboarding. Do not start there.

The first production-safe product is **one deployment boundary per serious client/tenant**. That can be one VM for low-risk/internal apps, but the default client shape should be **App VM + DB VM** when data matters.

## Goals

1. Run `apps/full-app` and child boring apps on conventional Linux infrastructure.
2. Replace expensive managed app hosting and managed Postgres where cost is hurting.
3. Deploy PostgreSQL ourselves, safely, not as an afterthought.
4. Preserve boring-ui durability requirements:
   - Postgres data;
   - Pi/chat session roots;
   - workspace host anchors;
   - actual agent workspace files when local/worker sandbox mode is enabled;
   - uploaded files or app-owned state.
5. Make backup and restore a release gate, not a nice-to-have.
6. Keep sandbox execution safe enough for client deployments.
7. Handle routine OS/VPS package minor/security updates automatically with alerting.
8. Create a reusable deployment profile that can later become a small CLI/wrapper.

## Non-goals

- No Kubernetes.
- No multi-host scheduler.
- No HA claim in the first version.
- No arbitrary repo onboarding.
- No public SSH.
- No direct public app ports if Cloudflare Tunnel is viable.
- No custom GitHub webhook daemon until the CI/Kamal path is proven.
- No shared VM for unrelated paying clients until isolation, quotas, backups, and incident boundaries are much stronger.
- No local untrusted shell execution inside the web container.
- No silent fallback between sandbox modes.

## Key references and evidence

### boring-ui current deployment shape

- `apps/full-app` is the production reference app.
- It composes core auth/workspaces, workspace UI, and agent runtime.
- It currently deploys with Docker/Fly-style assumptions.
- Required env includes Postgres, Better Auth URL/secret, workspace settings encryption key, mail transport, and model/provider settings.
- Durable production paths matter:
  - `BORING_AGENT_WORKSPACE_ROOT=/data/workspaces`
  - `BORING_AGENT_SESSION_ROOT=/data/pi-sessions`
- Agent runtime modes:
  - `direct`: host process, trusted local only;
  - `local`: bwrap sandbox on Linux;
  - `vercel-sandbox`: remote Firecracker microVM.

Important caveat: in `BORING_AGENT_MODE=vercel-sandbox`, actual agent-edited files live in the Vercel sandbox `/workspace`; `/data/workspaces` is a host/control-plane anchor, not a full backup of the sandbox file tree. Therefore Stage 1 can reduce Fly/Neon risk, but it does **not** remove Vercel sandbox cost or provide local backup of actual sandbox files. Workspace-file durability requires local/worker sandbox mode or an explicit Vercel snapshot/export story.

### Healio reference pattern

Healio demonstrates the target operational shape:

- Kamal deploys web/job roles.
- Cloudflare Tunnel handles public HTTPS.
- Tailscale handles SSH/private admin/deploy access.
- GitHub Actions connects to Tailscale and deploys via Kamal.
- Images are built and pushed to GHCR.
- Secrets come from 1Password/GitHub environment.
- Solver runs as an internal accessory.
- PostgreSQL is deployed natively on a DB VPS via idempotent Ansible roles.
- PostgreSQL uses PGDG packages, data checksums, `pg_stat_statements`, Tailscale-restricted `pg_hba.conf`, and WAL archiving.
- pgbackrest provides continuous WAL archiving, weekly full backups, daily differential backups, encryption, S3-compatible storage, and Healthchecks.io alerts.
- unattended-upgrades handles approved OS/VPS package minor/security releases, including PostgreSQL minor releases, Docker, cloudflared, Tailscale, and pgbackrest, with notifications and staggered reboots.
- Restore procedure includes test restore before destructive live restore.

### SingleServer inspiration

SingleServer proves a friendly convention-over-configuration direction:

- one Linux server can host many apps;
- install/repair flow wires Docker, Kamal, Cloudflare, Tailscale, GitHub;
- repo/branch allowlist gates deploys;
- signed GitHub webhooks trigger deploy;
- per-app deploys serialize;
- failed healthchecks keep old container serving;
- Cloudflare Tunnel avoids public inbound app ports;
- Tailscale protects admin access;
- app storage backups are explicit;
- destructive removal is opt-in.

Transfer the principles, not the whole implementation, in v1.

## Target architecture

### Recommended client architecture: App VM + DB VM

```txt
                         GitHub
                           |
                           | push / workflow_dispatch
                           v
                    GitHub Actions
                           |
          build/test -> docker build -> push GHCR
                           |
                           | Tailscale OAuth tag:ci
                           v
                  Tailscale private SSH
                           |
                           v
                         Kamal
                           |
       ------------------------------------------------
       |                    App VM                    |
       |                                              |
       |  cloudflared -> kamal-proxy -> web app       |
       |                              -> child apps    |
       |                              -> job workers   |
       |                                              |
       |  /data/workspaces                            |
       |  /data/pi-sessions                           |
       |  /data/uploads or app-specific state         |
       |                                              |
       |  optional agent-worker container             |
       |  Docker + Kamal-managed app containers       |
       ------------------------------------------------
                           |
                           | Tailscale-only PostgreSQL connection
                           v
       ------------------------------------------------
       |                    DB VM                     |
       |                                              |
       |  native PostgreSQL                           |
       |  /var/lib/postgresql on dedicated volume     |
       |  pgbackrest WAL archive + backups            |
       |  optional LUKS for data volume               |
       |  no public database port                     |
       ------------------------------------------------
                           |
                           v
               encrypted S3/R2/B2 backup repository
               + optional immutable replica/Object Lock
```

Use one combined VM only for internal/personal or low-risk deployments where the single-machine blast radius is explicitly accepted. The plan should still keep Postgres native on the host rather than hidden inside the app container if pgbackrest/PITR is required.

Network policy:

- Public internet reaches Cloudflare only.
- Cloudflare Tunnel reaches local app/proxy over outbound tunnel.
- Tailscale is required for SSH, database access, Ansible, and operational commands.
- DB listens only on localhost/Tailscale and is restricted by both Tailscale ACLs and `pg_hba.conf`.
- VM public firewall blocks inbound ports after bootstrap.
- Break-glass public SSH, if allowed at all, must be time-bounded, source-IP allowlisted, logged, and removed after incident.

## Deployment profiles

### Profile A — boring full-app, App VM + native DB VM

Use this first for a serious client.

Components:

- `web` container: Fastify/React app from `apps/full-app` image.
- `job` role if the app needs background workers.
- `postgres`: native PostgreSQL on DB VM, not inside the web container.
- `pgbackrest`: DB VM backup/WAL archiving.
- `cloudflared`: App VM host systemd service preferred for stable tunnel lifecycle.
- `tailscaled`: App VM and DB VM host service.
- `backup-file-state`: App VM systemd timer for `/data` file state.
- optional `agent-worker`: separate container/role if local bwrap execution is enabled.

State:

```txt
DB VM:
  /var/lib/postgresql/<major>/main        # native PostgreSQL data directory
  /etc/postgresql/<major>/main            # managed PostgreSQL config
  /etc/pgbackrest/pgbackrest.conf         # generated from secrets/env, mode 0640 root:postgres

App VM:
  /data/workspaces                        # boring workspace host anchors; actual files only in local/worker mode
  /data/pi-sessions                       # durable Pi/chat transcripts
  /data/uploads                           # if app uses local uploads
  /data/apps/<app>/...                    # child-app state
  /data/backups-local                     # temporary staging only, never sole copy
```

Initial agent mode:

```txt
BORING_AGENT_MODE=vercel-sandbox
```

Reason: first remove Fly/Neon risk before moving untrusted shell execution onto self-hosted infrastructure. This does **not** remove Vercel sandbox spend yet.

### Profile B — combined single VM

Use for personal/internal apps or low-risk client pilots.

Components are the same, but App and DB roles share the VM. This increases blast radius:

- app CPU spikes can affect DB;
- disk pressure can affect DB and backups;
- sandbox mistakes are more dangerous;
- OS reboot takes everything down.

Required extra gates:

- explicit owner acceptance of combined blast radius;
- strict disk monitoring;
- separate Linux users/systemd units where practical;
- app container CPU/memory/log limits;
- no local sandbox worker until resource isolation is tested.

### Profile C — boring full-app with local sandbox worker

Use only after Profile A or B is stable.

Components:

- `web`: DB/auth/mail/session application.
- `agent-worker`: bwrap-capable execution role/container.

Rules:

- Worker has no DB admin secrets.
- Worker has no Docker socket.
- Worker is not privileged.
- Worker has explicit CPU/memory/pid limits.
- Worker has explicit workspace mount only.
- Worker has minimized env allowlist.
- Worker has private-only surface.
- Worker command execution is audited.
- Worker egress is controlled or at least logged and reviewed.
- Bad worker config, auth, or health must fail closed.
- Fallback to Vercel sandbox is a manual config/deploy rollback with smoke test, never automatic silent fallback.

Important guard: the web role must not be able to run local/direct untrusted shell execution in client production. Either use a web image/profile without bwrap/local execution tools, or add a production boot assertion that rejects `BORING_AGENT_MODE=local`/`direct` unless an explicit override is present.

### Profile D — child apps

Use after Profile A is repeatable.

Each child app declares:

```yaml
name: client-app
repo: github.com/org/repo
branch: main
domain: app.example.com
image: ghcr.io/org/app
port: 3000
healthcheck: /health
roles:
  - web
resources:
  memory: 512m
  cpus: 0.5
  pids: 256
  logMaxSize: 50m
volumes:
  - /data/apps/client-app/uploads:/app/uploads
postgres:
  database: client_app
  runtimeUser: client_app_user
  migrationUser: client_app_migrator
  maxConnections: 10
backup:
  include:
    - postgres:client_app
    - /data/apps/client-app/uploads
secrets:
  source: github-environment-or-1password
```

Do not infer state. If state is not declared, the app is treated as stateless and cannot store durable data.

## PostgreSQL deployment contract

This is mandatory, not optional.

### Default shape

Use Healio's native PostgreSQL approach:

- PostgreSQL installed from PGDG apt repository.
- Pinned major version, e.g. PostgreSQL 18.
- Minor/security updates handled by unattended-upgrades from approved origins.
- Major upgrades are manual maintenance windows with backup-before-upgrade.
- Native data directory, not hidden inside Docker, when using pgbackrest/PITR.
- Data checksums enabled at cluster creation.
- `pg_stat_statements` enabled for debugging/monitoring.
- `listen_addresses` limited to localhost/Tailscale needs; access still restricted by firewall/Tailscale ACL/`pg_hba.conf`.
- `pg_hba.conf` allows only app VM Tailscale IP(s), local peer, and monitoring role.
- Optional LUKS data volume for client-sensitive deployments.

### Roles and databases

For each environment/app:

- `master`/break-glass superuser: stored in 1Password, not used by app runtime.
- `app_owner` or owner role: owns schema objects when needed.
- `app_migrator`: runs migrations, elevated enough for DDL but not used by web requests.
- `app_runtime`: used by web/job runtime, non-superuser, least privilege.
- `backup`/postgres OS user: pgbackrest runs as `postgres`, not through app credentials.
- `monitor`: `pg_monitor`, connect only for metrics.

For child apps, prefer separate database + user pair by default. Sharing one database is allowed only with explicit reason.

### Migrations

Kamal deploy must define migration order explicitly:

1. Ensure latest successful DB backup exists.
2. Optionally trigger on-demand backup before risky migrations.
3. Run app migration command with migration credentials.
4. If migration succeeds, roll app.
5. If migration fails, do not roll app.
6. Document rollback limits: schema migrations may not be safely reversible without restore.

### Connection and resource limits

- Set `max_connections` per DB VM capacity.
- Set per-app connection pool limits.
- Set per-role `CONNECTION LIMIT` where practical.
- Monitor slow queries and lock waits.
- Track DB size and WAL/archive growth.

## Backup and restore design

### Database backups: pgbackrest first for clients

For client production, default to pgbackrest, not `pg_dump`.

Healio-inspired baseline:

- continuous WAL archiving with `archive_timeout=60` for roughly 60s RPO;
- weekly full backup;
- daily differential backup;
- zstd compression;
- client-side encryption (`repo1-cipher-type=aes-256-cbc` or equivalent);
- encrypted off-box S3-compatible repository;
- operational bucket used by pgbackrest;
- optional replica bucket with Object Lock/immutability for ransomware protection;
- Healthchecks.io or equivalent dead-man's-switch alerts for full and diff backup jobs;
- initial full backup created during setup;
- `pgbackrest info` exposed through runbook/doctor.

`pg_dump` is allowed only for early internal prototypes or supplemental logical exports. It is not the primary client-production backup system.

### File-state backups

Back up App VM file state separately:

```txt
/data/pi-sessions
/data/uploads
/data/apps/<app>/...
/data/workspaces       # host anchors; actual agent files only in local/worker mode
```

Use restic/kopia/rclone+tar with client-side encryption. Provider-side encryption alone is not enough for client production.

Consistency choices must be explicit per path:

- DB consistency is handled by pgbackrest.
- Pi sessions are append-ish; restic/kopia snapshots are acceptable if restore is tested.
- Uploads should be content-addressed or quiesced/snapshotted if consistency matters.
- If local agent workspaces become real durable state, either quiesce the worker, snapshot the filesystem, or accept/document per-file crash consistency.

### Backup key custody

- Backup encryption key is stored in 1Password.
- Offline recovery copy exists.
- Losing the key means losing backups; this must be in the runbook.
- Key rotation procedure is documented before high-value client production.

### Restore policy

- Restore defaults to isolated test database/temp paths.
- Live restore requires explicit `--commit` or equivalent confirmation.
- Old live data is moved aside before destructive replace when feasible.
- Restore runbook includes DNS/tunnel/secret recovery.
- First production backup must be test-restored before old provider is decommissioned or the cutover confidence window ends.

## Automatic minor/security update policy

Healio's model should be copied for VPS package maintenance.

### What auto-updates

Use unattended-upgrades with approved apt origins only:

| Component | Source | Policy |
| --- | --- | --- |
| Debian/Ubuntu security | distro security origin | automatic |
| PostgreSQL minor version | PGDG apt origin | automatic minor/security only |
| pgbackrest | PGDG apt origin | automatic |
| Docker CE | Docker apt origin | automatic after staging proves stable |
| cloudflared | Cloudflare apt origin | automatic |
| Tailscale | Tailscale apt origin | automatic |

### What does not auto-update

- PostgreSQL major versions: manual maintenance window and `pg_upgrade`/dump-restore plan.
- Application code: GitHub Actions/Kamal deploys only.
- npm/pnpm app dependencies: Renovate/Dependabot PRs with CI, staging deploy, and human/owner merge unless explicitly low-risk.
- Ansible/infra role changes: reviewed PR + manual playbook run.

### Reboot strategy

- Security/kernel updates may require reboot.
- DB VM reboots before App VM, e.g. DB 03:00 UTC, App 04:00 UTC.
- Combined VM deployments accept full downtime during reboot.
- Notifications must say what upgraded, whether reboot is pending/scheduled, and whether the service recovered.

### App dependency rollups

For boring-ui and child apps, use a separate dependency-release lane:

- weekly grouped patch/minor dependency PRs;
- lockfile-only updates allowed only with CI;
- major updates never auto-merged;
- package manager version pinned via Corepack/packageManager;
- CI must run typecheck/tests/build;
- staging deploy is required before production promotion;
- production dependency rollup happens through normal Kamal deploy path;
- rollback is previous GHCR image + database rollback caveat if migrations were included.

This keeps OS/VPS security updates fast while app dependency changes remain reviewable and deployable.

## Staged rollout

### Stage 0 — Production contract and host hardening

Deliverables:

- `boring-vm-single-tenant` contract document.
- Decide App VM + DB VM vs combined VM.
- Required host baseline:
  - Ubuntu/Debian LTS;
  - non-root deploy/admin user;
  - SSH password auth disabled;
  - Tailscale installed and tagged;
  - Cloudflare Tunnel on App VM;
  - Docker on App VM;
  - PostgreSQL PGDG repo on DB VM;
  - unattended-upgrades configured with approved origins;
  - Slack/email/Healthchecks notifications configured;
  - outbound access to registry/Cloudflare/Tailscale/GitHub/backup storage.
- GitHub trust baseline:
  - protected deploy branch/tags;
  - GitHub environment protections for production;
  - least-privilege GHCR token/GITHUB_TOKEN permissions;
  - pinned/reviewed GitHub Actions where practical;
  - Tailscale OAuth scoped to deploy tag.
- Explicit accepted risks:
  - single VM or two-VM blast radius;
  - no HA;
  - maintenance windows allowed;
  - capacity planning is manual.

Acceptance:

- A new operator can explain what lives on App VM, DB VM, and off-box storage.
- No implementation starts before backup, Postgres, update, and sandbox policies are accepted.
- Break-glass access is documented and bounded.

### Stage 1 — DB VM and backup foundation

Do this before serious app cutover.

Deliverables:

- Native PostgreSQL installed and configured idempotently.
- Pinned major version.
- Data checksums enabled.
- Tailscale-only DB access.
- App/migration/runtime/monitor roles created.
- pgbackrest installed and configured.
- WAL archiving enabled.
- Initial full backup created.
- Full/diff backup schedule installed.
- Healthcheck/dead-man alerts configured.
- Test restore runbook executed once.

Acceptance checks:

- App VM can connect to DB over Tailscale.
- Public internet cannot connect to DB.
- `pgbackrest info` shows a valid stanza and at least one backup.
- WAL archive is flowing.
- Test restore to isolated DB/path works.
- Backup encryption key recovery is tested.

### Stage 2 — Staging App VM with current Vercel sandbox mode

Deliverables:

- Kamal config for `apps/full-app`.
- GitHub Actions workflow:
  - checkout;
  - install/build/typecheck focused gates;
  - Docker build;
  - push GHCR;
  - connect Tailscale;
  - run migrations with migration credentials;
  - run `kamal deploy`.
- Cloudflare Tunnel route for staging domain.
- Tailscale SSH-only admin.
- `/data/workspaces` and `/data/pi-sessions` mounted into web container.

Acceptance checks:

- `GET /health` passes through Cloudflare URL.
- App boots after VM reboot.
- Deploy succeeds from GitHub Actions.
- Failed healthcheck does not switch traffic.
- Pi session directory survives deploy/restart.
- Vercel sandbox durability caveat is documented in release notes/runbook.
- No public SSH/app port is reachable from the internet.

### Stage 3 — Data migration rehearsal

Deliverables:

- Migration runbook from current production provider to self-hosted Postgres.
- Dry-run import into staging DB.
- Smoke script against imported data.
- Backout runbook.
- Backup-before-migrate procedure.

Acceptance checks:

- Migration can be repeated from scratch.
- Data count sanity checks pass.
- Auth/session/workspace boot works after migration.
- Backup exists before migration.
- Backout path is documented and tested enough to be credible.

### Stage 4 — File-state backups and restore drill

Deliverables:

- Encrypted file-state backup for App VM `/data` paths.
- Off-box target: Cloudflare R2, Backblaze B2, S3, or equivalent.
- Retention policy.
- Restore script/runbook.
- Restore drill notes.

Minimum backup set:

```txt
pgbackrest repository for Postgres
/data/pi-sessions
/data/uploads or per-app state
/data/apps/<app>/...
/data/workspaces, with Vercel/local-mode caveat
Kamal config snapshot without secret values
cloudflared tunnel identifiers/config notes
Tailscale recovery notes
```

Acceptance checks:

- Fresh VM restore rehearsal succeeds or is explicitly scoped to DB + file state available today.
- Test restore happens without touching live DB by default.
- Live restore requires explicit confirmation.
- Backup failure sends alert.
- A human can find last successful DB backup and file backup timestamp.

### Stage 5 — Production cutover for boring full-app

Deliverables:

- Production domain through Cloudflare Tunnel.
- Production GitHub environment/secrets.
- Production Postgres credentials.
- Production backup schedule.
- Maintenance/cutover checklist.
- Monitoring/alert recipients.

Cutover sequence:

1. Freeze writes or schedule low-traffic window.
2. Trigger final backup/export on old provider.
3. Import into self-hosted Postgres.
4. Run migrations if needed.
5. Start VM app with production env.
6. Run smoke tests.
7. Switch Cloudflare route/DNS.
8. Run first production pgbackrest backup and file-state backup.
9. Test-restore the first production backup to isolated location.
10. Monitor logs and health.
11. Keep old provider paused but recoverable until confidence window ends.

Acceptance checks:

- Health/auth/workspace/agent smoke passes.
- First production DB backup completes.
- First production file-state backup completes.
- First production backup restore test passes before old provider is decommissioned.
- Cost delta is recorded.

### Stage 6 — Local sandbox worker pilot

Do this only after production hosting is boring.

Deliverables:

- Separate worker container/role.
- bwrap mode enabled only for one staging workspace or test app.
- Resource limits and env allowlist.
- Egress policy decision.
- Worker logs and command audit trail.
- Kill/cleanup stale execution handles.
- Manual rollback to Vercel sandbox documented.

Acceptance checks:

- Web container rejects local/direct shell execution in client production unless explicitly approved.
- Worker cannot access DB admin credentials.
- Worker cannot access Docker socket.
- Worker cannot write outside allowed workspace/session roots.
- Resource abuse test cannot take down Postgres/web under expected thresholds.
- Actual agent workspace files and chat sessions survive deploy/restart in local/worker mode.
- Bad worker config/health/auth fails closed.

### Stage 7 — Child app onboarding

Deliverables per app:

- App manifest.
- Kamal service/role config.
- Domain/tunnel route.
- Secrets inventory.
- State inventory.
- Healthcheck.
- Resource limits.
- DB/user/connection limits.
- Backup inclusion.
- Restore test.
- Smoke test.

Acceptance:

- No child app is considered production until restore has been tested.
- App-level state is declared before deploy.
- Failure of one child app deploy does not affect other running apps.
- Resource exhaustion by one child app has a configured limit and alert.
- Different external clients do not share a VM until isolation/quotas/incident process are proven.

### Stage 8 — Optional `boring-host` wrapper

Not v1. Build only after at least 2-3 manual/Kamal deployments reveal stable duplication.

MVP commands:

```bash
boring-host doctor
boring-host init-vm
boring-host add-app
boring-host deploy APP
boring-host backup APP
boring-host restore APP
boring-host logs APP
boring-host status
```

Rules:

- Wrapper emits inspectable Kamal/Cloudflare/Tailscale/Postgres/backup config.
- Wrapper does not hide state locations.
- Wrapper has an app allowlist.
- Wrapper has no destructive delete without explicit flags and confirmation.
- Manual Kamal/Ansible escape hatch remains documented.

Later optional:

- signed GitHub webhook deploys;
- local deploy queue;
- commit status reporting;
- Cloudflare DNS automation;
- generated Dockerfiles for simple app types;
- SQLite-aware backups for tiny apps.

## Security model

### Secrets

Required separation:

- deploy-time secrets: registry, Cloudflare, Tailscale OAuth, 1Password/GitHub tokens;
- runtime app secrets: DB URL, auth secret, encryption key, mail, model providers;
- DB admin/migration/runtime secrets separated;
- worker secrets: minimal model/tool credentials only;
- backup secrets: off-box storage credentials and encryption key.

Rules:

- No secrets in repo.
- No secrets printed in logs.
- No DB admin secrets in web runtime unless absolutely required.
- No migration credentials in normal web request runtime if avoidable.
- No DB secrets in sandbox worker unless an app explicitly needs a scoped credential.
- Rotate secrets after initial bootstrap if they passed through local terminals.

### Network

Rules:

- Public inbound firewall closed.
- Tailscale SSH only for admin.
- GitHub deploys through Tailscale OAuth with constrained tags.
- Database binds localhost/Tailscale only and is restricted by `pg_hba.conf`.
- Cloudflare Tunnel is the only public ingress path.

### Containers

Rules:

- `no-new-privileges:true` where compatible.
- No privileged containers for app or worker.
- No Docker socket mounts into app or worker.
- Explicit healthchecks.
- Explicit restart policy/systemd supervision.
- Separate web and worker roles before local sandbox execution.
- Per-app CPU/memory/pid/log limits for child apps.

## Observability and operations

Minimum commands/runbooks:

```bash
kamal app logs
kamal app exec
kamal proxy logs
systemctl status cloudflared
systemctl status tailscaled
systemctl status postgresql@<major>-main
pgbackrest --stanza=<app> info
restore test latest
postgres health
check public URL
check Tailscale SSH
unattended-upgrades status / last notification
```

Minimum alerts:

- DB backup failed;
- file backup failed;
- WAL archive stopped;
- disk above threshold;
- app health failing;
- Postgres down;
- cloudflared down;
- Tailscale down or node-key expiry risk;
- unattended-upgrades failed;
- reboot required or reboot completed;
- restore drill overdue.

Minimum dashboards/logs:

- app logs;
- deploy history;
- backup history;
- disk usage;
- CPU/RAM;
- Postgres size;
- WAL/archive growth;
- slow query/lock waits;
- worker resource usage if local sandbox enabled.

## Capacity planning

Track:

- Docker image build time;
- deploy rollout time;
- Postgres memory/disk;
- WAL/archive growth;
- workspace/session disk growth;
- sandbox CPU/RAM spikes;
- concurrent app count;
- Cloudflare Tunnel health;
- backup duration and size.

Upgrade path:

1. combined VM -> App VM + DB VM;
2. bigger App VM or DB VM;
3. separate sandbox worker VM;
4. split high-value clients onto dedicated VM pairs;
5. only then consider multi-host orchestration.

## App manifest proposal — future appendix, not v1

Use this later for child apps and eventual `boring-host` wrapper.

```yaml
apiVersion: boring.host/v1
kind: App
metadata:
  name: example
spec:
  repo: github.com/org/example
  branch: main
  domain: example.com
  image: ghcr.io/org/example
  build:
    dockerfile: Dockerfile
    context: .
  runtime:
    port: 3000
    healthcheck: /health
    resources:
      memory: 512m
      cpus: 0.5
      pids: 256
    env:
      clear:
        NODE_ENV: production
      secret:
        - DATABASE_URL
        - AUTH_SECRET
  state:
    postgres:
      database: example
      runtimeUser: example_runtime
      migrationUser: example_migrator
    volumes:
      - name: uploads
        hostPath: /data/apps/example/uploads
        containerPath: /app/uploads
  backup:
    include:
      - postgres:example
      - volume:uploads
  ingress:
    cloudflareTunnel: true
  deploy:
    strategy: kamal
    serialize: true
```

## Implementation task graph, once approved

Do not start these until the plan is approved.

1. Add docs for `boring-vm-single-tenant` contract.
2. Add DB VM Ansible-inspired spec/runbook: PostgreSQL, pgbackrest, unattended-upgrades.
3. Add App VM spec/runbook: Docker, Kamal, cloudflared, Tailscale, file-state backups.
4. Add `apps/full-app` Kamal config for staging VM.
5. Add GitHub Actions deploy workflow for staging VM.
6. Add backup/restore scripts and runbooks.
7. Add post-deploy smoke for VM target.
8. Add staging migration rehearsal docs.
9. Add production cutover checklist.
10. Add local sandbox worker design doc.
11. Implement worker split only after design approval.
12. Add child app manifest/spec only after first deployment works.
13. Consider `boring-host` wrapper only after repeated manual deployments.

## Open questions for Julien

1. Which provider first: Hetzner, Infomaniak, or another VM provider?
2. For first serious client, do we choose App VM + DB VM by default?
3. For personal/internal boring apps, is combined single VM acceptable?
4. Which off-box backup target do you prefer: R2, B2, S3, or existing Healio-style storage?
5. Secrets source: 1Password like Healio, GitHub environments, or SOPS/age?
6. Do we accept keeping Vercel sandbox for the first VM migration, with the durability/cost caveat?
7. Which app should be first canary: `apps/full-app`, a child app, or a private internal app?
8. What RPO/RTO do we promise for client apps?
9. Is temporary maintenance downtime acceptable during first cutover?
10. Are client apps healthcare/regulated enough to require LUKS and immutable backup replica from day one?
11. Should child apps get separate DBs/users by default? Recommended answer: yes.
12. Who receives backup/update/security alerts?
13. Should app dependency rollup PRs be weekly with manual merge, or can low-risk patch updates auto-merge to staging?

## Thermo-nuclear self-review

### Strong simplifications

- Use Kamal/GitHub Actions first; postpone SingleServer-style webhook daemon.
- Deploy PostgreSQL explicitly using Healio's native PG + pgbackrest model; do not hide it in a vague accessory.
- Keep Vercel sandbox initially; postpone local sandbox until hosting/DB/backups are stable.
- Prefer App VM + DB VM for serious clients; allow combined VM only with explicit blast-radius acceptance.
- Treat every stateful app as requiring a restore drill before production.
- Build a wrapper only after manual repetition proves the abstraction.

### Blockers before production

- Native Postgres deployed and reachable only privately.
- pgbackrest backup exists, WAL archive flows, and test restore passes.
- File-state backup exists and restore passes.
- Client-side encrypted backups with key recovery.
- Clear ownership of secrets and rotations.
- Confirmed Cloudflare/Tailscale recovery process.
- Disk monitoring and backup failure alerts.
- unattended-upgrades policy and notifications.
- Post-deploy smoke.
- Explicit sandbox decision and Vercel durability caveat.

### Blockers before local sandbox

- Separate worker role/container.
- Web role cannot run local/direct shell execution accidentally.
- No Docker socket.
- No DB/admin secrets.
- Resource limits.
- Egress decision.
- Command audit trail.
- Manual rollback to Vercel sandbox only; no automatic fallback.

## Approval criteria

This plan is ready for implementation when:

- Julien accepts the single-tenant VM contract and chooses App VM + DB VM vs combined VM for the first canary.
- Backup target and immutable-replica requirement are chosen.
- Backup encryption key custody is chosen.
- Secrets source is chosen.
- First canary app is chosen.
- Vercel-sandbox-first vs local-worker-first is decided.
- RPO/RTO target is set.
- Alert recipient/owner is named.
- A staging VM provider/size is selected.
- App dependency rollup policy is accepted.
