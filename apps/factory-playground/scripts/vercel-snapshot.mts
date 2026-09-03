#!/usr/bin/env tsx
/**
 * Creates the immutable base Vercel Sandbox snapshot the Factory playground
 * boots disposable leases from (`BORING_FACTORY_VERCEL_SNAPSHOT_ID`, or —
 * when unset — the per-epic snapshot registry in `snapshotRegistry.ts`
 * builds these on demand via the same `createWarmSnapshot` this script
 * calls).
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
 *   Implemented by `createWarmSnapshot` in `../src/server/warmSnapshot.ts`;
 *   this script is a thin CLI over it.
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
import { createWarmSnapshot } from '../src/server/warmSnapshot'

const BARE_MODE = process.argv.includes('--bare')
const REF = (() => {
  const idx = process.argv.indexOf('--ref')
  return idx !== -1 ? process.argv[idx + 1] : undefined
})()

const BARE_SEED_TIMEOUT_MS = 10 * 60 * 1000
const SNAPSHOT_EXPIRATION_MS = 7 * 24 * 60 * 60 * 1000
const RUNTIME = 'node24'

function requireEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

async function runBareMode(token: string, teamId: string, projectId: string): Promise<void> {
  const overallStart = Date.now()
  console.error(`[vercel-snapshot] mode=bare creating seed sandbox (runtime=${RUNTIME}, timeout=${BARE_SEED_TIMEOUT_MS}ms)`)
  const seed = await Sandbox.create({ token, teamId, projectId, runtime: RUNTIME, timeout: BARE_SEED_TIMEOUT_MS })
  try {
    const run = async (label: string, script: string) => {
      const start = Date.now()
      const result = await seed.runCommand({ cmd: 'sh', args: ['-c', script] })
      const stdout = await result.stdout()
      const stderr = await result.stderr()
      const ok = (result.exitCode ?? 1) === 0
      console.error(`[vercel-snapshot] ${label}: ${ok ? 'ok' : `failed (exit ${result.exitCode})`} (${Date.now() - start}ms)`)
      if (stdout.trim()) console.error(`[vercel-snapshot]   stdout: ${stdout.trim().split('\n').join('\n            ')}`)
      if (!ok && stderr.trim()) console.error(`[vercel-snapshot]   stderr: ${stderr.trim().split('\n').join('\n            ')}`)
      return ok
    }
    if (!(await run('verify node/npm', 'node --version && npm --version'))) {
      throw new Error('base runtime is missing node or npm')
    }
    if (!(await run('check git', 'git --version'))) {
      console.error('[vercel-snapshot] git missing, attempting install')
      if (!(await run(
        'install git',
        'which git || (sudo dnf install -y git || dnf install -y git || sudo apt-get install -y git || apt-get install -y git)',
      ))) {
        throw new Error('failed to install git on the seed sandbox')
      }
      if (!(await run('verify git after install', 'git --version'))) throw new Error('git still unavailable after install attempt')
    }
    if (!(await run('enable corepack', 'corepack enable 2>&1'))) {
      console.error('[vercel-snapshot] corepack enable did not fully succeed; snapshot will still be created')
    }
    if (!(await run(
      'activate pnpm@latest (best-effort)',
      'corepack prepare pnpm@latest --activate 2>&1 && pnpm --version || echo "corepack/pnpm unavailable, continuing without it"',
    ))) {
      console.error('[vercel-snapshot] pnpm activation did not fully succeed; snapshot will still be created')
    }

    console.error(`[vercel-snapshot] creating snapshot (expiration=${SNAPSHOT_EXPIRATION_MS}ms)`)
    const snapshotStart = Date.now()
    const snapshot = await seed.snapshot({ expiration: SNAPSHOT_EXPIRATION_MS })
    console.error(`[vercel-snapshot] snapshot created: ${snapshot.snapshotId} (${Date.now() - snapshotStart}ms)`)
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

async function main(): Promise<void> {
  const token = process.env.VERCEL_TOKEN
    ?? process.env.VERCEL_ACCESS_TOKEN
    ?? process.env.VERCEL_OIDC_TOKEN
  if (!token?.trim()) {
    throw new Error('VERCEL_TOKEN, VERCEL_ACCESS_TOKEN, or VERCEL_OIDC_TOKEN is required')
  }
  const teamId = requireEnv('VERCEL_TEAM_ID')
  const projectId = requireEnv('VERCEL_PROJECT_ID')

  if (BARE_MODE) {
    await runBareMode(token, teamId, projectId)
    return
  }

  const result = await createWarmSnapshot({
    ref: REF,
    auth: { token, teamId, projectId },
    log: (message) => console.error(`[vercel-snapshot] ${message}`),
  })
  console.error(`[vercel-snapshot] result: ${JSON.stringify(result)}`)
  console.log(`BORING_FACTORY_VERCEL_SNAPSHOT_ID=${result.snapshotId}`)
}

main().catch((error) => {
  console.error(`[vercel-snapshot] FAILED: ${(error as Error).message}`)
  process.exitCode = 1
})
