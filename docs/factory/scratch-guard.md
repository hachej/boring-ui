# Opt-in factory scratch guard

`ops/factory-scratch/scratch_guard.py` is a Linux operator utility for two
bounded jobs:

1. fail before a long run when a selected filesystem reaches a configured inode
   percentage or when `TMPDIR` / the pnpm store resolves to `tmpfs` or `ramfs`;
2. dry-run or age direct children of a **new, private, explicitly marked**
   boring-ui scratch root.

It is not a generic `/tmp` cleaner. It does not discover roots, install a timer,
or change the host unless an operator explicitly runs an init or `clean --apply`
command. Never point it at an existing directory. Existing build, workspace,
session, plugin, and PR #1288 stores are outside this protocol.

## Optional installation

Review the checked-in file, then install a copy only if this host should opt in:

```bash
sudo install -m 0755 ops/factory-scratch/scratch_guard.py /usr/local/bin/scratch-guard
scratch-guard --help
```

Rollback is removal of that copied executable and any operator-created scratch
root. This repository installs no cron job, systemd unit, or host policy.

## Preflight before a long run

Choose disk-backed locations explicitly. The command exits `2` when inode usage
is at or above the limit, when `TMPDIR` is tmpfs/ramfs, or when the supplied pnpm
store is tmpfs/ramfs. Invalid or unavailable inputs exit `3`.

```bash
export TMPDIR=/var/tmp/boring-ui-tmp
export PNPM_STORE_DIR=/var/cache/boring-ui/pnpm-store
install -d -m 0700 "$TMPDIR" "$PNPM_STORE_DIR"
scratch-guard check --path "$PWD" --path "$TMPDIR" --path "$PNPM_STORE_DIR" \
  --inode-threshold 85 --tmpdir "$TMPDIR" --pnpm-store "$PNPM_STORE_DIR"
```

The filesystem match comes from `/proc/self/mountinfo` and uses the longest
matching mountpoint. If the pnpm store is omitted or a filesystem cannot be
identified, the command prints a warning rather than pretending the location is
safe. Supply `--pnpm-store` (or `PNPM_STORE_DIR`) to make that check meaningful.

## Create a dedicated marked root

`init-root` refuses an existing path and creates a private mode-0700 directory.
Initialization stages protocol files privately and exposes the final path with one
rename; a failed setup removes only its own private staging directory so the exact
command can be retried. The cleaner later refuses roots that are symlinks,
non-canonical, owned by a different uid, group/world writable, or missing the
exact root marker.

```bash
scratch-guard init-root /var/tmp/boring-ui-owned-scratch
scratch-guard init-entry /var/tmp/boring-ui-owned-scratch run-2026-08-17-a
```

A producer using an entry must:

- hold a shared or exclusive `flock` on `.boring-active.lock` for its entire
  active lifetime; and
- refresh `.boring-heartbeat` while active.

A producer that cannot honor both rules must not use this aging protocol. The
cleaner treats missing, malformed, replaced, live, locked, symlinked, mounted (including same-device
bind mounts), cross-filesystem, or otherwise ambiguous entries as retained. It examines direct children only
and requires the entry marker to match the root id and child name exactly.

Example producer lock (the heartbeat update happens while the lock is held):

```bash
entry=/var/tmp/boring-ui-owned-scratch/run-2026-08-17-a
mkdir -m 0700 "$entry/tmp"
(
  flock -s 9
  touch "$entry/.boring-heartbeat"
  exec env TMPDIR="$entry/tmp" your-long-running-command
) 9<>"$entry/.boring-active.lock"
```

## Inspect first, then apply deliberately

The default is dry-run; eligible entries print `WOULD-DELETE` and nothing is
renamed or removed:

```bash
scratch-guard clean --root /var/tmp/boring-ui-owned-scratch --stale-seconds 86400
```

After inspecting that output, the explicit mutation command is:

```bash
scratch-guard clean --root /var/tmp/boring-ui-owned-scratch \
  --stale-seconds 86400 --apply
```

For an eligible entry, the utility holds the exclusive lease lock, rechecks the
lease and heartbeat, rejects symlinks/filesystem boundaries, atomically renames
the direct child to a unique quarantine name within the same private root, then
removes that quarantine. A failed removal is retained and reported; ambiguous
quarantines are never retried automatically. This is cooperative safety, not a
way to clean paths written by producers that ignore the lock protocol.

## Repository proof (fixtures only)

The test creates and deletes only its own temporary fixture root:

```bash
python3 -m unittest -v ops/factory-scratch/test_scratch_guard.py
python3 -m py_compile ops/factory-scratch/scratch_guard.py \
  ops/factory-scratch/test_scratch_guard.py
git diff --check
```
