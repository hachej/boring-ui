#!/usr/bin/env tsx
/**
 * Creates the immutable base Vercel Sandbox snapshot the Factory playground
 * boots every disposable lease from (`BORING_FACTORY_VERCEL_SNAPSHOT_ID`).
 *
 * Two modes:
 *
 * - **Warm (default)**: clones `hachej/boring-ui` at `--ref` (default
 *   `origin/main`) into `FACTORY_WARM_REPO_ROOT` (`/vercel/sandbox/repo`,
 *   shared with `remoteSnapshotProvider.ts`'s bootstrap script), runs `pnpm
 *   install --frozen-lockfile`, builds every package/plugin
 *   (`pnpm run build:packages`), and records `.factory-snapshot.json` +
 *   `.factory-repo-root` at the repo root. A lease booted from this snapshot
 *   only needs to `git fetch`/`checkout` the exact SHA, reinstall iff the
 *   lockfile hash moved, and rebuild only the packages that changed since
 *   `baseSha` — see `FACTORY_BOOTSTRAP_SCRIPT` in `remoteSnapshotProvider.ts`.
 * - **`--bare`**: the original, much cheaper snapshot — proves `node`,
 *   `npm`, `git`, and (best-effort) `pnpm` via corepack, but does not touch
 *   source code. A lease from a bare snapshot always pays the full
 *   install+build cost of the cold bootstrap path.
 *
 * Usage:
 *   VERCEL_TOKEN=... VERCEL_TEAM_ID=... VERCEL_PROJECT_ID=... \
 *     pnpm --filter factory-playground snapshot:vercel [--bare] [--ref <sha-or-ref>]
 *
 * Prints `BORING_FACTORY_VERCEL_SNAPSHOT_ID=<id>` on success (last stdout line).
 */
import { Sandbox } from '@vercel/sandbox'
import { FACTORY_COREPACK_HOME, FACTORY_WARM_REPO_ROOT } from '../src/server/remoteSnapshotProvider'

const BARE_MODE = process.argv.includes('--bare')
const REF = (() => {
  const idx = process.argv.indexOf('--ref')
  return idx !== -1 ? process.argv[idx + 1] : undefined
})()

const SEED_TIMEOUT_MS = BARE_MODE ? 10 * 60 * 1000 : 40 * 60 * 1000
const SNAPSHOT_EXPIRATION_MS = 7 * 24 * 60 * 60 * 1000
const RUNTIME = 'node24'
// Vercel sandbox default is 1 vCPU / 2048 MB, which OOMs building this monorepo
// (`packages/agent`'s tsup DTS build alone needs more headroom). Bare mode
// never builds anything, so it stays at the default (omit `resources`).
// Verified live: `resources: { vcpus: 8 }` was rejected outright (400) on
// this Vercel plan/team; 4 vCPUs (8192 MB) is accepted.
const SEED_VCPUS = BARE_MODE ? undefined : 4
const REPO_URL = 'https://github.com/hachej/boring-ui.git'
// Verified live: without an explicit COREPACK_HOME, a lease sandbox booted
// from the snapshot re-triggered corepack's network fetch of pnpm on its
// very first invocation ("Corepack is about to download ...") even though
// the seed sandbox had already `corepack prepare --activate`d it — corepack's
// default cache location isn't part of what survives from seed to lease.
// Pointing COREPACK_HOME at a fixed path next to (not inside) the warm repo
// makes that cache part of the snapshotted filesystem, so leases reuse it
// offline. `remoteSnapshotProvider.ts`'s bootstrap script sets the same var.
const PNPM_ENV = { COREPACK_HOME: FACTORY_COREPACK_HOME }
// `pnpm run build:packages` defaults to --workspace-concurrency=4; tsup's DTS
// worker for `packages/agent` alone is heavy enough that 4 concurrent package
// builds OOM'd a 4-vCPU/8GB sandbox even with `resources.vcpus` raised. Force
// concurrency down to 2 to keep peak memory bounded regardless of sandbox size.
const BUILD_COMMAND = "pnpm -r --filter './packages/*' --filter './plugins/*' --workspace-concurrency=2 run build"

function requireEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

interface StepResult {
  ok: boolean
  stdout: string
  stderr: string
  exitCode: number | undefined
  durationMs: number
}

async function runStep(
  sandbox: Sandbox,
  label: string,
  script: string,
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
  console.error(`[vercel-snapshot] ${label}: ${ok ? 'ok' : `failed (exit ${result.exitCode})`} (${durationMs}ms)`)
  if (stdout.trim()) console.error(`[vercel-snapshot]   stdout: ${stdout.trim().split('\n').join('\n            ')}`)
  if (!ok && stderr.trim()) console.error(`[vercel-snapshot]   stderr: ${stderr.trim().split('\n').join('\n            ')}`)
  return { ok, stdout, stderr, exitCode: result.exitCode, durationMs }
}

async function main(): Promise<void> {
  const overallStart = Date.now()
  const token = process.env.VERCEL_TOKEN
    ?? process.env.VERCEL_ACCESS_TOKEN
    ?? process.env.VERCEL_OIDC_TOKEN
  if (!token?.trim()) {
    throw new Error('VERCEL_TOKEN, VERCEL_ACCESS_TOKEN, or VERCEL_OIDC_TOKEN is required')
  }
  const teamId = requireEnv('VERCEL_TEAM_ID')
  const projectId = requireEnv('VERCEL_PROJECT_ID')

  console.error(
    `[vercel-snapshot] mode=${BARE_MODE ? 'bare' : 'warm'} creating seed sandbox ` +
    `(runtime=${RUNTIME}, timeout=${SEED_TIMEOUT_MS}ms, vcpus=${SEED_VCPUS ?? 'default'})`,
  )
  const seed = await Sandbox.create({
    token,
    teamId,
    projectId,
    runtime: RUNTIME,
    timeout: SEED_TIMEOUT_MS,
    ...(SEED_VCPUS ? { resources: { vcpus: SEED_VCPUS } } : {}),
  })

  try {
    const versions = await runStep(
      seed,
      'verify node/npm',
      'node --version && npm --version',
    )
    if (!versions.ok) throw new Error('base runtime is missing node or npm')

    const gitCheck = await runStep(seed, 'check git', 'git --version')
    if (!gitCheck.ok) {
      console.error('[vercel-snapshot] git missing, attempting install')
      const install = await runStep(
        seed,
        'install git',
        'which git || (sudo dnf install -y git || dnf install -y git || sudo apt-get install -y git || apt-get install -y git)',
      )
      if (!install.ok) throw new Error('failed to install git on the seed sandbox')
      const recheck = await runStep(seed, 'verify git after install', 'git --version')
      if (!recheck.ok) throw new Error('git still unavailable after install attempt')
    }

    const corepack = await runStep(
      seed,
      'enable corepack',
      'corepack enable 2>&1',
    )
    if (!corepack.ok) {
      console.error('[vercel-snapshot] corepack enable did not fully succeed; snapshot will still be created')
    }

    if (BARE_MODE) {
      const pnpm = await runStep(
        seed,
        'activate pnpm@latest (best-effort)',
        'corepack prepare pnpm@latest --activate 2>&1 && pnpm --version || echo "corepack/pnpm unavailable, continuing without it"',
      )
      if (!pnpm.ok) {
        console.error('[vercel-snapshot] pnpm activation did not fully succeed; snapshot will still be created')
      }
    } else {
      const clone = await runStep(
        seed,
        `clone ${REPO_URL} into ${FACTORY_WARM_REPO_ROOT}`,
        [
          'mkdir -p /vercel/sandbox',
          `rm -rf ${FACTORY_WARM_REPO_ROOT}`,
          `git clone --filter=blob:none ${REPO_URL} ${FACTORY_WARM_REPO_ROOT}`,
        ].join(' && '),
      )
      if (!clone.ok) throw new Error('git clone into the seed sandbox failed')

      const checkout = await runStep(
        seed,
        `checkout ${REF ?? 'origin/main'}`,
        REF ? `git checkout -q --detach "${REF}"` : 'git checkout -q --detach origin/main',
        { cwd: FACTORY_WARM_REPO_ROOT },
      )
      if (!checkout.ok) throw new Error(`checkout of ${REF ?? 'origin/main'} failed`)

      const pnpmVersionStep = await runStep(
        seed,
        'read pnpm version from packageManager',
        'node -e "process.stdout.write((require(\'./package.json\').packageManager || \'\').replace(/^pnpm@/, \'\'))"',
        { cwd: FACTORY_WARM_REPO_ROOT },
      )
      const pnpmVersion = pnpmVersionStep.stdout.trim() || 'latest'

      const activatePnpm = await runStep(
        seed,
        `activate pnpm@${pnpmVersion}`,
        `corepack prepare pnpm@${pnpmVersion} --activate 2>&1 && pnpm --version`,
        { cwd: FACTORY_WARM_REPO_ROOT, env: PNPM_ENV },
      )
      if (!activatePnpm.ok) throw new Error(`failed to activate pnpm@${pnpmVersion} via corepack`)

      const install = await runStep(
        seed,
        'pnpm install --frozen-lockfile',
        'pnpm install --frozen-lockfile',
        { cwd: FACTORY_WARM_REPO_ROOT, env: PNPM_ENV },
      )
      if (!install.ok) throw new Error('pnpm install --frozen-lockfile failed on the seed sandbox')

      const build = await runStep(
        seed,
        BUILD_COMMAND,
        BUILD_COMMAND,
        // tsup's DTS worker (heaviest in `packages/agent`) OOM'd at the
        // default heap size regardless of sandbox vCPUs/memory — verified
        // live the cap is a Node worker-thread default, not actual RAM
        // pressure, so raise it explicitly instead of chasing more vCPUs.
        { cwd: FACTORY_WARM_REPO_ROOT, env: { ...PNPM_ENV, NODE_OPTIONS: '--max-old-space-size=6144' } },
      )
      if (!build.ok) throw new Error(`${BUILD_COMMAND} failed on the seed sandbox`)

      const baseShaStep = await runStep(seed, 'git rev-parse HEAD', 'git rev-parse HEAD', { cwd: FACTORY_WARM_REPO_ROOT })
      if (!baseShaStep.ok) throw new Error('failed to read baseSha after checkout')
      const baseSha = baseShaStep.stdout.trim()

      const lockfileHashStep = await runStep(
        seed,
        'sha256 of pnpm-lock.yaml',
        "sha256sum pnpm-lock.yaml | cut -d' ' -f1",
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
        { cwd: FACTORY_WARM_REPO_ROOT },
      )
      if (!writeManifest.ok) throw new Error('failed to write .factory-snapshot.json')

      console.error(`[vercel-snapshot] warm manifest: ${JSON.stringify(snapshotManifest)}`)
    }

    console.error(`[vercel-snapshot] creating snapshot (expiration=${SNAPSHOT_EXPIRATION_MS}ms)`)
    const snapshotStart = Date.now()
    const snapshot = await seed.snapshot({ expiration: SNAPSHOT_EXPIRATION_MS })
    const snapshotMs = Date.now() - snapshotStart
    console.error(`[vercel-snapshot] snapshot created: ${snapshot.snapshotId} (${snapshotMs}ms)`)
    console.error(`[vercel-snapshot] total time: ${Date.now() - overallStart}ms`)
    console.log(`BORING_FACTORY_VERCEL_SNAPSHOT_ID=${snapshot.snapshotId}`)
  } finally {
    console.error('[vercel-snapshot] stopping seed sandbox')
    try {
      await seed.stop()
    } catch (error) {
      console.error(`[vercel-snapshot] seed sandbox stop failed (non-fatal): ${(error as Error).message}`)
    }
  }
}

function sha256Prefixed(hexDigest: string): string {
  return hexDigest.startsWith('sha256:') ? hexDigest : `sha256:${hexDigest}`
}

main().catch((error) => {
  console.error(`[vercel-snapshot] FAILED: ${(error as Error).message}`)
  process.exitCode = 1
})
