# Storage mount performance evaluation: SeaweedFS and managed sandboxes

**Context:** Evidence review for issue #1081 and PR #1220, testing the claim that a SeaweedFS FUSE mount is too slow for POSIX-heavy agent work and therefore requires a separate ephemeral local block device at `/scratch`.

Date: 2026-08-13. Sources were checked against current primary documentation and upstream repositories. Vendor measurements are identified as such; independent measurements are identified separately. A proposition that could not be established from a primary source is marked **unknown** or **[unverified]**.

---

## Executive answer

The claim is directionally right but stated too absolutely.

SeaweedFS's FUSE client is not merely an S3 compatibility mount. It provides a filesystem namespace over SeaweedFS filer metadata and volume-server chunks, caches directory metadata and file chunks locally, buffers writes, accepts arbitrary-offset writes, and implements POSIX advisory locks. Those features make ordinary source trees and sequential artifact I/O viable on a well-placed, tuned mount. SeaweedFS itself nevertheless says FUSE and network access are slower than local files and recommends moving temporary-file writes to an unmounted local directory. Its current first-party database benchmark measures a 9× fsync-latency penalty and an 11.6× SQLite one-row transaction penalty versus local NVMe. The test did not establish power-loss durability, and cross-mount locking is not safe by default. [SeaweedFS FUSE guide](https://github.com/seaweedfs/seaweedfs/wiki/FUSE-Mount) [SeaweedFS database benchmark](https://github.com/seaweedfs/seaweedfs/blob/db5a086d048c5c2d6e51e82bb070d20df04d688d/test/benchmark/fuse_db/README.md)

No SeaweedFS primary source found in this review benchmarks `git status`, `git clone`, pnpm installation, a `node_modules` tree, or a representative JavaScript build on `weed mount`. Calling all of them “too slow” is therefore not established. The supported conclusion is narrower: use the mount for durable source and results when its latency is acceptable; use local storage for high-churn package trees, intermediate build output, caches, and transaction-heavy SQLite. Measure the actual repository before turning that engineering prior into a hard product invariant.

The provider survey does not reveal one universal `/scratch` standard. It reveals four recurring patterns:

1. explicit ephemeral local filesystem plus an explicitly mounted durable store;
2. a fast local copy-on-write root that is checkpointed or snapshotted automatically;
3. a persistent local/block volume for POSIX applications;
4. a cached POSIX gateway that asynchronously synchronizes to object storage.

The current `/scratch` design is therefore one valid and comparatively simple pattern, not the only valid pattern. Its material defect is recoverability: with no versioning and explicit publication, a correct result left on `/scratch` is lost at teardown. That failure mode should be treated as a release-blocking workflow invariant, not merely documented.

## Scope and evidence rules

This report distinguishes three paths that are often conflated:

- SeaweedFS's native FUSE path: POSIX calls go through `weed mount`, filer
  metadata, and volume-server chunks.
- SeaweedFS's object path: S3 or HTTP requests store and retrieve objects; object
  benchmark results do not include the POSIX/FUSE call path.
- generic S3 mounts such as Mountpoint for Amazon S3 or s3fs: these translate a
  restricted filesystem interface onto object APIs and may intentionally omit
  POSIX operations.

“Supports an operation” is also separate from “is safe for a database” and from
“performs well.” Random-offset writes, advisory locks, fsync behavior, cross-client coordination, and crash or power-loss durability all matter independently.

The SeaweedFS code citations below are pinned to upstream commit `db5a086d048c5c2d6e51e82bb070d20df04d688d`, the upstream `master` revision reviewed on the report date. Wiki content is not version-pinned and can change.

## Question 1 — SeaweedFS specifically

### What `weed mount` actually does

SeaweedFS documents the mount as a native filesystem client. It keeps a volume location map from the master, reads file chunks directly from volume servers, and synchronizes filer metadata into a local metadata cache. Cached metadata can satisfy later lookup and directory-listing operations without another filer read. File data still comes from the local chunk cache or a volume server. [FUSE architecture](https://github.com/seaweedfs/seaweedfs/wiki/FUSE-Mount)

On write, the client uploads chunks to volume servers and then records the file's metadata and chunk list through the filer. Small writes are accumulated into larger chunks rather than becoming one backend object per `write(2)` call. This reduces backend small-write amplification, but it does not turn metadata mutation, fsync, or cache misses into local-disk operations. [FUSE write path](https://github.com/seaweedfs/seaweedfs/wiki/FUSE-Mount)

SeaweedFS's own performance guidance is unusually direct: asynchronous local metadata, recent-data caching, and batching make the mount faster, but FUSE and network access remain slower than local files. When files are temporary, it recommends moving those writes to unmounted directories, including by using a local-disk symlink where appropriate. [SeaweedFS performance guidance](https://github.com/seaweedfs/seaweedfs/wiki/FUSE-Mount)

That guidance directly supports a local temporary-work tier. It does not establish that every git or build workload is unusable on the mount.

### Metadata and small-file behavior

SeaweedFS's frequently repeated “small file” strength applies first to its storage layout. A small file is stored as a compact append-only volume entry with very low space overhead, and the volume index permits an O(1) lookup to its on-disk location. Filer metadata is stored separately in the configured metadata database. [SeaweedFS repository overview](https://github.com/seaweedfs/seaweedfs)

The repository publishes an object-path example of one million 1 KiB files on one Mac SSD at concurrency 16: about 15,708 writes/s and 47,019 random reads/s. This is an HTTP/object benchmark, not a FUSE benchmark. It demonstrates efficient storage of small object payloads; it does not measure `open`, `stat`, `readdir`, `rename`, lock, or fsync behavior through `weed mount`. [SeaweedFS small-file benchmark](https://github.com/seaweedfs/seaweedfs)

Current mount defaults and controls are:

| Concern | Current `weed mount` behavior | Consequence |
| --- | --- | --- |
| Read chunk cache | `-cacheCapacityMB=128`; the cache resides below `-cacheDir`, whose default is the OS temporary directory | A warm working set can be local, but the default cache is much smaller than a large dependency tree. |
| Metadata validity | `-metaCacheTtl=60` seconds, plus filer change subscriptions | Lookups and listings can be local when cached; coherency still depends on event delivery and TTL behavior. |
| Large directories | `-cacheDirMaxEntries=10000`; larger directories are read from the filer directly | Very wide generated or package directories can bypass the full local directory cache. |
| Idle directory eviction | `-dirIdleEvictSec=600` | A revisited cold tree can incur filer work again. |
| Write chunk size | `-chunkSizeLimitMB=2` | Many small writes are coalesced before upload. |
| Write buffer cap | `-writeBufferSizeMB=0`, meaning unlimited RAM plus swap-file buffering by default | A stalled backend can consume substantial local temporary storage unless operators set a cap. |
| Write spill location | `-cacheDirWrite`, defaulting to the normal cache/temp location | Local disk is already part of the write path even when the namespace is remote. |
| Kernel writeback | `-writebackCache=false` by default | Enabling it may improve throughput but the flag explicitly warns about crash data loss. |
| FUSE concurrency | 128 concurrent readers, writers, and background requests by default | Tunable concurrency can hide latency, but does not remove per-operation latency. |
| POSIX directory link counts | Disabled by default; enabling correct `st_nlink` costs a directory listing per `stat` | Full metadata fidelity can add work. |

These values come from the current [`weed mount` flag definitions](https://github.com/seaweedfs/seaweedfs/blob/db5a086d048c5c2d6e51e82bb070d20df04d688d/weed/command/mount.go) and [`WFS` cache initialization](https://github.com/seaweedfs/seaweedfs/blob/db5a086d048c5c2d6e51e82bb070d20df04d688d/weed/mount/weedfs.go).

The wiki's older sysbench section says the then-default read cache was 1,000 MB and that its sections yielded roughly 500 MB of effective file data. That is stale relative to the current 128 MB code default. Reproducing the wiki result therefore requires recording the SeaweedFS version and all cache flags, rather than assuming the wiki's cache environment. [Historical FUSE benchmark](https://github.com/seaweedfs/seaweedfs/wiki/FUSE-Mount)

The current write-buffer documentation describes outstanding chunks as being held in RAM or swap files and uploaded asynchronously. It records a real operational failure in which an uncapped buffer filled `/tmp` with about 1.8 TiB after a downstream upload stalled. The prescribed controls are `-writeBufferSizeMB`, `-cacheDirWrite`, and appropriate chunk/concurrency limits. [Write-buffer guidance](https://github.com/seaweedfs/seaweedfs/wiki/FUSE-Mount)

SeaweedFS's newer commercial kernel-mount documentation is also relevant vendor evidence. It says a userspace FUSE daemon participates in every VFS call and can hold multi-gigabyte inode and directory-listing state. The cited Go-FUSE heap measurements range from 448 MB at 500,000 files to 6.8 GB at roughly 33 million files, with one six-million-entry listing dominating a measured heap. The kernel client is positioned as the lower-memory, kernel-cache alternative. Those numbers describe extreme namespace scale, not a typical repository, but they confirm that metadata scale is a known mount cost. [SeaweedFS kernel-mount comparison](https://seaweedfs.com/docs/reference/kernel_mount/)

### Random writes

Current `weed mount` code accepts the caller's byte offset, updates the file size to the maximum prior or written extent, and inserts the new byte range into its page writer. It therefore supports arbitrary-offset writes rather than only append-only object creation. [`Write` implementation](https://github.com/seaweedfs/seaweedfs/blob/db5a086d048c5c2d6e51e82bb070d20df04d688d/weed/mount/weedfs_file_write.go)

The first-party SQLite and MySQL benchmark also exercises database files on the mount, giving practical evidence that random writes function in its tested single-node, single-mount configuration. This does not by itself prove full crash, power-loss, or distributed-lock correctness. [Database benchmark scope](https://github.com/seaweedfs/seaweedfs/blob/db5a086d048c5c2d6e51e82bb070d20df04d688d/test/benchmark/fuse_db/README.md)

### Locking and concurrent writers

Within one mount process, SeaweedFS implements POSIX `fcntl` byte-range locks and `flock` in a local lock table. Across two mount processes, distributed lock management is opt-in with `-dlm`; it is disabled by default. [`weed mount` DLM flag](https://github.com/seaweedfs/seaweedfs/blob/db5a086d048c5c2d6e51e82bb070d20df04d688d/weed/command/mount.go) [`fcntl` lock implementation](https://github.com/seaweedfs/seaweedfs/blob/db5a086d048c5c2d6e51e82bb070d20df04d688d/weed/mount/weedfs_file_lock.go)

With DLM enabled, advisory lock requests are routed to a filer owner and maintained with a renewable lock session. Blocking locks are implemented by retrying until the filer grants the range. This is evidence of intended POSIX advisory-lock support, not a published database certification. [`fcntl` DLM routing](https://github.com/seaweedfs/seaweedfs/blob/db5a086d048c5c2d6e51e82bb070d20df04d688d/weed/mount/weedfs_posix_lock_routed.go)

The official FUSE guide warns that two mounts can otherwise open and write the same file concurrently, with the last flush winning and the first writer's uploaded chunks silently becoming orphaned. It prescribes `-dlm` to serialize writable opens and coordinate `flock` and `fcntl` across mounts. [Distributed lock guidance](https://github.com/seaweedfs/seaweedfs/wiki/FUSE-Mount)

Kernel writeback caching and DLM are not a free combination. Current initialization warns that writeback caching assumes a single writer and disables DLM. An operator must choose the consistency and performance model deliberately. [`WFS` initialization](https://github.com/seaweedfs/seaweedfs/blob/db5a086d048c5c2d6e51e82bb070d20df04d688d/weed/mount/weedfs.go)

### SeaweedFS's documented FUSE benchmarks

The wiki's FUSE sysbench uses 128 files of 8 MiB each, a 1 GiB total data set, and 1 MiB random reads and writes. It is not a small-file or metadata benchmark. The reported one-thread result is about 958 reads/s, 639 writes/s, and 2,046 fsyncs/s, with 0.27 ms average latency. At 16 threads it reports about 2,153 reads/s, 1,435 writes/s, and 4,626 fsyncs/s, with 1.95 ms average and 9.22 ms p95 latency. [SeaweedFS wiki sysbench](https://github.com/seaweedfs/seaweedfs/wiki/FUSE-Mount)

Those figures do not include a local-filesystem baseline on the page, do not model `node_modules`, and depend materially on the historical cache setup. They are useful evidence that concurrent large-block I/O can be healthy, but not evidence that metadata-heavy tooling is local-disk-like.

The current repository adds a much more relevant first-party database benchmark. It was run on an Apple Silicon macOS host with macFUSE, SeaweedFS 4.34, a local single-node cluster, and local NVMe. The harness mounts SeaweedFS with default options and uses roughly 1 GiB database workloads. [Benchmark README](https://github.com/seaweedfs/seaweedfs/blob/db5a086d048c5c2d6e51e82bb070d20df04d688d/test/benchmark/fuse_db/README.md) [`weed mount` harness](https://github.com/seaweedfs/seaweedfs/blob/db5a086d048c5c2d6e51e82bb070d20df04d688d/test/benchmark/fuse_db/bin/lib.sh)

| First-party measurement | Local NVMe | SeaweedFS FUSE | Relative result |
| --- | ---: | ---: | ---: |
| Sequential write plus fsync | 2,336 MB/s | 369 MB/s | FUSE 6.3× slower |
| Warm sequential read | 3,435 MB/s | 1,422 MB/s | FUSE 2.4× slower |
| fsync latency | 0.13 ms | 1.18 ms | FUSE 9.0× slower |
| SQLite bulk load, DELETE journal + FULL sync | 5.8 s / 177 MB/s | 11.6 s / 88 MB/s | FUSE 2.0× slower |
| SQLite one-row transactions | 1,987 tx/s | 171 tx/s | FUSE 11.6× slower |
| MySQL bulk load | baseline | measured | FUSE 1.35× slower |
| MySQL one-row commits | baseline | measured | FUSE 9.2× slower |
| MySQL warm scan | baseline | measured | FUSE 5.6× slower |

All values and relative factors are reported by the [SeaweedFS benchmark authors](https://github.com/seaweedfs/seaweedfs/blob/db5a086d048c5c2d6e51e82bb070d20df04d688d/test/benchmark/fuse_db/README.md); they are vendor results, not independent reproduction.

The benchmark passed six graceful and process-crash scenarios without observed committed-row loss or corruption. Its authors explicitly say this does **not** simulate power loss: after `kill -9`, the operating-system page cache survives, and chunk uploads were not configured with backend `fsync=true`. They call for a VM hard-reset or physical power-loss test and note that a remote replicated cluster would add network round trips and replica-fsync cost. [Durability caveat](https://github.com/seaweedfs/seaweedfs/blob/db5a086d048c5c2d6e51e82bb070d20df04d688d/test/benchmark/fuse_db/README.md)

### Independent evidence

An independently reported 30-million-small-file rsync test took 356 minutes on SeaweedFS versus 874 minutes on MooseFS, about 2.5× faster for SeaweedFS in that specific HDD-to-SSD topology. It does not include a local-filesystem baseline and does not isolate FUSE overhead, so it supports SeaweedFS's relative small-file competence without answering this design question. [SeaweedFS independent-benchmark index](https://github.com/seaweedfs/seaweedfs/wiki/Independent-Benchmarks) [Original MooseFS comparison issue](https://github.com/moosefs/moosefs/issues/370)

A November 2025 independent lab report used a 2.5 Gbit/s multi-datacenter setup and reported very poor small-file FUSE results: 5,399 files of 4 KiB wrote at about 23 KiB/s and read at about 85 KiB/s. Copying an OpenBao tree of 6,063 files and about 372 MiB took 1,069 seconds into the mount and 312 seconds out. The same report shows much better throughput for larger files. Its WAN topology and filer proxy make it a warning about deployment sensitivity, not a universal SeaweedFS result. [Independent SeaweedFS experiment](https://forestier.re/en/posts/2025-11-08-experimentation-seaweedfs/)

No independent, reproducible benchmark of current SeaweedFS running git, pnpm, `node_modules`, or a JavaScript build was found. **Unknown** means exactly that: the workload verdict must not be presented as measured fact.

SeaweedFS release notes include fixes for failed `git clone` behavior on FUSE, which is evidence of active compatibility work. They do not publish git performance numbers. [SeaweedFS 4.13 release](https://github.com/seaweedfs/seaweedfs/releases/tag/4.13)

### SQLite safety and performance

SQLite depends on reliable advisory file locks, correct sync ordering, and filesystem behavior matching its assumptions. SQLite's own documentation says network filesystem locking and synchronization implementations vary in quality, network latency degrades performance, and using SQLite over a network filesystem is at the operator's risk. [SQLite “Use Over A Network”](https://www.sqlite.org/useovernet.html) [SQLite locking documentation](https://www.sqlite.org/lockingv3.html)

SQLite WAL mode is not supported when database clients are on different machines, because WAL requires shared memory on the same host. A network mount does not make cross-host WAL safe. [SQLite WAL documentation](https://www.sqlite.org/wal.html)

For a single sandbox using one `weed mount` process, SeaweedFS supplies local `fcntl` locks, arbitrary writes, and a passing first-party rollback-journal test. That is evidence that SQLite can run. It is not evidence that it should hold authoritative state:

- the measured one-row workload is 11.6× slower than local NVMe;
- the test uses DELETE journal and `synchronous=FULL`, not WAL;
- DLM is off in the default harness, so it does not test cross-mount access;
- true power-loss durability is explicitly untested;
- SeaweedFS warns of last-flush-wins corruption risk across mounts without DLM.

Therefore:

- **SQLite as an ephemeral agent index/cache on local block storage:** supported
  design choice.
- **SQLite on one SeaweedFS mount for low-rate, recoverable data:** technically
  viable, but slower and requires explicit journal/lock/durability validation.
- **Authoritative or cross-sandbox SQLite directly on the mount:** unsafe to
  approve from the available evidence; use a server database, or keep SQLite local
  and publish a quiesced backup/export.

SQLite's online backup API can produce a consistent copy while the source database is in use; blindly copying a live database file is not an equivalent persistence protocol. [SQLite Online Backup API](https://www.sqlite.org/backup.html)

### Workload verdict

| Workload | Verdict | Evidence boundary |
| --- | --- | --- |
| Durable source checkout / light git | **Viable with local topology and cache tuning** | Arbitrary writes and required namespace operations exist; releases fix git compatibility. No current git timing is published. Large repositories need a measured acceptance threshold. |
| Repeated `git status`, checkout churn, large worktrees | **Unknown; local preferred** | Metadata caching helps, but FUSE/network calls and cache eviction remain. No representative benchmark was found. |
| `pnpm install` and `node_modules` | **Unknown; local preferred** | No SeaweedFS benchmark exists. High file-count and metadata churn make the vendor's “temporary files local” guidance directly relevant. |
| Package tarball/content-addressed cache | **Potentially viable with tuning** | Mostly immutable reads can benefit from the chunk cache, but the current default is only 128 MB. Benchmark before relying on it. |
| High-churn intermediate build output | **Local preferred** | SeaweedFS explicitly recommends unmounted local directories for temporary writes. |
| Final build artifacts and user outputs | **Viable** | Sequential or write-once durable files fit the mount better than temporary churn; publication latency must still be measured. |
| SQLite transaction workload | **Not recommended on the mount** | Current vendor measurement is 11.6× slower; power-loss and cross-mount safety remain unproven. |

The defensible product statement is: **SeaweedFS FUSE is a viable durable filesystem for ordinary files, but local storage is the safer performance and correctness tier for POSIX-intensive temporary work and SQLite.** It is not: “SeaweedFS cannot run git or builds.”

### Required project-specific benchmark

Before making the split irreversible, run the exact image, network placement, filer database, replication, and mount flags proposed for production. At minimum compare local block and `weed mount` for:

1. cold and warm clone of representative small, medium, and large repositories;
2. cold and warm `git status`, branch checkout, and a many-file rebase;
3. cold and warm `pnpm install --frozen-lockfile`;
4. clean and incremental production builds;
5. SQLite rollback-journal and WAL workloads, with process kill, VM hard reset,
   filer loss, and two-mount contention;
6. cache sizes of 128 MB, 1 GiB, and a working-set-sized value;
7. cache-full and volume-server-stall behavior with a finite write-buffer cap.

Record wall time, p50/p95/p99 operation latency, network bytes, filer-database operations, mount RSS, cache hit ratio, scratch consumption, and post-crash integrity. Until that test exists, repository-level performance is **unknown**.

## Question 2 — How other sandbox providers solve it

### Comparative summary

| Provider/product | Object storage filesystem | Explicit limitation | Fast local/POSIX alternative | Split visible? |
| --- | --- | --- | --- | --- |
| E2B | s3fs for S3/R2; gcsfuse for GCS; Archil option | E2B delegates filesystem semantics to the selected driver; no stronger POSIX promise found | Per-sandbox local COW block root; pause/snapshot persists its diff | Object mount explicit; snapshot-backed root mostly hidden |
| Daytona | Mountpoint for S3, gcsfuse, blobfuse2, rclone, Archil, or MesaFS | S3-backed volumes are not for block-storage apps such as database tables and are slower than local FS | Persistent local sandbox filesystem, snapshots, forks; separate volumes | External/volume path explicit; ordinary root persistence hidden |
| Modal | Mountpoint-based CloudBucketMount | No append, arbitrary-offset overwrite, or general rename | Local ephemeral disk, Modal Volume, or sandbox filesystem snapshot | Explicit mount/volume paths |
| Blaxel | No external S3-as-volume support; proprietary Agent Drive exposes POSIX and S3 APIs | Root is lost on termination/crash; external S3 cannot be a Volume | RAM-backed OverlayFS root with automatic standby snapshot; durable block Volume | Product exposes three storage classes |
| Vercel Sandbox | FUSE is allowed; documented example uses Mountpoint for S3 | Mountpoint restrictions apply; credentials stored inside snapshot need care | Local filesystem automatically snapshotted on stop by default; Drives beta | Object mount explicit; default-root persistence hidden |
| Fly.io | No first-party object FUSE mount documented **[unverified]**; Tigris is S3 API storage | Ephemeral root is discarded on Machine replacement/restart; object-FUSE semantics unknown | Local NVMe Fly Volume | Explicit root versus mounted volume |
| Cloudflare Containers/Sandbox | tigrisfs example; Sandbox SDK bucket mount exposes s3fs options | R2 is not a POSIX filesystem or SSD substitute | Ephemeral local disk; R2-backed squashfs backup restored as COW overlay | Bucket path explicit; backup/restore explicit |
| Mountpoint for Amazon S3 | Mountpoint itself | No existing-file modification, arbitrary writes, general rename, symlinks, or file locks | Instance store/EBS cache; AWS recommends FSx for Lustre for full POSIX | Explicit mount |
| Archil | Proprietary FUSE client over shared SSD cache synchronized to S3 | External same-path writes are undefined; S3 view can lag; shared mutations need checkout | The shared SSD cache is the fast tier | Hidden behind one mounted filesystem |

### E2B

E2B's cloud-bucket guide installs `gcsfuse` for Google Cloud Storage and `s3fs` for S3-compatible services including R2. The user chooses a mount point such as `/home/user/bucket`; E2B does not claim that the result is a fully POSIX local filesystem. [E2B cloud buckets](https://docs.e2b.dev/storage/cloud-buckets)

E2B separately integrates Archil, describing it as a POSIX filesystem with shared SSD read/write caching and better small-file performance than s3fs or gcsfuse. That performance property belongs to Archil's cache service, not E2B's raw bucket mount. [E2B Archil storage](https://docs.e2b.dev/storage/archil)

The normal sandbox filesystem is isolated local storage. E2B's open infrastructure architecture describes a read-only template root plus a per-sandbox copy-on-write cache exposed to the guest as an NBD block device. Pausing uploads dirty blocks as a diff to object storage; resume restores the block view with cache and prefetch. [E2B infrastructure architecture](https://github.com/e2b-dev/infra/blob/main/docs/ARCHITECTURE.md)

At the product layer, pause preserves filesystem and memory, snapshots can checkpoint and fork a running sandbox, and templates prebuild dependencies. The default timeout action is still `kill`, not `pause`, so an application must opt into persistence or snapshot before termination. [E2B persistence](https://docs.e2b.dev/sandbox/persistence) [E2B snapshots](https://docs.e2b.dev/sandbox/snapshots)

Pattern: fast local COW root for work, optional explicit object mounts, and snapshot/pause for root durability. The speed/durability split is hidden for a paused or snapshotted root but remains a lifecycle responsibility.

### Daytona

Daytona documents external mounts through Mountpoint for S3, gcsfuse, blobfuse2, rclone, Archil, and MesaFS. These are installed into a snapshot or at runtime and mounted at a user-selected path. [Daytona external storage](https://www.daytona.io/docs/en/mount-external-storage/)

Daytona's own Volumes are S3-backed FUSE storage. Its limitation section explicitly says they should not be used for applications requiring block storage, “such as database tables,” and that reads and writes are generally slower than the sandbox's local filesystem. [Daytona Volumes](https://www.daytona.io/docs/volumes/)

Daytona makes CPU/VM sandbox filesystems persistent by default across stop and start. Its implementation archives or offloads sandbox state when stopped and restores it on start; snapshots and forks provide additional reusable states. The docs explicitly tell GPU users, whose sandboxes are ephemeral, to copy results to a Volume before stop. [Daytona persistence](https://www.daytona.io/docs/en/persistence/)

Pattern: the default working directory is a local filesystem whose lifecycle is made durable by the platform. A separately mounted S3-backed Volume is for shared or lifecycle-independent data, not database or high-IOPS work.

### Modal

Modal CloudBucketMount is built on Mountpoint and supports S3, R2, and GCS. Modal says it is optimized for sequential large-file reads. It cannot append, cannot seek and write at arbitrary offsets, and cannot generally rename an existing object. Modal recommends writing a temporary local file and then moving the completed file, or using a Modal Volume when fuller filesystem behavior is needed. [Modal CloudBucketMount](https://modal.com/docs/guide/cloud-bucket-mounts)

Modal Volumes are a distributed filesystem optimized for write-once/read-many use. Volume v1 is documented as best below 50,000 files with a hard 500,000-inode limit; concurrent writes to one file can lose updates, and commit/reload semantics are explicit. [Modal Volumes](https://modal.com/docs/guide/volumes)

Files outside a mounted Volume or bucket are written to the container's local filesystem. Sandbox filesystem snapshots can preserve and restore selected directories or the filesystem state. [Modal sandbox snapshots](https://modal.com/docs/guide/sandbox-snapshots)

Pattern: explicit durable mounts plus local temporary work, with snapshots as a separate checkpoint mechanism. Modal's documentation states the exact local-then-publish workflow relevant to this design.

### Blaxel

Blaxel's root filesystem uses a read-only EROFS base image and a writable in-memory tmpfs upper layer joined by OverlayFS. The tmpfs can consume roughly half the sandbox memory. On standby, Blaxel snapshots memory and filesystem state and automatically restores it on resume; termination or infrastructure crash still erases state that was not durably stored. [Blaxel sandbox architecture](https://docs.blaxel.ai/Sandboxes/Overview)

Blaxel's storage guide distinguishes the sandbox filesystem, a durable replicated block Volume, and Agent Drive, a shared distributed filesystem optimized for small and medium files and accessible through POSIX and S3 interfaces. The guide warns that the local sandbox filesystem is stateful only while the sandbox/standby state exists. [Blaxel storage best practices](https://docs.blaxel.ai/Sandboxes/best-practices)

Current Blaxel docs say an external storage service such as S3 cannot be mounted as a Blaxel Volume. This contradicts any interpretation of the prior project note that Blaxel supplies an S3-backed block volume. [Blaxel Volumes](https://docs.blaxel.ai/Volumes/Overview)

Pattern: an extremely fast RAM-backed working root with automatic warm-state snapshot, plus explicit durable block or distributed storage. The platform offers multiple storage classes rather than pretending object storage is local POSIX.

### Vercel Sandbox

Vercel added FUSE support in July 2026. Its documented object-storage example installs Mountpoint for Amazon S3 and mounts the bucket at `/mnt/s3`. Mountpoint's semantic limits therefore apply. [Vercel FUSE announcement](https://vercel.com/changelog/vercel-sandbox-now-supports-fuse-based-filesystems)

Vercel Sandbox persistence is enabled by default as of June 2026. Stopping a persistent sandbox automatically snapshots the local filesystem; resuming restores it. Setting persistence false discards the filesystem. Vercel also exposes explicit snapshots for prebuilt environments and forks. [Vercel duration and persistence](https://vercel.com/kb/guide/vercel-sandbox-duration-and-persistence) [Vercel snapshots](https://vercel.com/docs/vercel-sandbox/concepts/snapshots)

Vercel describes snapshots as compressed local-disk state and has optimized restore through parallelization and local caching. This is not an object mount serving as the root; it is a local working filesystem made durable at lifecycle boundaries. [Vercel snapshot optimization](https://vercel.com/blog/optimizing-vercel-sandbox-snapshots)

Vercel Drives are a separate beta persistent mount with a single-reader/writer model and are recommended only for cache or non-critical use while in beta. [Vercel Drives](https://vercel.com/kb/guide/vercel-drives)

Pattern: local root is the default working directory and appears durable because snapshotting is automatic; raw object FUSE remains an explicit secondary path.

### Fly.io

Fly Machines have an ephemeral root filesystem. Fly Volumes are persistent local NVMe block devices attached to one Machine on one physical server. Fly recommends Volumes for filesystems and databases, while warning that they are not automatically replicated. [Fly Volumes overview](https://fly.io/docs/volumes/overview/)

The documented root-disk limits are up to 2,000 IOPS and 8 MiB/s, so “local” does not automatically mean uncapped performance on Fly. A Volume is nevertheless the full-filesystem mechanism intended for stateful POSIX workloads. [Fly root and volume limits](https://fly.io/docs/volumes/overview/)

Fly's Tigris product exposes an S3-compatible object API. No first-party Fly document was found that presents a supported Tigris/S3 FUSE mount as the sandbox working filesystem. Whether a customer-installed FUSE driver is operationally supported is **[unverified]**. [Fly Tigris object storage](https://fly.io/docs/tigris/)

Pattern: explicit ephemeral root versus explicit local persistent block volume; object storage is API-accessed rather than presented as the default POSIX workspace.

### Cloudflare Containers and Sandbox SDK

Cloudflare's R2 FUSE example uses `tigrisfs`. It explicitly says object storage is not POSIX storage and users should not expect an SSD substitute. Suggested uses are assets, bootstrap data, static files, and editing workflows that tolerate lower performance. It also names s3fs and gcsfuse as alternative adapters. [Cloudflare R2 FUSE example](https://developers.cloudflare.com/containers/examples/r2-fuse-mount/)

The Sandbox SDK mounts R2, S3, or GCS at a chosen path. Its API exposes s3fs options, providing primary evidence that the production bucket mount uses the s3fs model rather than a full local filesystem. [Cloudflare Sandbox storage API](https://developers.cloudflare.com/sandbox/api/storage/)

Container local disk is ephemeral and a fresh image is started after sleep. Cloudflare therefore does not make the raw bucket mount a transparent fast root. [Cloudflare container architecture](https://developers.cloudflare.com/containers/platform-details/architecture/)

The Sandbox SDK has a more sophisticated alternative: `createBackup` packs a directory into squashfs in R2, and restore mounts the backup read-only with a local writable copy-on-write upper layer. Backups are explicit; partial writes are not captured, and external bucket mounts must be remounted after restart. [Cloudflare Sandbox backups](https://developers.cloudflare.com/sandbox/api/backups/)

Pattern: explicit object mount for durable files, or a snapshot-backed COW local workspace for better POSIX behavior. This is the closest documented analogue to the overlay/snapshot alternative discussed below.

### Mountpoint for Amazon S3

Mountpoint is intentionally a basic filesystem client for object workloads. AWS says it cannot modify existing files, delete directories, create symbolic links, or use file locking. AWS positions it for large-scale read-heavy access and directs users needing full POSIX behavior toward FSx for Lustre. [AWS Mountpoint overview](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mountpoint.html)

The detailed semantic contract permits random reads but normally permits only sequential creation of new objects. It lacks arbitrary-offset writes, general file/directory rename, hard links, symlinks, and POSIX locks. Multiple writers are not coordinated, and cached data can be stale. [Mountpoint semantics](https://github.com/awslabs/mountpoint-s3/blob/main/doc/SEMANTICS.md)

Mountpoint can use local instance store or EBS as a read cache; the cache improves repeated reads but does not add the missing write or lock semantics. It is removed on unmount and may contain unencrypted object content. [Mountpoint caching](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mountpoint-usage.html)

Conclusion: Mountpoint is not viable for git worktrees, package installations, mutable build trees, or SQLite database files. It is viable for immutable inputs and completed sequential outputs.

### Archil

Archil provides a proprietary FUSE client backed by a shared SSD read/write cache, with asynchronous synchronization to S3. It claims full POSIX behavior, sub-millisecond cached time-to-first-byte, 10–30 ms cold S3 reads, up to 10 GB/s, and 10,000 IOPS across clients. These are vendor specifications; no reproducible independent benchmark supporting them was found in this review. [Archil architecture](https://docs.archil.com/details/architecture) [Archil performance](https://docs.archil.com/details/performance)

Archil says `fsync` persists data to its disk tier, while S3 synchronization can lag by tens of seconds and generally completes within five minutes. Separate client caches can take seconds to observe one another's changes. [Archil consistency](https://docs.archil.com/details/consistency) [Archil data sources](https://docs.archil.com/concepts/data-sources)

Archil warns that externally changing the same S3 paths while Archil writes them has undefined behavior and can cause loss or corruption. Shared write workflows need its checkout/coordination mechanism. [Archil data-source safety](https://docs.archil.com/concepts/data-sources)

Its Linux guide describes the mount as POSIX and names programs including databases, but no SQLite-specific lock, crash, or power-loss test was found. SQLite safety on Archil is therefore **[unverified]**, despite the broader vendor claim. [Archil Linux mount](https://docs.archil.com/mounting/linux)

Archil's execution product makes the cached disk the working directory. It is the only surveyed product found that presents a durable, S3-synchronized POSIX gateway as the default work path. It avoids the raw-object performance problem by inserting a separately operated shared SSD durability and consistency service; S3 itself is not the synchronous working tier.

## Question 3 — Design implication

### Is `/scratch` the industry-standard answer?

It is **one industry-standard pattern**, but the separate path and explicit publish step are not universal.

Providers consistently avoid treating a raw object mount as a fully local POSIX working disk. Modal, Cloudflare, and Mountpoint say so explicitly. E2B, Daytona, Blaxel, and Vercel instead make a fast local/COW root feel persistent by snapshotting or restoring it. Fly and Blaxel expose a real persistent block volume. Archil inserts a durable shared SSD cache in front of S3.

The common invariant is a fast POSIX tier distinct from raw object storage. The choice that varies is whether users see two paths, whether the fast tier is itself durable block storage, or whether lifecycle snapshotting hides the split.

### Pattern comparison for the sovereign sandbox

| Pattern | Concrete design | Benefit | Cost and risk versus current `/scratch` |
| --- | --- | --- | --- |
| Explicit local `/scratch` + SeaweedFS `/workspace` | Keep current two mounts; package trees, DBs, and build intermediates stay local; publish outputs | Lowest platform complexity; plain tenant files remain immediately addressable through POSIX and S3 | Highest user-error risk; two capacity policies; copy time; crash or teardown loses unpublished work |
| SeaweedFS writeback caching | Enable `weed mount -writebackCache` and enlarge local caches | One visible namespace; fewer write round trips | SeaweedFS explicitly warns of crash data loss; single-writer assumption conflicts with DLM; does not establish SQLite durability |
| OverlayFS with SeaweedFS lower + local upper | Mount durable lower read-only and local COW upper at one `/work` path; publish upper changes later | One fast visible work tree; reads can fall through | Upper changes are invisible to S3/other clients until commit; whiteouts, rename, conflict, recovery, quota, and atomic publication become platform responsibilities |
| Snapshot-backed local root | Boot a local block/COW root from an immutable snapshot; checkpoint changed blocks to object storage at lifecycle boundaries | Local POSIX performance, one default working tree, fast warm forks | Requires block-diff format, quiescing, restore, garbage collection, integrity, encryption, quotas, and checkpoint policy; plain files are not immediately browsable through S3 |
| Persistent local/block workspace | Attach durable NVMe/network block volume per sandbox | Full POSIX and database semantics; no publish-on-success requirement | Placement and failover constraints, replication/backup cost, attachment lifecycle, and weaker direct S3 interoperability |
| Archil-like shared cache | Operate shared SSD read/write cache with object synchronization | One durable POSIX/S3-oriented namespace and good hot performance | A new distributed storage system: cache coherence, fencing, durability, multi-AZ replication, sync conflicts, and recovery; buying Archil weakens sovereignty |

SeaweedFS as a writable OverlayFS lower layer is not a transparent solution. A safe overlay design makes the lower layer read-only for the session; all mutation lands in the local upper. Publication must interpret whiteouts and renames, detect changes made through S3 or another mount, and commit a coherent manifest. That is a snapshot/synchronization system, not merely a mount option.

A writeback cache alone is also insufficient. SeaweedFS ships it disabled, warns about loss on crash, and makes it a single-writer mode. It can be tested as a performance option for recoverable work, but it should not replace a correctness tier.

The snapshot-backed local-root pattern is the strongest long-term UX alternative. It is concretely demonstrated by E2B's COW block root, Vercel's automatic local-disk snapshot, Blaxel's OverlayFS standby snapshot, and Cloudflare's read-only squashfs lower plus writable upper. It would pull block-diff, checkpoint, restore, and garbage-collection work into v1, and it would break the present requirement that durable workspace files simultaneously remain ordinary SeaweedFS/S3 objects unless a second publication layer is built.

For v1, the current explicit split is a proportionate implementation choice. It should be justified as:

> local block storage provides predictable POSIX latency and database semantics;
> SeaweedFS provides durable, externally addressable files.

It should not be justified as:

> SeaweedFS cannot support git, packages, or builds.

### Which providers make durable storage the default working directory?

Daytona makes its ordinary CPU/VM sandbox filesystem persistent across stop/start. Vercel now makes local-filesystem persistence automatic by default. Blaxel preserves the root automatically across standby, though not termination or infrastructure loss. E2B can do so through pause/snapshot, but its default timeout action is kill.

These products avoid running the default root directly on raw object FUSE. They execute against a local filesystem and persist its state at lifecycle boundaries. Durability is hidden behind snapshot/archive/restore.

Archil also makes its disk the working directory, but avoids raw S3 latency with a shared SSD read/write cache that is itself the synchronous durability tier. The S3 view is asynchronous and can lag.

No other surveyed provider was found making s3fs, gcsfuse, Mountpoint, or tigrisfs the default general-purpose sandbox working directory. Fly, Modal, and Cloudflare keep the object path explicit.

### The `/scratch` footgun

Under the current proposal, an agent can successfully create the only copy of a valuable result under `/scratch`, report success, and then lose it irrecoverably when the sandbox is destroyed. With the owner's v1 ruling of no versioning, neither an older `/workspace` object nor a scratch snapshot exists to recover. A path typo becomes permanent data loss.

Other providers reduce this class of mistake in three ways:

- Vercel and Daytona automatically persist the ordinary working filesystem, so the
  normal path does not require an explicit publish step.
- Blaxel automatically snapshots standby state, while clearly separating durable
  Volumes/Drive for termination survival.
- Modal, Fly, and Cloudflare expose the split and document local ephemerality;
  correctness still depends on the caller copying or backing up outputs.
- Archil makes the cached durable disk the default working directory.
- E2B offers pause and snapshot, but applications using the default kill behavior
  can still lose uncheckpointed root state.

Documentation alone is not a sufficient mitigation for an autonomous agent.

### Required v1 safeguards

The following are design recommendations derived from the evidence, not claims about existing implementation:

1. **Do not let path choice determine success silently.** A task result must include
   an output manifest. The control plane should refuse to report durable completion
   until every declared result exists under `/workspace` and has been fsynced or
   otherwise acknowledged by the durable tier.

2. **Reserve scratch for generated working state.** Set `TMPDIR`, package-store,
   compiler-cache, checkout, build-intermediate, and agent SQLite locations
   explicitly under `/scratch`. User-authored deliverables should default to
   `/workspace` or be published by the tool that creates them.

3. **Make publication a control-plane operation.** Copy to a unique staging name,
   verify size and content digest, then expose the destination and record a manifest.
   The exact atomicity of SeaweedFS rename and simultaneous S3 visibility must be
   tested; until then this part is **[unverified]**.

4. **Gate teardown on publication acknowledgement.** Normal teardown must wait for
   the result manifest and durable acknowledgement. A dirty or undeclared scratch
   result should produce an error, not a warning.

5. **Detect likely omissions.** Before teardown, scan the task-owned scratch tree
   for files newer than the last publication, excluding declared caches and package
   stores. Surface the paths and block normal completion until they are published
   or explicitly discarded.

6. **Persist SQLite through SQLite-aware export.** If an agent database itself is a
   deliverable, use the SQLite backup API or a quiesced export into `/workspace`.
   Do not copy a live database opportunistically.

7. **Test abnormal termination honestly.** The safeguards above prevent normal-path
   mistakes but not host loss between writes and publication. With no scratch
   checkpoint or synchronous workspace write, that residual loss window is
   unavoidable and must be stated as such.

These controls preserve the simpler two-tier infrastructure while moving the burden from the language model's memory to deterministic orchestration. They do not create version history and therefore respect the no-versioning ruling; overwriting a durable output remains irreversible unless the owner later changes that policy.

### Recommended decision

Keep a local block tier for v1, but treat `/scratch` as an implementation detail for workload execution rather than an unmanaged second home directory.

Specifically:

- keep durable inputs and declared outputs as plain files under `/workspace`;
- stage checkout, dependency trees, build intermediates, caches, and SQLite under
  a task-scoped directory on `/scratch`;
- make the orchestrator publish declared outputs and verify them before success;
- benchmark representative projects on SeaweedFS and allow direct-on-workspace
  execution when it meets a stated service-level threshold;
- revisit a snapshot-backed local root when the product needs transparent warm
  workspaces or the explicit-publish UX proves too error-prone.

This preserves a path to remove unnecessary copying later without betting v1 database correctness and build latency on unmeasured FUSE behavior.

## Unknowns that must remain explicit

- Current SeaweedFS git, pnpm, `node_modules`, and JavaScript build performance in
  the proposed production topology is **unknown**.
- SeaweedFS power-loss durability for transaction commits under the intended
  replication and filer database configuration is **unknown**.
- SQLite safety across multiple SeaweedFS mounts, even with DLM, has no published
  SQLite-specific certification or benchmark and is **unknown**.
- The performance and correctness effect of enabling SeaweedFS kernel writeback
  caching for this workload is **unknown** and carries an explicit crash-loss warning.
- Fly's support policy for a customer-installed object FUSE mount is **[unverified]**.
- Archil's SQLite locking, crash, and power-loss behavior is **[unverified]**.
- Atomic publication visibility between SeaweedFS POSIX rename and concurrent S3
  readers under the intended gateway configuration is **[unverified]**.

## Answer to the owner's literal question

**“Is that true with SeaweedFS, and how do others solve it?”** Partly: SeaweedFS `weed mount` is a capable cached POSIX client, not a read-only object shim, so the evidence does not show that git, pnpm, `node_modules`, and builds are categorically unviable; those exact workloads remain unbenchmarked. But SeaweedFS itself recommends local unmounted storage for temporary writes, its current benchmark measures FUSE fsync at 9× local latency and SQLite one-row transactions at 11.6× slower, and database-grade power-loss and default cross-mount locking safety are not established. Other providers solve the same problem with one of several patterns: explicit local scratch plus a durable mount, a persistent block volume, a fast local COW root that is automatically snapshotted/restored, or a proprietary shared SSD cache in front of object storage. A separate `/scratch` is therefore a sound v1 choice, not a uniquely industry-standard necessity; without versioning, it is safe only if publication and teardown are enforced by the control plane so an agent cannot silently leave the sole copy of its result on ephemeral storage.
