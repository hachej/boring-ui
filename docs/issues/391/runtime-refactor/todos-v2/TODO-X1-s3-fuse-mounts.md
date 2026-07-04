# TODO-X1 — S3/FUSE mounts for boring-sandbox environments (Phase X1)

Handoff: self-contained work order for one autonomous coding agent (pi or gpt-5.5-xhigh). Cite plan files by relative path. No prior conversation assumed.

**What this is:** the mount subsystem of `@hachej/boring-sandbox` (created by `TODO-P2`) — S3-backed filesystems that appear as a real directory inside a sandbox, so an agent's environment (`TODO-E1`) can be an object-store prefix instead of only a local dir. This is the substrate the farm needs (an agent works in a mounted env and publishes an artifact — 08 `data-artifact`, VISION-MAP farm row). It rides on the three-package stack: providers/mounts live in `@hachej/boring-sandbox`, environments in `@hachej/boring-bash`/`boring-agent` contracts.

## Context (read first)

- `docs/issues/391/runtime-refactor/02-boring-bash-environment.md` — package layers; the `@hachej/boring-sandbox/mounts` export (FUSE-S3 mount drivers + per-session lifecycle) and provider capability facts.
- `docs/issues/391/runtime-refactor/08-pluggable-agent-surfaces.md` — decision 11 (three-package stack: `boring-agent` ← `boring-bash` ← `boring-sandbox`); the trust boundary (credentials brokered on the trusted core side, the environment gets only derived non-secret effects).
- `docs/issues/391/runtime-refactor/09-environments-attachable.md` — the `Environment`/`EnvironmentAttachment`/`ResolvedEnvironments` model; **`mountPath` is host-supplied per attachment entry** (an S3 mount is exactly this host-supplied mount fact); security invariant 3 (credential brokering at the environment boundary; MCP clients never receive broker secrets); the no-leak conformance suite runs against every delivered mount.
- `docs/issues/391/runtime-refactor/00-global-isa.md` — invariant 4 (partial file exposure with shell is physical: mount/seed only allowed files for untrusted exec), invariant 14 (secrets stay on the trusted core side; brokered at the environment boundary, never enter the sandbox process or the model transcript), invariant 15 (EU-sovereign defaults — no US-hosted service as a default/hard dependency).
- BINDING policy: `docs/issues/391/runtime-refactor/todos-v2/README.md` "Simplicity & no-compat policy" — no shims, no abstraction without two real consumers, `TODO(remove:<bead-id>)` regime, migrate every importer in the same PR.

### Depends on

- **P2** (`TODO-P2-bash-package-providers.md`): `@hachej/boring-sandbox` exists (scaffold BBP2-000 + providers). This TODO adds `@hachej/boring-sandbox/mounts`. If the package is absent, **STOP and report**.
- **P5** (`TODO-P5-provisioning-secrets.md`): the **capability-fact + secrets-broker** machinery — the remote-worker handshake pattern (`reported | unknown`, fail closed) and the host-side secret-brokering rule (BBP5-007: brokered secrets are host-side handles, never enter a sandbox). X1's `mounts.fuseS3` capability fact and its STS-broker reuse that machinery; the sandbox receives a directory handle, never a secret (00 invariant 14).

### Current reality this extends (verify before coding)

- No mount/FUSE code exists in the repo (`grep -rn "rclone\|fusermount\|/dev/fuse\|mountinfo" packages apps` → 0). This is greenfield inside `@hachej/boring-sandbox`.
- The bwrap provider (`@hachej/boring-sandbox/providers/bwrap`, moved by P2 BBP2-003) already `--bind`/`--ro-bind`s host paths into the sandbox — the host-side-mount-then-bind pattern (decision 3) reuses its arg builder; do not fork a second bwrap arg path.
- Environment `mountPath` is already host-supplied per attachment (09 / E1 `resolveAttachments` `mountPath` rule) — an S3 mount is a host-supplied `mountPath` whose backing is a mount process, not a local dir.

## The 10 LOCKED DECISIONS (the work order's spine — copied verbatim from verified research; do NOT relitigate)

1. Primary mount tool = `rclone mount --vfs-cache-mode full` (MIT; only option meeting EU-endpoint [OVH/Scaleway/MinIO] + full-POSIX-write requirements). mountpoint-s3 deferred to a future AWS-only/read-only driver.
2. Driver abstraction = thin interface (`mount(bucket, prefix, creds, ro) -> dir`), ship rclone driver only.
3. Sandbox pattern = HOST-SIDE mount, then bwrap --bind/--ro-bind the mountpoint into the sandbox. Never expose /dev/fuse/fusermount3/creds to the sandbox.
4. Same pattern is the gVisor-portable one (host mount served via gofer); do not design around in-sandbox FUSE.
5. One mount per session (own mount process, VFS cache dir, scoped creds, isolated teardown); share only immutable read-only datasets.
6. Readiness gate: poll /proc mountinfo + probe stat/readdir before binding (bwrap bind race exists); never bind an un-ready mount.
7. Teardown = lazy unmount (fusermount3 -uz / umount -l) of bind AND source; explicitly reap the mount process.
8. Error contract to file tools: ENOTCONN/ESTALE = storage gone (re-mount, not corruption); EIO = transient (retry). Tune rclone --timeout/--retries/--low-level-retries.
9. Write-back default = rclone VFS-full direct writes; fuse-overlayfs (RO S3 lower + local upper) + checkpoint sync for read-heavy/publish-on-save. NEVER kernel overlayfs over FUSE.
10. Credentials = broker mints short-lived prefix-scoped STS token (AWS session policy w/ s3:prefix condition; Scaleway/MinIO STS; OVH per-container credential), injected into the mount-process env ONLY; refresh via credential_process; the sandbox receives a directory handle, never a secret (00 invariant 14).

## Goal / exit criteria

An `@hachej/boring-sandbox` environment can be backed by an S3 prefix, mounted host-side and bind-mounted into a sandbox, indistinguishable to file tools/bash from a local dir — EU-endpoint-first, credential-safe, and passing the existing no-leak conformance suite as a new mount. Checkable:

- [ ] `mount(bucket, prefix, creds, ro) -> dir` driver interface exists with a single **rclone** driver (`--vfs-cache-mode full`); mountpoint-s3 is documented as a deferred AWS-only/RO driver, not built (decisions 1, 2).
- [ ] A per-session mount has its own mount process, VFS cache dir, scoped creds, and isolated teardown; immutable RO datasets may be shared (decision 5).
- [ ] Mount is bound into the sandbox **host-side** via bwrap `--bind`/`--ro-bind`; `/dev/fuse`, `fusermount3`, and creds are never exposed inside the sandbox (decision 3); the same pattern is gVisor-portable (decision 4).
- [ ] Readiness gate polls `/proc/self/mountinfo` + probes `stat`/`readdir` before binding; an un-ready mount is never bound (decision 6).
- [ ] Teardown lazy-unmounts (`fusermount3 -uz` / `umount -l`) both the bind and the source and explicitly reaps the mount process (decision 7).
- [ ] File-tool error contract: `ENOTCONN`/`ESTALE` → storage-gone (re-mount signal, not corruption); `EIO` → transient (retry); rclone `--timeout`/`--retries`/`--low-level-retries` tuned (decision 8).
- [ ] Capability fact `mounts.fuseS3: reported | unknown` (fail closed; the `vercel`-PROXY provider reports **unsupported**).
- [ ] Credentials are a broker-minted short-lived prefix-scoped STS token injected into the **mount-process env only**, refreshed via `credential_process`; the sandbox receives a directory handle, never a secret (decision 10; 00 invariant 14).
- [ ] An E1 `Environment` whose `mountPath` comes from a mount attaches and works; a **readonly S3 mount passes the no-leak suite**; a `bash-sees-mount == file-routes-see-mount` source-of-truth test passes.
- [ ] EU-endpoint matrix test (MinIO in CI) green; no US-hosted service is a default or hard dependency (invariant 15).

## Non-negotiables

- `@hachej/boring-sandbox` imports agent **types only**; mounts code lives in `@hachej/boring-sandbox/mounts` (server-scoped, may use `node:*`), never reachable from `boring-sandbox/shared` (front-safe). boring-bash may import the mount values; agent imports neither.
- **Never expose `/dev/fuse`, `fusermount3`, or any credential to the sandbox** (decisions 3, 10; invariants 4, 14). The mount is a host process; the sandbox sees a bound directory.
- **NEVER kernel overlayfs over FUSE** (decision 9). Write-back default is rclone VFS-full direct writes; the fuse-overlayfs variant is RO S3 lower + local upper with checkpoint sync, optional.
- Fail closed on `mounts.fuseS3: unknown` — a policy requiring an S3 mount against a provider that has not proven support (or the `vercel` PROXY provider that reports unsupported) is rejected, not assumed (mirror the P5 remote-worker `reported | unknown` fail-closed rule).
- EU-sovereign default (invariant 15): default endpoints are OVH/Scaleway/MinIO; AWS S3 is an optional endpoint, never the default; the CI matrix uses self-hostable MinIO.
- No abstraction without two real consumers (README rule 3): ship the **rclone** driver only; the driver interface is justified because the deferred mountpoint-s3 driver + fuse-overlayfs variant are named future consumers, but do not build them speculatively.

## Do NOT

- Do NOT touch `/home/ubuntu/projects/boring-ui-v2`. Work on a dedicated branch/worktree per the PR-PLAN branch naming; never commit to main directly; every bead lands as a PR per todos-v2/README.
- Do NOT design around in-sandbox FUSE (decision 4) — host mount + bind only.
- Do NOT reclassify remote-worker as an environment transport here (that is a deferred post-E2/P8 direction, 09).
- Do NOT put mount code in `boring-sandbox/shared` (it uses `node:*`); do NOT let boring-agent import it.
- Do NOT build the mountpoint-s3 driver or the farm artifact UI — out of scope (deferred; farm epic).

## Beads

### BBX1-001 — Mount driver interface + rclone driver in `boring-sandbox/src/mounts` · size M
- **Files create:** `packages/boring-sandbox/src/mounts/index.ts` (barrel); `packages/boring-sandbox/src/mounts/driver.ts` (the thin interface `interface MountDriver { mount(spec: { bucket: string; prefix: string; creds: MountCredentialHandle; ro: boolean; cacheDir: string; endpoint: MountEndpoint }): Promise<MountHandle> }` where `MountHandle { mountpoint: string; pid: number; unmount(): Promise<void> }` — decision 2); `packages/boring-sandbox/src/mounts/rcloneDriver.ts` (the only driver — spawns `rclone mount --vfs-cache-mode full` with `--timeout`/`--retries`/`--low-level-retries` tuned per decision 8; decision 1).
- **Files touch:** `packages/boring-sandbox/package.json` (add `"./mounts"` export → `dist/mounts/index.js` + types); `packages/boring-sandbox/tsup.config.ts` (entry); `packages/boring-sandbox/scripts/check-invariants.mjs` (add `"./mounts"` to `requiredExports`; assert `src/mounts/**` not imported by `src/shared/**`).
- **Notes:** rclone binary is a provisioned dependency (P5 SDK-archive/managed-binary seam), not vendored. mountpoint-s3 is documented in `mounts/README.md` as a **deferred** AWS-only/read-only driver — the interface exists so it can be added later, but it is not built now (decisions 1, 2; README rule 3). Endpoint config (`MountEndpoint`) defaults to OVH/Scaleway/MinIO (EU); AWS is an opt-in endpoint (invariant 15).
- **Tests:** `packages/boring-sandbox/src/mounts/__tests__/rcloneDriver.test.ts` — the driver builds the correct `rclone mount` argv (endpoint, `--vfs-cache-mode full`, tuned timeout/retry flags, cache dir), against a fake spawn; `MountHandle` shape asserted; export-map resolves `boring-sandbox/mounts`.
- **Acceptance:** the driver interface + rclone driver exist; `boring-sandbox/mounts` resolves; mountpoint-s3 documented-deferred not built.

### BBX1-002 — Per-session mount lifecycle manager (readiness gate, lazy-unmount + reap, stale recovery) · size L
- **Files create:** `packages/boring-sandbox/src/mounts/mountLifecycle.ts` (`MountLifecycleManager` — one mount per session: own mount process, own VFS cache dir, scoped creds, isolated teardown; decision 5). Readiness gate: poll `/proc/self/mountinfo` **and** probe `stat`/`readdir` on the mountpoint before returning ready; never surface an un-ready mount to the binder (decision 6). Teardown: lazy-unmount (`fusermount3 -uz`, fall back `umount -l`) the source, then explicitly reap the mount process (SIGTERM→wait→SIGKILL), then remove the cache dir (decision 7). Stale recovery: on `ENOTCONN`/`ESTALE` from the source, treat as storage-gone and re-mount (not corruption); `EIO` is transient → bounded retry (decision 8).
- **Files touch:** `packages/boring-sandbox/src/mounts/index.ts`.
- **Notes:** immutable RO datasets MAY share one mount across sessions (decision 5) — gate sharing on `ro && immutable` only; everything else is per-session. The `ENOTCONN`/`EIO` classification is the source of the file-tool error contract exported to boring-bash (BBX1-006).
- **Tests:** `mountLifecycle.test.ts` — readiness gate blocks until `mountinfo` + probe both pass (fake a slow mount); teardown lazy-unmounts source + reaps the process (assert no orphan pid, cache dir gone); an injected `ENOTCONN` triggers a re-mount, an injected `EIO` triggers bounded retry then surfaces; two sessions get two distinct mount processes + cache dirs; a shared immutable RO dataset reuses one.
- **Acceptance:** per-session isolation, readiness gate, lazy-unmount+reap, and stale/transient error handling all hold.

### BBX1-003 — Host-side mount → sandbox bind (bwrap; gVisor-portable) · size M
- **Files touch:** `packages/boring-sandbox/src/providers/bwrap/*` (reuse the existing bwrap arg builder moved in P2 BBP2-003 — add a `--bind`/`--ro-bind` of the ready mountpoint into the sandbox at the environment's in-sandbox `mountPath`). `packages/boring-sandbox/src/mounts/bindIntoSandbox.ts` (new; wires a ready `MountHandle` → a bwrap bind spec).
- **Notes:** HOST-SIDE mount, then bind (decision 3). **Never** pass `/dev/fuse`, `fusermount3`, or the creds into the sandbox — assert their absence in the bwrap arg set. RO mount → `--ro-bind`; RW → `--bind`. This same host-mount-then-bind is the gVisor-portable pattern (host mount served via gofer) — the bind spec is provider-agnostic; do not add an in-sandbox FUSE path (decision 4).
- **Tests:** `bindIntoSandbox.test.ts` — a ready RO mount produces a `--ro-bind mountpoint sandboxPath` arg and NO `/dev/fuse`/`fusermount3`/cred in the arg set; RW mount → `--bind`; binding an un-ready mount is refused (calls the BBX1-002 readiness gate).
- **Acceptance:** the mount is bound host-side with zero FUSE/cred exposure to the sandbox; RO/RW distinction preserved.

### BBX1-004 — Capability fact `mounts.fuseS3: reported | unknown` (fail closed; vercel reports unsupported) · size S
- **Files touch:** `packages/boring-sandbox/src/shared/capability.ts` (from P2 BBP2-001 — add `mounts?: { fuseS3?: boolean | 'unknown' }` to `ProviderCapabilities`, typed `reported | 'unknown'`); `packages/boring-sandbox/src/providers/matrix.ts` (set `fuseS3` per provider: `direct`/`bwrap` on a FUSE-capable host = `true` when proven, `'unknown'` until probed; `vercel`-PROXY = `false`/unsupported; `remote-worker` = `'unknown'` until its handshake reports it — BBP5-008); the requirement-validation path (P5 normalizer) so a policy requiring an S3 mount **fails closed on `'unknown'`** and on `vercel`.
- **Notes:** Reuse the P5 `reported | unknown` fail-closed rule verbatim (mirror remote-worker). A host probe (does `fusermount3` + `rclone` exist, `/dev/fuse` present) reports `true`; absent → stays `unknown` → fail closed.
- **Tests:** `mountCapability.test.ts` — `vercel` reports `fuseS3: false` and a mount policy against it is rejected with a stable code; `'unknown'` fails closed; a probed FUSE-capable host reports `true` and passes.
- **Acceptance:** `mounts.fuseS3` is a reported fact; unknown/vercel fail closed.

### BBX1-005 — Credential broker: short-lived prefix-scoped STS into the mount-process env only · size M
- **Files create:** `packages/boring-sandbox/src/mounts/credentialBroker.ts` — `brokerMountCredentials({ endpoint, bucket, prefix, access }): Promise<MountCredentialHandle>` mints a **short-lived prefix-scoped** token: AWS session policy with an `s3:prefix` condition; Scaleway/MinIO STS; OVH per-container credential (decision 10). The token is injected into the **rclone mount-process env ONLY** and refreshed via rclone `credential_process`; it is a **host-side handle** (P5 BBP5-007 rule) — never serialized to the model/browser/log/artifact, never bound into the sandbox.
- **Notes:** the sandbox receives a **directory handle**, never a secret (00 invariant 14; 09 invariant 3). This is the P5 secrets-broker pattern applied to a mount: the broker lives on the trusted core side; the mount process is trusted-core-adjacent (host), the sandbox is untrusted. EU endpoints default; the STS/credential source is endpoint-specific behind the broker.
- **Tests:** `credentialBroker.test.ts` — brokered token is prefix-scoped (a sibling prefix is denied by the minted policy, asserted against MinIO STS in CI); the token appears in the mount-process env and in **no** other surface (grep the sandbox env, the event stream, logs → absent); `credential_process` refresh path invoked.
- **Acceptance:** creds are short-lived, prefix-scoped, mount-process-env-only; no cred readable inside the sandbox.

### BBX1-006 — S3-backed `Environment` integration + conformance + source-of-truth test · size L
- **Files create/touch:** `packages/boring-bash/src/server/companyContextEnvironment.ts`-style adapter (or a new `s3Environment.ts`) so an E1 `Environment` (09) can declare an S3 backing; its resolved `EnvironmentAttachment.mountPath` (host-supplied per 09) is produced by the BBX1-002 lifecycle + BBX1-003 bind. Export the file-tool **error contract** (BBX1-002 `ENOTCONN`/`ESTALE`/`EIO` classification) so boring-bash file tools/routes translate it (storage-gone vs transient), reusing the #416 projection ops unchanged.
- **Notes:** the boring-bash environment/attachment code stays in `boring-bash/server` (E1); it consumes the `@hachej/boring-sandbox/mounts` **values** (the legitimate `boring-bash → boring-sandbox` edge). Agent imports neither. This is X1's **second real consumer** of the driver interface after the rclone driver itself — the abstraction is justified.
- **Tests:** `s3Environment.test.ts` + a new **no-leak conformance mount**: run `checkReadonlyProjectionConformance` (09/07 "one suite, N mounts") against a **readonly S3 mount** (MinIO fixture) — denied files physically absent, mutations reject. **Source-of-truth test:** the set of files `bash` sees inside the sandbox `== ` the set the file routes/tree see (invariant 3; 02 one-namespace), driven through both the bound mountpoint and the file routes over the same mount. An `ENOTCONN` surfaces as storage-gone (re-mount), not as a corrupt-file error.
- **Acceptance:** an S3-backed environment attaches and works; the readonly S3 mount passes the no-leak suite; `bash-sees-mount == file-routes-see-mount`.

### BBX1-007 — EU-endpoint matrix + secrets negative test (MinIO in CI) · size S
- **Files create:** `packages/boring-sandbox/src/mounts/__tests__/euEndpointMatrix.test.ts` — a mount + read/write/list round-trip against **MinIO** (self-hostable, EU-representative) in CI; the matrix documents OVH/Scaleway as the same rclone S3 config with a different endpoint (no code fork); AWS is an opt-in row, never the default (invariant 15). Includes the **secrets negative test**: no brokered credential is readable from inside the sandbox (grep the sandbox process env + the bound tree + the event stream → absent).
- **Notes:** CI provisions a MinIO container (add to the test harness / compose used by `pnpm --filter @hachej/boring-sandbox run test:mounts:eu`, a **new** script this bead adds). Do not require live OVH/Scaleway in CI; assert config parity by argv, run the round-trip against MinIO.
- **Tests:** the file is the test — MinIO round-trip green; secrets negative assertion green; endpoint-config parity asserted for OVH/Scaleway/MinIO.
- **Acceptance:** EU-endpoint matrix green on MinIO; no US-hosted default; no cred inside the sandbox.

### BBX1-008 — fuse-overlayfs write-back variant (optional) · size S
- **Files create:** `packages/boring-sandbox/src/mounts/overlayVariant.ts` — the **read-heavy/publish-on-save** variant: RO S3 lower + local upper via **fuse-overlayfs** (NOT kernel overlayfs over FUSE — decision 9), with an explicit checkpoint-sync back to S3 on save. Default write-back stays rclone VFS-full direct writes (BBX1-001); this variant is opt-in per environment.
- **Notes:** optional (README rule 3) — build only the variant + one test; it is the named second write-back consumer that justifies the driver's `writeBack` option. **NEVER** kernel overlayfs over FUSE (decision 9) — assert the impl uses `fuse-overlayfs`.
- **Tests:** `overlayVariant.test.ts` — RO lower + local upper composes; a write lands in the upper and a checkpoint sync pushes it to S3 (MinIO fixture); asserts fuse-overlayfs (not kernel overlayfs) is used.
- **Acceptance:** the publish-on-save overlay variant works via fuse-overlayfs with checkpoint sync; default stays VFS-full direct writes.

## Verification — commands (existing @hachej/boring-sandbox scripts + the new ones this package adds)

```bash
# @hachej/boring-sandbox (created by P2; this TODO adds the ./mounts export)
pnpm --filter @hachej/boring-sandbox run build
pnpm --filter @hachej/boring-sandbox run typecheck
pnpm --filter @hachej/boring-sandbox run check:invariants   # asserts ./mounts export + shared-not-importing-mounts + agent-types-only edge
pnpm --filter @hachej/boring-sandbox run test

# NEW script this TODO adds to packages/boring-sandbox/package.json (note it in the PR):
pnpm --filter @hachej/boring-sandbox run test:mounts:eu      # MinIO-backed EU-endpoint matrix + no-leak S3 mount + secrets negative test (BBX1-007)

# boring-bash consumes the mount values (the legitimate boring-bash → boring-sandbox edge)
pnpm --filter @hachej/boring-bash run test
pnpm --filter @hachej/boring-bash run check:invariants

# repo-wide boundary + leak guards (root package.json)
pnpm lint:invariants        # includes boring-sandbox + boring-bash invariant scripts
pnpm audit:imports          # agent imports neither bash nor sandbox; sandbox→agent type-only
pnpm typecheck
```

## Review gates

- P2 (`@hachej/boring-sandbox` + providers) and P5 (capability-fact + secrets-broker machinery) present, else STOP+report.
- One rclone driver behind the thin `mount()` interface; mountpoint-s3 documented-deferred, not built (decisions 1, 2).
- Host-side mount + bwrap bind; `/dev/fuse`/`fusermount3`/creds never in the sandbox arg set (decision 3); no in-sandbox FUSE path (decision 4).
- Per-session mount isolation; readiness gate before bind; lazy-unmount + explicit reap on teardown (decisions 5, 6, 7).
- File-tool error contract: `ENOTCONN`/`ESTALE`=storage-gone, `EIO`=transient (decision 8); default write-back = VFS-full; overlay variant = fuse-overlayfs, never kernel overlayfs over FUSE (decision 9).
- `mounts.fuseS3: reported | unknown` fails closed; `vercel` reports unsupported.
- Creds = short-lived prefix-scoped STS, mount-process-env only, refreshed via `credential_process`; sandbox gets a directory handle, never a secret (decision 10; invariant 14) — secrets negative test green.
- Readonly S3 mount passes the no-leak conformance suite; `bash-sees-mount == file-routes-see-mount` source-of-truth test green.
- EU-endpoint matrix (MinIO in CI) green; no US-hosted default or hard dependency (invariant 15).
- boring-sandbox imports agent types only; mounts code never in `shared`; agent imports neither package; `pnpm audit:imports`/`pnpm lint:invariants` green.
- Any intra-phase transitional code carries `TODO(remove:<bead-id>)` + a same-phase deletion bead (README policy).
