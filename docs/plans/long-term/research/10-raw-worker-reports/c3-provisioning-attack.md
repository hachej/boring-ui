# Provisioning adversarial review

Evidence basis: `origin/main` only. All paths and line numbers below refer to that revision.
## Finding 1 — Workspace content becomes unsandboxed host code

Severity: FATAL Attack area: trust / self-escalation.
Exact failing sequence:

1. An agent with ordinary workspace write access creates `.pi/extensions/pwn/package.json`.
2. The manifest declares a canonical plugin id and `"boring": { "server": "server.js" }`.
3. The agent writes `server.js` using `node:fs`, `process.env`, network clients, or any other authority of the application host.
4. An authenticated reload occurs, or the workspace server restarts/opens.
5. External plugin discovery scans the agent-writable `.pi` roots.
6. The scanner resolves `boring.server` to the attacker-controlled file.
7. `RuntimeBackendRegistry` imports that file in the unsandboxed Node host and invokes its route-registration function.

Observable symptom:

- Attacker JavaScript executes with host-process privileges, outside the workspace sandbox.
- Secrets, host files, databases, and control-plane APIs reachable by the host become reachable to workspace-authored code.
- The workspace-id check only limits route dispatch after import; it does not limit module evaluation.

Evidence:

- `packages/workspace/src/app/server/createWorkspaceAgentServer.ts:1005-1026` enables external discovery and includes workspace `.pi/extensions`, `.pi/npm`, `.pi/git`, and `.pi/settings.json` sources.
- `packages/workspace/src/app/server/createWorkspaceAgentServer.ts:1255-1262` makes external plugins enabled unless explicitly disabled.
- `packages/workspace/src/server/agentPlugins/scan.ts:320-359` resolves `package.json#boring.server` and retains `serverPath` in the loaded plugin.
- `packages/workspace/src/app/server/createWorkspaceAgentServer.ts:1584-1593` reloads loaded plugins into the runtime backend registry.
- `packages/workspace/src/app/server/createWorkspaceAgentServer.ts:2083-2087` performs the same backend load during server startup.
- `packages/workspace/src/server/runtimeBackend/runtimeBackendRegistry.ts:226-255` filters external plugins, calls `importServerModule(serverPath, true)`, then invokes `runtimePlugin.routes(...)`.
- `packages/workspace/src/server/runtimeBackend/runtimeBackendRegistry.ts:186-191` checks workspace ownership only during dispatch, after code import.

Concrete fix:

- Never import a module originating in an agent-writable workspace into the host process.
- Default external executable plugins to disabled in production.
- Require an administrator-approved, immutable, content-digested registry for host plugins.
- Run workspace plugins in a capability sandbox with no ambient host authority.
- Separate inert Pi resources from executable backend registration so skill or prompt discovery cannot silently grant server-code authority.
## Finding 2 — A live runtime is destructively reprovisioned during reload

Severity: SERIOUS Attack area: partial provisioning / concurrency / idempotency.
Exact failing sequence:

1. Agent A is running a command from `.boring-agent/node` or `.boring-agent/venv`.
2. A reload enters `applyReload` and calls `runRuntimeProvisioning` against the already-published runtime bundle.
3. Node provisioning recursively removes `.boring-agent/node` before `npm install` succeeds.
4. Python provisioning recursively removes `.boring-agent/venv` before the new venv and packages succeed.
5. The install fails, times out, or overlaps a second reload.
6. Agent A continues serving from the same binding, but its PATH now points at missing or half-installed trees.

Observable symptom:

- Running or subsequent commands fail with `ENOENT`, missing module, broken console-script shebang, or partially installed dependency errors.
- Unlike initial environment creation, reload mutates an environment that is already serving requests.

Evidence:

- `packages/workspace/src/app/server/createWorkspaceAgentServer.ts:1423-1442` provisions directly into the current runtime layout.
- `packages/workspace/src/app/server/createWorkspaceAgentServer.ts:1946-1952` invokes that provisioner from reload.
- `packages/agent/src/server/workspace/provisioning/node.ts:143-171` removes the whole Node runtime before installing and writing its fingerprint.
- `packages/agent/src/server/workspace/provisioning/python.ts:232-265` removes the whole venv before recreating, installing, and marking it.

Concrete fix:

- Serialize all provisioning by canonical writable workspace identity.
- Install into immutable generation directories.
- Validate expected binaries/imports and atomically swap one active-generation pointer.
- Retain the previous generation until process/request leases drain.
- Roll back to the old generation on any phase failure.
## Finding 3 — Same-workspace provisioning has no global serialization

Severity: SERIOUS Attack area: concurrency.
Exact failing sequence:

1. Two requests resolve the same `workspaceScopeId` but different `placementIdentity` values that still map to the same writable root.
2. `EnvironmentLeaseManager` creates two records because placement is part of the key.
3. Both generations enter provisioning concurrently.
4. Both remove/recreate `.boring-agent/skills`, Node, or Python trees.
5. Both check for the same absent content-addressed artifact.
6. Both pack it; the first copy wins and the second copy receives `EEXIST` from the local adapter.
7. One otherwise valid environment fails; worse interleavings leave npm or uv writing into a directory the peer removes.

Observable symptom:

- Nondeterministic `EEXIST`, missing skills, corrupt `package-lock.json`, broken site-packages, or one agent type failing to start.

Evidence:

- `packages/agent/src/server/agent-host/environmentLease.ts:66-90` keys records by `[workspaceScopeId, placementIdentity]` and checks incompatible fingerprints only inside one such key.
- `packages/agent/src/server/agent-host/environmentLease.ts:127-148` performs provider creation and provisioning independently for each record.
- `packages/agent/src/server/workspace/provisioning/skills.ts:42-67` removes and rebuilds the shared skill tree.
- `packages/agent/src/server/workspace/provisioning/packArtifact.ts:100-113` implements a non-atomic exists-then-copy cache fill.
- `packages/agent/src/server/runtime/modes/provisioningAdapter.ts:205-213` copies with `force: false, errorOnExist: true`.

Concrete fix:

- Add a single-process and, for hosted deployments, distributed provisioning lock keyed by canonical physical workspace/root.
- Include delete, drain, initial acquire, reload, and artifact publication in the same fenced lifecycle.
- Publish artifacts by temp-name plus atomic rename; on `EEXIST`, verify digest and treat an identical winner as success.
## Finding 4 — Initial partial failure is retried, but durable damage remains

Severity: SERIOUS Attack area: partial provisioning.
Exact failing sequence:

1. A new environment completes layout and deletes the previous generated skill mirror.
2. It copies only some skills, or completes skills and templates.
3. Node or Python installation then fails.
4. Environment creation rejects and disposes the provider bundle.
5. No degraded binding is published for that initial request.
6. The mutated workspace remains on disk with an empty/partial skill mirror, seeded files, and possibly absent/partial runtimes.
7. A later request creates a new environment and retries from that residue.

Observable symptom:

- The failing request receives a provisioning error.
- Out-of-band readers, an older live binding, or direct workspace inspection see partial generated state between attempts.
- Retry is a fresh rerun, not a resume or rollback.

Evidence:

- `packages/agent/src/server/workspace/provisioning/provisionWorkspaceRuntime.ts:153-220` orders layout, skill mirror, workspace files, Node, then Python.
- `packages/agent/src/server/workspace/provisioning/skills.ts:42-67` destroys the old mirror before copying the new one.
- `packages/agent/src/server/agent-host/environmentLease.ts:91-105` removes a failed unreferenced record.
- `packages/agent/src/server/agent-host/environmentLease.ts:127-152` disposes the provider bundle when provisioning throws.

Concrete fix:

- Treat the entire generated runtime as a transaction.
- Stage every mutable phase under one generation id, write a complete manifest, validate it, then atomically publish.
- Preserve the previous generation on failure and garbage-collect abandoned staging generations later.
## Finding 5 — Environment fingerprint hashes labels, not behavior

Severity: SERIOUS Attack area: provisioning fingerprint / stale environment.
Exact failing sequence:

1. A workspace acquires an environment for plugin id `macro`.
2. Trusted plugin code changes its SKILL.md, template bytes, package version, Python env, expected bins, or local source while retaining the same plugin id.
3. A normal later request resolves the same workspace and placement without an explicit reload.
4. The caller computes the same environment provisioning fingerprint because it includes ids, mode, and root—not contribution content/configuration.
5. `EnvironmentLeaseManager` reuses the existing generation and never invokes provisioning.
6. The new request receives the old skill mirror, runtime packages, and env snapshot.

Observable symptom:

- Deployment/configuration changes appear accepted but ordinary agents continue using stale behavior until explicit retirement/reload/restart.

Evidence:

- `packages/workspace/src/app/server/createWorkspaceAgentServer.ts:1397-1411` builds real provisioning inputs containing skills and runtime specs.
- `packages/workspace/src/app/server/createWorkspaceAgentServer.ts:1631-1649` fingerprints only mode/root and contribution/plugin ids.
- `packages/core/src/app/server/createCoreWorkspaceAgentServer.ts:1415-1430` likewise feeds ids and root/template strings rather than contribution bytes to the environment identity.
- `packages/agent/src/server/agent-host/runtimeScopeIdentity.ts:20-26,69-78` defines the fingerprint fields: placement, provider digest, sorted artifact digests, generation, and optional template digest.
- `packages/agent/src/server/agent-host/environmentLease.ts:71-100` returns the cached generation when key/fingerprint match.

Concrete fix:

- Canonically digest the complete merged provisioning contract and the bytes of every referenced skill, template, package artifact, lockfile, and bootstrap input before lease acquisition.
- Put those real digests in `provisioningArtifactDigests`.
- Make callers unable to pass ids mislabeled as digests.
## Finding 6 — Explicit reload still skips changed local package bytes

Severity: SERIOUS Attack area: provisioning fingerprint / stale runtime.
Exact failing sequence:

1. Provision a local Node `packageRoot` or Python `projectFile`.
2. Edit implementation/build output in place without changing id, path, version, env, or expected bins.
3. Trigger explicit reload.
4. Runtime fingerprints remain unchanged because they hash spec metadata and tool versions, not source content.
5. Existing marker and output paths pass the skip test.
6. npm/uv installation is skipped, leaving the old installed bytes.

Observable symptom:

- Reload reports success/unchanged while commands execute the pre-edit package.
- A bare registry package without a version can also remain pinned to an old install even when registry `latest` changes.

Evidence:

- `packages/agent/src/server/workspace/provisioning/fingerprint.ts:52-64` hashes Node metadata/path strings only.
- `packages/agent/src/server/workspace/provisioning/fingerprint.ts:67-85` does the same for Python.
- `packages/agent/src/server/workspace/provisioning/node.ts:108-140` uses that fingerprint for both skip logic and artifact naming.
- `packages/agent/src/server/workspace/provisioning/python.ts:193-229` uses the same metadata-only pattern.
- `packages/agent/src/server/workspace/provisioning/node.ts:64-66` permits an unversioned registry package name.

Concrete fix:

- Resolve immutable install artifacts first and hash their bytes.
- Use artifact digest plus exact resolved dependency/lock digest as runtime identity.
- Require exact registry versions or persist and compare the resolved version.
## Finding 7 — Agent-controlled markers pin malicious runtime executables

Severity: SERIOUS Attack area: idempotency / trust.
Exact failing sequence:

1. A valid Node runtime is provisioned.
2. The agent replaces `.boring-agent/node/node_modules/.bin/<expectedBin>` with a malicious script while leaving `.fingerprint` and `package-lock.json` present.
3. Reprovisioning reads the agent-writable fingerprint and tests only output existence.
4. It returns `changed: false` and places the tampered bin directory on PATH.
5. A later agent invokes the trusted command name and executes attacker content.

Python variant:

1. Leave `.boring-agent/venv/.fingerprint` in place.
2. Replace packages/interpreter or delete most of the venv.
3. With no `expectedBins`, the Python skip check deliberately skips checking the interpreter symlink and checks no other output.
4. Provisioning accepts the tampered/broken venv unchanged.

Evidence:

- `packages/agent/src/server/workspace/provisioning/node.ts:68-95` checks only package-lock and declared bin path existence.
- `packages/agent/src/server/workspace/provisioning/node.ts:108-125` accepts that marker/output combination as unchanged.
- `packages/agent/src/server/workspace/provisioning/python.ts:132-176` skips the venv interpreter and only checks optional expected bins.
- `packages/agent/src/server/workspace/provisioning/python.ts:202-213` returns unchanged on that weak check.

Concrete fix:

- Store signed/host-owned provisioning manifests outside agent-writable storage, or authenticate them with a host secret.
- Validate file type, ownership, mode, and digest for every executable/imported output.
- Prefer immutable generations mounted read-only to the agent.
## Finding 8 — Workspace skills and extensions persistently influence later agents

Severity: SERIOUS Attack area: trust / silent behavior change.
Exact failing sequence:

1. An agent writes `.pi/settings.json` or a package under `.pi/extensions`.
2. It registers malicious `pi.skills`, `pi.extensions`, or Pi packages without a `boring.server` entry.
3. Reload rescans the workspace package metadata.
4. Hot resources are merged into the next binding/session.
5. Later agents consume attacker-authored instructions or extension code as persistent workspace configuration.

Observable symptom:

- Subsequent agents receive poisoned prompts/skills or Pi extension behavior without an explicit human approval event.

Evidence:

- `packages/workspace/src/app/server/createWorkspaceAgentServer.ts:1019-1026` discovers workspace-controlled Pi sources.
- `packages/workspace/src/app/server/createWorkspaceAgentServer.ts:1360-1387` refreshes package skills/packages/extensions dynamically.
- `packages/agent/src/server/agent-host/runtimeCapabilityProjection.ts:233-250` merges hot resource paths/packages/extensions into Pi configuration.
- `packages/agent/src/server/agent-host/runtimeCapabilityProjection.ts:589-599` exposes the merged resources through runtime routes.

Concrete fix:

- Require explicit human approval for activation of new workspace resource registrations.
- Snapshot approved content digests and reject drift.
- Clearly label untrusted workspace-authored skills and keep executable extensions behind a stronger trust boundary.
## Finding 9 — Workspace deletion races provisioning and resurrects orphan bytes

Severity: SERIOUS Attack area: concurrency / cleanup.
Exact failing sequence:

1. Provisioning creates layout and begins copying skills or installing packages.
2. Workspace DELETE calls `provisioner.destroy(id)` and recursively removes the workspace root.
3. Provisioning advances to a later `mkdir` and recreates the root.
4. DELETE then removes the database workspace row.
5. Provisioning may finish into a directory no longer represented in the store.

Observable symptom:

- Orphan workspace bytes survive a successful delete.
- A sandbox/process can continue against a logically deleted workspace.
- The reverse interleaving yields confusing `ENOENT` provisioning failures.

Evidence:

- `packages/core/src/server/routes/workspaces.ts:193-250` destroys filesystem state and only then deletes the store record, with no runtime drain shown.
- `packages/core/src/server/provisioner/fsProvisioner.ts:38-47` recursively removes the workspace root.
- `packages/agent/src/server/workspace/provisioning/provisionWorkspaceRuntime.ts:153-220` has multiple later phases capable of recreating directories.

Concrete fix:

- Add a persistent workspace lifecycle state: active, draining, deleting, deleted.
- Acquire the same per-workspace fence for provisioning, leasing, and delete.
- Mark deleting first, reject new admissions, retire environments and processes, delete bytes/provider state, then commit logical deletion.
- Require generation tokens on every final publication.
## Finding 10 — Drain abort does not stop provisioning or its child process

Severity: SERIOUS Attack area: concurrency / cleanup.
Exact failing sequence:

1. npm or uv is running during environment creation.
2. Host drain aborts the environment record.
3. The provision callback only checks the signal before and after the entire provisioning pipeline.
4. Individual phases and adapter commands receive no abort signal.
5. Close waits at most its grace period and returns while provisioning continues mutating the workspace.
6. Minutes later the command completes/times out; only then can failure cleanup proceed.

Observable symptom:

- Shutdown appears complete while background provisioning keeps writing.
- Deploy/restart/delete can overlap the detached writer.

Evidence:

- `packages/agent/src/server/agent-host/environmentLease.ts:155-165` aborts records on drain.
- `packages/core/src/app/server/createCoreWorkspaceAgentServer.ts:1503-1533` checks abort only around the whole call.
- `packages/agent/src/server/workspace/provisioning/provisionWorkspaceRuntime.ts:134-220` has no signal parameter.
- `packages/agent/src/server/runtime/modes/provisioningAdapter.ts:80-122` spawns commands without an AbortSignal.
- `packages/agent/src/server/agent-host/environmentLease.ts:186-197` detaches disposal after the grace race loses.

Concrete fix:

- Plumb one AbortSignal through every phase, file copy, artifact pack, and exec.
- Track child process groups; terminate and reap them on abort.
- Remove abandoned staging generations.
- Report when shutdown detached unfinished cleanup.
## Finding 11 — Timeout creates a zombie writer and immediate retry race

Severity: SERIOUS Attack area: child-process cleanup.
Exact failing sequence:

1. Local/direct npm or uv spawns descendants.
2. The adapter timeout fires.
3. It sends SIGTERM only to the immediate child and immediately rejects the promise.
4. It does not wait for `close`, escalate to SIGKILL, or kill a process group.
5. Binding cleanup/retry starts a replacement install.
6. Surviving descendants from the first attempt keep writing into the same Node or venv tree.

Observable symptom:

- Corrupt dependency trees after a reported timeout.
- Duplicate package managers and unpredictable later failures.

Evidence:

- `packages/agent/src/server/runtime/modes/provisioningAdapter.ts:80-122` implements spawn, SIGTERM, and immediate settlement.
- `packages/agent/src/server/runtime/modes/providerAdapter.ts:81-84` owns only pair disposal; no provisioning-child registry is attached.

Concrete fix:

- Spawn a dedicated process group.
- On timeout/abort send SIGTERM, wait briefly, then SIGKILL the group.
- Settle only after `close` and confirmed reaping.
- Make adapter disposal drain the command registry before filesystem reuse.
## Finding 12 — Artifact temp directories leak on every cache miss

Severity: SERIOUS Attack area: cleanup.
Exact failing sequence:

1. A local or hosted artifact is absent from `.boring-agent/tmp`.
2. Resolver creates `/tmp/boring-agent-artifact-*`.
3. It packs a full tgz/tar.gz and copies it into the workspace.
4. Success returns without deleting the host temp directory.
5. Failure also throws without deleting it.
6. Every new fingerprint accumulates another full artifact indefinitely.

Observable symptom:

- `/tmp` disk exhaustion and eventual unrelated/provisioning failures.

Evidence:

- `packages/agent/src/server/workspace/provisioning/packArtifact.ts:100-116` creates but never removes `artifactDir`.
- `packages/boring-sandbox/src/providers/vercel-sandbox/provisioningAdapter.ts:122-140` duplicates the same leak in the provider package.

Concrete fix:

- Add `finally { rm(artifactDir, { recursive: true, force: true }) }` in both implementations.
- Preserve the primary error and log secondary cleanup failures.
- Consolidate the duplicate algorithms into one canonical helper.
## Finding 13 — Vercel handle-store failure orphans a paid persistent sandbox

Severity: SERIOUS Attack area: cleanup / failure atomicity.
Exact failing sequence:

1. `vercel.create` successfully creates a persistent sandbox.
2. `persistAndCache` attempts `store.put`.
3. Disk full, permission failure, or a store race makes `put` throw.
4. `createFresh` loses control without stopping the created handle.
5. Provider-level catch has not yet constructed workspace/sandbox wrappers, so it has nothing to dispose.

Observable symptom:

- A billed persistent sandbox remains alive but is absent from the durable handle store and may be unreachable by normal lookup.

Evidence:

- `packages/boring-sandbox/src/providers/vercel-sandbox/resolveSandboxHandle.ts:202-210` persists before caching and has no failure cleanup.
- `packages/boring-sandbox/src/providers/vercel-sandbox/resolveSandboxHandle.ts:282-328` creates then delegates to that persistence call.
- `packages/boring-sandbox/src/providers/vercel-sandbox/createVercelSandboxProvider.ts:542-545,568-585` does not retain the raw handle outside resolution.
- `packages/boring-sandbox/src/providers/vercel-sandbox/createVercelSandboxProvider.ts:726-736` can dispose only wrappers created later.

Concrete fix:

- Retain ownership of the raw handle until durable persistence succeeds.
- On store failure, stop/delete the created sandbox with bounded retries.
- Include the sandbox id in a typed recovery error and reconciliation log.
## Finding 14 — Vercel JSON handle store loses concurrent updates

Severity: SERIOUS Attack area: concurrency / durable-record corruption.
Exact failing sequence:

1. Workspace A and B resolve concurrently.
2. Both `put` operations read the same JSON snapshot.
3. Each adds only its own record.
4. Each writes and renames a whole-file replacement.
5. Last rename wins, silently deleting the other workspace record.
6. If pid and millisecond match, both operations can also select the same temp filename and interfere during rename/unlink.

Observable symptom:

- A sandbox handle disappears after an unrelated workspace is provisioned.
- Later lookup recreates/resumes incorrectly and can orphan the prior sandbox.

Evidence:

- `packages/boring-sandbox/src/providers/vercel-sandbox/FileHandleStore.ts:29-47` implements whole-file read/write persistence.
- `packages/boring-sandbox/src/providers/vercel-sandbox/FileHandleStore.ts:54-96` performs unlocked read-modify-write with pid/time temp naming.
- `packages/boring-sandbox/src/providers/vercel-sandbox/resolveSandboxHandle.ts:202-210` relies on this store for handle durability.

Concrete fix:

- Serialize mutations with an in-process mutex.
- Use unique `mkstemp` names.
- For multi-process deployments, use a transactional shared database or an OS file lock and merge while holding it.
## Finding 15 — Multi-instance Vercel provisioning races inside one remote sandbox

Severity: SERIOUS Attack area: hosted concurrency.
Exact failing sequence:

1. Two application instances receive first requests for the same workspace.
2. Each has an independent process-local in-flight map and local handle store.
3. Both resolve the same stable persistent sandbox name.
4. The already-exists fallback makes both resume the same remote sandbox.
5. Both run destructive provisioning concurrently inside its shared filesystem.

Observable symptom:

- Hosted-only npm/uv corruption, missing skill mirrors, and nondeterministic provisioning failures that cannot be reproduced in one local process.

Evidence:

- `packages/boring-sandbox/src/providers/vercel-sandbox/resolveSandboxHandle.ts:351-364` serializes only through process-local maps.
- `packages/boring-sandbox/src/providers/vercel-sandbox/resolveSandboxHandle.ts:282-315` uses a stable name and resumes on already-exists.
- `packages/boring-sandbox/src/providers/vercel-sandbox/createVercelSandboxProvider.ts:493-500` defaults to a local store/provider-local coordination.

Concrete fix:

- Acquire a distributed workspace+generation lease before remote handle resolution and provisioning.
- Fence every mutation with an owner epoch.
- Store handle and lease state transactionally in shared durable storage.
## Finding 16 — Direct/local and Vercel copy symlinks with different semantics

Severity: SERIOUS Attack area: cross-mode assumptions / trust.
Exact failing sequence:

1. A trusted provisioning source contains a symlink to a file outside the source root, or a symlink to a parent directory.
2. Direct/local `fs.cp` preserves/copies according to Node filesystem semantics.
3. Vercel's recursive copier uses `stat`, follows the symlink, and reads/descends into the target.
4. Hosted provisioning can copy out-of-tree host bytes into the sandbox or recurse through a cycle until failure.
5. Failure leaves a partially copied target because publication is not staged.

Observable symptom:

- Same contribution produces different bytes in different modes.
- Hosted mode may disclose host-side source-adjacent data or leave partial files.

Evidence:

- `packages/agent/src/server/runtime/modes/provisioningAdapter.ts:205-213` uses `cp` for local/direct copying.
- `packages/boring-sandbox/src/providers/vercel-sandbox/createVercelSandboxProvider.ts:305-328` uses `stat`, recursively follows directories, and reads target bytes.

Concrete fix:

- Use `lstat` consistently.
- Reject symlinks in provisioning inputs, or resolve them and prove containment under the declared source root.
- Define one provider-neutral copy manifest and conformance-test identical bytes across modes.
## Finding 17 — Vercel executable repair silently succeeds when it did nothing

Severity: SERIOUS Attack area: cross-mode semantics / silent degradation.
Exact failing sequence:

1. Template packaging records files without executable mode.
2. Hosted extraction leaves intended scripts at mode 0644.
3. Provider runs `chmod +x .../.boring-agent/bin/*`.
4. A read-only filesystem, missing command, or SDK failure makes chmod fail.
5. `2>/dev/null || true` converts failure to success and the provider ignores the result.
6. Runtime is declared ready with non-executable CLIs.

Observable symptom:

- Agent commands fail later with permission denied, far from provisioning.

Evidence:

- `packages/boring-sandbox/src/providers/vercel-sandbox/packageTemplate.ts:68-83` emits fixed non-executable tar modes.
- `packages/boring-sandbox/src/providers/vercel-sandbox/createVercelSandboxProvider.ts:385-391` suppresses chmod errors and does not check exit status.
- `packages/boring-sandbox/src/providers/vercel-sandbox/createVercelSandboxProvider.ts:620-635` treats the template-seed phase as successful afterward.

Concrete fix:

- Preserve executable modes in the tar manifest.
- Remove `|| true`, capture stderr, and fail provisioning if declared executable outputs are not executable.
- Add a post-seed executable probe.
## Finding 18 — runsc startup fails before reclaiming excessive leaked containers

Severity: FATAL Attack area: cleanup / restart recovery.
Exact failing sequence:

1. Crashes or cleanup failures leave more than 1,000 owned containers.
2. On startup, runsc lists owned containers.
3. It checks the count and throws before deleting the first container.
4. Every restart sees the same count and throws again.
5. No normal startup path can reduce the count below the threshold.

Observable symptom:

- The runsc worker is permanently unavailable until a human performs out-of-band cleanup.

Evidence:

- `packages/boring-sandbox/src/providers/runsc/runtime/sessionRuntime.ts:187-214` applies the startup sweep/count behavior.
- `packages/boring-sandbox/src/providers/runsc/runtime/limits.ts:5-26` defines the bounded startup cleanup limit.

Concrete fix:

- Sweep in bounded batches: delete the first batch, relist, and continue until clean or a total deadline is reached.
- Emit residue metrics and a recoverable degraded status instead of fail-before-cleanup.
## Finding 19 — runsc cleanup retry can survive shutdown forever

Severity: SERIOUS Attack area: child/container cleanup.
Exact failing sequence:

1. Docker remove persistently fails.
2. Retirement schedules an exponential retry capped at five seconds.
3. There is no maximum attempt/dead-letter state.
4. The retry timer remains referenced.
5. Shutdown reports rejection, but the timer continues waking and retrying, and may keep the Node process alive indefinitely.

Observable symptom:

- Worker shutdown hangs or a supposedly retired process remains resident.

Evidence:

- `packages/boring-sandbox/src/providers/runsc/runtime/sessionRetirement.ts:81-121` schedules unlimited referenced retries.
- `packages/boring-sandbox/src/providers/runsc/runtime/sessionRuntime.ts:560-580` awaits retirement during shutdown but does not cancel/transfer retry ownership.

Concrete fix:

- Unref retry timers.
- Set a maximum and persist a dead-letter cleanup record for a startup janitor.
- Explicitly cancel or transfer retry ownership during shutdown.
## Finding 20 — Template seeding accepts stale or truncated files forever

Severity: SERIOUS Attack area: idempotency / partial recovery.
Exact failing sequence:

1. A template file copy writes truncated content, or the agent modifies the file after first seeding.
2. A later provisioning attempt reaches the same target.
3. `seedWorkspaceFiles` checks only whether the path exists.
4. Existing content is never hashed, sized, or recopied.
5. Provisioning can complete successfully while the required bundle/template is corrupt or stale.

Observable symptom:

- Broken bash/template behavior persists across every retry while provisioning reports no change for that file.

Evidence:

- `packages/agent/src/server/workspace/provisioning/workspaceFiles.ts:89-117` skips every existing target without content validation.
- `packages/agent/src/server/workspace/provisioning/workspaceFiles.ts:120-138` aggregates only boolean creation results.

Concrete fix:

- Distinguish user-owned seed-once files from generated runtime-integrity files.
- For generated files, store and verify a manifest of digest, size, type, and mode; write temp then atomically replace.
- For user-owned files, document that changes intentionally win and do not claim they are runtime integrity outputs.
## Finding 21 — Legacy marker permits a hybrid old/new runtime after failure

Severity: SERIOUS Attack area: partial provisioning / idempotency.
Exact failing sequence:

1. Legacy workspace has marker `H_old`.
2. A request for `H_new` begins reprovisioning but leaves `H_old` in place.
3. It overwrites Node package content, then fails before Python, shims, or marker update.
4. A later request asks for the old contribution set.
5. Marker `H_old` matches.
6. `isRuntimeMaterialized` checks only venv Python existence and each Node `package.json`, so the hybrid passes.
7. It rewrites shims and serves new/partial package bytes under the old marker.

Observable symptom:

- `changed: false` for a runtime whose content does not match its fingerprint.

Evidence:

- `packages/agent/src/server/workspace/provisionRuntime.ts:280-291` performs the shallow materialization check.
- `packages/agent/src/server/workspace/provisionRuntime.ts:334-368` leaves the old marker until the final non-atomic write.

Concrete fix:

- Retire this duplicate legacy provisioner in favor of one transactional engine.
- Until then, atomically publish an `in-progress` generation marker before any mutation and never modify the active generation in place.
- Validate a full content manifest before accepting a marker.
## Finding 22 — Legacy copied CSS is absent from its fingerprint

Severity: SERIOUS Attack area: provisioning fingerprint / stale environment.
Exact failing sequence:

1. Provision a legacy Node package containing `src/globals.css`.
2. Change only that CSS file.
3. Rerun with `force: false`.
4. Fingerprint stays unchanged because CSS is not in the hash allowlist.
5. Marker/materialization checks pass and provisioning returns unchanged.
6. The old copied CSS remains in the workspace package.

Evidence:

- `packages/agent/src/server/workspace/provisionRuntime.ts:120-139` lists hashed package inputs and omits `src/globals.css`.
- `packages/agent/src/server/workspace/provisionRuntime.ts:210-239` copies `src/globals.css` at line 238.
- `packages/agent/src/server/workspace/provisionRuntime.ts:350-355` skips on the unchanged marker.

Concrete fix:

- Generate both copy operations and fingerprint inputs from one canonical manifest so they cannot diverge.
- Add regression coverage asserting every copied input changes the digest.
## Finding 23 — Legacy absolute paths cause behavior-free reprovision churn

Severity: MINOR Attack area: provisioning fingerprint / unnecessary lease churn.
Exact failing sequence:

1. Byte-identical plugin/package sources move from `/build/A` to `/build/B` in a redeploy.
2. Logical ids, targets, and copied bytes are unchanged.
3. Fingerprint changes because it hashes absolute source paths and absolute file paths.
4. Marker mismatch reruns templates, packages, Python installs, and shims.

Observable symptom:

- Expensive and risky reprovisioning with no behavior change.

Evidence:

- `packages/agent/src/server/workspace/provisionRuntime.ts:86-100` hashes the absolute path for each file.
- `packages/agent/src/server/workspace/provisionRuntime.ts:103-139` hashes source paths for templates, Python, and Node packages.

Concrete fix:

- Hash logical ids/targets plus source-relative paths and bytes.
- Exclude host deployment coordinates from semantic identity.
## Finding 24 — Package declaration order forces needless reinstall

Severity: MINOR Attack area: provisioning fingerprint / unnecessary churn.
Exact failing sequence:

1. Independent declarations `[A@1, B@1]` are reordered to `[B@1, A@1]`.
2. Final installed behavior and bytes are otherwise identical.
3. Runtime fingerprint changes because package arrays retain declaration order.
4. Provisioning deletes and reinstalls the entire Node runtime or venv.

Evidence:

- `packages/agent/src/server/workspace/provisioning/fingerprint.ts:57-63` preserves Node package array order.
- `packages/agent/src/server/workspace/provisioning/fingerprint.ts:72-83` preserves Python package array order.
- `packages/agent/src/server/workspace/provisioning/node.ts:115-145` responds to mismatch by removing Node runtime state.
- `packages/agent/src/server/workspace/provisioning/python.ts:202-234` responds by removing the venv.

Concrete fix:

- Validate unique ids/package names, then sort canonical package records before hashing and installation where order is semantically irrelevant.
- Preserve order only for fields whose installer semantics demonstrably depend on it.
## Finding 25 — Retire can overlap replacement provider creation

Severity: SERIOUS Attack area: lease lifecycle race.
Exact failing sequence:

1. Last reference calls `retire()`.
2. The record is removed from the map before `disposeRecord` completes.
3. A new acquire for the same key sees no record and begins provider creation.
4. Old provider disposal and new provider creation overlap.
5. If the provider maps both generations to the same persistent remote sandbox, old disposal/invalidation can tear down or invalidate the replacement.

Evidence:

- `packages/agent/src/server/agent-host/environmentLease.ts:117-123` deletes the record then awaits disposal.
- `packages/agent/src/server/agent-host/environmentLease.ts:71-90` creates a new record whenever the map is empty.
- `packages/agent/src/server/agent-host/environmentLease.ts:168-179` performs provider disposal asynchronously afterward.

UNVERIFIED:

- Whether a specific deployed provider's dispose operation destroys the exact shared remote resource used by its immediate replacement is provider/config dependent. The overlap itself is established from code.

Concrete fix:

- Keep a retiring tombstone and disposal promise in the registry.
- Make replacement acquisition await retirement, or use provider handle epochs so old cleanup cannot affect the new generation.
## Finding 26 — Workspace deletion does not establish hosted sandbox reclamation

Severity: SERIOUS Attack area: cleanup.
Exact failing sequence:

1. A Vercel-backed workspace owns a persistent sandbox and handle record.
2. Runtime binding retirement calls pair disposal.
3. Pair disposal stops scheduler/listeners but does not stop the persistent sandbox or delete its handle record.
4. Provider invalidation evicts only the process-local cache.
5. Workspace deletion may therefore leave remote compute/storage and durable handle metadata behind.

Evidence:

- `packages/boring-sandbox/src/providers/vercel-sandbox/createVercelSandboxProvider.ts:508-513` makes invalidation a cache eviction.
- `packages/boring-sandbox/src/providers/vercel-sandbox/createVercelSandboxProvider.ts:712-718` disposes local wrappers without stopping the persistent sandbox.

UNVERIFIED:

- No production `origin/main` call connecting workspace DELETE to `SandboxHandleStore.delete` plus remote stop was established in the reviewed code. An external control-plane integration could own this cleanup.

Concrete fix:

- Define one explicit `destroyWorkspaceEnvironment(workspaceId)` contract that stops/deletes remote sandboxes, deletes handles/snapshots, and is awaited by logical workspace deletion.
- Reconcile leaked handles on startup and periodically.
## Finding 27 — Failure attribution is inconsistent

Severity: SERIOUS Attack area: failure attribution.
Exact failing sequence:

1. A provisioning Docker command fails, or a Vercel command exceeds its timeout.
2. The provider discards the diagnostic fields that distinguish cause and remedy.
3. Phase wrapping preserves a stable code but cannot restore discarded stderr or timeout state.
4. The developer receives a generic or misleading message and investigates the wrong layer.
ACTIONABLE:

- `packages/agent/src/server/workspace/provisioning/errors.ts:28-41` produces `"Workspace provisioning failed during <phase>: <message>"` and retains phase, details, code, and cause.
- `packages/agent/src/server/workspace/provisioning/provisionWorkspaceRuntime.ts:91-130` supplies stable phase codes and structured telemetry.
- `packages/agent/src/server/workspace/provisioning/workspaceFiles.ts:109-113` names plugin, template, source, and target.

VAGUE:

- `packages/boring-sandbox/src/providers/runsc/runtime/dockerRunner.ts:148-177` reduces any nonzero Docker command to `"remote-worker Docker command failed"`.
- It discards available bounded stderr, stdout, exit code, and operation context.
- `packages/boring-sandbox/src/providers/runsc/runtime/sessionRetirement.ts:81-95` wraps removal failure as `"remote-worker sandbox cleanup is incomplete"` without the Docker reason.

MISLEADING:

- `packages/boring-sandbox/src/providers/vercel-sandbox/createVercelSandboxExec.ts:59-68,137-170` converts a timeout into exit code 124 with empty output.
- `packages/boring-sandbox/src/providers/vercel-sandbox/createVercelSandboxProvider.ts:676-688` then reports `"Command failed (<command>) with exit code 124"`, not that the operation timed out or after how long.
- `packages/boring-sandbox/src/providers/vercel-sandbox/createVercelSandboxProvider.ts:385-391` is worse for chmod: it hides failure entirely, so no provisioning failure is attributed at all.

Concrete fix:

- Standardize typed command errors with phase, safe command name, duration, timeout/abort flag, exit code, and sanitized/truncated stderr.
- Preserve cause chains and stable codes across providers.
- Never use `|| true` for a required provisioning invariant.
- Avoid logging full argv or credentials.
## Finding 28 — Documentation claims idempotency while admitting no lock

Severity: MINOR Attack area: silent operational risk.
Exact failing sequence:

1. Operator relies on the statement that provisioning is synchronous and idempotent.
2. Two first-load/reload operations occur anyway in normal distributed or UI behavior.
3. The destructive races above occur.
4. There is no job/status/doctor endpoint to distinguish partial residue from a healthy workspace.

Evidence and quotes:

- `packages/agent/docs/runtime-provisioning.md:35-46` says `"Provisioning is synchronous and idempotent"`.
- `packages/agent/docs/runtime-provisioning.md:51-54` then says `"Concurrent first-load/reload calls are not locked yet; avoid intentionally starting multiple provisioning runs"`.
- The latter is an operational warning, not a correctness mechanism; concurrency need not be intentional.

Concrete fix:

- Do not describe in-place destructive reruns as idempotent.
- Implement transactional locking first.
- Add environment generation/status/last-error/doctor visibility, including abandoned staging cleanup and provider resource reconciliation.

## Fix first

### 1. Eliminate workspace-to-host code execution

Fix Finding 1 first because it crosses the central trust boundary: an agent that
is supposed to be confined to workspace writes can obtain the full authority of
the host application process. No provisioning reliability improvement can make
that architecture safe.

### 2. Make provisioning immutable, transactional, and globally fenced

Fix Findings 2–4, 9–11, 15, and 25 as one design change: stage content-addressed
generations, lock by physical workspace across processes, validate, atomically
publish, and retain the old generation until leases drain. This removes the
largest family of corruption, partial-state, reload, delete, and zombie-writer
failures instead of patching each race independently.

### 3. Replace label/path fingerprints and workspace-trusted markers with attested content manifests

Fix Findings 5–7 and 20–24 next. Real byte digests and host-owned manifests are
required both for correctness and trust: they prevent stale packages, stop an
agent from pinning tampered executables, and avoid behavior-free churn. The same
manifest should drive copy, install, expected-output validation, and environment
lease identity so those definitions cannot drift again.
