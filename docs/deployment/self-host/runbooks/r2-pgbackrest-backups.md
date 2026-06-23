# Cloudflare R2 + pgbackrest backup runbook

Status: operator runbook scaffold. Do not paste credentials into this file or into shell history.

This follows the Healio backup shape: pgbackrest continuous WAL archiving + scheduled physical backups to an S3-compatible object store, with pgbackrest repo encryption as defense in depth.

## Current decision

- Backup target: Cloudflare R2 EU jurisdiction bucket `boring-ui-full-app-pgbackrest-eu`.
- Bucket create smoke: `wrangler r2 bucket create boring-ui-full-app-pgbackrest-eu --jurisdiction eu` succeeded from the local operator machine.
- Remote object write smoke: `wrangler r2 object put ... --remote --jurisdiction eu` succeeded. Immediate readback hit Cloudflare API rate limiting (`429` / code `971`), so re-run readback after the rate window clears.
- Fallback: another EU-compatible S3 target with equivalent durability and access controls if restore drills or immutability requirements fail on R2.
- Mandatory encryption: pgbackrest `repo1-cipher-type=aes-256-cbc` and `PGBACKREST_CIPHER_PASS` from vault plus offline recovery copy.
- Initial retention: 4 weekly full backups + 14 daily differential backups.

## Cloudflare R2 checks before production

Verify in the Cloudflare account/docs before enabling production backups:

- The S3 endpoint is the jurisdiction-specific EU endpoint for the account.
- Access key is scoped only to bucket `boring-ui-full-app-pgbackrest-eu` and only to the repo operations needed by pgbackrest.
- Lifecycle/retention policy is explicit.
- Object-lock/immutable replica story is decided. If R2 cannot provide the required immutable replica behavior, add a second EU backup target before public production.

Record only references, not values, in the environment inventory:

- bucket/repo name reference;
- endpoint reference;
- access key vault item;
- cipher pass vault item;
- offline cipher pass copy location;
- backup healthcheck URL vault item.

## Required vault items

| Secret | Purpose |
| --- | --- |
| `PGBACKREST_S3_BUCKET` | R2 bucket/repo name |
| `PGBACKREST_S3_ENDPOINT` | R2 EU jurisdiction endpoint |
| `PGBACKREST_S3_REGION` | Usually `auto` for R2 unless verified otherwise |
| `PGBACKREST_S3_KEY` | Scoped R2 access key |
| `PGBACKREST_S3_SECRET` | Scoped R2 secret |
| `PGBACKREST_CIPHER_PASS` | pgbackrest repo encryption passphrase |
| `HEALTHCHECK_BACKUP_FULL_URL` | Slack/healthcheck ping for full backup |
| `HEALTHCHECK_BACKUP_DIFF_URL` | Slack/healthcheck ping for differential backup |

## Ansible enablement

The Ansible role is fail-closed: `pgbackrest_enabled` defaults false and the role asserts that object-store credentials and `pgbackrest_cipher_pass` exist before writing config.

Operator flow:

1. Fill real DB host vars from vault outside git.
2. Set `pgbackrest_enabled: true` only after R2 EU endpoint, scoped S3 credentials, and `PGBACKREST_CIPHER_PASS` are ready.
3. Run the DB backup playbook against the DB VM inventory:

   ```bash
   cd infra/ansible
   ansible-playbook -i inventory/production.yml playbooks/db-backups.yml
   ```

4. Confirm the role ran a successful final `pgbackrest check` after enabling WAL archiving.

## Initial full backup

The current Ansible role installs config, creates/checks the stanza, enables WAL archiving, verifies `pgbackrest check`, and installs cron. It does **not** run the first full backup automatically.

Run the initial full backup manually/operator-controlled after the playbook succeeds:

```bash
sudo -iu postgres pgbackrest --stanza=boring_full_app backup --type=full
sudo -iu postgres pgbackrest --stanza=boring_full_app info
```

Then confirm:

- `archive_command` succeeds in PostgreSQL logs;
- `pgbackrest info` shows a full backup;
- WAL segments are archiving continuously;
- Slack/healthcheck pings work;
- DB disk is not accumulating unarchived WAL.

## Restore drill

Do not run restore tests against the production data directory.

Minimum drill before public production:

1. Provision an isolated DB restore VM or isolated restore path.
2. Install matching PostgreSQL major version and pgbackrest.
3. Restore from the R2 repo using the vault/offline cipher pass.
4. Start PostgreSQL on the isolated restore target.
5. Run app-level read checks against the restored DB.
6. Record restore timestamp, selected backup set, elapsed restore time, and any manual steps.

Passing a restore drill is required before calling DB backups production-ready.

## Failure rules

- Lost `PGBACKREST_CIPHER_PASS` means encrypted backups are unrecoverable.
- If `pgbackrest check` fails, stop deployment/cutover and fix backups first.
- If WAL archive fails after `archive_mode=on`, investigate immediately; unarchived WAL can fill the DB disk.
- Do not delete old provider backups until at least one restore drill from R2 has passed.
