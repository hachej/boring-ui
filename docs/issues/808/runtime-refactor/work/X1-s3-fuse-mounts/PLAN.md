> **Work-package status:** follow this package’s linked Bead/GitHub tracker. It is
> not part of Decision 25’s static P0→N1 critical path, but Decision 25 does not
> cancel it. AgentHost/D1-dependent passages must be recut before dispatch.

# X1-s3-fuse-mounts — Plan

Status: post-v1; not a #391 v1 exit gate. Requires E1, P5a, and a named
native-mount consumer before implementation resumes.

> Phase: Phase X1 — S3/FUSE mounts for boring-sandbox environments (bash lane; after Phase 2, Phase 5, **and E1**) · Work order: [TODO.md](TODO.md) · Handoff: [HANDOFF.md](HANDOFF.md)
> Ordering authority: [INDEX.md](../../../../391/runtime-refactor/INDEX.md) · Vision: [VISION.md](../../../../391/runtime-refactor/VISION.md)

## Governing architecture
- [00-global-isa.md](../../../../391/runtime-refactor/architecture/00-global-isa.md) — invariant 4 (partial exposure with shell is physical), invariant 14 (secrets stay host-side, never enter the sandbox process or model transcript), invariant 15 (EU-sovereign defaults).
- [02-boring-bash-environment.md](../../../../391/runtime-refactor/architecture/02-boring-bash-environment.md) — package layers; the `@hachej/boring-sandbox/mounts` export (FUSE-S3 drivers + per-session lifecycle) and provider capability facts.
- [09-environments-attachable.md](../../../../391/runtime-refactor/architecture/09-environments-attachable.md) — attachments, host-owned auth-gated contributions, methodless facts, host-supplied `mountPath`, and no-leak conformance.
- [10-sandbox-deployment-eu.md](../../../../391/runtime-refactor/architecture/10-sandbox-deployment-eu.md) — the deployment counterpart: isolation tiers, the FUSE×isolation matrix, EU providers, the no-inotify contract, and the 12 Decisions-To-Lock.

## Design context
Phase X1 is the mount subsystem of `@hachej/boring-sandbox` (created by P2): S3-backed filesystems that appear as a real directory inside a sandbox, so an agent's environment (E1) can be an object-store prefix. It dispatches after P2, P5, and E1 because its shipped attachment/conformance path consumes the E1 `Environment`/`EnvironmentAttachment` contract. It rides the three-package stack — providers/mounts live in `@hachej/boring-sandbox` (`./mounts` export, server-scoped, `node:*`), environments in `boring-bash`/`boring-agent` contracts; boring-bash imports the mount values, agent imports neither. The spine is the X1 decision set: concrete `rclone mount --vfs-cache-mode full`; HOST-SIDE mount then bwrap `--bind`/`--ro-bind` (never expose `/dev/fuse`/`fusermount3`/creds to the sandbox; gVisor-portable); per-session lifecycle with a readiness gate + lazy-unmount + reap; short-lived prefix-scoped STS brokered into the mount-process env only. Capability fact `mounts.fuseS3: reported | unknown` fails closed (`vercel` reports unsupported). Mounts are scoped to the `user` filesystem only — governed filesystems (`company_context`) are never raw-mounted. EU-sovereign defaults (OVH/Scaleway/MinIO); MinIO in CI.

Verified current repo reality: this prep worktree does not yet contain `packages/boring-sandbox` (P2 creates it). Existing bwrap code is still at `packages/agent/src/server/sandbox/bwrap/buildBwrapArgs.ts`; after P2 BBP2-003 it must live under `packages/boring-sandbox/src/providers/bwrap/*`, and X1 must reuse that moved arg builder rather than forking another bwrap path. Current #416 shapes already have `FilesystemBinding.mountPath`, and the existing no-leak suite is `checkReadonlyProjectionConformance`; E1 generalizes those into attachments, auth-gated contributions, and methodless facts. X1 never receives raw prepared handles.

Benchmark evidence: `/home/ubuntu/projects/x1-bench/report.md` (`2026-07-05 12:22 UTC`) recorded rclone-FUSE-over-MinIO numbers, but also records PATH/ordering defects affecting semantic checks. Its numeric results are provisional comparison data, not locked acceptance thresholds. BBX1-007 must first re-verify readonly/backend-down semantics and BBX1-009 must publish a corrected repeatable run before reviewers lock any numeric threshold.

## Deliverables
- concrete **rclone** mount module (`--vfs-cache-mode full`, EU-endpoint-first OVH/Scaleway/MinIO); no generic driver interface until a second real mount implementation lands; mountpoint-s3 deferred (AWS-only/RO);
- per-session mount lifecycle (own process/VFS cache/scoped creds/isolated teardown; share only immutable RO datasets), readiness gate (`/proc/self/mountinfo` + stat/readdir probe before bind), lazy-unmount + explicit process reap, stale `ENOTCONN`/`ESTALE` re-mount vs transient `EIO` retry;
- HOST-SIDE mount then bwrap `--bind`/`--ro-bind` into the sandbox (gVisor-portable) — `/dev/fuse`/`fusermount3`/creds never exposed to the sandbox;
- capability fact `mounts.fuseS3: reported | unknown` (fail closed; `vercel`-PROXY reports unsupported);
- credential broker: short-lived prefix-scoped STS (AWS session policy `s3:prefix`; Scaleway/MinIO STS; OVH per-container) injected into the mount-process env only, refreshed via `credential_process`; the sandbox receives a directory handle, never a secret (invariant 14);
- S3-backed `Environment` integration + a readonly-S3 no-leak conformance mount + a `bash-sees-mount == file-routes-see-mount` source-of-truth test; default write-back = rclone VFS-full; fuse-overlayfs publish-on-save variant deferred (never kernel overlayfs over FUSE);
- BBX1-009 corrected benchmark harness and raw results; the existing warm `rg`, append, git, and sequential-write numbers remain provisional until the corrected BBX1-007 semantics and repeatable performance run pass review.

## Exit criteria
- a readonly S3 mount passes the no-leak suite;
- `bash`-visible files == file-route-visible files over the same mount;
- no credential is readable inside the sandbox;
- the EU-endpoint matrix (MinIO in CI) is green with no US-hosted default (invariant 15);
- `mounts.fuseS3: unknown`/`vercel` fail closed;
- `bench:mounts` publishes corrected raw results and methodology; numeric thresholds become binding only in a reviewed follow-up after the flawed baseline is rerun.
