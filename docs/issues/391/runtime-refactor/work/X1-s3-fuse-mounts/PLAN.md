# X1-s3-fuse-mounts — Plan

> Phase: Phase X1 — S3/FUSE mounts for boring-sandbox environments (bash lane; after Phase 2 **and** Phase 5) · Work order: [TODO.md](./TODO.md) · Handoff: [HANDOFF.md](./HANDOFF.md)
> Ordering authority: [INDEX.md](../../INDEX.md) · Vision: [VISION.md](../../VISION.md)

## Governing architecture
- [00-global-isa.md](../../architecture/00-global-isa.md) — invariant 4 (partial exposure with shell is physical), invariant 14 (secrets stay host-side, never enter the sandbox process or model transcript), invariant 15 (EU-sovereign defaults).
- [02-boring-bash-environment.md](../../architecture/02-boring-bash-environment.md) — package layers; the `@hachej/boring-sandbox/mounts` export (FUSE-S3 drivers + per-session lifecycle) and provider capability facts.
- [09-environments-attachable.md](../../architecture/09-environments-attachable.md) — the `Environment`/`EnvironmentAttachment`/`ResolvedEnvironments` model; host-supplied `mountPath` per attachment; the no-leak conformance suite runs against every delivered mount.
- [10-sandbox-deployment-eu.md](../../architecture/10-sandbox-deployment-eu.md) — the deployment counterpart: isolation tiers, the FUSE×isolation matrix, EU providers, the no-inotify contract, and the 12 Decisions-To-Lock.

## Design context
Phase X1 is the mount subsystem of `@hachej/boring-sandbox` (created by P2): S3-backed filesystems that appear as a real directory inside a sandbox, so an agent's environment (E1) can be an object-store prefix. It rides the three-package stack — providers/mounts live in `@hachej/boring-sandbox` (`./mounts` export, server-scoped, `node:*`), environments in `boring-bash`/`boring-agent` contracts; boring-bash imports the mount values, agent imports neither. The spine is the 10 LOCKED DECISIONS: one `rclone mount --vfs-cache-mode full` driver behind a thin `mount(bucket, prefix, creds, ro) -> dir` interface; HOST-SIDE mount then bwrap `--bind`/`--ro-bind` (never expose `/dev/fuse`/`fusermount3`/creds to the sandbox; gVisor-portable); per-session lifecycle with a readiness gate + lazy-unmount + reap; short-lived prefix-scoped STS brokered into the mount-process env only. Capability fact `mounts.fuseS3: reported | unknown` fails closed (`vercel` reports unsupported). Mounts are scoped to the `user` filesystem only — governed filesystems (`company_context`) are never raw-mounted. EU-sovereign defaults (OVH/Scaleway/MinIO); MinIO in CI.

## Deliverables
- thin driver interface `mount(bucket, prefix, creds, ro) -> dir` with a single **rclone** driver (`--vfs-cache-mode full`, EU-endpoint-first OVH/Scaleway/MinIO); mountpoint-s3 deferred (AWS-only/RO);
- per-session mount lifecycle (own process/VFS cache/scoped creds/isolated teardown; share only immutable RO datasets), readiness gate (`/proc/self/mountinfo` + stat/readdir probe before bind), lazy-unmount + explicit process reap, stale `ENOTCONN`/`ESTALE` re-mount vs transient `EIO` retry;
- HOST-SIDE mount then bwrap `--bind`/`--ro-bind` into the sandbox (gVisor-portable) — `/dev/fuse`/`fusermount3`/creds never exposed to the sandbox;
- capability fact `mounts.fuseS3: reported | unknown` (fail closed; `vercel`-PROXY reports unsupported);
- credential broker: short-lived prefix-scoped STS (AWS session policy `s3:prefix`; Scaleway/MinIO STS; OVH per-container) injected into the mount-process env only, refreshed via `credential_process`; the sandbox receives a directory handle, never a secret (invariant 14);
- S3-backed `Environment` integration + a readonly-S3 no-leak conformance mount + a `bash-sees-mount == file-routes-see-mount` source-of-truth test; default write-back = rclone VFS-full, optional fuse-overlayfs publish-on-save variant (never kernel overlayfs over FUSE).

## Exit criteria
- a readonly S3 mount passes the no-leak suite;
- `bash`-visible files == file-route-visible files over the same mount;
- no credential is readable inside the sandbox;
- the EU-endpoint matrix (MinIO in CI) is green with no US-hosted default (invariant 15);
- `mounts.fuseS3: unknown`/`vercel` fail closed.
