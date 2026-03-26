/**
 * Long-running exec job manager.
 *
 * Lifecycle: PENDING → RUNNING → COMPLETED | FAILED | CANCELLED
 * Output buffer is append-only with cursor-based reads.
 * Output is capped at MAX_JOB_OUTPUT_BYTES to prevent memory exhaustion.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { validatePath } from '../workspace/paths.js'
import { hasBwrap } from '../workspace/helpers.js'
import { buildBwrapArgs, buildSandboxEnv } from '../adapters/bwrapImpl.js'

export type JobState = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface ExecJob {
  id: string
  command: string
  cwd: string
  state: JobState
  startedAt: number
  endedAt?: number
  exitCode?: number
  /** Append-only output chunks (stdout interleaved with stderr). */
  chunks: string[]
  /** Total bytes captured so far. */
  totalBytes: number
  process?: ChildProcess
}

export interface JobReadResult {
  job_id: string
  chunks: string[]
  cursor: number
  done: boolean
  exit_code?: number
  state: JobState
}

/**
 * In-memory job store. Jobs are garbage-collected after a TTL.
 */
const jobs = new Map<string, ExecJob>()

const JOB_TTL_MS = 10 * 60 * 1000 // 10 minutes
const MAX_JOB_OUTPUT_BYTES = 50 * 1024 * 1024 // 50MB per job

/** Periodically clean up finished jobs older than TTL. */
function gcOldJobs(): void {
  const now = Date.now()
  for (const [id, job] of jobs) {
    if (job.endedAt && now - job.endedAt > JOB_TTL_MS) {
      jobs.delete(id)
    }
  }
}

// Run GC every 60s
const gcInterval = setInterval(gcOldJobs, 60_000)
gcInterval.unref() // Don't block process exit

/**
 * Start a new long-running command job.
 */
export function startJob(
  workspaceRoot: string,
  command: string,
  opts?: { cwd?: string },
): { job_id: string } {
  const id = randomUUID()

  const effectiveCwd = opts?.cwd
    ? validatePath(workspaceRoot, opts.cwd)
    : workspaceRoot

  const job: ExecJob = {
    id,
    command,
    cwd: effectiveCwd,
    state: 'running',
    startedAt: Date.now(),
    chunks: [],
    totalBytes: 0,
  }

  // Spawn the process — use bwrap sandbox when available for filesystem isolation
  const useBwrap = hasBwrap()
  let proc: ChildProcess

  if (useBwrap) {
    const sandboxHome = '/workspace'
    const sandboxCwd = effectiveCwd.startsWith(workspaceRoot)
      ? sandboxHome + effectiveCwd.slice(workspaceRoot.length)
      : sandboxHome
    const bwrapArgs = buildBwrapArgs(workspaceRoot, sandboxHome, sandboxCwd)
    proc = spawn('bwrap', [...bwrapArgs, 'bash', '-c', command], {
      env: buildSandboxEnv(sandboxHome),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } else {
    proc = spawn('bash', ['-c', command], {
      cwd: effectiveCwd,
      env: {
        ...process.env,
        HOME: workspaceRoot,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  }

  job.process = proc

  // Capture output with size limit
  const captureData = (data: Buffer) => {
    if (job.totalBytes >= MAX_JOB_OUTPUT_BYTES) return
    const remaining = MAX_JOB_OUTPUT_BYTES - job.totalBytes
    if (data.length > remaining) {
      job.chunks.push(data.subarray(0, remaining).toString('utf-8'))
      job.chunks.push('\n[truncated: output exceeded 50MB]')
      job.totalBytes = MAX_JOB_OUTPUT_BYTES
    } else {
      job.chunks.push(data.toString('utf-8'))
      job.totalBytes += data.length
    }
  }

  proc.stdout?.on('data', captureData)
  proc.stderr?.on('data', captureData)

  // Handle completion — only update state if not already cancelled
  proc.on('close', (code) => {
    if (job.state === 'cancelled') return // Don't overwrite cancel
    job.exitCode = code ?? 0
    job.state = code === 0 ? 'completed' : 'failed'
    job.endedAt = Date.now()
    job.process = undefined
  })

  proc.on('error', (err) => {
    if (job.state === 'cancelled') return
    job.chunks.push(`[error] ${err.message}\n`)
    job.state = 'failed'
    job.exitCode = 1
    job.endedAt = Date.now()
    job.process = undefined
  })

  jobs.set(id, job)

  return { job_id: id }
}

/**
 * Read output chunks from a job with cursor support.
 */
export function readJob(
  jobId: string,
  afterCursor?: number,
): JobReadResult | null {
  const job = jobs.get(jobId)
  if (!job) return null

  const cursor = afterCursor ?? 0
  const newChunks = job.chunks.slice(cursor)
  const done = job.state === 'completed' || job.state === 'failed' || job.state === 'cancelled'

  return {
    job_id: jobId,
    chunks: newChunks,
    cursor: job.chunks.length,
    done,
    exit_code: job.exitCode,
    state: job.state,
  }
}

/**
 * Cancel a running job.
 */
export function cancelJob(jobId: string): boolean {
  const job = jobs.get(jobId)
  if (!job) return false

  // Only cancel jobs that are still running
  if (job.state !== 'running' && job.state !== 'pending') return true

  // Set state FIRST to prevent race with 'close' handler
  job.state = 'cancelled'
  job.endedAt = Date.now()

  if (job.process && !job.process.killed) {
    job.process.kill('SIGTERM')
    // If still alive after 5s, SIGKILL
    setTimeout(() => {
      if (job.process && !job.process.killed) {
        job.process.kill('SIGKILL')
      }
    }, 5000).unref()
  }

  return true
}

/**
 * Get a job by ID (for SSE streaming).
 */
export function getJob(jobId: string): ExecJob | undefined {
  return jobs.get(jobId)
}
