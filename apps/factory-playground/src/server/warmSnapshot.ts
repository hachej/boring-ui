import { Sandbox } from '@vercel/sandbox'
import { FACTORY_COREPACK_HOME, FACTORY_GIT_TOKEN_ENV_VAR, FACTORY_WARM_REPO_ROOT } from './remoteSnapshotProvider'

const RUNTIME = 'node24'
// `pnpm run build:packages` defaults to --workspace-concurrency=4; tsup's DTS
// worker for `packages/agent` alone is heavy enough that 4 concurrent package
// builds OOM'd a 4-vCPU/8GB sandbox even with `resources.vcpus` raised. Force
// concurrency down to 2 to keep peak memory bounded regardless of sandbox size.
const BUILD_COMMAND = "pnpm -r --filter './packages/*' --filter './plugins/*' --workspace-concurrency=2 run build"
const DEFAULT_REPO_URL = 'https://github.com/hachej/boring-ui.git'
const DEFAULT_TIMEOUT_MS = 40 * 60 * 1000
const DEFAULT_SNAPSHOT_EXPIRATION_MS = 7 * 24 * 60 * 60 * 1000
// Verified live: `resources: { vcpus: 8 }` was rejected outright (400) on
// this Vercel plan/team; 4 vCPUs (8192 MB) is accepted.
const DEFAULT_VCPUS = 4

export interface WarmSnapshotAuth {
  readonly token: string
  readonly teamId: string
  readonly projectId: string
}

export interface CreateWarmSnapshotOptions {
  /** Git ref (branch, tag, or SHA) to clone and build. Default: `origin/main`. */
  readonly ref?: string
  /** Remote to clone from. Default: `https://github.com/hachej/boring-ui.git`. */
  readonly remoteUrl?: string
  readonly auth: WarmSnapshotAuth
  /**
   * Optional git access token authenticating the clone of `remoteUrl` (private
   * repos). Passed to the seed sandbox only as an exec-scoped env var — never
   * embedded in the clone script's literal text (which would leak it to `ps`
   * inside the sandbox) or logged.
   */
  readonly gitToken?: string
  /** Seed sandbox vCPUs. Default 4 (verified: 8 is rejected on this plan). */
  readonly vcpus?: number
  /** Seed sandbox timeout. Default 40 minutes. */
  readonly timeoutMs?: number
  /** Snapshot expiration window from creation. Default 7 days. */
  readonly snapshotExpirationMs?: number
  /** Structured logger; defaults to `console.error`-based logging. */
  readonly log?: (message: string) => void
}

export interface WarmSnapshotResult {
  readonly snapshotId: string
  readonly baseSha: string
  readonly lockfileSha256: `sha256:${string}`
  readonly builtAt: string
  readonly durationMs: number
}

interface StepResult {
  ok: boolean
  stdout: string
  stderr: string
  exitCode: number | undefined
  durationMs: number
}

function sha256Prefixed(hexDigest: string): `sha256:${string}` {
  return (hexDigest.startsWith('sha256:') ? hexDigest : `sha256:${hexDigest}`) as `sha256:${string}`
}

async function runStep(
  sandbox: Sandbox,
  label: string,
  script: string,
  log: (message: string) => void,
  opts: { cwd?: string; env?: Record<string, string> } = {},
): Promise<StepResult> {
  const start = Date.now()
  const result = await sandbox.runCommand({
    cmd: 'sh',
    args: ['-c', script],
    ...(opts.cwd ? { cwd: opts.cwd } : {}),
    ...(opts.env ? { env: opts.env } : {}),
  })
  const stdout = await result.stdout()
  const stderr = await result.stderr()
  const durationMs = Date.now() - start
  const ok = (result.exitCode ?? 1) === 0
  log(`${label}: ${ok ? 'ok' : `failed (exit ${result.exitCode})`} (${durationMs}ms)`)
  if (stdout.trim()) log(`  stdout: ${stdout.trim().split('\n').join('\n           ')}`)
  if (!ok && stderr.trim()) log(`  stderr: ${stderr.trim().split('\n').join('\n           ')}`)
  return { ok, stdout, stderr, exitCode: result.exitCode, durationMs }
}

/**
 * Creates the warm base Vercel Sandbox snapshot Factory leases boot from:
 * clones `remoteUrl` at `ref`, `pnpm install --frozen-lockfile`s, builds
 * every package/plugin, records `.factory-snapshot.json` + `.factory-repo-root`
 * at the warm repo root, then snapshots and stops the seed sandbox.
 *
 * Extracted from `scripts/vercel-snapshot.mts` (still the CLI entry point for
 * one-off/manual snapshot creation) so `snapshotRegistry.ts` can create
 * per-epic snapshots programmatically from the running host.
 */
export async function createWarmSnapshot(options: CreateWarmSnapshotOptions): Promise<WarmSnapshotResult> {
  const overallStart = Date.now()
  const ref = options.ref
  const remoteUrl = options.remoteUrl ?? DEFAULT_REPO_URL
  const vcpus = options.vcpus ?? DEFAULT_VCPUS
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const snapshotExpirationMs = options.snapshotExpirationMs ?? DEFAULT_SNAPSHOT_EXPIRATION_MS
  const log = options.log ?? ((message: string) => console.error(`[warm-snapshot] ${message}`))
  const pnpmEnv = { COREPACK_HOME: FACTORY_COREPACK_HOME }

  log(`creating seed sandbox (runtime=${RUNTIME}, timeout=${timeoutMs}ms, vcpus=${vcpus}, ref=${ref ?? 'origin/main'})`)
  const seed = await Sandbox.create({
    token: options.auth.token,
    teamId: options.auth.teamId,
    projectId: options.auth.projectId,
    runtime: RUNTIME,
    timeout: timeoutMs,
    resources: { vcpus },
  })

  try {
    const versions = await runStep(seed, 'verify node/npm', 'node --version && npm --version', log)
    if (!versions.ok) throw new Error('base runtime is missing node or npm')

    const gitCheck = await runStep(seed, 'check git', 'git --version', log)
    if (!gitCheck.ok) {
      log('git missing, attempting install')
      const install = await runStep(
        seed,
        'install git',
        'which git || (sudo dnf install -y git || dnf install -y git || sudo apt-get install -y git || apt-get install -y git)',
        log,
      )
      if (!install.ok) throw new Error('failed to install git on the seed sandbox')
      const recheck = await runStep(seed, 'verify git after install', 'git --version', log)
      if (!recheck.ok) throw new Error('git still unavailable after install attempt')
    }

    const corepack = await runStep(seed, 'enable corepack', 'corepack enable 2>&1', log)
    if (!corepack.ok) log('corepack enable did not fully succeed; snapshot will still be created')

    // The token (when present) is only ever passed as an exec-scoped env var
    // and referenced by the script as a shell variable expansion — never
    // interpolated into the script's literal text, which `runCommand` would
    // otherwise expose via `ps` inside the sandbox, and never logged (`log`
    // only sees this fixed label plus the command's stdout/stderr).
    const cloneCommand = options.gitToken
      ? `factory_auth_header="AUTHORIZATION: basic $(printf '%s' \"x-access-token:$${FACTORY_GIT_TOKEN_ENV_VAR}\" | base64 | tr -d '\\n')" && git -c http.extraheader="$factory_auth_header" clone --filter=blob:none ${remoteUrl} ${FACTORY_WARM_REPO_ROOT}`
      : `git clone --filter=blob:none ${remoteUrl} ${FACTORY_WARM_REPO_ROOT}`
    const clone = await runStep(
      seed,
      `clone ${remoteUrl} into ${FACTORY_WARM_REPO_ROOT}`,
      ['mkdir -p /vercel/sandbox', `rm -rf ${FACTORY_WARM_REPO_ROOT}`, cloneCommand].join(' && '),
      log,
      options.gitToken ? { env: { [FACTORY_GIT_TOKEN_ENV_VAR]: options.gitToken } } : {},
    )
    if (!clone.ok) throw new Error('git clone into the seed sandbox failed')

    const checkout = await runStep(
      seed,
      `checkout ${ref ?? 'origin/main'}`,
      ref ? `git checkout -q --detach "${ref}"` : 'git checkout -q --detach origin/main',
      log,
      { cwd: FACTORY_WARM_REPO_ROOT },
    )
    if (!checkout.ok) throw new Error(`checkout of ${ref ?? 'origin/main'} failed`)

    const pnpmVersionStep = await runStep(
      seed,
      'read pnpm version from packageManager',
      'node -e "process.stdout.write((require(\'./package.json\').packageManager || \'\').replace(/^pnpm@/, \'\'))"',
      log,
      { cwd: FACTORY_WARM_REPO_ROOT },
    )
    const pnpmVersion = pnpmVersionStep.stdout.trim() || 'latest'

    const activatePnpm = await runStep(
      seed,
      `activate pnpm@${pnpmVersion}`,
      `corepack prepare pnpm@${pnpmVersion} --activate 2>&1 && pnpm --version`,
      log,
      { cwd: FACTORY_WARM_REPO_ROOT, env: pnpmEnv },
    )
    if (!activatePnpm.ok) throw new Error(`failed to activate pnpm@${pnpmVersion} via corepack`)

    // `--frozen-lockfile` first (the common, honestly-updated-lockfile case);
    // `--no-frozen-lockfile` as a fallback for a branch whose `pnpm-lock.yaml`
    // has genuinely drifted from `package.json` (verified live building a
    // per-epic snapshot for a real epic branch with exactly this drift) —
    // matches the same fallback `buildFactoryBootstrapScript`'s lease-time
    // install already applies; installing what package.json actually asks
    // for beats refusing to snapshot the ref at all.
    const install = await runStep(
      seed,
      'pnpm install --frozen-lockfile (falls back to --no-frozen-lockfile on lockfile drift)',
      'pnpm install --frozen-lockfile || pnpm install --no-frozen-lockfile',
      log,
      { cwd: FACTORY_WARM_REPO_ROOT, env: pnpmEnv },
    )
    if (!install.ok) throw new Error('pnpm install failed on the seed sandbox (tried --frozen-lockfile and --no-frozen-lockfile)')

    const build = await runStep(
      seed,
      BUILD_COMMAND,
      BUILD_COMMAND,
      log,
      { cwd: FACTORY_WARM_REPO_ROOT, env: { ...pnpmEnv, NODE_OPTIONS: '--max-old-space-size=6144' } },
    )
    if (!build.ok) throw new Error(`${BUILD_COMMAND} failed on the seed sandbox`)

    const baseShaStep = await runStep(seed, 'git rev-parse HEAD', 'git rev-parse HEAD', log, { cwd: FACTORY_WARM_REPO_ROOT })
    if (!baseShaStep.ok) throw new Error('failed to read baseSha after checkout')
    const baseSha = baseShaStep.stdout.trim()

    const lockfileHashStep = await runStep(
      seed,
      'sha256 of pnpm-lock.yaml',
      "sha256sum pnpm-lock.yaml | cut -d' ' -f1",
      log,
      { cwd: FACTORY_WARM_REPO_ROOT },
    )
    if (!lockfileHashStep.ok) throw new Error('failed to hash pnpm-lock.yaml')
    const lockfileSha256 = sha256Prefixed(lockfileHashStep.stdout.trim())

    const builtAt = new Date().toISOString()
    const snapshotManifest = {
      baseSha,
      lockfileSha256,
      pnpmVersion,
      builtAt,
      buildCommand: BUILD_COMMAND,
      repoRoot: FACTORY_WARM_REPO_ROOT,
    }
    const manifestJson = JSON.stringify(snapshotManifest, null, 2)

    const writeManifest = await runStep(
      seed,
      'write .factory-snapshot.json + .factory-repo-root',
      [
        `cat > .factory-snapshot.json <<'FACTORY_SNAPSHOT_EOF'\n${manifestJson}\nFACTORY_SNAPSHOT_EOF`,
        `printf '%s' '${FACTORY_WARM_REPO_ROOT}' > .factory-repo-root`,
      ].join('\n'),
      log,
      { cwd: FACTORY_WARM_REPO_ROOT },
    )
    if (!writeManifest.ok) throw new Error('failed to write .factory-snapshot.json')

    log(`warm manifest: ${JSON.stringify(snapshotManifest)}`)
    log(`creating snapshot (expiration=${snapshotExpirationMs}ms)`)
    const snapshotStart = Date.now()
    const snapshot = await seed.snapshot({ expiration: snapshotExpirationMs })
    const snapshotMs = Date.now() - snapshotStart
    log(`snapshot created: ${snapshot.snapshotId} (${snapshotMs}ms)`)
    const durationMs = Date.now() - overallStart
    log(`total time: ${durationMs}ms`)

    return { snapshotId: snapshot.snapshotId, baseSha, lockfileSha256, builtAt, durationMs }
  } finally {
    log('stopping seed sandbox')
    try {
      await seed.stop()
    } catch (error) {
      log(`seed sandbox stop failed (non-fatal): ${(error as Error).message}`)
    }
  }
}
