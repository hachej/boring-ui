# Self-host Ansible scaffold

Status: scaffold only. Do not run against production until the owner decisions in `docs/plans/self-host-app-db-vercel-sandbox-todo.md` are complete.

This directory follows the approved split:

```txt
Provider UI / Terraform / OpenTofu: create VMs/disks/firewall/DNS/buckets when useful
Ansible: configure App VM and DB VM after they exist
Kamal/deployd: deploy verified full-app images from the App VM
```

## Safety rules

- No secrets in this directory.
- Do not commit real inventories with private hostnames, tokens, passwords, or healthcheck URLs.
- Copy `inventory/production.yml.template` and `host_vars/*.template.yml` outside git or into ignored local files before real use.
- Keep DB access private: App VM Tailscale IP only in `pg_hba.conf`.
- LUKS/data-disk provisioning is intentionally not implemented in this scaffold; add it only after provider/disk decisions are final.
- pgbackrest stanza creation/backups are gated by `pgbackrest_enabled: true`.
- The backup role configures pgbackrest, WAL archiving, checks, and cron; the first full backup and restore drill are operator-run steps documented in `../../docs/deployment/self-host/runbooks/r2-pgbackrest-backups.md`.

## Files

- `playbooks/app-vm.yml` — App VM: common, Docker, cloudflared.
- `playbooks/db-vm.yml` — DB VM: common, native PostgreSQL.
- `playbooks/db-backups.yml` — DB VM: pgbackrest, WAL archive checks, backup cron.
- `inventory/production.yml.template` — shape only.
- `group_vars/*.yml` — safe defaults/placeholders.
- `host_vars/*.template.yml` — per-host placeholders.

## Local syntax check

```bash
cd infra/ansible
ansible-galaxy collection install -r requirements.yml
ansible-playbook --syntax-check -i inventory/production.yml.template playbooks/app-vm.yml
ansible-playbook --syntax-check -i inventory/production.yml.template playbooks/db-vm.yml
ansible-playbook --syntax-check -i inventory/production.yml.template playbooks/db-backups.yml
```
