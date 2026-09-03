#!/usr/bin/env tsx
/**
 * Creates the immutable base Vercel Sandbox snapshot the Factory playground
 * boots every disposable lease from (`BORING_FACTORY_VERCEL_SNAPSHOT_ID`).
 *
 * The snapshot only needs to prove the runtime has `node`, `npm`, and `git`
 * (installing git if the base image lacks it) and, where possible, a working
 * `pnpm` via corepack. The exact tracked tree at HEAD is layered on top of
 * this snapshot per-lease by `createExactShaTemplateProvider`, so this script
 * does not touch source code at all.
 *
 * Usage:
 *   VERCEL_TOKEN=... VERCEL_TEAM_ID=... VERCEL_PROJECT_ID=... \
 *     pnpm --filter factory-playground snapshot:vercel
 *
 * Prints `BORING_FACTORY_VERCEL_SNAPSHOT_ID=<id>` on success (last stdout line).
 */
import { Sandbox } from '@vercel/sandbox'

const SEED_TIMEOUT_MS = 10 * 60 * 1000
const SNAPSHOT_EXPIRATION_MS = 7 * 24 * 60 * 60 * 1000
const RUNTIME = 'node24'

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
}

async function runStep(sandbox: Sandbox, label: string, script: string): Promise<StepResult> {
  const result = await sandbox.runCommand({ cmd: 'sh', args: ['-c', script] })
  const stdout = await result.stdout()
  const stderr = await result.stderr()
  const ok = (result.exitCode ?? 1) === 0
  console.error(`[vercel-snapshot] ${label}: ${ok ? 'ok' : `failed (exit ${result.exitCode})`}`)
  if (stdout.trim()) console.error(`[vercel-snapshot]   stdout: ${stdout.trim().split('\n').join('\n            ')}`)
  if (!ok && stderr.trim()) console.error(`[vercel-snapshot]   stderr: ${stderr.trim().split('\n').join('\n            ')}`)
  return { ok, stdout, stderr, exitCode: result.exitCode }
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

  console.error(`[vercel-snapshot] creating seed sandbox (runtime=${RUNTIME}, timeout=${SEED_TIMEOUT_MS}ms)`)
  const seed = await Sandbox.create({
    token,
    teamId,
    projectId,
    runtime: RUNTIME,
    timeout: SEED_TIMEOUT_MS,
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
      'enable corepack/pnpm (best-effort)',
      'corepack enable 2>&1 && corepack prepare pnpm@latest --activate 2>&1 && pnpm --version || echo "corepack/pnpm unavailable, continuing without it"',
    )
    if (!corepack.ok) {
      console.error('[vercel-snapshot] corepack/pnpm setup did not fully succeed; snapshot will still be created')
    }

    console.error(`[vercel-snapshot] creating snapshot (expiration=${SNAPSHOT_EXPIRATION_MS}ms)`)
    const snapshot = await seed.snapshot({ expiration: SNAPSHOT_EXPIRATION_MS })
    console.error(`[vercel-snapshot] snapshot created: ${snapshot.snapshotId}`)
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

main().catch((error) => {
  console.error(`[vercel-snapshot] FAILED: ${(error as Error).message}`)
  process.exitCode = 1
})
