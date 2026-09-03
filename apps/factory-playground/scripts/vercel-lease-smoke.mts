#!/usr/bin/env tsx
/**
 * Credential-gated smoke test for the composed exact-SHA Vercel Factory
 * provider: builds `createExactShaTemplateProvider` around
 * `createVercelSandboxProvider` for a real epic worktree, creates one lease,
 * verifies `.factory-sha` matches the worktree's committed HEAD, runs
 * `FACTORY_SMOKE_COMMAND` (default `pnpm --filter factory-playground test`)
 * inside the sandbox, and disposes the pair.
 *
 * Usage:
 *   RUN_VERCEL_FACTORY_SMOKE=1 \
 *   VERCEL_TOKEN=... VERCEL_TEAM_ID=... VERCEL_PROJECT_ID=... \
 *   BORING_FACTORY_VERCEL_SNAPSHOT_ID=snap_... \
 *   BORING_SANDBOX_TELEMETRY_SALT=local-smoke \
 *   FACTORY_SMOKE_COMMAND='pnpm --filter factory-playground test' \
 *     pnpm --filter factory-playground exec tsx scripts/vercel-lease-smoke.mts
 */
import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { createVercelSandboxProvider } from '@hachej/boring-sandbox/providers/vercel-sandbox'
import { createExactShaTemplateProvider, getFactoryBootstrapLog } from '../src/server/remoteSnapshotProvider'

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

function printBootstrapPhaseBreakdown(sandbox: { exec: unknown } | undefined, log: string | undefined): void {
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
  const immutableSnapshotId = requireEnv('BORING_FACTORY_VERCEL_SNAPSHOT_ID')
  const telemetrySalt = requireEnv('BORING_SANDBOX_TELEMETRY_SALT')
  const smokeCommand = process.env.FACTORY_SMOKE_COMMAND?.trim() || DEFAULT_COMMAND

  process.env.VERCEL_TOKEN = token
  process.env.VERCEL_TEAM_ID = teamId
  process.env.VERCEL_PROJECT_ID = projectId
  // Verified live: a default-resource (1 vCPU/2048 MB) disposable lease OOMs
  // rebuilding memory-heavy packages (packages/agent, packages/boring-sandbox)
  // during the warm bootstrap's incremental build, even with NODE_OPTIONS
  // raised — the ceiling is real machine memory. Bump it for this smoke the
  // same way a real caller would (createVercelSandboxProvider reads this).
  if (!process.env.BORING_AGENT_VERCEL_SANDBOX_VCPUS) {
    process.env.BORING_AGENT_VERCEL_SANDBOX_VCPUS = '4'
  }

  const expectedSha = (
    await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: EPIC_WORKTREE })
  ).stdout.trim()
  console.error(`[lease-smoke] epic worktree HEAD: ${expectedSha}`)
  console.error(`[lease-smoke] command: ${smokeCommand}`)

  const scratchRoot = await mkdtemp(join(tmpdir(), 'factory-vercel-lease-smoke-scratch-'))
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'factory-vercel-lease-smoke-workspace-'))

  const inner = createVercelSandboxProvider({
    lifecycle: 'disposable',
    immutableSnapshotId,
    timeoutMs: 10 * 60_000,
    telemetrySalt,
  })
  const sourceOverride = process.env.FACTORY_SMOKE_SOURCE?.trim()
  if (sourceOverride && sourceOverride !== 'fetch' && sourceOverride !== 'archive') {
    throw new Error("FACTORY_SMOKE_SOURCE must be 'fetch' or 'archive'")
  }
  const provider = createExactShaTemplateProvider({
    inner,
    sourceRoot: EPIC_WORKTREE,
    scratchRoot,
    ...(sourceOverride ? { source: sourceOverride as 'fetch' | 'archive' } : {}),
  })

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
    // install-if-needed + incremental build) before anything else. Run a
    // trivial no-op exec first so that cost is measured and reported
    // separately from the real command below; in 'archive' mode this is
    // just an extra cheap exec.
    const bootstrapStart = now()
    const bootstrapProbe = await pair.sandbox.exec('true')
    timings.bootstrap = now() - bootstrapStart
    printBootstrapPhaseBreakdown(pair.sandbox, getFactoryBootstrapLog(pair.sandbox))
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
      snapshotId: immutableSnapshotId,
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
    await rm(scratchRoot, { recursive: true, force: true })
    await rm(workspaceRoot, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(`[lease-smoke] FAILED: ${(error as Error).message}`)
  process.exitCode = 1
})
