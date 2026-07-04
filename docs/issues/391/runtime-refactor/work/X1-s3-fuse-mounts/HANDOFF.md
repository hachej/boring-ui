# X1-s3-fuse-mounts — Handoff checklist

Derived strictly from [TODO.md](./TODO.md) and [PLAN.md](./PLAN.md). Tick each before calling this package done. Invent nothing.

## Prerequisites (packages + gates)
- [ ] P2-sandbox-providers merged — [../P2-sandbox-providers/HANDOFF.md](../P2-sandbox-providers/HANDOFF.md)
- [ ] P5-provisioning-secrets merged — [../P5-provisioning-secrets/HANDOFF.md](../P5-provisioning-secrets/HANDOFF.md)
- [ ] P2 (`@hachej/boring-sandbox` + providers) present — if the package is absent, **STOP and report**
- [ ] P5 (capability-fact `reported | unknown` fail-closed rule + host-side secrets-broker BBP5-007) present — else **STOP and report**

## Beads
- [ ] BBX1-001 — Concrete rclone mount module in `boring-sandbox/src/mounts`
- [ ] BBX1-002 — Per-session mount lifecycle manager (readiness gate, lazy-unmount + reap, stale recovery)
- [ ] BBX1-003 — Host-side mount → sandbox bind (bwrap; gVisor-portable)
- [ ] BBX1-004 — Capability fact `mounts.fuseS3: reported | unknown` + mount-type facts (fail closed; vercel reports unsupported)
- [ ] BBX1-005 — Credential broker: short-lived prefix-scoped STS into the mount-process env only
- [ ] BBX1-006 — S3-backed `Environment` integration + conformance + source-of-truth test
- [ ] BBX1-007 — EU-endpoint matrix + secrets negative test (MinIO in CI)
- [ ] BBX1-009 — rclone-FUSE performance benchmark (edit/build loop; exit criterion has numbers)
- [ ] BBX1-008 — fuse-overlayfs write-back variant deferred out of X1

## Verification commands
- [ ] `pnpm --filter @hachej/boring-sandbox run build`
- [ ] `pnpm --filter @hachej/boring-sandbox run typecheck`
- [ ] `pnpm --filter @hachej/boring-sandbox run check:invariants`
- [ ] `pnpm --filter @hachej/boring-sandbox run test`
- [ ] `pnpm --filter @hachej/boring-sandbox run test:mounts:eu`
- [ ] `pnpm --filter @hachej/boring-bash run test`
- [ ] `pnpm --filter @hachej/boring-bash run check:invariants`
- [ ] `pnpm lint:invariants`
- [ ] `pnpm audit:imports`
- [ ] `pnpm typecheck`

## Review gates
- [ ] P2 (`@hachej/boring-sandbox` + providers) and P5 (capability-fact + secrets-broker machinery) present, else STOP+report.
- [ ] Concrete rclone mount module only; no `MountDriver` interface/registry; mountpoint-s3 documented-deferred, not built (decisions 1, 2).
- [ ] Host-side mount + bwrap bind; `/dev/fuse`/`fusermount3`/creds never in the sandbox arg set (decision 3); no in-sandbox FUSE path (decision 4).
- [ ] Per-session mount isolation; readiness gate before bind; lazy-unmount + explicit reap on teardown (decisions 5, 6, 7).
- [ ] File-tool error contract: `ENOTCONN`/`ESTALE`=storage-gone, `EIO`=transient (decision 8); default write-back = VFS-full; fuse-overlayfs variant deferred; never kernel overlayfs over FUSE (decision 9).
- [ ] `mounts.fuseS3: reported | unknown` fails closed; `vercel` reports unsupported.
- [ ] Creds = short-lived prefix-scoped STS, mount-process-env only, refreshed via `credential_process`; sandbox gets a directory handle, never a secret (decision 10; invariant 14) — secrets negative test green.
- [ ] Readonly S3 mount passes the no-leak conformance suite; `bash-sees-mount == file-routes-see-mount` source-of-truth test green.
- [ ] EU-endpoint matrix (MinIO in CI) green; no US-hosted default or hard dependency (invariant 15).
- [ ] VM-grade tier uses Kata/Cloud Hypervisor + virtiofs; **vanilla Firecracker is never used for live host mounts**.
- [ ] X1 mounts are `user`-fs-only; governed filesystems are never raw-mounted (#416); no bead raw-mounts `company_context`.
- [ ] Mount-type facts declared + no-inotify contract enforced; stable error codes present; egress enforced via #307 netns/nftables.
- [ ] The six Decision-12 smoke tests pass; the BBX1-009 rclone-FUSE-vs-local benchmark exists with recorded thresholds.
- [ ] boring-sandbox imports agent types only; mounts code never in `shared`; agent imports neither package; `pnpm audit:imports`/`pnpm lint:invariants` green.
- [ ] Any intra-phase transitional code carries `TODO(remove:<bead-id>)` + a same-phase deletion bead (README policy).

## Exit criteria
- [ ] Concrete **rclone** mount module exists (`--vfs-cache-mode full`); no generic driver interface; mountpoint-s3 documented as deferred AWS-only/RO work, not built (decisions 1, 2).
- [ ] A per-session mount has its own mount process, VFS cache dir, scoped creds, and isolated teardown; immutable RO datasets may be shared (decision 5).
- [ ] Mount is bound into the sandbox **host-side** via bwrap `--bind`/`--ro-bind`; `/dev/fuse`, `fusermount3`, and creds are never exposed inside the sandbox (decision 3); the same pattern is gVisor-portable (decision 4).
- [ ] Readiness gate polls `/proc/self/mountinfo` + probes `stat`/`readdir` before binding; an un-ready mount is never bound (decision 6).
- [ ] Teardown lazy-unmounts (`fusermount3 -uz` / `umount -l`) both the bind and the source and explicitly reaps the mount process (decision 7).
- [ ] File-tool error contract: `ENOTCONN`/`ESTALE` → storage-gone; `EIO` → transient; rclone `--timeout`/`--retries`/`--low-level-retries` tuned (decision 8).
- [ ] Capability fact `mounts.fuseS3: reported | unknown` (fail closed; the `vercel`-PROXY provider reports **unsupported**).
- [ ] Credentials are a broker-minted short-lived prefix-scoped STS token injected into the **mount-process env only**, refreshed via `credential_process`; the sandbox receives a directory handle, never a secret (decision 10; invariant 14).
- [ ] An E1 `Environment` whose `mountPath` comes from a mount attaches and works; a **readonly S3 mount passes the no-leak suite**; a `bash-sees-mount == file-routes-see-mount` source-of-truth test passes.
- [ ] EU-endpoint matrix test (MinIO in CI) green; no US-hosted service is a default or hard dependency (invariant 15).
- [ ] X1 mounts are scoped to the `user` filesystem only; governed filesystems (`company_context`) are never raw-mounted.
- [ ] Mount-type capability facts (`mountType`, `noInotify`, `pollRequired`, `cachePolicy`) are reported; the no-inotify contract holds.
- [ ] Stable error codes exist (`mount-unavailable`, `mount-stale`, `writeback-failed`, `path-outside-prefix`, `egress-denied`, `unsupported-mount-mode`).
- [ ] The six Decision-12 smoke tests pass; the rclone-FUSE-vs-local benchmark (BBX1-009) exists with recorded numeric thresholds.
- [ ] Egress policy is enforced as part of the sandbox contract via the hardened tier's per-workspace netns/nftables (#307).

## Closeout
- [ ] Zero unowned `TODO(remove:*)` markers for this phase
- [ ] PRs merged per [PR-PLAN.md](../../PR-PLAN.md) (this package's section)
