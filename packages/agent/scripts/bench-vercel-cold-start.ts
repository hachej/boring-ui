#!/usr/bin/env tsx

import { mkdir, writeFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { Sandbox } from '@vercel/sandbox'

const BENCH_PREFIX = '[bench]'
const DEFAULT_ITERATIONS = 10
const DEFAULT_TARBALL_URL = 'https://registry.npmjs.org/is-number/-/is-number-7.0.0.tgz'
const SNAPSHOT_EXPIRATION_MS = 24 * 60 * 60 * 1000

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = path.resolve(SCRIPT_DIR, '..')

type ScenarioKey = 'empty' | 'tarball' | 'snapshot'
const ALL_SCENARIO_KEYS: ScenarioKey[] = ['empty', 'tarball', 'snapshot']

interface Scenario {
  key: ScenarioKey
  label: string
  createParams: Parameters<typeof Sandbox.create>[0]
}

interface Sample {
  scenario: string
  iteration: number
  createMs: number
  firstCommandMs: number
  readyMs: number
  sandboxId: string
  recordedAt: string
}

interface CliOptions {
  iterations: number
  tarballUrl: string
  outputPath: string
  snapshotId?: string
  runtime?: string
  keepSnapshot: boolean
  delayMs: number
  scenarios: ScenarioKey[]
}

interface Quantiles {
  p50: number
  p95: number
  p99: number
}

interface ScenarioSummary {
  scenario: string
  create: Quantiles
  ready: Quantiles
}

function log(message: string): void {
  process.stderr.write(`${BENCH_PREFIX} ${message}\n`)
}

function printUsageAndExit(exitCode: number): never {
  const usage = `
Usage: tsx scripts/bench-vercel-cold-start.ts [options]

Options:
  --iterations <n>       Number of samples per scenario (default: 10)
  --tarball-url <url>    Tarball source URL for the tarball scenario
  --snapshot-id <id>     Reuse an existing snapshot for snapshot scenario
  --runtime <runtime>    Runtime for empty/tarball scenarios (for example python3.13)
  --scenarios <list>     Comma-separated scenario keys: empty,tarball,snapshot (default: all)
  --delay-ms <n>         Delay between iterations to avoid API burst limits (default: 250)
  --output <path>        CSV output path (default: bench-results/vercel-cold-start-YYYY-MM-DD.csv)
  --keep-snapshot        Keep generated snapshot instead of deleting it
  --help                 Show this message
`.trim()
  process.stdout.write(`${usage}\n`)
  process.exit(exitCode)
}

function formatDuration(ms: number): string {
  if (ms >= 1_000) {
    return `${(ms / 1_000).toFixed(2)} s`
  }
  return `${Math.round(ms)} ms`
}

function toFixedMs(ms: number): string {
  return ms.toFixed(1)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function parseCliOptions(argv: string[]): CliOptions {
  const dateStamp = new Date().toISOString().slice(0, 10)
  const opts: CliOptions = {
    iterations: DEFAULT_ITERATIONS,
    tarballUrl: DEFAULT_TARBALL_URL,
    outputPath: path.join(PACKAGE_ROOT, 'bench-results', `vercel-cold-start-${dateStamp}.csv`),
    keepSnapshot: false,
    delayMs: 250,
    scenarios: [...ALL_SCENARIO_KEYS],
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    switch (arg) {
      case '--':
        break
      case '--iterations': {
        const value = argv[index + 1]
        index += 1
        if (!value) {
          throw new Error('--iterations requires a value')
        }
        const parsed = Number(value)
        if (!Number.isInteger(parsed) || parsed < 1) {
          throw new Error(`--iterations must be a positive integer (received ${value})`)
        }
        opts.iterations = parsed
        break
      }
      case '--tarball-url': {
        const value = argv[index + 1]
        index += 1
        if (!value) {
          throw new Error('--tarball-url requires a value')
        }
        opts.tarballUrl = value
        break
      }
      case '--snapshot-id': {
        const value = argv[index + 1]
        index += 1
        if (!value) {
          throw new Error('--snapshot-id requires a value')
        }
        opts.snapshotId = value.trim()
        break
      }
      case '--runtime': {
        const value = argv[index + 1]
        index += 1
        if (!value) {
          throw new Error('--runtime requires a value')
        }
        opts.runtime = value.trim()
        break
      }
      case '--scenarios': {
        const value = argv[index + 1]
        index += 1
        if (!value) {
          throw new Error('--scenarios requires a value')
        }
        const parsed = value
          .split(',')
          .map((part) => part.trim())
          .filter((part) => part.length > 0) as ScenarioKey[]
        if (parsed.length === 0) {
          throw new Error('--scenarios must include at least one scenario key')
        }
        const invalid = parsed.filter((part) => !ALL_SCENARIO_KEYS.includes(part))
        if (invalid.length > 0) {
          throw new Error(`unknown scenario keys: ${invalid.join(', ')}`)
        }
        opts.scenarios = parsed
        break
      }
      case '--output': {
        const value = argv[index + 1]
        index += 1
        if (!value) {
          throw new Error('--output requires a value')
        }
        opts.outputPath = path.isAbsolute(value)
          ? value
          : path.resolve(process.cwd(), value)
        break
      }
      case '--keep-snapshot':
        opts.keepSnapshot = true
        break
      case '--delay-ms': {
        const value = argv[index + 1]
        index += 1
        if (!value) {
          throw new Error('--delay-ms requires a value')
        }
        const parsed = Number(value)
        if (!Number.isFinite(parsed) || parsed < 0) {
          throw new Error(`--delay-ms must be a non-negative number (received ${value})`)
        }
        opts.delayMs = parsed
        break
      }
      case '--help':
      case '-h':
        printUsageAndExit(0)
      default:
        throw new Error(`Unknown option: ${arg}`)
    }
  }

  return opts
}

function percentile(values: number[], targetPercentile: number): number {
  if (values.length === 0) {
    return Number.NaN
  }
  const sorted = [...values].sort((left, right) => left - right)
  const rank = Math.ceil((targetPercentile / 100) * sorted.length)
  const index = Math.min(sorted.length - 1, Math.max(rank - 1, 0))
  return sorted[index]
}

function summarizeScenario(samples: Sample[], scenario: string): ScenarioSummary {
  const scoped = samples.filter((sample) => sample.scenario === scenario)
  return {
    scenario,
    create: {
      p50: percentile(scoped.map((sample) => sample.createMs), 50),
      p95: percentile(scoped.map((sample) => sample.createMs), 95),
      p99: percentile(scoped.map((sample) => sample.createMs), 99),
    },
    ready: {
      p50: percentile(scoped.map((sample) => sample.readyMs), 50),
      p95: percentile(scoped.map((sample) => sample.readyMs), 95),
      p99: percentile(scoped.map((sample) => sample.readyMs), 99),
    },
  }
}

async function disposeSandbox(sandbox: Sandbox): Promise<void> {
  const asyncDisposeSymbol = (Symbol as typeof Symbol & { asyncDispose?: symbol }).asyncDispose
  if (asyncDisposeSymbol) {
    const maybeDispose = (sandbox as unknown as Record<symbol, unknown>)[asyncDisposeSymbol]
    if (typeof maybeDispose === 'function') {
      await (maybeDispose as () => Promise<void>).call(sandbox)
      return
    }
  }
  await sandbox.stop()
}

function extractHttpStatus(error: unknown): number | null {
  const asRecord = error as {
    status?: unknown
    response?: { status?: unknown }
    message?: unknown
  } | null
  if (typeof asRecord?.status === 'number') {
    return asRecord.status
  }
  if (typeof asRecord?.response?.status === 'number') {
    return asRecord.response.status
  }
  if (typeof asRecord?.message === 'string') {
    const match = asRecord.message.match(/status code\s+(\d+)/i)
    if (match?.[1]) {
      return Number(match[1])
    }
  }
  return null
}

function extractRetryAfterMs(error: unknown): number | null {
  const asRecord = error as {
    response?: { headers?: { get?: (name: string) => string | null } }
    json?: { error?: { limit?: { reset?: unknown } } }
  } | null

  const retryAfterRaw = asRecord?.response?.headers?.get?.('retry-after')
  if (typeof retryAfterRaw === 'string' && retryAfterRaw.trim().length > 0) {
    const retryAfterSeconds = Number(retryAfterRaw)
    if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
      return Math.ceil(retryAfterSeconds * 1_000)
    }
  }

  const resetAt = asRecord?.json?.error?.limit?.reset
  if (typeof resetAt === 'number' && Number.isFinite(resetAt)) {
    const remaining = Math.ceil(resetAt - Date.now())
    return remaining > 0 ? remaining : 0
  }

  return null
}

function isRetriableStatus(status: number | null): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504
}

async function withRetry<T>(label: string, operation: () => Promise<T>): Promise<T> {
  const maxAttempts = 6
  const initialDelayMs = 750

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      const status = extractHttpStatus(error)
      if (!isRetriableStatus(status) || attempt === maxAttempts) {
        throw error
      }
      const exponentialDelayMs = initialDelayMs * 2 ** (attempt - 1)
      const retryAfterMs = status === 429 ? extractRetryAfterMs(error) : null
      const waitMs = retryAfterMs !== null
        ? Math.max(exponentialDelayMs, retryAfterMs)
        : exponentialDelayMs
      log(`${label} attempt ${attempt}/${maxAttempts} failed with status ${status}; retrying in ${waitMs}ms`)
      await sleep(waitMs)
    }
  }

  throw new Error(`${label} exhausted retries`)
}

function buildCreateParams(opts: {
  key: ScenarioKey
  runtime?: string
  tarballUrl?: string
  snapshotId?: string
}): Parameters<typeof Sandbox.create>[0] {
  switch (opts.key) {
    case 'empty':
      return opts.runtime ? { runtime: opts.runtime } : {}
    case 'tarball':
      if (!opts.tarballUrl) {
        throw new Error('tarballUrl is required for tarball scenario')
      }
      return opts.runtime
        ? {
          runtime: opts.runtime,
          source: { type: 'tarball', url: opts.tarballUrl },
        }
        : {
          source: { type: 'tarball', url: opts.tarballUrl },
        }
    case 'snapshot':
      if (!opts.snapshotId) {
        throw new Error('snapshotId is required for snapshot scenario')
      }
      return {
        source: { type: 'snapshot', snapshotId: opts.snapshotId },
      }
  }
}

async function ensureCommandReadiness(sandbox: Sandbox): Promise<void> {
  const result = await sandbox.runCommand('echo', ['hi'])
  if (result.exitCode === 0) {
    return
  }
  const stderr = await result.stderr()
  throw new Error(`runCommand('echo hi') failed with exit code ${result.exitCode}: ${stderr.trim()}`)
}

async function measureOneIteration(
  scenario: Scenario,
  iteration: number,
): Promise<Sample> {
  let sandbox: Sandbox | null = null
  const createStart = performance.now()

  try {
    sandbox = await withRetry('Sandbox.create', async () => {
      return await Sandbox.create(scenario.createParams)
    })
    const createMs = performance.now() - createStart

    await withRetry('Sandbox.runCommand(echo hi)', async () => {
      await ensureCommandReadiness(sandbox as Sandbox)
    })
    const readyMs = performance.now() - createStart

    return {
      scenario: scenario.label,
      iteration,
      createMs,
      firstCommandMs: Math.max(0, readyMs - createMs),
      readyMs,
      sandboxId: sandbox.sandboxId,
      recordedAt: new Date().toISOString(),
    }
  } finally {
    if (sandbox) {
      try {
        await disposeSandbox(sandbox)
      } catch (error) {
        log(
          `warning: failed to stop sandbox (${sandbox.sandboxId}): ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
  }
}

function renderSummaryTable(summaries: ScenarioSummary[]): string {
  const lines = [
    '| Scenario | ready p50 | ready p95 | ready p99 | create p50 | create p95 | create p99 |',
    '|---|---:|---:|---:|---:|---:|---:|',
  ]

  for (const summary of summaries) {
    lines.push(
      `| ${summary.scenario} | ${formatDuration(summary.ready.p50)} | ${formatDuration(summary.ready.p95)} | ${formatDuration(summary.ready.p99)} | ${formatDuration(summary.create.p50)} | ${formatDuration(summary.create.p95)} | ${formatDuration(summary.create.p99)} |`,
    )
  }

  return lines.join('\n')
}

async function createBenchmarkSnapshot(
  tarballUrl: string,
  runtime?: string,
): Promise<{
  snapshotId: string
  cleanup: () => Promise<void>
}> {
  log('creating seed sandbox for snapshot scenario')

  let seedSandbox: Sandbox | null = null
  try {
    seedSandbox = await withRetry('Sandbox.create(seed)', async () => {
      return await Sandbox.create(
        runtime
          ? { runtime, source: { type: 'tarball', url: tarballUrl } }
          : { source: { type: 'tarball', url: tarballUrl } },
      )
    })

    await withRetry('Sandbox.runCommand(seed echo hi)', async () => {
      await ensureCommandReadiness(seedSandbox as Sandbox)
    })
    const snapshot = await withRetry('Sandbox.snapshot(seed)', async () => {
      return await (seedSandbox as Sandbox).snapshot({ expiration: SNAPSHOT_EXPIRATION_MS })
    })
    const snapshotId = snapshot.snapshotId

    return {
      snapshotId,
      cleanup: async () => {
        await snapshot.delete()
      },
    }
  } finally {
    if (seedSandbox) {
      try {
        await disposeSandbox(seedSandbox)
      } catch {
        // Snapshot creation may already stop the seed sandbox.
      }
    }
  }
}

function toCsv(samples: Sample[]): string {
  const header = 'recorded_at,scenario,iteration,create_ms,first_command_ms,ready_ms,sandbox_id'
  const rows = samples.map((sample) => {
    const scenario = sample.scenario.replaceAll('"', '""')
    return [
      sample.recordedAt,
      `"${scenario}"`,
      String(sample.iteration),
      toFixedMs(sample.createMs),
      toFixedMs(sample.firstCommandMs),
      toFixedMs(sample.readyMs),
      sample.sandboxId,
    ].join(',')
  })
  return `${header}\n${rows.join('\n')}\n`
}

function resolveOutputPath(outputPath: string): string {
  if (path.isAbsolute(outputPath)) {
    return outputPath
  }
  return path.resolve(PACKAGE_ROOT, outputPath)
}

async function main(): Promise<void> {
  const opts = parseCliOptions(process.argv.slice(2))
  if (!process.env.VERCEL_OIDC_TOKEN) {
    throw new Error('VERCEL_OIDC_TOKEN is required')
  }
  const samples: Sample[] = []

  let snapshotId = opts.snapshotId
  let deleteGeneratedSnapshot: (() => Promise<void>) | null = null
  const includesSnapshotScenario = opts.scenarios.includes('snapshot')

  if (includesSnapshotScenario && !snapshotId) {
    const generated = await createBenchmarkSnapshot(opts.tarballUrl, opts.runtime)
    snapshotId = generated.snapshotId
    deleteGeneratedSnapshot = generated.cleanup
    log(`generated benchmark snapshot: ${snapshotId}`)
  } else if (snapshotId) {
    log(`using provided snapshot id: ${snapshotId}`)
  }

  const scenarios: Scenario[] = []

  if (opts.scenarios.includes('empty')) {
    scenarios.push({
      key: 'empty',
      label: 'source: empty',
      createParams: buildCreateParams({ key: 'empty', runtime: opts.runtime }),
    })
  }

  if (opts.scenarios.includes('tarball')) {
    scenarios.push({
      key: 'tarball',
      label: 'source: tarball',
      createParams: buildCreateParams({
        key: 'tarball',
        runtime: opts.runtime,
        tarballUrl: opts.tarballUrl,
      }),
    })
  }

  if (opts.scenarios.includes('snapshot')) {
    scenarios.push({
      key: 'snapshot',
      label: 'source: snapshot',
      createParams: buildCreateParams({
        key: 'snapshot',
        snapshotId,
      }),
    })
  }

  for (let scenarioIndex = 0; scenarioIndex < scenarios.length; scenarioIndex += 1) {
    const scenario = scenarios[scenarioIndex]
    log(`running scenario "${scenario.label}" (${opts.iterations} iterations)`)
    for (let iteration = 1; iteration <= opts.iterations; iteration += 1) {
      const sample = await measureOneIteration(scenario, iteration)
      samples.push(sample)
      log(
        `${scenario.label} [${iteration}/${opts.iterations}] create=${formatDuration(sample.createMs)} ready=${formatDuration(sample.readyMs)}`,
      )
      if (opts.delayMs > 0 && iteration < opts.iterations) {
        await sleep(opts.delayMs)
      }
    }
    if (opts.delayMs > 0 && scenarioIndex < scenarios.length - 1) {
      await sleep(opts.delayMs)
    }
  }

  if (deleteGeneratedSnapshot && !opts.keepSnapshot) {
    try {
      await deleteGeneratedSnapshot()
      log('deleted generated benchmark snapshot')
    } catch (error) {
      log(
        `warning: failed to delete generated snapshot: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  const summaries = scenarios.map((scenario) => summarizeScenario(samples, scenario.label))
  const outputPath = resolveOutputPath(opts.outputPath)
  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, toCsv(samples), 'utf8')

  log(`wrote ${samples.length} rows to ${outputPath}`)
  process.stdout.write('\n')
  process.stdout.write(renderSummaryTable(summaries))
  process.stdout.write('\n')
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error)
  process.stderr.write(`${BENCH_PREFIX} fatal: ${message}\n`)
  process.exitCode = 1
})
