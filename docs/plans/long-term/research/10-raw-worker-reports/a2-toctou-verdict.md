# Verdict: CONFIRMED

The narrow technical claim is true.
PR #1166 validates a pathname, stores only the resulting string, and later asks a different process to bind that pathname.
There is no stable host object reference between those operations.
Ordinary bubblewrap `--bind` and `--ro-bind` resolve the source pathname again when bubblewrap constructs the mount namespace.
A host actor able to replace a checked path component can therefore make a later exec bind a different host directory.
That conclusion is established by the PR code and bubblewrap source, not by inference from the plan.
The claim is nevertheless not a present production exploit or a merge blocker for this dormant slice.
Slice 1 does not yet derive or pass any non-test environment mount from an agent binding.
`BORING_ENV_MOUNTS` also defaults off.
The current agent cannot reach the parent directories of a named host mount through bwrap merely because it can execute in `/workspace`.
No evidence in PR #1166 gives another tenant access to those host parent directories either.
On the code and deployment material inspected, exploitation requires a co-located host process with pathname-mutation permission, a same-UID process with the relevant parent-directory access, or a privileged host actor.
That makes the finding a required hardening item before environment mounts are enabled, not a reason by itself to block merge of the flag-off provider substrate.
The plan's statement that bwrap lacks an fd-bind CLI is false for modern bubblewrap.
Bubblewrap 0.10.0 added `--bind-fd` and `--ro-bind-fd` specifically for this TOCTOU class; the feature was also backported to 0.6.3.
The minimal complete fix is to acquire and validate stable directory handles once at pair creation, retain them for the pair lifetime, inherit them into every bwrap child, and use `--[ro-]bind-fd`.
That fix may follow PR #1166, but it must land before `BORING_ENV_MOUNTS=1` is permitted in any environment or before slice 2/3 wires real mount sets.
## Scope and code state examined

The PR head available locally is `3290ab372d3a87543728fc3f06f7da50ada23dc4` on `impl/1123-slice1-env-mount-substrate`.
Its merge base with the locally fetched `origin/main` is `d18fe7642884fdaef5f993d3117f7063caa8de69`.
The surrounding `origin/main` state examined is `d44a689bb47638227cf7f930041ee593026f08bf`.
The local checkout also contains the complete untracked `1166.diff` supplied by the surrounding research run.
`gh pr view 1166` and `gh pr diff 1166` could not reach `api.github.com` from this sandbox.
That transport failure does not make the code question unverifiable because the PR head ref, merge base, full diff, plan revision, and current `origin/main` objects are all locally present.
The decisive files are unchanged by that limitation.
## 1. Exact check and exact bind

The environment-mount resolver is called at pair creation in:
`packages/boring-sandbox/src/providers/bwrap/createBwrapProvider.ts:39-46`
```ts
await mkdir(context.workspaceRoot, { recursive: true })
// Resolve-once mount hygiene (gh-1123): source roots are
// realpath-resolved exactly once here, and every subsequent exec binds
// the resolved paths. Flag-off resolves to the empty set.
const mounts = await resolveEnvironmentMounts(
  context.workspaceRoot,
  resolveContextMounts(context),
)
```
The workspace itself is canonicalized in:
`packages/boring-sandbox/src/providers/bwrap/resolveEnvironmentMounts.ts:54`
```ts
const resolvedWorkspaceRoot = await realpath(workspaceRoot)
```
Each named source is canonicalized in:
`packages/boring-sandbox/src/providers/bwrap/resolveEnvironmentMounts.ts:56-65`
```ts
for (const mount of mounts) {
  let sourceRoot: string
  try {
    sourceRoot = await realpath(mount.sourceRoot)
  } catch (error) {
    throw invalid(
      `mount source root does not exist: ${mount.sourceRoot}`,
      error,
    )
  }
```
The resolver then performs a second pathname operation in:
`packages/boring-sandbox/src/providers/bwrap/resolveEnvironmentMounts.ts:67-70`
```ts
const stats = await stat(sourceRoot)
if (!stats.isDirectory()) {
  throw invalid(`mount source root is not a directory: ${mount.sourceRoot}`)
}
```
It checks lexical containment of the canonical strings in:
`packages/boring-sandbox/src/providers/bwrap/resolveEnvironmentMounts.ts:72-79`.
It stores only the string in:
`packages/boring-sandbox/src/providers/bwrap/resolveEnvironmentMounts.ts:97`
```ts
resolved.push({ ...mount, sourceRoot })
```
No inode, file descriptor, mount descriptor, directory handle, or generation is retained.
At every exec, that stored string becomes a bwrap argument in:
`packages/boring-sandbox/src/providers/bwrap/buildBwrapArgs.ts:194-200`
```ts
for (const mount of mounts) {
  args.push(
    mount.access === 'rw' ? '--bind' : '--ro-bind',
    mount.sourceRoot,
    mount.logicalPath,
  )
}
```
The bwrap process is finally launched in:
`packages/boring-sandbox/src/providers/bwrap/createBwrapSandbox.ts:290-309`
```ts
const baseArgs = buildBwrapArgs(workspaceRoot, {
  postWorkspaceArgs,
  network: sandboxOptions.network,
  dropAllCapabilities: sandboxOptions.dropAllCapabilities,
  mounts: sandboxOptions.mounts,
})
const args = [
  ...withSandboxCwd(baseArgs, sandboxCwd),
  ...buildCommandArgs(cmd, sandboxOptions.resourceLimits),
]
return await new Promise((resolve, reject) => {
  const child = spawn('bwrap', args, {
```
The actual bind mount is not performed by TypeScript.
It occurs after `spawn`, inside the new bwrap process.
Bubblewrap main currently describes ordinary bind options as pathname options at `bubblewrap.c:2710-2719`:
```c
" --bind SRC DEST Bind mount the host path SRC on DEST\n"
" --ro-bind SRC DEST Bind mount the host path SRC readonly on DEST\n"
```
During root setup, bwrap constructs the old-root pathname and probes it at `bubblewrap.c:3783-3802`:
```c
if (op->source &&
    op->type != SETUP_MAKE_SYMLINK)
  {
    source = get_oldroot_path (op->source);
    source_mode = get_file_mode (source);
```
It then calls its bind helper at `bubblewrap.c:3700-3721`:
```c
static void
setup_op_bind_mount (bind_option_t options,
                     const char *src,
                     const char *dest)
{
  ...
  bind_result = bind_mount (proc_fd, src, dest,
                            BIND_RECURSIVE | options, &failing_path);
```
That helper ultimately performs Linux bind-mount operations on the pathname visible to that bwrap process.
The source is therefore walked at bwrap setup time.
It is not an assertion about the inode seen by Node's earlier `realpath`.
### Time separation

There is no finite upper bound.
For the first command, resolution occurs during provider `create()` and binding occurs only after `sandbox.init()` and a later call to `sandbox.exec()`.
`init()` first spawns and waits for `bwrap --version` at `createBwrapSandbox.ts:107-143`.
It also computes global tool mounts at `createBwrapSandbox.ts:271-277`.
The caller may wait arbitrarily long before the first exec.
For later commands, the gap is the entire age of the pair or lease.
It can be milliseconds, hours, days, or effectively unbounded until disposal.
### Syscall separation

There is no fixed syscall count either.
Node's `realpath()` itself may issue a variable number of metadata/path syscalls based on path depth, libc/Node implementation, cache state, and symlinks.
After it returns, the PR explicitly performs `stat(sourceRoot)`.
It may resolve and stat more mounts.
It creates JavaScript objects, creates the workspace adapter, spawns `bwrap --version`, waits for that process, runs access/stat/realpath probes for global tools, returns the pair, and waits for a future exec.
The exec path then builds argv, spawns another process, and bwrap performs namespace and filesystem setup before its source probe and mount call.
At minimum there is an explicit source `stat` plus process creation/exec and bwrap setup between the named `realpath` and the mount syscall.
In total there are many more syscalls, and there may be arbitrarily many syscalls in the host process and other processes before a later exec.
Any exact numeric syscall answer would be false without pinning Node, libc, bwrap, path shape, mount count, and the complete execution schedule and then tracing one run.
The security-relevant count is simpler: one pathname check produces a string, followed by one independent pathname use for every exec.
## 2. Concrete host attacks

Assume the configured mount is:
```text
sourceRoot = /srv/boring/sources/acme/knowledge
logicalPath = /mnt/knowledge
access = ro
```
Assume a sensitive host directory exists at:
```text
/srv/boring/secrets/acme
```
At pair creation, `realpath(sourceRoot)` returns:
```text
/srv/boring/sources/acme/knowledge
```
The `stat` call reports a directory.
The string checks show that it neither equals nor contains the workspace and is not contained by the workspace.
The string is retained in `sandboxOptions.mounts`.
### Attack A: replace the final component with a symlink

After `resolveEnvironmentMounts()` returns and before a chosen exec reaches bwrap setup, the host attacker runs the equivalent of:
```text
rename("/srv/boring/sources/acme/knowledge",
       "/srv/boring/sources/acme/knowledge.saved")
symlink("/srv/boring/secrets/acme",
        "/srv/boring/sources/acme/knowledge")
```
The agent invokes bash.
The server emits:
```text
--ro-bind /srv/boring/sources/acme/knowledge /mnt/knowledge
```
Bwrap resolves that source in its old-root view.
Its `get_file_mode()` follows the symlink as an ordinary `stat`-style probe.
The bind operation sees `/srv/boring/secrets/acme`.
The sandbox receives the sensitive directory at `/mnt/knowledge`.
Read-only changes the impact from modification to disclosure; it does not prevent disclosure.
For an `access: rw` contract mount, the same sequence also permits modification subject to host permissions.
The attacker needs search permission on the path prefixes and write plus search permission on `/srv/boring/sources/acme`.
Sticky-directory ownership rules apply if that parent has the sticky bit.
The attacker does not need `CAP_SYS_ADMIN` for this symlink/rename form.
### Attack B: replace an intermediate component

Use a target tree whose suffix matches the checked suffix:
```text
/srv/boring/secrets-shadow/acme/knowledge
```
After validation, run:
```text
rename("/srv/boring/sources",
       "/srv/boring/sources.saved")
symlink("/srv/boring/secrets-shadow",
        "/srv/boring/sources")
```
The unchanged stored string now resolves to:
```text
/srv/boring/secrets-shadow/acme/knowledge
```
Bwrap binds that directory.
The attacker needs write plus search permission on `/srv/boring`, because that directory owns the replaced `sources` entry.
Replacing a deeper intermediate such as `acme` requires the corresponding permission on `/srv/boring/sources`.
Again, no mount capability is required.
### Attack C: rename and replace with a real directory

A symlink is not necessary.
An attacker who controls both directory entries can do:
```text
rename(".../knowledge", ".../knowledge.saved")
rename(".../attacker-selected-directory", ".../knowledge")
```
The bwrap walk selects the replacement inode.
A cross-filesystem rename fails, so the replacement must be on the same filesystem or must first be copied/materialized there.
Moving a genuinely privileged secret directory normally requires write permission on its original parent as well as the destination parent.
That makes this form less available than a symlink swap, but the checked name still has no inode binding.
A pure rename-away with no replacement generally produces `ENOENT` and denies service; it does not disclose another directory.
### Attack D: bind-mount shadowing

After validation, a privileged host attacker runs:
```text
mount --bind /srv/boring/secrets/acme \
  /srv/boring/sources/acme/knowledge
```
The pathname now crosses the new host mountpoint.
Bwrap's recursive bind sees the top mount at that path and exposes it.
To affect the pathname view inherited by the server/bwrap process, the attacker needs `CAP_SYS_ADMIN` in the relevant host mount namespace, or equivalent control of that namespace and mount propagation.
Creating a bind mount inside an unrelated private user/mount namespace is insufficient because the server will not see it.
Root or the container/worker supervisor normally has the necessary authority.
An ordinary agent process inside its bwrap mount namespace does not.
### What remains mutable even with a stable root fd

A stable directory fd fixes replacement of the mount root and its ancestors after acquisition.
It does not make directory contents immutable.
Host writers can still add, remove, or alter files beneath the directory, which may be intentional for a live mount.
A privileged host actor may also add a submount beneath the retained root before a later recursive bind.
If the security property requires a frozen mount topology rather than stable root identity, capture a detached mount tree with `open_tree(OPEN_TREE_CLONE)` at creation or prohibit/revalidate submounts.
That stronger property is not stated by #1123.
## 3. Bubblewrap semantics settle the central question

Ordinary bwrap bind options do not trust Node's earlier canonicalization in any object-identity sense.
They receive only text.
The text must be converted to bwrap's old-root source pathname.
Bwrap probes that source during `setup_newroot()`.
It then passes the source pathname into its recursive bind implementation.
Linux pathname lookup occurs against the namespace state at that time.
The earlier Node `realpath()` is unknown to bwrap and cannot constrain that lookup.
This confirms rather than moots the claim.
The relevant upstream source is:
<https://github.com/containers/bubblewrap/blob/main/bubblewrap.c#L3700-L3721>
and:
<https://github.com/containers/bubblewrap/blob/main/bubblewrap.c#L3783-L3802>
The Linux bind-mount semantics are documented at:
<https://man7.org/linux/man-pages/man2/mount.2.html>
Bubblewrap also exposes the already-open-object alternative at `bubblewrap.c:2721-2723`:
```c
" --bind-fd FD DEST Bind open directory or path fd on DEST\n"
" --ro-bind-fd FD DEST Bind open directory or path fd read-only on DEST\n"
```
The upstream 0.10.0 release notes say the option mounts a filesystem represented by a file descriptor without TOCTOU attacks.
The release notes are:
<https://github.com/containers/bubblewrap/releases/tag/v0.10.0>
The same change was backported in 0.6.3:
<https://github.com/containers/bubblewrap/releases/tag/v0.6.3>
Therefore the comment in `resolveEnvironmentMounts.ts:36-38` is factually wrong:
```ts
full elimination would require fd-based
binds (open the directory once, bind the fd), which bwrap's CLI contract
does not offer today.
```
The local execution environment has bubblewrap 0.11.0 and its help lists both fd-bind options.
That local observation is consistent with upstream, but upstream source and release notes are the controlling evidence.
## 4. Resolve once versus resolve per exec

The plan's race comparison is unsound.
Resolve-once does not close a race and then keep it closed.
It checks once and performs an unbounded series of later pathname uses.
For `N` execs, its structure is:
```text
check(path) ---------------- use(path) --- use(path) --- ... --- use(path)
```
Every use is capable of selecting whatever object the stored pathname denotes then.
The attacker does not need to win a narrow scheduling window.
After pair creation, the attacker can replace the entry, leave it replaced, and wait for any later exec.
That is a persistent substitution opportunity.
Resolve-per-exec with the same string-only bind would have this structure:
```text
check(path) -> use(path)
check(path) -> use(path)
...
```
It still has a check-to-bind race on each exec.
It is not a complete fix.
It creates `N` short race windows, but it also revalidates immediately before each use.
For an attacker who can leave the malicious entry in place, complete per-exec validation detects the changed canonical result or at least evaluates the current result rather than silently relying on stale identity.
For an attacker who must swap and restore without being observed, per-exec validation forces tighter timing.
Resolve-once is therefore worse for root-identity drift over a long-lived pair.
It changes a bounded timing race into a long-lived stale-name problem.
The only valid concern in the plan is different: re-running `realpath(mount.sourceRoot)` on an attacker-controlled original symlink can choose a new target on every exec.
That argues for a stable handle, not for caching a resolved string.
The correct structure is:
```text
open-and-validate(stable handle) -> use(handle) -> use(handle) -> ...
```
Revalidation per exec can be useful defense in depth for liveness, access changes, or mount health.
It is not the identity primitive.
## 5. Candidate primitives and target-runtime availability

### `O_PATH` directory descriptors

`O_PATH` has existed since Linux 2.6.39.
An open descriptor is a stable reference to the selected filesystem object across later renames and pathname replacement.
The Linux documentation is:
<https://man7.org/linux/man-pages/man2/open.2.html>
Holding one descriptor per source for the pair lifetime closes final-component replacement and ancestor replacement after the descriptor is acquired.
It also avoids requiring read permission merely to hold the directory reference.
`O_PATH` alone does not make acquisition safe.
`open(path, O_PATH | O_DIRECTORY | O_NOFOLLOW)` rejects a final symlink but may still follow symlinks in intermediate components.
It also does not prohibit crossing a bind mount.
The descriptor must be acquired through a safe walk, and all directory/type/overlap policy must be evaluated on that stable object or its stable ancestry.
Node 22's exposed `fs.constants` on the inspected host contains `O_DIRECTORY` and `O_NOFOLLOW` but not `O_PATH`.
Node accepts numeric flags, so a Linux-specific helper can use the ABI constant, but hard-coding it in portable TypeScript is undesirable.
A small native helper or an fd-anchored component walk is appropriate.
### `openat2`

`openat2()` was added in Linux 5.6.
`RESOLVE_NO_SYMLINKS` rejects symlinks in every component.
`RESOLVE_BENEATH` prevents resolution above or outside an already-open trusted directory root.
`RESOLVE_NO_MAGICLINKS` should also be used.
`RESOLVE_NO_XDEV` is the flag that additionally blocks ordinary and bind-mount crossings.
The kernel documentation is:
<https://www.kernel.org/doc/html/v6.2/filesystems/path-lookup.html>
and:
<https://man7.org/linux/man-pages/man2/openat2.2.html>
The combination in the question closes symlink escape beneath a trusted source anchor.
It does not by itself block a bind-mount shadow; add `RESOLVE_NO_XDEV` if crossing mounts is not valid for that source class.
That flag may reject legitimate FUSE/S3/direct sources, so mount-crossing policy must be explicit rather than globally assumed.
The bwrap host kernel in the inspected environment is 6.14 and supports `openat2`.
The deployed host kernel floor for every local-bwrap installation is not pinned in PR #1166: UNVERIFIED.
The code must preflight Linux >=5.6 or provide an equivalent fd-by-fd `openat(..., O_NOFOLLOW)` walk.
The repository's tested gVisor guest reports `4.19.0-gvisor`, and the current real-runsc evidence explicitly records `openat2` as `ENOSYS`.
That guest limitation is irrelevant to acquiring a host bind-source fd before launching a container.
A host-side worker helper runs on the host kernel, not the gVisor guest kernel.
### `open_tree`, `move_mount`, `fsopen`, and `fsmount`

The fd-based mount API arrived in Linux 5.2.
`open_tree(path, OPEN_TREE_CLONE)` captures a detached bind-mount object and returns a mount fd.
`move_mount(..., MOVE_MOUNT_F_EMPTY_PATH)` attaches such a mount object without re-walking the source path.
The documentation and example are:
<https://man7.org/linux/man-pages/man2/open_tree.2.html>
and:
<https://man7.org/linux/man-pages/man2/move_mount.2.html>
This pair is the strongest fit if the desired invariant includes retaining a mount-tree object created at pair creation.
`fsopen()` and `fsmount()` create/configure new filesystem instances.
They are not the minimal mechanism for binding an existing directory subtree; `open_tree` is.
These operations require appropriate mount-namespace capability, normally `CAP_SYS_ADMIN` in the namespace that owns the operation.
Bubblewrap can perform mounts after establishing its user/mount namespaces, but PR #1166 has no API for passing a mount fd and no implementation using the new mount API.
Node has no standard high-level wrappers for these syscalls in the project.
Using them would require a native helper and more lifecycle code than `--bind-fd`.
### Bubblewrap `--bind-fd` and `--ro-bind-fd`

These options directly solve the root path substitution at issue.
Acquire the source fd once, retain it, duplicate it into each child through `spawn(..., { stdio })`, and emit the child fd number instead of a source path.
Node child-process stdio duplicates a parent's supplied fd to the child descriptor matching the stdio-array index.
The official Node child-process documentation describes that mapping:
<https://nodejs.org/api/child_process.html#optionsstdio>
Feature availability is not a monotonic `version >= 0.6.3` check because 0.6.3 was a backport while the mainline feature arrived in 0.10.0.
Feature-detect `--bind-fd` in `bwrap --help`, or pin a known version.
PR #1166 does neither.
`apps/full-app/Dockerfile:64-74` and `:147-158` install the unpinned distribution `bubblewrap` package from mutable `node:22-slim`.
The CI workflow likewise runs unpinned `apt-get install -y bubblewrap`.
Exact bwrap support across all images/runners targeted by the repository is therefore UNVERIFIED.
The safe behavior on a host without fd-bind is fail closed for non-empty environment mounts with a stable availability error.
Empty-mount behavior can continue using the existing bwrap support.
### Docker and runsc/gVisor

The runsc runtime currently on `origin/main` does not consume the #1123 environment-mount contract.
Its workspace launch path emits a string:
`packages/boring-sandbox/src/providers/runsc/runtime/dockerArgv.ts:103-105`
```ts
"--mount",
`type=bind,src=${profile.workspaceMountSource},dst=/workspace,readonly=${...}`,
```
That string crosses the Node-to-Docker-daemon-to-OCI-runtime boundary.
The OCI mount source is also a pathname, not a provider-owned fd in this API.
GVisor documents that its gofer/directfs path donates file descriptors for mount points to the sandbox after runtime setup:
<https://gvisor.dev/docs/user_guide/filesystem/#directfs>
That protects guest traversal from escaping the filesystem trees the gofer selected.
It does not prove that the earlier Docker/OCI source-string selection is atomic with this application's validation.
Stock Docker CLI has no `--mount-fd` equivalent in the code path used by this repository.
Whether the exact pinned future Docker/containerd/runsc cohort safely opens every OCI bind source without a pre-open pathname race is UNVERIFIED.
To settle that future provider question, pin the daemon, containerd/runc, and runsc commits, then trace their bind-source acquisition from the OCI spec string to the gofer/directfs donated fd and run an adversarial rename/symlink test during create.
The current #1123 plan itself says runsc is qualification-only for this epic and that no gVisor work is included.
Accordingly, runsc support does not refute the bwrap finding and must receive its own provider primitive before environment mounts are claimed there.
## 6. Actual exploitability

### The agent itself

No, not through the paths exposed by PR #1166.
The bwrap agent receives its primary workspace at `/workspace` and named mounts under `/mnt/<fsid>`.
Named v1 mounts are planned read-only.
The resolver rejects a named source equal to, above, or below the primary workspace root.
The agent therefore does not obtain the host parent directory entry that must be renamed to swap the named source root.
A read-only bind of the source directory also does not grant mutation of the source entry in its host parent.
An agent that can modify files inside an intentionally read-write source can change those files, but that is authorized content mutation, not replacement of the bind source root.
An internal symlink beneath a bind root resolves in the sandbox's namespace and does not by itself jump to an arbitrary host path outside the exposed mount tree.
### Another tenant

No evidence shows such access.
Another tenant's bwrap namespace exposes its own workspace, not `/srv/boring/sources/...` parent directories for this tenant.
Sharing a host UID is not alone enough; the process must also be able to name and mutate the relevant host parent entry in its namespace.
The inspected code does not grant that.
If deployment later runs tenant commands directly on the host, mounts a common writable source parent, or exposes a shared writable FUSE parent, this answer changes.
Those are deployment/provider facts and must be rejected or explicitly qualified before enabling mounts.
### Co-located same-UID process

Potentially yes.
The full-app/worker process runs as the `boring` service user for writable data under `/data`.
Any separately compromised process running with that UID and a namespace view of a writable source parent can perform the rename/symlink sequence.
Plugin or server code running in-process already has broad host authority and usually would not need this particular exploit, but a separately confined same-UID helper may make the distinction meaningful.
The repository does not establish that arbitrary untrusted code is co-located with that host access.
### Host administrator or supervisor

Yes, but that actor is already trusted at a stronger boundary.
Root or a supervisor with host-mount `CAP_SYS_ADMIN` can perform the bind-mount-shadow attack.
Such an actor can generally read or remount the same data directly.
This is not a tenant-to-host privilege escalation against a malicious administrator threat model.
### Future direct sources and view mounts

The first planned direct source is an agent package's `knowledge/` directory.
Repo/image package content in the production image is root-owned and not writable by the sandbox agent.
Workspace-installed package paths under the primary workspace would be rejected by the current source/workspace overlap rule if passed directly.
Future host FUSE view mountpoints are created above the provider and passed as ordinary directories.
Their parent-directory ownership and helper isolation are not implemented in slice 1.
They must be created in a host-only, per-lease directory not mutable by tenant processes.
### Present reachability

The production grep of the PR head finds `mounts:` values only in tests and the new bwrap provider internals.
No slice-1 agent/environment code derives a real mount set and places it in `SandboxProviderCreateContextV1`.
The plan assigns that plumbing to slice 2 and grant derivation to slice 3.
With `BORING_ENV_MOUNTS` unset, `resolveContextMounts()` returns an empty array at `shared/mounts.ts:55-60`.
Thus the vulnerable named-mount branch is dormant in the current application.
An external library consumer could manually call the provider with `context.mounts` and set the flag, but that is an explicit opt-in to the incomplete substrate.
### Exploitability classification

The primitive is real.
The current untrusted agent lacks the required host pathname access.
Another tenant lacks it on the inspected wiring.
The currently plausible actor is a co-located host process with relevant Unix permissions, or a privileged host actor.
Therefore this is hardening before feature enablement, not a present cross-tenant merge blocker.
## Minimal fix against PR #1166

The fix must preserve an object, not a name.
The following diff shows the minimum architecture.
`openStableDirectory()` in this diff is a Linux-only helper that must perform an fd-anchored component walk or `openat2()` beneath a trusted host source anchor, return an `O_PATH|O_DIRECTORY` handle, and report stable ancestry metadata for the workspace-overlap test.
It must not be implemented as `realpath()` followed by ordinary `open()` because that merely moves the race.
```diff
diff --git a/packages/boring-sandbox/src/providers/bwrap/resolveEnvironmentMounts.ts b/packages/boring-sandbox/src/providers/bwrap/resolveEnvironmentMounts.ts
index NEW..FIXED 100644
--- a/packages/boring-sandbox/src/providers/bwrap/resolveEnvironmentMounts.ts
+++ b/packages/boring-sandbox/src/providers/bwrap/resolveEnvironmentMounts.ts
@@
-import { realpath, stat } from 'node:fs/promises'
+import type { FileHandle } from 'node:fs/promises'
 import { sep } from 'node:path'
+import { openStableDirectory, sameOrAncestor } from './stableDirectory'
@@
+export interface ResolvedBwrapMount extends SandboxEnvironmentMountV1 {
+  /** Pair-lifetime handle; never serialized or exposed through shared contracts. */
+  readonly sourceHandle: FileHandle
+}
+
 export async function resolveEnvironmentMounts(
   workspaceRoot: string,
   mounts: readonly SandboxEnvironmentMountV1[],
-): Promise<readonly SandboxEnvironmentMountV1[]> {
+): Promise<readonly ResolvedBwrapMount[]> {
   if (mounts.length === 0) return []
 
-  const resolvedWorkspaceRoot = await realpath(workspaceRoot)
-  const resolved: SandboxEnvironmentMountV1[] = []
+  const workspace = await openStableDirectory(workspaceRoot)
+  const resolved: ResolvedBwrapMount[] = []
+  const opened: FileHandle[] = [workspace.handle]
+  try {
   for (const mount of mounts) {
-    let sourceRoot: string
     try {
-      sourceRoot = await realpath(mount.sourceRoot)
+      const source = await openStableDirectory(mount.sourceRoot)
+      opened.push(source.handle)
+      if (sameOrAncestor(source.ancestry, workspace.ancestry)) {
+        throw invalid(`mount source root must not alias the primary workspace root: ${mount.sourceRoot}`)
+      }
+      for (const prior of resolved) {
+        if (sameOrAncestor(source.ancestry, prior.sourceAncestry)) {
+          throw invalid(`duplicate or overlapping mount source root: ${mount.sourceRoot}`)
+        }
+      }
+      resolved.push({
+        ...mount,
+        sourceRoot: source.canonicalPath,
+        sourceHandle: source.handle,
+        sourceAncestry: source.ancestry,
+      })
     } catch (error) {
       throw invalid(
-        `mount source root does not exist: ${mount.sourceRoot}`,
+        `mount source root is not a stable directory: ${mount.sourceRoot}`,
         error,
       )
     }
-
-    const stats = await stat(sourceRoot)
-    if (!stats.isDirectory()) {
-      throw invalid(`mount source root is not a directory: ${mount.sourceRoot}`)
-    }
-    // string-only containment and overlap checks removed
-    resolved.push({ ...mount, sourceRoot })
   }
-
+  await workspace.handle.close()
+  opened.shift()
   return resolved
+  } catch (error) {
+    await Promise.allSettled(opened.map((handle) => handle.close()))
+    throw error
+  }
 }
diff --git a/packages/boring-sandbox/src/providers/bwrap/buildBwrapArgs.ts b/packages/boring-sandbox/src/providers/bwrap/buildBwrapArgs.ts
index NEW..FIXED 100644
--- a/packages/boring-sandbox/src/providers/bwrap/buildBwrapArgs.ts
+++ b/packages/boring-sandbox/src/providers/bwrap/buildBwrapArgs.ts
@@
+export interface BwrapFdMount {
+  readonly childFd: number
+  readonly logicalPath: string
+  readonly access: 'ro' | 'rw'
+}
@@
-  mounts?: readonly SandboxEnvironmentMountV1[]
+  mounts?: readonly BwrapFdMount[]
@@
   for (const mount of mounts) {
     args.push(
-      mount.access === 'rw' ? '--bind' : '--ro-bind',
-      mount.sourceRoot,
+      mount.access === 'rw' ? '--bind-fd' : '--ro-bind-fd',
+      String(mount.childFd),
       mount.logicalPath,
     )
   }
diff --git a/packages/boring-sandbox/src/providers/bwrap/createBwrapSandbox.ts b/packages/boring-sandbox/src/providers/bwrap/createBwrapSandbox.ts
index NEW..FIXED 100644
--- a/packages/boring-sandbox/src/providers/bwrap/createBwrapSandbox.ts
+++ b/packages/boring-sandbox/src/providers/bwrap/createBwrapSandbox.ts
@@
-  mounts?: readonly SandboxEnvironmentMountV1[]
+  mounts?: readonly ResolvedBwrapMount[]
@@
     async init(ctx) {
       ...
       await assertBwrapAvailable()
+      if (sandboxOptions.mounts?.length) await assertBwrapBindFdAvailable()
@@
     async exec(cmd, opts) {
@@
+      const fdMounts = (sandboxOptions.mounts ?? []).map((mount, index) => ({
+        childFd: 3 + index,
+        logicalPath: mount.logicalPath,
+        access: mount.access,
+      }))
       const baseArgs = buildBwrapArgs(workspaceRoot, {
         ...
-        mounts: sandboxOptions.mounts,
+        mounts: fdMounts,
       })
@@
       const child = spawn('bwrap', args, {
         env: { ... },
-        stdio: ['ignore', 'pipe', 'pipe'],
+        // Node duplicates each parent fd to the stdio-array index in the child.
+        stdio: [
+          'ignore',
+          'pipe',
+          'pipe',
+          ...(sandboxOptions.mounts ?? []).map((mount) => mount.sourceHandle.fd),
+        ],
         detached: process.platform !== 'win32',
       })
@@
+    async dispose() {
+      await Promise.allSettled(
+        (sandboxOptions.mounts ?? []).map((mount) => mount.sourceHandle.close()),
+      )
+    },
diff --git a/packages/boring-sandbox/src/providers/bwrap/createBwrapProvider.ts b/packages/boring-sandbox/src/providers/bwrap/createBwrapProvider.ts
index NEW..FIXED 100644
--- a/packages/boring-sandbox/src/providers/bwrap/createBwrapProvider.ts
+++ b/packages/boring-sandbox/src/providers/bwrap/createBwrapProvider.ts
@@
       const mounts = await resolveEnvironmentMounts(...)
@@
       try {
         await sandbox.init?.(...)
       } catch (error) {
+        await Promise.allSettled(mounts.map((mount) => mount.sourceHandle.close()))
         ...
       }
diff --git a/packages/boring-sandbox/src/providers/bwrap/__tests__/resolveEnvironmentMounts.test.ts b/packages/boring-sandbox/src/providers/bwrap/__tests__/resolveEnvironmentMounts.test.ts
index NEW..FIXED 100644
--- a/packages/boring-sandbox/src/providers/bwrap/__tests__/resolveEnvironmentMounts.test.ts
+++ b/packages/boring-sandbox/src/providers/bwrap/__tests__/resolveEnvironmentMounts.test.ts
@@
+test('binds the create-time inode after source pathname replacement', async () => {
+  // Resolve/open source A, atomically replace its pathname with symlink to B,
+  // exec bwrap, and assert /mnt/knowledge contains A and never B.
+})
+
+test('rejects intermediate symlink swap during stable open', async () => {
+  // Race every component; success is either original inode or stable invalid,
+  // never the symlink target.
+})
+
+test('closes all source handles on validation failure, init failure, and dispose', async () => {})
+
+test('fails closed when non-empty mounts meet bwrap without bind-fd', async () => {})
```
The shared `SandboxEnvironmentMountV1` contract should remain path-shaped because other providers may consume paths.
The fd and ancestry types are bwrap-provider-private and must not enter `src/shared/**`.
The stable-open helper must anchor sources under a host-owned allowed root.
If arbitrary absolute source roots must remain supported, the helper must at least do an fd-by-fd no-symlink walk and validate the resulting stable ancestry against the stable workspace ancestry.
For source classes that must not cross host mounts, it must use `RESOLVE_NO_XDEV` or equivalent mount-id checks.
`assertBwrapBindFdAvailable()` should inspect `bwrap --help` for both required flags and fail before any command runs.
Pinning bubblewrap 0.10+ in the runtime image is preferable to relying on mutable distribution packages, while retaining feature detection for non-image local deployments.
## Landing decision

The bug is in the provider substrate's claimed security property, but the vulnerable feature path is not reachable from current application wiring.
PR #1166 may merge with an explicit follow-up gate.
The fd fix does not have to be physically included in slice 1.
It must be a hard dependency of the first slice that passes a non-empty mount set in production and of any deployment that enables `BORING_ENV_MOUNTS=1`.
Do not retain the current comments claiming the race is bounded to create time or that bwrap lacks fd binds.
If maintainers intend slice 1's exported provider contract to be safe for immediate external opt-in, then the fd fix belongs in #1166 before merge.
For the repository's own staged rollout as currently coded, it can follow because flag-off behavior supplies no named binds and slice 2/3 plumbing has not landed.
The unambiguous release gate is:
```text
No non-empty bwrap environment mount may execute until stable source handles
are retained for the pair lifetime and bwrap consumes them through --bind-fd
or --ro-bind-fd, with unsupported bwrap versions failing closed.
```
That settles the review claim without overstating current exploitability.
