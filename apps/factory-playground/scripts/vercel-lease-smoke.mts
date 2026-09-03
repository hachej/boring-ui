#!/usr/bin/env tsx
/**
 * Credential-gated smoke test for the composed exact-SHA Vercel Factory
 * provider: builds `createExactShaTemplateProvider` around
 * `createVercelSandboxProvider` for a real epic worktree, creates one lease,
 * verifies `.factory-sha` matches the worktree's committed HEAD, runs the
 * fixture demo-repo's test suite inside the sandbox, and disposes the pair.
 *
 * Usage:
 *   RUN_VERCEL_FACTORY_SMOKE=1 \
 *   VERCEL_TOKEN=... VERCEL_TEAM_ID=... VERCEL_PROJECT_ID=... \
 *   BORING_FACTORY_VERCEL_SNAPSHOT_ID=snap_... \
 *   BORING_SANDBOX_TELEMETRY_SALT=local-smoke \
 *     pnpm --filter factory-playground exec tsx scripts/vercel-lease-smoke.mts
 */
import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { createVercelSandboxProvider } from '@hachej/boring-sandbox/providers/vercel-sandbox'
import { createExactShaTemplateProvider } from '../src/server/remoteSnapshotProvider'

const execFileAsync = promisify(execFile)

const EPIC_WORKTREE = process.env.FACTORY_SMOKE_EPIC_WORKTREE
  ?? '/home/ubuntu/projects/boring-ui-v2/.worktrees/factory-live-epic-1508-r4'

function requireEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function now(): number {
  return Date.now()
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

  process.env.VERCEL_TOKEN = token
  process.env.VERCEL_TEAM_ID = teamId
  process.env.VERCEL_PROJECT_ID = projectId

  const expectedSha = (
    await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: EPIC_WORKTREE })
  ).stdout.trim()
  console.error(`[lease-smoke] epic worktree HEAD: ${expectedSha}`)

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
    timings.createMs = now() - createStart

    // Disposable Vercel pairs defer template-seeding readiness past `create`;
    // `checkHealth` is what actually awaits it (mirrors SandboxLeaseService.withPair).
    const healthStart = now()
    const health = await pair.checkHealth?.()
    timings.healthMs = now() - healthStart
    if (health && health.state !== 'ok') {
      throw new Error(`sandbox pair unhealthy after create: ${JSON.stringify(health)}`)
    }

    // In 'fetch' mode, the pair's first exec() transparently runs
    // factory-bootstrap.sh (git fetch of the exact SHA) before anything
    // else. Run a trivial no-op exec first so that cost is measured and
    // reported separately from the real verification command below; in
    // 'archive' mode this is just an extra cheap exec.
    const bootstrapStart = now()
    const bootstrapProbe = await pair.sandbox.exec('true')
    timings.bootstrapMs = now() - bootstrapStart
    if (bootstrapProbe.exitCode !== 0) {
      const stderr = Buffer.from(bootstrapProbe.stderr ?? '').toString('utf8')
      throw new Error(`bootstrap probe failed (exit ${bootstrapProbe.exitCode}): ${stderr.trim()}`)
    }

    // Each step's output is followed by an explicit newline: `.factory-sha`
    // has no trailing newline of its own, and without a separator its
    // content runs directly into the next command's stdout on one line.
    const command = [
      'cat .factory-sha && echo',
      'ls apps/factory-playground/src/fixtures/demo-repo',
      'cd apps/factory-playground/src/fixtures/demo-repo && npm test',
    ].join(' && ')

    const execStart = now()
    const result = await pair.sandbox.exec(command)
    timings.execMs = now() - execStart

    const stdout = Buffer.from(result.stdout ?? '').toString('utf8')
    const stderr = Buffer.from(result.stderr ?? '').toString('utf8')
    const combined = `${stdout}\n${stderr}`.trim()
    const tailLines = combined.split('\n').slice(-20).join('\n')

    console.error(`[lease-smoke] exit code: ${result.exitCode}`)
    console.error('[lease-smoke] last 20 lines of output:')
    console.error(tailLines)

    const reportedSha = stdout.split('\n')[0]?.trim()
    if (reportedSha !== expectedSha) {
      throw new Error(`.factory-sha mismatch: expected ${expectedSha}, got ${reportedSha}`)
    }
    if (result.exitCode !== 0) {
      throw new Error(`sandbox command exited with code ${result.exitCode}`)
    }

    console.log(JSON.stringify({
      ok: true,
      snapshotId: immutableSnapshotId,
      expectedSha,
      exitCode: result.exitCode,
      timingsMs: timings,
    }))
  } finally {
    if (pair) {
      const disposeStart = now()
      await pair.dispose()
      timings.disposeMs = now() - disposeStart
      console.error(`[lease-smoke] timings: create=${timings.createMs}ms health=${timings.healthMs}ms bootstrap=${timings.bootstrapMs}ms exec=${timings.execMs}ms dispose=${timings.disposeMs}ms`)
    }
    await rm(scratchRoot, { recursive: true, force: true })
    await rm(workspaceRoot, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(`[lease-smoke] FAILED: ${(error as Error).message}`)
  process.exitCode = 1
})
