# Remote bwrap worker data backup

Scope: `boring-sandbox-worker` Fly volume `worker_workspace_data` mounted at `/data`.

## Policy

- Fly scheduled snapshots stay enabled for the worker volume.
- Snapshot retention is enforced at **14 days**.
- `.github/workflows/fly-worker-volume-backup.yml` runs daily and can be run manually.
- The workflow calls `apps/full-app/scripts/fly-worker-volume-backup.mjs`, which:
  1. finds active volumes named `worker_workspace_data` on `boring-sandbox-worker`,
  2. enables scheduled snapshots,
  3. applies retention,
  4. creates an explicit snapshot unless disabled by manual input,
  5. lists snapshots for audit output.

## Manual snapshot

```bash
export FLY_API_TOKEN=...
pnpm --filter full-app run backup:fly-worker-volume
```

Useful overrides:

```bash
FLY_CREATE_VOLUME_SNAPSHOT=false pnpm --filter full-app run backup:fly-worker-volume
FLY_SNAPSHOT_RETENTION_DAYS=30 pnpm --filter full-app run backup:fly-worker-volume
```

## Inspect snapshots

```bash
flyctl volumes list --app boring-sandbox-worker
flyctl volumes snapshots list vol_42k0271392690g84 --app boring-sandbox-worker
```

## Restore shape

Do not overwrite or delete the live volume during restore. Create a new volume from a snapshot, attach it to a new worker/test machine, verify data, then plan a controlled cutover.

```bash
flyctl volumes create worker_workspace_data_restore \
  --app boring-sandbox-worker \
  --region cdg \
  --size 10 \
  --snapshot-id <snapshot-id>
```

After restore verification, switch machines deliberately. Never destroy `worker_workspace_data` without explicit written approval.
