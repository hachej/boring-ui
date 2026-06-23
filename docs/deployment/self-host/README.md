# Self-hosted full-app deployment

Status: planning and implementation workspace for the first public `apps/full-app` self-host deployment.

Target shape:

```txt
GitHub Actions builds only -> GHCR image/digest/provenance
GitHub prod-* tag webhook -> Cloudflare Tunnel -> deployd on App VM
App VM -> Kamal deploys verified image digest
App VM -> DB VM over Tailscale
DB VM -> native PostgreSQL + pgbackrest
Agent execution -> Vercel Sandbox for now
```

Start with these artifacts:

- [Focused plan](../../plans/self-host-app-db-with-vercel-sandbox-plan.md)
- [Detailed todo](../../plans/self-host-app-db-vercel-sandbox-todo.md)
- [Remote sandbox analysis](../../plans/remote-sandbox-self-host-analysis.md)
- [Broader deployment plan](../../plans/self-host-vm-boring-deploy-plan.md)
- [Environment inventory template](environment-inventory.template.md)
- [Secrets inventory template](secrets-inventory.template.md)
- [Owner decisions](owner-decisions.md)
- [No-domain v0 deploy runbook](runbooks/no-domain-v0-deploy.md)
- [Cloudflare R2 + pgbackrest backup runbook](runbooks/r2-pgbackrest-backups.md)

## Hard decisions already made

- Public `full-app` is the first target.
- App VM and DB VM are split.
- No hosted staging for v1; local/dev rehearsal only.
- GitHub Actions must not hold production runtime, DB, backup, Tailscale, Vercel, or Kamal secrets.
- Production deploys are triggered by protected `prod-*` tags.
- App VM `deployd` verifies webhook signature, actor, repo/ref, commit ancestry, CI, provenance, and immutable digest.
- App container must run as non-root.
- PostgreSQL runs natively on DB VM.
- pgbackrest is the DB backup/PITR system.
- Backup target is Cloudflare R2 if an EU jurisdiction bucket is available; pgbackrest repo encryption is mandatory even if R2 encrypts at rest.
- Vercel Sandbox remains the remote execution backend for now.
- Alerts go to Slack via a vault-managed webhook.
- Cloudflare credentials live in the vault; no public domain is required for the first no-domain v0.
- VMs use OVH France / Gravelines with small initial sizes unless final provisioning constraints require adjustment.
- VM bootstrap joins the current owner Tailscale network.

## Non-goals for v1

- No full SingleServer clone.
- No self-hosted sandbox backend yet.
- No shared VM across unrelated clients.
- No Dockerized Postgres for public/client production.
