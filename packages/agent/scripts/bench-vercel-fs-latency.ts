#!/usr/bin/env tsx

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { Sandbox as VercelSandbox } from '@vercel/sandbox'

import { createBwrapSandbox } from '../src/server/sandbox/bwrap/createBwrapSandbox'
import { createVercelSandboxExec } from '../src/server/sandbox/vercel-sandbox/createVercelSandboxExec'
import { createNodeWorkspace } from '../src/server/workspace/createNodeWorkspace'
import { createVercelSandboxWorkspace } from '../src/server/workspace/createVercelSandboxWorkspace'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = path.resolve(SCRIPT_DIR, '..')
const BENCH_PREFIX = '[bench:vercel-fs-latency]'

const DEFAULT_FS_ITERATIONS = 50
const DEFAULT_CMD_ITERATIONS = 20
const DEFAULT_TIMEOUT_MS = 30_000

const TREE_FILE_COUNT = 100
const GREP_FILE_COUNT = 50
const GREP_NEEDLE = 'needle-latency-probe'

interface CliOptions {
  fsIterations: number
  cmdIterations: number
  outputPath: string
}

interface Metrics {
  p50: number
  p95: number
  p99: number
  mean: number
}

interface BenchmarkSeries {
  name: string
  samplesMs: number[]
  metrics: Metrics
}

interface Report {
  recordedAt: string
  environment: {
    teamId: string | null
    projectId: string | null
    owner: string | null
  }
  config: {
    fsIterations: number
    cmdIterations: number
    treeFileCount: number
    grepFileCount: number
  }
  benchmarks: BenchmarkSeries[]
}

function log(message: string): void {
  process.stderr.write(`${BENCH_PREFIX} ${message}\n`)
}

function fail(message: string): never {
  throw new Error(message)
}

function parsePositiveInteger(raw: string, flag: string): number {
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    fail(`${flag} must be a positive integer (received: ${raw})`)
  }
  return parsed
}

function parseCliOptions(argv: string[]): CliOptions {
  const timestamp = new Date().toISOString().replaceAll(':', '-')
  const opts: CliOptions = {
    fsIterations: DEFAULT_FS_ITERATIONS,
    cmdIterations: DEFAULT_CMD_ITERATIONS,
    outputPath: path.join(PACKAGE_ROOT, 'bench-results', `vercel-fs-latency-${timestamp}.json`),
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    switch (arg) {
      case '--fs-iterations': {
        const value = argv[i + 1]
        i += 1
        if (!value) fail('--fs-iterations requires a value')
        opts.fsIterations = parsePositiveInteger(value, '--fs-iterations')
        break
      }
      case '--cmd-iterations': {
        const value = argv[i + 1]
        i += 1
        if (!value) fail('--cmd-iterations requires a value')
        opts.cmdIterations = parsePositiveInteger(value, '--cmd-iterations')
        break
      }
      case '--output': {
        const value = argv[i + 1]
        i += 1
        if (!value) fail('--output requires a value')
        opts.outputPath = path.isAbsolute(value)
          ? value
          : path.resolve(process.cwd(), value)
        break
      }
      case '--help':
      case '-h':
        process.stdout.write(
          [
            'Usage: tsx scripts/bench-vercel-fs-latency.ts [options]',
            '',
            'Options:',
            `  --fs-iterations <n>   Iterations for read/write/stat/mkdir (default: ${DEFAULT_FS_ITERATIONS})`,
            `  --cmd-iterations <n>  Iterations for find/grep command loops (default: ${DEFAULT_CMD_ITERATIONS})`,
            '  --output <path>       JSON output file path',
            '  --help                Show this message',
            '',
            'Requires VERCEL_OIDC_TOKEN (and optionally VERCEL_TEAM_ID).',
          ].join('\n'),
        )
        process.stdout.write('\n')
        process.exit(0)
      default:
        fail(`Unknown option: ${arg}`)
    }
  }

  return opts
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split('.')
  if (parts.length < 2) {
    fail('VERCEL_OIDC_TOKEN is not a valid JWT')
  }
  const rawPayload = parts[1]
  const json = Buffer.from(rawPayload, 'base64url').toString('utf8')
  return JSON.parse(json) as Record<string, unknown>
}

function parseDotEnv(content: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    env[key] = value
  }
  return env
}

async function loadEnvLocalIfPresent(): Promise<void> {
  const envFile = path.join(PACKAGE_ROOT, '.env.local')
  try {
    const contents = await readFile(envFile, 'utf8')
    const parsed = parseDotEnv(contents)
    for (const [key, value] of Object.entries(parsed)) {
      if (!process.env[key]) {
        process.env[key] = value
      }
    }
  } catch {
    // Optional file; ignore if missing.
  }
}

async function ensureVercelAuth(): Promise<{
  teamId: string | null
  projectId: string | null
  owner: string | null
}> {
  await loadEnvLocalIfPresent()
  const token = process.env.VERCEL_OIDC_TOKEN?.trim()
  if (!token) {
    fail(
      'VERCEL_OIDC_TOKEN is required. Run `vercel link` + `vercel env pull` in packages/agent or export it explicitly.',
    )
  }

  const payload = decodeJwtPayload(token)
  const ownerId = typeof payload.owner_id === 'string' ? payload.owner_id : null
  const owner = typeof payload.owner === 'string' ? payload.owner : null
  const projectId = typeof payload.project_id === 'string' ? payload.project_id : null

  if (!process.env.VERCEL_TEAM_ID && ownerId) {
    process.env.VERCEL_TEAM_ID = ownerId
  }
  if (!process.env.VERCEL_PROJECT_ID && projectId) {
    process.env.VERCEL_PROJECT_ID = projectId
  }

  return {
    teamId: process.env.VERCEL_TEAM_ID ?? ownerId,
    projectId: process.env.VERCEL_PROJECT_ID ?? projectId,
    owner,
  }
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return Number.NaN
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.ceil((p / 100) * sorted.length)
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1))
  return sorted[index]
}

function summarize(samplesMs: number[]): Metrics {
  const total = samplesMs.reduce((sum, value) => sum + value, 0)
  return {
    p50: percentile(samplesMs, 50),
    p95: percentile(samplesMs, 95),
    p99: percentile(samplesMs, 99),
    mean: total / samplesMs.length,
  }
}

async function timeSeries(
  name: string,
  iterations: number,
  fn: (iteration: number) => Promise<void>,
): Promise<BenchmarkSeries> {
  const samplesMs: number[] = []
  for (let i = 0; i < iterations; i += 1) {
    const startedAt = performance.now()
    await fn(i)
    samplesMs.push(performance.now() - startedAt)
  }
  return {
    name,
    samplesMs,
    metrics: summarize(samplesMs),
  }
}

function makeFixtureFiles(rootPrefix: string): Array<{ path: string; content: string }> {
  const files: Array<{ path: string; content: string }> = [
    {
      path: `${rootPrefix}/read-target.txt`,
      content: 'latency benchmark read target\n',
    },
  ]

  for (let i = 0; i < TREE_FILE_COUNT; i += 1) {
    const dir = String(i % 10).padStart(2, '0')
    files.push({
      path: `${rootPrefix}/tree/dir-${dir}/file-${String(i).padStart(3, '0')}.txt`,
      content: `tree file ${i}\n`,
    })
  }

  for (let i = 0; i < GREP_FILE_COUNT; i += 1) {
    const includesNeedle = i % 4 === 0
    files.push({
      path: `${rootPrefix}/grep/file-${String(i).padStart(3, '0')}.txt`,
      content: includesNeedle
        ? `${GREP_NEEDLE} match ${i}\n`
        : `filler text ${i}\n`,
    })
  }

  return files
}

async function seedLocalFixture(rootDir: string, files: Array<{ path: string; content: string }>): Promise<void> {
  for (const file of files) {
    const absPath = path.join(rootDir, file.path)
    await mkdir(path.dirname(absPath), { recursive: true })
    await writeFile(absPath, file.content, 'utf8')
  }
}

async function seedRemoteFixture(
  sandbox: VercelSandbox,
  files: Array<{ path: string; content: string }>,
): Promise<void> {
  await sandbox.writeFiles(
    files.map((file) => ({
      path: `/vercel/sandbox/${file.path}`,
      content: Buffer.from(file.content, 'utf8'),
    })),
  )
}

function assertExecOk(name: string, exitCode: number, stdoutUtf8: string): void {
  if (exitCode !== 0) {
    fail(`${name} failed with exit code ${exitCode}`)
  }
  if (stdoutUtf8.trim().length === 0) {
    fail(`${name} returned empty stdout`)
  }
}

function formatMetric(valueMs: number): string {
  return `${valueMs.toFixed(1)}ms`
}

function renderSummary(series: BenchmarkSeries[]): string {
  const header = '| Benchmark | p50 | p95 | p99 | mean |'
  const divider = '|---|---:|---:|---:|---:|'
  const rows = series.map((entry) => {
    return `| ${entry.name} | ${formatMetric(entry.metrics.p50)} | ${formatMetric(entry.metrics.p95)} | ${formatMetric(entry.metrics.p99)} | ${formatMetric(entry.metrics.mean)} |`
  })
  return [header, divider, ...rows].join('\n')
}

async function main(): Promise<void> {
  const opts = parseCliOptions(process.argv.slice(2))
  const auth = await ensureVercelAuth()

  const localRoot = await mkdtemp(path.join(tmpdir(), 'boring-ui-v2-fs-bench-'))
  const fixtureRoot = 'bench-latency'
  const files = makeFixtureFiles(fixtureRoot)

  let remoteSandbox: VercelSandbox | null = null

  try {
    log('creating Vercel sandbox')
    remoteSandbox = await VercelSandbox.create()
    log(`sandbox created: ${remoteSandbox.sandboxId}`)

    await seedRemoteFixture(remoteSandbox, files)
    await seedLocalFixture(localRoot, files)

    const localWorkspace = createNodeWorkspace(localRoot)
    const remoteWorkspace = createVercelSandboxWorkspace(remoteSandbox)
    const localBwrap = createBwrapSandbox()
    const remoteExec = createVercelSandboxExec(remoteSandbox)

    await localBwrap.init({ workspace: localWorkspace, sessionId: 'bench-fs-latency' })
    await remoteExec.init({ workspace: remoteWorkspace, sessionId: 'bench-fs-latency' })

    await localWorkspace.mkdir(`${fixtureRoot}/mkdir`, { recursive: true })
    await localWorkspace.mkdir(`${fixtureRoot}/writes`, { recursive: true })
    await remoteWorkspace.mkdir(`${fixtureRoot}/mkdir`, { recursive: true })
    await remoteWorkspace.mkdir(`${fixtureRoot}/writes`, { recursive: true })

    const expectedFindCount = TREE_FILE_COUNT
    const expectedGrepCount = Math.ceil(GREP_FILE_COUNT / 4)

    const benchmarks: BenchmarkSeries[] = []

    benchmarks.push(await timeSeries('local-node mkdir', opts.fsIterations, async (i) => {
      await localWorkspace.mkdir(`${fixtureRoot}/mkdir/local-${String(i).padStart(3, '0')}`, { recursive: false })
    }))

    benchmarks.push(await timeSeries('vercel-fs mkdir', opts.fsIterations, async (i) => {
      await remoteWorkspace.mkdir(`${fixtureRoot}/mkdir/remote-${String(i).padStart(3, '0')}`, { recursive: false })
    }))

    benchmarks.push(await timeSeries('local-node writeFile', opts.fsIterations, async (i) => {
      await localWorkspace.writeFile(`${fixtureRoot}/writes/local-${String(i).padStart(3, '0')}.txt`, `local ${i}\n`)
    }))

    benchmarks.push(await timeSeries('vercel-fs writeFile', opts.fsIterations, async (i) => {
      await remoteWorkspace.writeFile(`${fixtureRoot}/writes/remote-${String(i).padStart(3, '0')}.txt`, `remote ${i}\n`)
    }))

    benchmarks.push(await timeSeries('local-node readFile', opts.fsIterations, async () => {
      await localWorkspace.readFile(`${fixtureRoot}/read-target.txt`)
    }))

    benchmarks.push(await timeSeries('vercel-fs readFile', opts.fsIterations, async () => {
      await remoteWorkspace.readFile(`${fixtureRoot}/read-target.txt`)
    }))

    benchmarks.push(await timeSeries('local-node stat', opts.fsIterations, async () => {
      await localWorkspace.stat(`${fixtureRoot}/read-target.txt`)
    }))

    benchmarks.push(await timeSeries('vercel-fs stat', opts.fsIterations, async () => {
      await remoteWorkspace.stat(`${fixtureRoot}/read-target.txt`)
    }))

    benchmarks.push(await timeSeries('local-bwrap exec find(100 files)', opts.cmdIterations, async () => {
      const result = await localBwrap.exec(`find ${fixtureRoot}/tree -type f | wc -l`, {
        timeoutMs: DEFAULT_TIMEOUT_MS,
      })
      const stdout = Buffer.from(result.stdout).toString('utf8').trim()
      assertExecOk('local-bwrap find', result.exitCode, stdout)
      const parsed = Number(stdout)
      if (parsed !== expectedFindCount) {
        fail(`local-bwrap find expected ${expectedFindCount}, received ${stdout}`)
      }
    }))

    benchmarks.push(await timeSeries('vercel-exec find(100 files)', opts.cmdIterations, async () => {
      const result = await remoteExec.exec(`find ${fixtureRoot}/tree -type f | wc -l`, {
        timeoutMs: DEFAULT_TIMEOUT_MS,
      })
      const stdout = Buffer.from(result.stdout).toString('utf8').trim()
      assertExecOk('vercel-exec find', result.exitCode, stdout)
      const parsed = Number(stdout)
      if (parsed !== expectedFindCount) {
        fail(`vercel-exec find expected ${expectedFindCount}, received ${stdout}`)
      }
    }))

    benchmarks.push(await timeSeries('local-bwrap exec grep(50 files)', opts.cmdIterations, async () => {
      const result = await localBwrap.exec(`grep -R \"${GREP_NEEDLE}\" ${fixtureRoot}/grep | wc -l`, {
        timeoutMs: DEFAULT_TIMEOUT_MS,
      })
      const stdout = Buffer.from(result.stdout).toString('utf8').trim()
      assertExecOk('local-bwrap grep', result.exitCode, stdout)
      const parsed = Number(stdout)
      if (parsed !== expectedGrepCount) {
        fail(`local-bwrap grep expected ${expectedGrepCount}, received ${stdout}`)
      }
    }))

    benchmarks.push(await timeSeries('vercel-exec grep(50 files)', opts.cmdIterations, async () => {
      const result = await remoteExec.exec(`grep -R \"${GREP_NEEDLE}\" ${fixtureRoot}/grep | wc -l`, {
        timeoutMs: DEFAULT_TIMEOUT_MS,
      })
      const stdout = Buffer.from(result.stdout).toString('utf8').trim()
      assertExecOk('vercel-exec grep', result.exitCode, stdout)
      const parsed = Number(stdout)
      if (parsed !== expectedGrepCount) {
        fail(`vercel-exec grep expected ${expectedGrepCount}, received ${stdout}`)
      }
    }))

    const report: Report = {
      recordedAt: new Date().toISOString(),
      environment: auth,
      config: {
        fsIterations: opts.fsIterations,
        cmdIterations: opts.cmdIterations,
        treeFileCount: TREE_FILE_COUNT,
        grepFileCount: GREP_FILE_COUNT,
      },
      benchmarks,
    }

    await mkdir(path.dirname(opts.outputPath), { recursive: true })
    await writeFile(opts.outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

    log(`wrote report to ${opts.outputPath}`)
    process.stdout.write(`${renderSummary(benchmarks)}\n`)
  } finally {
    if (remoteSandbox) {
      try {
        await remoteSandbox.stop()
      } catch {
        // best-effort cleanup
      }
    }
    await rm(localRoot, { recursive: true, force: true })
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error)
  process.stderr.write(`${BENCH_PREFIX} fatal: ${message}\n`)
  process.exitCode = 1
})
