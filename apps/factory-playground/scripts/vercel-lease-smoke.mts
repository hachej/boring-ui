#!/usr/bin/env tsx
/**
 * Credential-gated smoke test for the composed Vercel Factory sandbox
 * provider: builds it via `createFactorySandboxProvider` — the exact same
 * composition `sandboxComposition.ts` uses for real Worker leases — for a
 * real epic worktree, creates one lease, verifies `.factory-sha` matches the
 * worktree's committed HEAD, runs `FACTORY_SMOKE_COMMAND` (default `pnpm
 * --filter factory-playground test`) inside the sandbox, and disposes the
 * pair.
 *
 * Two modes, selected by whether `BORING_FACTORY_VERCEL_SNAPSHOT_ID` is set:
 * - **fixed**: boots from that snapshot id directly (the old behavior).
 * - **per-epic** (unset, the interesting path): exercises
 *   `snapshotRegistry.ts`'s `resolveEpicSnapshot` — the first run builds a
 *   warm snapshot from the worktree's own HEAD and caches it in
 *   `FACTORY_SMOKE_STATE_ROOT/snapshots.json`; subsequent runs reuse it.
 *
 * Usage:
 *   RUN_VERCEL_FACTORY_SMOKE=1 \
 *   VERCEL_TOKEN=... VERCEL_TEAM_ID=... VERCEL_PROJECT_ID=... \
 *   BORING_SANDBOX_TELEMETRY_SALT=local-smoke \
 *   FACTORY_SMOKE_COMMAND='pnpm --filter factory-playground test' \
 *     pnpm --filter factory-playground exec tsx scripts/vercel-lease-smoke.mts
 */
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { createFactorySandboxProvider, resolveFactoryEpicKey } from '../src/server/sandboxComposition'
import { getFactoryBootstrapLog } from '../src/server/remoteSnapshotProvider'

const execFileAsync = promisify(execFile)

const EPIC_WORKTREE = process.env.FACTORY_SMOKE_EPIC_WORKTREE
  ?? '/home/ubuntu/projects/boring-ui-v2/.worktrees/factory-live-epic-1508-r4'

const DEFAULT_COMMAND = 'pnpm --filter factory-playground test'

function requireEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function now(): number {
  return Date.now()
}

function printTimingsTable(timings: Record<string, number>): void {
  const rows = Object.entries(timings)
  const nameWidth = Math.max(...rows.map(([name]) => name.length), 'phase'.length)
  console.error(`[lease-smoke] ${'phase'.padEnd(nameWidth)}  ms`)
  console.error(`[lease-smoke] ${'-'.repeat(nameWidth)}  ----`)
  for (const [name, ms] of rows) {
    console.error(`[lease-smoke] ${name.padEnd(nameWidth)}  ${ms}`)
  }
  const total = rows.reduce((sum, [, ms]) => sum + ms, 0)
  console.error(`[lease-smoke] ${'total'.padEnd(nameWidth)}  ${total}`)
}

function printBootstrapPhaseBreakdown(log: string | undefined): void {
  if (!log) {
    console.error('[lease-smoke] bootstrap phase breakdown: unavailable (no bootstrap log captured)')
    return
  }
  const phaseLines = log.split('\n').filter((line) => line.startsWith('factory-bootstrap-phase '))
  if (phaseLines.length === 0) {
    console.error('[lease-smoke] bootstrap phase breakdown: no phase markers found (cold path, or already bootstrapped)')
    return
  }
  console.error('[lease-smoke] bootstrap phase breakdown:')
  for (const line of phaseLines) console.error(`[lease-smoke]   ${line.replace('factory-bootstrap-phase ', '')}`)
}

async function main(): Promise<void> {
  if (process.env.RUN_VERCEL_FACTORY_SMOKE !== '1') {
    console.error('Skipping real Vercel Factory lease smoke. Set RUN_VERCEL_FACTORY_SMOKE=1 to run.')
    return
  }

  const token = process.env.VERCEL_TOKEN
    ?? process.env.VERCEL_ACCESS_TOKEN
    ?? process.env.VERCEL_OIDC_TOKEN
  if (!token?.trim()) throw new Error('VERCEL_TOKEN, VERCEL_ACCESS_TOKEN, or VERCEL_OIDC_TOKEN is required')
  const teamId = requireEnv('VERCEL_TEAM_ID')
  const projectId = requireEnv('VERCEL_PROJECT_ID')
  const immutableSnapshotId = process.env.BORING_FACTORY_VERCEL_SNAPSHOT_ID?.trim()
  const telemetrySalt = requireEnv('BORING_SANDBOX_TELEMETRY_SALT')
  const smokeCommand = process.env.FACTORY_SMOKE_COMMAND?.trim() || DEFAULT_COMMAND
  const sourceOverride = process.env.FACTORY_SMOKE_SOURCE?.trim()
  if (sourceOverride && sourceOverride !== 'fetch' && sourceOverride !== 'archive') {
    throw new Error("FACTORY_SMOKE_SOURCE must be 'fetch' or 'archive'")
  }

  process.env.VERCEL_TOKEN = token
  process.env.VERCEL_TEAM_ID = teamId
  process.env.VERCEL_PROJECT_ID = projectId
  // Verified live: a default-resource (1 vCPU/2048 MB) disposable lease OOMs
  // rebuilding memory-heavy packages (packages/agent, packages/boring-sandbox)
  // during the warm bootstrap's incremental build, even with NODE_OPTIONS
  // raised — the ceiling is real machine memory. createFactorySandboxProvider
  // defaults this to 4 itself when unset; set explicitly here anyway for a
  // predictable smoke.
  if (!process.env.BORING_AGENT_VERCEL_SANDBOX_VCPUS) {
    process.env.BORING_AGENT_VERCEL_SANDBOX_VCPUS = '4'
  }

  const expectedSha = (
    await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: EPIC_WORKTREE })
  ).stdout.trim()
  console.error(`[lease-smoke] epic worktree HEAD: ${expectedSha}`)
  console.error(`[lease-smoke] command: ${smokeCommand}`)
  console.error(`[lease-smoke] snapshot mode: ${immutableSnapshotId ? `fixed (${immutableSnapshotId})` : 'per-epic (registry)'}`)

  // Persistent (not mkdtemp-under-tmp) so a second invocation of this script
  // reuses the same `snapshots.json` registry the first run built — the
  // point of the per-epic path being exercised here.
  const stateRoot = resolve(
    process.env.FACTORY_SMOKE_STATE_ROOT?.trim() || resolve(EPIC_WORKTREE, '.factory-smoke-state'),
  )
  await mkdir(stateRoot, { recursive: true })
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'factory-vercel-lease-smoke-workspace-'))

  const providerEnv: NodeJS.ProcessEnv = {
    ...process.env,
    BORING_FACTORY_SANDBOX_PROVIDER: 'vercel',
    BORING_SANDBOX_TELEMETRY_SALT: telemetrySalt,
    BORING_AGENT_VERCEL_SANDBOX_TIMEOUT_MS: process.env.BORING_AGENT_VERCEL_SANDBOX_TIMEOUT_MS ?? String(10 * 60_000),
    ...(immutableSnapshotId ? { BORING_FACTORY_VERCEL_SNAPSHOT_ID: immutableSnapshotId } : {}),
    ...(sourceOverride ? { BORING_FACTORY_REMOTE_SOURCE: sourceOverride } : {}),
  }
  const epicKey = await resolveFactoryEpicKey(EPIC_WORKTREE, providerEnv)
  console.error(`[lease-smoke] epicKey: ${epicKey}`)
  const provider = createFactorySandboxProvider(EPIC_WORKTREE, stateRoot, providerEnv, epicKey)

  const timings: Record<string, number> = {}
  let pair: Awaited<ReturnType<typeof provider.create>> | undefined
  try {
    const createStart = now()
    pair = await provider.create({
      workspaceRoot,
      sessionId: 'factory-vercel-lease-smoke',
      requestId: 'factory-vercel-lease-smoke-request',
    })
    timings.create = now() - createStart

    // Disposable Vercel pairs defer template-seeding readiness past `create`;
    // `checkHealth` is what actually awaits it (mirrors SandboxLeaseService.withPair).
    const healthStart = now()
    const health = await pair.checkHealth?.()
    timings.seed = now() - healthStart
    if (health && health.state !== 'ok') {
      throw new Error(`sandbox pair unhealthy after create: ${JSON.stringify(health)}`)
    }

    // In 'fetch' mode, the pair's first exec() transparently runs
    // factory-bootstrap.sh (fetch/checkout, and — on a warm snapshot —
    // install-if-needed + incremental build) before anything else. The
    // per-epic provider (`createPerEpicVercelProvider`) already ran this
    // probe once inside `create()` itself (to catch the changed-package-count
    // refresh guard) when snapshot mode is 'per-epic', so this second no-op
    // exec is cheap (bootstrap is idempotency-guarded); in fixed-snapshot
    // mode this is the first bootstrap trigger. Either way, its cost is
    // measured and reported separately from the real command below.
    const bootstrapStart = now()
    const bootstrapProbe = await pair.sandbox.exec('true')
    timings.bootstrap = now() - bootstrapStart
    printBootstrapPhaseBreakdown(getFactoryBootstrapLog(pair.sandbox))
    if (bootstrapProbe.exitCode !== 0) {
      const stderr = Buffer.from(bootstrapProbe.stderr ?? '').toString('utf8')
      const bootstrapLog = getFactoryBootstrapLog(pair.sandbox)
      console.error('[lease-smoke] full bootstrap log:')
      console.error(bootstrapLog ?? '(none captured)')
      throw new Error(`bootstrap probe failed (exit ${bootstrapProbe.exitCode}): ${stderr.trim()}`)
    }

    const shaCheckStart = now()
    const shaResult = await pair.sandbox.exec('cat .factory-sha')
    timings.verifySha = now() - shaCheckStart
    const reportedSha = Buffer.from(shaResult.stdout ?? '').toString('utf8').trim()
    if (reportedSha !== expectedSha) {
      throw new Error(`.factory-sha mismatch: expected ${expectedSha}, got ${reportedSha}`)
    }

    const execStart = now()
    const result = await pair.sandbox.exec(smokeCommand, { timeoutMs: 10 * 60_000 })
    timings.command = now() - execStart

    const stdout = Buffer.from(result.stdout ?? '').toString('utf8')
    const stderr = Buffer.from(result.stderr ?? '').toString('utf8')
    const combinedLines = `${stdout}\n${stderr}`.trim().split('\n')

    console.error(`[lease-smoke] exit code: ${result.exitCode}`)
    console.error(`[lease-smoke] first 15 lines of output:`)
    console.error(combinedLines.slice(0, 15).join('\n'))
    console.error(`[lease-smoke] last 15 lines of output:`)
    console.error(combinedLines.slice(-15).join('\n'))

    if (result.exitCode !== 0) {
      throw new Error(`sandbox command exited with code ${result.exitCode}`)
    }

    console.log(JSON.stringify({
      ok: true,
      snapshotMode: immutableSnapshotId ? 'fixed' : 'per-epic',
      immutableSnapshotId: immutableSnapshotId ?? null,
      epicKey,
      expectedSha,
      command: smokeCommand,
      exitCode: result.exitCode,
      timingsMs: timings,
    }))
  } finally {
    if (pair) {
      const disposeStart = now()
      await pair.dispose()
      timings.dispose = now() - disposeStart
    }
    printTimingsTable(timings)
    await rm(workspaceRoot, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(`[lease-smoke] FAILED: ${(error as Error).message}`)
  process.exitCode = 1
})
